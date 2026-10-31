// 开发预览：`/api/console/*` 与 `/api/public/departments` 的只读样板数据（全部虚构）。
// 只在 DEV 且数据源为 mock 时由 lib/http.ts 动态导入；生产构建里这段导入被删掉，不进产物。
// 组、条目和求值照 SPEC §3.3–§3.5 做了一份简化版：通配会展开、拒绝优先、meta 取权重最高的组；
// 范围只认 department 一个键（部长的「查看用户」「查看操作记录」只看到本部门的人），其余键不判断。
import { ApiError } from "../lib/http";
import { NODE_LABELS, PERMISSION_DOMAINS, nodeDomain } from "../lib/permission-nodes";
import { MOCK_MAIL_LIST, MOCK_MAIL_TEMPLATES, mockLetterPreview, mockLetterTemplates, mockMailPreview } from "./mail-templates";
import type {
  ActivityEvent, ActivityList, ApplySettings, Candidate, CompetitionRules, ConsoleMe, ConsoleStickerPack, ConsoleUser, Core, DepartmentRef, EffectivePermissions, ForumCategoryRow, GitlabAccount, GitlabAccountsResponse, GitlabProjectsResponse, Grade,
  GitlabSettings, GitlabStatus, InviteCode, Level, PermissionEntry, PermissionExplain, PermissionExplainHit, PermissionGroup, PermissionGroupMember,
  FinalView, Importance, PermissionNodesResponse, PublicDepartment, RosterSignup, RosterStats, RosterTeam, ScoreEvent, ScorePreview, Scoring, SessionProvider, SignupSettings, SiteRole, SiteState, Summary,
  UserPatch, UsersResponse,
} from "../lib/types";

const now = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const beijingDayEnd = (at: number) => Math.floor((at + 8 * HOUR) / DAY) * DAY + DAY - 8 * HOUR - 1;
const beijingDayStart = (at: number) => Math.floor((at + 8 * HOUR) / DAY) * DAY - 8 * HOUR;

/** 投递状态（服务端 APPLICATION_STATUSES），测试核对。 */
export const MOCK_APPLICATION_STATUSES = [
  { id: "received", label: "已收到" }, { id: "interview", label: "待面试" }, { id: "accepted", label: "已录取" }, { id: "rejected", label: "未通过" },
  { id: "cancelled", label: "已取消" },
];
const STATUSES = MOCK_APPLICATION_STATUSES;

// ---- 部门与称号（SPEC §3.4）----

const deptTitles = (slug: string, headWeight = 60) => [
  { id: `title.${slug}.head`, name: "部长", weight: headWeight },
  { id: `title.${slug}.deputy`, name: "副部长", weight: 50 },
  { id: `title.${slug}.staff`, name: "部员", weight: 40 },
];
// 图标值照服务端迁移种子（app/server/src/lib/migrations/2026-10-yugc-v2.ts:59-82）：是 Remix 图标名，
// 不是控制台目前唯一支持渲染的 i-carbon-*；这个字段现在没有页面拿它画图标，只是和服务端对齐数据。
export const MOCK_DEPARTMENTS: PublicDepartment[] = [
  { id: "dept.ai", name: "AI部门", tone: "y", icon: "robot-2-line", description: "AI 方向的项目与培训", titles: deptTitles("ai") },
  { id: "dept.algo", name: "算法部门", tone: "u", icon: "code-s-slash-line", description: "算法竞赛与刷题训练", titles: deptTitles("algo") },
  { id: "dept.hardware", name: "硬件部门", tone: "c", icon: "cpu-line", description: "硬件与嵌入式项目", titles: deptTitles("hardware") },
  { id: "dept.security", name: "网安部门", tone: "g", icon: "shield-keyhole-line", description: "网络安全方向的培训与比赛", titles: deptTitles("security") },
  { id: "dept.management", name: "管理部门", tone: "pill", icon: "government-line", description: "班级日常管理与控制台运维", titles: deptTitles("management", 80) },
  { id: "dept.none", name: "无部门", tone: "ink", icon: "user-line", description: "还没分部门的人", titles: [] },
];
const REAL_DEPARTMENT_IDS = MOCK_DEPARTMENTS.filter(item => item.id !== "dept.none").map(item => item.id);
const deptRef = (id: string): DepartmentRef => {
  const d = MOCK_DEPARTMENTS.find(item => item.id === id)!;
  return { id: d.id, name: d.name, tone: d.tone };
};
const SITE_OWNER = { id: "title.site.owner", name: "站长", department_id: null } as const;
const titleRef = (id: string) => {
  if (id === SITE_OWNER.id) return { ...SITE_OWNER };
  const department = MOCK_DEPARTMENTS.find(d => d.titles.some(t => t.id === id))!;
  return { id, name: department.titles.find(t => t.id === id)!.name, department_id: department.id };
};

// ---- 权限节点（SPEC §3.3）----

export const ALL_NODES = Object.keys(NODE_LABELS);
const NODE_DESCRIPTIONS: Record<string, string> = {
  "console.access": "能打开控制台。没有它，其他控制台权限也用不上。",
  "users.view": "看「用户」名单和每个人的详情。",
  "users.manage": "改别人的身份、部门和称号。",
  "users.disable": "停用或重新启用账号；停用后马上退出所有设备。",
  "perm.view": "看组、条目、成员和求值解释。",
  "perm.manage": "改组的条目、继承和成员，新建或删除自定义组。",
  "activity.read": "看操作记录。IP 只显示前两段。",
  "activity.read.ip": "在操作记录里看完整 IP。",
  "activity.export": "把操作记录导出成 CSV。",
  "dept.manage": "管理本部门的人和部门资料。",
  "gitlab.sync": "让某个账号立即重新同步到 GitLab。",
  "gitlab.settings": "改同步模式、群组路径和同步间隔。",
  "forum.moderate.delete": "删除别人的帖子和回复。",
  "system.backup": "下载整个系统的数据库快照与站点文件打包。",
  "apply.settings": "开放或关闭招新；关闭后官网显示关闭页，新的投递被拒绝，已收到的投递照常处理。",
  "mail.template.manage": "新建、编辑、停用招聘邮件的模板，预览，并向自己填的测试邮箱试发样信。",
};
export const MOCK_NODES: PermissionNodesResponse = {
  nodes: ALL_NODES.map(node => ({
    node, domain: nodeDomain(node), label: NODE_LABELS[node],
    description: NODE_DESCRIPTIONS[node] ?? (node.startsWith("meta.") ? "取值是次数，-1 表示不限。" : ""), meta: node.startsWith("meta."),
  })),
  domains: PERMISSION_DOMAINS,
};

// ---- 组（SPEC §3.4）----

let entrySeq = 1;
type EntryInit = { node: string; value?: boolean; meta?: string; scope?: Record<string, unknown>; expires_at?: number | null };
const entry = ({ node, value = true, meta, scope = {}, expires_at = null }: EntryInit): PermissionEntry => ({
  id: entrySeq++, node, value: meta === undefined ? value : null, meta_value: meta ?? null, scope, expires_at,
});
const allow = (node: string, scope: Record<string, unknown> = {}) => entry({ node, scope });
type GroupInit = Omit<PermissionGroup, "member_count" | "icon" | "tone" | "sort" | "system" | "description" | "department_id" | "parents"> &
  Partial<Pick<PermissionGroup, "icon" | "tone" | "sort" | "system" | "description" | "department_id" | "parents">>;
const group = (init: GroupInit): PermissionGroup => ({
  icon: "user", tone: "ink", sort: 0, system: true, description: "", department_id: null, parents: [], member_count: 0, ...init,
});

function titleGroups(deptId: string): PermissionGroup[] {
  const slug = deptId.replace("dept.", "");
  const own = { department: [deptId] };
  const head = deptId === "dept.management"
    ? ["console.access", "users.*", "perm.view", "activity.*", "gitlab.*", "competition.*", "invite.manage"].map(node => allow(node))
    : [
      allow("console.access"),
      ...["users.view", "apply.view", "apply.review", "activity.read", "dept.manage"].map(node => allow(node, own)),
    ];
  return [
    group({ id: `title.${slug}.head`, kind: "title", name: "部长", description: "负责部门事务", weight: deptId === "dept.management" ? 80 : 60, department_id: deptId, sort: 1, parents: [deptId], entries: head }),
    group({ id: `title.${slug}.deputy`, kind: "title", name: "副部长", description: "协助部长", weight: 50, department_id: deptId, sort: 2, parents: [deptId], entries: [] }),
    group({ id: `title.${slug}.staff`, kind: "title", name: "部员", description: "部门成员", weight: 40, department_id: deptId, sort: 3, parents: [deptId], entries: [] }),
  ];
}

export const MOCK_GROUPS: PermissionGroup[] = [
  group({
    id: "level.visitor", kind: "level", name: "访客", description: "没有登录的人", weight: 0, sort: 1,
    entries: [allow("forum.read.public"), entry({ node: "meta.limit.read.per_minute", meta: "60" }), entry({ node: "meta.limit.search.per_minute", meta: "10" })],
  }),
  group({
    id: "level.registered", kind: "level", name: "注册用户", description: "注册了极客班账号、还没成为成员的人", weight: 10, sort: 2, parents: ["level.visitor"],
    entries: [
      allow("forum.read.registered"), allow("apply.submit"), allow("account.*"),
      entry({ node: "meta.limit.apply.daily", meta: "3" }), entry({ node: "meta.limit.read.per_minute", meta: "120" }), entry({ node: "meta.limit.search.per_minute", meta: "20" }),
    ],
  }),
  group({
    id: "level.member", kind: "level", name: "极客班成员", description: "注册时填了邀请码，或者后来兑换了邀请码", weight: 20, sort: 3, parents: ["level.registered"],
    entries: [
      ...["forum.read.member", "forum.topic.create", "forum.reply.create", "forum.react", "forum.sticker.use", "forum.upload.image", "competition.signup", "competition.team"].map(node => allow(node)),
      ...([["apply.daily", "-1"], ["read.per_minute", "300"], ["search.per_minute", "60"], ["forum.topic.hourly", "20"], ["forum.reply.hourly", "60"], ["forum.react.hourly", "300"], ["forum.upload.hourly", "60"]] as const)
        .map(([node, meta]) => entry({ node: `meta.limit.${node}`, meta })),
    ],
  }),
  group({ id: "level.alumni", kind: "level", name: "往届成员", description: "已经毕业的学长学姐", weight: 15, sort: 4, parents: ["level.registered"], entries: [allow("forum.read.member")] }),
  group({ id: "dept.none", kind: "department", name: "无部门", description: "账号没分部门时隐含属于它", weight: 30, sort: 6, entries: [] }),
  ...REAL_DEPARTMENT_IDS.map((id, index): PermissionGroup => {
    const def = MOCK_DEPARTMENTS.find(d => d.id === id)!;
    return group({
      id, kind: "department", name: def.name, description: def.description, weight: 30, department_id: null, icon: def.icon, tone: def.tone, sort: index + 1,
      entries: [allow("forum.moderate.*", { category: [id.replace("dept.", "")] })],
    });
  }),
  ...REAL_DEPARTMENT_IDS.flatMap(titleGroups),
  group({ id: "title.site.owner", kind: "title", name: "站长", description: "拥有全部权限。系统里最后一位站长不能被降级或停用", weight: 100, tone: "pill", sort: 0, entries: [allow("*")] }),
  group({
    id: "custom.event_staff", kind: "custom", name: "活动志愿者", description: "秋季黑客松期间帮忙管理比赛和报名", weight: 25, system: false,
    entries: [allow("console.access"), allow("competition.manage"), entry({ node: "meta.limit.forum.topic.hourly", meta: "40", expires_at: beijingDayEnd(now + 30 * DAY) })],
  }),
  group({
    id: "custom.muted", kind: "custom", name: "暂停发帖", description: "违反社区规则后暂停发帖和回帖", weight: 90, system: false,
    entries: [entry({ node: "forum.topic.create", value: false, expires_at: beijingDayEnd(now + 7 * DAY) }), entry({ node: "forum.reply.create", value: false, expires_at: beijingDayEnd(now + 7 * DAY) })],
  }),
];
const groupById = (id: string) => MOCK_GROUPS.find(g => g.id === id);

