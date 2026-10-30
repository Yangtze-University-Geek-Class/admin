// 控制台接口的前端类型。HTTP 形状以 .tools/handoff/2026-10-23-yugc-os-v2/CONTRACT-274.md 为准，
// 控制台不能导入服务端实现，这里只手写一份声明。

export type Permission = string;
/** 部门色调（SPEC §1）：AI=y、算法=u、硬件=c、网安=g、管理=pill，无部门=ink。 */
export type DeptTone = "y" | "u" | "c" | "g" | "pill" | "ink";
/** 状态标签的色调（ToneTag.vue），和部门色调是两套独立的取值。 */
export type Tone = "amber" | "cobalt" | "violet" | "jade" | "sky" | "coral" | "rose" | "slate";

/** 这次会话的登录方式；权限只看账号，登录方式只决定这次能借用哪种本人授权。 */
export type SessionProvider = "github" | "email" | "google";
/** 四种身份，按 访客 → 注册用户 → 成员 依次升级；往届成员是成员的平行分支。 */
export type Level = "visitor" | "registered" | "member" | "alumni";

export type DepartmentRef = { id: string; name: string; tone: DeptTone };
/** 年级（#280）：1–4 是大一到大四，大四之后由时间推出已毕业；下拉框能选 1–4 和已毕业。 */
export type Grade = 1 | 2 | 3 | 4 | "graduated";
/** 下拉框能选的年级：大一到大四和已毕业（所有者 2026-10-24 22:05） */
export type SelectableGrade = Grade;
export type TitleRef = { id: string; name: string; department_id: string | null };

/** GET /api/console/me：控制台会话身份；permissions 是这个账号在控制台用得到的全部具体节点。 */
export type ConsoleMe = {
  account_id: string; login: string; username: string; display_name: string; avatar_url: string | null;
  level: Level; level_name: string;
  department: DepartmentRef | null;
  titles: TitleRef[];
  permissions: Permission[];
  provider: SessionProvider;
  email_required: boolean;
  /** 缺真实姓名或年级（#280）：先去补资料页 */
  profile_required: boolean;
};

/** GET /api/public/departments：公开的部门列表，顺序固定为 AI、算法、硬件、网安、管理、无部门。 */
export type PublicDepartment = {
  id: string; name: string; tone: DeptTone; icon: string; description: string;
  titles: { id: string; name: string; weight: number }[];
};
export type PublicDepartmentsResponse = { departments: PublicDepartment[] };

// ---- 用户（GET /api/console/users、PATCH /api/console/users/:id） ----

export type GitlabSyncState = "synced" | "pending" | "failed" | "blocked" | "none";
export type UserStatus = "active" | "disabled";
export type ConsoleUser = {
  account_id: string; username: string; display_name: string; avatar_url: string | null; status: UserStatus;
  /** 真实姓名只回给有 users.manage 的调用者（#280），没有这个权限时没有这个键 */
  real_name?: string | null; grade: Grade | null; grade_label: string | null;
  level: Level; department: DepartmentRef | null; titles: TitleRef[]; providers: SessionProvider[];
  gitlab: { state: GitlabSyncState; gitlab_user_id: number | null };
  last_login_at: number | null; created_at: number;
};
export type UsersCounts = { visitor_today: number; registered: number; member: number; alumni: number };
export type UsersResponse = { items: ConsoleUser[]; next_cursor: string | null; counts: UsersCounts };
export type UserPatch = Partial<{ status: UserStatus; level: Level; department: string | null; titles: string[]; real_name: string; grade: SelectableGrade }>;

// ---- 权限（节点、组、解释） ----

export type PermissionNodeDef = { node: Permission; domain: string; label: string; description: string; meta: boolean };
export type PermissionDomain = { id: string; label: string };
export type PermissionNodesResponse = { nodes: PermissionNodeDef[]; domains: PermissionDomain[] };

