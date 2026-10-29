import { ApiError } from "./http";
// Development-only local fixtures. api() routes to this module when the data
// source is "mock" so the portal can be browsed without a backend.
// Never used in production builds (production forces "live").
// 控制台的样板数据在 app/console/src/mock（控制台是独立的 Vue 包）。

const now = Date.now();
const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** 北京时间那一天的 00:00:00.000 与 23:59:59.999：控制台只填日期，存下来的就是这两个点。 */
const dayStart = (at: number) => Math.floor((at + 8 * HOUR) / DAY) * DAY - 8 * HOUR;
const dayEnd = (at: number) => dayStart(at) + DAY - 1;

/**
 * 比赛样板（#265）：五种状态、内部外部、有无官网各有一场，日期都落在整天边界上（与控制台存的一样）。
 * 只写起止时间，状态由界面按同一套口径（`statusAt`）现算；e2e 与改前改后截图也用这一份（传入同一个 `at`）。
 */
export function demoCompetitions(at = Date.now()) {
  const day = (offset: number, edge: "start" | "end") => (edge === "start" ? dayStart : dayEnd)(at + offset * DAY);
  return [
    { id: "c1001", name: "秋季黑客松", kind: "internal", start_at: day(12, "start"), end_at: day(13, "end"), signup_deadline: day(5, "end"), url: null, description: "两天一夜，三到五人一队，现场公布题目。\n还没有队伍也可以先报名，组织者会帮忙组队。" },
    { id: "c1002", name: "2026 校内算法赛", kind: "internal", start_at: day(9, "start"), end_at: day(9, "end"), signup_deadline: day(2, "end"), url: null, description: "个人赛，三小时八道题，按 ACM 规则排名。前十名进入校队集训名单。" },
    { id: "c1003", name: "CCPC 2026 哈尔滨站", kind: "external", start_at: day(25, "start"), end_at: day(26, "end"), signup_deadline: day(1, "end"), url: "https://ccpc.io/", description: "中国大学生程序设计竞赛区域赛，三人一队，以学校名义报名：先在官网注册队伍，再由教练审核。" },
    { id: "c1004", name: "蓝桥杯 Web 应用开发", kind: "external", start_at: day(40, "start"), end_at: day(40, "end"), signup_deadline: null, url: "https://dasai.lanqiao.cn/", description: "省赛线上进行，个人参赛。报名时间以官网公布为准。" },
    { id: "c1005", name: "全国大学生数学建模竞赛", kind: "external", start_at: day(3, "start"), end_at: day(5, "end"), signup_deadline: day(-3, "end"), url: null, description: "三人一队，三天内完成一篇建模论文。" },
    { id: "c1006", name: "极客班 CTF 新生赛", kind: "internal", start_at: day(-1, "start"), end_at: day(1, "end"), signup_deadline: day(-2, "end"), url: null, description: "线上解题赛，Web、逆向、密码学都有入门题，做出一道就算入门。" },
    { id: "c1007", name: "春季编程挑战赛", kind: "internal", start_at: day(-40, "start"), end_at: day(-40, "end"), signup_deadline: day(-45, "end"), url: null, description: "" },
  ];
}
const demoOrg = "Yangtze-University-Geek-Class";

/**
 * `?__mock=member` 时让秋季黑客松开着团队赛报名，比赛窗口才有「我的参赛」「组队广场」（#278）。
 * 只在成员身份下加：不带身份的开发预览（e2e 用的那份）比赛样板不变。
 */
function withDemoSignup(items: ReturnType<typeof demoCompetitions>) {
  return items.map((item) => (item.id === "c1001" ? { ...item, signup: { enabled: true, participation: "team", team_min: 3, team_max: 5, scoring: "none" } } : item));
}

const demoPerson = (login: string) => ({ account_id: `acc_${login}`, login, avatar_url: null });
/** 组队广场样板（#278）：两支招人的队伍、两个找队伍的人，都在秋季黑客松里。 */
function demoPlaza(at: number) {
  const base = { competition_id: "c1001", competition_name: "秋季黑客松" };
  const team = { person: null, team_id: null, team_name: null, slogan: null, leader: null, member_count: null, team_max: null, wanted_skills: null };
  return [
    { ...base, ...team, kind: "recruiting_team", note: "想做校园二手交易的小程序，后端已经有人了，缺一个会写前端、一个会做设计的。", since: at - 2 * 3600_000, team_id: "t1", team_name: "长江 Commit 队", slogan: "两天做出能用的东西", leader: demoPerson("chen_hang"), member_count: 2, team_max: 5, wanted_skills: ["前端", "UI 设计"] },
    { ...base, ...team, kind: "seeking_team", note: "大二，写过 Vue 和一点 Go，想找做工具类项目的队伍。", since: at - 5 * 3600_000, person: demoPerson("liu_xing") },
    { ...base, ...team, kind: "recruiting_team", note: "做一个帮新生找教室和自习座位的地图，算法和数据都准备好了。", since: at - 26 * 3600_000, team_id: "t2", team_name: "夜猫子", slogan: "", leader: demoPerson("li_xiaoman"), member_count: 3, team_max: 4, wanted_skills: ["后端", "地图"] },
    { ...base, ...team, kind: "seeking_team", note: "大一新生，会一点 Python，想跟着学。", since: at - 30 * 3600_000, person: demoPerson("he_miao") },
  ];
}

