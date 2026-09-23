// 开发预览：`/api/console/*` 的只读样板数据（全部虚构）。
// 只在 DEV 且数据源为 mock 时由 lib/http.ts 动态导入；生产构建里这段导入被删掉，不进产物。
// 称号、能力与部门必须与 app/server/src/lib/roles.ts 一致，tests/console/mock-sync.test.ts 会逐项核对。
import { ApiError } from "../lib/http";

const now = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const MOCK_ORG = "Yangtze-University-Geek-Class";

type Tone = "amber" | "cobalt" | "violet" | "jade" | "sky" | "coral" | "rose" | "slate";
type TitleId = "captain" | "head" | "member" | "alumni" | "guest";

export const MOCK_TONES: Record<Tone, string> = {
  amber: "#855700", cobalt: "#3346C8", violet: "#6E44C9", jade: "#18694A",
  sky: "#08609A", coral: "#A63F16", rose: "#B4235A", slate: "#5B6475",
};

export const MOCK_TITLES = [
  { id: "captain", label: "班长", tag: "CAPTAIN", icon: "star-filled", tone: "amber", rank: 0, description: "极客班总负责人，拥有全部能力" },
  { id: "head", label: "部门负责人", tag: "HEAD", icon: "badge", tone: "cobalt", rank: 1, description: "负责一个部门的日常事务" },
  { id: "member", label: "极客班成员", tag: "MEMBER", icon: "code", tone: "sky", rank: 4, description: "在读成员；GitHub 组织的 active 成员自动获得" },
  { id: "alumni", label: "领航员", tag: "NAVIGATOR", icon: "compass", tone: "violet", rank: 3, description: "已毕业的学长学姐" },
  { id: "guest", label: "访客", tag: "GUEST", icon: "user", tone: "slate", rank: 9, description: "未登录，或已登录但没有任何称号" },
] as const;
const CREW = { tag: "CREW", tone: "slate" as Tone, rank: 2 };

export const MOCK_CAPABILITIES = [
  { id: "console.access", domain: "console", label: "进入控制台", description: "进入控制台；持有任意一项能力就自动获得" },
  { id: "github.org.read", domain: "github", label: "查看 GitHub 组织", description: "查看组织概况、成员、仓库、团队、活动、安全" },
  { id: "github.org.manage", domain: "github", label: "修改组织资料", description: "修改组织资料与设置" },
  { id: "github.members.manage", domain: "github", label: "管理组织成员", description: "移除成员、修改成员角色" },
  { id: "github.repos.manage", domain: "github", label: "管理仓库", description: "新建或删除仓库、管理协作者" },
  { id: "github.teams.manage", domain: "github", label: "管理团队", description: "新建或删除团队" },
  { id: "github.invites.manage", domain: "github", label: "管理邀请", description: "管理邀请和邀请链接" },
  { id: "forum.topic.pin", domain: "forum", label: "置顶话题", description: "置顶话题" },
  { id: "forum.topic.close", domain: "forum", label: "关闭话题", description: "关闭话题" },
  { id: "forum.post.moderate", domain: "forum", label: "管理帖子", description: "编辑或删除他人帖子；在已关闭的话题里回复" },
  { id: "forum.category.manage", domain: "forum", label: "管理分类", description: "管理论坛分类" },
  { id: "forum.badge.assign", domain: "forum", label: "授予论坛徽章", description: "授予论坛专属徽章（预留，本期没有接口）" },
  { id: "applications.read", domain: "applications", label: "查看投递", description: "查看投递" },
  { id: "applications.review", domain: "applications", label: "审核投递", description: "修改投递状态、写备注" },
  { id: "applications.export", domain: "applications", label: "导出投递", description: "导出 CSV" },
  { id: "feedback.read", domain: "feedback", label: "查看意见箱", description: "查看意见箱" },
  { id: "feedback.manage", domain: "feedback", label: "处理意见", description: "修改意见状态、回复、删除" },
  { id: "audit.read", domain: "audit", label: "查看审计日志", description: "查看审计日志（含 IP）" },
  { id: "roles.manage", domain: "roles", label: "管理称号与部门", description: "管理称号、部门和权限包；仅班长，不可放进部门权限包" },
  { id: "roles.department.manage", domain: "roles", label: "任免本部门干事", description: "任免本部门干事（只限自己负责的部门）" },
];
const ALL = MOCK_CAPABILITIES.map(item => item.id);
const DOMAINS = [
  { id: "console", label: "控制台" }, { id: "applications", label: "招新投递" }, { id: "forum", label: "论坛" },
  { id: "github", label: "GitHub 组织" }, { id: "feedback", label: "意见箱" }, { id: "audit", label: "审计" }, { id: "roles", label: "称号与权限" },
];
const ICONS = ["star-filled", "badge", "code", "compass", "user", "user-follow", "terminal", "forum", "application", "bullhorn", "education", "idea", "trophy", "user-favorite", "chart-network", "logo-github", "book"];
const STATUSES = [
  { id: "received", label: "已收到" }, { id: "reviewing", label: "评估中" }, { id: "interview", label: "待面试" },
  { id: "accepted", label: "已录取" }, { id: "rejected", label: "未通过" },
];

