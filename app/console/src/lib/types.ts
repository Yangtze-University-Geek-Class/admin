// 控制台接口的前端类型。服务端 app/server/src/lib/roles.ts 是唯一来源；
// 控制台不能导入服务端实现，这里只声明 HTTP 形状，能力 id 与中文名以 /api/console/catalogue 为准。

export type Capability = string;
export type Tone = "amber" | "cobalt" | "violet" | "jade" | "sky" | "coral" | "rose" | "slate";
/** `admin` 是 GitHub 组织的所有者，自动获得、不能指派；`guest` 是没有任何称号。名字等显示信息见 catalogue。 */
export type TitleId = "admin" | "captain" | "head" | "member" | "alumni" | "guest";
export type GithubRole = "admin" | "member" | null;
export type BlockReason = "github_admin_required" | "github_membership_required";

export type DepartmentView = { id: string; name: string; tag: string; icon: string; tone: Tone };
export type TitleView = {
  id: TitleId; label: string; tag: string; icon: string; tone: Tone;
  department: DepartmentView | null;
  source: "assignment" | "github" | "none";
  assignment_id: number | null;
};

export type ConsoleMe = {
  login: string; avatar_url: string | null; org: string;
  github_role: GithubRole;
  title: TitleView; titles: TitleView[];
  capabilities: Capability[];
  blocked: { capability: Capability; reason: BlockReason }[];
  head_of: string[];
};

export type CatalogueCapability = { id: Capability; domain: string; label: string; description: string };
export type CatalogueTitle = { id: TitleId; label: string; tag: string; icon: string; tone: Tone; rank: number; description: string };
export type Catalogue = {
  titles: CatalogueTitle[];
  crew: { tag: string; tone: Tone; rank: number };
  tones: Record<Tone, string>;
  capabilities: CatalogueCapability[];
  domains: { id: string; label: string }[];
  role_base: Record<TitleId, Capability[]>;
  implies?: Record<string, Capability[]>;
  captain_only: Capability[];
  department_icons: string[];
  application_statuses: { id: string; label: string }[];
};

export type Department = DepartmentView & {
  description: string; head_capabilities: Capability[]; member_capabilities: Capability[];
  sort_order: number; archived: boolean; heads: string[]; crew_count: number;
};

export type AssignableRole = Exclude<TitleId, "admin" | "guest">;
export type Assignment = {
  id: number; github_login: string; github_user_id: number | null;
  role: AssignableRole; department_id: string; note: string | null; granted_by: string; created_at: number;
};
export type AssignmentsResponse = { assignments: Assignment[]; captain: { github_login: string } | null };

/** GET /api/console/people：GitHub 组织里的每个人，加上有称号但已经不在组织里的人（github_role 为 null）。 */
export type Person = { login: string; user_id: number | null; avatar_url: string | null; github_role: GithubRole; titles: TitleView[] };
export type PeopleResponse = { people: Person[] };

/** 称号在服务端存的样子；PATCH /api/console/titles/:title_id 只提交改动的字段，返回改后的整条。 */
export type TitleConfig = { id: TitleId; label: string; tag: string; icon: string; tone: Tone; description: string; capabilities: Capability[] };
export type TitlePatch = Partial<Omit<TitleConfig, "id">>;
export type TitlePatchResponse = { title: TitleConfig };

/** 投递现在只有这四种状态（#148 去掉了「评估中」）；审核记录里的旧状态按字符串收，见 statuses.ts 的 statusMeta。 */
export type ApplicationStatus = "received" | "interview" | "accepted" | "rejected";
export type ApplicationItem = {
  id: string; name: string; class_name: string; email: string; strengths_excerpt: string; status: ApplicationStatus; created_at: number;
  last_review: { to_status: string; reviewer: string; created_at: number } | null;
};
export type ApplicationList = { items: ApplicationItem[]; total: number; counts: Record<string, number> };

/** 一封信在发信队列里的状态；地址和正文发完就删，只留主题。 */
export type MailStatus = "pending" | "sending" | "sent" | "failed" | "skipped";
export type MailSummary = {
  status: MailStatus; skip_reason: string | null; attempts: number; subject: string; sent_at: number | null; updated_at: number;
};
/** deliverable：给这位投递人的信现在会不会真的发出去（发信已配置，且在预发布的白名单里）。 */
export type MailSettings = { enabled: boolean; recipients: "all" | "allowlist"; deliverable: boolean };

/** from_status / to_status 是历史：可能是已退役的 `reviewing`。mail 是这次改状态发的信，没发为 null。 */
export type ApplicationReview = {
  id: number; from_status: string; to_status: string; note: string | null; reviewer: string; created_at: number; mail: MailSummary | null;
};
export type ApplicationRecord = { id: string; name: string; class_name: string; email: string; strengths: string; status: ApplicationStatus; created_at: number };
export type ApplicationDetail = {
  application: ApplicationRecord;
  reviews: ApplicationReview[];
  /** 投递时自动发的「已收到」确认信。 */
  received_mail: MailSummary | null;
  mail: MailSettings;
};
/** 通知信里投递人能看到的内容；notes 与 message 一行一条。 */
export type ApplicationLetter = { time?: string; place?: string; notes?: string; message?: string };
/**
 * PATCH /api/console/applications/:id。note 只给审核人看，不进信；notify 默认 true。
 * expected_status、expected_review_id 是页面上看到的状态和审核记录的版本号（最大的审核记录 id，没有记录时是 0）；
 * 库里已经被别人处理过时服务端回 409 status_changed，不改也不发信。要改状态时两项都得带。
 */
export type ApplicationReviewPatch = {
  status?: ApplicationStatus; expected_status?: ApplicationStatus; expected_review_id?: number; note?: string; notify?: boolean; letter?: ApplicationLetter;
};
export type ApplicationReviewResult = { application: ApplicationRecord; review: ApplicationReview };

export type Summary = {
  applications?: { total: number; by_status: Record<string, number>; last_7d: number };
  feedback?: { open: number; total: number };
  people?: { assignments: number; departments: number };
};

export type FeedbackStatus = "open" | "triaged" | "in_progress" | "done" | "wont_do" | "spam";
export type FeedbackItem = {
  id: number; category: string | null; content: string; contact: string | null; submitter_login: string | null;
  status: FeedbackStatus; reply: string | null; replied_by: string | null; replied_at: number | null; created_at: number;
};
export type FeedbackList = { items: FeedbackItem[]; counts: Record<string, number> };

export type AuditRow = { id: number; actor: string; action: string; target: string | null; ip: string | null; details: unknown; created_at: number };
