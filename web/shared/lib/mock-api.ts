// Development-only local fixtures. api() routes to this module when the data
// source is "mock" so protected pages can be browsed without a backend.
// Never used in production builds (production forces "live").
import { appConfig } from "../config";

const now = Date.now();
const demoOrg = "Yangtze-University-Geek-Class";
const avatar = "/logo.png";

const categories = [
  { id: 1, slug: "ai-native", name: "AI Native", description: "LLM、Agent 与上下文工程", parent_id: null, thread_count: 42 },
  { id: 2, slug: "systems", name: "系统与算法", description: "C++、系统开发与算法实践", parent_id: null, thread_count: 31 },
  { id: 3, slug: "security", name: "信息安全", description: "CTF、安全研究与工程防护", parent_id: null, thread_count: 18 },
  { id: 4, slug: "agent-mcp", name: "Agent 与 MCP", description: "工具调用、MCP Server 与 orchestration", parent_id: 1, thread_count: 19 },
  { id: 5, slug: "ai-coding", name: "AI Coding", description: "Cursor、Claude Code、Codex 与 Skill", parent_id: 1, thread_count: 23 },
  { id: 6, slug: "cpp", name: "C++", description: "语言、编译器与工程实践", parent_id: 2, thread_count: 17 },
  { id: 7, slug: "help", name: "求助与资源", description: "提问、路线与资料分享", parent_id: 3, thread_count: 18 },
];

const forumUser = {
  id: 1, username: "demo-admin", display_name: "开发预览管理员", avatar_url: avatar,
  role: "admin", has_password: true, has_github: true,
  groups: [{ id: 1, name: "members", is_default: 1 }],
  permissions: ["forum.admin", "thread.create", "thread.reply", "teacher.access"],
};

const threads = [
  { id: 101, title: "第一次写 MCP Server，工具边界应该怎么划分？", reply_count: 12, view_count: 286, is_sticky: 1, is_essence: 0, last_posted_at: now - 18e5, created_at: now - 72e5, author: forumUser, last_poster: forumUser, category: { slug: "agent-mcp", name: "Agent 与 MCP" } },
  { id: 102, title: "小模型本地推理：显存、速度与量化方案实测", reply_count: 24, view_count: 523, is_sticky: 0, is_essence: 1, last_posted_at: now - 54e5, created_at: now - 864e5, author: { ...forumUser, id: 2, username: "tensor-cat", display_name: "Tensor Cat" }, last_poster: forumUser, category: { slug: "ai-coding", name: "AI Coding" } },
  { id: 103, title: "系统方向本学期学习路线和实验清单", reply_count: 8, view_count: 198, is_sticky: 0, is_essence: 0, last_posted_at: now - 108e5, created_at: now - 1728e5, author: { ...forumUser, id: 3, username: "byte-wave", display_name: "Byte Wave" }, last_poster: null, category: { slug: "cpp", name: "C++" } },
];

const orgInfo = {
  login: demoOrg, name: "长江大学极客班", avatar_url: avatar, html_url: appConfig.urls.githubOrg,
  description: "长江大学校内技术共建社区", plan: "free", public_repos: 18, total_private_repos: 6,
  billing_email: "admin@example.test", two_factor_required: true, disk_usage_mb: 328, created_at: "2023-09-01T08:00:00Z",
  company: "Yangtze University", email: "hello@example.test", location: "Jingzhou, Hubei", blog: `https://${appConfig.sites.portal.host}`,
  twitter_username: "", default_repository_permission: "read", members_can_create_repositories: true,
  members_can_create_public_repositories: true, members_can_create_private_repositories: false,
  members_can_fork_private_repositories: true, members_can_create_pages: true,
  members_can_invite_outside_collaborators: false, members_can_delete_repositories: false,
  members_can_change_repo_visibility: false,
};