export type PermissionScope = Record<string, unknown>;
export type PermissionGroupKind = "level" | "department" | "title" | "custom";
export type PermissionEntry = {
  id: number; node: Permission; value: boolean | null; meta_value: string | null; scope: PermissionScope; expires_at: number | null;
};
export type PermissionGroup = {
  id: string; kind: PermissionGroupKind; name: string; description: string; weight: number;
  department_id: string | null; icon: string; tone: DeptTone; sort: number; system: boolean;
  parents: string[]; member_count: number; entries: PermissionEntry[];
};
export type PermissionGroupsResponse = { groups: PermissionGroup[] };
/** GET /api/console/permission-groups/:id/members：组里的账号（CONTRACT §5，10-24 00:10 补）。 */
export type PermissionGroupMember = {
  account_id: string; username: string; display_name: string; avatar_url: string | null;
  expires_at: number | null; granted_by: string | null; created_at: number;
};
export type PermissionGroupMembersResponse = { members: PermissionGroupMember[] };
/** POST /api/console/permission-groups 的请求体。 */
export type PermissionGroupCreate = { id: string; name: string; description?: string; weight: number; parents?: string[]; icon?: string; tone?: DeptTone };
/** PATCH /api/console/permission-groups/:id 的请求体；entries 只带增删。 */
export type PermissionEntryInput = { node: Permission; value?: boolean; meta_value?: string; scope?: PermissionScope; expires_at?: number | null };
export type PermissionGroupPatch = Partial<{
  name: string; description: string; weight: number; parents: string[]; icon: string; tone: DeptTone; sort: number;
  entries: { add: PermissionEntryInput[]; remove: number[] };
}>;

export type PermissionExplainResult = "allow" | "deny" | "unset";
export type PermissionExplainHit = {
  source: "account" | "group"; group: { id: string; name: string } | null; via: string[];
  entry: { node: Permission; value: boolean | null; scope: PermissionScope; expires_at: number | null };
};
export type PermissionExplain = { node: Permission; result: PermissionExplainResult; hits: PermissionExplainHit[]; meta_value?: string };
export type EffectivePermissions = {
  account_id: string; groups: { id: string; name: string; kind: PermissionGroupKind; via: string[] }[];
  allow: Permission[]; deny: Permission[]; meta: Record<string, string>;
};

// ---- 操作记录 ----

export type ActivitySurface = "portal" | "forum" | "console" | "cli" | "api" | "system" | "gitlab";
export type ActivityOutcome = "ok" | "denied" | "limited" | "error";
export type ActivityAccountRef = { id: string; username: string; display_name: string; avatar_url: string | null };
export type ActivityEvent = {
  id: number; at: number; account: ActivityAccountRef | null; visitor_id: string | null;
  surface: ActivitySurface; action: string; target_type: string | null; target_id: string | null;
  outcome: ActivityOutcome; ip: string | null; ua: string | null; request_id: string | null; meta: Record<string, unknown>;
};
export type ActivityBlockedBucket = { bucket: string; count: number };
/** 某个账号的记录（GET /api/console/accounts/:id/activity）：只按游标往后读。 */
export type ActivityPage = { items: ActivityEvent[]; next_cursor: string | null };
/** 操作记录页（GET /api/console/activity）：`total` 是筛选条件下的总条数，按 `offset` 翻页（#370）。 */
export type ActivityList = ActivityPage & { total: number; blocked_today: ActivityBlockedBucket[] };

// ---- GitLab ----

export type GitlabSyncMode = "off" | "dry-run" | "on";
export type GitlabStatus = {
  mode: GitlabSyncMode; url: string | null; group: string; token_configured: boolean; version: string | null;
  healthy: boolean; last_run: { at: number; changed: number; failed: number } | null; errors_24h: number;
};
export type GitlabProjectGroup = { id: number; full_path: string; name: string; visibility: string };
export type GitlabProject = {
  id: number; path_with_namespace: string; name: string; description: string | null; visibility: string;
  web_url: string; http_url_to_repo: string; ssh_url_to_repo: string; last_activity_at: number | null; star_count: number;
};
export type GitlabProjectsResponse = { groups: GitlabProjectGroup[]; projects: GitlabProject[] };
export type GitlabSettings = { sync_mode: GitlabSyncMode; group_path: string; interval_minutes: number; token_configured: boolean };

