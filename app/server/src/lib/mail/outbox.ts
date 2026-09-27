import { createHash } from "node:crypto";
import { domainToASCII } from "node:url";
import type Database from "better-sqlite3";
import type { RenderedMail } from "./envelope.js";
import { MailProviderError, type MailProvider } from "./providers.js";

/**
 * 发信队列（#148）：信先写进 data.db 的 mail_outbox，再由同一进程里的发信循环发出去。
 *
 * - 同一件事只发一封：event_key 唯一（INSERT OR IGNORE），重复触发不会多发。
 * - 没有配置发信商的，写成 skipped/mail_disabled；白名单模式下不在白名单里的地址写成 skipped/not_allowlisted。都不发。
 * - 调用方可以给一封信加上限（EnqueueLimits）：同一个收件箱在一段时间内已经有同一种信的，写成 skipped/recipient_limited
 *   （按 limitKey 规范化后的地址比，victim+1@、末尾带点的域名算同一个收件箱）；
 *   同一个来源（投递人的 IP，IPv6 按 /64）一小时、一天内同一种信够数了的，写成 skipped/source_limited；
 *   全站一小时内同一种信够数了的，写成 skipped/rate_limited。只数真的要发的信（不数 skipped）。
 * - 发信循环每 15 秒一次，每次放进新信后立刻再跑一次；测试不开循环，直接调 drain()。
 * - 领一封信时写成 sending，并把 next_attempt_at 推到 5 分钟以后当租约：进程在发信中途退出，5 分钟后这封信会重试。
 * - 一次尝试里发信商按顺序试（阿里云在前、Resend 兜底），都失败算一次失败；失败后等 1 分钟、5 分钟、30 分钟、2 小时、6 小时再试，
 *   第 6 次失败就放弃（failed）。
 * - 信到了最终状态（sent / failed / skipped）就清掉收件地址、HTML 和纯文本，只留收件地址的 sha256、主题和结果。
 * - last_error 只有发信商名、HTTP 状态和对方的错误码，不含密钥、地址和正文；日志同样不记地址和正文。
 *   前一家失败、后一家发出时，前一家的错误也留在 last_error 里。
 */

export type MailKind = "recruitment.received" | "recruitment.interview" | "recruitment.accepted" | "recruitment.rejected";
export type MailStatus = "pending" | "sending" | "sent" | "failed" | "skipped";
export type MailSkipReason = "mail_disabled" | "not_allowlisted" | "recipient_limited" | "source_limited" | "rate_limited";

/** 控制台看到的一封信的结果：没有收件地址和正文。 */
export type MailSummary = {
  status: MailStatus;
  skip_reason: string | null;
  attempts: number;
  subject: string;
  sent_at: number | null;
  updated_at: number;
};

export type OutboxEntry = {
  /** 'application:<application_id>:received' 或 'review:<review_id>' */
  eventKey: string;
  kind: MailKind;
  applicationId?: string | null;
  reviewId?: number | null;
  to: string;
  mail: RenderedMail;
  /** 触发这封信的来源（投递人的 IP，IPv6 按 /64）；只存 sha256，给 EnqueueLimits 的按来源限量用 */
  source?: string | null;
};

type OutboxRow = {
  id: number; event_key: string; kind: string; recipient: string | null; recipient_hash: string; subject: string;
  html: string | null; text: string | null; reply_to: string | null; status: MailStatus; attempts: number; created_at: number;
};

/** 放进队列时的上限；只对同一种信（kind）计数。 */
export type EnqueueLimits = {
  /** 同一个收件地址在这段时间里已经有一封同种的信，这封就不发 */
  recipientWindowMs?: number;
  /** 同一个来源一小时、一天内同种的信到了这个数，这封就不发（OutboxEntry.source 为空时不查） */
  perSourceHour?: number;
  perSourceDay?: number;
  /** 全站一小时内同种的信到了这个数，这封就不发 */
  perHour?: number;
};

export type MailLogger = {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
};

