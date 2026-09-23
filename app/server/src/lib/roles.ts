/**
 * 极客班控制台的称号、部门与能力清单（纯数据 + 纯函数）。
 *
 * 这里是服务端的唯一来源：接口 `/api/console/catalogue` 原样下发，授权中间件据此判定。
 * 不导入 Fastify，也不接触数据库；持久化见 `role-store.ts`，GitHub 角色查询见 `access.ts`。
 */

/** 徽章色调（浅色）。对比度按 WCAG 公式在白底与 12% 同色浅底上计算，均 ≥5.0:1。 */
export const TONES = {
  amber: "#855700",
  cobalt: "#3346C8",
  violet: "#6E44C9",
  jade: "#18694A",
  sky: "#08609A",
  coral: "#A63F16",
  rose: "#B4235A",
  slate: "#5B6475",
} as const;
export type Tone = keyof typeof TONES;
export const TONE_IDS = Object.keys(TONES) as Tone[];

/** 部门可选的 Carbon 图标（不带 `i-carbon-` 前缀）。只在论坛渲染，核心 web 不装图标库。 */
export const DEPARTMENT_ICONS = [
  "star-filled", "badge", "code", "compass", "user", "user-follow", "terminal", "forum", "application",
  "bullhorn", "education", "idea", "trophy", "user-favorite", "chart-network", "logo-github", "book",
] as const;
export type DepartmentIcon = (typeof DEPARTMENT_ICONS)[number];

export type TitleId = "captain" | "head" | "member" | "alumni" | "guest";
export type AssignableRole = Exclude<TitleId, "guest">;
export const ASSIGNABLE_ROLES: AssignableRole[] = ["captain", "head", "member", "alumni"];

export type TitleDefinition = { id: TitleId; label: string; tag: string; icon: string; tone: Tone; rank: number; description: string };

/** 称号。一个人可以有多个；主称号取 rank 最小者。`head` 与带部门的 `member` 的显示名由部门决定。 */
export const TITLES: Record<TitleId, TitleDefinition> = {
  captain: { id: "captain", label: "班长", tag: "CAPTAIN", icon: "star-filled", tone: "amber", rank: 0, description: "极客班总负责人，拥有全部能力" },
  head: { id: "head", label: "部门负责人", tag: "HEAD", icon: "badge", tone: "cobalt", rank: 1, description: "负责一个部门的日常事务" },
  member: { id: "member", label: "极客班成员", tag: "MEMBER", icon: "code", tone: "sky", rank: 4, description: "在读成员；GitHub 组织的 active 成员自动获得" },
  alumni: { id: "alumni", label: "领航员", tag: "NAVIGATOR", icon: "compass", tone: "violet", rank: 3, description: "已毕业的学长学姐" },
  guest: { id: "guest", label: "访客", tag: "GUEST", icon: "user", tone: "slate", rank: 9, description: "未登录，或已登录但没有任何称号" },
};
/** 部门干事（`member` + 部门）：rank 2，中性色，徽章用 plain 变体。 */
export const CREW_TITLE = { tag: "CREW", tone: "slate" as Tone, rank: 2 };

export type CapabilityDomain = "console" | "github" | "forum" | "applications" | "feedback" | "audit" | "roles";
export const DOMAINS: { id: CapabilityDomain; label: string }[] = [
  { id: "console", label: "控制台" },
  { id: "applications", label: "招新投递" },
  { id: "forum", label: "论坛" },
  { id: "github", label: "GitHub 组织" },
  { id: "feedback", label: "意见箱" },
  { id: "audit", label: "审计" },
  { id: "roles", label: "称号与权限" },
];

/** 能力清单：扁平、按类别分组。顺序即 `/api/console/me` 下发 capabilities 的顺序。 */
export const CAPABILITIES = [
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
] as const satisfies readonly { id: string; domain: CapabilityDomain; label: string; description: string }[];
export type Capability = (typeof CAPABILITIES)[number]["id"];
export const CAPABILITY_IDS: Capability[] = CAPABILITIES.map(item => item.id);
const CAPABILITY_SET = new Set<string>(CAPABILITY_IDS);
export const isCapability = (value: unknown): value is Capability => typeof value === "string" && CAPABILITY_SET.has(value);
export const capabilityLabel = (id: Capability) => CAPABILITIES.find(item => item.id === id)?.label ?? id;

/** 只有班长能持有，不能放进任何部门权限包。 */
export const CAPTAIN_ONLY: Capability[] = ["roles.manage"];
/** 可以下放到部门权限包的能力。 */
export const DELEGATABLE: Capability[] = CAPABILITY_IDS.filter(id => !CAPTAIN_ONLY.includes(id));
export const FORUM_CAPABILITIES: Capability[] = CAPABILITY_IDS.filter(id => id.startsWith("forum."));
export const GITHUB_CAPABILITIES: Capability[] = CAPABILITY_IDS.filter(id => id.startsWith("github."));

