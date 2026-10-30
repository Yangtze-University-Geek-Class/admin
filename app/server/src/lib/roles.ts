/**
 * 极客班控制台旧的称号、部门与能力清单（纯数据 + 纯函数，role_assignments 时代）。
 *
 * 不导入 Fastify，也不接触数据库；持久化见 `role-store.ts`，旧的站内角色计算见 `access.ts`。
 * #276 核查发现：原先这里写「接口 `/api/console/catalogue` 原样下发，授权中间件据此判定」已经不是
 * 真的——这个接口已经删除，真正的授权判定早就切到 #274 新权限体系（`lib/permissions.ts` 的
 * `createPermissionEngine()`、`middleware/require-permission.ts`），这份清单与 `computeAccess()`
 * 只剩一条单测还在读；没有页面调用的 `GET /api/console/departments` 已在 #309 删除。是不是整段删除
 * 留给所有者或团队负责人决定，这次只按明确指出的 github.* 能力清理。
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
  "bullhorn", "education", "idea", "trophy", "user-favorite", "chart-network", "logo-github", "book", "user-admin",
] as const;
export type DepartmentIcon = (typeof DEPARTMENT_ICONS)[number];

/** `admin`（提督）不能指派：站内角色是管理员的账号自动获得；`guest`（乘客）是没有任何称号。 */
export type TitleId = "admin" | "captain" | "head" | "member" | "alumni" | "guest";
export type AssignableRole = Exclude<TitleId, "admin" | "guest">;
export const ASSIGNABLE_ROLES: AssignableRole[] = ["captain", "head", "member", "alumni"];

export type TitleDefinition = { id: TitleId; label: string; tag: string; icon: string; tone: Tone; rank: number; description: string };

/**
 * 提督、舰员以前的默认说明。#262 起权限只认极客班账号，不再看 GitHub 组织角色；旧库里还是这两句的，
 * 启动时换成 TITLES 里的新说明（lib/role-store.ts，改过的不动）。
 */
export const LEGACY_TITLE_DESCRIPTIONS = { admin: "GitHub 组织的所有者，拥有全部权限，任命舰长", member: "在读成员；加入 GitHub 组织后自动获得" } as const;

/**
 * 称号的**默认值**：第一次启动写进 `titles` 表（INSERT OR IGNORE），之后名字、标签、图标、色调、说明和权限包
 * 都以数据库为准，由提督（和持有 roles.manage 的舰长）在控制台改，不改代码。代码里固定的只有层级：
 * id 与 rank（提督 > 舰长 > 队长 > 带部门的舰员 > 领航员 > 舰员 > 乘客），因为「提督 = 站内管理员」
 * 「舰长只有一个」「队长属于部门」这些规则靠它执行。一个人可以有多个称号；主称号取 rank 最小者。
 */
export const TITLES: Record<TitleId, TitleDefinition> = {
  admin: { id: "admin", label: "提督", tag: "ADMIRAL", icon: "user-admin", tone: "violet", rank: 0, description: "站内管理员，拥有全部权限，任命舰长" },
  captain: { id: "captain", label: "舰长", tag: "CAPTAIN", icon: "star-filled", tone: "amber", rank: 1, description: "带领全班，权限仅次于提督" },
  head: { id: "head", label: "队长", tag: "LEADER", icon: "badge", tone: "cobalt", rank: 2, description: "负责一个部门的日常事务" },
  member: { id: "member", label: "舰员", tag: "CREW", icon: "code", tone: "sky", rank: 5, description: "在读成员；成为极客班成员后自动获得" },
  alumni: { id: "alumni", label: "领航员", tag: "NAVIGATOR", icon: "compass", tone: "jade", rank: 4, description: "已毕业的学长学姐" },
  guest: { id: "guest", label: "乘客", tag: "PASSENGER", icon: "user", tone: "slate", rank: 9, description: "没登录的人，只能看帖子" },
};
/** 部门舰员（`member` + 部门）：rank 3，中性色，徽章用 plain 变体；名字取舰员称号的名字。 */
export const CREW_TITLE = { tag: "CREW", tone: "slate" as Tone, rank: 3 };

