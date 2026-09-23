// 控制台接口的前端类型。服务端 app/server/src/lib/roles.ts 是唯一来源；
// 控制台不能导入服务端实现，这里只声明 HTTP 形状，能力 id 与中文名以 /api/console/catalogue 为准。

export type Capability = string;
export type Tone = "amber" | "cobalt" | "violet" | "jade" | "sky" | "coral" | "rose" | "slate";
export type TitleId = "captain" | "head" | "member" | "alumni" | "guest";
export type BlockReason = "github_admin_required" | "github_membership_required";

export type DepartmentView = { id: string; name: string; tag: string; icon: string; tone: Tone };
export type TitleView = {
  id: TitleId; label: string; tag: string; icon: string; tone: Tone;
  department: DepartmentView | null;
  source: "assignment" | "bootstrap" | "github" | "none";
  assignment_id: number | null;
};

export type ConsoleMe = {
  login: string; avatar_url: string | null; org: string;
  github_role: "admin" | "member" | null;
  title: TitleView; titles: TitleView[];
  capabilities: Capability[];
  blocked: { capability: Capability; reason: BlockReason }[];
  bootstrap: boolean;
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

export type AssignableRole = Exclude<TitleId, "guest">;
export type Assignment = {
  id: number; github_login: string; github_user_id: number | null;
  role: AssignableRole; department_id: string; note: string | null; granted_by: string; created_at: number;
};
export type AssignmentsResponse = { assignments: Assignment[]; captain: { github_login: string } | null; bootstrap_active: boolean };

export type ApplicationStatus = "received" | "reviewing" | "interview" | "accepted" | "rejected";
export type ApplicationItem = {
  id: string; name: string; class_name: string; email: string; strengths_excerpt: string; status: ApplicationStatus; created_at: number;
  last_review: { to_status: ApplicationStatus; reviewer: string; created_at: number } | null;
};
export type ApplicationList = { items: ApplicationItem[]; total: number; counts: Record<string, number> };
export type ApplicationReview = { id: number; from_status: ApplicationStatus; to_status: ApplicationStatus; note: string | null; reviewer: string; created_at: number };
export type ApplicationDetail = {
  application: { id: string; name: string; class_name: string; email: string; strengths: string; status: ApplicationStatus; created_at: number };
  reviews: ApplicationReview[];
};

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