export const MOCK_DEPARTMENTS = [
  {
    id: "recruitment", name: "招新部", tag: "RECRUIT", icon: "user-follow", tone: "coral" as Tone, sort_order: 10,
    description: "负责招新宣传、投递评估与面试安排",
    head_capabilities: ["applications.read", "applications.review", "applications.export", "github.invites.manage"],
    member_capabilities: ["applications.read", "applications.review"],
  },
  {
    id: "tech", name: "技术部", tag: "TECH", icon: "terminal", tone: "jade" as Tone, sort_order: 20,
    description: "负责组织仓库、基础设施与技术规范",
    head_capabilities: ["github.repos.manage", "github.teams.manage", "audit.read"], member_capabilities: [],
  },
  {
    id: "community", name: "社区部", tag: "COMMUNITY", icon: "forum", tone: "rose" as Tone, sort_order: 30,
    description: "负责论坛版务、意见箱与社区氛围",
    head_capabilities: ["forum.topic.pin", "forum.topic.close", "forum.post.moderate", "forum.category.manage", "forum.badge.assign", "feedback.manage"],
    member_capabilities: ["forum.topic.pin", "forum.topic.close", "forum.post.moderate"],
  },
  {
    id: "projects", name: "项目部", tag: "PROJECTS", icon: "application", tone: "cobalt" as Tone, sort_order: 40,
    description: "负责项目立项、协作仓库与项目展示",
    head_capabilities: ["github.repos.manage", "github.teams.manage", "forum.topic.pin"], member_capabilities: [],
  },
];
const deptView = (id: string) => {
  const d = MOCK_DEPARTMENTS.find(item => item.id === id)!;
  return { id: d.id, name: d.name, tag: d.tag, icon: d.icon, tone: d.tone };
};

type Source = "assignment" | "bootstrap" | "github" | "none";
function title(role: TitleId, department: string | null, source: Source, assignment_id: number | null) {
  const base = MOCK_TITLES.find(item => item.id === role)!;
  if (role === "head" && department) {
    const d = deptView(department);
    return { id: role, label: `${d.name} · 负责人`, tag: base.tag, icon: d.icon, tone: d.tone, department: d, source, assignment_id };
  }
  if (role === "member" && department) {
    const d = deptView(department);
    return { id: role, label: `${d.name} · 干事`, tag: CREW.tag, icon: d.icon, tone: CREW.tone, department: d, source, assignment_id };
  }
  return { id: role, label: base.label, tag: base.tag, icon: base.icon, tone: base.tone as Tone, department: null, source, assignment_id };
}