/** GitLab 账号同步（#270，沿用原形状，GET /api/console/gitlab/accounts）。 */
export type GitlabAction =
  | { kind: "create"; username: string; access_level: number }
  | { kind: "block" | "unblock" | "find_and_block" | "set_avatar" | "set_emails" }
  | { kind: "set_access"; access_level: number };
export type GitlabAccount = {
  account_id: string; login: string; username: string | null; gitlab_user_id: number | null;
  state: "pending" | "active" | "blocked" | null; access_level: number | null;
  last_error: string | null; last_error_at: number | null; synced_at: number | null; pending: GitlabAction[];
};
export type GitlabAccountsResponse = { mode: GitlabSyncMode; gitlab_url: string | null; group: string; client_registered: boolean; accounts: GitlabAccount[] };
export type GitlabSyncOutcome = { mode: GitlabSyncMode; account_id: string; login: string; actions: GitlabAction[]; applied: boolean; error: string | null };

// ---- 概览 ----

export type Summary = {
  applications?: { total: number; by_status: Record<string, number>; last_7d: number };
  candidates_pending?: number;
  registrations_today?: number;
  blocked_today?: number;
  gitlab?: { mode: GitlabSyncMode; healthy: boolean; last_run: { at: number; changed: number; failed: number } | null };
  feedback?: { open: number; total: number };
};

// ---- 投递（#148，不受本次权限改版影响） ----

export type ApplicationStatus = "received" | "interview" | "accepted" | "rejected" | "cancelled";
export type ApplicationItem = {
  id: string; name: string; class_name: string; email: string; strengths_excerpt: string; status: ApplicationStatus; created_at: number;
  last_review: { to_status: string; reviewer: string; created_at: number } | null;
};
export type ApplicationList = { items: ApplicationItem[]; total: number; counts: Record<string, number> };
/** 招新总开关（GET/PATCH /api/console/applications/settings，#284）；updated_at 为 null 表示从没改过，等于默认开放。 */
export type ApplySettings = { open: boolean; updated_at: number | null };

export type MailStatus = "pending" | "sending" | "sent" | "failed" | "skipped";
export type MailSummary = {
  status: MailStatus; skip_reason: string | null; attempts: number; subject: string; sent_at: number | null; updated_at: number;
};
export type MailSettings = { enabled: boolean; recipients: "all" | "allowlist"; deliverable: boolean };

export type ApplicationReview = {
  id: number; from_status: string; to_status: string; note: string | null; reviewer: string; created_at: number; mail: MailSummary | null;
};
export type ApplicationRecord = { id: string; name: string; class_name: string; email: string; strengths: string; status: ApplicationStatus; created_at: number };
export type ApplicationDetail = {
  application: ApplicationRecord;
  reviews: ApplicationReview[];
  received_mail: MailSummary | null;
  mail: MailSettings;
  /** 改状态时能选的信（#285）：待面试、已录取、未通过各自启用的模板，只有名字；旧版本的服务端没有这一项 */
  letter_templates?: LetterTemplates;
};
export type ApplicationLetter = { time?: string; place?: string; notes?: string; message?: string };
export type ApplicationReviewPatch = {
  status?: ApplicationStatus; expected_status?: ApplicationStatus; expected_review_id?: number; note?: string; notify?: boolean; template_id?: string; letter?: ApplicationLetter;
};
export type ApplicationReviewResult = { application: ApplicationRecord; review: ApplicationReview };

// ---- 招聘邮件模板（#285） ----

export type MailKind = "received" | "interview" | "accepted" | "rejected";
export type MailBlockKind = "paragraph" | "list" | "facts" | "quote";
export type MailFact = { label: string; value: string };
export type MailBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; title?: string; items: string[] }
  | { kind: "facts"; title?: string; items: MailFact[] }
  | { kind: "quote"; title: string; text: string };
