// 控制台左侧导航（SPEC §3.9）：每一项声明所需权限节点（任一满足即可）。纯数据 + 纯函数，tests/console 直接测。
import type { ConsoleMe, Permission } from "./types";

export type NavItem = { id: string; to: string; label: string; anyOf: Permission[]; icon: string; group?: NavGroupId; end?: boolean };
export type NavGroupId = "recruit" | "community" | "users" | "gitlab" | "records" | "system";
export type NavState = "visible" | "hidden";

export const FORUM_PERMISSIONS: Permission[] = [
  "forum.moderate.pin", "forum.moderate.close", "forum.moderate.edit", "forum.moderate.delete", "forum.category.manage", "forum.sticker.manage", "forum.badge.grant",
];
export const COMPETITION_MANAGE_PERMISSIONS: Permission[] = ["competition.manage", "competition.score.review", "competition.site.publish"];
export const USERS_PERMISSIONS: Permission[] = ["users.view", "users.manage", "users.disable"];
export const GITLAB_PERMISSIONS: Permission[] = ["gitlab.view", "gitlab.sync", "gitlab.settings"];

export const NAV_GROUPS: { key: NavGroupId; label: string }[] = [
  { key: "recruit", label: "招新" },
  { key: "community", label: "社区" },
  { key: "users", label: "用户" },
  { key: "gitlab", label: "GitLab" },
  { key: "records", label: "记录" },
  { key: "system", label: "系统" },
];

export const CONSOLE_NAV: NavItem[] = [
  { id: "overview", to: "/console", label: "概览", anyOf: ["console.access"], icon: "i-carbon-dashboard", end: true },
  { id: "applications", to: "/console/applications", label: "投递管理", anyOf: ["apply.view"], icon: "i-carbon-document-attachment", group: "recruit" },
  { id: "mail-templates", to: "/console/mail-templates", label: "邮件模板", anyOf: ["mail.template.manage"], icon: "i-carbon-email", group: "recruit" },
  { id: "forum", to: "/console/forum", label: "论坛管理", anyOf: FORUM_PERMISSIONS, icon: "i-carbon-forum", group: "community" },
  { id: "competitions", to: "/console/competitions", label: "比赛", anyOf: COMPETITION_MANAGE_PERMISSIONS, icon: "i-carbon-trophy", group: "community" },
  { id: "users", to: "/console/users", label: "用户", anyOf: USERS_PERMISSIONS, icon: "i-carbon-user-multiple", group: "users" },
  { id: "permissions", to: "/console/permissions", label: "权限", anyOf: ["perm.view", "perm.manage"], icon: "i-carbon-security", group: "users" },
  { id: "invites", to: "/console/invites", label: "邀请码", anyOf: ["invite.manage"], icon: "i-carbon-ticket", group: "users" },
  { id: "gitlab-overview", to: "/console/gitlab", label: "概览", anyOf: GITLAB_PERMISSIONS, icon: "i-carbon-dashboard", group: "gitlab", end: true },
  { id: "gitlab-accounts", to: "/console/gitlab/accounts", label: "账号同步", anyOf: GITLAB_PERMISSIONS, icon: "i-carbon-user-multiple", group: "gitlab" },
  { id: "gitlab-projects", to: "/console/gitlab/projects", label: "群组与项目", anyOf: GITLAB_PERMISSIONS, icon: "i-carbon-repo-source-code", group: "gitlab" },
  { id: "gitlab-settings", to: "/console/gitlab/settings", label: "设置", anyOf: ["gitlab.settings"], icon: "i-carbon-settings", group: "gitlab" },
  { id: "activity", to: "/console/activity", label: "操作记录", anyOf: ["activity.read"], icon: "i-carbon-catalog", group: "records" },
  { id: "feedback", to: "/console/feedback", label: "意见箱", anyOf: ["feedback.view"], icon: "i-carbon-chat", group: "records" },
  { id: "security", to: "/console/security", label: "安全防护", anyOf: ["security.manage"], icon: "i-carbon-security", group: "system" },
  { id: "backup", to: "/console/backup", label: "备份", anyOf: ["system.backup"], icon: "i-carbon-data-backup", group: "system" },
];

type Identity = Pick<ConsoleMe, "permissions">;

/** 只显示实际持有的节点对应的页面；具体执行仍由服务端核对。 */
export function navState(item: Pick<NavItem, "anyOf">, me: Identity): NavState {
  return item.anyOf.some(node => me.permissions.includes(node)) ? "visible" : "hidden";
}

/** 按当前生效权限裁剪导航；直接访问仍由页面与服务端分别校验。 */
export function visibleNav(me: Identity, items: NavItem[] = CONSOLE_NAV): NavItem[] {
  return items.filter(item => navState(item, me) === "visible");
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