/** 蕴含关系：持有左边即同时获得右边。计算时取闭包。 */
export const IMPLIES: Partial<Record<Capability, Capability[]>> = {
  "github.org.manage": ["github.org.read"],
  "github.members.manage": ["github.org.read"],
  "github.repos.manage": ["github.org.read"],
  "github.teams.manage": ["github.org.read"],
  "github.invites.manage": ["github.org.read"],
  "applications.review": ["applications.read"],
  "applications.export": ["applications.read"],
  "feedback.manage": ["feedback.read"],
  "roles.manage": ["roles.department.manage"],
};

/** 称号的基础能力；`head`/带部门的 `member` 另加部门权限包，`captain` 按清单动态取全部。 */
export const ROLE_BASE: Record<TitleId, Capability[]> = {
  captain: [...CAPABILITY_IDS],
  head: ["console.access", "github.org.read", "feedback.read", "roles.department.manage"],
  member: ["console.access", "github.org.read"],
  alumni: ["console.access", "github.org.read", "feedback.read"],
  guest: [],
};

export const APPLICATION_STATUSES = [
  { id: "received", label: "已收到" },
  { id: "reviewing", label: "评估中" },
  { id: "interview", label: "待面试" },
  { id: "accepted", label: "已录取" },
  { id: "rejected", label: "未通过" },
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]["id"];
export const APPLICATION_STATUS_IDS: ApplicationStatus[] = APPLICATION_STATUSES.map(item => item.id);

export type Department = {
  id: string; name: string; tag: string; icon: DepartmentIcon; tone: Tone; description: string;
  head_capabilities: Capability[]; member_capabilities: Capability[]; sort_order: number; archived: boolean;
};
export const DEPARTMENT_ID_PATTERN = "^[a-z][a-z0-9-]{1,31}$";
export const DEPARTMENT_TAG_PATTERN = "^[A-Z][A-Z0-9-]{1,15}$";

/** 默认部门：启动时 INSERT OR IGNORE，班长改过的部门不会被覆盖。 */
export const DEFAULT_DEPARTMENTS: Omit<Department, "archived">[] = [
  {
    id: "recruitment", name: "招新部", tag: "RECRUIT", icon: "user-follow", tone: "coral", sort_order: 10,
    description: "负责招新宣传、投递评估与面试安排",
    head_capabilities: ["applications.read", "applications.review", "applications.export", "github.invites.manage"],
    member_capabilities: ["applications.read", "applications.review"],
  },
  {
    id: "tech", name: "技术部", tag: "TECH", icon: "terminal", tone: "jade", sort_order: 20,
    description: "负责组织仓库、基础设施与技术规范",
    head_capabilities: ["github.repos.manage", "github.teams.manage", "audit.read"],
    member_capabilities: [],
  },
  {
    id: "community", name: "社区部", tag: "COMMUNITY", icon: "forum", tone: "rose", sort_order: 30,
    description: "负责论坛版务、意见箱与社区氛围",
    head_capabilities: ["forum.topic.pin", "forum.topic.close", "forum.post.moderate", "forum.category.manage", "forum.badge.assign", "feedback.manage"],
    member_capabilities: ["forum.topic.pin", "forum.topic.close", "forum.post.moderate"],
  },
  {
    id: "projects", name: "项目部", tag: "PROJECTS", icon: "application", tone: "cobalt", sort_order: 40,
    description: "负责项目立项、协作仓库与项目展示",
    head_capabilities: ["github.repos.manage", "github.teams.manage", "forum.topic.pin"],
    member_capabilities: [],
  },
];

export type AssignmentRow = {
  id: number; github_login: string; github_user_id: number | null; role: AssignableRole; department_id: string;
  note: string | null; granted_by: string; created_at: number;
};
export type DepartmentView = { id: string; name: string; tag: string; icon: string; tone: Tone };
export type TitleView = {
  id: TitleId; label: string; tag: string; icon: string; tone: Tone;
  department: DepartmentView | null;
  source: "assignment" | "bootstrap" | "github" | "none";
  assignment_id: number | null;
};
export type OrgRole = "admin" | "member" | null;
export type BlockReason = "github_admin_required" | "github_membership_required";
export type Access = {
  login: string;
  githubRole: OrgRole;
  titles: TitleView[];
  capabilities: Set<Capability>;
  blocked: { capability: Capability; reason: BlockReason }[];
  bootstrap: boolean;
  /** 该用户担任负责人的部门 id（仅未归档部门）。 */
  headOf: string[];
};

/** 权限包去重、按清单排序，并剔除仅班长能力与未知项。 */
export function normalizeBundle(values: readonly string[]): Capability[] {
  const wanted = new Set(values);
  return DELEGATABLE.filter(id => wanted.has(id));
}