export type MailButton = { label: string; path: string };
/** 一封信的文字：主题、摘要、小标题、抬头、正文块、按钮、页脚；保存和预览的请求体里平铺这几项 */
export type MailTemplateContent = {
  subject: string; preheader: string; kicker: string; greeting: string; blocks: MailBlock[]; button: MailButton | null; footer: string[];
};
export type MailTemplate = MailTemplateContent & {
  id: string; name: string; kind: MailKind; enabled: boolean; is_default: boolean;
  created_by: string; created_at: number; updated_by: string; updated_at: number;
};
export type MailVariable = {
  name: string; group: string; group_label: string; description: string; kinds: MailKind[]; multiline: boolean;
};
/** 服务端 TEMPLATE_LIMITS：各项文字的长度上限，编辑页的字数提示用它 */
export type MailTemplateLimits = {
  name: number; subject: number; preheader: number; kicker: number; greeting: number;
  blocks: number; paragraph: number; title: number; listItems: number; listItem: number; factItems: number; factLabel: number; factValue: number; quote: number;
  footerLines: number; footerLine: number; buttonLabel: number; buttonPath: number; totalText: number;
};
export type MailTemplateList = {
  templates: MailTemplate[];
  kinds: { id: MailKind; label: string }[];
  block_kinds: { id: MailBlockKind; label: string }[];
  variables: MailVariable[];
  limits: MailTemplateLimits;
  mail: { enabled: boolean; recipients: "all" | "allowlist"; reply_to: boolean };
  test_send: { per_hour_per_account: number; per_hour_site: number };
};
/** 保存时服务端指出的问题：path 是出问题的字段，例如 subject、blocks[1].text、button.path；空串是整份模板的问题 */
export type MailTemplateIssue = { path: string; message: string };
export type MailRendered = { subject: string; html: string; text: string };
export type MailTestSend = { status: "sent" | "failed" | "skipped" | "pending"; skip_reason: string | null; error: string | null; subject: string; to: string };
export type LetterTemplateOption = { id: string; name: string; is_default: boolean };
export type LetterTemplates = Record<"interview" | "accepted" | "rejected", LetterTemplateOption[]>;

// ---- 意见箱 ----

export type FeedbackStatus = "open" | "triaged" | "in_progress" | "done" | "wont_do" | "spam";
export type FeedbackItem = {
  id: number; category: string | null; content: string; contact: string | null; submitter_login: string | null;
  status: FeedbackStatus; reply: string | null; replied_by: string | null; replied_at: number | null; created_at: number;
};
export type FeedbackList = { items: FeedbackItem[]; counts: Record<string, number> };

// ---- 比赛（#238/#239，不受本次权限改版影响） ----

export type CompetitionStatus = "planning" | "upcoming" | "registering" | "closed" | "ongoing" | "ended";
export type CompetitionKind = "internal" | "external";
export type CompetitionRecord = {
  id: string; name: string; kind: CompetitionKind;
  start_at: number; end_at: number; signup_deadline: number | null;
  url: string | null; description: string; status: CompetitionStatus; offline: boolean;
  /** 规划中（#278）：组织者还在筹备，开赛前拒绝报名与组队；表单控件由主会话接上。 */
  planning: boolean;
};

export type SignupParticipation = "individual" | "team";
export type SignupScoring = "none" | "contribution";
export type SignupSettings = {
  enabled: boolean; participation: SignupParticipation; team_min: number; team_max: number; scoring: SignupScoring;
};

