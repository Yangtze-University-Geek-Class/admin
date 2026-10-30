import type Database from "better-sqlite3";
import type { FastifyRequest } from "fastify";
import type { LimitsService } from "./limits.js";

/** UA 截断到 256 字符：少数客户端会塞超长 UA（有的能到几 KB），没必要整条存（#274 残留修复 F）。 */
const UA_MAX = 256;
function truncateUa(ua: string | null): string | null {
  return ua === null ? null : ua.slice(0, UA_MAX);
}

// req.visitorId（匿名访客编号）由 middleware/visitor.ts 的 attachVisitorId 挂在 portal/forum-api 两个插件作用域上，
// 这里只读，不重复定义一套（两个人各自做过一版，这是收敛成一份之后留下的，见执行记录）。不在这里 import 那个
// 文件：declare module 的类型扩展是全局的，只要它在编译时被别处（routes/portal/index.ts）引入过就对全仓库生效，
// 这里 import 反而会被 check-boundaries.mjs 判「lib 依赖 middleware」。

export type ActivityOutcome = "ok" | "denied" | "limited" | "error";
export type ActivitySurface = "portal" | "forum" | "console" | "cli" | "api" | "system";

/**
 * `POST /api/events` 只收这几种（SPEC §3.7）；不在对应来源白名单里的直接丢弃，合并计一条 `events.rejected`。
 * #274：原来只有门户一份名单，论坛、控制台现在各自上报各自的名单（routes/portal/events.ts 按请求体的
 * `surface` 字段挑对应这份），互不混用；通用的 `page.view`（路由名/路径，不带参数值）三边都能报。
 * `forum.theme.change` 原来挂在门户名单下，但门户从来没真的发过它——这次连同调用点一起搬到论坛（见
 * app/forum/app/composables/useForumTheme.ts），门户名单里去掉。
 */
export const EVENT_WHITELIST = ["os.boot.played", "os.boot.skipped", "os.app.open", "os.note.dismissed", "page.view"] as const;
/** 论坛前端上报（app/forum/app/composables/useActivityBeacon.ts）：路由浏览、换主题、用表情。 */
export const FORUM_EVENT_WHITELIST = ["page.view", "forum.theme.change", "forum.sticker.use"] as const;
/** 控制台前端上报（app/console/src/lib/events.ts）：目前只有路由浏览。 */
export const CONSOLE_EVENT_WHITELIST = ["page.view"] as const;
export type EventsSurface = "portal" | "forum" | "console";
export const EVENT_WHITELIST_BY_SURFACE: Record<EventsSurface, readonly string[]> = {
  portal: EVENT_WHITELIST, forum: FORUM_EVENT_WHITELIST, console: CONSOLE_EVENT_WHITELIST,
};
export type WhitelistedEvent = (typeof EVENT_WHITELIST)[number] | (typeof FORUM_EVENT_WHITELIST)[number] | (typeof CONSOLE_EVENT_WHITELIST)[number];

export type RecordActivityInput = {
  action: string;
  surface: ActivitySurface;
  target_type?: string | null;
  target_id?: string | null;
  outcome?: ActivityOutcome;
  /** 不记密码、验证码、令牌、完整请求体（SPEC §3.7）；调用方自己按这条清单决定放什么，这里不做内容过滤。 */
  meta?: Record<string, unknown>;
  /**
   * 覆盖账号归属，只有登录/注册这一刻才需要：会话是这次请求的处理结果（signInWithGithub 等成功之后才有
   * account_id），`req.session` 要等下一次带着新 cookie 的请求才会被 loadSession() 填上，这次请求本身读
   * 不到。不传就照常按 `req.session?.account_id` 认。
   */
  account_id?: string | null;
};

/**
 * 操作记录唯一写入口（SPEC §3.7：`recordActivity(req, { action, target, outcome, meta })`）：这里把 `target`
 * 拆成 `target_type`/`target_id` 两个参数，和落库 schema（db.ts 的 `activity_events`）、读接口
 * （routes/console/activity.ts）已经在用的形状保持一致，不是削减字段。
 */
