// @vitest-environment jsdom
// 成员项目、公开项目与登录切换；请求只在隔离夹具中回应，不访问真实 GitLab。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeRepos } from "../../app/web/sites/portal/components/os/Windows";
import { CODE_REPOS_URL, MEMBER_CODE_REPOS_URL, readCodeRepos } from "../../app/web/sites/portal/lib/codeRepos";
import { parseMe, type Account } from "../../app/web/sites/portal/lib/account";
import { links } from "../../app/web/sites/portal/lib/links";

// 开发态默认走只读样板数据；这里切到真实数据源，让窗口真的去请求（请求由 fetch 桩接住）。
beforeEach(() => localStorage.setItem("yugc:dev-data-source", "live"));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const project = (name: string, at: string | null, description: string | null = null) => ({
  id: name.length, name, path_with_namespace: `geek/${name}`, description,
  web_url: `https://example.test/gitlab/geek/${name}`, http_url_to_repo: `https://example.test/gitlab/geek/${name}.git`, last_activity_at: at,
});

function serve(response: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const member = parseMe({ signed_in: true, login: "alice", account_id: "account_a", level: "member" })!;
// 所有用例共用真实路由上下文；rerender 保留同一个窗口实例以检查身份转换。
const ui = (account: Account | null = null, loaded = true) => <MemoryRouter><CodeRepos account={account} accountLoaded={loaded} /></MemoryRouter>;

it("访客只展示公开项目，按活动排序，登录回到同一个代码仓库窗口", async () => {
  const fetchMock = serve(async () => json({ projects: [project("old", "2026-01-02T03:04:05.000Z", "旧项目"), project("fresh", new Date(Date.now() - 3 * 864e5).toISOString())] }));
  render(ui());
  const list = await screen.findByRole("list", { name: "公开项目" });
  const items = within(list).getAllByRole("link");
  expect(items.map(item => item.getAttribute("href"))).toEqual(["https://example.test/gitlab/geek/fresh", "https://example.test/gitlab/geek/old"]);
  expect(fetchMock.mock.calls[0][0]).toBe(CODE_REPOS_URL);
  for (const item of items) {
    expect(item.getAttribute("target")).toBe("_blank");
    expect(item.getAttribute("rel")).toBe("noopener noreferrer");
  }
  expect(screen.getByRole("link", { name: "登录极客班" }).getAttribute("href")).toBe("/signin?return_to=%2F%3Fopen%3Dgitlab");
});

it.each(["member", "alumni"] as const)("有效 %s 使用成员项目，不把私有列表当成空的公开列表", async level => {
  const fetchMock = serve(async () => json({ projects: [project("private-project", null)] }));
  render(ui({ ...member, level }));
  const list = await screen.findByRole("list", { name: "成员项目" });
  expect(within(list).getByRole("link").getAttribute("href")).toBe("https://example.test/gitlab/geek/private-project");
  expect(fetchMock.mock.calls[0][0]).toBe(MEMBER_CODE_REPOS_URL);
  expect(screen.queryByRole("list", { name: "公开项目" })).toBeNull();
  const entry = screen.getByRole("link", { name: /进入代码仓库/ });
  expect(entry.getAttribute("href")).toBe(links.gitlab());
  expect(entry.getAttribute("target")).toBe("_blank");
  expect(entry.getAttribute("rel")).toBe("noopener noreferrer");
  expect(screen.queryByRole("link", { name: "登录极客班" })).toBeNull();
});

it("注册用户仍只能读公开项目，身份入口不冒充已经成为成员", async () => {
  const fetchMock = serve(async () => json({ projects: [project("public-project", null)] }));
  render(ui({ ...member, level: "registered" }));
  expect(await screen.findByRole("list", { name: "公开项目" })).toBeTruthy();
  expect(fetchMock.mock.calls[0][0]).toBe(CODE_REPOS_URL);
  expect(screen.getByRole("link", { name: "查看账号身份" }).getAttribute("href")).toBe("/account");
  expect(screen.queryByRole("list", { name: "成员项目" })).toBeNull();
});

it.each([401, 403])("成员端点 %i 不伪装成空列表，回到统一登录", async status => {
  serve(async () => json({ error: "not_member" }, status));
  render(ui(member));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.getByRole("link", { name: "登录极客班" }).getAttribute("href")).toBe("/signin?return_to=%2F%3Fopen%3Dgitlab");
  expect(screen.queryByRole("link", { name: /进入代码仓库/ })).toBeNull();
});