/** 第 n 次失败之后等多久再试；第 MAX_ATTEMPTS 次失败就放弃。 */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** sending 的租约：超过这么久还没有结果，就当作发信中途断了，重新领 */
export const SEND_LEASE_MS = 5 * 60_000;
export const DRAIN_INTERVAL_MS = 15_000;
/** 一次请求最多等这么久，超时算这家发信商失败 */
const REQUEST_TIMEOUT_MS = 15_000;
const BATCH = 10;
const SUMMARY_COLUMNS = "status, skip_reason, attempts, subject, sent_at, updated_at";

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** 收件地址的哈希：去掉首尾空白、转小写后的 sha256（十六进制）。 */
export function recipientHash(address: string): string {
  return createHash("sha256").update(normalizeAddress(address)).digest("hex");
}

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * 限量时用的收件箱：同一个收件箱的几种写法算一个。本地部分去掉第一个「+」和后面的标签（victim+1@ → victim@），
 * 域名先按 IDNA（UTS46，和浏览器、发信商一样）转成 ASCII，再去掉末尾的点：全角字母、全角句点、软连字符、零宽字符
 * 都算原来的域名；Gmail 忽略本地部分里的点，googlemail.com 算 gmail.com。
 * 少数邮箱里「+」是地址本身的一部分，这样会多限一点，对限量来说可以接受。
 */