export function createActivityRecorder(db: Database.Database, clock: () => number = Date.now) {
  const insert = db.prepare(`
    INSERT INTO activity_events(at, account_id, visitor_id, surface, action, target_type, target_id, outcome, ip, ua, request_id, meta)
    VALUES (@at, @account_id, @visitor_id, @surface, @action, @target_type, @target_id, @outcome, @ip, @ua, @request_id, @meta)
  `);
  // 同一主体（账号，没账号时按访客编号，连访客编号都没有——console/identity/oidc 这类没挂 attachVisitorId
  // 的路由——按 IP）、同一 action、同一结果、同一请求形状（方法、路由模板、状态码，#333）、同一分钟内，拒绝/限流只留
  // 一行，count 往上加，不是 403/429 刷屏就一条一条插（#274 残留修复 F，blocker 相邻项）。IFNULL 比较让 NULL 和 NULL 算相等。
  const findDenialBucket = db.prepare(`
    SELECT id, meta FROM activity_events
    WHERE action = @action AND outcome = @outcome
      AND IFNULL(account_id,'') = IFNULL(@account_id,'')
      AND IFNULL(visitor_id,'') = IFNULL(@visitor_id,'')
      AND IFNULL(ip,'') = IFNULL(@ip,'')
      AND at >= @bucket_start
      AND json_extract(meta, '$.method') IS @method
      AND json_extract(meta, '$.route') IS @route
      AND json_extract(meta, '$.status') IS @status
    ORDER BY id DESC LIMIT 1
  `);
  const bumpDenialCount = db.prepare("UPDATE activity_events SET meta = @meta WHERE id = @id");

  function subjectOf(req: FastifyRequest, input: RecordActivityInput): { accountId: string | null; visitorId: string | null } {
    const accountId = input.account_id !== undefined ? input.account_id : req.session?.account_id ?? null;
    // 登录的人不重复记访客编号：一个人同时有账号和访客 cookie 时，操作记录按账号认，不要两边都算一次活跃访客。
    return { accountId, visitorId: accountId ? null : req.visitorId ?? null };
  }

  /**
   * #277：这次请求是 middleware/bearer-auth.ts 用 geek 命令行的令牌挂上的身份，一律记成 `surface: "cli"`——
   * 不管调用点自己传了 "forum"/"portal" 哪个值。调用点不用为了命令行各自改一遍，控制台的操作记录照样能
   * 按 surface 筛出「这条是命令行发的」。
   */
  function surfaceOf(req: FastifyRequest, surface: ActivitySurface): ActivitySurface {
    return req.via === "cli" ? "cli" : surface;
  }

  function recordActivity(req: FastifyRequest, input: RecordActivityInput): void {
    const { accountId, visitorId } = subjectOf(req, input);
    insert.run({
      at: clock(),
      account_id: accountId,
      visitor_id: visitorId,
      surface: surfaceOf(req, input.surface),
      action: input.action,
      target_type: input.target_type ?? null,
      target_id: input.target_id ?? null,
      outcome: input.outcome ?? "ok",
      ip: req.ip ?? null,
      ua: truncateUa((req.headers["user-agent"] as string | undefined) ?? null),
      request_id: String(req.id),
      meta: JSON.stringify(input.meta ?? {}),
    });
  }

  /**
   * 403/429 专用：见上面 findDenialBucket 的注释。只用于 middleware/http-policy.ts 的 recordDenialOrLimit。
   * `request` 是方法、匹配到的路由模板（没匹配到为 null）与状态码，写进 meta 并参与合并；不收原始路径与查询串。
   */
  function recordDenial(req: FastifyRequest, input: RecordActivityInput, request: { method: string; route: string | null; status: number }): void {
    const now = clock();
    const { accountId, visitorId } = subjectOf(req, input);
    const ip = req.ip ?? null;
    const outcome = input.outcome ?? "denied";
    const bucketStart = Math.floor(now / 60_000) * 60_000;
    const existing = findDenialBucket.get({
      action: input.action, outcome, account_id: accountId, visitor_id: visitorId, ip, bucket_start: bucketStart,
      method: request.method, route: request.route, status: request.status,
    }) as { id: number; meta: string } | undefined;
    if (existing) {
      const meta = JSON.parse(existing.meta || "{}") as Record<string, unknown>;
      const count = typeof meta.count === "number" && Number.isFinite(meta.count) ? meta.count : 1;
      meta.count = count + 1;
      bumpDenialCount.run({ meta: JSON.stringify(meta), id: existing.id });
      return;
    }
    insert.run({
      at: now,
      account_id: accountId,
      visitor_id: visitorId,
      surface: surfaceOf(req, input.surface),
      action: input.action,
      target_type: input.target_type ?? null,
      target_id: input.target_id ?? null,
      outcome,
      ip,
      ua: truncateUa((req.headers["user-agent"] as string | undefined) ?? null),
      request_id: String(req.id),
      meta: JSON.stringify({ ...(input.meta ?? {}), ...request, count: 1 }),
    });
  }

  /** 保留 180 天、每天清理一次（SPEC §3.7）；IP 原样存但只保留 90 天，90 天以上的记录只打码不删行（还要留着给统计用）。 */
  function pruneExpired(now: number = clock()): { deleted: number; ipMasked: number } {
    const deleted = db.prepare("DELETE FROM activity_events WHERE at < ?").run(now - RETENTION_MS).changes;
    const ipMasked = db.prepare("UPDATE activity_events SET ip = NULL WHERE ip IS NOT NULL AND at < ?").run(now - IP_RETENTION_MS).changes;
    return { deleted, ipMasked };
  }

  return { recordActivity, recordDenial, pruneExpired };
}
export type ActivityRecorder = ReturnType<typeof createActivityRecorder>;