it("退出后立即隐藏旧私有列表，不等新的公开请求完成", async () => {
  const publicRequest = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", vi.fn((url: string) => url === MEMBER_CODE_REPOS_URL
    ? Promise.resolve(json({ projects: [project("private-project", null)] }))
    : publicRequest.promise));
  const view = render(ui(member));
  await screen.findByText("private-project");
  view.rerender(ui());
  expect(screen.queryByText("private-project")).toBeNull();
  await act(async () => { publicRequest.resolve(json({ projects: [project("public-project", null)] })); });
  expect(await screen.findByText("public-project")).toBeTruthy();
  expect(screen.queryByText("private-project")).toBeNull();
});

it("切换成员账号后，上一账号迟到的响应不能覆盖当前账号", async () => {
  const pending: Array<{ signal: AbortSignal; finish: (response: Response) => void }> = [];
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
    const request = Promise.withResolvers<Response>();
    pending.push({ signal: init.signal as AbortSignal, finish: request.resolve });
    return request.promise;
  }));
  const view = render(ui(member));
  await waitFor(() => expect(pending).toHaveLength(1));
  view.rerender(ui({ ...member, accountId: "account_b" }));
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[0].signal.aborted).toBe(true);
  await act(async () => { pending[1].finish(json({ projects: [project("current-project", null)] })); });
  await screen.findByText("current-project");
  await act(async () => { pending[0].finish(json({ projects: [project("old-private-project", null)] })); });
  expect(screen.getByText("current-project")).toBeTruthy();
  expect(screen.queryByText("old-private-project")).toBeNull();
});

it("身份尚未加载时不查询；缺失成员账号标识时拒绝复用其他成员列表", async () => {
  const fetchMock = serve(async () => json({ projects: [project("private-project", null)] }));
  const view = render(ui(member, false));
  expect(fetchMock).not.toHaveBeenCalled();
  view.rerender(ui({ ...member, accountId: null }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
  view.rerender(ui(member));
  await screen.findByText("private-project");
  view.unmount();
  expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
});

describe("readCodeRepos", () => {
  it("只留有名字和 http(s) 地址的项目；时间认 ISO 字符串和毫秒，读不出是 null 并排到最后", () => {
    const state = readCodeRepos({
      projects: [
        project("no-time", null),
        { ...project("bad-url", "2026-10-01T00:00:00Z"), web_url: "javascript:alert(1)" },
        { ...project("", "2026-10-01T00:00:00Z") },
        { ...project("ms", null), last_activity_at: Date.UTC(2026, 9, 2) },
        project("iso", "2026-10-01T00:00:00Z", "  说明  "),
        "不是对象",
      ],
    });
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.projects.map((item) => [item.name, item.activeAt])).toEqual([
      ["ms", Date.UTC(2026, 9, 2)],
      ["iso", Date.UTC(2026, 9, 1)],
      ["no-time", null],
    ]);
    expect(state.projects[1]).toEqual({
      name: "iso", path: "geek/iso", description: "说明", url: "https://example.test/gitlab/geek/iso", cloneUrl: "https://example.test/gitlab/geek/iso.git", activeAt: Date.UTC(2026, 9, 1),
    });
  });

  it("unavailable 为 true 时是连不上；形状不对是读不到", () => {
    expect(readCodeRepos({ projects: [], unavailable: true })).toEqual({ status: "unavailable" });
    expect(readCodeRepos({ projects: [] })).toEqual({ status: "ready", projects: [] });
    for (const body of [null, {}, { projects: "x" }, []]) expect(readCodeRepos(body)).toEqual({ status: "error" });
  });
});
