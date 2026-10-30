// 权限节点的中文名与业务域（SPEC §3.3）。节点目录的权威来源在服务端 permission-nodes.ts，
// 这里是控制台本地的展示兜底：没有 perm.view 时读不到 GET /api/console/permissions/nodes，
// 「你没有「X」权限」这类提示仍要显示节点的中文名，所以本地留一份固定表。
// 持有 perm.view 的页面（权限 → 节点）以接口返回的 label 为准，接口没有的节点才退回这里。
import type { PermissionDomain, Permission } from "./types";

export const PERMISSION_DOMAINS: PermissionDomain[] = [
  { id: "forum", label: "论坛" },
  { id: "apply", label: "招新投递" },
  { id: "competition", label: "比赛" },
  { id: "account", label: "账号" },
  { id: "console", label: "控制台" },
  { id: "gitlab", label: "GitLab" },
  { id: "system", label: "系统" },
  { id: "meta", label: "限额" },
];

export const NODE_LABELS: Record<Permission, string> = {
  "forum.read.public": "看公开帖",
  "forum.read.registered": "看注册可见帖",
  "forum.read.member": "看成员可见帖",
  "forum.topic.create": "发话题",
  "forum.reply.create": "发回复",
  "forum.react": "表情回应",
  "forum.sticker.use": "使用表情包",
  "forum.upload.image": "上传图片",
  "forum.moderate.pin": "置顶话题",
  "forum.moderate.close": "关闭话题",
  "forum.moderate.edit": "编辑他人帖子",
  "forum.moderate.delete": "删除他人帖子",
  "forum.category.manage": "管理分类",
  "forum.sticker.manage": "管理表情包",
  "forum.badge.grant": "授予徽章",
  "apply.submit": "投递",
  "apply.view": "查看投递",
  "apply.review": "审核投递",
  "apply.export": "导出投递",
  "apply.settings": "招新开关",
  "mail.template.manage": "管理招聘邮件模板",
  "competition.signup": "报名比赛",
  "competition.team": "组队",
  "competition.manage": "管理比赛",
  "competition.score.review": "审核积分",
  "competition.site.publish": "发布官网",
  "competition.prize.redeem": "核销兑奖码",
  "account.profile.edit": "改资料",
  "account.invite.redeem": "兑换邀请码",
  "account.cli.login": "命令行登录",
  "console.access": "进入控制台",
  "users.view": "查看用户",
  "users.manage": "管理用户",
  "users.disable": "停用用户",
  "perm.view": "查看权限",
  "perm.manage": "管理权限",
  "invite.manage": "管理邀请码",
  "activity.read": "查看操作记录",
  "activity.read.ip": "查看完整 IP",
  "activity.export": "导出操作记录",
  "feedback.view": "查看意见箱",
  "feedback.handle": "处理意见",
  "dept.manage": "管理本部门",
  "gitlab.view": "查看 GitLab",
  "gitlab.sync": "手动同步",
  "gitlab.settings": "修改 GitLab 设置",
  "system.backup": "导出系统备份",
  "security.manage": "管理访问封禁",
  "meta.limit.apply.daily": "每天投递上限",
  "meta.limit.forum.topic.hourly": "每小时发话题上限",
  "meta.limit.forum.reply.hourly": "每小时回复上限",
  "meta.limit.forum.react.hourly": "每小时表情回应上限",
  "meta.limit.forum.upload.hourly": "每小时上传上限",
  "meta.limit.read.per_minute": "每分钟读接口上限",
  "meta.limit.search.per_minute": "每分钟搜索上限",
};

export const nodeLabel = (node: Permission): string => NODE_LABELS[node] ?? node;
/** 控制台域的节点前缀不统一（users.、perm.、invite.…），按 SPEC §3.3 的表归到「控制台」。 */
const CONSOLE_PREFIXES = ["console", "users", "perm", "invite", "activity", "feedback", "dept"];
/** 招聘邮件模板（#285）的节点 mail.template.manage，服务端把它归在「招新投递」 */
const APPLY_PREFIXES = ["mail"];
export const nodeDomain = (node: Permission): string => {
  const head = node.split(".")[0] ?? "";
  if (CONSOLE_PREFIXES.includes(head)) return "console";
  if (head === "security") return "system";
  return APPLY_PREFIXES.includes(head) ? "apply" : head || "unknown";
};
export const domainLabel = (id: string): string => PERMISSION_DOMAINS.find(item => item.id === id)?.label ?? id;