export function limitKey(address: string): string {
  const value = normalizeAddress(address);
  const at = value.lastIndexOf("@");
  if (at < 0) return value;
  let local = value.slice(0, at).split("+")[0];
  const raw = value.slice(at + 1);
  let domain = (domainToASCII(raw) || raw).replace(/\.+$/, ""); // 转不了的域名按原样
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

export type OutboxOptions = {
  providers: readonly MailProvider[];
  recipients: "all" | "allowlist";
  /** 小写的地址 */
  allowlist: readonly string[];
  now?: () => number;
};

export function createMailOutbox(db: Database.Database, options: OutboxOptions) {
  const now = options.now ?? Date.now;
  const allowlist = new Set(options.allowlist.map(normalizeAddress));
  const enabled = options.providers.length > 0;

  const insert = db.prepare(`INSERT OR IGNORE INTO mail_outbox
    (event_key, kind, application_id, review_id, recipient, recipient_hash, limit_hash, source_hash, subject, html, text, reply_to, status, skip_reason, attempts, next_attempt_at, created_at, updated_at)
    VALUES (@event_key, @kind, @application_id, @review_id, @recipient, @recipient_hash, @limit_hash, @source_hash, @subject, @html, @text, @reply_to, @status, @skip_reason, 0, @at, @at, @at)`);
  const byEvent = db.prepare("SELECT id, status FROM mail_outbox WHERE event_key = ?");
  const summaryByEvent = db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM mail_outbox WHERE event_key = ?`);
  const due = db.prepare("SELECT id, status, attempts FROM mail_outbox WHERE status IN ('pending', 'sending') AND next_attempt_at <= ? ORDER BY next_attempt_at, id LIMIT ?");
  const claim = db.prepare(`UPDATE mail_outbox SET status = 'sending', attempts = attempts + 1, next_attempt_at = @lease, updated_at = @at
    WHERE id = @id AND status IN ('pending', 'sending') AND next_attempt_at <= @at`);
  const load = db.prepare("SELECT id, event_key, kind, recipient, recipient_hash, subject, html, text, reply_to, status, attempts, created_at FROM mail_outbox WHERE id = ?");
  // 最终状态：清掉收件地址和正文
  const finish = db.prepare(`UPDATE mail_outbox SET status = @status, skip_reason = @skip_reason, provider = @provider, provider_message_id = @provider_message_id,
    last_error = @last_error, sent_at = @sent_at, updated_at = @at, recipient = NULL, html = NULL, text = NULL WHERE id = @id`);
  const retry = db.prepare("UPDATE mail_outbox SET status = 'pending', next_attempt_at = @next, last_error = @last_error, updated_at = @at WHERE id = @id");
  const toRecipientSince = db.prepare("SELECT 1 FROM mail_outbox WHERE kind = ? AND limit_hash = ? AND created_at > ? AND status != 'skipped' LIMIT 1");
  const countSince = db.prepare("SELECT COUNT(*) AS n FROM mail_outbox WHERE kind = ? AND created_at > ? AND status != 'skipped'");
  const fromSourceSince = db.prepare("SELECT COUNT(*) AS n FROM mail_outbox WHERE kind = ? AND source_hash = ? AND created_at > ? AND status != 'skipped'");

  let timer: ReturnType<typeof setInterval> | null = null;
  let log: MailLogger | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let stopping: AbortController | null = null;

  function allowed(address: string): boolean {
    return options.recipients === "all" || allowlist.has(normalizeAddress(address));
  }

  /** 这封信不发的理由；能发时返回 null。 */
  function skipReason(address: string): MailSkipReason | null {
    if (!enabled) return "mail_disabled";
    if (!allowed(address)) return "not_allowlisted";
    return null;
  }

  /** 超出调用方给的上限时不发的理由 */
  function limitReason(kind: MailKind, inbox: string, source: string | null, limits: EnqueueLimits): MailSkipReason | null {
    const at = now();
    if (limits.recipientWindowMs && toRecipientSince.get(kind, inbox, at - limits.recipientWindowMs)) return "recipient_limited";
    const fromSource = (windowMs: number) => (fromSourceSince.get(kind, source, at - windowMs) as { n: number }).n;
    if (source && limits.perSourceHour && fromSource(3600_000) >= limits.perSourceHour) return "source_limited";
    if (source && limits.perSourceDay && fromSource(24 * 3600_000) >= limits.perSourceDay) return "source_limited";
    if (limits.perHour && (countSince.get(kind, at - 3600_000) as { n: number }).n >= limits.perHour) return "rate_limited";
    return null;
  }

  function end(id: number, result: { status: "sent" | "failed" | "skipped"; skip_reason?: MailSkipReason; provider?: string; provider_message_id?: string | null; last_error?: string; sent_at?: number }) {
    finish.run({
      id, at: now(), status: result.status, skip_reason: result.skip_reason ?? null, provider: result.provider ?? null,
      provider_message_id: result.provider_message_id ?? null, last_error: result.last_error ?? null, sent_at: result.sent_at ?? null,
    });
  }

  /** Resend 的 Idempotency-Key：同一封信每次重试都一样；两个环境的编号会重，所以带上建信时间和收件地址哈希。 */
  function idempotencyKey(row: OutboxRow): string {
    return `yzgc-mail-${createHash("sha256").update(`${row.event_key}|${row.recipient_hash}|${row.created_at}`).digest("hex").slice(0, 40)}`;
  }

  async function attempt(id: number, signal: AbortSignal) {
    const row = load.get(id) as OutboxRow | undefined;
    if (!row || row.status !== "sending") return;
    if (!row.recipient || row.html === null || row.text === null) {
      end(id, { status: "failed", last_error: "missing_content" });
      return;
    }
    // 发信之前再看一次：重启后发信商或白名单可能变了
    const reason = skipReason(row.recipient);
    if (reason) {
      end(id, { status: "skipped", skip_reason: reason });
      return;
    }
    const providers = options.providers.filter(provider => !row.reply_to || provider.supportsReplyTo);
    if (!providers.length) {
      end(id, { status: "failed", last_error: "reply_to_unsupported" });
      return;
    }
    const errors: string[] = [];
    for (const provider of providers) {
      if (signal.aborted) break;
      try {
        const result = await provider.send(
          { to: row.recipient, subject: row.subject, html: row.html, text: row.text, replyTo: row.reply_to, idempotencyKey: idempotencyKey(row) },
          AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        );
        end(id, { status: "sent", provider: provider.name, provider_message_id: result.messageId, sent_at: now(), last_error: errors.length ? errors.join("; ").slice(0, 300) : undefined });
        return;
      } catch (error) {
        errors.push(error instanceof MailProviderError ? error.message : `${provider.name} error`);
      }
    }
    const lastError = (errors.join("; ") || "stopped").slice(0, 300);
    if (row.attempts >= MAX_ATTEMPTS) {
      end(id, { status: "failed", last_error: lastError });
      log?.error({ mail_id: id, kind: row.kind, attempts: row.attempts, error: lastError }, "mail failed for good");
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(row.attempts, RETRY_DELAYS_MS.length) - 1];
    retry.run({ id, next: now() + delay, last_error: lastError, at: now() });
    log?.warn({ mail_id: id, kind: row.kind, attempts: row.attempts, retry_in_ms: delay, error: lastError }, "mail attempt failed");
  }

  async function drainOnce(signal: AbortSignal): Promise<number> {
    const at = now();
    const rows = due.all(at, BATCH) as { id: number; status: MailStatus; attempts: number }[];
    let handled = 0;
    for (const row of rows) {
      if (signal.aborted) break;
      // 发到一半断掉、已经试满次数的，不再领
      if (row.status === "sending" && row.attempts >= MAX_ATTEMPTS) {
        end(row.id, { status: "failed", last_error: "lease_expired" });
        handled += 1;
        continue;
      }
      if (claim.run({ id: row.id, at: now(), lease: now() + SEND_LEASE_MS }).changes !== 1) continue;
      handled += 1;
      await attempt(row.id, signal);
    }
    return rows.length === BATCH ? handled : 0;
  }

  /** 把到期的信发一遍；同一时间只有一轮在跑，跑的时候又被叫到就接着再跑一轮。 */
  function drain(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    const signal = (stopping ??= new AbortController()).signal;
    running = (async () => {
      try {
        do {
          again = false;
          // 一批满了就接着领下一批
          while (!signal.aborted && (await drainOnce(signal)) > 0);
        } while (again && !signal.aborted);
      } catch (error) {
        log?.error({ error: (error as Error)?.name ?? "error" }, "mail drain failed");
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    /** 至少配置了一家发信商 */
    enabled,
    recipients: options.recipients,
    /** 现在给这个地址写信会不会真的发出去 */
    deliverable(address: string): boolean {
      return skipReason(address) === null;
    },
    /**
     * 放进一封信。同一个 eventKey 只会有一行：已经有了就不动，返回已有那行。
     * 不发的信（没配置发信商、不在白名单、超出 limits）直接写成 skipped，不留收件地址和正文。
     * 查上限和写入之间没有 await，同一进程里不会有两封信同时数到同一个空位。
     */
    enqueue(entry: OutboxEntry, limits: EnqueueLimits = {}): { id: number; status: MailStatus; created: boolean } {
      const at = now();
      const hash = recipientHash(entry.to);
      const inbox = createHash("sha256").update(limitKey(entry.to)).digest("hex");
      const source = entry.source ? createHash("sha256").update(entry.source).digest("hex") : null;
      const reason = skipReason(entry.to) ?? limitReason(entry.kind, inbox, source, limits);
      const keep = reason === null;
      const result = insert.run({
        event_key: entry.eventKey, kind: entry.kind, application_id: entry.applicationId ?? null, review_id: entry.reviewId ?? null,
        recipient: keep ? entry.to.trim() : null, recipient_hash: hash, limit_hash: inbox, source_hash: source, subject: entry.mail.subject,
        html: keep ? entry.mail.html : null, text: keep ? entry.mail.text : null, reply_to: entry.mail.replyTo,
        status: keep ? "pending" : "skipped", skip_reason: reason, at,
      });
      const row = byEvent.get(entry.eventKey) as { id: number; status: MailStatus };
      // 发信循环开着时（服务进程里）马上发；放在 setImmediate 里，调用方的事务先提交
      if (result.changes === 1 && keep && timer) setImmediate(() => void drain());
      return { ...row, created: result.changes === 1 };
    },
    summary(eventKey: string): MailSummary | null {
      return (summaryByEvent.get(eventKey) as MailSummary | undefined) ?? null;
    },
    /** 审核记录 id → 那次改状态发的信 */
    reviewSummaries(reviewIds: readonly number[]): Map<number, MailSummary> {
      if (!reviewIds.length) return new Map();
      const rows = db.prepare(`SELECT review_id, ${SUMMARY_COLUMNS} FROM mail_outbox WHERE review_id IN (${reviewIds.map(() => "?").join(",")})`)
        .all(...reviewIds) as (MailSummary & { review_id: number })[];
      return new Map(rows.map(({ review_id, ...summary }) => [review_id, summary]));
    },
    drain,
    /** 服务进程里开发信循环（buildApp 的 mailWorker）；测试不开，直接调 drain() */
    start(logger: MailLogger) {
      if (timer) return;
      log = logger;
      stopping = new AbortController();
      timer = setInterval(() => void drain(), DRAIN_INTERVAL_MS);
      timer.unref();
      void drain();
    },
    /** 停掉循环，打断正在发的请求并等这一轮收尾（被打断的信按一次失败记，之后重试） */
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      stopping?.abort();
      if (running) await running;
      stopping = null;
    },
  };
}

export type MailOutbox = ReturnType<typeof createMailOutbox>;