// #276 挪来的 #274 清理：原来这里还有 github.* 六个能力和一个 "github" domain（查看/修改 GitHub
// 组织、成员、仓库、团队、邀请），#274 把 GitHub 组织管理整组功能删除之后就没有任何接口按它们判定
// （lib/access.ts 的 computeAccess() 虽然还在算这些能力，但它唯一的调用方 access.resolve() 在生产
// 路由里零调用，见 services.ts 的 access 服务；/api/console/catalogue 本身也已经删除，不是本次改动
// 新发现的）。grep 全仓确认零读者后删掉：GITHUB_CAPABILITIES 导出、IMPLIES 里五条指向
// github.org.read 的蕴含关系、ROLE_BASE 里 head/member/alumni 的 github.org.read 授予、
// DEFAULT_DEPARTMENTS 三个部门 head_capabilities 里的 github.* 项。
export type CapabilityDomain = "console" | "forum" | "applications" | "feedback" | "audit" | "roles" | "competitions" | "accounts";
export const DOMAINS: { id: CapabilityDomain; label: string }[] = [
  { id: "console", label: "控制台" },
  { id: "applications", label: "招新投递" },
  { id: "forum", label: "论坛" },
  { id: "feedback", label: "意见箱" },
  { id: "audit", label: "审计" },
  { id: "roles", label: "称号与权限" },
  { id: "competitions", label: "比赛" },
  { id: "accounts", label: "账号" },
];

/** 能力清单：扁平、按类别分组。顺序即 `/api/console/me` 下发 capabilities 的顺序。 */
export const CAPABILITIES = [
  { id: "console.access", domain: "console", label: "进入控制台", description: "进入控制台；持有任意一项能力就自动获得" },
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
  { id: "roles.manage", domain: "roles", label: "管理称号与部门", description: "管理称号和任免；部门配置与删除另需提督身份；只能给最高两级称号" },
  { id: "roles.department.manage", domain: "roles", label: "任免本部门成员", description: "任免自己负责的部门里的成员" },
  { id: "competitions.manage", domain: "competitions", label: "管理比赛", description: "新建、编辑、下线比赛" },
  { id: "accounts.invites.manage", domain: "accounts", label: "管理注册邀请码", description: "新建、停用注册邀请码；用邮箱或 Google 注册极客班账号要填邀请码" },
] as const satisfies readonly { id: string; domain: CapabilityDomain; label: string; description: string }[];
export type Capability = (typeof CAPABILITIES)[number]["id"];
export const CAPABILITY_IDS: Capability[] = CAPABILITIES.map(item => item.id);
const CAPABILITY_SET = new Set<string>(CAPABILITY_IDS);
export const isCapability = (value: unknown): value is Capability => typeof value === "string" && CAPABILITY_SET.has(value);
export const capabilityLabel = (id: Capability) => CAPABILITIES.find(item => item.id === id)?.label ?? id;

/** 只有提督和舰长能持有，不能放进任何部门权限包。 */
export const CAPTAIN_ONLY: Capability[] = ["roles.manage"];
/** 可以下放到部门权限包的能力。 */
export const DELEGATABLE: Capability[] = CAPABILITY_IDS.filter(id => !CAPTAIN_ONLY.includes(id));
export const FORUM_CAPABILITIES: Capability[] = CAPABILITY_IDS.filter(id => id.startsWith("forum."));

/** 蕴含关系：持有左边即同时获得右边。计算时取闭包。 */
export const IMPLIES: Partial<Record<Capability, Capability[]>> = {
  "applications.review": ["applications.read"],
  "applications.export": ["applications.read"],
  "feedback.manage": ["feedback.read"],
  "roles.manage": ["roles.department.manage"],
};

/** 称号权限包的默认值（写进 `titles` 表后以数据库为准）；`head`/带部门的 `member` 另加部门权限包，`admin` 永远是全部。 */
export const ROLE_BASE: Record<TitleId, Capability[]> = {
  admin: [...CAPABILITY_IDS],
  captain: [...CAPABILITY_IDS],
  head: ["console.access", "feedback.read", "roles.department.manage"],
  member: ["console.access"],
  alumni: ["console.access", "feedback.read"],
  guest: [],
};

export const TITLE_IDS = Object.keys(TITLES) as TitleId[];
export const TITLE_TAG_PATTERN = "^[A-Z][A-Z0-9-]{1,15}$";
/** 称号在数据库里的样子（见 `titles` 表）。 */
export type TitleConfig = { id: TitleId; label: string; tag: string; icon: string; tone: Tone; description: string; capabilities: Capability[] };
export type TitleConfigs = Record<TitleId, TitleConfig>;
export const DEFAULT_TITLE_CONFIGS: TitleConfigs = Object.fromEntries(TITLE_IDS.map(id => {
  const { label, tag, icon, tone, description } = TITLES[id];
  return [id, { id, label, tag, icon, tone, description, capabilities: [...ROLE_BASE[id]] }];
})) as TitleConfigs;