export type RosterStats = { signups: number; teams: number; locked_teams: number; confirmed_people: number; unplaced: number };
export type RosterPerson = { account_id: string; login: string; avatar_url: string | null };
export type RosterSignup = RosterPerson & {
  status: "active" | "cancelled"; note: string; looking_for_team: boolean;
  team_id: string | null; team_name: string | null; role: "leader" | "member" | null;
  created_at: number; updated_at: number; cancelled_at: number | null;
};
export type RosterTeamMember = RosterPerson & { role: "leader" | "member"; joined_at: number };
export type RosterTeam = {
  id: string; name: string; slogan: string; status: "recruiting" | "locked" | "disbanded";
  leader_account_id: string; members: RosterTeamMember[]; member_count: number;
  created_at: number; disbanded_at: number | null;
};
export type CompetitionRoster = { settings: SignupSettings; stats: RosterStats; signups: RosterSignup[]; teams: RosterTeam[] };
/** `DELETE .../signups/:account_id`（#342）：移出后对队伍做了什么，已确认的队伍是否退回招募中。 */
export type SignupRemoval = { team_action: "none" | "left" | "transferred" | "disbanded"; unlocked: boolean };

export type ScoreKind = "issue" | "pr" | "penalty";
/** 两档评定（#278，所有者 2026-10-24 16:59）：重要程度与核心度，基础分查表。 */
export type Importance = "normal" | "important" | "critical";
export type Core = "edge" | "business" | "core";
export type ScoreEvent = {
  id: string; competition_id: string; person: RosterPerson; kind: ScoreKind;
  repo: string | null; number: number | null;
  /** 基础分：两档查表的结果，扣分是 -50；两档评定之前登记的是当时手填的分。 */
  points: number; reason: string;
  importance: Importance | null; core: Core | null;
  /** #278：记分那一刻的年级与系数（百分数，350 = 3.5）和乘过系数的分；#278 之前的记录年级为 null、系数按 1 算。 */
  grade: GradeKey | null; grade_factor: number | null; weighted_points: number;
  /** 防刷折扣：100 照算，0 是这一周已经照算过一条「一般 × 边缘」。之前的记录为 null。 */
  damp_percent: number | null;
  contributed_at: number | null;
  status: "active" | "revoked"; created_by_login: string; created_at: number;
  revoked_at: number | null; revoke_reason: string | null;
};
export type ScoreEventList = { events: ScoreEvent[] };
/** `GET .../score-preview`：登记前试算，和真正登记是同一套算法。 */
export type ScorePreview = { points: number; grade: GradeKey | null; grade_factor: number; damp_percent: number; weighted_points: number };

// ---- 比赛官网、候选贡献、计分规则、定榜与兑奖（#278） ----

export type GradeKey = "year1" | "year2" | "year3" | "year4" | "graduated" | "none";
export type ContestPerson = { account_id: string; username: string; display_name: string; avatar_url: string | null };

export type SiteVersion = {
  id: string; version: string; size: number; files: number; sha256: string; status: "passed" | "rejected"; report: string[];
  uploaded_by: { account_id: string; username: string; display_name: string }; created_at: number; preview_url: string | null;
};
export type SiteState = { slug: string | null; live_version_id: string | null; site_url: string | null; versions: SiteVersion[] };

export type CandidateStatus = "pending" | "accepted" | "rejected";
export type Candidate = {
  id: string; account: ContestPerson; kind: "pr" | "issue"; gitlab_project: string; gitlab_iid: number; url: string; title: string;
  /** 待确认的是 GitLab 标签上现在的两档（没有为 null），加过分的是加分时用的两档。 */
  importance: Importance | null; core: Core | null; status: CandidateStatus; final_points: number | null; reason: string | null;
  reviewed_by: ContestPerson | null; reviewed_at: number | null; accepted_via: "label" | "console" | null; note: string | null;
  contributed_at: number; created_at: number;
};
export type CollectRun = { at: number; fetched: number; created: number; skipped: number; accepted: number; revoked: number; error: string | null };
export type CandidateList = { items: Candidate[]; next_cursor: string | null; counts: Record<CandidateStatus, number>; last_run: CollectRun | null };

