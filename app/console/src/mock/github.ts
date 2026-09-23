// 开发预览：`/api/admin/:org/*` 的只读样板数据（全部虚构）。形状与 app/server/src/routes/admin/*.ts 的返回一致。
import { ApiError } from "../lib/http";
import { MOCK_ORG, mockPersona } from "./console";

const now = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (offset: number) => new Date(now - offset).toISOString();

const orgInfo = {
  login: MOCK_ORG, name: "长江大学极客班", avatar_url: null, html_url: `https://github.com/${MOCK_ORG}`,
  description: "长江大学校内技术社团", plan: "free", public_repos: 18, total_private_repos: 6,
  billing_email: "admin@example.test", two_factor_required: true, disk_usage_mb: 328, created_at: "2023-09-01T08:00:00Z",
  company: "长江大学", email: "hello@example.test", location: "湖北荆州", blog: "https://yangtzeu.work",
  twitter_username: "", default_repository_permission: "read", members_can_create_repositories: true,
  members_can_create_public_repositories: true, members_can_create_private_repositories: false,
  members_can_fork_private_repositories: true, members_can_create_pages: true,
  members_can_invite_outside_collaborators: false, members_can_delete_repositories: false,
  members_can_change_repo_visibility: false,
};

const repos = [
  { name: "geek-main", description: "极客班官网、控制台与服务端", visibility: "private", archived: false, default_branch: "main", size_kb: 2840, language: "TypeScript", stargazers_count: 12, forks_count: 2, open_issues_count: 4, pushed_at: iso(30 * MIN), topics: ["vue", "fastify", "github"] },
  { name: "ai-coding-course", description: "AI Coding 课程与练习材料", visibility: "public", archived: false, default_branch: "main", size_kb: 1340, language: "Markdown", stargazers_count: 42, forks_count: 11, open_issues_count: 7, pushed_at: iso(1 * DAY), topics: ["agent", "course"] },
  { name: "mcp-lab", description: "MCP Server 实验与校园服务集成", visibility: "public", archived: false, default_branch: "main", size_kb: 920, language: "Python", stargazers_count: 26, forks_count: 5, open_issues_count: 3, pushed_at: iso(2 * DAY), topics: ["mcp", "python"] },
  { name: "algo-weekly", description: "每周算法题解与复盘", visibility: "public", archived: false, default_branch: "main", size_kb: 410, language: "C++", stargazers_count: 19, forks_count: 4, open_issues_count: 1, pushed_at: iso(3 * DAY), topics: ["algorithm"] },
  { name: "ctf-notes", description: "校赛 CTF 题目归档与复盘", visibility: "private", archived: false, default_branch: "main", size_kb: 1860, language: "Python", stargazers_count: 8, forks_count: 0, open_issues_count: 0, pushed_at: iso(5 * DAY), topics: ["ctf", "security"] },
  { name: "old-forum", description: "旧论坛，已停用", visibility: "private", archived: true, default_branch: "master", size_kb: 5230, language: "JavaScript", stargazers_count: 3, forks_count: 0, open_issues_count: 0, pushed_at: iso(200 * DAY), topics: [] },
].map(repo => ({ ...repo, full_name: `${MOCK_ORG}/${repo.name}`, html_url: `https://github.com/${MOCK_ORG}/${repo.name}`, updated_at: repo.pushed_at }));

const members = [
  { login: "chen-hang", role: "admin" }, { login: "wang-zhe", role: "admin" }, { login: "li-xiaoman", role: "member" },
  { login: "sun-qiao", role: "member" }, { login: "zhao-yi", role: "member" }, { login: "he-miao", role: "member" },
  { login: "liu-xing", role: "member" }, { login: "gao-yuan", role: "member" },
].map((m, index) => ({ ...m, id: 1001 + index, avatar_url: null, html_url: `https://github.com/${m.login}`, state: "active" }));

const teams = [
  { name: "AI Native", slug: "ai-native", description: "Agent、MCP 与 AI Coding", privacy: "closed", member_count: 18, repo_count: 6 },
  { name: "Systems", slug: "systems", description: "系统、算法与基础设施", privacy: "closed", member_count: 12, repo_count: 4 },
  { name: "Maintainers", slug: "maintainers", description: "", privacy: "secret", member_count: 3, repo_count: 9 },
];