// ---- 用户 ----

type UserInit = {
  username: string; display_name: string; level: Exclude<Level, "visitor">; department?: string; titles?: string[];
  providers?: SessionProvider[]; gitlab?: ConsoleUser["gitlab"]; last_login?: number | null; created?: number; disabled?: boolean;
  /** 真实姓名和年级（#280）：不写时姓名用昵称、年级是大二；写 null 是还没填 */
  real_name?: string | null; grade?: Grade | null;
};
const GRADE_TEXT: Record<Grade, string> = { 1: "大一", 2: "大二", 3: "大三", 4: "大四", graduated: "已毕业" };
let gitlabSeq = 2;
const user = (init: UserInit): ConsoleUser => ({
  account_id: `mock-${init.username}`, username: init.username, display_name: init.display_name, avatar_url: null,
  real_name: init.real_name === undefined ? init.display_name : init.real_name,
  grade: init.grade === undefined ? 2 : init.grade, grade_label: (init.grade === undefined ? GRADE_TEXT[2] : init.grade === null ? null : GRADE_TEXT[init.grade]),
  status: init.disabled ? "disabled" : "active", level: init.level, department: init.department ? deptRef(init.department) : null,
  titles: (init.titles ?? []).map(titleRef), providers: init.providers ?? ["email"],
  gitlab: init.gitlab ?? (init.level === "member" ? { state: "synced", gitlab_user_id: gitlabSeq++ } : { state: "none", gitlab_user_id: null }),
  last_login_at: init.last_login === undefined ? now - 3 * DAY : init.last_login, created_at: init.created ?? now - 120 * DAY,
});

/** 「用户」页名单：各身份、各部门、几种 GitLab 状态、停用、昵称很长、从没登录过的都有。 */
export const MOCK_USERS: ConsoleUser[] = [
  user({ username: "xu_yan", display_name: "徐言", grade: 4, level: "member", titles: [SITE_OWNER.id], providers: ["github", "email"], last_login: now - 10 * MIN, created: now - 300 * DAY }),
  user({ username: "chen_hang", display_name: "陈航", grade: 3, level: "member", department: "dept.management", titles: ["title.management.head"], providers: ["github", "email"], last_login: now - 2 * HOUR, created: now - 260 * DAY }),
  user({ username: "li_xiaoman", display_name: "李晓曼", level: "member", department: "dept.ai", titles: ["title.ai.head"], providers: ["github", "email"], last_login: now - 5 * HOUR, created: now - 240 * DAY }),
  user({ username: "wang_zhe", display_name: "王哲", level: "member", department: "dept.algo", titles: ["title.algo.head"], last_login: now - DAY, created: now - 230 * DAY }),
  user({ username: "sun_qiao", display_name: "孙乔", level: "member", department: "dept.security", titles: ["title.security.head"], last_login: now - 3 * DAY, created: now - 220 * DAY }),
  user({ username: "zhao_yi", display_name: "赵毅", level: "member", department: "dept.hardware", titles: ["title.hardware.head"], last_login: now - 4 * DAY, created: now - 210 * DAY }),
  user({ username: "qin_lan", display_name: "秦岚", level: "member", department: "dept.ai", titles: ["title.ai.deputy"], providers: ["google"], last_login: now - 6 * HOUR, created: now - 90 * DAY }),
  user({ username: "he_miao", display_name: "何苗", level: "member", department: "dept.ai", titles: ["title.ai.staff"], providers: ["github", "email"], last_login: now - 12 * HOUR, created: now - 40 * DAY }),
  user({ username: "fang_lin", display_name: "方林", level: "member", department: "dept.ai", titles: ["title.ai.staff"], gitlab: { state: "failed", gitlab_user_id: 31 }, last_login: now - 8 * DAY, created: now - 30 * DAY }),
  user({ username: "tang_yu", display_name: "唐宇", level: "member", department: "dept.security", titles: ["title.security.staff"], gitlab: { state: "failed", gitlab_user_id: null }, last_login: now - 10 * DAY, created: now - 10 * DAY }),
  user({ username: "lu_mingyuan", display_name: "陆明远（大二·嵌入式方向·常驻实验室 302）", real_name: "陆明远", level: "member", department: "dept.hardware", titles: ["title.hardware.staff"], providers: ["google", "email"], last_login: now - 2 * DAY, created: now - 50 * DAY }),
  user({ username: "liu_xing", display_name: "刘星", level: "member", providers: ["github", "email"], last_login: now - 9 * HOUR, created: now - 9 * DAY }),
  user({ username: "bai_shuo", display_name: "白硕", level: "member", gitlab: { state: "blocked", gitlab_user_id: 33 }, last_login: now - 3 * DAY, created: now - 60 * DAY }),
  user({ username: "yz_k3m9q2xa", display_name: "新同学", real_name: null, grade: null, level: "member", gitlab: { state: "pending", gitlab_user_id: null }, last_login: now - 4 * HOUR, created: now - 4 * HOUR }),
  user({ username: "gao_yuan", display_name: "高远", grade: "graduated", level: "alumni", providers: ["github"], last_login: now - 30 * DAY, created: now - 300 * DAY }),
  user({ username: "zhou_zihan", display_name: "周子涵", grade: 1, level: "registered", last_login: now - 25 * MIN, created: now - 2 * HOUR }),
  user({ username: "wu_yifan", display_name: "吴一凡", grade: 1, level: "registered", providers: ["google"], last_login: null, created: now - 30 * MIN }),
  user({ username: "mo_chen", display_name: "莫辰", level: "registered", providers: ["github"], gitlab: { state: "blocked", gitlab_user_id: 34 }, last_login: now - 60 * DAY, created: now - 200 * DAY, disabled: true }),
];
const userById = (id: string) => MOCK_USERS.find(u => u.account_id === id);
const userByName = (username: string) => MOCK_USERS.find(u => u.username === username);

/** 自定义组的成员（身份、部门、称号组的成员由账号本身决定）。 */
const CUSTOM_MEMBERS: Record<string, { username: string; expires_at: number | null; granted_by: string; created_at: number }[]> = {
  "custom.event_staff": [
    { username: "he_miao", expires_at: beijingDayEnd(now + 30 * DAY), granted_by: "mock-chen_hang", created_at: now - 2 * DAY },
    { username: "qin_lan", expires_at: null, granted_by: "mock-chen_hang", created_at: now - 2 * DAY },
  ],
  "custom.muted": [{ username: "bai_shuo", expires_at: beijingDayEnd(now + 7 * DAY), granted_by: "mock-xu_yan", created_at: now - DAY }],
};

/** 这个账号直接所在的组：身份、部门（没有就是无部门）、称号、自定义组。 */
function directGroups(account: ConsoleUser): string[] {
  const custom = Object.entries(CUSTOM_MEMBERS).filter(([, list]) => list.some(m => m.username === account.username)).map(([id]) => id);
  return [`level.${account.level}`, account.department?.id ?? "dept.none", ...account.titles.map(t => t.id), ...custom];
}
/** 所在的组加上递归继承到的组；`via` 是从直接所在的组一路走到这个组经过的组。 */
function groupChain(account: ConsoleUser): { id: string; via: string[] }[] {
  const seen = new Map<string, string[]>();
  const queue = directGroups(account).map(id => ({ id, via: [] as string[] }));
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next.id)) continue;
    seen.set(next.id, next.via);
    for (const parent of groupById(next.id)?.parents ?? []) queue.push({ id: parent, via: [...next.via, next.id] });
  }
  return [...seen.entries()].map(([id, via]) => ({ id, via }));
}
const matches = (pattern: string, node: string) => pattern === "*" || pattern === node || (pattern.endsWith(".*") && node.startsWith(pattern.slice(0, -1)));
const unexpired = (at: number | null) => at === null || at > now;
/** 账号自己的条目（source: "account"）：刘星临时帮忙置顶「通知」分类的话题。 */
const ACCOUNT_ENTRIES: Record<string, PermissionEntry[]> = {
  "mock-liu_xing": [entry({ node: "forum.moderate.pin", scope: { category: ["notice"] }, expires_at: beijingDayEnd(now + 14 * DAY) })],
};
/** 同权重时取更宽松的值：-1 不限最宽，其余数字越大越宽。 */
const looser = (a: string, b: string) => (a === "-1" || (b !== "-1" && Number(a) >= Number(b)) ? a : b);

/**
 * 求值（SPEC §3.5 的简化版）：命中里有拒绝就是拒绝，否则有允许就是允许；过期的条目不算。
 * meta 取值：账号自己有就用账号的，否则取权重最高的组，同权重取更宽松的。
 */
function evaluate(account: ConsoleUser, node: string): PermissionExplain {
  const hits: PermissionExplainHit[] = [];
  const pick = ({ node: pattern, value, scope, expires_at }: PermissionEntry) => ({ node: pattern, value, scope, expires_at });
  let meta: { value: string; weight: number } | null = null;
  for (const item of ACCOUNT_ENTRIES[account.account_id] ?? []) {
    if (!matches(item.node, node) || !unexpired(item.expires_at)) continue;
    hits.push({ source: "account", group: null, via: [], entry: pick(item) });
    if (item.meta_value !== null) meta = { value: item.meta_value, weight: Infinity };
  }
  for (const { id, via } of groupChain(account)) {
    const g = groupById(id)!;
    for (const item of g.entries) {
      if (!matches(item.node, node) || !unexpired(item.expires_at)) continue;
      hits.push({ source: "group", group: { id: g.id, name: g.name }, via: [...via, g.id], entry: pick(item) });
      if (item.meta_value === null) continue;
      if (!meta || g.weight > meta.weight) meta = { value: item.meta_value, weight: g.weight };
      else if (g.weight === meta.weight) meta = { value: looser(meta.value, item.meta_value), weight: g.weight };
    }
  }
  const decided = hits.filter(hit => hit.entry.value !== null);
  const result = decided.some(hit => hit.entry.value === false) ? "deny" : decided.length ? "allow" : "unset";
  return { node, result, hits, ...(meta && { meta_value: meta.value }) };
}
function effectiveOf(account: ConsoleUser): EffectivePermissions {
  const allowList: string[] = [];
  const denyList: string[] = [];
  const metaValues: Record<string, string> = {};
  for (const node of ALL_NODES) {
    const verdict = evaluate(account, node);
    if (node.startsWith("meta.")) { if (verdict.meta_value !== undefined) metaValues[node] = verdict.meta_value; continue; }
    if (verdict.result === "allow") allowList.push(node);
    if (verdict.result === "deny") denyList.push(node);
  }
  const groups = groupChain(account).map(({ id, via }) => {
    const g = groupById(id)!;
    return { id, name: g.name, kind: g.kind, via };
  });
  return { account_id: account.account_id, groups, allow: allowList, deny: denyList, meta: metaValues };
}
/** 某个节点只在带 department 范围的条目里允许时，这个人只能看哪些部门；不限范围回 null。 */
function departmentScope(account: ConsoleUser, node: string): string[] | null {
  const allowed = evaluate(account, node).hits.filter(hit => hit.entry.value === true);
  if (allowed.some(hit => !Array.isArray(hit.entry.scope.department))) return null;
  return [...new Set(allowed.flatMap(hit => hit.entry.scope.department as string[]))];
}
function memberCount(groupId: string): number {
  if (groupId === "level.visitor") return 0;
  return MOCK_USERS.filter(u => directGroups(u).includes(groupId)).length;
}
function membersOf(groupId: string): PermissionGroupMember[] {
  const custom = CUSTOM_MEMBERS[groupId];
  return MOCK_USERS.filter(u => directGroups(u).includes(groupId)).map(u => {
    const extra = custom?.find(m => m.username === u.username);
    return {
      account_id: u.account_id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url,
      expires_at: extra?.expires_at ?? null, granted_by: extra?.granted_by ?? null, created_at: extra?.created_at ?? u.created_at,
    };
  });
}