export type PrizeTier = { from: number; to: number; amount_cny: number; title: string };
/** 服务端的两档计分表（`scoring`）：官网、门户和控制台照它画表。 */
export type Scoring = {
  importance: { key: Importance; label: string }[];
  core: { key: Core; label: string; hint: string }[];
  points: { kind: "issue" | "pr"; importance: Importance; core: Core; points: number }[];
  penalty: number; trivial_per_week: number; trivial_percent: number;
};
export type CompetitionRules = {
  grade_factors: Record<GradeKey, number>; grades: { grade: GradeKey; label: string }[]; prizes: PrizeTier[]; gitlab_projects: string[];
  scoring: Scoring;
  updated_at: number | null; updated_by: ContestPerson | null; finalized: boolean;
};

export type CompetitionPrize = {
  id: string; competition_id: string; rank: number; points: number; amount_cny: number; title: string; account: ContestPerson;
  code_hint: string; created_at: number; redeemed_at: number | null; redeemed_by: ContestPerson | null;
};
export type FinalView = {
  finalized_at: number | null; finalized_by: ContestPerson | null;
  standings: { rank: number; points: number; account: ContestPerson }[];
  prizes: CompetitionPrize[];
  preview: { rank: number; points: number; account: ContestPerson; amount_cny: number | null; title: string | null }[];
};
export type RedeemPrize = CompetitionPrize & { competition_name: string };

// ---- 注册邀请码（节点改为 invite.manage，形状不变） ----

export type InviteCode = {
  id: number; code: string; note: string; max_uses: number | null; used_count: number; expires_at: number | null;
  disabled: boolean; created_by: string; created_at: number; updated_at: number; usable: boolean;
};
export type InviteList = { invites: InviteCode[] };

// ---- 账号页 /account（#262/#270/#272/#273，身份域，独立于控制台权限改版） ----

/** 账号页用的站内角色；只用于 /api/identity/me 的成员资格展示，和控制台的 Level/权限节点是两套概念。 */
export type SiteRole = "admin" | "member" | null;
export type AccountIdentity = { provider: SessionProvider; label: string; linked_at: number; last_login_at: number | null; id?: string; primary?: boolean };
export type AccountAction = "login" | "login_denied" | "logout" | "register" | "link" | "link_conflict" | "unlink" | "password_set" | "password_change" | "password_reset" | "role_change";
export type AccountView = {
  account_id: string; login: string;
  identities: AccountIdentity[];
  has_password: boolean; password_updated_at: number | null;
  membership: { state: string; org_role: SiteRole; via_invite: boolean };
  created_at: number;
  recent: { at: number; action: AccountAction | string; provider: string | null; result: "ok" | "denied" | "failed" }[];
  available: "email"[];
  email_required: boolean;
  /** 本人的真实姓名和年级（#280）；缺任何一项时 profile_required 为 true */
  real_name: string | null; grade: Grade | null; grade_label: string | null; profile_required: boolean;
  session: { provider: SessionProvider; created_at: number; expires_at: number; step_up_until: number };
};

/** 论坛管理（#276，CONTRACT-276 §8）：分类可见范围、表情包与表情 */
export type ForumVisibility = "public" | "registered" | "member";
export type ForumCategoryRow = { id: string; name: string; visibility: ForumVisibility; topic_count: number };
export type ForumCategoriesResponse = { categories: ForumCategoryRow[] };
export type ConsoleSticker = { id: string; shortcode: string; label: string; url: string; sort: number; enabled: boolean; use_count: number };
export type ConsoleStickerPack = { id: string; name: string; sort: number; enabled: boolean; stickers: ConsoleSticker[] };
export type ConsoleStickersResponse = { packs: ConsoleStickerPack[] };

export type SecurityDecoyStatus = {
  available: boolean; active: boolean; permanent: boolean; expires_at: number | null; now: number; max_minutes: number; shield_enabled: boolean;
};
export type SecurityBlock = {
  ip: string; level: number; blocked_until: number; reason: string; created_at: number; updated_at: number; retry_after: number;
};
export type SecurityBlocks = { blocks: SecurityBlock[] };
