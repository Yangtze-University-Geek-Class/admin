import { resolveRepos } from "../../scripts/forge.mjs";
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyPlan, buildPlan, describeEntry, formatResults, indexImported, main, matchGitlabUser, redactPersonalText, redactSecrets, rewriteRefs, syncReason,
} from "../../scripts/github-import.mjs";

const OWNER = "Yangtze-University-Geek-Class";
const REPO = "admin";
const GH_URL = (n: number) => `https://github.com/${OWNER}/${REPO}/issues/${n}`;
const GL_WEB = (iid: number) => `https://example.test/gitlab/geek/admin/-/issues/${iid}`;
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

type Call = { method: string; path: string; sudo?: string | null; body?: unknown };

/** 虚构的 GitHub：只按路径响应，记录每一次写请求；评论与关闭会改变它的状态 */
function fakeGitHub(input: { issues?: unknown[]; pulls?: Record<number, unknown>; files?: Record<number, string[]>; comments?: Record<number, { body: string }[]>; failPatch?: number[] } = {}) {
  const state = { issues: [...(input.issues ?? [])] as { number: number; state: string }[], comments: structuredClone(input.comments ?? {}) as Record<number, { body: string }[]>, calls: [] as Call[] };
  const pathOf = (path: string) => new URL(path, "https://api.github.invalid").pathname;
  return {
    state,
    async list(path: string) {
      const p = pathOf(path);
      if (p === `/repos/${OWNER}/${REPO}/issues`) return state.issues.filter(issue => issue.state === "open");
      const files = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/files$/.exec(p);
      if (files) return (input.files?.[Number(files[1])] ?? []).map(filename => ({ filename }));
      const comments = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(p);
      if (comments) return state.comments[Number(comments[1])] ?? [];
      throw new Error(`fake GitHub 没有这个列表：${p}`);
    },
    async request(method: string, path: string, body?: { body?: string; state?: string }) {
      const p = pathOf(path);
      state.calls.push({ method, path: p, body });
      const pull = /^\/repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/.exec(p);
      if (method === "GET" && pull) return input.pulls?.[Number(pull[1])] ?? null;
      const comment = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(p);
      if (method === "POST" && comment) {
        const n = Number(comment[1]);
        state.comments[n] = [...(state.comments[n] ?? []), { body: body?.body ?? "" }];
        return { id: 1 };
      }
      const issue = /^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(p);
      if (method === "PATCH" && issue) {
        const n = Number(issue[1]);
        if (input.failPatch?.includes(n)) throw new Error(`gh api PATCH 失败：HTTP 500`);
        state.issues = state.issues.map(item => (item.number === n ? { ...item, state: "closed" } : item));
        return { number: n, state: "closed" };
      }
      throw new Error(`fake GitHub 不认识：${method} ${p}`);
    },
  };
}

/** 虚构的 GitLab：用户表、标签表与议题表；POST 建单按 createStatus 返回，记录 Sudo 头 */
function fakeGitLab(input: { users?: Record<string, unknown[]>; labels?: string[]; issues?: unknown[]; createStatus?: number; usersStatus?: number; throwOnTitle?: string; dropCreatedAt?: boolean; failNoteWith?: string } = {}) {
  const state = { issues: [...(input.issues ?? [])] as { iid: number; description: string; web_url: string }[], calls: [] as Call[], nextIid: 500, notes: {} as Record<number, { body: string }[]>, failNoteWith: input.failNoteWith ?? null as string | null };
  return {
    state,
    async list(path: string) {
      const p = new URL(path, "https://git.invalid").pathname;
      if (p === "/issues") return state.issues;
      if (p === "/labels") return (input.labels ?? []).map(name => ({ name }));
      const notes = /^\/issues\/(\d+)\/notes$/.exec(p);
      if (notes) return state.notes[Number(notes[1])] ?? [];
      throw new Error(`fake GitLab 没有这个列表：${p}`);
    },
    async request(method: string, path: string, options: { sudo?: string; body?: { title: string; description: string; labels?: string } } = {}) {
      const p = new URL(path, "https://git.invalid").pathname;
      state.calls.push({ method, path: p, sudo: options.sudo ?? null, body: options.body });
      if (method === "GET" && p === "/users") {
        if (input.usersStatus) return { status: input.usersStatus, body: { message: "boom" } };
        const username = new URL(path, "https://git.invalid").searchParams.get("username") ?? "";
        return { status: 200, body: input.users?.[username] ?? [] };
      }
      if (method === "POST" && p === "/issues") {
        if (input.createStatus && input.createStatus !== 201) return { status: input.createStatus, body: { message: "rejected" } };
        if (input.throwOnTitle && options.body?.title === input.throwOnTitle) throw new Error("socket hang up");
        const iid = state.nextIid++;
        const createdAt = input.dropCreatedAt ? new Date().toISOString() : (options.body as { created_at?: string } | undefined)?.created_at;
        const issue = { iid, description: options.body?.description ?? "", web_url: GL_WEB(iid) };
        state.issues.push(issue);
        return { status: 201, body: { iid, web_url: issue.web_url, created_at: createdAt } };
      }
      const note = /^\/issues\/(\d+)\/notes$/.exec(p);
      if (method === "POST" && note) {
        const text = (options.body as { body?: string } | undefined)?.body ?? "";
        if (state.failNoteWith && text.includes(state.failNoteWith)) return { status: 500, body: { message: "boom" } };
        const iid = Number(note[1]);
        state.notes[iid] = [...(state.notes[iid] ?? []), { body: text }];
        return { status: 201, body: { id: 1 } };
      }
      throw new Error(`fake GitLab 不认识：${method} ${p}`);
    },
  };
}

