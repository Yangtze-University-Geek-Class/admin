// 组织资料表单：字段清单与「改了什么」的计算。纯函数，tests/console 直接测。

export type OrgSettings = Record<string, unknown>;

export const TEXT_FIELDS: { key: string; label: string; wide?: boolean; placeholder?: string }[] = [
  { key: "name", label: "显示名称" },
  { key: "company", label: "单位" },
  { key: "description", label: "简介", wide: true },
  { key: "email", label: "公开邮箱" },
  { key: "billing_email", label: "账单邮箱" },
  { key: "blog", label: "网站", placeholder: "https://" },
  { key: "location", label: "所在地" },
  { key: "twitter_username", label: "X（Twitter）账号" },
];

export const PERMISSION_OPTIONS = [
  { value: "none", label: "无权限", description: "成员只能看到自己有权限的仓库" },
  { value: "read", label: "只读", description: "可以查看和 fork 所有仓库（推荐）" },
  { value: "write", label: "可写", description: "可以向所有仓库推送" },
  { value: "admin", label: "管理", description: "可以管理所有仓库（不建议）" },
];

export const MEMBER_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "members_can_create_repositories", label: "成员可以新建仓库" },
  { key: "members_can_create_public_repositories", label: "可以新建公开仓库" },
  { key: "members_can_create_private_repositories", label: "可以新建私有仓库" },
  { key: "members_can_fork_private_repositories", label: "可以 fork 私有仓库" },
  { key: "members_can_create_pages", label: "可以发布 GitHub Pages" },
  { key: "members_can_invite_outside_collaborators", label: "可以邀请外部协作者" },
  { key: "members_can_delete_repositories", label: "可以删除仓库", hint: "建议关闭" },
  { key: "members_can_change_repo_visibility", label: "可以修改仓库可见性", hint: "建议关闭" },
];

export const EDITABLE_KEYS = [...TEXT_FIELDS.map(f => f.key), "default_repository_permission", ...MEMBER_FIELDS.map(f => f.key)];

const normalize = (value: unknown) => (value === null || value === undefined ? "" : value);

/** 与原值不同的字段（改回原值即不算修改）。只看可编辑字段。 */
export function changedFields(original: OrgSettings, draft: OrgSettings): OrgSettings {
  const changes: OrgSettings = {};
  for (const key of EDITABLE_KEYS) {
    if (!(key in draft)) continue;
    if (normalize(draft[key]) !== normalize(original[key])) changes[key] = draft[key];
  }
  return changes;
}

export const isDirty = (original: OrgSettings, draft: OrgSettings) => Object.keys(changedFields(original, draft)).length > 0;
