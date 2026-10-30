/**
 * 权限节点目录（#274 SPEC §3.3）：点分节点，启动时同步到 `perm_nodes` 表供控制台展示。
 *
 * 只增不改名：旧节点废弃时保留在这里并打 `deprecated: true`，不删除、不改名字，
 * 否则已经发出去的 perm_entries.node 会变成悬空字符串。
 */

export type PermissionDomain = "forum" | "apply" | "competition" | "account" | "console" | "gitlab" | "system" | "meta";

export type PermissionNodeDef = {
  node: string;
  domain: PermissionDomain;
  label: string;
  description: string;
  /** meta 节点不参与 allow/deny 判断，取值规则见 permissions.ts 的 metaValue()。 */
  meta?: boolean;
  deprecated?: boolean;
};

/** 节点格式：小写点分，正则取自 SPEC §3.3。通配符只有 `*` 和 `前缀.*` 两种，不在目录里出现。 */
export const NODE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

export function isValidNode(node: string): boolean {
  return typeof node === "string" && NODE_PATTERN.test(node);
}

export const PERMISSION_NODES: PermissionNodeDef[] = [
  // 论坛
  { node: "forum.read.public", domain: "forum", label: "看公开帖", description: "看论坛的公开分类与话题" },
  { node: "forum.read.registered", domain: "forum", label: "看注册可见帖", description: "看注册用户可见的分类与话题" },
  { node: "forum.read.member", domain: "forum", label: "看成员可见帖", description: "看极客班成员可见的分类与话题" },
  { node: "forum.topic.create", domain: "forum", label: "发话题", description: "在论坛发起新话题" },
  { node: "forum.reply.create", domain: "forum", label: "发回复", description: "在话题下回复" },
  { node: "forum.react", domain: "forum", label: "表情回应", description: "给帖子加表情回应" },
  { node: "forum.sticker.use", domain: "forum", label: "使用表情包", description: "在帖子里插入表情包短码" },
  { node: "forum.upload.image", domain: "forum", label: "上传图片", description: "在帖子里粘贴或上传图片" },
  { node: "forum.moderate.pin", domain: "forum", label: "置顶话题", description: "置顶或取消置顶话题" },
  { node: "forum.moderate.close", domain: "forum", label: "关闭话题", description: "关闭或重开话题" },
  { node: "forum.moderate.edit", domain: "forum", label: "编辑他人帖子", description: "编辑他人发的帖子" },
  { node: "forum.moderate.delete", domain: "forum", label: "删除他人帖子", description: "删除他人发的帖子" },
  { node: "forum.category.manage", domain: "forum", label: "管理分类", description: "新建、编辑分类，设置可见范围" },
  { node: "forum.sticker.manage", domain: "forum", label: "管理表情包", description: "新建、上下架表情包" },
  { node: "forum.badge.grant", domain: "forum", label: "授予徽章", description: "给论坛账号授予专属徽章" },
  // 投递
  { node: "apply.submit", domain: "apply", label: "投递", description: "提交招新投递" },
  { node: "apply.view", domain: "apply", label: "查看投递", description: "查看投递列表与详情" },
  { node: "apply.review", domain: "apply", label: "审核投递", description: "修改投递状态、写备注" },
  { node: "apply.export", domain: "apply", label: "导出投递", description: "导出投递 CSV" },
  { node: "apply.settings", domain: "apply", label: "招新开关", description: "开放或关闭招新；关闭后官网显示关闭页，新的投递被拒绝，已收到的投递照常处理" },
  // 招聘邮件模板（#285）：试发会真的往外发信，所以和 system.backup 一样不往下发，只留给站长的根通配 `*`
  { node: "mail.template.manage", domain: "apply", label: "管理招聘邮件模板", description: "新建、编辑、停用招聘邮件的模板，预览，并向自己填的测试邮箱试发样信" },
  // 比赛
  { node: "competition.signup", domain: "competition", label: "报名比赛", description: "报名参加比赛" },
  { node: "competition.team", domain: "competition", label: "组队", description: "创建、加入、管理比赛队伍" },
  { node: "competition.manage", domain: "competition", label: "管理比赛", description: "新建、编辑、下线比赛" },
  { node: "competition.score.review", domain: "competition", label: "审核积分", description: "确认或撤销比赛积分" },
  { node: "competition.site.publish", domain: "competition", label: "发布官网", description: "上传、发布比赛官网站点包" },
  { node: "competition.prize.redeem", domain: "competition", label: "核销兑奖码", description: "在控制台输入得奖者的兑奖码，核对并标记已兑奖" },
  // 账号
  { node: "account.profile.edit", domain: "account", label: "改资料", description: "修改昵称、简介、头像、偏好" },
  { node: "account.invite.redeem", domain: "account", label: "兑换邀请码", description: "用邀请码升级为极客班成员" },
  { node: "account.cli.login", domain: "account", label: "命令行登录", description: "用设备码登录 geek 命令行" },
  // 控制台
  { node: "console.access", domain: "console", label: "进入控制台", description: "进入控制台；持有任意节点不等于自动获得" },
  { node: "users.view", domain: "console", label: "查看用户", description: "查看用户列表与详情" },
  { node: "users.manage", domain: "console", label: "管理用户", description: "修改用户身份、部门、称号" },
  { node: "users.disable", domain: "console", label: "停用用户", description: "停用或启用用户账号" },
  { node: "perm.view", domain: "console", label: "查看权限", description: "查看权限节点、组、成员与解释" },
  { node: "perm.manage", domain: "console", label: "管理权限", description: "新建、编辑、删除权限组与条目" },
  { node: "invite.manage", domain: "console", label: "管理邀请码", description: "新建、停用注册邀请码" },
  { node: "activity.read", domain: "console", label: "查看操作记录", description: "查看操作记录（IP 默认打码）" },
  { node: "activity.read.ip", domain: "console", label: "查看完整 IP", description: "查看操作记录里的完整 IP" },
  { node: "activity.export", domain: "console", label: "导出操作记录", description: "导出操作记录 CSV" },
  { node: "feedback.view", domain: "console", label: "查看意见箱", description: "查看意见箱" },
  { node: "feedback.handle", domain: "console", label: "处理意见", description: "修改意见状态、回复、删除" },
  { node: "dept.manage", domain: "console", label: "管理本部门", description: "任免本部门成员、改部门资料", },
  // GitLab
  { node: "gitlab.view", domain: "gitlab", label: "查看 GitLab", description: "查看 GitLab 实例状态、账号同步、群组与项目" },
  { node: "gitlab.sync", domain: "gitlab", label: "手动同步", description: "手动重新同步某个账号" },
  { node: "gitlab.settings", domain: "gitlab", label: "修改 GitLab 设置", description: "修改同步开关、群组路径、同步间隔" },
  // 系统（#282）：导出的归档含全部账号与密码哈希，不往下发到部门部长，只留给站长的根通配 `*`
  { node: "system.backup", domain: "system", label: "导出系统备份", description: "下载整个系统的数据库快照与站点文件打包" },
  // 访问防护（#333）：查看被封禁的 IP、手工解封；只留给站长的根通配 `*`，每次查看与解封都写操作记录
  { node: "security.manage", domain: "system", label: "管理访问封禁", description: "查看被封禁的 IP，手工解封（解封后级别归零）" },
  // 限额（meta）：不参与 allow/deny，取值见 permissions.ts
  { node: "meta.limit.apply.daily", domain: "meta", label: "每天投递上限", description: "每个账号每天（北京时间）最多投递次数，-1 为不限", meta: true },
  { node: "meta.limit.forum.topic.hourly", domain: "meta", label: "每小时发话题上限", description: "每小时最多发起的话题数，-1 为不限", meta: true },
  { node: "meta.limit.forum.reply.hourly", domain: "meta", label: "每小时回复上限", description: "每小时最多回复数，-1 为不限", meta: true },
  { node: "meta.limit.forum.react.hourly", domain: "meta", label: "每小时表情回应上限", description: "每小时最多表情回应数，-1 为不限", meta: true },
  { node: "meta.limit.forum.upload.hourly", domain: "meta", label: "每小时上传上限", description: "每小时最多上传图片数，-1 为不限", meta: true },
  { node: "meta.limit.read.per_minute", domain: "meta", label: "每分钟读接口上限", description: "每分钟最多论坛读请求数，-1 为不限", meta: true },
  { node: "meta.limit.search.per_minute", domain: "meta", label: "每分钟搜索上限", description: "每分钟最多论坛搜索次数，-1 为不限", meta: true },
];