const repos = [
  { name: "admin", full_name: `${demoOrg}/admin`, description: "多组织 GitHub 管理后台与论坛", visibility: "private", archived: false, default_branch: "main", size_kb: 2840, language: "TypeScript", stargazers_count: 12, open_issues_count: 4, pushed_at: now - 18e5, topics: ["react", "fastify", "github"] },
  { name: "ai-coding-course", full_name: `${demoOrg}/ai-coding-course`, description: "AI Coding 课程与练习材料", visibility: "public", archived: false, default_branch: "main", size_kb: 1340, language: "Markdown", stargazers_count: 42, open_issues_count: 7, pushed_at: now - 864e5, topics: ["agent", "course", "prompt"] },
  { name: "mcp-lab", full_name: `${demoOrg}/mcp-lab`, description: "MCP Server 实验与校园服务集成", visibility: "public", archived: false, default_branch: "main", size_kb: 920, language: "Python", stargazers_count: 26, open_issues_count: 3, pushed_at: now - 1728e5, topics: ["mcp", "python"] },
];

const members = [
  { login: "demo-admin", id: 1, avatar_url: avatar, html_url: "#", role: "admin", state: "active" },
  { login: "tensor-cat", id: 2, avatar_url: avatar, html_url: "#", role: "member", state: "active" },
  { login: "byte-wave", id: 3, avatar_url: avatar, html_url: "#", role: "member", state: "active" },
];

const teams = [
  { name: "AI Native", slug: "ai-native", description: "Agent、MCP 与 AI Coding", privacy: "closed", member_count: 18, repo_count: 6 },
  { name: "Systems", slug: "systems", description: "系统、算法与基础设施", privacy: "closed", member_count: 12, repo_count: 4 },
];

function jsonClone<T>(value: T): T {
  return structuredClone(value);
}

