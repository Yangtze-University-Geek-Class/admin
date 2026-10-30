import type Database from "better-sqlite3";

/**
 * 防盗刷计数的唯一入口（#274 SPEC §3.8）：写在通用的 `limit_events` 表（db.ts），按 `bucket`（哪条规则）
 * 加 `subject`（账号、IP、设备……）计数。窗口有两种：`"day-bj"` 按北京时间的日历日重置（零点），
 * `{ ms }` 是滚动窗口（从现在往前数 ms 毫秒）。`max === -1` 是 SPEC §3.5 第 4 条的「不限」约定：
 * 永远放行、不写行，免得无限额度的桶把表撑大。
 *
 * `hit()` 查次数、判断、写入在同一个事务里，中间没有 await：两个并发请求不会同时放行同一个名额。
 * `hitAll()` 在一个事务里核对多个桶，只要有一个超限就整体不计数（全有或全没有）——投递这类要同时按账号、
 * IP、设备三条线计数的写入靠它保持原子，不会出现「IP 额度扣了，设备超限又没真正投递成功」的半截状态。
 */
export type LimitWindow = "day-bj" | { ms: number };
export type LimitDeps = { clock?: () => number };
export type HitResult = { ok: boolean; count: number; retry_after: number };
export type LimitCheck = { bucket: string; subject: string; window: LimitWindow; max: number };
export type LimitOutcome = LimitCheck & HitResult;

const DAY_MS = 24 * 3600_000;
const HOUR_MS = 3600_000;
const BJ_OFFSET_MS = 8 * 3600_000;

/** `now` 所在的北京日历日边界（两端都是 UTC 毫秒时间戳），零点重置用它算下一次零点。 */
export function beijingDayBounds(now: number): { start: number; end: number } {
  const shifted = now + BJ_OFFSET_MS;
  const startShifted = Math.floor(shifted / DAY_MS) * DAY_MS;
  return { start: startShifted - BJ_OFFSET_MS, end: startShifted - BJ_OFFSET_MS + DAY_MS };
}

function windowSince(window: LimitWindow, now: number): number {
  return window === "day-bj" ? beijingDayBounds(now).start : now - window.ms;
}
function retryAfterFor(window: LimitWindow, now: number): number {
  return Math.max(1, Math.ceil((window === "day-bj" ? beijingDayBounds(now).end - now : window.ms) / 1000));
}