// ---- 预览身份（?__persona=）----

type Persona = {
  username: string; display_name: string; provider: SessionProvider; email_required: boolean;
  /** 缺真实姓名或年级（#280）：先到补资料页 */
  profile_required: boolean;
  /** 几分钟前登录的；超过 10 分钟就过了 step-up 窗口，控制台的写操作会回 403 step_up_required。 */
  signed_in_min: number;
  /** 只给 /api/identity/me 的账号页样板用，与控制台权限模型无关。 */
  legacySiteRole: SiteRole;
};
const persona = (username: string, extra: Partial<Persona> = {}): Persona => {
  const account = userByName(username)!;
  return {
    username, display_name: account.display_name, provider: account.providers.includes("github") ? "github" : account.providers[0], email_required: false, profile_required: false, signed_in_min: 4,
    legacySiteRole: username === "xu_yan" ? "admin" : account.level === "member" ? "member" : null, ...extra,
  };
};

/**
 * `?__persona=` 可选的身份：站长（全部权限）、管理部部长、AI部门部长（只管本部门）、AI部门部员（在「活动志愿者」组里，
 * 只能管比赛）、极客班成员、往届成员、注册用户（后三个没有「进入控制台」）；另有站长用邮箱登录、站长登录超过 10 分钟
 * （写操作要重新登录）、两个还没绑邮箱的成员（#273）、一个还没填姓名和年级的成员（#280）和未登录。
 */
export const MOCK_PERSONAS: Record<string, Persona> = {
  owner: persona("xu_yan"),
  owner_email: persona("xu_yan", { provider: "email" }),
  owner_stale: persona("xu_yan", { signed_in_min: 25 }),
  management_head: persona("chen_hang"),
  ai_head: persona("li_xiaoman"),
  ai_staff: persona("he_miao"),
  member: persona("liu_xing"),
  alumni: persona("gao_yuan"),
  registered: persona("zhou_zihan", { provider: "email" }),
  no_email: persona("liu_xing", { email_required: true }),
  no_email_stale: persona("liu_xing", { email_required: true, signed_in_min: 25 }),
  no_profile: persona("yz_k3m9q2xa", { profile_required: true }),
};

/** 不是身份的预览状态：未登录（/api/console/me 返回 401）。 */
export const SIGNED_OUT = "signed_out";

const PERSONA_KEY = "yugc:console-persona";
/** `?__persona=` 优先，其次本标签页记住的身份，默认是站长（拥有全部权限）。 */
export function currentPersona(): string {
  if (typeof window === "undefined") return "owner";
  const valid = (value: string | null): value is string => Boolean(value && (value in MOCK_PERSONAS || value === SIGNED_OUT));
  const fromQuery = new URLSearchParams(window.location.search).get("__persona");
  if (valid(fromQuery)) {
    try { sessionStorage.setItem(PERSONA_KEY, fromQuery); } catch { /* 忽略 */ }
    return fromQuery;
  }
  try {
    const stored = sessionStorage.getItem(PERSONA_KEY);
    if (valid(stored)) return stored;
  } catch { /* 忽略 */ }
  return "owner";
}
export function mockPersona(): Persona | null {
  const name = currentPersona();
  return name === SIGNED_OUT ? null : MOCK_PERSONAS[name];
}
const LEVEL_NAME: Record<Level, string> = { visitor: "访客", registered: "注册用户", member: "极客班成员", alumni: "往届成员" };
const accountOf = (p: Persona) => userByName(p.username)!;
const permissionsOf = (p: Persona) => effectiveOf(accountOf(p)).allow;

/** GET /api/console/me：permissions 是展开通配后的具体节点。 */
export function mockMe(p: Persona): ConsoleMe {
  const account = accountOf(p);
  return {
    account_id: account.account_id, login: account.username, username: account.username, display_name: account.display_name,
    avatar_url: account.avatar_url, level: account.level, level_name: LEVEL_NAME[account.level], department: account.department, titles: account.titles,
    permissions: permissionsOf(p), provider: p.provider, email_required: p.email_required, profile_required: p.profile_required,
  };
}

function usersCounts(visible: ConsoleUser[]): UsersResponse["counts"] {
  return {
    visitor_today: 46,
    registered: visible.filter(u => u.level === "registered").length,
    member: visible.filter(u => u.level === "member").length,
    alumni: visible.filter(u => u.level === "alumni").length,
  };
}

// ---- 操作记录（SPEC §3.7）----

