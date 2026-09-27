// 展示说明，不参与鉴权。执行点随 routes/console、routes/forum-api 和 API/SECURITY 契约同步。
export type PermissionBoundary = {
  reserved: boolean;
  scope: string;
  execution: string;
  pages: { label: string; path: string }[];
};

const githubScope = "使用你自己的 GitHub 授权；组织 owner 可管理，member 只保留查看能力，非成员没有 GitHub 能力。站内称号不能提升 GitHub 权力。";
const githubExecution = "关联的 /api/admin/:org/* 接口仍按 GitHub 组织角色和组织白名单鉴权，不检查这里的 capability。页面关联不是接口放行承诺。";
const forumScope = "论坛另外要求当前仍是 GitHub 组织成员。离组但仍持有控制台会话和 forum.* 能力的人，在论坛按游客处理。";
const forumPages = [{ label: "论坛管理", path: "/console/forum" }];
const applicationPages = [{ label: "投递管理", path: "/console/applications" }];
const feedbackPages = [{ label: "意见箱", path: "/console/feedback" }];
const boundaries: Record<string, PermissionBoundary> = {
  "console.access": {
    reserved: false,
    scope: "控制台基础入口。服务端在存在有效能力时自动补充；具体页面仍有自己的能力门。",
    execution: "GET /api/console/catalogue、/departments、/summary 要求 console.access；/me 本身只要求登录。",
    pages: [{ label: "控制台概览", path: "/console" }],
  },
  "github.org.read": {
    reserved: false, scope: githubScope, execution: githubExecution,
    pages: [{ label: "GitHub 组织", path: "/console/github" }],
  },
  "github.org.manage": {
    reserved: false, scope: githubScope, execution: githubExecution,
    pages: [{ label: "组织资料", path: "/console/github/org" }],
  },
  "github.members.manage": {
    reserved: false, scope: githubScope, execution: githubExecution,
    pages: [{ label: "组织成员", path: "/console/github/members" }],
  },
  "github.repos.manage": {
    reserved: false, scope: githubScope, execution: githubExecution,
    pages: [{ label: "仓库", path: "/console/github/repos" }],
  },
  "github.teams.manage": {
    reserved: false, scope: githubScope, execution: githubExecution,
    pages: [{ label: "团队", path: "/console/github/teams" }],
  },
  "github.invites.manage": {
    reserved: false, scope: githubScope, execution: githubExecution,
    pages: [{ label: "邀请", path: "/console/github/invitations" }, { label: "邀请链接", path: "/console/github/invite-links" }],
  },
  "forum.topic.pin": {
    reserved: false, scope: forumScope,
    execution: "POST /api/forum/topics/:topic_id/pin 要求成员身份和 forum.topic.pin，用于置顶或取消置顶。",
    pages: forumPages,
  },
  "forum.topic.close": {
    reserved: false, scope: forumScope,
    execution: "POST /api/forum/topics/:topic_id/close 要求成员身份和 forum.topic.close，用于关闭或重新打开话题。",
    pages: forumPages,
  },
  "forum.post.moderate": {
    reserved: false, scope: forumScope,
    execution: "PATCH、DELETE /api/forum/posts/:post_id 在操作他人帖子时检查此能力；POST /api/forum/posts 在关闭话题内回复时也检查。作者操作自己的帖子另有规则，首帖不可删除。",
    pages: forumPages,
  },
  "forum.category.manage": {
    reserved: true, scope: "能力已在目录中，但管理分类尚无业务执行接口。持有不代表可以执行。",
    execution: "预留能力，暂无业务执行接口。", pages: forumPages,
  },
  "forum.badge.assign": {
    reserved: true, scope: "能力已在目录中，但授予论坛徽章尚无业务执行接口。持有不代表可以执行。",
    execution: "预留能力，暂无业务执行接口。", pages: forumPages,
  },
  "applications.read": {
    reserved: false, scope: "可读取投递列表与详情，包括投递人的联系信息和特长；服务端不下发来源 IP 与 User-Agent。",
    execution: "GET /api/console/applications 及 /:application_id 检查 applications.read；读取详情会写审计。",
    pages: applicationPages,
  },
  "applications.review": {
    reserved: false, scope: "可修改投递状态和写内部备注。状态变更还要通过并发版本检查，通知邮件按服务端配置处理。",
    execution: "PATCH /api/console/applications/:application_id 检查 applications.review；页面旧版本会被拒绝，不会因持有能力而跳过校验。",
    pages: applicationPages,
  },
  "applications.export": {
    reserved: false, scope: "可导出含投递人个人信息的 CSV；导出会写审计，文件离开系统后无法追踪。",
    execution: "GET /api/console/applications/export.csv 检查 applications.export，并限制每分钟 5 次。",
    pages: applicationPages,
  },
  "feedback.read": {
    reserved: false, scope: "读取当前组织的意见箱。",
    execution: "GET /api/console/feedback 检查 feedback.read。", pages: feedbackPages,
  },
  "feedback.manage": {
    reserved: false, scope: "修改意见状态、回复或删除；写入仍需通过同源和输入校验。",
    execution: "PATCH、DELETE /api/console/feedback/:id 检查 feedback.manage，并记录审计。", pages: feedbackPages,
  },
  "audit.read": {
    reserved: false, scope: "只读当前组织的审计事件，包含操作来源 IP；邀请链接令牌只显示前 6 位。",
    execution: "GET /api/console/audit 检查 audit.read。",
    pages: [{ label: "审计日志", path: "/console/audit" }],
  },
  "roles.manage": {
    reserved: false,
    scope: "管理称号、部门和权限包。只允许最高两级称号持有；最高两级的配置仍只能由组织 owner 修改，舰长任免另有本人/owner 限制。",
    execution: "称号 PATCH、部门写接口及称号指派检查 roles.manage；拥有此能力不能绕过固定权限包、舰长唯一性和角色级限制。",
    pages: [{ label: "称号", path: "/console/people?view=titles" }, { label: "部门与权限包", path: "/console/people?view=departments" }],
  },
  "roles.department.manage": {
    reserved: false, scope: "仅持有此能力时，普通任免限于自己负责部门的舰员；同时持有 roles.manage 时不受此部门范围限制。现任舰长通过接口能力门后，仍可按本人身份移交或卸任。",
    execution: "GET /api/console/people 可读全名单；GET /assignments 无 roles.manage 时按负责部门收窄。普通指派与撤销检查全局管理能力或部门作用域；舰长指派与撤销另检查现任舰长/组织 owner 身份。",
    pages: [{ label: "成员", path: "/console/people" }],
  },
};
const undocumented: PermissionBoundary = {
  reserved: false,
  scope: "目录中尚无对应的执行说明；不要据此推断可以操作。",
  execution: "以服务端接口的实际检查为准，请维护者核对该能力的执行点。",
  pages: [],
};

export function permissionBoundary(id: string): PermissionBoundary {
  return boundaries[id] ?? undocumented;
}