/** 记录保留 180 天；IP 单独只保留 90 天（SPEC §3.7）。 */
export const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
export const IP_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
/** 清理间隔：每天一次，和 lib/auth.ts 的会话清理用同一种「启动清一次 + 定时器」模式。 */
export const ACTIVITY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type ActivityCleanupLogger = { info(details: Record<string, unknown>, message: string): void; error(details: Record<string, unknown>, message: string): void };

/**
 * `limits` 可选：既有调用方（测试里只传 recorder）不用跟着改；真正启动服务时 app.ts 会传，顺带把
 * lib/limits.ts 的 `limit_events` 也清一遍（idn274 发现的缺口：`prune()` 实现了却没有调用点，和
 * 操作记录共用同一个「启动清一次 + 每天一次」定时器，不用另起一个）。
 */
export function startActivityCleanup(recorder: ActivityRecorder, logger: ActivityCleanupLogger, limits?: LimitsService, more: { label: string; prune: () => number }[] = []): () => void {
  const run = () => {
    try {
      const { deleted, ipMasked } = recorder.pruneExpired();
      if (deleted > 0 || ipMasked > 0) logger.info({ deleted, ipMasked }, "activity events pruned");
    } catch (error) {
      logger.error({ error: (error as Error)?.name ?? "error", code: (error as { code?: unknown })?.code }, "activity cleanup failed");
    }
    try {
      const deleted = limits?.pruneAll() ?? 0;
      if (deleted > 0) logger.info({ deleted }, "limit events pruned");
    } catch (error) {
      logger.error({ error: (error as Error)?.name ?? "error", code: (error as { code?: unknown })?.code }, "limit events cleanup failed");
    }
    for (const { label, prune } of more) {
      try {
        const deleted = prune();
        if (deleted > 0) logger.info({ deleted }, `${label} pruned`);
      } catch (error) {
        logger.error({ error: (error as Error)?.name ?? "error", code: (error as { code?: unknown })?.code }, `${label} cleanup failed`);
      }
    }
  };
  run();
  const timer = setInterval(run, ACTIVITY_CLEANUP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