const activity = [
  { id: "9", actor: "wang-zhe", payload_summary: "推送了 3 个提交到 main", repo: `${MOCK_ORG}/geek-main`, created_at: iso(30 * MIN), type: "PushEvent" },
  { id: "8", actor: "li-xiaoman", payload_summary: "打开了合并请求 #42", repo: `${MOCK_ORG}/geek-main`, created_at: iso(90 * MIN), type: "PullRequestEvent" },
  { id: "7", actor: "sun-qiao", payload_summary: "新建了 Issue #17", repo: `${MOCK_ORG}/mcp-lab`, created_at: iso(3 * HOUR), type: "IssuesEvent" },
  { id: "6", actor: "zhao-yi", payload_summary: "创建了分支 week-3", repo: `${MOCK_ORG}/ai-coding-course`, created_at: iso(1 * DAY), type: "CreateEvent" },
  { id: "5", actor: "chen-hang", payload_summary: "发布了 v0.3.0", repo: `${MOCK_ORG}/mcp-lab`, created_at: iso(36 * HOUR), type: "ReleaseEvent" },
  { id: "4", actor: "he-miao", payload_summary: "推送了 1 个提交到 dev", repo: `${MOCK_ORG}/ai-coding-course`, created_at: iso(2 * DAY), type: "PushEvent" },
].map(event => ({ ...event, actor_avatar: null }));