/**
 * 官网开发预览的身份（#275）：地址带 `?__mock=member|registered|visitor` 时，官网读 /auth/me 用这里的样板身份，
 * 形状照 #274 的接口契约（.tools/handoff/2026-10-23-yugc-os-v2/CONTRACT-274.md §1）。没带时官网照旧读真接口。
 */
export type MockPersona = "member" | "registered" | "visitor";

export function mockPersona(search = typeof window === "undefined" ? "" : window.location.search): MockPersona | null {
  const value = new URLSearchParams(search).get("__mock");
  return value === "member" || value === "registered" || value === "visitor" ? value : null;
}

const VISITOR_PERMISSIONS = ["forum.read.public"];
// 注册用户只读论坛（SPEC §3.2）；发帖、回帖、表情、比赛报名与组队、成员帖是成员才有的
const REGISTERED_PERMISSIONS = [...VISITOR_PERMISSIONS, "forum.read.registered", "apply.submit", "account.profile.edit", "account.invite.redeem", "account.cli.login"];
const MEMBER_PERMISSIONS = [
  ...REGISTERED_PERMISSIONS.filter((node) => node !== "account.invite.redeem"),
  "forum.read.member", "forum.topic.create", "forum.reply.create", "forum.react", "forum.sticker.use", "forum.upload.image", "competition.signup", "competition.team",
];

export function mockMe(persona: MockPersona) {
  if (persona === "visitor") return { signed_in: false, level: "visitor", permissions: VISITOR_PERMISSIONS, quota: { apply_left_today: 0, apply_daily_limit: 0 } };
  const member = persona === "member";
  return {
    signed_in: true,
    account_id: member ? "acc_demo_member" : "acc_demo_registered",
    login: member ? "nano" : "newbie",
    user_id: null,
    provider: "email",
    username: member ? "nano" : "newbie",
    display_name: member ? "Nano" : "新同学",
    bio: member ? "AI 部门，喜欢写编译器。" : "",
    avatar_url: null,
    level: persona,
    level_name: member ? "极客班成员" : "注册用户",
    department: member ? { id: "dept.ai", name: "AI部门", tone: "y" } : null,
    titles: member ? [{ id: "title.ai.staff", name: "部员", department_id: "dept.ai" }] : [],
    permissions: member ? MEMBER_PERMISSIONS : REGISTERED_PERMISSIONS,
    quota: member ? { apply_left_today: -1, apply_daily_limit: -1 } : { apply_left_today: 2, apply_daily_limit: 3 },
    prefs: { start_note_seen_at: null, forum_theme: null },
    identities: { emails: [member ? "n***@qq.com" : "x***@163.com"], google: member, github: member ? "nano-dev" : null },
    console_link: false,
    email_required: false,
    profile_required: false,
    real_name: member ? "王小明" : "李同学",
    grade: member ? 2 : 1,
    grade_label: member ? "大二" : "大一",
  };
}

/** GET /api/identity/me 里官网账号资料窗口用到的部分：绑定的邮箱（带 id，删的时候要）和实名信息（#280）；访客回 401 */
function demoIdentity(persona: MockPersona) {
  if (persona === "visitor") throw new ApiError(401, "unauthenticated", "没有登录");
  const member = persona === "member";
  return {
    account_id: member ? "acc_demo_member" : "acc_demo_registered",
    login: member ? "nano" : "newbie",
    identities: member
      ? [
          { provider: "email", id: "idn_email_1", label: "n***@qq.com", primary: true, linked_at: now - 90 * DAY, last_login_at: now - HOUR },
          { provider: "email", id: "idn_email_2", label: "n***@yangtzeu.edu.cn", primary: false, linked_at: now - 30 * DAY, last_login_at: null },
          { provider: "google", label: "Google", linked_at: now - 20 * DAY, last_login_at: null },
          { provider: "github", label: "nano-dev", linked_at: now - 60 * DAY, last_login_at: null },
        ]
      : [{ provider: "email", id: "idn_email_3", label: "x***@163.com", primary: true, linked_at: now - DAY, last_login_at: now - HOUR }],
    email_required: false,
    profile_required: false,
    real_name: member ? "王小明" : "李同学",
    grade: member ? 2 : 1,
    grade_label: member ? "大二" : "大一",
  };
}

/** GET /api/public/departments（契约 §1），顺序 AI、算法、硬件、网安、管理、无部门；名字、图标、色调与 #274 的初始数据一致 */
const demoDepartments = [
  ["ai", "AI部门", "y", "robot-2-line"],
  ["algo", "算法部门", "u", "code-s-slash-line"],
  ["hardware", "硬件部门", "c", "cpu-line"],
  ["security", "网安部门", "g", "shield-keyhole-line"],
  ["management", "管理部门", "pill", "government-line"],
].map(([id, name, tone, icon]) => ({
  id: `dept.${id}`, name, tone, icon, description: `${name}成员`,
  titles: [{ id: `title.${id}.head`, name: "部长", weight: id === "management" ? 80 : 60 }, { id: `title.${id}.deputy`, name: "副部长", weight: 50 }, { id: `title.${id}.staff`, name: "部员", weight: 40 }],
})).concat([{ id: "dept.none", name: "无部门", tone: "ink", icon: "user-line", description: "没有分配部门的账号（默认）", titles: [] }]);

