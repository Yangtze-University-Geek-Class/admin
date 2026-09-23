// 控制台左侧导航：每一项声明所需能力（任一满足即可）。纯数据 + 纯函数，tests/console 直接测。
import type { BlockReason, Capability, ConsoleMe } from "./types";

export type NavItem = { id: string; to: string; label: string; anyOf: Capability[]; icon: string; group?: NavGroupId; end?: boolean };
export type NavGroupId = "recruit" | "community" | "github" | "class";
export type NavState = "visible" | "disabled" | "hidden";

export const FORUM_CAPABILITIES: Capability[] = ["forum.topic.pin", "forum.topic.close", "forum.post.moderate", "forum.category.manage", "forum.badge.assign"];
export const ROLE_CAPABILITIES: Capability[] = ["roles.manage", "roles.department.manage"];

export const NAV_GROUPS: { key: NavGroupId; label: string }[] = [
  { key: "recruit", label: "招新" },
  { key: "community", label: "社区" },
  { key: "github", label: "GitHub 组织" },
  { key: "class", label: "班务" },
];

export const CONSOLE_NAV: NavItem[] = [
  { id: "overview", to: "/console", label: "概览", anyOf: ["console.access"], icon: "i-carbon-dashboard", end: true },
  { id: "applications", to: "/console/applications", label: "投递管理", anyOf: ["applications.read"], icon: "i-carbon-document-attachment", group: "recruit" },
  { id: "forum", to: "/console/forum", label: "论坛管理", anyOf: FORUM_CAPABILITIES, icon: "i-carbon-forum", group: "community" },
  { id: "github-overview", to: "/console/github", label: "概况", anyOf: ["github.org.read"], icon: "i-carbon-logo-github", group: "github", end: true },
  { id: "github-members", to: "/console/github/members", label: "成员", anyOf: ["github.org.read"], icon: "i-carbon-user-multiple", group: "github" },
  { id: "github-repos", to: "/console/github/repos", label: "仓库", anyOf: ["github.org.read"], icon: "i-carbon-repo-source-code", group: "github" },
  { id: "github-teams", to: "/console/github/teams", label: "团队", anyOf: ["github.org.read"], icon: "i-carbon-group", group: "github" },
  { id: "github-activity", to: "/console/github/activity", label: "活动", anyOf: ["github.org.read"], icon: "i-carbon-activity", group: "github" },
  { id: "github-security", to: "/console/github/security", label: "安全", anyOf: ["github.org.read"], icon: "i-carbon-security", group: "github" },
  { id: "github-org", to: "/console/github/org", label: "组织资料", anyOf: ["github.org.read"], icon: "i-carbon-building", group: "github" },
  { id: "github-invitations", to: "/console/github/invitations", label: "邀请", anyOf: ["github.invites.manage"], icon: "i-carbon-email", group: "github" },
  { id: "github-invite-links", to: "/console/github/invite-links", label: "邀请链接", anyOf: ["github.invites.manage"], icon: "i-carbon-link", group: "github" },
  { id: "people", to: "/console/people", label: "成员与权限", anyOf: ROLE_CAPABILITIES, icon: "i-carbon-user-admin", group: "class" },
  { id: "feedback", to: "/console/feedback", label: "意见箱", anyOf: ["feedback.read"], icon: "i-carbon-chat", group: "class" },
  { id: "audit", to: "/console/audit", label: "审计日志", anyOf: ["audit.read"], icon: "i-carbon-catalog", group: "class" },
];

type Identity = Pick<ConsoleMe, "capabilities" | "blocked">;

/** 有能力 → visible；能力被 GitHub 组织角色挡住 → disabled（显示原因）；其它 → hidden。 */
export function navState(item: Pick<NavItem, "anyOf">, me: Identity): NavState {
  if (item.anyOf.some(capability => me.capabilities.includes(capability))) return "visible";
  if (me.blocked.some(entry => item.anyOf.includes(entry.capability))) return "disabled";
  return "hidden";
}

export function blockReason(item: Pick<NavItem, "anyOf">, me: Identity): BlockReason | null {
  return me.blocked.find(entry => item.anyOf.includes(entry.capability))?.reason ?? null;
}

export const BLOCK_REASON_TEXT: Record<BlockReason, string> = {
  github_admin_required: "需要 GitHub 组织管理员身份",
  github_membership_required: "需要先加入 GitHub 组织",
};

export type VisibleNavItem = NavItem & { state: Exclude<NavState, "hidden">; reason: BlockReason | null };

/** 按身份裁剪导航：去掉 hidden 项。 */
export function visibleNav(me: Identity, items: NavItem[] = CONSOLE_NAV): VisibleNavItem[] {
  return items
    .map(item => ({ ...item, state: navState(item, me), reason: blockReason(item, me) }))
    .filter((item): item is VisibleNavItem => item.state !== "hidden");
}

/** 当前路径对应的导航项：取最长匹配；`end` 项只精确匹配。 */
export function activeNavId(path: string, items: NavItem[] = CONSOLE_NAV): string | null {
  const clean = path.replace(/\/+$/, "") || "/";
  let best: NavItem | null = null;
  for (const item of items) {
    const hit = item.end ? clean === item.to : clean === item.to || clean.startsWith(`${item.to}/`);
    if (hit && (!best || item.to.length > best.to.length)) best = item;
  }
  return best?.id ?? null;
}