/** 虚构人员：班长、四位部门负责人、干事若干、成员若干、领航员两位。 */
const ASSIGNMENTS = [
  { id: 1, github_login: "chen-hang", github_user_id: 1001, role: "captain", department_id: "", note: "第三届班长", granted_by: "chen-hang", created_at: now - 40 * DAY },
  { id: 2, github_login: "li-xiaoman", github_user_id: 1002, role: "head", department_id: "recruitment", note: null, granted_by: "chen-hang", created_at: now - 38 * DAY },
  { id: 3, github_login: "wang-zhe", github_user_id: 1003, role: "head", department_id: "tech", note: null, granted_by: "chen-hang", created_at: now - 38 * DAY },
  { id: 4, github_login: "sun-qiao", github_user_id: 1004, role: "head", department_id: "community", note: "兼管意见箱", granted_by: "chen-hang", created_at: now - 37 * DAY },
  { id: 5, github_login: "zhao-yi", github_user_id: 1005, role: "head", department_id: "projects", note: null, granted_by: "chen-hang", created_at: now - 37 * DAY },
  { id: 6, github_login: "he-miao", github_user_id: 1006, role: "member", department_id: "recruitment", note: "负责面试排期", granted_by: "li-xiaoman", created_at: now - 12 * DAY },
  { id: 9, github_login: "tang-yu", github_user_id: 1009, role: "member", department_id: "community", note: null, granted_by: "sun-qiao", created_at: now - 10 * DAY },
  { id: 10, github_login: "fang-lin", github_user_id: 1010, role: "member", department_id: "recruitment", note: "宣传海报", granted_by: "li-xiaoman", created_at: now - 8 * DAY },
  { id: 7, github_login: "liu-xing", github_user_id: 1007, role: "member", department_id: "", note: null, granted_by: "chen-hang", created_at: now - 9 * DAY },
  { id: 11, github_login: "bai-shuo", github_user_id: 1011, role: "member", department_id: "", note: "转专业过来", granted_by: "chen-hang", created_at: now - 3 * DAY },
  { id: 8, github_login: "gao-yuan", github_user_id: 1008, role: "alumni", department_id: "", note: "已毕业，前技术部负责人", granted_by: "chen-hang", created_at: now - 30 * DAY },
  { id: 12, github_login: "du-ke", github_user_id: 1012, role: "alumni", department_id: "", note: null, granted_by: "chen-hang", created_at: now - 25 * DAY },
];

type Persona = {
  login: string; github_role: "admin" | "member" | null; bootstrap: boolean; head_of: string[];
  titles: ReturnType<typeof title>[]; capabilities: string[]; blocked: { capability: string; reason: string }[];
};
const MEMBER_FROM_GITHUB = title("member", null, "github", null);
export const MOCK_PERSONAS: Record<string, Persona> = {
  captain: { login: "chen-hang", github_role: "admin", bootstrap: false, head_of: [], titles: [title("captain", null, "assignment", 1), MEMBER_FROM_GITHUB], capabilities: ALL, blocked: [] },
  bootstrap: { login: "chen-hang", github_role: "admin", bootstrap: true, head_of: [], titles: [title("captain", null, "bootstrap", null), MEMBER_FROM_GITHUB], capabilities: ALL, blocked: [] },
  recruitment: {
    login: "li-xiaoman", github_role: "member", bootstrap: false, head_of: ["recruitment"],
    titles: [title("head", "recruitment", "assignment", 2), MEMBER_FROM_GITHUB],
    capabilities: ["console.access", "github.org.read", "applications.read", "applications.review", "applications.export", "feedback.read", "roles.department.manage"],
    blocked: [{ capability: "github.invites.manage", reason: "github_admin_required" }],
  },
  tech: {
    login: "wang-zhe", github_role: "admin", bootstrap: false, head_of: ["tech"],
    titles: [title("head", "tech", "assignment", 3), MEMBER_FROM_GITHUB],
    capabilities: ["console.access", "github.org.read", "github.repos.manage", "github.teams.manage", "feedback.read", "audit.read", "roles.department.manage"],
    blocked: [],
  },
  community: {
    login: "sun-qiao", github_role: "member", bootstrap: false, head_of: ["community"],
    titles: [title("head", "community", "assignment", 4), MEMBER_FROM_GITHUB],
    capabilities: ["console.access", "github.org.read", "forum.topic.pin", "forum.topic.close", "forum.post.moderate", "forum.category.manage", "forum.badge.assign", "feedback.read", "feedback.manage", "roles.department.manage"],
    blocked: [],
  },
  projects: {
    login: "zhao-yi", github_role: "member", bootstrap: false, head_of: ["projects"],
    titles: [title("head", "projects", "assignment", 5), MEMBER_FROM_GITHUB],
    capabilities: ["console.access", "github.org.read", "forum.topic.pin", "feedback.read", "roles.department.manage"],
    blocked: [{ capability: "github.repos.manage", reason: "github_admin_required" }, { capability: "github.teams.manage", reason: "github_admin_required" }],
  },
  crew: {
    login: "he-miao", github_role: "member", bootstrap: false, head_of: [],
    titles: [title("member", "recruitment", "assignment", 6), MEMBER_FROM_GITHUB],
    capabilities: ["console.access", "github.org.read", "applications.read", "applications.review"], blocked: [],
  },
  member: { login: "liu-xing", github_role: "member", bootstrap: false, head_of: [], titles: [title("member", null, "assignment", 7)], capabilities: ["console.access", "github.org.read"], blocked: [] },
  alumni: { login: "gao-yuan", github_role: "member", bootstrap: false, head_of: [], titles: [title("alumni", null, "assignment", 8)], capabilities: ["console.access", "github.org.read", "feedback.read"], blocked: [] },
  guest: { login: "visitor-01", github_role: null, bootstrap: false, head_of: [], titles: [title("guest", null, "none", null)], capabilities: [], blocked: [] },
};