const commits = [
  { sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", message: "修复控制台在窄屏下导航被遮挡", author: "wang-zhe", at: 30 * MIN },
  { sha: "b2c3d4e5f60718293a4b5c6d7e8f901234567890", message: "新增投递导出 CSV 的公式注入防护", author: "li-xiaoman", at: 5 * HOUR },
  { sha: "c3d4e5f60718293a4b5c6d7e8f90123456789012", message: "文档：补充部署回滚步骤", author: "chen-hang", at: 1 * DAY },
].map(c => ({
  sha: c.sha, short_sha: c.sha.slice(0, 7), message: c.message, message_full: c.message,
  author: { name: c.author, email: `${c.author}@example.test`, date: iso(c.at) }, committer: null,
  actor: { login: c.author, avatar_url: null }, html_url: `https://github.com/${MOCK_ORG}/geek-main/commit/${c.sha}`,
}));

const issues = [
  { number: 17, title: "课表 MCP 在高峰期超时", state: "open", comments: 3, user: { login: "sun-qiao", avatar_url: null }, labels: [{ name: "bug", color: "d73a4a" }], created_at: iso(3 * HOUR), updated_at: iso(1 * HOUR), html_url: "#" },
  { number: 15, title: "补一份新成员入门清单", state: "open", comments: 0, user: { login: "liu-xing", avatar_url: null }, labels: [{ name: "docs", color: "0075ca" }], created_at: iso(4 * DAY), updated_at: iso(4 * DAY), html_url: "#" },
];

const pulls = [
  { number: 42, title: "控制台改用 Vue 3 + Tuffex", state: "open", draft: false, user: { login: "li-xiaoman", avatar_url: null }, head: "task/13/console_tuffex", base: "stage", merged: false, mergeable: true, created_at: iso(90 * MIN), updated_at: iso(20 * MIN), html_url: "#" },
];

function repoByName(name: string) {
  const repo = repos.find(r => r.name === name);
  if (!repo) throw new ApiError(404, "not_found", "仓库不存在");
  return repo;
}

/** 处理 `/api/admin/:org/*` 的 GET；未知路径返回 undefined。 */
export function routeGithub(url: URL): unknown {
  const match = url.pathname.match(/^\/api\/admin\/([^/]+)(\/.*)?$/);
  if (!match) return undefined;
  const persona = mockPersona();
  if (!persona) throw new ApiError(401, "not_signed_in", "请先登录");
  if (!persona.github_role) throw new ApiError(403, "not_a_member_of_org", "你不是该组织的成员");
  const role = persona.github_role;
  const rest = match[2] ?? "";
  const adminOnly = () => { if (role !== "admin") throw new ApiError(403, "requires_org_admin", "需要组织管理员权限"); };

  if (rest === "/overview") return { role, org: orgInfo, counts: { members: members.length, repos: repos.length, pending_invites: 2, invites_24h: 5, active_invite_links: 1 } };
  if (rest === "/members") return { members };
  if (rest === "/teams") return { teams };
  if (rest === "/activity") return { events: activity };
  if (rest === "/org") return orgInfo;
  if (rest === "/security") {
    return {
      plan: "free", two_factor_required: true,
      dependabot: { supported: true, reason: null, error: null, alerts: [
        { number: 3, security_advisory: { severity: "high", summary: "path-to-regexp 存在正则回溯" }, repository: { full_name: `${MOCK_ORG}/geek-main` }, dependency: { package: { name: "path-to-regexp" } } },
      ] },
      secret_scanning: { supported: false, reason: "免费版组织不提供密钥扫描" },
      audit_log: { supported: false, reason: "组织审计日志需要企业版" },
    };
  }
  if (rest === "/invitations") {
    adminOnly();
    return {
      pending: [
        { id: 1, login: "new-builder", email: null, role: "direct_member", inviter: { login: "chen-hang" }, created_at: iso(1 * HOUR) },
        { id: 2, login: null, email: "freshman@example.test", role: "direct_member", inviter: { login: "li-xiaoman" }, created_at: iso(1 * DAY) },
      ],
      history: [
        { id: 11, github_login: "bai-shuo", email: null, note: "转专业", invite_link_token: "dev-preview-link", status: "sent", source_ip: "10.0.0.31", created_at: now - 3 * DAY },
        { id: 10, github_login: "typo-user", email: null, note: null, invite_link_token: "dev-preview-link", status: "failed", source_ip: "10.0.0.32", created_at: now - 4 * DAY },
      ],
    };
  }
  if (rest === "/invite-links") {
    adminOnly();
    return {
      links: [
        { token: "dev-preview-link", org: MOCK_ORG, created_by: "chen-hang", note: "新生群", max_uses: 30, current_uses: 7, expires_at: now + 2 * DAY, team_slug: "ai-native", disabled: 0, created_at: now - 1 * DAY },
        { token: "dev-preview-expired", org: MOCK_ORG, created_by: "li-xiaoman", note: "去年的招新群", max_uses: 50, current_uses: 50, expires_at: now - 30 * DAY, team_slug: null, disabled: 0, created_at: now - 60 * DAY },
      ],
    };
  }
  if (rest === "/repos") return { repos };
  const repoMatch = rest.match(/^\/repos\/([^/]+)(\/.*)?$/);
  if (repoMatch) {
    const repo = repoByName(repoMatch[1]);
    const sub = repoMatch[2] ?? "";
    if (sub === "") {
      return {
        info: { ...repo, collaborators: 3 },
        branches: [{ name: repo.default_branch, protected: true }, { name: "stage", protected: true }, { name: "task/13/console_tuffex", protected: false }],
        collaborators: members.slice(0, 3).map(m => ({ login: m.login, avatar_url: null, role: m.role === "admin" ? "admin" : "write", permissions: {} })),
        hooks: [],
      };
    }
    if (sub === "/tree") {
      const path = url.searchParams.get("path") ?? "";
      const entries = path === ""
        ? [
          { name: "app", path: "app", type: "dir", size: 0 }, { name: "docs", path: "docs", type: "dir", size: 0 },
          { name: "package.json", path: "package.json", type: "file", size: 2180 }, { name: "README.md", path: "README.md", type: "file", size: 3260 },
        ]
        : [{ name: "README.md", path: `${path}/README.md`, type: "file", size: 812 }];
      return { path, entries };
    }
    if (sub === "/file") return { path: url.searchParams.get("path"), name: "README.md", size: 64, content: "# geek-main\n\n开发预览里的示例文件内容。\n", html_url: "#" };
    if (sub === "/commits") return { commits };
    if (sub.startsWith("/commits/")) {
      const sha = sub.slice("/commits/".length);
      const commit = commits.find(c => c.sha === sha) ?? commits[0];
      return {
        ...commit, message: commit.message_full, stats: { additions: 12, deletions: 3, total: 15 },
        files: [{ filename: "app/console/src/App.vue", status: "modified", additions: 12, deletions: 3, changes: 15, patch: "@@ -1,3 +1,4 @@\n-<nav>\n+<nav class=\"shell\">\n+  <!-- 窄屏用抽屉 -->\n </nav>" }],
      };
    }
    if (sub === "/issues") return { issues: url.searchParams.get("state") === "closed" ? [] : issues };
    if (sub === "/pulls") return { pulls: url.searchParams.get("state") === "closed" ? [] : pulls };
    const issue = sub.match(/^\/issues\/(\d+)$/);
    if (issue) {
      const found = issues.find(i => i.number === Number(issue[1]));
      if (!found) throw new ApiError(404, "not_found", "Issue 不存在");
      return { ...found, body: "高峰期（晚上 8 点左右）请求课表接口经常超过 10 秒。\n\n- 复现：并发 20 个请求\n- 期望：3 秒内返回", assignees: [], closed_at: null,
        comments: [{ id: 1, body: "我这边也能复现。", created_at: iso(2 * HOUR), user: { login: "wang-zhe", avatar_url: null } }] };
    }
    const pull = sub.match(/^\/pulls\/(\d+)$/);
    if (pull) {
      const found = pulls.find(p => p.number === Number(pull[1]));
      if (!found) throw new ApiError(404, "not_found", "合并请求不存在");
      return {
        ...found, body: "按 #13 重写控制台。", head: { ref: found.head, sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678" }, base: { ref: found.base },
        additions: 2400, deletions: 1800, changed_files: 3, comments: [],
        files: [{ filename: "app/console/src/App.vue", status: "added", additions: 120, deletions: 0, changes: 120, patch: "@@ -0,0 +1,2 @@\n+<template>\n+</template>" }],
      };
    }
  }
  return undefined;
}