export const PERMISSION_DOMAINS: { id: PermissionDomain; label: string }[] = [
  { id: "forum", label: "论坛" },
  { id: "apply", label: "招新投递" },
  { id: "competition", label: "比赛" },
  { id: "account", label: "账号" },
  { id: "console", label: "控制台" },
  { id: "gitlab", label: "GitLab" },
  { id: "system", label: "系统" },
  { id: "meta", label: "限额" },
];

const NODE_SET = new Set(PERMISSION_NODES.map(item => item.node));
export const isKnownNode = (node: string): boolean => NODE_SET.has(node);

/** 界面需要的权限摘要（`GET /auth/me` 的 `permissions`，CONTRACT-274 §1）：只展开用得到的具体节点。 */
export const UI_NODES: string[] = [
  "forum.read.public", "forum.read.registered", "forum.read.member",
  "forum.topic.create", "forum.reply.create", "forum.react", "forum.sticker.use", "forum.upload.image",
  "forum.moderate.pin", "forum.moderate.close", "forum.moderate.edit", "forum.moderate.delete",
  "apply.submit", "competition.signup", "competition.team",
  "account.profile.edit", "account.invite.redeem", "account.cli.login",
  "console.access",
];

/**
 * 旧 CAPABILITIES（lib/roles.ts）到新节点的对照（SPEC §3.3）。
 * 找不到对应节点的（GitHub 组织管理类）写 `null`，由迁移报告列出，不能静默丢掉。
 * `forum.post.moderate` 一对多：同时对应编辑和删除两个新节点。
 */
export const CAPABILITY_TO_NODES: Record<string, string[] | null> = {
  "console.access": ["console.access"],
  "github.org.read": null,
  "github.org.manage": null,
  "github.members.manage": null,
  "github.repos.manage": null,
  "github.teams.manage": null,
  "github.invites.manage": null,
  "forum.topic.pin": ["forum.moderate.pin"],
  "forum.topic.close": ["forum.moderate.close"],
  "forum.post.moderate": ["forum.moderate.edit", "forum.moderate.delete"],
  "forum.category.manage": ["forum.category.manage"],
  "forum.badge.assign": ["forum.badge.grant"],
  "applications.read": ["apply.view"],
  "applications.review": ["apply.review"],
  "applications.export": ["apply.export"],
  "feedback.read": ["feedback.view"],
  "feedback.manage": ["feedback.handle"],
  "audit.read": ["activity.read", "activity.read.ip"],
  "roles.manage": ["perm.manage"],
  "roles.department.manage": ["dept.manage"],
  "competitions.manage": ["competition.manage"],
  "accounts.invites.manage": ["invite.manage"],
};