/** 不是身份的预览状态：未登录（/api/console/me 返回 401）。 */
export const SIGNED_OUT = "signed_out";

const PERSONA_KEY = "yugc:console-persona";
/** `?__persona=` 优先，其次本标签页记住的身份，默认班长。 */
export function currentPersona(): string {
  if (typeof window === "undefined") return "captain";
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
  return "captain";
}

const APPLICATIONS = [
  { id: "7c1e4a2b-3d5f-4a6b-8c7d-9e0f1a2b3c4d", name: "褚明哲", class_name: "信安2402", email: "chu.mingzhe@example.test", status: "received", created_at: now - 25 * MIN,
    strengths: "打过两次校赛 CTF，擅长 Web 方向，写过一个自动化信息收集脚本。想在极客班找到一起刷题、一起复盘的伙伴。" },
  { id: "2f9d6b1a-8e3c-4d7f-a1b2-c3d4e5f6a7b8", name: "周子涵", class_name: "计科2301", email: "zhou.zihan@example.test", status: "received", created_at: now - 3 * HOUR,
    strengths: "熟悉 TypeScript 与 React，做过课程设计的在线选课系统（前后端都是自己写的），平时用 Claude Code 和 Cursor 辅助开发。对 Agent 和 MCP 很感兴趣，读过 MCP 规范并写过一个查询校园课表的 MCP Server 原型。希望能参与真实项目，学习代码审查和协作流程。" },
  { id: "5a3b8c2d-1e4f-4b6a-9c8d-7e6f5a4b3c2d", name: "吴一凡", class_name: "软件2302", email: "wu.yifan@example.test", status: "reviewing", created_at: now - 1 * DAY - 2 * HOUR,
    strengths: "C++ 基础扎实，ACM 校队预备队员，喜欢算法与系统方向。最近在读《深入理解计算机系统》，想找人一起做实验。" },
  { id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b", name: "郑可欣", class_name: "信安2401", email: "zheng.kexin@example.test", status: "interview", created_at: now - 3 * DAY,
    strengths: "负责过班级公众号排版，会用 Figma 做界面原型，也在学前端。希望参与官网和论坛的设计与维护，把好看的东西做出来。" },
  { id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", name: "钱思远", class_name: "计科2302", email: "qian.siyuan@example.test", status: "accepted", created_at: now - 6 * DAY,
    strengths: "Python 数据分析做过两个小项目，熟悉 pandas 和可视化；会 Linux 常用命令，自己搭过一个家用 NAS。" },
  { id: "6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a", name: "冯晓", class_name: "软件2301", email: "feng.xiao@example.test", status: "rejected", created_at: now - 8 * DAY,
    strengths: "对编程有兴趣，正在学习 Java 基础，希望通过社团多接触项目。" },
];
const REVIEWS: Record<string, { id: number; from_status: string; to_status: string; note: string | null; reviewer: string; created_at: number }[]> = {
  "5a3b8c2d-1e4f-4b6a-9c8d-7e6f5a4b3c2d": [{ id: 11, from_status: "received", to_status: "reviewing", note: "算法方向，转给技术部一起看", reviewer: "li-xiaoman", created_at: now - 20 * HOUR }],
  "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b": [
    { id: 13, from_status: "reviewing", to_status: "interview", note: "周四晚 7 点线下面试，何苗负责通知", reviewer: "he-miao", created_at: now - 1 * DAY },
    { id: 12, from_status: "received", to_status: "reviewing", note: null, reviewer: "li-xiaoman", created_at: now - 2 * DAY },
  ],
  "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e": [
    { id: 16, from_status: "interview", to_status: "accepted", note: "面试表现好，已加入项目部", reviewer: "li-xiaoman", created_at: now - 2 * DAY },
    { id: 15, from_status: "reviewing", to_status: "interview", note: null, reviewer: "he-miao", created_at: now - 4 * DAY },
    { id: 14, from_status: "received", to_status: "reviewing", note: null, reviewer: "li-xiaoman", created_at: now - 5 * DAY },
  ],
  "6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a": [{ id: 17, from_status: "received", to_status: "rejected", note: "方向暂不匹配，已建议先参加公开分享会", reviewer: "li-xiaoman", created_at: now - 7 * DAY }],
};

