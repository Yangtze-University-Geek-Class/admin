// 操作记录（SPEC §3.7）：筛选条件 ↔ 地址参数 ↔ 接口参数，以及来源、结果、动作、限流桶的说法。纯函数，tests/console 直接测。
import { beijingDate, dateEdge } from "./competitions";
import type { ActivityEvent, ActivityOutcome, ActivitySurface } from "./types";

export const ACTIVITY_SURFACES: ActivitySurface[] = ["portal", "forum", "console", "cli", "api", "system", "gitlab"];
export const SURFACE_TEXT: Record<ActivitySurface, string> = {
  portal: "官网", forum: "论坛", console: "控制台", cli: "命令行", api: "接口", system: "系统", gitlab: "GitLab",
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

/** 每页条数，和服务端 routes/console/activity.ts 的 PAGE_SIZE 一致（服务端固定，不收 `limit`）。 */
export const ACTIVITY_PAGE_SIZE = 50;

/** 时间只给几个常用范围（#370 简化筛选）：从北京时间某天零点到现在，「全部时间」不限。 */
export const TIME_PRESETS = [
  { value: "", label: "全部时间", days: 0 },
  { value: "today", label: "今天", days: 1 }, { value: "7d", label: "近 7 天", days: 7 }, { value: "30d", label: "近 30 天", days: 30 },
] as const;
export type TimePreset = (typeof TIME_PRESETS)[number]["value"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** 选一个范围 → 写进筛选条件的起止日期（`to` 留空，表示到现在）。 */
export function presetRange(preset: TimePreset, now = Date.now()): Pick<ActivityFilters, "from" | "to"> {
  const days = TIME_PRESETS.find(item => item.value === preset)?.days ?? 0;
  return { from: days ? beijingDate(now - (days - 1) * DAY_MS) : "", to: "" };
}

/** 地址栏里的起止日期对得上哪个范围；对不上（别处带过来的自定义日期）回 null。 */
export function presetOf(filters: Pick<ActivityFilters, "from" | "to">, now = Date.now()): TimePreset | null {
  if (filters.to) return null;
  return TIME_PRESETS.find(item => presetRange(item.value, now).from === filters.from)?.value ?? null;
}

/**
 * 页面上没有输入框、但地址栏里带着的条件（从详情里点「只看这个访客」「只看同类动作」，或别的页面链过来的日期）：
 * 显示成可以关掉的标签，关掉就是把这一项清空。
 */
export function extraFilterTags(filters: ActivityFilters, now = Date.now()): { key: string; text: string; clear: Partial<ActivityFilters> }[] {
  const tags: { key: string; text: string; clear: Partial<ActivityFilters> }[] = [];
  if (filters.visitor) tags.push({ key: "visitor", text: `访客 ${filters.visitor.slice(0, 10)}`, clear: { visitor: "" } });
  if (filters.action) {
    const name = actionText(filters.action);
    tags.push({ key: "action", text: name ? `动作：${name}（${filters.action}）` : `动作：${filters.action}`, clear: { action: "" } });
  }
  if ((filters.from || filters.to) && presetOf(filters, now) === null) {
    const text = filters.from && filters.to ? `${filters.from} 至 ${filters.to}` : filters.from ? `${filters.from} 起` : `${filters.to} 之前`;
    tags.push({ key: "range", text: `日期：${text}`, clear: { from: "", to: "" } });
  }
  return tags;
}

/** 「只看同类动作」用的前缀：去掉最后一段，`forum.topic.view` → `forum.topic.`，`auth.signin` → `auth.`。 */
export function actionFamily(action: string): string {
  const parts = action.split(".");
  return parts.length > 1 ? `${parts.slice(0, -1).join(".")}.` : action;
}

/**
 * GET /api/console/activity（和 activity.csv）的查询串：日期换成北京时间当天的起止毫秒，
 * `from` 取当天 00:00，`to` 取当天 23:59:59.999，所以只选一天时就是那一整天。`page` 从 1 数，换成 `offset`。
 * 参数集合与服务端 `activityQuery` 契约（app/server/src/routes/console/contracts.ts）逐字一致：
 * 它拒绝未知字段，这里不传 `limit`——服务端每页固定 50 条，不读这个参数（之前传了会触发 400，#274）。
 */
export function activityParams(filters: ActivityFilters, extra: { page?: number } = {}): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["account", "visitor", "action", "surface", "outcome"] as const) if (filters[key]) params.set(key, filters[key]);
  const from = filters.from ? dateEdge(filters.from, "start") : null;
  const to = filters.to ? dateEdge(filters.to, "end") : null;
  if (from !== null) params.set("from", String(from));
  if (to !== null) params.set("to", String(to));
  if (extra.page && extra.page > 1) params.set("offset", String((extra.page - 1) * ACTIVITY_PAGE_SIZE));
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
/** GitLab 事件（#370）的动作是 `gitlab.<对象>.<动作>`（lib/gitlab-events.ts）：对象与动作各查一张表，认不出的原样显示。 */
const GITLAB_OBJECT_TEXT: Record<string, string> = {
  issue: "议题", merge_request: "合并请求", note: "评论", push: "代码推送", milestone: "里程碑", project: "项目", snippet: "代码片段", wiki_page_meta: "Wiki 页面",
};
const GITLAB_VERB_TEXT: Record<string, string> = {
  opened: "开启", closed: "关闭", reopened: "重新开启", updated: "修改", accepted: "合并", approved: "批准", commented_on: "发表",
  pushed_to: "推送到已有分支", pushed_new: "推送新分支", deleted: "删除", created: "创建", destroyed: "删除", joined: "加入", left: "离开",
  removed: "移出", expired: "到期", archived: "归档", unarchived: "取消归档", imported: "导入",
};
export function gitlabActionText(action: string): string {
  const [, object = "", verb = ""] = action.split(".");
  const objectText = GITLAB_OBJECT_TEXT[object];
  const verbText = GITLAB_VERB_TEXT[verb];
  if (!objectText && !verbText) return "GitLab";
  return `${objectText ?? object} · ${verbText ?? verb}`;
}

export function actionText(action: string): string {
  if (action.startsWith("gitlab.")) return gitlabActionText(action);
  if (ACTION_TEXT[action]) return ACTION_TEXT[action];
  return ACTION_PREFIX_TEXT.find(([prefix]) => action.startsWith(prefix))?.[1] ?? "";
}

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

/**
 * 这一条记的是谁：账号写显示名，访客写访客编号前 8 位；GitLab 事件没对上账号的写 GitLab 用户名（未关联），都没有是系统。
 * `surface`、`meta` 可不传：只看账号和访客的调用方不用改。
 */
export function actorText(event: Pick<ActivityEvent, "account" | "visitor_id"> & Partial<Pick<ActivityEvent, "surface" | "meta">>): { kind: "account" | "visitor" | "gitlab" | "system"; text: string } {
  if (event.account) return { kind: "account", text: event.account.display_name || event.account.username };
  if (event.visitor_id) return { kind: "visitor", text: `访客 ${event.visitor_id.slice(0, 8)}` };
  if (event.surface === "gitlab") {
    const name = typeof event.meta?.gitlab_username === "string" ? event.meta.gitlab_username : "";
    return { kind: "gitlab", text: name ? `GitLab 用户 ${name}（未关联）` : "GitLab 用户（未关联）" };
  }
  return { kind: "system", text: "系统" };
}

/** 目标：`类型 · 编号`，没有目标回空串。 */
export const targetText = (event: Pick<ActivityEvent, "target_type" | "target_id">): string =>
  event.target_type ? [event.target_type, event.target_id].filter(Boolean).join(" · ") : "";

/** 列表第二行：GitLab 事件写项目、分支和编号，其余写目标。 */
export function eventSubText(event: Pick<ActivityEvent, "surface" | "target_type" | "target_id" | "meta">): string {
  if (event.surface !== "gitlab") return targetText(event);
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return [text(event.meta?.project), text(event.meta?.ref), event.target_id ? `#${event.target_id}` : ""].filter(Boolean).join(" · ");
}
