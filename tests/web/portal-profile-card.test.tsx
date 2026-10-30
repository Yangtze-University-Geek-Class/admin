// @vitest-environment jsdom
// 账号资料窗口和新生便签（#275，SPEC §4.3、§4.4；#280 起资料从头像下面的弹层改成桌面窗口）：头像点开「账号资料」窗口，访客看到登录、注册，
// 登录后能改资料、看实名信息、管登录方式、填邀请码、退出；
// 「新来的看这里」只在这个浏览器第一次进来时自动出现，收起或点过其中一步就算看过，本地和账号上两处一起记。
// 接口形状照 #274 的接口契约（/auth/me、/api/identity/*、/api/events）；fetch 换成按地址回答的假函数，并记下每次请求。
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 便签的步骤会打开论坛、代码仓库：jsdom 不能整页跳转或开新标签页，换成什么都不做
vi.mock("../../app/web/sites/portal/lib/osApps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app/web/sites/portal/lib/osApps")>()),
  followAppLink: () => undefined,
}));
const navigated: string[] = [];
vi.mock("../../app/web/sites/portal/lib/navigate", () => ({ goTo: (url: string) => { navigated.push(url); } }));
vi.mock("../../app/web/sites/portal/components/os/Wallpaper", () => ({ default: () => null }));
vi.mock("../../app/web/sites/portal/components/PromoLazy", () => ({ LazyPromoPlayer: () => null }));
vi.mock("../../app/web/sites/portal/lib/wallpapers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../app/web/sites/portal/lib/wallpapers")>()),
  prefetchWallpapersWhenIdle: () => () => undefined,
}));

import YugcOs from "../../app/web/sites/portal/components/os/YugcOs";
import { parseMe } from "../../app/web/sites/portal/lib/account";
import { flushEvents } from "../../app/web/sites/portal/lib/events";
import { NOTE_SEEN_KEY } from "../../app/web/sites/portal/lib/startNote";
import { devPersonaMe } from "../../app/web/shared/lib/api";
import { mockMe, mockPersona } from "../../app/web/shared/lib/mock-api";

const MEMBER = {
  signed_in: true, account_id: "acc_1", login: "nano", user_id: null, provider: "email",
  username: "nano", display_name: "Nano", bio: "喜欢写编译器", avatar_url: null,
  level: "member", level_name: "极客班成员",
  department: { id: "dept.ai", name: "AI部门", tone: "y" },
  titles: [{ id: "title.ai.staff", name: "部员", department_id: "dept.ai" }],
  permissions: ["forum.read.public", "account.profile.edit"],
  quota: { apply_left_today: 3, apply_daily_limit: 3 },
  prefs: { start_note_seen_at: null, forum_theme: null },
  identities: { emails: ["n***@qq.com"], google: true, github: "nano-dev" },
  console_link: false, email_required: false, profile_required: false,
  real_name: "王小明", grade: 2, grade_label: "大二",
};
const REGISTERED = { ...MEMBER, grade: null, grade_label: null, account_id: "acc_2", login: "newbie", username: "newbie", display_name: "新同学", bio: "", level: "registered", level_name: "注册用户", department: null, titles: [], identities: { emails: ["x***@163.com"], google: false, github: null } };
const IDENTITY_ME = {
  account_id: "acc_1", login: "nano", email_required: false,
  identities: [
    { provider: "email", id: "idn_1", label: "n***@qq.com", primary: true, linked_at: 1, last_login_at: 2 },
    { provider: "email", id: "idn_2", label: "n***@yangtzeu.edu.cn", primary: false, linked_at: 1, last_login_at: null },
    { provider: "github", label: "nano-dev", linked_at: 1, last_login_at: null },
  ],
  real_name: "王小明", grade: 2, grade_label: "大二", profile_required: false,
};

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let answers: Record<string, (body: unknown) => Response> = {};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function answer(me: unknown, extra: Record<string, (body: unknown) => Response> = {}) {
  answers = {
    "GET /auth/me": () => json(me),
    "GET /api/identity/me": () => json(IDENTITY_ME),
    "POST /api/events": () => json({ accepted: 1, rejected: 0 }),
    "POST /auth/signout": () => new Response(null, { status: 204 }),
    "PATCH /api/identity/profile": (body) => json({ username: "nano", display_name: "Nano", bio: "喜欢写编译器", avatar_url: null, prefs: {}, ...(body as object) }),
    ...extra,
  };
}