/**
 * 称号权限包的规则：提督永远拥有全部能力（他是最后能把权限改回来的人，不能被收权）；乘客是没登录的人，没有权限包；
 * `roles.manage` 除了提督只能放进舰长的权限包。返回错误码，合法时返回 null。
 */
export function titleBundleError(id: TitleId, bundle: readonly Capability[]): "title_capabilities_fixed" | "captain_only_capability" | null {
  if (id === "admin" || id === "guest") return "title_capabilities_fixed";
  if (id !== "captain" && bundle.some(capability => CAPTAIN_ONLY.includes(capability))) return "captain_only_capability";
  return null;
}

/** 投递状态；cancelled 不发信，旧的 reviewing 启动时改回 received（lib/db.ts）。 */
export const APPLICATION_STATUSES = [
  { id: "received", label: "已收到" },
  { id: "interview", label: "待面试" },
  { id: "accepted", label: "已录取" },
  { id: "rejected", label: "未通过" },
  { id: "cancelled", label: "已取消" },
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]["id"];
export const APPLICATION_STATUS_IDS: ApplicationStatus[] = APPLICATION_STATUSES.map(item => item.id);

export type Department = {
  id: string; name: string; tag: string; icon: DepartmentIcon; tone: Tone; description: string;
  head_capabilities: Capability[]; member_capabilities: Capability[]; sort_order: number; archived: boolean;
};
export const DEPARTMENT_ID_PATTERN = "^[a-z][a-z0-9-]{1,31}$";
export const DEPARTMENT_TAG_PATTERN = "^[A-Z][A-Z0-9-]{1,15}$";

/** 默认部门：启动时 INSERT OR IGNORE，控制台里改过的部门不会被覆盖。 */
export const DEFAULT_DEPARTMENTS: Omit<Department, "archived">[] = [
  {
    id: "recruitment", name: "招新部", tag: "RECRUIT", icon: "user-follow", tone: "coral", sort_order: 10,
    description: "负责招新宣传、投递评估与面试安排",
    head_capabilities: ["applications.read", "applications.review", "applications.export"],
    member_capabilities: ["applications.read", "applications.review"],
  },
  {
    id: "tech", name: "技术部", tag: "TECH", icon: "terminal", tone: "jade", sort_order: 20,
    description: "负责组织仓库、基础设施与技术规范",
    head_capabilities: ["audit.read"],
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
    head_capabilities: ["forum.topic.pin"],
    member_capabilities: [],
  },
];

/** `account_id`：指派给的极客班账号（#262）；还没登录过本站的人为空，第一次登录时按 GitHub id 认领。 */
export type AssignmentRow = {
  id: number; github_login: string; github_user_id: number | null; account_id: string | null; role: AssignableRole; department_id: string;
  note: string | null; granted_by: string; created_at: number;
};
export type DepartmentView = { id: string; name: string; tag: string; icon: string; tone: Tone };
export type TitleView = {
  id: TitleId; label: string; tag: string; icon: string; tone: Tone;
  department: DepartmentView | null;
  /** assignment：指派来的；site：站内角色自动给的（提督、舰员）；none：乘客 */
  source: "assignment" | "site" | "none";
  assignment_id: number | null;
};
/** 站内角色：账号记下的（users.org_role），管理员是提督，成员是舰员；null 是还没有角色。 */
export type OrgRole = "admin" | "member" | null;
export type Access = {
  login: string;
  /** 站内角色，不论这次用哪种方式登录（#262，所有者 2026-10-23 表示与 GitHub 相关的权限要放权） */
  siteRole: OrgRole;
  /** 是不是极客班成员：账号记下的成员资格 */
  member: boolean;
  titles: TitleView[];
  capabilities: Set<Capability>;
  /** 该用户担任负责人的部门 id（仅未归档部门）。 */
  headOf: string[];
};

/** 权限包去重、按清单排序，并剔除仅舰长能力与未知项。 */
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

export function titleView(role: TitleId, department: Department | null, source: TitleView["source"], assignmentId: number | null, configs: TitleConfigs = DEFAULT_TITLE_CONFIGS): TitleView {
  const base = configs[role];
  if (role === "head") {
    return {
      id: "head", label: department ? `${department.name} · ${base.label}` : base.label, tag: base.tag,
      icon: department?.icon ?? base.icon, tone: department?.tone ?? base.tone,
      department: department ? departmentView(department) : null, source, assignment_id: assignmentId,
    };
  }
  if (role === "member" && department) {
    return {
      id: "member", label: `${department.name} · ${base.label}`, tag: base.tag, icon: department.icon, tone: CREW_TITLE.tone,
      department: departmentView(department), source, assignment_id: assignmentId,
    };
  }
  return { id: role, label: base.label, tag: base.tag, icon: base.icon, tone: base.tone, department: null, source, assignment_id: assignmentId };
}

