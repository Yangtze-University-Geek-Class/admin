// GitLab 各页（#270、SPEC §3.9）：同步模式、账号同步名单上的状态和要做的事写成文字。纯函数，tests/console 直接测。
import type { GitlabAccount, GitlabAccountsResponse, GitlabAction, GitlabSyncMode } from "./types";

/** 同步模式：关闭、预演（只算要做的事，不改 GitLab）、打开。 */
export const MODE_TEXT: Record<GitlabSyncMode, string> = { off: "已关闭", "dry-run": "预演", on: "已打开" };
export const modeText = (mode: string): string => MODE_TEXT[mode as GitlabSyncMode] ?? mode;

/** GitLab 组权限：同步只给开发者（30）和所有者（50），其余按 GitLab 的叫法写。 */
const ACCESS_TEXT: Record<number, string> = { 10: "访客", 20: "报告者", 30: "开发者", 40: "维护者", 50: "所有者" };
export const accessText = (level: number): string => ACCESS_TEXT[level] ?? `权限 ${level}`;

export function actionText(action: GitlabAction): string {
  switch (action.kind) {
    case "create": return `建号，进组当${accessText(action.access_level)}`;
    case "block": return "封禁";
    case "unblock": return "解封";
    case "set_access": return `组权限改成${accessText(action.access_level)}`;
    case "find_and_block": return "按身份找到 GitLab 用户并封禁";
    case "set_avatar": return "传头像";
    case "set_emails": return "同步邮箱";
  }
}

/** 还要做的事：预演时写「预演」，打开时写「待同步」。 */
export function pendingText(mode: GitlabAccountsResponse["mode"], actions: GitlabAction[]): string {
  if (mode === "off" || !actions.length) return "";
  return `${mode === "dry-run" ? "预演" : "待同步"}：${actions.map(actionText).join("、")}`;
}

const ERROR_TEXT: Record<string, string> = {
  gitlab_unreachable: "连不上 GitLab",
  gitlab_client_missing: "签发者里没有 GitLab 客户端",
  gitlab_sector_mismatch: "GitLab 客户端的 sector 和本环境配置不一致",
  gitlab_username_exhausted: "用户名都被占用了",
  gitlab_sync_failed: "同步出错",
  github_avatar_unreachable: "连不上 GitHub 头像",
  github_avatar_not_image: "GitHub 头像不是图片",
  avatar_too_large: "头像超过 200 KiB",
  forum_avatar_missing: "论坛头像找不到了",
};
const STATUS_ERROR: [RegExp, string][] = [
  [/^gitlab_create_(\d+)$/, "建号被拒"],
  [/^gitlab_member_(\d+)$/, "进组失败"],
  [/^gitlab_lookup_(\d+)$/, "查找失败"],
  [/^gitlab_block_(\d+)$/, "封禁失败"],
  [/^gitlab_unblock_(\d+)$/, "解封失败"],
  [/^gitlab_avatar_(\d+)$/, "头像被拒"],
  [/^github_avatar_(\d+)$/, "GitHub 头像下载失败"],
  [/^gitlab_email_(\d+)$/, "邮箱被拒"],
];
/** 最后一次失败的原因；带状态码的写成「建号被拒（409）」，不认识的原样显示机器码。 */
export function errorText(code: string): string {
  if (ERROR_TEXT[code]) return ERROR_TEXT[code];
  for (const [pattern, text] of STATUS_ERROR) {
    const match = pattern.exec(code);
    if (match) return `${text}（${match[1]}）`;
  }
  return code;
}

/** 名单上显示的 GitLab 用户名：已经定下的，或者还没建号时建号会用的。 */
export function usernameOf(account: GitlabAccount): string | null {
  if (account.username) return account.username;
  const create = account.pending.find(action => action.kind === "create");
  return create?.kind === "create" ? create.username : null;
}

/** 账号在 GitLab 上现在的样子：已建好的写组权限或「已封禁」，建到一半的写「建号没完成」；要建号的由「还要做的事」说明。 */
export function stateText(account: GitlabAccount): string {
  if (!account.username) return account.pending.some(action => action.kind === "create") ? "" : "没有 GitLab 账号";
  if (account.gitlab_user_id === null) return "建号没完成";
  if (account.state === "blocked") return "已封禁";
  return account.access_level === null ? "还没进组" : accessText(account.access_level);
}

/** GitLab 上的个人主页；还没建好的没有。 */
export const profileUrl = (data: Pick<GitlabAccountsResponse, "gitlab_url">, account: GitlabAccount): string | null =>
  data.gitlab_url && account.username && account.gitlab_user_id !== null ? `${data.gitlab_url}/${encodeURIComponent(account.username)}` : null;

/** 「立即同步」：同步打开、客户端登记了，这个账号有错或还有事要做时才有意义。 */
export const canSyncNow = (data: Pick<GitlabAccountsResponse, "mode" | "client_registered">, account: GitlabAccount): boolean =>
  data.mode === "on" && data.client_registered && Boolean(account.last_error || account.pending.length);

/** 名单上方的说明：关着、预演、客户端没登记时各一句；正常打开时没有。 */
export function gitlabNote(data: Pick<GitlabAccountsResponse, "mode" | "client_registered" | "group">): string {
  if (data.mode === "off") return "GitLab 同步没有打开，名单里不显示 GitLab 账号。";
  if (data.mode === "dry-run") return `GitLab 同步在预演：「GitLab」列写的是打开后会做的事，现在不建号、不封禁，也不改 ${data.group} 组。`;
  if (!data.client_registered) return "GitLab 同步已打开，但签发者里还没有登记 client id 为 gitlab 的客户端，这期间不建号、不封禁。";
  return "";
}
