import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { reportEvent } from "./lib/events";
import { COMPETITION_MANAGE_PERMISSIONS, FORUM_PERMISSIONS, GITLAB_PERMISSIONS, USERS_PERMISSIONS } from "./lib/nav";

/**
 * 路由。控制台拥有 /console/**、/signin、/device、/account、/authorize、/bind-email、/complete-profile。
 * `meta.anyOf` 是页面所需权限节点（任一即可），components/ConsoleShell.vue 把它交给 components/CapabilityGate.vue 显示「没有权限」。
 */
const gated = (anyOf: string[], load: () => Promise<unknown>) => ({ component: load, meta: { anyOf } });

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/console" },
  { path: "/signin", component: () => import("./pages/SignIn.vue") },
  // 设备授权确认页（RFC 8628，给 `geek login`）：和 /signin 一样不在控制台壳子里，只要登录、不要控制台权限。
  { path: "/device", component: () => import("./pages/Device.vue") },
  // 对外授权的同意页（#270，GitLab 等不同源的应用第一次用极客班账号登录时）：同样不在控制台壳子里，只要登录。
  { path: "/authorize", component: () => import("./pages/Authorize.vue") },
  // 账号页（#262）：登录方式、绑定邮箱、密码、成员资格。任何登录的人都能来，不在控制台壳子里。
  { path: "/account", component: () => import("./pages/Account.vue") },
  // 绑定邮箱页（#273）：账号还没有登录邮箱时官网、论坛、控制台都先带人来这里。只有绑定和退出，不在控制台壳子里。
  { path: "/bind-email", component: () => import("./pages/BindEmail.vue") },
  // 补资料页（#280）：缺真实姓名或年级时官网、论坛、控制台都先带人来这里。只有填写和退出，不在控制台壳子里。
  { path: "/complete-profile", component: () => import("./pages/CompleteProfile.vue") },
  { path: "/console/signin", redirect: to => ({ path: "/signin", query: to.query }) },
  { path: "/admin/signin", redirect: to => ({ path: "/signin", query: to.query }) },
  { path: "/admin/:rest(.*)*", redirect: "/console" },
  {
    path: "/console",
    component: () => import("./pages/ConsoleRoot.vue"),
    children: [
      { path: "", ...gated(["console.access"], () => import("./pages/Overview.vue")) },
      { path: "applications", ...gated(["apply.view"], () => import("./pages/Applications.vue")) },
      { path: "applications/:applicationId", ...gated(["apply.view"], () => import("./pages/ApplicationDetail.vue")) },
      { path: "mail-templates", ...gated(["mail.template.manage"], () => import("./pages/MailTemplates.vue")) },
      { path: "forum", ...gated(FORUM_PERMISSIONS, () => import("./pages/Forum.vue")) },
      { path: "competitions", ...gated(COMPETITION_MANAGE_PERMISSIONS, () => import("./pages/Competitions.vue")) },
      // 核销兑奖码（#278）：要排在 competitions/:id 前面，不然 redeem 会被当成比赛 id
      { path: "competitions/redeem", ...gated(["competition.prize.redeem"], () => import("./pages/PrizeRedeem.vue")) },
      { path: "competitions/:id", ...gated(COMPETITION_MANAGE_PERMISSIONS, () => import("./pages/CompetitionHub.vue")) },
      { path: "users", ...gated(USERS_PERMISSIONS, () => import("./pages/Users.vue")) },
      { path: "permissions", ...gated(["perm.view", "perm.manage"], () => import("./pages/Permissions.vue")) },
      { path: "invites", ...gated(["invite.manage"], () => import("./pages/Invites.vue")) },
      { path: "gitlab", ...gated(GITLAB_PERMISSIONS, () => import("./pages/gitlab/Overview.vue")) },
      { path: "gitlab/accounts", ...gated(GITLAB_PERMISSIONS, () => import("./pages/gitlab/Accounts.vue")) },
      { path: "gitlab/projects", ...gated(GITLAB_PERMISSIONS, () => import("./pages/gitlab/Projects.vue")) },
      { path: "gitlab/settings", ...gated(["gitlab.settings"], () => import("./pages/gitlab/Settings.vue")) },
      { path: "activity", ...gated(["activity.read"], () => import("./pages/Activity.vue")) },
      { path: "feedback", ...gated(["feedback.view"], () => import("./pages/Feedback.vue")) },
      { path: "security", ...gated(["security.manage"], () => import("./pages/Security.vue")) },
      { path: "backup", ...gated(["system.backup"], () => import("./pages/Backup.vue")) },
      // 改版前的地址（#274）：成员与权限、审计日志拆成了用户、权限、操作记录；GitHub 组织整组去掉了。
      { path: "people", redirect: to => ({ path: "/console/users", query: to.query }) },
      { path: "audit", redirect: to => ({ path: "/console/activity", query: to.query }) },
      { path: ":rest(.*)*", redirect: "/console" },
    ],
  },
  { path: "/:rest(.*)*", redirect: "/console" },
];

export const router = createRouter({
  history: createWebHistory("/"),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

// 页面浏览埋点（#274）：target_id 取匹配到的路由模式（如 `competitions/:id`），不是解析出的真实地址，
// 不带比赛编号、用户名之类的参数真实值。
router.afterEach(to => {
  reportEvent("page.view", { target_type: "route", target_id: to.matched.at(-1)?.path ?? to.path });
});