export function closure(values: Iterable<Capability>): Set<Capability> {
  const result = new Set<Capability>(values);
  const queue = [...result];
  while (queue.length) {
    for (const implied of IMPLIES[queue.pop()!] ?? []) {
      if (!result.has(implied)) { result.add(implied); queue.push(implied); }
    }
  }
  return result;
}

const departmentView = (department: Department): DepartmentView =>
  ({ id: department.id, name: department.name, tag: department.tag, icon: department.icon, tone: department.tone });

export function titleView(role: TitleId, department: Department | null, source: TitleView["source"], assignmentId: number | null): TitleView {
  const base = TITLES[role];
  if (role === "head") {
    return {
      id: "head", label: department ? `${department.name} · 负责人` : base.label, tag: base.tag,
      icon: department?.icon ?? base.icon, tone: department?.tone ?? base.tone,
      department: department ? departmentView(department) : null, source, assignment_id: assignmentId,
    };
  }
  if (role === "member" && department) {
    return {
      id: "member", label: `${department.name} · 干事`, tag: CREW_TITLE.tag, icon: department.icon, tone: CREW_TITLE.tone,
      department: departmentView(department), source, assignment_id: assignmentId,
    };
  }
  return { id: role, label: base.label, tag: base.tag, icon: base.icon, tone: base.tone, department: null, source, assignment_id: assignmentId };
}

export function titleRank(title: Pick<TitleView, "id" | "department">): number {
  if (title.id === "member" && title.department) return CREW_TITLE.rank;
  return TITLES[title.id].rank;
}

/** GitHub 上限：控制台不能授予 GitHub 权力，只能在用户自己的组织角色以内收窄。 */
function githubCeiling(capability: Capability, orgRole: OrgRole): BlockReason | null {
  if (!capability.startsWith("github.")) return null;
  if (orgRole === null) return "github_membership_required";
  if (orgRole === "member" && capability !== "github.org.read") return "github_admin_required";
  return null;
}

export type ComputeAccessInput = {
  login: string;
  orgRole: OrgRole;
  assignments: AssignmentRow[];
  departments: Department[];
  captainExists: boolean;
};

/** 纯函数：由 GitHub 组织角色、显式指派与部门配置算出称号和能力。 */
export function computeAccess({ login, orgRole, assignments, departments, captainExists }: ComputeAccessInput): Access {
  const byId = new Map(departments.filter(item => !item.archived).map(item => [item.id, item]));
  const titles: TitleView[] = [];
  const granted: Capability[] = [];
  const headOf: string[] = [];
  let bootstrap = false;

  for (const row of assignments) {
    if (row.role === "captain") {
      titles.push(titleView("captain", null, "assignment", row.id));
      granted.push(...ROLE_BASE.captain);
    } else if (row.role === "head") {
      const department = byId.get(row.department_id);
      if (!department) continue; // 部门已归档或不存在：不再授予称号与能力
      titles.push(titleView("head", department, "assignment", row.id));
      granted.push(...ROLE_BASE.head, ...department.head_capabilities);
      headOf.push(department.id);
    } else if (row.role === "member") {
      const department = row.department_id ? byId.get(row.department_id) : null;
      if (row.department_id && !department) continue;
      titles.push(titleView("member", department ?? null, "assignment", row.id));
      granted.push(...ROLE_BASE.member, ...(department?.member_capabilities ?? []));
    } else if (row.role === "alumni") {
      titles.push(titleView("alumni", null, "assignment", row.id));
      granted.push(...ROLE_BASE.alumni);
    }
  }

  if (!captainExists && orgRole === "admin") {
    bootstrap = true;
    titles.push(titleView("captain", null, "bootstrap", null));
    granted.push(...ROLE_BASE.captain);
  }
  const hasAlumni = assignments.some(row => row.role === "alumni");
  const hasPlainMember = titles.some(title => title.id === "member" && !title.department);
  if (orgRole !== null && !hasAlumni && !hasPlainMember) {
    titles.push(titleView("member", null, "github", null));
    granted.push(...ROLE_BASE.member);
  }

  const implied = closure(granted);
  const capabilities = new Set<Capability>();
  const blocked: Access["blocked"] = [];
  for (const id of CAPABILITY_IDS) {
    if (!implied.has(id)) continue;
    const reason = githubCeiling(id, orgRole);
    if (reason) blocked.push({ capability: id, reason });
    else capabilities.add(id);
  }
  if (capabilities.size > 0) capabilities.add("console.access");
  else capabilities.clear();

  titles.sort((a, b) => titleRank(a) - titleRank(b));
  if (titles.length === 0) titles.push(titleView("guest", null, "none", null));
  return { login, githubRole: orgRole, titles, capabilities, blocked, bootstrap, headOf: [...new Set(headOf)] };
}

export const orderedCapabilities = (set: ReadonlySet<Capability>): Capability[] => CAPABILITY_IDS.filter(id => set.has(id));