const issue = (number: number, extra: Record<string, unknown> = {}) => ({
  number, title: `问题 ${number}`, html_url: GH_URL(number), state: "open", user: { login: "Doulor", type: "User" },
  labels: [{ name: "bug" }, { name: "P2" }], body: `见 #12 与 \`#99\`\n\n\`\`\`\n#5\n\`\`\``, created_at: "2026-10-01T08:00:00Z", ...extra,
});

describe("导入：首次导入、重复执行、作者对不上、GitLab 4xx", () => {
  it("首次导入：按 GitHub 原作者建单（Sudo），正文带原链接与改写后的引用，之后在 GitHub 留回链并关闭", async () => {
    const github = fakeGitHub({ issues: [issue(267)] });
    const gitlab = fakeGitLab({ users: { Doulor: [{ username: "doulor", state: "active", id: 56 }] }, labels: ["bug"] });
    const plan = await buildPlan({ github, gitlab, owner: OWNER, repo: REPO });
    expect(plan.entries[0]).toMatchObject({ number: 267, action: "create", labels: ["bug"], skippedLabels: ["P2"], author: { login: "Doulor", gitlab: { username: "doulor" } } });
    const results = await applyPlan(plan, { github, gitlab, owner: OWNER, repo: REPO });
    expect(results).toEqual([{ number: 267, status: "created", gitlabIid: 500, gitlabWebUrl: GL_WEB(500), timeKept: true }]);
    const post = gitlab.state.calls.find(call => call.method === "POST")!;
    expect(post.sudo).toBe("doulor");
    expect(post.body).toMatchObject({ created_at: "2026-10-01T08:00:00Z" });
    expect(post.body?.description).toContain(`迁自 GitHub：${GH_URL(267)}`);
    expect(post.body?.description).toContain("已按原作者建单（GitLab 用户 `doulor`）");
    expect(post.body?.description).toContain(`见 [#12](${GH_URL(12)}) 与 \`#99\``);
    expect(post.body?.description).toContain("```\n#5\n```");
  expect(post.body?.description.endsWith(`来源：${GH_URL(267)}`)).toBe(true);
    expect(post.body?.labels).toBe("bug");
    expect(github.state.comments[267]).toEqual([{ body: expect.stringContaining(GL_WEB(500)) }]);
    expect(github.state.issues.find(item => item.number === 267)?.state).toBe("closed");
  });

  it("重复执行不重复建单：GitHub 关闭失败的那次，重跑按链接找到已建的 GitLab 议题，只补关闭", async () => {
    const first = fakeGitHub({ issues: [issue(267)], failPatch: [267] });
    const gitlab = fakeGitLab({ users: { Doulor: [{ username: "doulor", state: "active", id: 56 }] }, labels: ["bug"] });
    const firstResults = await applyPlan(await buildPlan({ github: first, gitlab, owner: OWNER, repo: REPO }), { github: first, gitlab, owner: OWNER, repo: REPO });
    expect(firstResults[0]).toMatchObject({ status: "failed", step: "github-close", gitlabIid: 500 });
    // 第二次运行：GitHub 条目仍开着，回链评论已经在；GitLab 那张单已存在
    const second = fakeGitHub({ issues: [issue(267)], comments: first.state.comments });
    const plan = await buildPlan({ github: second, gitlab, owner: OWNER, repo: REPO });
    expect(plan.entries[0]).toMatchObject({ action: "linked", gitlabIid: 500 });
    const results = await applyPlan(plan, { github: second, gitlab, owner: OWNER, repo: REPO });
    expect(results).toEqual([{ number: 267, status: "linked", gitlabIid: 500, gitlabWebUrl: GL_WEB(500) }]);
    expect(gitlab.state.calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(second.state.comments[267]).toHaveLength(1);
    expect(second.state.calls.some(call => call.method === "POST")).toBe(false);
    expect(second.state.issues.find(item => item.number === 267)?.state).toBe("closed");
  });

  it("作者对不上：不加 Sudo，正文写明原作者与原链接（GitLab 上没有同名账号）", async () => {
    const github = fakeGitHub({ issues: [issue(268, { user: { login: "some_outsider", type: "User" } })] });
    const gitlab = fakeGitLab({ users: { some_outsider: [] }, labels: ["bug"] });
    const plan = await buildPlan({ github, gitlab, owner: OWNER, repo: REPO });
    expect(plan.entries[0].author.gitlab).toBeNull();
    await applyPlan(plan, { github, gitlab, owner: OWNER, repo: REPO });
    const post = gitlab.state.calls.find(call => call.method === "POST")!;
    expect(post.sudo).toBeNull();
    expect(post.body?.description).toContain("GitHub 原作者：`some_outsider`，GitLab 上没有同名账号");
    expect(post.body?.description).toContain(`迁自 GitHub：${GH_URL(268)}`);
  });

  it("每条独立：一条建单时网络抛错只标它失败，其余条目照常导入，失败的 GitHub 条目不动", async () => {
  const github = fakeGitHub({ issues: [issue(271, { title: "会抛错" }), issue(272, { title: "正常" })] });
  const gitlab = fakeGitLab({ labels: ["bug"], throwOnTitle: "会抛错" });
  const plan = await buildPlan({ github, gitlab, owner: OWNER, repo: REPO });
  const results = await applyPlan(plan, { github, gitlab, owner: OWNER, repo: REPO });
  expect(results).toEqual([
    { number: 271, status: "failed", step: "unexpected", error: "socket hang up" },
    { number: 272, status: "created", gitlabIid: 500, gitlabWebUrl: GL_WEB(500), timeKept: true },
  ]);
  expect(github.state.issues.find(item => item.number === 271)?.state).toBe("open");
  expect(github.state.issues.find(item => item.number === 272)?.state).toBe("closed");
});
it("时间没保留时结果里标出来，竞赛窗口不会悄悄按导入时间计", async () => {
  const github = fakeGitHub({ issues: [issue(273)] });
  const gitlab = fakeGitLab({ labels: ["bug"], dropCreatedAt: true });
  const plan = await buildPlan({ github, gitlab, owner: OWNER, repo: REPO });
  const results = await applyPlan(plan, { github, gitlab, owner: OWNER, repo: REPO });
  expect(results[0]).toMatchObject({ number: 273, status: "created", timeKept: false });
  expect(formatResults(results)).toContain("创建时间没有保留");
});
it("作者查询失败（非 200）：这一条报错跳过、不建单，不按无同名账号处理，GitHub 不动", async () => {
  const github = fakeGitHub({ issues: [issue(270)] });
  const gitlab = fakeGitLab({ labels: ["bug"], usersStatus: 500 });
  const plan = await buildPlan({ github, gitlab, owner: OWNER, repo: REPO });
  expect(plan.entries[0]).toMatchObject({ number: 270, action: "error" });
  expect(describeEntry(plan.entries[0])).toContain("出错，跳过，不建单");
  const results = await applyPlan(plan, { github, gitlab, owner: OWNER, repo: REPO });
  expect(results).toEqual([{ number: 270, status: "failed", step: "plan", error: expect.stringContaining("HTTP 500") }]);
  expect(gitlab.state.calls.some(call => call.method === "POST")).toBe(false);
  expect(github.state.issues.find(item => item.number === 270)?.state).toBe("open");
});
it("GitLab 返回 4xx：不碰 GitHub 条目，不留回链、不关闭，结果写明失败步骤", async () => {
    const github = fakeGitHub({ issues: [issue(269)] });
    const gitlab = fakeGitLab({ users: { Doulor: [{ username: "doulor", state: "active", id: 56 }] }, createStatus: 422 });
    const results = await applyPlan(await buildPlan({ github, gitlab, owner: OWNER, repo: REPO }), { github, gitlab, owner: OWNER, repo: REPO });
    expect(results).toEqual([{ number: 269, status: "failed", step: "gitlab-create", error: "GitLab HTTP 422" }]);
    expect(github.state.calls).toEqual([]);
    expect(github.state.issues.find(item => item.number === 269)?.state).toBe("open");
  });
});

describe("导进 GitLab 的文字先脱敏", () => {
  it("引用、邮箱与家目录路径不进 GitLab 议题与计划输出；脱敏幂等", async () => {
    const quoted = issue(271, { title: "讨论「示例指令」", body: `> 示例引用\n\n联系 someone@example.com，路径 ${"/Users"}/example/work/a.md\n\n「另一段示例」` });
    const github = fakeGitHub({ issues: [quoted] });
    const gitlab = fakeGitLab({ labels: ["bug"] });
    const plan = await buildPlan({ github, gitlab, owner: OWNER, repo: REPO });
    expect(describeEntry(plan.entries[0])).not.toContain("示例指令");
    await applyPlan(plan, { github, gitlab, owner: OWNER, repo: REPO });
    const post = gitlab.state.calls.find(call => call.method === "POST")!;
    expect(post.body?.title).toBe("讨论「[已脱敏]」");
    expect(post.body?.description).not.toMatch(/示例引用|示例指令|另一段示例|someone@example\.com|\/Users\/example/);
    expect(post.body?.description).toContain("> 「[已脱敏]」");
    expect(post.body?.description).toContain("路径 [已脱敏]/work/a.md");
    expect(redactPersonalText("a「x」b")).toBe("a「[已脱敏]」b");
    const sample = `> 引用\n「甲」 x${"@"}y.cn`;
    expect(redactPersonalText(redactPersonalText(sample))).toBe(redactPersonalText(sample));
    // @用户名去掉 @；代码块原样保留；ASCII 与弯引号都换成占位
    const mixed = redactPersonalText("请 @someone 看 \"示例\" 与 “示例二”\n\n```\n@keep \"代码\" 「代码」\n```");
    expect(mixed).toBe("请 someone 看 「[已脱敏]」 与 「[已脱敏]」\n\n```\n@keep \"代码\" 「代码」\n```");
  });
});

describe("评论迁移与标签", () => {
  it("评论一并迁到 GitLab：带原链接与原评论人，正文脱敏；标签对不上的在计划里列出", async () => {
    const github = fakeGitHub({ issues: [issue(274)], comments: { 274: [{ id: 1, html_url: `${GH_URL(274)}#issuecomment-1`, user: { login: "Doulor" }, created_at: "2026-10-02T09:00:00Z", body: "同意 @reviewer，「示例指令」" }] } });
    const gitlab = fakeGitLab({ labels: ["bug"] });
    const plan = await buildPlan({ github, gitlab, owner: OWNER, repo: REPO });
    expect(describeEntry(plan.entries[0])).toContain("标签未对上，未带过去：P2");
    await applyPlan(plan, { github, gitlab, owner: OWNER, repo: REPO });
    const notes = gitlab.state.notes[500];
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain(`迁自 GitHub 评论：${GH_URL(274)}#issuecomment-1`);
    expect(notes[0].body).toContain("GitHub 原评论人：`Doulor`");
    expect(notes[0].body).not.toContain("@reviewer");
    expect(notes[0].body).not.toContain("示例指令");
  });
  it("评论迁移中途失败：这一条标为失败且 GitHub 不关；重跑只补缺的那条，不重复", async () => {
    const comment = (n: number, body: string) => ({ id: n, html_url: `${GH_URL(275)}#issuecomment-${n}`, user: { login: "Doulor" }, created_at: "2026-10-02T09:00:00Z", body });
    const github = fakeGitHub({ issues: [issue(275)], comments: { 275: [comment(1, "第一条"), comment(2, "第二条")] } });
    const gitlab = fakeGitLab({ labels: ["bug"], failNoteWith: "第二条" });
    const first = await applyPlan(await buildPlan({ github, gitlab, owner: OWNER, repo: REPO }), { github, gitlab, owner: OWNER, repo: REPO });
    expect(first[0]).toMatchObject({ number: 275, status: "failed", step: "gitlab-note", gitlabIid: 500 });
    expect(github.state.issues.find(item => item.number === 275)?.state).toBe("open");
    expect(gitlab.state.notes[500]).toHaveLength(1);
    gitlab.state.failNoteWith = null;
    const second = await applyPlan(await buildPlan({ github, gitlab, owner: OWNER, repo: REPO }), { github, gitlab, owner: OWNER, repo: REPO });
    expect(second[0]).toMatchObject({ number: 275, status: "linked" });
    expect(gitlab.state.notes[500]).toHaveLength(2);
    expect(github.state.issues.find(item => item.number === 275)?.state).toBe("closed");
  });
});

describe("计划只读与跳过", () => {
  it("同步工单（hot-fix）与同步 PR（分支 hotfix_stage_sync 或 github_*）跳过；计划阶段不发任何写请求", async () => {
    const github = fakeGitHub({
      issues: [
        issue(306, { labels: [{ name: "hot-fix" }] }),
        issue(307, { pull_request: { url: "x" } }),
        issue(308, { pull_request: { url: "x" } }),
        issue(310, { pull_request: { url: "x" } }),
      ],
      pulls: {
        307: { head: { ref: "task/307/hotfix_stage_sync" }, additions: 1, deletions: 0, changed_files: 1 },
        308: { head: { ref: "task/308/github_mirror_sync" }, additions: 1, deletions: 0, changed_files: 1 },
        310: { head: { ref: "task/310/fix_thing" }, additions: 3, deletions: 1, changed_files: 2 },
      },
      files: { 310: ["app/web/a.ts", "app/web/b.ts"] },
    });
    const gitlab = fakeGitLab({ users: {}, labels: ["bug"] });
    const plan = await buildPlan({ github, gitlab, owner: OWNER, repo: REPO });
    expect(plan.entries.map(entry => entry.action)).toEqual(["skip", "skip", "skip", "create"]);
    expect(plan.entries[0].reason).toContain("hot-fix");
    expect(plan.entries[1].reason).toContain("hotfix_stage_sync");
    expect(plan.entries[2].reason).toContain("github_mirror_sync");
    expect(plan.entries[3].pr).toMatchObject({ ref: "task/310/fix_thing", additions: 3, deletions: 1, changedFiles: 2, files: ["app/web/a.ts", "app/web/b.ts"] });
    expect(github.state.calls.filter(call => call.method !== "GET")).toEqual([]);
    expect(gitlab.state.calls.filter(call => call.method !== "GET")).toEqual([]);
    expect(describeEntry(plan.entries[0])).toContain("跳过");
  });

  it("同步规则只看标签与分支：普通 task 分支与别的标签不跳过", () => {
    expect(syncReason({ labels: ["bug"], headRef: "task/12/fix_thing" })).toBeNull();
    expect(syncReason({ labels: [], headRef: "task/12/github_sync" })).toContain("github_sync");
    expect(syncReason({ labels: [], headRef: "task/12/hotfix_sync_stage_ab12" })).toBeNull();
    expect(syncReason({ labels: ["hot-fix"] })).toContain("hot-fix");
  });
});

describe("去重与作者对应的纯函数", () => {
  it("已导入的按完整链接判断：#282 不会误中 #28；同一链接对应两张单就拒绝", () => {
    const index = indexImported([
      { iid: 1, description: `迁自 GitHub：${GH_URL(282)}\n正文` },
      { iid: 2, description: "没有去重行的议题" },
    ]);
    expect(index.get(GH_URL(282))).toMatchObject({ iid: 1 });
    expect(index.has(GH_URL(28))).toBe(false);
    expect(() => indexImported([{ iid: 1, description: `迁自 GitHub：${GH_URL(9)}` }, { iid: 2, description: `迁自 GitHub：${GH_URL(9)}` }])).toThrow("同一 GitHub 链接对应多张");
    // 标记只认第一行：正文里别处出现的同样一行不算已导入
    expect(indexImported([{ iid: 3, description: `说明\n迁自 GitHub：${GH_URL(8)}` }]).size).toBe(0);
  });

  it("GitLab 用户精确对上：不区分大小写，但必须 active", () => {
    expect(matchGitlabUser("Doulor", [{ username: "doulor", state: "active" }])).toMatchObject({ username: "doulor" });
    expect(matchGitlabUser("Doulor", [{ username: "doulor2", state: "active" }])).toBeNull();
    expect(matchGitlabUser("Doulor", [{ username: "doulor", state: "blocked" }])).toBeNull();
  });

  it("裸 #编号改成 GitHub 链接；代码块、行内代码、URL 与 HTML 实体原样保留", () => {
    const text = "见 #12，链接 https://github.com/a/b/issues/3#x 与 #4中文\n`#5` ```\n#6\n``` &#123; 数字 1#2";
    expect(rewriteRefs(text, { owner: "O", repo: "R" })).toBe(
      "见 [#12](https://github.com/O/R/issues/12)，链接 https://github.com/a/b/issues/3#x 与 [#4](https://github.com/O/R/issues/4)中文\n`#5` ```\n#6\n``` &#123; 数字 1#2",
    );
  });

  it("输出脱敏：令牌与常见凭据形状都换成 [redacted]", () => {
    expect(redactSecrets("token TEST-SECRET-VALUE 出现", ["TEST-SECRET-VALUE"])).toBe("token [redacted] 出现");
    // 令牌形态拼出来写，免得测试文件自己被隐私门禁命中
    expect(redactSecrets(`${"glpat"}-abcdefghijklmnop12 与 ${"ghp"}_abcdefghijklmnopqrstuv`)).toBe("[redacted] 与 [redacted]");
  });
});

describe("命令行与仓库解析", () => {
  it("从 origin 与 gitlab 两个 remote 推出仓库；环境变量可覆盖", () => {
    const root = mkdtempSync(join(tmpdir(), "github-import-"));
    temporary.push(root);
    execFileSync("git", ["-C", root, "init", "-q"]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", `git@github.com:${OWNER}/${REPO}.git`]);
    execFileSync("git", ["-C", root, "remote", "add", "gitlab", "https://example.test/gitlab/geek/admin.git"]);
    expect(resolveRepos(root, {})).toEqual({ owner: OWNER, repo: REPO, base: "https://example.test/gitlab", project: "geek/admin" });
    expect(resolveRepos(root, { GEEK_GITHUB_REPO: "someone/other", GEEK_GITLAB_PROJECT: "geek/other" })).toMatchObject({ owner: "someone", repo: "other", project: "geek/other" });
  });

  it("默认演算不写；--apply 才写；未知参数退出码 2；输出不含令牌", async () => {
    const root = mkdtempSync(join(tmpdir(), "github-import-cli-"));
    temporary.push(root);
    execFileSync("git", ["-C", root, "init", "-q"]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", `git@github.com:${OWNER}/${REPO}.git`]);
    execFileSync("git", ["-C", root, "remote", "add", "gitlab", "https://example.test/gitlab/geek/admin.git"]);
    const env = { GITLAB_TOKEN: "TEST-TOKEN-NOT-REAL-0001" };
    const lines: string[] = [];
    const out = (text: string) => { lines.push(text); };
    const github = fakeGitHub({ issues: [issue(267)] });
    const gitlab = fakeGitLab({ users: { Doulor: [{ username: "doulor", state: "active", id: 56 }] }, labels: ["bug"] });

    expect(await main([], { root, env, github, gitlab, out, err: out, readToken: () => null })).toBe(0);
    expect(lines.join("\n")).toContain("演算，未写任何东西");
    expect(lines.join("\n")).toContain("作者 `Doulor` → GitLab `doulor`（按原作者建单）");
    expect(lines.join("\n")).not.toContain("TEST-TOKEN-NOT-REAL-0001");
    expect(gitlab.state.calls.filter(call => call.method !== "GET")).toEqual([]);
    expect(github.state.calls.filter(call => call.method !== "GET")).toEqual([]);

    expect(await main(["--apply"], { root, env, github, gitlab, out, err: out, readToken: () => null })).toBe(0);
    expect(gitlab.state.calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(github.state.issues.find(item => item.number === 267)?.state).toBe("closed");
    expect(lines.join("\n")).toContain("已导入 → GitLab #500");

    expect(await main(["--dry-run"], { root, env, github, gitlab, out, err: out, readToken: () => null })).toBe(2);
    expect(await main([], { root, env: {}, github, gitlab, out, err: out, readToken: () => null })).toBe(2);
  });
});