beforeEach(() => {
  calls = [];
  navigated.length = 0;
  answer({ signed_in: false });
  // 资料卡里的写请求走 @shared/lib/api：开发态默认读样板数据，这里切到真接口（也就是下面的假 fetch）
  localStorage.setItem("yugc:dev-data-source", "live");
  document.cookie = "yugc_promo_seen=1; Path=/";
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body ?? null;
    calls.push({ method, url, body });
    const reply = answers[`${method} ${new URL(url, "http://x").pathname}`];
    return reply ? reply(body) : json({ error: "not_found", message: "没有这个接口" }, 404);
  }));
});
afterEach(() => {
  cleanup();
  flushEvents();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const mount = () => render(<MemoryRouter><YugcOs /></MemoryRouter>);
const writes = () => calls.filter((call) => call.method !== "GET" && call.url !== "/api/events");
const bar = () => within(screen.getByRole("banner", { name: "菜单栏" }));

async function openCard(name: string) {
  const avatar = await bar().findByRole("button", { name });
  avatar.focus();
  fireEvent.click(avatar);
  return { avatar, card: within(screen.getByRole("dialog", { name: /^(账号资料|登录极客班)$/ })) };
}

describe("/auth/me 的新字段（CONTRACT-274 §1）", () => {
  it("读出用户名、昵称、简介、身份、部门、称号、限额、偏好和登录方式；旧服务端没有这些字段时给空值", () => {
    expect(parseMe({ ...MEMBER, prefs: { start_note_seen_at: 1792768438000 } })).toMatchObject({
      username: "nano", displayName: "Nano", bio: "喜欢写编译器", gradeLabel: "大二", level: "member", levelName: "极客班成员",
      department: { id: "dept.ai", name: "AI部门", tone: "y" }, titles: [{ id: "title.ai.staff", name: "部员" }],
      quota: { left: 3, limit: 3 }, prefs: { startNoteSeenAt: 1792768438000 }, identities: { emails: ["n***@qq.com"], google: true, github: "nano-dev" },
    });
    expect(parseMe({ signed_in: true, login: "ada" })).toMatchObject({
      username: "ada", displayName: "ada", bio: "", gradeLabel: null, level: null, levelName: null, department: null, titles: [], quota: null,
      prefs: { startNoteSeenAt: null }, identities: { emails: [], google: false, github: null },
    });
    // 不认识的部门色当作无部门的颜色，不认识的身份当作没有；不限投递时两个都是 -1
    expect(parseMe({ ...MEMBER, department: { id: "dept.x", name: "X", tone: "red" }, level: "visitor" })).toMatchObject({ department: { tone: "ink" }, level: null });
    expect(parseMe({ ...MEMBER, quota: { apply_left_today: -1, apply_daily_limit: -1 } })?.quota).toEqual({ left: -1, limit: -1 });
  });

  it("开发预览的身份：地址带 ?__mock= 时用样板身份，形状和真接口一样；不认识的值不算", async () => {
    expect(mockPersona("?__mock=member")).toBe("member");
    expect(mockPersona("?__mock=admin")).toBeNull();
    // 成员投递不限（SPEC §3.8）：两个数都是 -1
    expect(parseMe(mockMe("member"))).toMatchObject({ login: "nano", level: "member", department: { tone: "y" }, quota: { left: -1, limit: -1 } });
    expect(parseMe(mockMe("registered"))).toMatchObject({ level: "registered", department: null, quota: { left: 2, limit: 3 } });
    expect(parseMe(mockMe("visitor"))).toBeNull();
    expect(await devPersonaMe()).toBeNull();
    window.history.replaceState(null, "", "/?__mock=registered");
    expect(await devPersonaMe()).toMatchObject({ login: "newbie", level: "registered" });
  });

  it("开发态地址带 ?__mock=member 时桌面不请求 /auth/me，头像就是样板身份", async () => {
    window.history.replaceState(null, "", "/?__mock=member");
    mount();
    await bar().findByRole("button", { name: "账号：nano" });
    expect(calls.some((call) => call.url === "/auth/me")).toBe(false);
  });
});

describe("账号资料窗口", () => {
  it("访客：窗口名是「登录极客班」，里面登录、注册两个按钮和一句说明；Esc 关掉窗口，焦点回到头像", async () => {
    mount();
    const { avatar, card } = await openCard("登录或注册");
    const win = screen.getByRole("dialog", { name: "登录极客班" });
    expect(win.className).toContain("pt-win");
    expect(avatar.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(card.getByRole("link", { name: "登录" }));
    expect(document.querySelector(".pt-mb-app")?.textContent).toBe("登录极客班");
    expect(card.getByRole("link", { name: "登录" }).getAttribute("href")).toBe("/signin?return_to=%2F");
    expect(card.getByRole("link", { name: "注册" }).getAttribute("href")).toBe("/signin?return_to=%2F&tab=register");
    expect(card.getByText("注册不需要邀请码，有邀请码可以直接成为成员")).not.toBeNull();
    expect(card.queryByRole("button", { name: "退出" })).toBeNull();
    fireEvent.keyDown(card.getByRole("link", { name: "登录" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(avatar));
    expect(avatar.getAttribute("aria-expanded")).toBe("false");
  });

  it("成员：头像、昵称、@用户名、简介、身份 · 年级 · 部门 · 称号，实名信息只在窗口里的「实名信息」一栏，带 id 的邮箱列表、Google 已绑定、GitHub 只显示；没有邀请码输入框", async () => {
    answer(MEMBER);
    mount();
    const { card } = await openCard("账号：nano");
    // 焦点落在「换头像」上，不落在隐藏的选图输入框或昵称输入框里
    expect(document.activeElement).toBe(card.getByRole("button", { name: "换头像" }));
    expect((card.getByRole("textbox", { name: "昵称" }) as HTMLInputElement).value).toBe("Nano");
    expect((card.getByRole("textbox", { name: "用户名" }) as HTMLInputElement).value).toBe("nano");
    expect((card.getByRole("textbox", { name: "简介" }) as HTMLTextAreaElement).value).toBe("喜欢写编译器");
    expect(card.getByRole("button", { name: "换头像" })).not.toBeNull();
    const meta = document.querySelector(".pt-profile-meta")!;
    expect([...meta.children].map((item) => item.textContent)).toEqual(["极客班成员", "大二", "AI部门", "部员"]);
    expect(meta.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("y");
    // 真实姓名读 /api/identity/me，只出现在窗口里的「实名信息」一栏；菜单栏和身份行都不显示
    const real = within(await card.findByRole("region", { name: "实名信息" }));
    expect([...real.getAllByRole("definition")].map((item) => item.textContent)).toEqual(["王小明", "大二"]);
    expect(meta.textContent).not.toContain("王小明");
    expect(bar().queryByText(/王小明/)).toBeNull();
    expect(document.body.textContent?.split("王小明")).toHaveLength(2);
    // 邮箱列表换成 /api/identity/me 里带 id 的那份：主邮箱不能删，另一个可以
    await card.findByText("n***@yangtzeu.edu.cn");
    expect(card.getByText("主邮箱")).not.toBeNull();
    expect(card.getAllByRole("button", { name: "删除" })).toHaveLength(1);
    expect(card.getByText("已绑定")).not.toBeNull();
    expect(card.getByText("nano-dev")).not.toBeNull();
    expect(card.queryByRole("link", { name: "绑定" })).toBeNull();
    expect(card.queryByLabelText("填邀请码成为极客班成员")).toBeNull();
    expect(card.getByRole("link", { name: /账号设置/ }).getAttribute("href")).toBe("/account");
    expect(card.queryByRole("link", { name: "控制台" })).toBeNull();
  });

  it("改昵称：失焦保存一次，没改不发请求；用户名不合规当场提示、不发请求；回车也保存", async () => {
    answer(MEMBER);
    mount();
    const { card } = await openCard("账号：nano");
    const name = card.getByRole("textbox", { name: "昵称" });
    fireEvent.blur(name);
    expect(writes()).toEqual([]);
    fireEvent.change(name, { target: { value: "  Nano 2  " } });
    fireEvent.blur(name);
    await waitFor(() => expect(writes()).toEqual([{ method: "PATCH", url: "/api/identity/profile", body: { display_name: "Nano 2" } }]));
    await card.findByText("已保存");
    expect(screen.getByRole("button", { name: "账号：nano" })).not.toBeNull();

    const username = card.getByRole("textbox", { name: "用户名" });
    fireEvent.change(username, { target: { value: "No Way" } });
    fireEvent.blur(username);
    expect(card.getByRole("alert").textContent).toBe("用户名是 3 到 24 位小写字母、数字或下划线");
    expect(writes()).toHaveLength(1);

    const bio = card.getByRole("textbox", { name: "简介" });
    bio.focus();
    fireEvent.change(bio, { target: { value: "写编译器，也写前端" } });
    fireEvent.keyDown(bio, { key: "Enter" });
    await waitFor(() => expect(writes().at(-1)).toEqual({ method: "PATCH", url: "/api/identity/profile", body: { bio: "写编译器，也写前端" } }));
  });

  it("用户名被占用：留着改到一半的值，显示服务端的原因", async () => {
    answer(MEMBER, { "PATCH /api/identity/profile": () => json({ error: "username_taken", message: "这个用户名已经有人用了" }, 409) });
    mount();
    const { card } = await openCard("账号：nano");
    const username = card.getByRole("textbox", { name: "用户名" }) as HTMLInputElement;
    fireEvent.change(username, { target: { value: "Fixture_Owner" } });
    fireEvent.blur(username);
    expect((await card.findByRole("alert")).textContent).toBe("这个用户名已经有人用了");
    expect(writes()[0].body).toEqual({ username: "fixture_owner" });
    expect(username.value).toBe("Fixture_Owner");
  });

  it("删邮箱要点两次（删除、确认删除），发 identity_id；要重新登录时给重新登录的链接", async () => {
    answer(MEMBER, { "POST /api/identity/email/remove": () => json({ error: "step_up_required", message: "这一步要求刚登录过，请重新登录后再试" }, 403) });
    mount();
    const { card } = await openCard("账号：nano");
    fireEvent.click(await card.findByRole("button", { name: "删除" }));
    expect(writes()).toEqual([]);
    fireEvent.click(card.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(writes()).toEqual([{ method: "POST", url: "/api/identity/email/remove", body: { identity_id: "idn_2" } }]));
    const alert = await card.findByRole("alert");
    expect(alert.textContent).toContain("这一步要求刚登录过");
    expect(within(alert).getByRole("link", { name: "重新登录" }).getAttribute("href")).toBe("/signin?return_to=%2F");
  });

  it("添加邮箱：发验证码后倒计时，填 6 位验证码确认，成功后重读登录方式", async () => {
    answer(MEMBER, {
      "POST /api/identity/email/start": () => json({ resend_after: 60 }, 202),
      "POST /api/identity/email/verify": () => json({ ok: true }),
    });
    mount();
    const { card } = await openCard("账号：nano");
    fireEvent.click(card.getByRole("button", { name: /添加邮箱/ }));
    fireEvent.change(card.getByRole("textbox", { name: "新邮箱地址" }), { target: { value: "nano@example.com" } });
    fireEvent.click(card.getByRole("button", { name: "发验证码" }));
    await card.findByRole("button", { name: "60 秒后重发" });
    fireEvent.change(card.getByRole("textbox", { name: "验证码" }), { target: { value: "12a3456" } });
    expect((card.getByRole("textbox", { name: "验证码" }) as HTMLInputElement).value).toBe("123456");
    const before = calls.filter((call) => call.url === "/api/identity/me").length;
    fireEvent.click(card.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(calls.filter((call) => call.url === "/api/identity/me").length).toBeGreaterThan(before));
    expect(writes()).toEqual([
      { method: "POST", url: "/api/identity/email/start", body: { email: "nano@example.com" } },
      { method: "POST", url: "/api/identity/email/verify", body: { code: "123456" } },
    ]);
  });

  it("注册用户：显示「注册用户 · 无部门」和邀请码输入框；码不对显示原因，兑换成功后重读 /auth/me；Google 没绑时给绑定链接", async () => {
    let redeem = 0;
    answer(REGISTERED, {
      "POST /api/identity/invite/redeem": () => (++redeem === 1 ? json({ error: "invite_invalid", message: "邀请码不对" }, 400) : json({ level: "member" })),
    });
    mount();
    const { card } = await openCard("账号：newbie");
    // 窗口底部的邀请码输入框也不抢焦点
    expect(document.activeElement).toBe(card.getByRole("button", { name: "换头像" }));
    expect(document.querySelector(".pt-profile-meta")?.textContent).toBe("注册用户无部门");
    expect(document.querySelector(".pt-profile-meta [data-tone]")?.getAttribute("data-tone")).toBe("ink");
    // 绑定不是登录链接（#291）：是一个按钮，走 POST /api/identity/link
    expect(card.queryByRole("link", { name: "绑定" })).toBeNull();
    expect(card.getByRole("button", { name: "绑定" })).toBeTruthy();
    const code = card.getByLabelText("填邀请码成为极客班成员");
    fireEvent.change(code, { target: { value: "GEEK-2026" } });
    fireEvent.click(card.getByRole("button", { name: "提交" }));
    expect((await card.findByRole("alert")).textContent).toBe("邀请码不对");
    const reads = calls.filter((call) => call.url === "/auth/me").length;
    fireEvent.click(card.getByRole("button", { name: "提交" }));
    await card.findByText("已经是极客班成员了");
    await waitFor(() => expect(calls.filter((call) => call.url === "/auth/me").length).toBe(reads + 1));
    expect(writes().map((call) => call.body)).toEqual([{ code: "GEEK-2026" }, { code: "GEEK-2026" }]);
  });

  it("有 console_link 时底部多一个控制台；退出后关掉账号资料窗口，头像变回访客", async () => {
    answer({ ...MEMBER, console_link: true });
    mount();
    const { card } = await openCard("账号：nano");
    expect(card.getByRole("link", { name: "控制台" })).not.toBeNull();
    fireEvent.click(card.getByRole("button", { name: /退出/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toEqual([{ method: "POST", url: "/auth/signout", body: null }]);
    expect(bar().getByRole("button", { name: "登录或注册" })).not.toBeNull();
  });
});

describe("「新来的看这里」只出现一次", () => {
  const note = () => screen.queryByRole("complementary", { name: "新来的看这里" });

  it("第一次进来出现；收起后记在本地并报 os.note.dismissed，刷新（重新挂载）后不再出现；「帮助」里还能打开", async () => {
    const first = mount();
    expect(note()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "收起这张便签" }));
    expect(note()).toBeNull();
    expect(Number(localStorage.getItem(NOTE_SEEN_KEY))).toBeGreaterThan(0);
    flushEvents();
    const events = calls.filter((call) => call.url === "/api/events").flatMap((call) => (call.body as { events: Array<{ action: string }> }).events);
    expect(events.map((event) => event.action)).toContain("os.note.dismissed");
    // 访客：不往账号上记
    expect(writes()).toEqual([]);
    first.unmount();

    mount();
    expect(note()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "帮助" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "新来的看这里" }));
    expect(note()).not.toBeNull();
    // 不再用按会话记的旧开关
    expect(sessionStorage.getItem("yugc:start-note")).toBeNull();
  });

  it("已登录：点了其中一步也算看过，本地和账号 prefs 一起记，便签这次先不收起；打开应用报 os.app.open", async () => {
    answer(MEMBER);
    const first = mount();
    await bar().findByRole("button", { name: "账号：nano" });
    fireEvent.click(screen.getByRole("button", { name: /去「论坛」看看/ }));
    expect(note()).not.toBeNull();
    const at = Number(localStorage.getItem(NOTE_SEEN_KEY));
    expect(at).toBeGreaterThan(0);
    await waitFor(() => expect(writes()).toEqual([{ method: "PATCH", url: "/api/identity/profile", body: { prefs: { start_note_seen_at: at } } }]));
    // 再点一步不重复记到账号上
    fireEvent.click(screen.getByRole("button", { name: /去「代码仓库」/ }));
    expect(writes()).toHaveLength(1);
    flushEvents();
    const events = calls.filter((call) => call.url === "/api/events").flatMap((call) => (call.body as { events: Array<{ action: string; target_id?: string }> }).events);
    expect(events.filter((event) => event.action === "os.app.open").map((event) => event.target_id)).toEqual(["forum", "gitlab"]);
    first.unmount();
    mount();
    expect(note()).toBeNull();
  });

  it("这个浏览器没记过、账号上记过：登录信息回来后便签收起，并补记到本地", async () => {
    answer({ ...MEMBER, prefs: { start_note_seen_at: 1792768438000, forum_theme: null } });
    mount();
    await bar().findByRole("button", { name: "账号：nano" });
    await waitFor(() => expect(note()).toBeNull());
    expect(localStorage.getItem(NOTE_SEEN_KEY)).toBe("1792768438000");
    expect(writes()).toEqual([]);
  });
});

describe("绑定 Google（#291）：给当前账号绑定，不是再登录一次", () => {
  const link = (card: ReturnType<typeof within>) => card.getByRole("button", { name: "绑定" });

  it("点「绑定」先 POST /api/identity/link 再整页跳到 Google；不再链到 /auth/google 登录入口", async () => {
    answer(REGISTERED, { "POST /api/identity/link": () => json({ authorize_url: "https://accounts.google.com/o/oauth2/v2/auth?state=s1" }) });
    mount();
    const { card } = await openCard("账号：newbie");
    expect(document.querySelector('a[href^="/auth/google"]')).toBeNull();
    fireEvent.click(link(card));
    await waitFor(() => expect(navigated).toEqual(["https://accounts.google.com/o/oauth2/v2/auth?state=s1"]));
    expect(writes()).toEqual([{ method: "POST", url: "/api/identity/link", body: { provider: "google", return_to: "/?open=profile" } }]);
  });

  it("登录超过 10 分钟：显示接口说明和「重新登录」链接，不跳转；已经绑了的显示「已绑定」", async () => {
    answer(REGISTERED, {
      "POST /api/identity/link": () => json({ error: "step_up_required", message: "这一步要求刚登录过，请重新登录后再试" }, 403),
    });
    mount();
    const { card } = await openCard("账号：newbie");
    fireEvent.click(link(card));
    expect((await card.findByRole("alert")).textContent).toContain("这一步要求刚登录过");
    expect(card.getByRole("link", { name: "重新登录" })).toBeTruthy();
    expect(navigated).toEqual([]);
    // 按钮恢复，可以再点
    expect((link(card) as HTMLButtonElement).disabled).toBe(false);
  });

  it("本账号已经有 Google 时没有绑定按钮", async () => {
    answer(MEMBER);
    mount();
    const { card } = await openCard("账号：nano");
    expect(card.queryByRole("button", { name: "绑定" })).toBeNull();
    expect(card.getByText("已绑定")).toBeTruthy();
  });

  it("从 Google 绑定回来：地址带 ?open=profile&link=linked&provider=google 时自动打开资料窗口并显示结果，地址上的参数被清掉", async () => {
    answer(MEMBER);
    const Where = () => <output data-testid="where">{useLocation().search}</output>;
    render(<MemoryRouter initialEntries={["/?open=profile&link=linked&provider=google&keep=1"]}><YugcOs /><Where /></MemoryRouter>);
    const card = within(await screen.findByRole("dialog", { name: "账号资料" }));
    expect((await card.findByRole("status")).textContent).toBe("已绑定 Google，以后可以直接用它登录这个账号。");
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("?keep=1"));
  });

  it("link 不是 Google 的结果（provider 不是 google）：不弹窗口，也不显示结果", async () => {
    answer(REGISTERED);
    render(<MemoryRouter initialEntries={["/?link=linked&provider=github"]}><YugcOs /></MemoryRouter>);
    await bar().findByRole("button", { name: "账号：newbie" });
    expect(screen.queryByRole("dialog", { name: "账号资料" })).toBeNull();
    expect(screen.queryByText(/已绑定 Google/)).toBeNull();
  });

  it("绑定被拒时说清原因：Google 账号属于别的账号、本账号已有、取消、失败；不认识的值不弹窗口", async () => {
    const cases: [string, string][] = [
      ["conflict", "这个 Google 账号已经绑在别的极客班账号上，没有绑到你现在的账号。"],
      ["exists", "你的账号已经绑定了 Google。"],
      ["cancelled", "你取消了 Google 授权，没有绑定。"],
      ["failed", "Google 授权没有完成，没有绑定。再点一次「绑定」试试。"],
    ];
    for (const [value, text] of cases) {
      answer(REGISTERED);
      const view = render(<MemoryRouter initialEntries={[`/?open=profile&link=${value}&provider=google`]}><YugcOs /></MemoryRouter>);
      const card = within(await screen.findByRole("dialog", { name: "账号资料" }));
      expect((await card.findByRole("alert")).textContent).toBe(text);
      view.unmount();
      cleanup();
    }
    answer(REGISTERED);
    render(<MemoryRouter initialEntries={["/?link=hacked&provider=google"]}><YugcOs /></MemoryRouter>);
    await bar().findByRole("button", { name: "账号：newbie" });
    expect(screen.queryByRole("dialog", { name: "账号资料" })).toBeNull();
  });
});
