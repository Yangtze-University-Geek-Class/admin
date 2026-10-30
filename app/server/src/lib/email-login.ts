import { createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { domainToASCII } from "node:url";
import type Database from "better-sqlite3";
import { limitKey } from "./mail/outbox.js";

/**
 * 邮箱验证码（#262，docs/plan/UNIFIED-LOGIN.md「邮箱验证码」）：一次「获取验证码」建一行挑战，cookie 里只放挑战 id；
 * 验证码 6 位、10 分钟有效、最多试 5 次、用过即作废，库里只存 HMAC。只有这个模块读写 `email_challenges`。
 *
 * 和规格的不同（所有者 2026-10-23 开放邀请码注册）：没有账号的邮箱也发验证码——填了邀请码就能用它建号；
 * 所以不论邮箱有没有账号都真的发信，`start` 的响应照旧一样，不能从响应看出邮箱是否注册过。
 * 限流跨重启成立，从这张表计数：同一收件箱 60 秒一次、每小时 5 次，同一 IP（IPv6 按 /64）每小时 20 次。
 */
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_AFTER_S = 60;
const HOUR_MS = 3600_000;
const PER_INBOX_HOUR = 5;
const PER_IP_HOUR = 20;
/** 过期一小时后才删：限流按一小时窗口从这张表计数。 */
export const CHALLENGE_RETENTION_MS = HOUR_MS;

/**
 * 规范化邮箱：去首尾空白、整体转小写、域名转 ASCII；总长不超过 254、只有一个 `@`、两边非空、域名带点，
 * 不含空白、控制字符和 `<>()[]\,;:"`。不合格返回 null（路由回 `400 bad_email`）。`a+tag@x` 与 `a@x` 是两个地址。
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return null;
  const local = value.slice(0, at);
  const domain = domainToASCII(value.slice(at + 1));
  const bad = /[\s\u0000-\u001f\u007f<>()[\]\\,;:"]/;
  if (!domain || !domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || bad.test(local) || bad.test(domain)) return null;
  const email = `${local}@${domain}`;
  return email.length <= 254 ? email : null;
}

/** 掩码：c***@example.com（账号页、日志之外的地方显示邮箱只用这个）。 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

/** 限流用的 IP 键：IPv4 整个地址，IPv6 取前 64 位。 */
export function ipPrefix(ip: string): string {
  const value = ip.startsWith("::ffff:") && isIPv4(ip.slice(7)) ? ip.slice(7) : ip;
  if (!isIPv6(value)) return value;
  const [head, tail = ""] = value.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = value.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return groups.slice(0, 4).map(group => group.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

export type ChallengePurpose = "signin" | "link";
export type Challenge = {
  id: string; purpose: ChallengePurpose; email: string; account_id: string | null; session_hash: string | null;
  return_to: string | null; attempts: number; created_at: number; expires_at: number;
};
export type StartResult = { ok: true; id: string; code: string } | { ok: false; retryAfter: number };
/**
 * `code_expired` 的 `guessed`：这一次真的拿验证码比对过（第 5 次猜错把挑战用完）。过期、已用、不存在或早已用完的
 * 挑战没有比对，不带这个标记——访问防护（#333）只给真的猜过的失败加分，回来晚了、重复提交的用户不算猜。
 */
export type CheckResult =
  | { ok: true; challenge: Challenge }
  | { ok: false; error: "invalid_code"; attemptsLeft: number }
  | { ok: false; error: "code_expired"; guessed?: true };

export function createEmailLogin(db: Database.Database, deps: { sessionSecret: string; clock?: () => number }) {
  const clock = deps.clock ?? Date.now;
  // 不新增环境变量：两把键都从 SESSION_SECRET 派生；轮换 SESSION_SECRET 只会让还没用的验证码失效
  const key = (info: string) => Buffer.from(hkdfSync("sha256", deps.sessionSecret, "", info, 32));
  const codeKey = key("yzgc:email-code:v1");
  const ipKey = key("yzgc:ip:v1");
  const hmac = (secret: Buffer, value: string) => createHmac("sha256", secret).update(value).digest("hex");

  const sinceByInbox = db.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest, MAX(created_at) AS latest FROM email_challenges WHERE limit_key = ? AND created_at > ?");
  const sinceByIp = db.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM email_challenges WHERE ip_key = ? AND created_at > ?");
  const retire = db.prepare("UPDATE email_challenges SET used_at = ? WHERE id = ? AND email = ? AND purpose = ? AND used_at IS NULL");
  const insert = db.prepare(`INSERT INTO email_challenges(id, purpose, email, limit_key, account_id, session_hash, return_to, code_hmac, attempts, ip_key, created_at, expires_at)
    VALUES(@id, @purpose, @email, @limit_key, @account_id, @session_hash, @return_to, @code_hmac, 0, @ip_key, @now, @expires_at)`);
  const load = db.prepare(`SELECT id, purpose, email, account_id, session_hash, return_to, attempts, created_at, expires_at, code_hmac, used_at
    FROM email_challenges WHERE id = ?`);
  const fail = db.prepare("UPDATE email_challenges SET attempts = attempts + 1 WHERE id = ?");
  const take = db.prepare("UPDATE email_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?");
  const purge = db.prepare("DELETE FROM email_challenges WHERE expires_at < ?");

  /**
   * 获取验证码：先过限流（超了回 retryAfter 秒），再作废这个浏览器上一次的挑战（`replaces`，取自挑战 cookie），建一行新挑战。
   * 只作废同一个浏览器的：别人替这个邮箱要码，不会让本人手上的验证码失效。
   * 返回挑战 id（写进 cookie）和验证码原文（只交给发信，不落库、不进日志）。
   */
  function start(input: { purpose: ChallengePurpose; email: string; ip: string; replaces?: string | null; returnTo?: string | null; accountId?: string | null; sessionHash?: string | null }): StartResult {
    return db.transaction((): StartResult => {
      const now = clock();
      const inbox = limitKey(input.email);
      const ip = hmac(ipKey, ipPrefix(input.ip));
      const byInbox = sinceByInbox.get(inbox, now - HOUR_MS) as { n: number; oldest: number | null; latest: number | null };
      if (byInbox.latest !== null && now - byInbox.latest < RESEND_AFTER_S * 1000) {
        return { ok: false, retryAfter: Math.ceil((byInbox.latest + RESEND_AFTER_S * 1000 - now) / 1000) };
      }
      if (byInbox.n >= PER_INBOX_HOUR) return { ok: false, retryAfter: Math.ceil((byInbox.oldest! + HOUR_MS - now) / 1000) };
      const byIp = sinceByIp.get(ip, now - HOUR_MS) as { n: number; oldest: number | null };
      if (byIp.n >= PER_IP_HOUR) return { ok: false, retryAfter: Math.ceil((byIp.oldest! + HOUR_MS - now) / 1000) };
      if (input.replaces) retire.run(now, input.replaces, input.email, input.purpose);
      const id = randomBytes(16).toString("base64url");
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      insert.run({
        id, purpose: input.purpose, email: input.email, limit_key: inbox, account_id: input.accountId ?? null,
        session_hash: input.sessionHash ?? null, return_to: input.returnTo ?? null, code_hmac: hmac(codeKey, `${id}|${code}`),
        ip_key: ip, now, expires_at: now + CODE_TTL_MS,
      });
      return { ok: true, id, code };
    }).immediate();
  }

  /**
   * 核对验证码，不占用：同步事务里比较并计数（better-sqlite3 同步执行，并发请求不能多试）。对了返回挑战，
   * 由调用方在登录事务里用 `claim` 占用；错了 attempts + 1，第 5 次错、已过期、已用或不存在都算 `code_expired`。
   */
  function check(id: unknown, code: unknown, purpose: ChallengePurpose): CheckResult {
    return db.transaction((): CheckResult => {
      if (typeof id !== "string" || !id) return { ok: false, error: "code_expired" };
      const row = load.get(id) as (Challenge & { code_hmac: string; used_at: number | null }) | undefined;
      if (!row || row.purpose !== purpose || row.used_at !== null || row.expires_at <= clock() || row.attempts >= CODE_MAX_ATTEMPTS) {
        return { ok: false, error: "code_expired" };
      }
      const given = typeof code === "string" && /^\d{6}$/.test(code.trim()) ? hmac(codeKey, `${id}|${code.trim()}`) : "";
      const expected = Buffer.from(row.code_hmac, "hex");
      const actual = given ? Buffer.from(given, "hex") : Buffer.alloc(expected.length);
      if (!given || !timingSafeEqual(actual, expected)) {
        fail.run(id);
        const left = CODE_MAX_ATTEMPTS - row.attempts - 1;
        return left > 0 ? { ok: false, error: "invalid_code", attemptsLeft: left } : { ok: false, error: "code_expired", guessed: true };
      }
      const { code_hmac: _hmac, used_at: _used, ...challenge } = row;
      return { ok: true, challenge };
    }).immediate();
  }

  /** 验证码对了但这次没能用上（例如邀请码不对）：同样记一次失败，免得用一个验证码无限次试邀请码。 */
  function penalize(id: string): number {
    fail.run(id);
    const row = load.get(id) as { attempts: number } | undefined;
    return Math.max(0, CODE_MAX_ATTEMPTS - (row?.attempts ?? CODE_MAX_ATTEMPTS));
  }

  /** 占用验证码：条件更新，只有一个请求能成功。必须在登录事务里调用，事务回滚时占用一起回滚。 */
  function claim(id: string): boolean {
    return take.run(clock(), id, clock()).changes === 1;
  }

  /** 随会话清理（每小时）删掉过期超过一小时的挑战。 */
  function cleanup(): number {
    return purge.run(clock() - CHALLENGE_RETENTION_MS).changes;
  }

  return { start, check, penalize, claim, cleanup };
}
export type EmailLogin = ReturnType<typeof createEmailLogin>;