export function titleRank(title: Pick<TitleView, "id" | "department">): number {
  if (title.id === "member" && title.department) return CREW_TITLE.rank;
  return TITLES[title.id].rank;
}

export type ComputeAccessInput = {
  login: string;
  siteRole: OrgRole;
  /** 不传时按站内角色判断 */
  member?: boolean;
  assignments: AssignmentRow[];
  departments: Department[];
  /** 数据库里的称号设置；不传时用默认值（只给测试和纯函数调用用）。 */
  titles?: TitleConfigs;
};

/**
 * 纯函数：由站内角色、显式指派与部门配置算出称号和能力。不是成员的人（站内角色改成「不是成员」、
 * 或还没有账号）称号照常列出，方便控制台收回，但没有任何能力。
 * #276 挪来的 #274 清理：原来这里还提着「没有 GitHub 上限，github.* 按称号给，真正去 GitHub 上做由
 * lib/github-connection.ts 执行」——那六个 github.* 能力和 lib/github-connection.ts 都已经删除
 * （CONTRACT-274 §8），这条函数本身（以及唯一的调用方 lib/access.ts 的 access.resolve()）在生产
 * 路由里也已经零调用，只剩 tests/server/signin-methods.test.ts 单测它；没有在这轮一并删除，因为
 * 那是比「去掉 github.* 能力」更大的一个决定，留给所有者或团队负责人另外定。
 */
export function computeAccess({ login, siteRole, member = siteRole !== null, assignments, departments, titles: configs = DEFAULT_TITLE_CONFIGS }: ComputeAccessInput): Access {
  const byId = new Map(departments.filter(item => !item.archived).map(item => [item.id, item]));
  const titles: TitleView[] = [];
  const granted: Capability[] = [];
  const headOf: string[] = [];

  for (const row of assignments) {
    if (row.role === "captain") {
      titles.push(titleView("captain", null, "assignment", row.id, configs));
      granted.push(...configs.captain.capabilities);
    } else if (row.role === "head") {
      const department = byId.get(row.department_id);
      if (!department) continue; // 部门已归档或不存在：不再授予称号与能力
      titles.push(titleView("head", department, "assignment", row.id, configs));
      granted.push(...configs.head.capabilities, ...department.head_capabilities);
      headOf.push(department.id);
    } else if (row.role === "member") {
      const department = row.department_id ? byId.get(row.department_id) : null;
      if (row.department_id && !department) continue;
      titles.push(titleView("member", department ?? null, "assignment", row.id, configs));
      granted.push(...configs.member.capabilities, ...(department?.member_capabilities ?? []));
    } else if (row.role === "alumni") {
      titles.push(titleView("alumni", null, "assignment", row.id, configs));
      granted.push(...configs.alumni.capabilities);
    }
  }

  // 提督：站内管理员自动获得，拥有全部能力；有没有指定舰长都一样（舰长由提督任命）。
  if (siteRole === "admin") {
    titles.push(titleView("admin", null, "site", null, configs));
    granted.push(...CAPABILITY_IDS); // 提督永远是全部，不读数据库
  }
  const hasAlumni = assignments.some(row => row.role === "alumni");
  const hasPlainMember = titles.some(title => title.id === "member" && !title.department);
  if (siteRole === "member" && !hasAlumni && !hasPlainMember) {
    titles.push(titleView("member", null, "site", null, configs));
    granted.push(...configs.member.capabilities);
  }

  const implied = closure(granted);
  const capabilities = new Set<Capability>(member ? CAPABILITY_IDS.filter(id => implied.has(id)) : []);
  if (capabilities.size > 0) capabilities.add("console.access");
  else capabilities.clear();

  titles.sort((a, b) => titleRank(a) - titleRank(b));
  if (titles.length === 0) titles.push(titleView("guest", null, "none", null, configs));
  return { login, siteRole, member, titles, capabilities, headOf: [...new Set(headOf)] };
}

export const orderedCapabilities = (set: ReadonlySet<Capability>): Capability[] => CAPABILITY_IDS.filter(id => set.has(id));
