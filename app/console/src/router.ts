import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { FORUM_CAPABILITIES, ROLE_CAPABILITIES } from "./lib/nav";

/**
 * 路由。控制台拥有 /console/**、/signin；旧的 /admin 与 /admin/:org/** 不再保留多组织页面，
 * 一律跳到 /console（组织固定为 CONSOLE_ORG，服务端 /api/admin/:org/* 接口不变）。
 * `meta.anyOf` 是页面所需能力（任一即可），由 pages/Gated.vue 显示「没有权限」。
 */
const gated = (anyOf: string[], load: () => Promise<unknown>) => ({ component: load, meta: { anyOf } });

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/console" },
  { path: "/signin", component: () => import("./pages/SignIn.vue") },
  { path: "/console/signin", redirect: to => ({ path: "/signin", query: to.query }) },
  { path: "/admin/signin", redirect: to => ({ path: "/signin", query: to.query }) },
  { path: "/admin/:rest(.*)*", redirect: "/console" },
  {
    path: "/console",
    component: () => import("./pages/ConsoleRoot.vue"),
    children: [
      { path: "", ...gated(["console.access"], () => import("./pages/Overview.vue")) },
      { path: "applications", ...gated(["applications.read"], () => import("./pages/Applications.vue")) },
      { path: "applications/:applicationId", ...gated(["applications.read"], () => import("./pages/ApplicationDetail.vue")) },
      { path: "forum", ...gated(FORUM_CAPABILITIES, () => import("./pages/Forum.vue")) },
      { path: "people", ...gated(ROLE_CAPABILITIES, () => import("./pages/People.vue")) },
      { path: "feedback", ...gated(["feedback.read"], () => import("./pages/Feedback.vue")) },
      { path: "audit", ...gated(["audit.read"], () => import("./pages/Audit.vue")) },
      { path: "github", ...gated(["github.org.read"], () => import("./pages/github/Overview.vue")) },
      { path: "github/members", ...gated(["github.org.read"], () => import("./pages/github/Members.vue")) },
      { path: "github/repos", ...gated(["github.org.read"], () => import("./pages/github/Repos.vue")) },
      { path: "github/repos/new", ...gated(["github.repos.manage"], () => import("./pages/github/CreateRepo.vue")) },
      { path: "github/repos/:repo/:tab(commits|issues|pulls|settings)?", ...gated(["github.org.read"], () => import("./pages/github/RepoDetail.vue")) },
      { path: "github/repos/:repo/:tab(issues|pulls)/:number(\\d+)", ...gated(["github.org.read"], () => import("./pages/github/RepoDetail.vue")) },
      { path: "github/teams", ...gated(["github.org.read"], () => import("./pages/github/Teams.vue")) },
      { path: "github/activity", ...gated(["github.org.read"], () => import("./pages/github/Activity.vue")) },
      { path: "github/security", ...gated(["github.org.read"], () => import("./pages/github/Security.vue")) },
      { path: "github/org", ...gated(["github.org.read"], () => import("./pages/github/OrgSettings.vue")) },
      { path: "github/invitations", ...gated(["github.invites.manage"], () => import("./pages/github/Invitations.vue")) },
      { path: "github/invite-links", ...gated(["github.invites.manage"], () => import("./pages/github/InviteLinks.vue")) },
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
