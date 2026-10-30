// 操作记录（SPEC §3.7）：筛选条件 ↔ 地址参数 ↔ 接口参数，以及来源、结果、动作、限流桶的说法。纯函数，tests/console 直接测。
import { dateEdge } from "./competitions";
import type { ActivityEvent, ActivityOutcome, ActivitySurface } from "./types";

export const ACTIVITY_SURFACES: ActivitySurface[] = ["portal", "forum", "console", "cli", "api", "system"];
export const SURFACE_TEXT: Record<ActivitySurface, string> = {
  portal: "官网", forum: "论坛", console: "控制台", cli: "命令行", api: "接口", system: "系统",
};
export const ACTIVITY_OUTCOMES: ActivityOutcome[] = ["ok", "denied", "limited", "error"];
export const OUTCOME_TEXT: Record<ActivityOutcome, string> = { ok: "成功", denied: "拒绝", limited: "限流", error: "出错" };
/** TxStatusBadge 的色调。 */
export const OUTCOME_STATUS: Record<ActivityOutcome, "success" | "danger" | "warning" | "muted"> = {
  ok: "success", denied: "danger", limited: "warning", error: "danger",
};
export const surfaceText = (surface: string): string => SURFACE_TEXT[surface as ActivitySurface] ?? surface;
export const outcomeText = (outcome: string): string => OUTCOME_TEXT[outcome as ActivityOutcome] ?? outcome;

/** 页面上的筛选条件；日期是北京时间的 YYYY-MM-DD，都可以为空。 */
export type ActivityFilters = {
  account: string; visitor: string; action: string; surface: string; outcome: string; from: string; to: string;
};
export const EMPTY_FILTERS: ActivityFilters = { account: "", visitor: "", action: "", surface: "", outcome: "", from: "", to: "" };
const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof ActivityFilters)[];

/** 从地址参数读筛选条件：不认识的来源、结果和格式不对的日期当作没填。 */
export function filtersFromQuery(query: Record<string, unknown>): ActivityFilters {
  const pick = (key: string) => (typeof query[key] === "string" ? (query[key] as string).trim() : "");
  const filters: ActivityFilters = { ...EMPTY_FILTERS };
  for (const key of FILTER_KEYS) filters[key] = pick(key);
  if (!(ACTIVITY_SURFACES as string[]).includes(filters.surface)) filters.surface = "";
  if (!(ACTIVITY_OUTCOMES as string[]).includes(filters.outcome)) filters.outcome = "";
  if (dateEdge(filters.from, "start") === null) filters.from = "";
  if (dateEdge(filters.to, "end") === null) filters.to = "";
  return filters;
}

/** 写回地址栏的参数：空的不写。 */
export function filtersToQuery(filters: ActivityFilters): Record<string, string> {
  const query: Record<string, string> = {};
  for (const key of FILTER_KEYS) if (filters[key].trim()) query[key] = filters[key].trim();
  return query;
}

/** 起止日期颠倒时的提示；没问题回 null。 */
export function rangeProblem(filters: Pick<ActivityFilters, "from" | "to">): string | null {
  return filters.from && filters.to && filters.from > filters.to ? "开始日期晚于结束日期" : null;
}

/**
 * GET /api/console/activity（和 activity.csv）的查询串：日期换成北京时间当天的起止毫秒，
 * `from` 取当天 00:00，`to` 取当天 23:59:59.999，所以只选一天时就是那一整天。
 * 参数集合与服务端 `activityQuery` 契约（app/server/src/routes/console/contracts.ts）逐字一致：
 * 它拒绝未知字段，这里不传 `limit`——服务端每页固定 50 条，不读这个参数（之前传了会触发 400，#274）。
 */
export function activityParams(filters: ActivityFilters, extra: { cursor?: string | null } = {}): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["account", "visitor", "action", "surface", "outcome"] as const) if (filters[key]) params.set(key, filters[key]);
  const from = filters.from ? dateEdge(filters.from, "start") : null;
  const to = filters.to ? dateEdge(filters.to, "end") : null;
  if (from !== null) params.set("from", String(from));
  if (to !== null) params.set("to", String(to));
  if (extra.cursor) params.set("cursor", extra.cursor);
  return params;
}