export function createLimits(db: Database.Database, deps: LimitDeps = {}) {
  const clock = deps.clock ?? Date.now;
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM limit_events WHERE bucket = ? AND subject = ? AND at > ?");
  const insertStmt = db.prepare("INSERT INTO limit_events(bucket, subject, at) VALUES (?, ?, ?)");
  const pruneStmt = db.prepare("DELETE FROM limit_events WHERE bucket = ? AND at <= ?");

  /** 这个桶 + 对象现在用掉了几次（只读，不写入）。 */
  function count(input: { bucket: string; subject: string; window: LimitWindow; now?: number }): number {
    const now = input.now ?? clock();
    return (countStmt.get(input.bucket, input.subject, windowSince(input.window, now)) as { n: number }).n;
  }

  /** 查次数、判断、（放行时）写入，一个事务。`max === -1` 永远放行、不计数。 */
  function hit(input: LimitCheck & { now?: number }): HitResult {
    const now = input.now ?? clock();
    if (input.max === -1) return { ok: true, count: 0, retry_after: 0 };
    return db.transaction((): HitResult => {
      const current = (countStmt.get(input.bucket, input.subject, windowSince(input.window, now)) as { n: number }).n;
      if (current >= input.max) return { ok: false, count: current, retry_after: retryAfterFor(input.window, now) };
      insertStmt.run(input.bucket, input.subject, now);
      return { ok: true, count: current + 1, retry_after: 0 };
    }).immediate();
  }

  /** 一次核对多个桶：全部放行才真的写入，任何一个超限则整体不计数，返回每个桶各自的结果。 */
  function hitAll(checks: LimitCheck[], now = clock()): LimitOutcome[] {
    return db.transaction((): LimitOutcome[] => {
      const evaluated = checks.map((check): LimitOutcome => {
        if (check.max === -1) return { ...check, ok: true, count: 0, retry_after: 0 };
        const current = (countStmt.get(check.bucket, check.subject, windowSince(check.window, now)) as { n: number }).n;
        return { ...check, ok: current < check.max, count: current, retry_after: retryAfterFor(check.window, now) };
      });
      if (evaluated.every(item => item.ok)) {
        for (const item of evaluated) if (item.max !== -1) insertStmt.run(item.bucket, item.subject, now);
      }
      return evaluated;
    }).immediate();
  }

  /** 清掉这个桶里早于 `before` 的行；按桶分开清，不用猜别的桶的窗口有多长。 */
  function prune(bucket: string, before: number): number {
    return pruneStmt.run(bucket, before).changes;
  }

  /**
   * 按 BUCKET_RETENTION_MS 把全部已知桶清一遍（idn274 发现的缺口：prune() 实现了却没有调用点）。
   * 没登记在表里的桶（比如以后新加的）不会被这里清掉，加新桶时记得在 BUCKET_RETENTION_MS 里补一行，
   * 不然只涨不消；没登记不是致命问题，只是那个桶会一直占地方，不会被误删或误留生效中的计数。
   */
  function pruneAll(now: number = clock()): number {
    let deleted = 0;
    for (const [bucket, retentionMs] of Object.entries(BUCKET_RETENTION_MS)) deleted += prune(bucket, now - retentionMs);
    return deleted;
  }

  return { hit, hitAll, count, prune, pruneAll, beijingDayBounds };
}
export type LimitsService = ReturnType<typeof createLimits>;

/**
 * 每个桶的留存时长：比窗口本身多留一截余量（排查用），不是必须精确——这张表每天清一次，桶即使多留几小时
 * 也不会让表无限变大。新加一个桶就在这里补一行，不然它只会一直涨，不会被这个清理任务碰到。
 */
export const BUCKET_RETENTION_MS: Record<string, number> = {
  "apply.daily": 2 * DAY_MS,
  "apply.daily.ip": 2 * DAY_MS,
  "apply.daily.device": 2 * DAY_MS,
  "auth.register.daily.ip": 2 * DAY_MS,
  "auth.register.daily.device": 2 * DAY_MS,
  "account.cli.login.daily": 2 * DAY_MS,
  "invite.redeem.fail.account": 2 * HOUR_MS,
  "invite.redeem.fail.ip": 2 * HOUR_MS,
  "forum.topic.hourly": 2 * HOUR_MS,
  "forum.reply.hourly": 2 * HOUR_MS,
  "forum.reply.ip.hourly": 2 * HOUR_MS,
  "forum.topic.view.dedup": HOUR_MS,
  "read.per_minute": HOUR_MS,
  "search.per_minute": HOUR_MS,
  "public.competition.per_minute": HOUR_MS,
  "competition.prize.lookup.fail": 2 * HOUR_MS,
  // #276：表情回应、上传图片按小时限额；@ 补全按分钟限额；访客翻页按北京日历日限额（day-bj 窗口）。
  "forum.react.hourly": 2 * HOUR_MS,
  "forum.upload.hourly": 2 * HOUR_MS,
  "forum.suggest.per_minute": HOUR_MS,
  // PENTEST-20261029：PoW 证明的一次性去重桶，窗口 10 分钟（POW_NONCE_TTL_MS），多留一截方便排查
  "pow.nonce": HOUR_MS,
  "forum.visitor.pages": 2 * DAY_MS,
  // #285：控制台向测试邮箱试发招聘信，每账号每小时限量。
  "mail.test.hourly": 2 * HOUR_MS,
};