/** GET /api/public/gitlab/projects（契约 §6）：只有公开项目；last_activity_at 照 GitLab 给 ISO 时间字符串 */
const demoProjects = [
  { name: "geek_main", path_with_namespace: "geek/geek_main", description: "官网、论坛、控制台和后端", web_url: "https://git.yangtzeu.work/geek/geek_main", http_url_to_repo: "https://git.yangtzeu.work/geek/geek_main.git", last_activity_at: new Date(now - 2 * HOUR).toISOString() },
  { name: "geek_bot", path_with_namespace: "geek/geek_bot", description: "合并请求审查机器人", web_url: "https://git.yangtzeu.work/geek/geek_bot", http_url_to_repo: "https://git.yangtzeu.work/geek/geek_bot.git", last_activity_at: new Date(now - 3 * DAY).toISOString() },
  { name: "oj-problems", path_with_namespace: "geek/oj-problems", description: "校内算法赛题目和数据", web_url: "https://git.yangtzeu.work/geek/oj-problems", http_url_to_repo: "https://git.yangtzeu.work/geek/oj-problems.git", last_activity_at: new Date(now - 12 * DAY).toISOString() },
];

function route(path: string): unknown {
  const url = new URL(path, "http://mock.local");
  const pathname = url.pathname;

  if (pathname === "/api/docs") return { items: [{ id: "usage", label: "使用指南", lang: "zh" }, { id: "usage-en", label: "Usage", lang: "en" }] };
  if (pathname.startsWith("/api/docs/")) return { id: pathname.split("/").pop(), label: "使用指南", lang: pathname.endsWith("-en") ? "en" : "zh", file: "docs/ops/USAGE.md", content: "# 开发预览\n\n当前使用本地 mock 数据。" };
  if (pathname === "/api/feedback/categories") return { categories: ["建议", "Bug", "新功能", "其他"], pow_difficulty: 1, org: demoOrg };
  if (pathname === "/api/public/config") return { turnstile_site_key: null, pow_difficulty: 1, apply_open: true };
  if (pathname === "/api/feedback/public") return { items: [] };
  if (pathname === "/api/public/competitions") return { competitions: mockPersona() === "member" ? withDemoSignup(demoCompetitions(now)) : demoCompetitions(now) };
  if (pathname === "/api/team-plaza" || pathname.startsWith("/api/me/competition")) {
    if (mockPersona() !== "member") throw new ApiError(401, "unauthorized", "请先登录");
    // 「我的参赛」样板（#281 使用说明截图）：秋季黑客松在队里、有一条待处理，春季编程挑战赛已定榜拿了第二名
    if (pathname === "/api/me/competitions") {
      return {
        items: [
          { competition_id: "c1001", state: "in_team", pending_count: 1, team: { id: "t1", name: "长江 Commit 队", status: "recruiting", member_count: 2, team_max: 5 } },
          { competition_id: "c1007", state: "signed_up", pending_count: 0, team: null },
        ],
        pending_total: 1,
      };
    }
    if (pathname === "/api/me/competition-results") {
      const prize = { amount_cny: 140, title: "GPT Plus 一个月订阅的价格", code: "YUGC-DEMO-7Q4M-2KXD", redeemed_at: null };
      return { items: [{ competition_id: "c1007", name: "春季编程挑战赛", finalized_at: now - 38 * 86_400_000, rank: 2, points: 158, prize }] };
    }
    if (pathname === "/api/team-plaza") {
      const kind = url.searchParams.get("kind");
      return { items: demoPlaza(now).filter((item) => !kind || item.kind === kind), next_cursor: null };
    }
  }
  if (pathname === "/auth/me") return mockMe(mockPersona() ?? "visitor");
  if (pathname === "/api/identity/me") return demoIdentity(mockPersona() ?? "visitor");
  if (pathname === "/api/public/departments") return { departments: demoDepartments };
  if (pathname === "/api/public/gitlab/projects") return { projects: demoProjects };
  if (pathname === "/api/me/gitlab/projects") {
    if (mockPersona() !== "member") throw new ApiError(403, "not_member", "代码仓库仅向有效极客班成员开放");
    return { projects: demoProjects };
  }

  throw new ApiError(404, "mock_route_missing", `开发预览未实现此接口：${pathname}`);
}

export async function mockApi<T>(path: string, init?: RequestInit): Promise<T> {
  if ((init?.method ?? "GET").toUpperCase() !== "GET") throw new ApiError(501, "mock_read_only", "开发预览为只读，操作验证请使用隔离测试或本地真实数据源");
  await new Promise((resolve) => setTimeout(resolve, 90));
  return structuredClone(route(path)) as T;
}