function route(path: string): unknown {
  const url = new URL(path, "http://mock.local");
  const pathname = url.pathname;

  if (pathname === "/auth/me") return { signed_in: true, login: "demo-admin", avatar_url: avatar };
  if (pathname === "/api/me/orgs") return { orgs: [{ login: demoOrg, name: orgInfo.name, avatar_url: avatar, role: "admin", html_url: orgInfo.html_url }] };
  if (pathname === "/api/forum/me") return { signed_in: true, user: forumUser };
  if (pathname === "/api/forum/categories") return { categories };
  if (pathname === "/api/forum/threads") return { threads, total: threads.length, page: 1, page_size: 20 };
  if (pathname === "/api/forum/archive/categories") return { categories: categories.slice(0, 3) };
  if (pathname === "/api/forum/archive/threads") return { threads, total: threads.length, page: 1, page_size: 20 };
  if (pathname.startsWith("/api/forum/users/")) return { user: forumUser, recent_threads: threads.slice(0, 2) };
  if (/^\/api\/forum\/threads\/\d+$/.test(pathname)) return { thread: { ...threads[0], content: "这是开发环境的示例帖子内容。\n\n```ts\nconsole.log('hello YUGC')\n```", content_format: "markdown", is_locked: 0, is_legacy: 0 }, posts: [], page: 1, page_size: 30 };
  if (pathname === "/api/forum/me/notifications") return { notifications: [], unread: 0 };
  if (pathname === "/api/forum/teacher/overview") return {
    counts: { total_members: 42, admin: 2, teacher: 3, member: 37, threads_total: 103, posts_total: 286, threads_today: 4, posts_today: 12, active_users_7d: 31 },
    category_breakdown: categories.filter((c) => !c.parent_id).map((c) => ({ id: c.id, slug: c.slug, name: c.name, thread_count: c.thread_count, post_count: c.thread_count * 3 })),
    top_contributors: [forumUser, { ...forumUser, id: 2, username: "tensor-cat", display_name: "Tensor Cat", thread_count: 12, post_count: 46, liked_count: 88 }].map((u, index) => ({ ...u, thread_count: 18 - index * 6, post_count: 63 - index * 17, liked_count: 92 - index * 14 })),
    recent_threads: threads,
    recent_signups: [{ ...forumUser, created_at: now - 864e5, github_login: "demo-admin" }],
  };
  if (pathname === "/api/forum/groups") return { groups: [{ id: 1, name: "members", description: "默认成员组", is_default: 1, member_count: 42 }] };
  if (pathname === "/api/forum/permissions") return { permissions: [] };
  if (/^\/api\/forum\/groups\/\d+$/.test(pathname)) return { permissions: ["thread.create", "thread.reply"] };
  if (pathname === "/api/forum/admin/users") return { users: [{ ...forumUser, email: "demo@example.test", github_login: "demo-admin", legacy_mbbs_id: null, thread_count: 18, post_count: 63, last_seen_at: now - 18e5, created_at: now - 864e5 }], total: 1 };

  if (/\/overview$/.test(pathname)) return { role: "admin", org: orgInfo, counts: { members: 42, repos: 24, pending_invites: 3, invites_24h: 6, active_invite_links: 4 } };
  if (/\/members$/.test(pathname)) return { members };
  if (/\/repos$/.test(pathname)) return { repos };
  if (/\/repos\/[^/]+$/.test(pathname)) return { info: { ...repos[0], html_url: orgInfo.html_url, collaborators: 3 }, branches: [{ name: "main", protected: true }, { name: "dev", protected: false }], collaborators: members, hooks: [] };
  if (/\/repos\/[^/]+\/tree$/.test(pathname)) return { path: url.searchParams.get("path") ?? "", entries: [{ name: "src", path: "src", type: "dir", size: 0 }, { name: "README.md", path: "README.md", type: "file", size: 3260 }] };
  if (/\/repos\/[^/]+\/file$/.test(pathname)) return { content: "# YUGC Demo\n\n开发预览文件内容。", size: 36, html_url: "#" };
  if (/\/repos\/[^/]+\/commits$/.test(pathname)) return { commits: [] };
  if (/\/repos\/[^/]+\/issues$/.test(pathname)) return { issues: [] };
  if (/\/repos\/[^/]+\/pulls$/.test(pathname)) return { pulls: [] };
  if (/\/invitations$/.test(pathname)) return { pending: [{ id: 1, login: "new-builder", role: "direct_member", inviter: { login: "demo-admin" }, created_at: new Date(now - 36e5).toISOString() }], history: [] };
  if (/\/invite-links$/.test(pathname)) return { links: [{ token: "development-preview-token", org: demoOrg, created_by: "demo-admin", note: "开发预览", max_uses: 30, current_uses: 7, expires_at: now + 864e5, team_slug: "ai-native", disabled: 0, created_at: now - 864e5 }] };
  if (/\/teams$/.test(pathname)) return { teams };
  if (/\/activity$/.test(pathname)) return { events: [{ id: "1", actor: "demo-admin", actor_avatar: avatar, payload_summary: "推送了 3 个提交到", repo: "admin", created_at: now - 18e5, type: "PushEvent" }] };
  if (/\/security$/.test(pathname)) return { plan: "free", two_factor_required: true, dependabot: { supported: true, reason: null, error: null, alerts: [] }, secret_scanning: { supported: false, reason: "开发预览：当前 plan 不支持" }, audit_log: { supported: false, reason: "开发预览：需要 Enterprise Cloud" } };
  if (/\/org$/.test(pathname)) return orgInfo;
  if (/\/feedback$/.test(pathname)) return { items: [{ id: 1, category: "建议", status: "open", submitter_login: "student", contact: "", content: "希望增加更多项目复盘和新生任务。", reply: null, created_at: now - 72e5 }], counts: { open: 1, triaged: 0, in_progress: 0, done: 0, wont_do: 0, spam: 0 } };
  if (/\/logs$/.test(pathname)) return { logs: [{ id: 1, created_at: now - 18e5, actor: "demo-admin", action: "repo.preview", target: `${demoOrg}/admin`, ip: "127.0.0.1", details: { source: "mock" } }] };

  if (pathname === "/api/docs") return { items: [{ id: "usage", title: "使用指南", description: "开发预览文档" }] };
  if (pathname.startsWith("/api/docs/")) return { id: "usage", title: "使用指南", content: "# 开发预览\n\n当前使用本地 mock 数据。" };
  if (pathname === "/api/feedback/categories") return { categories: ["建议", "Bug", "新功能", "其他"], pow_difficulty: 1 };
  if (pathname === "/api/public/config") return { turnstile_site_key: null, pow_difficulty: 1 };
  if (pathname === "/api/feedback/public") return { items: [] };
  if (pathname.startsWith("/api/join/")) return { valid: true, org: demoOrg, note: "开发预览邀请", expires_at: now + 864e5, remaining_uses: 23, pow_difficulty: 1 };

  return { ok: true, mock: true };
}

export async function mockApi<T>(path: string, init?: RequestInit): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, init?.method && init.method !== "GET" ? 180 : 90));
  return jsonClone(route(path)) as T;
}