/** 常见动作的中文名：先按完整动作找，再按前缀找；都没有回空串，页面只显示动作本身。 */
const ACTION_TEXT: Record<string, string> = {
  "auth.signin": "登录", "auth.signout": "退出登录", "auth.register": "注册", "auth.signin_denied": "登录被拒",
  "auth.password_reset": "重设密码", "auth.credentials_revoked": "改密码后吊销了登录凭据", "auth.link": "绑定登录方式", "auth.unlink": "解绑登录方式",
  "invite.redeem": "兑换邀请码", "apply.submit": "投递简历", "apply.review": "处理投递", "apply.export": "导出投递",
  "forum.topic.view": "看帖", "forum.topic.create": "发帖", "forum.reply.create": "回帖", "forum.react": "表情回应", "forum.search": "论坛搜索",
  "forum.sticker.use": "使用表情",
  "os.boot.played": "看完开机动画", "os.boot.skipped": "跳过开机动画", "os.app.open": "打开桌面应用", "os.note.dismissed": "收起新生便签",
  "forum.theme.change": "换论坛主题", "page.view": "打开页面", "events.rejected": "上报被丢弃",
  "system.backup.export": "导出系统备份",
  "security.decoy.hit": "命中合成蜜罐", "security.decoy.update": "调整合成蜜罐",
  "security.block": "自动封禁", "security.blocks.view": "查看封禁", "security.block.clear": "解除封禁",
  "application.settings.update": "开放或关闭招新", "http.apply_closed": "投递被拒（招新已关闭）",
  "mail.template.create": "新建邮件模板", "mail.template.update": "修改邮件模板", "mail.template.delete": "删除邮件模板",
  "mail.template.preview": "预览投递人的邮件", "mail.template.test_send": "发测试邮件",
};
const ACTION_PREFIX_TEXT: [string, string][] = [
  ["auth.", "登录与账号"], ["perm.", "权限"], ["users.", "用户管理"], ["profile.", "个人资料"], ["gitlab.", "GitLab"],
  ["competition.", "比赛"], ["invite.", "邀请码"], ["apply.", "投递"], ["forum.", "论坛"], ["activity.", "操作记录"],
  ["feedback.", "意见箱"], ["os.", "官网桌面"], ["cli.", "命令行"], ["system.", "系统"], ["mail.", "邮件"],
];
export function actionText(action: string): string {
  if (ACTION_TEXT[action]) return ACTION_TEXT[action];
  return ACTION_PREFIX_TEXT.find(([prefix]) => action.startsWith(prefix))?.[1] ?? "";
}

/** 动作前缀的快捷选项：页面上给几个常用的，其余手填。 */
export const ACTION_PREFIXES = [
  { value: "auth.", label: "登录与账号" }, { value: "apply.", label: "投递" }, { value: "forum.", label: "论坛" },
  { value: "perm.", label: "权限" }, { value: "users.", label: "用户管理" }, { value: "gitlab.", label: "GitLab" },
];

/** 今天被拦下的限流桶：认识的写中文，不认识的原样显示桶名。 */
const BUCKET_TEXT: Record<string, string> = {
  "apply.daily": "每天投递份数", "events.rejected": "上报被丢弃",
  "mail.test.hourly": "每小时测试邮件（每个账号）", "mail.test.site": "每小时测试邮件（全站）",
};
const BUCKET_PREFIX_TEXT: [string, string][] = [
  ["apply.", "投递"], ["register", "注册"], ["email", "发验证码"], ["forum.", "论坛"], ["invite", "兑换邀请码"],
  ["cli", "命令行"], ["read", "论坛读取"], ["search", "论坛搜索"], ["events", "前端上报"], ["auth", "登录"],
];
export function bucketText(bucket: string): string {
  return BUCKET_TEXT[bucket] ?? BUCKET_PREFIX_TEXT.find(([prefix]) => bucket.startsWith(prefix))?.[1] ?? "";
}

/** 这一条记的是谁：账号写显示名，访客写访客编号前 8 位，都没有是系统。 */
export function actorText(event: Pick<ActivityEvent, "account" | "visitor_id">): { kind: "account" | "visitor" | "system"; text: string } {
  if (event.account) return { kind: "account", text: event.account.display_name || event.account.username };
  if (event.visitor_id) return { kind: "visitor", text: `访客 ${event.visitor_id.slice(0, 8)}` };
  return { kind: "system", text: "系统" };
}

/** 目标：`类型 · 编号`，没有目标回空串。 */
export const targetText = (event: Pick<ActivityEvent, "target_type" | "target_id">): string =>
  event.target_type ? [event.target_type, event.target_id].filter(Boolean).join(" · ") : "";