const UA_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const UA_CLI = "geek-cli/0.4.0 (darwin arm64)";
type EventInit = Partial<Omit<ActivityEvent, "account">> & { who?: string | null; visitor?: string };
let eventSeq = 0;
const event = (minutesAgo: number, surface: ActivityEvent["surface"], action: string, outcome: ActivityEvent["outcome"], init: EventInit = {}): ActivityEvent => {
  const account = init.who ? userByName(init.who) : undefined;
  eventSeq += 1;
  return {
    id: 5000 - eventSeq, at: now - minutesAgo * MIN,
    account: account ? { id: account.account_id, username: account.username, display_name: account.display_name, avatar_url: account.avatar_url } : null,
    visitor_id: init.visitor ?? null, surface, action, target_type: init.target_type ?? null, target_id: init.target_id ?? null, outcome,
    // GitLab 事件没有 IP 和浏览器：传 null 就是 null，不传才用默认值
    ip: init.ip !== undefined ? init.ip : `10.21.${(eventSeq * 7) % 200}.${(eventSeq * 13) % 250}`, ua: init.ua !== undefined ? init.ua : UA_DESKTOP,
    request_id: `req_${(0x5a17 + eventSeq * 977).toString(16)}${eventSeq.toString(36)}`, meta: init.meta ?? {},
  };
};
const V1 = "v_8f3a2c61e0b94d7a";
const V2 = "v_1d07e5b2a9c84f36";
export const MOCK_ACTIVITY: ActivityEvent[] = [
  event(2, "console", "system.backup.export", "ok", { who: "xu_yan", meta: { environment: "preview", files: 3, tables: 62, excluded_tables: ["sessions", "device_grants", "oauth_grants", "oidc_payloads", "email_challenges", "invite_attempts", "application_limits", "limit_events", "forum_rate_events"] } }),
  event(3, "console", "perm.group.update", "ok", { who: "xu_yan", target_type: "permission_group", target_id: "title.ai.head", meta: { before: { entries: 5 }, after: { entries: 6, added: ["apply.export"] } } }),
  event(6, "portal", "os.boot.played", "ok", { visitor: V1, ua: UA_PHONE }),
  event(7, "portal", "page.view", "ok", { visitor: V1, ua: UA_PHONE, target_type: "page", target_id: "/join-us" }),
  event(12, "forum", "forum.topic.view", "ok", { who: "he_miao", target_type: "topic", target_id: "128" }),
  event(18, "forum", "forum.reply.create", "denied", { who: "bai_shuo", target_type: "topic", target_id: "128", meta: { node: "forum.reply.create" } }),
  event(25, "portal", "auth.signin", "ok", { who: "zhou_zihan", meta: { provider: "email", email_domain: "qq.com" } }),
  event(31, "portal", "auth.register", "ok", { who: "wu_yifan", meta: { provider: "google", invite: false } }),
  event(40, "console", "apply.review", "ok", { who: "li_xiaoman", target_type: "application", target_id: "9e8d7c6b" }),
  event(52, "forum", "forum.reply.create", "limited", { visitor: V2, meta: { bucket: "forum.reply.hourly", retry_after: 1800 } }),
  event(64, "portal", "apply.submit", "ok", { who: "zhou_zihan", target_type: "application", target_id: "2f9d6b1a" }),
  event(70, "portal", "apply.submit", "limited", { who: "zhou_zihan", meta: { bucket: "apply.daily", retry_after: 35_000 } }),
  event(95, "cli", "auth.signin", "ok", { who: "he_miao", ua: UA_CLI, meta: { provider: "device" } }),
  event(120, "console", "users.update", "ok", { who: "chen_hang", target_type: "account", target_id: "mock-qin_lan", meta: { before: { titles: [] }, after: { titles: ["title.ai.deputy"] } } }),
  event(33, "gitlab", "gitlab.merge_request.opened", "ok", { who: "he_miao", target_type: "merge_request", target_id: "42", ip: null, ua: null, meta: { project: "geek/portal", url: "https://example.test/gitlab/geek/portal/-/merge_requests/42", gitlab_username: "he_miao", linked: true } }),
  event(58, "gitlab", "gitlab.push.pushed_to", "ok", { target_type: "push", ip: null, ua: null, meta: { project: "geek/sandbox", url: "https://example.test/gitlab/geek/sandbox/-/commits/main", ref: "main", commit_count: 3, gitlab_username: "guest_dev", linked: false } }),
  event(110, "gitlab", "gitlab.issue.closed", "ok", { who: "chen_hang", target_type: "issue", target_id: "17", ip: null, ua: null, meta: { project: "geek/geek-cli", url: "https://example.test/gitlab/geek/geek-cli/-/issues/17", gitlab_username: "chen_hang", linked: true } }),
  event(150, "console", "gitlab.resync", "error", { who: "chen_hang", target_type: "account", target_id: "mock-fang_lin", meta: { error: "gitlab_avatar_400" } }),
  event(200, "api", "events.rejected", "denied", { visitor: V2, meta: { action: "os.debug.dump" } }),
  event(240, "portal", "auth.signin_denied", "denied", { who: "mo_chen", meta: { reason: "account_disabled" } }),
  event(300, "forum", "forum.search", "limited", { visitor: V1, ua: UA_PHONE, meta: { bucket: "search.per_minute" } }),
  event(360, "portal", "invite.redeem", "ok", { who: "yz_k3m9q2xa" }),
  event(420, "console", "activity.export", "ok", { who: "xu_yan", meta: { rows: 240 } }),
  event(9 * 60, "forum", "forum.topic.create", "ok", { who: "liu_xing", target_type: "topic", target_id: "131" }),
  event(26 * 60, "console", "users.disable", "ok", { who: "xu_yan", target_type: "account", target_id: "mock-mo_chen" }),
  event(28 * 60, "portal", "auth.register", "limited", { visitor: V2, meta: { bucket: "register.ip" } }),
  event(2 * 24 * 60, "forum", "forum.react", "ok", { who: "sun_qiao", target_type: "post", target_id: "877" }),
  event(3 * 24 * 60, "console", "perm.group.create", "ok", { who: "chen_hang", target_type: "permission_group", target_id: "custom.event_staff", meta: { after: { name: "活动志愿者", weight: 25 } } }),
  event(4 * 24 * 60, "system", "activity.cleanup", "ok", { meta: { removed: 812 } }),
  // 再往前是成批的浏览记录，「加载更多」有东西可翻
  ...Array.from({ length: 40 }, (_, i) => i % 3 === 0
    ? event(5 * 24 * 60 + i * 97, "forum", "forum.topic.view", "ok", { who: ["he_miao", "liu_xing", "qin_lan", "gao_yuan"][i % 4], target_type: "topic", target_id: String(100 + i) })
    : event(5 * 24 * 60 + i * 97, "portal", "page.view", "ok", { visitor: i % 2 ? V1 : V2, ua: i % 2 ? UA_PHONE : UA_DESKTOP, target_type: "page", target_id: ["/", "/join-us", "/projects", "/feedback"][i % 4] })),
].sort((a, b) => b.at - a.at);
const todayStart = beijingDayStart(now);
const MOCK_BLOCKED_TODAY = (() => {
  const counts = new Map<string, number>([["read.per_minute", 14]]);
  for (const row of MOCK_ACTIVITY) {
    const bucket = row.meta.bucket;
    if (row.outcome === "limited" && typeof bucket === "string" && row.at >= todayStart) counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return [...counts.entries()].map(([bucket, count]) => ({ bucket, count }));
})();
/** 没有「查看完整 IP」时 IP 只留前两段（IPv6 留前 4 组），和服务端一样。 */
const maskIp = (ip: string | null) => {
  if (!ip) return ip;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 4).join(":")}::*`;
  const parts = ip.split(".");
  return `${parts[0]}.${parts[1]}.*.*`;
};
const PAGE = 50;
function activityPage(rows: ActivityEvent[], cursor: string | null, limit: number, fullIp: boolean): { items: ActivityEvent[]; next_cursor: string | null } {
  const start = Number(cursor ?? 0) || 0;
  const size = Math.min(Math.max(limit, 1), PAGE);
  const items = rows.slice(start, start + size).map(row => (fullIp ? row : { ...row, ip: maskIp(row.ip) }));
  return { items, next_cursor: start + size < rows.length ? String(start + size) : null };
}

// ---- GitLab ----

const MOCK_GITLAB_STATUS: GitlabStatus = {
  mode: "on", url: "https://example.test/gitlab", group: "geek", token_configured: true, version: "17.6.1", healthy: true,
  last_run: { at: now - 8 * MIN, changed: 2, failed: 1 }, errors_24h: 1,
};
const MOCK_GITLAB_PROJECTS: GitlabProjectsResponse = {
  groups: [{ id: 1, full_path: "geek", name: "geek", visibility: "private" }, { id: 2, full_path: "geek/courses", name: "courses", visibility: "internal" }],
  projects: [
    { id: 101, path_with_namespace: "geek/portal", name: "portal", description: "官网、控制台和论坛", visibility: "private", web_url: "https://example.test/gitlab/geek/portal", http_url_to_repo: "https://example.test/gitlab/geek/portal.git", ssh_url_to_repo: "git@example.test:geek/portal.git", last_activity_at: now - 2 * HOUR, star_count: 6 },
    { id: 102, path_with_namespace: "geek/geek-cli", name: "geek-cli", description: "命令行工具", visibility: "internal", web_url: "https://example.test/gitlab/geek/geek-cli", http_url_to_repo: "https://example.test/gitlab/geek/geek-cli.git", ssh_url_to_repo: "git@example.test:geek/geek-cli.git", last_activity_at: now - DAY, star_count: 3 },
    { id: 103, path_with_namespace: "geek/courses/ai-bootcamp-2026-autumn-handouts", name: "ai-bootcamp-2026-autumn-handouts", description: "2026 秋季 AI 训练营讲义和作业，按周整理", visibility: "public", web_url: "https://example.test/gitlab/geek/courses/ai-bootcamp-2026-autumn-handouts", http_url_to_repo: "https://example.test/gitlab/geek/courses/ai-bootcamp-2026-autumn-handouts.git", ssh_url_to_repo: "git@example.test:geek/courses/ai-bootcamp-2026-autumn-handouts.git", last_activity_at: now - 3 * DAY, star_count: 12 },
    { id: 104, path_with_namespace: "geek/sandbox", name: "sandbox", description: null, visibility: "private", web_url: "https://example.test/gitlab/geek/sandbox", http_url_to_repo: "https://example.test/gitlab/geek/sandbox.git", ssh_url_to_repo: "git@example.test:geek/sandbox.git", last_activity_at: null, star_count: 0 },
  ],
};
const MOCK_GITLAB_SETTINGS: GitlabSettings = { sync_mode: "on", group_path: "geek", interval_minutes: 10, token_configured: true };
/** 招新总开关（#284）：样板里是开放、从没改过；写请求按只读回 501。 */
const MOCK_APPLY_SETTINGS: ApplySettings = { open: true, updated_at: null };

/** GitLab 账号同步：极客班成员都要进组，几种常见错误各留一个样本。 */
export function mockGitlabAccounts(): GitlabAccountsResponse {
  const synced = now - 8 * MIN;
  const accounts: GitlabAccount[] = MOCK_USERS.filter(u => u.level === "member" || u.gitlab.state !== "none").map((account): GitlabAccount => {
    const base: GitlabAccount = {
      // GitLab 上还没建号时不知道用户名
      account_id: account.account_id, login: account.username, username: account.gitlab.gitlab_user_id !== null ? account.username : null, gitlab_user_id: account.gitlab.gitlab_user_id,
      state: account.gitlab.state === "blocked" ? "blocked" : account.gitlab.gitlab_user_id !== null ? "active" : "pending",
      access_level: account.gitlab.gitlab_user_id !== null ? (account.titles.some(t => t.id === SITE_OWNER.id) ? 50 : 30) : null,
      last_error: null, last_error_at: null, synced_at: account.gitlab.gitlab_user_id !== null ? synced : null, pending: [],
    };
    if (account.gitlab.state === "failed" && account.gitlab.gitlab_user_id === null) return { ...base, last_error: "gitlab_unreachable", last_error_at: synced, pending: [{ kind: "create", username: account.username, access_level: 30 }] };
    if (account.gitlab.state === "failed") return { ...base, access_level: null, last_error: "gitlab_avatar_400", last_error_at: synced, pending: [{ kind: "set_avatar" }] };
    if (account.gitlab.state === "pending") return { ...base, pending: [{ kind: "create", username: account.username, access_level: 30 }, { kind: "set_emails" }] };
    if (account.gitlab.state === "blocked" && account.status === "disabled") return base;
    if (account.gitlab.state === "blocked") return { ...base, pending: [{ kind: "unblock" }] };
    return base;
  });
  return { mode: "on", gitlab_url: "https://example.test/gitlab", group: "geek", client_registered: true, accounts };
}

// ---- 投递样板（#148，照旧）----

const APPLICATIONS = [
  { id: "7c1e4a2b-3d5f-4a6b-8c7d-9e0f1a2b3c4d", name: "褚明哲", class_name: "信安2402", email: "chu.mingzhe@example.test", status: "received", created_at: now - 25 * MIN,
    strengths: "打过两次校赛 CTF，擅长 Web 方向，写过一个自动化信息收集脚本。想在极客班找到一起刷题、一起复盘的伙伴。" },
  { id: "2f9d6b1a-8e3c-4d7f-a1b2-c3d4e5f6a7b8", name: "周子涵", class_name: "计科2301", email: "zhou.zihan@example.test", status: "received", created_at: now - 3 * HOUR,
    strengths: "熟悉 TypeScript 与 React，做过课程设计的在线选课系统（前后端都是自己写的），平时用 Claude Code 和 Cursor 辅助开发。对 Agent 和 MCP 很感兴趣，读过 MCP 规范并写过一个查询校园课表的 MCP Server 原型。希望能参与真实项目，学习代码审查和协作流程。" },
  { id: "5a3b8c2d-1e4f-4b6a-9c8d-7e6f5a4b3c2d", name: "吴一凡", class_name: "软件2302", email: "wu.yifan@example.test", status: "received", created_at: now - 1 * DAY - 2 * HOUR,
    strengths: "C++ 基础扎实，ACM 校队预备队员，喜欢算法与系统方向。最近在读《深入理解计算机系统》，想找人一起做实验。" },
  { id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b", name: "郑可欣", class_name: "信安2401", email: "zheng.kexin@example.test", status: "interview", created_at: now - 3 * DAY,
    strengths: "负责过班级公众号排版，会用 Figma 做界面原型，也在学前端。希望参与官网和论坛的设计与维护，把好看的东西做出来。" },
  { id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", name: "钱思远", class_name: "计科2302", email: "qian.siyuan@example.test", status: "accepted", created_at: now - 6 * DAY,
    strengths: "Python 数据分析做过两个小项目，熟悉 pandas 和可视化；会 Linux 常用命令，自己搭过一个家用 NAS。" },
  { id: "6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a", name: "冯晓", class_name: "软件2301", email: "feng.xiao@example.test", status: "rejected", created_at: now - 8 * DAY,
    strengths: "对编程有兴趣，正在学习 Java 基础，希望通过社团多接触项目。" },
  { id: "3b4c5d6e-7f80-4123-9456-7890abcdef12", name: "林晓", class_name: "计科2401", email: "lin.xiao@example.test", status: "cancelled", created_at: now - 9 * DAY,
    strengths: "熟悉 JavaScript，做过班级活动报名页，希望学习后端开发和协作。" },
];
type MockMail = { status: string; skip_reason: string | null; attempts: number; subject: string; sent_at: number | null; updated_at: number };
const sent = (subject: string, at: number): MockMail => ({ status: "sent", skip_reason: null, attempts: 1, subject, sent_at: at, updated_at: at });
const skipped = (subject: string, reason: string, at: number): MockMail => ({ status: "skipped", skip_reason: reason, attempts: 0, subject, sent_at: null, updated_at: at });

const REVIEWS: Record<string, { id: number; from_status: string; to_status: string; note: string | null; reviewer: string; created_at: number; mail: MockMail | null }[]> = {
  "3b4c5d6e-7f80-4123-9456-7890abcdef12": [{ id: 19, from_status: "received", to_status: "cancelled", note: "投递人撤回这份简历", reviewer: "li_xiaoman", created_at: now - 8 * DAY, mail: null }],
  "5a3b8c2d-1e4f-4b6a-9c8d-7e6f5a4b3c2d": [{ id: 11, from_status: "received", to_status: "reviewing", note: "算法方向，转给技术部一起看", reviewer: "li_xiaoman", created_at: now - 20 * HOUR, mail: null }],
  "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b": [
    { id: 13, from_status: "reviewing", to_status: "interview", note: "何苗负责面试排期", reviewer: "he_miao", created_at: now - 1 * DAY,
      mail: { status: "pending", skip_reason: null, attempts: 2, subject: "极客班面试安排：9 月 30 日（周三）19:00", sent_at: null, updated_at: now - 1 * DAY + 6 * MIN } },
    { id: 12, from_status: "received", to_status: "reviewing", note: null, reviewer: "li_xiaoman", created_at: now - 2 * DAY, mail: null },
  ],
  "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e": [
    { id: 16, from_status: "interview", to_status: "accepted", note: "面试表现好，已加入项目部", reviewer: "li_xiaoman", created_at: now - 2 * DAY, mail: sent("你已通过极客班招新", now - 2 * DAY + MIN) },
    { id: 18, from_status: "interview", to_status: "interview", note: "改到周五晚上，已电话确认", reviewer: "he_miao", created_at: now - 3 * DAY, mail: null },
    { id: 15, from_status: "reviewing", to_status: "interview", note: null, reviewer: "he_miao", created_at: now - 4 * DAY,
      mail: skipped("极客班面试安排：9 月 26 日（周五）19:30", "not_allowlisted", now - 4 * DAY) },
    { id: 14, from_status: "received", to_status: "reviewing", note: null, reviewer: "li_xiaoman", created_at: now - 5 * DAY, mail: null },
  ],
  "6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a": [{ id: 17, from_status: "received", to_status: "rejected", note: "方向暂不匹配，已建议先参加公开分享会", reviewer: "li_xiaoman", created_at: now - 7 * DAY,
    mail: { status: "failed", skip_reason: null, attempts: 6, subject: "极客班招新结果", sent_at: null, updated_at: now - 6 * DAY } }],
};
const RECEIVED_MAIL: Record<string, MockMail | null> = {
  "3b4c5d6e-7f80-4123-9456-7890abcdef12": sent("极客班收到了你的报名信", now - 9 * DAY + MIN),
  "7c1e4a2b-3d5f-4a6b-8c7d-9e0f1a2b3c4d": { status: "sending", skip_reason: null, attempts: 0, subject: "极客班收到了你的报名信", sent_at: null, updated_at: now - 25 * MIN },
  "2f9d6b1a-8e3c-4d7f-a1b2-c3d4e5f6a7b8": sent("极客班收到了你的报名信", now - 3 * HOUR + MIN),
  "5a3b8c2d-1e4f-4b6a-9c8d-7e6f5a4b3c2d": null,
  "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b": sent("极客班收到了你的报名信", now - 3 * DAY + MIN),
  "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e": skipped("极客班收到了你的报名信", "not_allowlisted", now - 6 * DAY),
  "6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a": skipped("极客班收到了你的报名信", "mail_disabled", now - 8 * DAY),
};
const MAIL_ALLOWLIST = new Set(["zhou.zihan@example.test", "zheng.kexin@example.test", "chu.mingzhe@example.test"]);
const mailSettings = (email: string) => ({ enabled: true, recipients: "allowlist", deliverable: MAIL_ALLOWLIST.has(email.toLowerCase()) });

// ---- 比赛样板（#238/#239，照旧）----

const MOCK_COMPETITIONS = [
  { id: "c1001", name: "极客班算法挑战赛", kind: "internal", start_at: now + 6 * DAY, end_at: now + 6 * DAY + 6 * HOUR, signup_deadline: beijingDayEnd(now + 4 * DAY), url: null, description: "班内选拔，前五名进校赛。", offline: false, planning: false },
  { id: "c1002", name: "蓝桥杯省赛", kind: "external", start_at: now + 20 * DAY, end_at: now + 20 * DAY + 4 * HOUR, signup_deadline: beijingDayEnd(now + 12 * DAY), url: "https://dasai.lanqiao.cn/", description: "以学校为单位报名。", offline: false, planning: false },
  { id: "c1003", name: "上一期内测赛", kind: "internal", start_at: now - 9 * DAY, end_at: now - 8 * DAY, signup_deadline: null, url: null, description: "热身用的小比赛，不计成绩。", offline: false, planning: false },
  // 规划中（#278）：还没准备好开放报名，报名截止时间已经预填但不生效，留给组织者核对表单在这个状态下的样子。
  { id: "c1004", name: "下一期开源贡献赛", kind: "internal", start_at: now + 40 * DAY, end_at: now + 40 * DAY + 20 * DAY, signup_deadline: beijingDayEnd(now + 35 * DAY), url: null, description: "规则还在整理，暂不开放报名。", offline: false, planning: true },
];
/** 和服务端 `competitionStatus` 同一套口径：`planning` 打开且还没到开赛时间时压过其余规则。 */
function mockCompetitionStatus(row: { start_at: number; end_at: number; signup_deadline: number | null; planning: boolean }, at: number) {
  if (row.planning && at < row.start_at) return "planning";
  if (at > row.end_at) return "ended";
  if (row.signup_deadline !== null && at <= row.signup_deadline) return "registering";
  if (at >= row.start_at) return "ongoing";
  return row.signup_deadline === null ? "upcoming" : "closed";
}
const competitionView = () => {
  const at = Date.now();
  return MOCK_COMPETITIONS
    .map(row => ({ ...row, status: mockCompetitionStatus(row, at) }))
    .sort((a, b) => {
      const aEnded = at > a.end_at;
      const bEnded = at > b.end_at;
      if (aEnded !== bEnded) return aEnded ? 1 : -1;
      return (aEnded ? b.start_at - a.start_at : a.start_at - b.start_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
};
const DEFAULT_ROSTER_SETTINGS: SignupSettings = { enabled: false, participation: "individual", team_min: 1, team_max: 1, scoring: "none" };
const MOCK_ROSTER_SETTINGS: Record<string, SignupSettings> = { c1001: { enabled: true, participation: "team", team_min: 2, team_max: 3, scoring: "contribution" } };
const mockPerson = (login: string) => ({ account_id: `mock-${login}`, login, avatar_url: null });
const mockSignup = (login: string, patch: Partial<RosterSignup> = {}): RosterSignup => ({
  ...mockPerson(login), status: "active", note: "", looking_for_team: false,
  team_id: null, team_name: null, role: null, created_at: now - 3 * DAY, updated_at: now - 3 * DAY, cancelled_at: null, ...patch,
});
const MOCK_ROSTER_TEAMS: Record<string, RosterTeam[]> = {
  c1001: [
    { id: "t1001", name: "夜航星", slogan: "把每一道题当最后一次提交。", status: "locked", leader_account_id: "mock-chen-hang", member_count: 3, created_at: now - 2 * DAY, disbanded_at: null,
      members: [{ ...mockPerson("chen_hang"), role: "leader", joined_at: now - 2 * DAY }, { ...mockPerson("li_xiaoman"), role: "member", joined_at: now - 2 * DAY + HOUR }, { ...mockPerson("wang_zhe"), role: "member", joined_at: now - 2 * DAY + 2 * HOUR }] },
    { id: "t1002", name: "打字机", slogan: "", status: "recruiting", leader_account_id: "mock-sun-qiao", member_count: 1, created_at: now - DAY, disbanded_at: null, members: [{ ...mockPerson("sun_qiao"), role: "leader", joined_at: now - DAY }] },
  ],
};
const MOCK_SIGNUPS: Record<string, RosterSignup[]> = {
  c1001: [
    mockSignup("chen_hang", { team_id: "t1001", team_name: "夜航星", role: "leader" }),
    mockSignup("li_xiaoman", { team_id: "t1001", team_name: "夜航星", role: "member" }),
    mockSignup("wang_zhe", { team_id: "t1001", team_name: "夜航星", role: "member" }),
    mockSignup("sun_qiao", { team_id: "t1002", team_name: "打字机", role: "leader", created_at: now - 2 * DAY }),
    mockSignup("zhao_yi", { note: "会一点 Rust，想找后端方向。", looking_for_team: true, created_at: now - DAY }),
    mockSignup("he_miao", { status: "cancelled", created_at: now - 2 * DAY, cancelled_at: now - HOUR }),
  ],
};
const MOCK_SCORE_EVENTS: Record<string, ScoreEvent[]> = {
  c1001: [
    { id: "s1001", competition_id: "c1001", person: mockPerson("chen_hang"), kind: "pr", repo: "geek/portal", number: 265, points: 45, importance: "important", core: "business", grade: "year1", grade_factor: 350, damp_percent: 100, weighted_points: 158, contributed_at: now - 6 * HOUR, reason: "比赛窗口的列表、详情与手机布局。", status: "active", created_by_login: "xu_yan", created_at: now - 6 * HOUR, revoked_at: null, revoke_reason: null },
    { id: "s1004", competition_id: "c1001", person: mockPerson("chen_hang"), kind: "issue", repo: "geek/portal", number: 270, points: 5, importance: "normal", core: "edge", grade: "year1", grade_factor: 350, damp_percent: 0, weighted_points: 0, contributed_at: now - 5 * HOUR, reason: "说明文档里的错别字。", status: "active", created_by_login: "xu_yan", created_at: now - 5 * HOUR, revoked_at: null, revoke_reason: null },
    { id: "s1002", competition_id: "c1001", person: mockPerson("li_xiaoman"), kind: "issue", repo: "geek/portal", number: 239, points: 20, importance: "important", core: "core", grade: "year3", grade_factor: 140, damp_percent: 100, weighted_points: 28, contributed_at: now - DAY, reason: "补上名单导出与积分登记的接口。", status: "active", created_by_login: "xu_yan", created_at: now - DAY, revoked_at: null, revoke_reason: null },
    { id: "s1003", competition_id: "c1001", person: mockPerson("wang_zhe"), kind: "penalty", repo: null, number: null, points: -50, importance: null, core: null, grade: "year2", grade_factor: 100, damp_percent: 100, weighted_points: -50, contributed_at: now - 2 * DAY, reason: "提交里带了别人的代码。", status: "revoked", created_by_login: "xu_yan", created_at: now - 2 * DAY, revoked_at: now - 2 * HOUR, revoke_reason: "误判：改动是结对完成的。" },
  ],
};
// #278 的只读样板：一期开源赛的待确认贡献、计分规则与奖项、官网版本、定榜预览（写操作在开发预览里照旧回 501）
const contestPerson = (login: string, name: string) => ({ account_id: `mock-${login}`, username: login, display_name: name, avatar_url: null });
const MOCK_CANDIDATES: Candidate[] = [
  { id: "cd1001", account: contestPerson("zhao_yi", "赵一"), kind: "pr", gitlab_project: "geek/admin", gitlab_iid: 41, url: "https://example.test/gitlab/geek/admin/-/merge_requests/41",
    title: "天梯接口加十秒缓存", importance: "important", core: "core", status: "pending", final_points: null, reason: null, reviewed_by: null, reviewed_at: null, accepted_via: null,
    note: "「有用」标签由 zhao_yi 添加，这是作者本人，未计分", contributed_at: now - 5 * HOUR, created_at: now - 4 * HOUR },
  { id: "cd1002", account: contestPerson("sun_qiao", "孙乔"), kind: "issue", gitlab_project: "geek/admin", gitlab_iid: 77, url: "https://example.test/gitlab/geek/admin/-/issues/77",
    title: "手机上天梯表格横向滚动", importance: null, core: null, status: "pending", final_points: null, reason: null, reviewed_by: null, reviewed_at: null, accepted_via: null,
    note: null, contributed_at: now - DAY, created_at: now - DAY + HOUR },
  { id: "cd1003", account: contestPerson("chen_hang", "陈航"), kind: "pr", gitlab_project: "geek/admin", gitlab_iid: 38, url: "https://example.test/gitlab/geek/admin/-/merge_requests/38",
    title: "比赛官网的动态流", importance: "important", core: "business", status: "accepted", final_points: 45, reason: null, reviewed_by: contestPerson("xu_yan", "徐言"), reviewed_at: now - 3 * HOUR, accepted_via: "label",
    note: null, contributed_at: now - 2 * DAY, created_at: now - 2 * DAY + HOUR },
];
// 和服务端 competition-rubric.ts 的表一致，只给开发预览用
const MOCK_RUBRIC: Record<"issue" | "pr", Record<Importance, Record<Core, number>>> = {
  issue: { normal: { edge: 5, business: 8, core: 12 }, important: { edge: 8, business: 14, core: 20 }, critical: { edge: 12, business: 20, core: 30 } },
  pr: { normal: { edge: 15, business: 25, core: 40 }, important: { edge: 25, business: 45, core: 65 }, critical: { edge: 40, business: 65, core: 100 } },
};
const MOCK_SCORING: Scoring = {
  importance: [{ key: "normal", label: "一般" }, { key: "important", label: "重要" }, { key: "critical", label: "关键" }],
  core: [{ key: "edge", label: "边缘", hint: "文档、样式、小脚本" }, { key: "business", label: "业务", hint: "一个功能模块" }, { key: "core", label: "核心", hint: "身份、权限、数据、计分、部署" }],
  points: (["issue", "pr"] as const).flatMap(kind => (["normal", "important", "critical"] as const).flatMap(importance =>
    (["edge", "business", "core"] as const).map(core => ({ kind, importance, core, points: MOCK_RUBRIC[kind][importance][core] })))),
  penalty: -50, trivial_per_week: 1, trivial_percent: 0,
};
/** 开发预览的试算：按样板选手的年级乘默认系数，不算防刷。 */
function mockScorePreview(search: URLSearchParams): ScorePreview {
  const kind = search.get("kind");
  if (kind === "penalty") return { points: -50, grade: "none", grade_factor: 100, damp_percent: 100, weighted_points: -50 };
  const points = MOCK_RUBRIC[kind === "pr" ? "pr" : "issue"][(search.get("importance") ?? "normal") as Importance][(search.get("core") ?? "edge") as Core];
  return { points, grade: "year1", grade_factor: 350, damp_percent: 100, weighted_points: Math.round(points * 3.5) };
}
const MOCK_RULES: Record<string, CompetitionRules> = {
  c1001: {
    grade_factors: { year1: 350, year2: 220, year3: 140, year4: 100, graduated: 100, none: 100 },
    grades: [{ grade: "year1", label: "大一" }, { grade: "year2", label: "大二" }, { grade: "year3", label: "大三" }, { grade: "year4", label: "大四" }, { grade: "graduated", label: "已毕业" }, { grade: "none", label: "无年级" }],
    prizes: [{ from: 1, to: 1, amount_cny: 700, title: "GPT 5x 订阅的价格" }, { from: 2, to: 3, amount_cny: 140, title: "GPT Plus 订阅的价格" }, { from: 4, to: 8, amount_cny: 70, title: "" }],
    gitlab_projects: ["geek/admin"], scoring: MOCK_SCORING, updated_at: null, updated_by: null, finalized: false,
  },
};
const MOCK_SITE: SiteState = {
  slug: "oss-challenge-2026-1", live_version_id: "sv1002", site_url: "/c/oss-challenge-2026-1/",
  versions: [
    { id: "sv1003", version: "1.0.1", size: 13_107_200, files: 3, sha256: "9f2c".repeat(16), status: "rejected", report: ["assets/intro.mp4：不允许的文件类型 .mp4"], uploaded_by: contestPerson("xu_yan", "徐言"), created_at: now - HOUR, preview_url: null },
    { id: "sv1002", version: "1.0.0", size: 227_873, files: 5, sha256: "468f".repeat(16), status: "passed", report: [], uploaded_by: contestPerson("xu_yan", "徐言"), created_at: now - DAY, preview_url: "/c/oss-challenge-2026-1/~preview/sv1002/" },
  ],
};
function mockFinal(competitionId: string): FinalView {
  const events = (MOCK_SCORE_EVENTS[competitionId] ?? []).filter(row => row.status === "active");
  const totals = new Map<string, number>();
  for (const row of events) totals.set(row.person.login, (totals.get(row.person.login) ?? 0) + row.weighted_points);
  const tiers = MOCK_RULES[competitionId]?.prizes ?? [];
  const preview = [...totals].filter(([, points]) => points > 0).sort((a, b) => b[1] - a[1]).map(([login, points], index) => {
    const tier = tiers.find(item => index + 1 >= item.from && index + 1 <= item.to);
    return { rank: index + 1, points, account: contestPerson(login, login), amount_cny: tier?.amount_cny ?? null, title: tier ? tier.title : null };
  });
  return { finalized_at: null, finalized_by: null, standings: [], prizes: [], preview };
}

function mockRoster(competitionId: string) {
  const competition = MOCK_COMPETITIONS.find(row => row.id === competitionId);
  if (!competition) throw new ApiError(404, "not_found", "比赛不存在或已下线");
  const settings = MOCK_ROSTER_SETTINGS[competitionId] ?? DEFAULT_ROSTER_SETTINGS;
  const signups = MOCK_SIGNUPS[competitionId] ?? [];
  const teams = MOCK_ROSTER_TEAMS[competitionId] ?? [];
  const active = signups.filter(row => row.status === "active");
  const live = teams.filter(team => team.status !== "disbanded");
  const locked = live.filter(team => team.status === "locked");
  const inTeam = new Set(live.flatMap(team => team.members.map(member => member.account_id)));
  const stats: RosterStats = {
    signups: active.length, teams: live.length, locked_teams: locked.length,
    confirmed_people: settings.participation === "individual" ? active.length : locked.reduce((sum, team) => sum + team.member_count, 0),
    unplaced: settings.participation === "team" ? active.filter(row => !inTeam.has(row.account_id)).length : 0,
  };
  return { settings, stats, signups, teams };
}
const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const beijingStamp = (at: number) => new Date(at + 8 * HOUR).toISOString().slice(0, 16).replace("T", " ");
function mockRosterCsv(competitionId: string): string {
  const header = ["account_id", "login", "status", "note", "looking_for_team", "team_name", "role", "created_at_beijing", "updated_at_beijing", "cancelled_at_beijing"];
  const rows = mockRoster(competitionId).signups.map(row => [
    row.account_id, row.login, row.status, row.note, row.looking_for_team ? "1" : "0",
    row.team_name ?? "", row.role ?? "", beijingStamp(row.created_at), beijingStamp(row.updated_at), row.cancelled_at === null ? "" : beijingStamp(row.cancelled_at),
  ].map(csvCell).join(","));
  return `﻿${[header.join(","), ...rows].join("\r\n")}\r\n`;
}

const FEEDBACK = [
  { id: 21, category: "建议", status: "open", submitter_login: "liu_xing", contact: "", content: "希望每月有一次项目复盘分享，录屏放到论坛里，方便没到场的同学补看。", reply: null, replied_by: null, replied_at: null, created_at: now - 5 * HOUR },
  { id: 20, category: "Bug", status: "in_progress", submitter_login: null, contact: "wechat: example", content: "官网投递页在手机上提交按钮被输入法挡住了。", reply: "已复现，正在修。", replied_by: "wang_zhe", replied_at: now - 1 * DAY, created_at: now - 2 * DAY },
  { id: 19, category: "新功能", status: "done", submitter_login: "gao_yuan", contact: "", content: "论坛能不能给毕业的学长学姐一个单独的标识？", reply: "已上线「往届成员」身份。", replied_by: "sun_qiao", replied_at: now - 3 * DAY, created_at: now - 6 * DAY },
];

const MOCK_INVITES: InviteCode[] = [
  { id: 3, code: "fall2026-recruit", note: "2026 秋季招新群", max_uses: 200, used_count: 37, expires_at: beijingDayEnd(now + 40 * DAY), disabled: false, created_by: "xu_yan", created_at: now - 6 * DAY, updated_at: now - 2 * HOUR, usable: true },
  { id: 2, code: "hackathon-guests", note: "黑客松外校嘉宾", max_uses: 12, used_count: 12, expires_at: null, disabled: false, created_by: "chen_hang", created_at: now - 20 * DAY, updated_at: now - 9 * DAY, usable: false },
  { id: 1, code: "spring-trial", note: "", max_uses: null, used_count: 4, expires_at: null, disabled: true, created_by: "xu_yan", created_at: now - 70 * DAY, updated_at: now - 30 * DAY, usable: false },
];

// 论坛管理（#276）：分类照论坛 content/curation.json，可见范围照服务端迁移的种子；表情是「极客娘」前几个，
// 图片用一张写着名字的 SVG 代替（开发预览没有表情文件）。
const MOCK_FORUM_CATEGORIES: ForumCategoryRow[] = [
  { id: "c-exam", name: "招新与机试", visibility: "public", topic_count: 14 },
  { id: "c-announcements", name: "班级公告", visibility: "member", topic_count: 6 },
  { id: "c-courses", name: "课程与作业", visibility: "registered", topic_count: 23 },
  { id: "c-competitions", name: "竞赛与项目", visibility: "public", topic_count: 9 },
  { id: "c-careers", name: "求职与升学", visibility: "registered", topic_count: 4 },
  { id: "c-ai", name: "人工智能", visibility: "public", topic_count: 11 },
];
// 样板表情用仓库里第一套「极客娘」的图（服务端种子同一批文件），内联成 data: 地址：控制台的 CSP 不放行 blob:，
// 样板模块只在开发态选了样板数据时才加载。
const STICKER_FILES = import.meta.glob<string>("../../../server/assets/stickers/yugc/*.webp", { eager: true, query: "?inline", import: "default" });
const stickerFile = (code: string) => STICKER_FILES[`../../../server/assets/stickers/yugc/${code}.webp`] ?? "";
const mockStickers = (packId: string, rows: ReadonlyArray<readonly [string, string, number]>, off: readonly string[] = []) =>
  rows.map(([code, label, uses], index) => ({ id: `${packId}-${code}`, shortcode: `${packId}-${code}`, label, url: stickerFile(code), sort: index * 10, enabled: !off.includes(code), use_count: uses }));
const MOCK_STICKER_PACKS: ConsoleStickerPack[] = [
  {
    id: "yugc", name: "极客娘", sort: 0, enabled: true,
    stickers: mockStickers("yugc", [["wave", "打招呼", 41], ["thumbsup", "点赞", 87], ["heart", "比心", 25], ["confused", "疑惑", 9], ["shocked", "震惊", 6], ["cry", "哭哭", 3], ["merged", "合并了", 18], ["roger", "收到", 0]], ["cry"]),
  },
  {
    id: "daily", name: "日常", sort: 10, enabled: true,
    stickers: mockStickers("daily", [["happy", "开心", 12], ["sleepy", "困了", 7], ["popcorn", "吃瓜", 30], ["coding", "敲代码", 15], ["goodnight", "晚安", 4], ["go", "冲", 9]]),
  },
  { id: "event", name: "活动限定", sort: 20, enabled: false, stickers: [] },
];

/**
 * 账号页（GET /api/identity/me）的样板：按当前身份给出登录方式、成员资格和几条账号记录。
 * 这个接口不受 #274 权限改版影响，membership.org_role 只用 legacySiteRole，和控制台权限是两套概念。
 */
export function mockAccount(persona: Persona) {
  const email = !persona.email_required && (persona.provider === "email" || persona.legacySiteRole === "admin");
  const signedInAt = now - persona.signed_in_min * MIN;
  const identities = [
    ...(persona.legacySiteRole !== null ? [{ provider: "github" as const, label: persona.username, linked_at: now - 120 * DAY, last_login_at: now - 3 * DAY }] : []),
    ...(email ? [
      { provider: "email" as const, label: "x***@example.com", linked_at: now - 2 * DAY, last_login_at: persona.provider === "email" ? now - 4 * MIN : null, id: "mock-email-1", primary: true },
      // 站长额外留一个备用邮箱（#272）：主邮箱收验证码，备用邮箱丢密码时联系站长本人。
      ...(persona.legacySiteRole === "admin" ? [{ provider: "email" as const, label: "y***@example.com", linked_at: now - 40 * DAY, last_login_at: now - 20 * DAY, id: "mock-email-2", primary: false }] : []),
    ] : []),
  ];
  return {
    account_id: `mock-${persona.username}`,
    login: persona.username,
    identities,
    has_password: persona.provider === "email",
    password_updated_at: persona.provider === "email" ? now - DAY : null,
    membership: persona.legacySiteRole === null ? { state: "not_member", org_role: null, via_invite: false } : { state: "active", org_role: persona.legacySiteRole, via_invite: false },
    created_at: now - 120 * DAY,
    recent: [
      { at: signedInAt, action: "login", provider: persona.provider, result: "ok" },
      ...(email ? [{ at: now - DAY, action: "password_set", provider: "email", result: "ok" as const }, { at: now - 2 * DAY, action: "link", provider: "email", result: "ok" as const }] : []),
      { at: now - 3 * DAY, action: "logout", provider: "github", result: "ok" },
    ],
    available: ["email"],
    email_required: persona.email_required,
    real_name: persona.profile_required ? null : accountOf(persona).real_name ?? null,
    grade: persona.profile_required ? null : accountOf(persona).grade,
    grade_label: persona.profile_required ? null : accountOf(persona).grade_label,
    profile_required: persona.profile_required,
    session: { provider: persona.provider, created_at: signedInAt, expires_at: now + 7 * DAY, step_up_until: signedInAt + 10 * MIN },
  };
}


function denied(anyOf: string[]): never {
  const [first] = anyOf;
  const label = NODE_LABELS[first] ?? first;
  const payload = { error: "forbidden", node: first, message: `需要「${label}」权限` };
  throw new ApiError(403, "forbidden", payload.message, undefined, payload);
}
function need(persona: Persona, ...anyOf: string[]) {
  const permissions = permissionsOf(persona);
  if (!anyOf.some(node => permissions.includes(node))) denied(anyOf);
}
/** 控制台接口先要「进入控制台」，再要具体节点（/api/console/me 除外）。 */
function gate(persona: Persona, ...anyOf: string[]) {
  need(persona, "console.access");
  if (anyOf.length) need(persona, ...anyOf);
}
function requireSignedIn(): Persona {
  const name = currentPersona();
  if (name === SIGNED_OUT) throw new ApiError(401, "unauthenticated", "请先登录", undefined, { error: "unauthenticated" });
  return MOCK_PERSONAS[name];
}
function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message, undefined, { error: code, message });
}
/** 写操作要求刚登录过（CONTRACT §5，沿用 #273 的 step_up_until：登录后 10 分钟内）。 */
function requireStepUp(persona: Persona) {
  if (persona.signed_in_min > 10) fail(403, "step_up_required", "这个操作要求刚登录过，重新登录后再试");
}

function checkUserPatch(persona: Persona, id: string, body: unknown) {
  const patch = (body && typeof body === "object" ? body : {}) as UserPatch;
  gate(persona, "users.manage");
  if (patch.status !== undefined) need(persona, "users.disable");
  requireStepUp(persona);
  const target = userById(id);
  if (!target) fail(404, "not_found", "账号不存在");
  const owners = MOCK_USERS.filter(u => u.status === "active" && u.titles.some(t => t.id === SITE_OWNER.id));
  const losesOwner = patch.status === "disabled" || (patch.titles !== undefined && !patch.titles.includes(SITE_OWNER.id));
  if (losesOwner && owners.length === 1 && owners[0].account_id === target.account_id) fail(409, "last_owner", "这是最后一位站长，不能降级或停用");
}
const knownPattern = (node: string) => node === "*" || ALL_NODES.includes(node) || (node.endsWith(".*") && ALL_NODES.some(item => item.startsWith(node.slice(0, -1))));
const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
  for (const parent of groupById(id)?.parents ?? []) {
    if (seen.has(parent)) continue;
    seen.add(parent);
    ancestors(parent, seen);
  }
  return seen;
};
function checkGroupWrite(persona: Persona, method: string, id: string | null, body: unknown) {
  gate(persona, "perm.manage");
  requireStepUp(persona);
  const input = (body && typeof body === "object" ? body : {}) as { id?: string; parents?: string[]; entries?: { add?: { node?: string }[] } };
  if (method === "POST") {
    if (typeof input.id !== "string" || !/^custom\.[a-z0-9]+(?:_[a-z0-9]+)*$/.test(input.id)) fail(400, "invalid_group_id", "组 id 要写成 custom.英文小写");
    if (groupById(input.id)) fail(409, "group_exists", "已经有这个 id 的组");
    return;
  }
  const target = id ? groupById(id) : undefined;
  if (!target) fail(404, "not_found", "组不存在");
  if (method === "DELETE") {
    if (target.system) fail(409, "system_group", "系统组不能删除");
    return;
  }
  for (const parent of input.parents ?? []) {
    if (parent === target.id || ancestors(parent).has(target.id)) fail(400, "group_cycle", "继承关系成环了");
  }
  const unknown = (input.entries?.add ?? []).find(item => typeof item.node !== "string" || !knownPattern(item.node));
  if (unknown) fail(400, "unknown_node", `没有这个节点：${unknown.node ?? ""}`);
}

/**
 * 写请求不伪造成功（见 docs/architecture/API.md），由上层一律返回 501 mock_read_only。
 * 这里先按服务端的顺序核对权限、step-up 和字段，不合法的得到和服务端相同的 401/403/400/409，
 * 页面上的出错提示（包括「重新登录」）在开发预览里也能看到。
 */
export function checkConsoleWrite(url: URL, method: string, body: unknown): void {
  const path = url.pathname;
  const persona = requireSignedIn();
  if ((path === "/api/console/security/decoy" && method === "PUT") || (path === "/api/console/security/policy" && method === "PUT") || (path === "/api/console/security/allowlist" && method === "POST") || (/^\/api\/console\/security\/allowlist\/[^/]+$/.test(path) && method === "DELETE") || (/^\/api\/console\/security\/blocks\/[^/]+$/.test(path) && method === "DELETE")) {
    gate(persona, "security.manage");
    requireStepUp(persona);
    return;
  }
  const application = path.match(/^\/api\/console\/applications\/([0-9a-f-]{36})$/);
  if (method === "PATCH" && application) return checkApplicationReview(application[1], body);
  if (path === "/api/console/applications/settings" && method === "PATCH") {
    gate(persona, "apply.settings");
    requireStepUp(persona);
    return;
  }
  // 移出报名（#342）：和服务端同样的顺序拒绝，合法的照旧落到只读 501
  const removal = path.match(/^\/api\/console\/competitions\/([^/]+)\/signups\/([^/]+)$/);
  if (removal && method === "DELETE") {
    gate(persona, "competition.manage");
    requireStepUp(persona);
    const competitionId = decodeURIComponent(removal[1]);
    if (!MOCK_COMPETITIONS.some(row => row.id === competitionId)) fail(404, "not_found", "比赛不存在或已下线");
    if (MOCK_RULES[competitionId]?.finalized) fail(409, "competition_finalized", "这场比赛已经定榜，名单与报名设置不能再改");
    const accountId = decodeURIComponent(removal[2]);
    if (!(MOCK_SIGNUPS[competitionId] ?? []).some(row => row.account_id === accountId && row.status === "active")) fail(409, "not_signed_up", "请先报名这场比赛");
    return;
  }
  if (/^\/api\/console\/competitions(?:\/[^/]+)?$/.test(path) && ["POST", "PATCH", "DELETE"].includes(method)) {
    gate(persona, "competition.manage");
    return;
  }
  const userPatch = path.match(/^\/api\/console\/users\/([^/]+)$/);
  if (userPatch && method === "PATCH") return checkUserPatch(persona, decodeURIComponent(userPatch[1]), body);
  const members = path.match(/^\/api\/console\/permission-groups\/([^/]+)\/members(?:\/([^/]+))?$/);
  if (members && ["POST", "DELETE"].includes(method)) {
    gate(persona, "perm.manage");
    requireStepUp(persona);
    if (!groupById(decodeURIComponent(members[1]))) fail(404, "not_found", "组不存在");
    return;
  }
  const groupWrite = path.match(/^\/api\/console\/permission-groups(?:\/([^/]+))?$/);
  if (groupWrite && ["POST", "PATCH", "DELETE"].includes(method)) return checkGroupWrite(persona, method, groupWrite[1] ? decodeURIComponent(groupWrite[1]) : null, body);
  if (/^\/api\/console\/forum\/categories\/[^/]+$/.test(path) && method === "PATCH") {
    gate(persona, "forum.category.manage");
    requireStepUp(persona);
    return;
  }
  if (/^\/api\/console\/forum\/(?:stickers\/[^/]+|sticker-packs\/[^/]+(?:\/stickers)?)$/.test(path) && ["PATCH", "PUT"].includes(method)) {
    gate(persona, "forum.sticker.manage");
    requireStepUp(persona);
    if (method === "PUT" && MOCK_STICKER_PACKS.some(pack => pack.stickers.some(sticker => sticker.shortcode === url.searchParams.get("shortcode")))) fail(409, "shortcode_taken", "这个短码已经被用过了");
    return;
  }
  if (path === "/api/console/forum/sticker-packs" && method === "POST") {
    gate(persona, "forum.sticker.manage");
    requireStepUp(persona);
    const id = (body as { id?: unknown } | undefined)?.id;
    if (MOCK_STICKER_PACKS.some(pack => pack.id === id)) fail(409, "pack_id_taken", "这个表情包 id 已经被用过了");
    return;
  }
  if ((/^\/api\/console\/mail-templates(?:\/[^/]+)?$/.test(path) && ["POST", "PATCH", "DELETE"].includes(method)) || path === "/api/console/mail-templates/test-send") {
    gate(persona, "mail.template.manage");
    requireStepUp(persona);
    return;
  }
  if (/^\/api\/console\/invites/.test(path) && ["POST", "PATCH"].includes(method)) {
    gate(persona, "invite.manage");
    requireStepUp(persona);
    return;
  }
  if (path === "/api/console/gitlab/settings" && method === "PATCH") {
    gate(persona, "gitlab.settings");
    requireStepUp(persona);
    return;
  }
  if (/^\/api\/console\/gitlab\/accounts\/[^/]+\/resync$/.test(path) && method === "POST") {
    gate(persona, "gitlab.sync");
    requireStepUp(persona);
    return;
  }
  if (/^\/api\/console\/feedback\/\d+$/.test(path) && method === "PATCH") gate(persona, "feedback.handle");
}

function checkApplicationReview(id: string, body: unknown): void {
  const persona = requireSignedIn();
  need(persona, "apply.review");
  const application = APPLICATIONS.find(a => a.id === id);
  if (!application) throw new ApiError(404, "not_found", "投递不存在");
  const input = (body && typeof body === "object" ? body : {}) as { status?: unknown; expected_status?: unknown; expected_review_id?: unknown; notify?: unknown; template_id?: unknown; letter?: unknown };
  if (input.status !== undefined && !STATUSES.some(s => s.id === input.status)) {
    const message = "状态只能是已收到、待面试、已录取、未通过、已取消";
    throw new ApiError(400, "invalid_status", message, undefined, { error: "invalid_status", message });
  }
  const changed = (message: string) => new ApiError(409, "status_changed", message, undefined, { error: "status_changed", message, application });
  const latestReviewId = Math.max(0, ...(REVIEWS[id] ?? []).map(review => review.id));
  if ((input.expected_status !== undefined && input.expected_status !== application.status)
    || (input.expected_review_id !== undefined && input.expected_review_id !== latestReviewId)) {
    const label = STATUSES.find(s => s.id === application.status)?.label ?? application.status;
    throw changed(`这份投递刚被别人处理过，现在是「${label}」，看过最新的记录再改`);
  }
  if (input.status !== undefined && input.status !== application.status && (input.expected_status === undefined || input.expected_review_id === undefined)) {
    throw changed("这个页面是旧版本，刷新后再改");
  }
  if (typeof input.template_id === "string" && input.notify !== false && input.status !== application.status) {
    const chosen = MOCK_MAIL_TEMPLATES.find(item => item.id === input.template_id);
    if (!chosen || chosen.kind !== input.status || !chosen.enabled) {
      const message = "选的这套信不存在、不是这一类，或者已经停用";
      throw new ApiError(400, "template_invalid", message, undefined, { error: "template_invalid", message, reason: "kind_mismatch" });
    }
  }
  if (input.status !== "interview" || application.status === "interview" || input.notify === false) return;
  const letter = (input.letter && typeof input.letter === "object" ? input.letter : {}) as { time?: unknown; place?: unknown };
  const filled = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  const fields: Record<string, string> = {};
  if (!filled(letter.time)) fields.time = "请填面试时间";
  if (!filled(letter.place)) fields.place = "请填面试地点";
  if (Object.keys(fields).length === 0) return;
  const message = "要发待面试的信，请填面试时间和地点";
  throw new ApiError(400, "letter_required", message, undefined, { error: "letter_required", message, fields });
}
const lastReview = (id: string) => {
  const [latest] = REVIEWS[id] ?? [];
  return latest ? { to_status: latest.to_status, reviewer: latest.reviewer, created_at: latest.created_at } : null;
};
const excerpt = (text: string) => (text.length > 120 ? `${text.slice(0, 120)}…` : text);
const counts = () => Object.fromEntries(STATUSES.map(s => [s.id, APPLICATIONS.filter(a => a.status === s.id).length]));


/** 带 department 范围的查看权限只看得到本部门的人；不限范围时全部可见。 */
const visibleTo = (persona: Persona, node: string) => {
  const scope = departmentScope(accountOf(persona), node);
  return (account: { department: DepartmentRef | null } | undefined) => scope === null || Boolean(account?.department && scope.includes(account.department.id));
};

function routeUsers(persona: Persona, search: URLSearchParams): UsersResponse {
  gate(persona, "users.view");
  // 真实姓名只回给有 users.manage 的人（#280），也只有他们能按姓名搜
  const withRealName = permissionsOf(persona).includes("users.manage");
  const visible = MOCK_USERS.filter(visibleTo(persona, "users.view"));
  const q = (search.get("q") ?? "").trim().toLowerCase();
  const level = search.get("level");
  const department = search.get("department");
  const status = search.get("status");
  const filtered = visible.filter(u =>
    (!q || [u.username, u.display_name, ...(withRealName && u.real_name ? [u.real_name] : [])].some(v => v.toLowerCase().includes(q)))
    && (!level || u.level === level)
    && (!department || (u.department?.id ?? "dept.none") === department)
    && (!status || u.status === status));
  const start = Number(search.get("cursor") ?? 0) || 0;
  const size = 20;
  const items = filtered.slice(start, start + size).map(u => (withRealName ? u : (({ real_name: _hidden, ...rest }) => rest)(u)));
  return { items, next_cursor: start + size < filtered.length ? String(start + size) : null, counts: usersCounts(visible) };
}

/** 和服务端 activityQuery 契约（app/server/src/routes/console/contracts.ts 的 `activityQuery`）同一份允许字段：
 * 预览环境没有 ajv，不手动核对的话，调用点悄悄传一个契约之外的参数（例如 `limit`）在这里会被默默忽略，
 * 只有连真实后端才会报 400，问题拖到上线才暴露（#274 的操作记录筛选 400）。 */
const ACTIVITY_QUERY_KEYS = ["account", "visitor", "action", "surface", "outcome", "from", "to", "cursor", "offset"];
function assertKnownQuery(search: URLSearchParams, allowed: string[]): void {
  for (const key of search.keys()) if (!allowed.includes(key)) fail(400, "validation_error", "querystring must NOT have additional properties");
}

function routeActivity(persona: Persona, search: URLSearchParams): ActivityList {
  assertKnownQuery(search, ACTIVITY_QUERY_KEYS);
  gate(persona, "activity.read");
  const canSee = visibleTo(persona, "activity.read");
  const scoped = departmentScope(accountOf(persona), "activity.read") !== null;
  const get = (key: string) => (search.get(key) ?? "").trim();
  const from = Number(get("from")) || null;
  const to = Number(get("to")) || null;
  const rows = MOCK_ACTIVITY.filter(row =>
    (!scoped || canSee(row.account ? userById(row.account.id) : undefined))
    && (!get("account") || row.account?.id === get("account"))
    && (!get("visitor") || row.visitor_id === get("visitor"))
    && (!get("action") || row.action.startsWith(get("action")))
    && (!get("surface") || row.surface === get("surface"))
    && (!get("outcome") || row.outcome === get("outcome"))
    && (from === null || row.at >= from)
    && (to === null || row.at <= to));
  // 预览里的游标就是偏移量；按页翻（#370）直接传 offset。
  const page = activityPage(rows, search.get("offset") ?? search.get("cursor"), 50, permissionsOf(persona).includes("activity.read.ip"));
  return { ...page, total: rows.length, blocked_today: scoped ? [] : MOCK_BLOCKED_TODAY };
}

function routeSummary(persona: Persona): Summary {
  gate(persona);
  const can = (node: string) => permissionsOf(persona).includes(node);
  const result: Summary = {};
  if (can("apply.view")) result.applications = { total: APPLICATIONS.length, by_status: counts(), last_7d: APPLICATIONS.filter(a => a.created_at >= now - 7 * DAY).length };
  if (can("competition.score.review")) result.candidates_pending = 0;
  if (can("users.view")) result.registrations_today = MOCK_USERS.filter(u => u.created_at >= todayStart).length;
  if (can("activity.read")) result.blocked_today = MOCK_BLOCKED_TODAY.reduce((sum, b) => sum + b.count, 0);
  if (can("gitlab.view")) result.gitlab = { mode: MOCK_GITLAB_STATUS.mode, healthy: MOCK_GITLAB_STATUS.healthy, last_run: MOCK_GITLAB_STATUS.last_run };
  if (can("feedback.view")) result.feedback = { open: FEEDBACK.filter(f => f.status === "open").length, total: FEEDBACK.length };
  return result;
}

/** 预览不是写操作（不发信、不改任何记录），开发预览里照样渲染，只是用的是 mock/mail-templates.ts 里的简易渲染。 */
export function routeMailPreview(body: unknown) {
  gate(requireSignedIn(), "mail.template.manage");
  return mockMailPreview(body);
}
export function routeLetterPreview(id: string, body: unknown) {
  const persona = requireSignedIn();
  gate(persona, "apply.review");
  const application = APPLICATIONS.find(item => item.id === id);
  if (!application) fail(404, "not_found", "投递不存在");
  return mockLetterPreview(application, body);
}

/** 处理 `/api/console/*` 与 `/api/public/departments` 的 GET；未知路径返回 undefined，交回上层报 404。 */
export function routeConsole(url: URL): unknown {
  const path = url.pathname;
  const search = url.searchParams;
  if (path === "/api/public/departments") return { departments: MOCK_DEPARTMENTS };

  const persona = requireSignedIn();
  if (path === "/api/console/me") return mockMe(persona);
  if (path === "/api/console/summary") return routeSummary(persona);
  if (path === "/api/console/users") return routeUsers(persona, search);
  if (path === "/api/console/security/decoy" || path === "/api/console/security/blocks" || path === "/api/console/security/policy" || path === "/api/console/security/allowlist") {
    gate(persona, "security.manage");
    assertKnownQuery(search, []);
    if (path.endsWith("/blocks")) return { blocks: [] };
    if (path.endsWith("/policy")) return { strict_mode: false, strict_threshold: 20, strict_window_seconds: 15, version: 0, shield_enabled: false, allowlist_count: 0 };
    if (path.endsWith("/allowlist")) return { items: [] };
    return { available: false, active: false, permanent: false, expires_at: null, now: Date.now(), max_minutes: 60, shield_enabled: false };
  }

  const account = path.match(/^\/api\/console\/accounts\/([^/]+)\/(activity|effective)$/);
  if (account) {
    const target = userById(decodeURIComponent(account[1]));
    if (account[2] === "effective") {
      gate(persona, "perm.view");
      if (!target) fail(404, "not_found", "账号不存在");
      return effectiveOf(target);
    }
    assertKnownQuery(search, ACTIVITY_QUERY_KEYS);
    gate(persona, "activity.read");
    if (!target || !visibleTo(persona, "activity.read")(target)) fail(404, "not_found", "账号不存在");
    const rows = MOCK_ACTIVITY.filter(row => row.account?.id === target.account_id);
    return { ...activityPage(rows, search.get("cursor"), 20, permissionsOf(persona).includes("activity.read.ip")), blocked_today: [] };
  }
  if (path === "/api/console/permissions/nodes") { gate(persona, "perm.view"); return MOCK_NODES; }
  if (path === "/api/console/permission-groups") {
    gate(persona, "perm.view");
    return { groups: MOCK_GROUPS.map(g => ({ ...g, member_count: memberCount(g.id) })) };
  }
  const members = path.match(/^\/api\/console\/permission-groups\/([^/]+)\/members$/);
  if (members) {
    gate(persona, "perm.view");
    const id = decodeURIComponent(members[1]);
    if (!groupById(id)) fail(404, "not_found", "组不存在");
    return { members: membersOf(id) };
  }
  if (path === "/api/console/permissions/explain") {
    gate(persona, "perm.view");
    const node = search.get("node") ?? "";
    const target = userById(search.get("account") ?? "");
    if (!target) fail(404, "not_found", "账号不存在");
    if (!ALL_NODES.includes(node)) fail(400, "unknown_node", "要填一个具体的节点");
    return evaluate(target, node);
  }
  if (path === "/api/console/activity") return routeActivity(persona, search);

  if (path === "/api/console/gitlab/status") { gate(persona, "gitlab.view"); return MOCK_GITLAB_STATUS; }
  if (path === "/api/console/gitlab/accounts") { gate(persona, "gitlab.view"); return mockGitlabAccounts(); }
  if (path === "/api/console/gitlab/projects") { gate(persona, "gitlab.view"); return MOCK_GITLAB_PROJECTS; }
  if (path === "/api/console/gitlab/settings") { gate(persona, "gitlab.settings"); return MOCK_GITLAB_SETTINGS; }

  if (path === "/api/console/applications") {
    gate(persona, "apply.view");
    const status = search.get("status");
    const q = (search.get("q") ?? "").trim().toLowerCase();
    const limit = Number(search.get("limit") ?? 50);
    const offset = Number(search.get("offset") ?? 0);
    const filtered = APPLICATIONS.filter(a => (!status || a.status === status) && (!q || [a.name, a.class_name, a.email].some(v => v.toLowerCase().includes(q))));
    return {
      items: filtered.slice(offset, offset + limit).map(a => ({ id: a.id, name: a.name, class_name: a.class_name, email: a.email, strengths_excerpt: excerpt(a.strengths), status: a.status, created_at: a.created_at, last_review: lastReview(a.id) })),
      total: filtered.length, counts: counts(),
    };
  }
  if (path === "/api/console/applications/settings") { gate(persona, "apply.view"); return MOCK_APPLY_SETTINGS; }
  const detail = path.match(/^\/api\/console\/applications\/([0-9a-f-]{36})$/);
  if (detail) {
    gate(persona, "apply.view");
    const application = APPLICATIONS.find(a => a.id === detail[1]);
    if (!application) fail(404, "not_found", "投递不存在");
    return {
      application, reviews: REVIEWS[application.id] ?? [], received_mail: RECEIVED_MAIL[application.id] ?? null, mail: mailSettings(application.email),
      letter_templates: mockLetterTemplates(),
    };
  }
  if (path === "/api/console/mail-templates") { gate(persona, "mail.template.manage"); return MOCK_MAIL_LIST; }
  if (path === "/api/console/feedback") {
    gate(persona, "feedback.view");
    const status = search.get("status");
    const items = FEEDBACK.filter(f => !status || f.status === status);
    const statusCounts: Record<string, number> = { open: 0, triaged: 0, in_progress: 0, done: 0, wont_do: 0, spam: 0 };
    for (const f of FEEDBACK) statusCounts[f.status] += 1;
    return { items, counts: statusCounts };
  }
  if (path === "/api/console/competitions") { gate(persona); return { competitions: competitionView() }; }
  if (/^\/api\/console\/competitions\/[^/]+\/score-preview$/.test(path)) { gate(persona, "competition.score.review"); return mockScorePreview(search); }
  const roster = path.match(/^\/api\/console\/competitions\/([^/]+)\/(roster|roster\.csv|score-events)$/);
  if (roster) {
    gate(persona, "competition.manage");
    const competitionId = decodeURIComponent(roster[1]);
    if (roster[2] === "roster") return mockRoster(competitionId);
    if (roster[2] === "roster.csv") return mockRosterCsv(competitionId);
    return { events: MOCK_SCORE_EVENTS[competitionId] ?? [] };
  }
  const contest = path.match(/^\/api\/console\/competitions\/([^/]+)\/(candidates|rules|site|final)$/);
  if (contest) {
    const competitionId = decodeURIComponent(contest[1]);
    if (contest[2] === "candidates") {
      gate(persona, "competition.score.review");
      const status = search.get("status") ?? "pending";
      const items = competitionId === "c1001" ? MOCK_CANDIDATES : [];
      const counts = { pending: 0, accepted: 0, rejected: 0 };
      for (const row of items) counts[row.status] += 1;
      return { items: items.filter(row => row.status === status), next_cursor: null, counts, last_run: competitionId === "c1001" ? { at: now - 20 * 60_000, fetched: 12, created: 2, skipped: 1, accepted: 1, revoked: 0, error: null } : null };
    }
    if (contest[2] === "rules") { gate(persona, "competition.manage", "competition.score.review"); return MOCK_RULES[competitionId] ?? { ...MOCK_RULES.c1001, prizes: [], gitlab_projects: [] }; }
    if (contest[2] === "site") { gate(persona, "competition.manage", "competition.site.publish"); return competitionId === "c1001" ? MOCK_SITE : { slug: null, live_version_id: null, site_url: null, versions: [] }; }
    gate(persona, "competition.manage");
    return mockFinal(competitionId);
  }
  if (path === "/api/console/invites") { gate(persona, "invite.manage"); return { invites: MOCK_INVITES }; }
  if (path === "/api/console/forum/categories") { gate(persona, "forum.category.manage"); return { categories: MOCK_FORUM_CATEGORIES }; }
  if (path === "/api/console/forum/stickers") { gate(persona, "forum.sticker.manage"); return { packs: MOCK_STICKER_PACKS }; }
  return undefined;
}