const FEEDBACK = [
  { id: 21, category: "建议", status: "open", submitter_login: "liu-xing", contact: "", content: "希望每月有一次项目复盘分享，录屏放到论坛里，方便没到场的同学补看。", reply: null, replied_by: null, replied_at: null, created_at: now - 5 * HOUR },
  { id: 20, category: "Bug", status: "in_progress", submitter_login: null, contact: "wechat: example", content: "官网投递页在手机上提交按钮被输入法挡住了。", reply: "已复现，正在修。", replied_by: "wang-zhe", replied_at: now - 1 * DAY, created_at: now - 2 * DAY },
  { id: 19, category: "新功能", status: "done", submitter_login: "gao-yuan", contact: "", content: "论坛能不能给毕业的学长学姐一个单独的标识？", reply: "已上线「领航员」称号。", replied_by: "sun-qiao", replied_at: now - 3 * DAY, created_at: now - 6 * DAY },
];
const AUDIT = [
  { id: 31, created_at: now - 40 * MIN, actor: "li-xiaoman", action: "application.review", target: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b", ip: "10.0.0.12", details: { from: "reviewing", to: "interview", has_note: true } },
  { id: 30, created_at: now - 3 * HOUR, actor: "li-xiaoman", action: "application.export", target: "all", ip: "10.0.0.12", details: { count: 6, status: null } },
  { id: 38, created_at: now - 5 * HOUR, actor: "he-miao", action: "application.view", target: "2f9d6b1a-8e3c-4d7f-a1b2-c3d4e5f6a7b8", ip: "10.0.0.21", details: null },
  { id: 37, created_at: now - 20 * HOUR, actor: "li-xiaoman", action: "application.review", target: "5a3b8c2d-1e4f-4b6a-9c8d-7e6f5a4b3c2d", ip: "10.0.0.12", details: { from: "received", to: "reviewing", has_note: true } },
  { id: 36, created_at: now - 1 * DAY - 2 * HOUR, actor: "wang-zhe", action: "feedback.update", target: "20", ip: "10.0.0.15", details: { status: "in_progress", has_reply: true } },
  { id: 35, created_at: now - 2 * DAY, actor: "wang-zhe", action: "repo.create", target: "mcp-lab", ip: "10.0.0.15", details: { visibility: "public" } },
  { id: 34, created_at: now - 3 * DAY, actor: "sun-qiao", action: "feedback.update", target: "19", ip: "10.0.0.17", details: { status: "done", has_reply: true } },
  { id: 33, created_at: now - 5 * DAY, actor: "zhao-yi", action: "team.create", target: "ai-native", ip: "10.0.0.19", details: { name: "AI Native" } },
  { id: 32, created_at: now - 7 * DAY, actor: "chen-hang", action: "role.assign", target: "gao-yuan", ip: "10.0.0.8", details: { role: "alumni", department_id: "", note_length: 14 } },
  { id: 29, created_at: now - 12 * DAY, actor: "li-xiaoman", action: "role.assign", target: "he-miao", ip: "10.0.0.12", details: { role: "member", department_id: "recruitment", note_length: 6 } },
  { id: 28, created_at: now - 14 * DAY, actor: "chen-hang", action: "invite_link.create", target: "development-preview-token", ip: "10.0.0.8", details: { hours: 72, max_uses: 30, note: "新生群", team_slug: null } },
  { id: 27, created_at: now - 20 * DAY, actor: "chen-hang", action: "department.update", target: "community", ip: "10.0.0.8", details: { changed: ["member_capabilities"] } },
].sort((a, b) => b.created_at - a.created_at);

function denied(persona: Persona, anyOf: string[]): never {
  const [first] = anyOf;
  const blocked = persona.blocked.find(item => anyOf.includes(item.capability));
  const label = MOCK_CAPABILITIES.find(item => item.id === first)?.label ?? first;
  const payload = { error: "missing_capability", capability: first, any_of: anyOf, ...(blocked ? { reason: blocked.reason } : {}), message: `需要「${label}」权限` };
  throw new ApiError(403, "missing_capability", payload.message, undefined, payload);
}
function need(persona: Persona, ...anyOf: string[]) {
  if (!anyOf.some(capability => persona.capabilities.includes(capability))) denied(persona, anyOf);
}

function departmentsView() {
  return MOCK_DEPARTMENTS.map(d => ({
    ...d, archived: false, created_at: now - 60 * DAY, updated_at: now - 20 * DAY,
    heads: ASSIGNMENTS.filter(a => a.role === "head" && a.department_id === d.id).map(a => a.github_login),
    crew_count: ASSIGNMENTS.filter(a => a.role === "member" && a.department_id === d.id).length,
  }));
}
function lastReview(id: string) {
  const [latest] = REVIEWS[id] ?? [];
  return latest ? { to_status: latest.to_status, reviewer: latest.reviewer, created_at: latest.created_at } : null;
}
const excerpt = (text: string) => (text.length > 120 ? `${text.slice(0, 120)}…` : text);
function counts() {
  return Object.fromEntries(STATUSES.map(s => [s.id, APPLICATIONS.filter(a => a.status === s.id).length]));
}

/** 当前身份（给 GitHub 组织接口的样板用）；未登录返回 null。 */
export function mockPersona(): Persona | null {
  const name = currentPersona();
  return name === SIGNED_OUT ? null : MOCK_PERSONAS[name];
}

/** 处理 `/api/console/*` 的 GET；未知路径返回 undefined，交回上层报 404。 */
export function routeConsole(url: URL): unknown {
  const path = url.pathname;
  const name = currentPersona();
  if (name === SIGNED_OUT) throw new ApiError(401, "not_signed_in", "请先登录", undefined, { error: "not_signed_in" });
  const persona = MOCK_PERSONAS[name];
  const search = url.searchParams;

  if (path === "/api/console/me") {
    return {
      login: persona.login, avatar_url: null, org: MOCK_ORG, github_role: persona.github_role,
      title: persona.titles[0], titles: persona.titles, capabilities: persona.capabilities,
      blocked: persona.blocked, bootstrap: persona.bootstrap, head_of: persona.head_of,
    };
  }
  if (path === "/api/console/catalogue") {
    need(persona, "console.access");
    return {
      titles: MOCK_TITLES, crew: CREW, tones: MOCK_TONES, capabilities: MOCK_CAPABILITIES, domains: DOMAINS,
      role_base: {
        captain: ALL, head: ["console.access", "github.org.read", "feedback.read", "roles.department.manage"],
        member: ["console.access", "github.org.read"], alumni: ["console.access", "github.org.read", "feedback.read"], guest: [],
      },
      captain_only: ["roles.manage"], department_icons: ICONS, application_statuses: STATUSES,
    };
  }
  if (path === "/api/console/summary") {
    need(persona, "console.access");
    const result: Record<string, unknown> = {};
    if (persona.capabilities.includes("applications.read")) {
      result.applications = { total: APPLICATIONS.length, by_status: counts(), last_7d: APPLICATIONS.filter(a => a.created_at >= now - 7 * DAY).length };
    }
    if (persona.capabilities.includes("feedback.read")) result.feedback = { open: FEEDBACK.filter(f => f.status === "open").length, total: FEEDBACK.length };
    if (persona.capabilities.some(c => c === "roles.manage" || c === "roles.department.manage")) {
      result.people = { assignments: name === "bootstrap" ? ASSIGNMENTS.length - 1 : ASSIGNMENTS.length, departments: MOCK_DEPARTMENTS.length };
    }
    return result;
  }
  if (path === "/api/console/departments") {
    need(persona, "console.access");
    return { departments: departmentsView() };
  }
  if (path === "/api/console/assignments") {
    need(persona, "roles.manage", "roles.department.manage");
    let rows = name === "bootstrap" ? ASSIGNMENTS.filter(a => a.role !== "captain") : ASSIGNMENTS;
    if (!persona.capabilities.includes("roles.manage")) rows = rows.filter(a => persona.head_of.includes(a.department_id));
    const role = search.get("role");
    const department = search.get("department_id");
    if (role) rows = rows.filter(a => a.role === role);
    if (department) rows = rows.filter(a => a.department_id === department);
    const captain = name === "bootstrap" ? null : { github_login: "chen-hang" };
    return { assignments: rows, captain, bootstrap_active: captain === null };
  }
  if (path === "/api/console/applications") {
    need(persona, "applications.read");
    const status = search.get("status");
    const q = (search.get("q") ?? "").trim().toLowerCase();
    const limit = Number(search.get("limit") ?? 50);
    const offset = Number(search.get("offset") ?? 0);
    const filtered = APPLICATIONS.filter(a => (!status || a.status === status) && (!q || [a.name, a.class_name, a.email].some(v => v.toLowerCase().includes(q))));
    return {
      items: filtered.slice(offset, offset + limit).map(a => ({
        id: a.id, name: a.name, class_name: a.class_name, email: a.email, strengths_excerpt: excerpt(a.strengths),
        status: a.status, created_at: a.created_at, last_review: lastReview(a.id),
      })),
      total: filtered.length, counts: counts(),
    };
  }
  const detail = path.match(/^\/api\/console\/applications\/([0-9a-f-]{36})$/);
  if (detail) {
    need(persona, "applications.read");
    const application = APPLICATIONS.find(a => a.id === detail[1]);
    if (!application) throw new ApiError(404, "not_found", "投递不存在");
    return { application, reviews: REVIEWS[application.id] ?? [] };
  }
  if (path === "/api/console/feedback") {
    need(persona, "feedback.read");
    const status = search.get("status");
    const items = FEEDBACK.filter(f => !status || f.status === status);
    const statusCounts: Record<string, number> = { open: 0, triaged: 0, in_progress: 0, done: 0, wont_do: 0, spam: 0 };
    for (const f of FEEDBACK) statusCounts[f.status] += 1;
    return { items, counts: statusCounts };
  }
  if (path === "/api/console/audit") {
    need(persona, "audit.read");
    const action = search.get("action");
    const limit = Number(search.get("limit") ?? 100);
    return { logs: AUDIT.filter(row => !action || row.action.startsWith(action)).slice(0, limit) };
  }
  return undefined;
}
