import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { collectChains } from "../../scripts/note.mjs";
import { createForge, gitlabIssueState, gitlabReviewState, gitlabToken, normalizeGitLabIssue, parseRemoteUrl, pickReview, selectForge } from "../../scripts/forge.mjs";
import { checkLifecycle, decideCleanup, isSyncBranch, isSyncWorktree, issueOfBranch, parseWorktrees, slugForForge, startGate, taskBranch, worktreePath } from "../../scripts/task.mjs";

const execFileAsync = promisify(execFile);
/** 测试里要屏蔽的代码托管环境变量：开发机上导出的值不能改变测试结果 */
const FORGE_ENV_KEYS = ["GEEK_FORGE", "GEEK_GITLAB_URL", "GEEK_GITLAB_PROJECT", "GITLAB_TOKEN"];
const cleanEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([key]) => !FORGE_ENV_KEYS.includes(key)));
/** 临时仓库要带上的脚本：task.mjs 与 pre-push 需要的，以及 forge.mjs 等它们 import 的 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPTS = ["task.mjs", "forge.mjs", "issue-labels.mjs", "note.mjs", "check-privacy.mjs", "check-branch-invariants.mjs", "owner-approval.mjs", "hotfix-windows.mjs", "promotion-windows.mjs", "release-policy.mjs", "deployment-environment.mjs"];

describe("task worktree", () => {
  it("分支名与 worktree 路径：一个 issue 一个", () => {
    expect(taskBranch(35, "task_worktree")).toBe("task/35/task_worktree");
    expect(() => taskBranch(35, "task-worktree")).toThrow(/不用 -/);
    expect(() => taskBranch("abc", "x")).toThrow(/数字/);
    expect(() => taskBranch(35, "hotfix_sync_main")).toThrow(/hotfix_sync_/);
    expect(taskBranch(35, "hotfix_sync")).toBe("task/35/hotfix_sync");
    expect(worktreePath("/repo", 35)).toBe("/repo/.claude/worktrees/task-35");
    expect(issueOfBranch("task/35/task_worktree")).toBe(35);
    expect(issueOfBranch("dev/alice")).toBeNull();
  });

  it("GitHub 一侧的 slug 必须以 github_ 开头，GitLab 一侧不限：两边同号的执行记录链路不混在一起（#330）", () => {
    expect(slugForForge("github", "github_mirror_sync")).toBe("github_mirror_sync");
    expect(() => slugForForge("github", "mirror_sync")).toThrow(/github_/);
    expect(() => slugForForge("github", "githubx_sync")).toThrow(/github_/);
    expect(slugForForge("gitlab", "mirror_sync")).toBe("mirror_sync");
    expect(taskBranch(330, slugForForge("github", "github_mirror_sync"))).toBe("task/330/github_mirror_sync");
  });

  it("hotfix-sync 的临时合并分支不算 task worktree：它推 stage 时窗口 issue 可能已关，不能被生命周期检查拦住", () => {
    expect(isSyncBranch("task/308/hotfix_sync_stage_ab12cd")).toBe(true);
    expect(isSyncBranch("task/308/hotfix_sync_main_ab12cd")).toBe(true);
    expect(isSyncBranch("task/308/stage_sync")).toBe(false);
    expect(isSyncBranch("task/308/hotfix_synced_notes")).toBe(false);
    // 豁免要看 worktree 在不在 hotfix-sync 的临时目录里：手工起的同名分支放在 .claude/worktrees 下，照样要 finish。
    expect(isSyncWorktree({ branch: "task/308/hotfix_sync_stage_ab12cd", path: "/tmp/hotfix-sync-AB12cd/stage" })).toBe(true);
    expect(isSyncWorktree({ branch: "task/308/hotfix_sync_stage_ab12cd", path: "/repo/.claude/worktrees/task-308" })).toBe(false);
    expect(isSyncWorktree({ branch: "task/308/hotfix_sync_notes_ab12cd", path: "/tmp/hotfix-sync-ab12cd/notes" })).toBe(false);
  });

  it("解析 git worktree list --porcelain，含 detached 与主工作区", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD 882435e",
      "branch refs/heads/dev/alice",
      "",
      "worktree /repo/.claude/worktrees/task-35",
      "HEAD 77160aa",
      "branch refs/heads/task/35/task_worktree",
      "",
      "worktree /repo/.claude/worktrees/preview",
      "HEAD b979f9c",
      "detached",
      "",
    ].join("\n");
    const list = parseWorktrees(porcelain);
    expect(list.map((wt: { branch: string | null }) => wt.branch)).toEqual(["dev/alice", "task/35/task_worktree", null]);
    expect(list[2].detached).toBe(true);
  });

  it("能不能清理：只有 PR 已合并或 issue 已放弃、且工作区干净时才清", () => {
    expect(decideCleanup({ dirty: false, issueState: "CLOSED", prState: "MERGED" }).ok).toBe(true);
    expect(decideCleanup({ dirty: false, issueState: "OPEN", prState: "MERGED" }).ok).toBe(true); // 合并了但 issue 没关：清 worktree，issue 交给巡检
    expect(decideCleanup({ dirty: true, issueState: "CLOSED", prState: "MERGED" })).toMatchObject({ ok: false, reason: expect.stringContaining("未提交") });
    expect(decideCleanup({ dirty: false, issueState: "OPEN", prState: "OPEN" }).ok).toBe(false);
    expect(decideCleanup({ dirty: false, issueState: "OPEN", prState: null }).ok).toBe(false);
    expect(decideCleanup({ dirty: false, issueState: "CLOSED", prState: null })).toMatchObject({ ok: true, reason: expect.stringContaining("放弃") });
    expect(decideCleanup({ dirty: false, issueState: "OPEN", prState: "CLOSED" }).ok).toBe(false);
    expect(decideCleanup({ dirty: false, issueState: null, prState: null }).ok).toBe(false); // 查不到就不删
  });
});

describe("推送前检查：该清理的 worktree（list --check 与 pre-push）", () => {
  it("判断：PR 已合并或 issue 已放弃就算该清；查不到 PR 不下结论", () => {
    expect(checkLifecycle({ dirty: false, issueState: "OPEN", prState: "MERGED", prKnown: true })).toMatchObject({ status: "stale", reason: expect.stringContaining("还没 finish") });
    expect(checkLifecycle({ dirty: true, issueState: "CLOSED", prState: "MERGED", prKnown: true })).toMatchObject({ status: "stale", reason: expect.stringContaining("不要替别人丢弃") });
    expect(checkLifecycle({ dirty: false, issueState: "CLOSED", prState: null, prKnown: true }).status).toBe("stale");
    expect(checkLifecycle({ dirty: false, issueState: "CLOSED", prState: "OPEN", prKnown: true }).status).toBe("ok"); // PR 还开着，先看 PR
    expect(checkLifecycle({ dirty: false, issueState: "OPEN", prState: "OPEN", prKnown: true }).status).toBe("ok");
    expect(checkLifecycle({ dirty: false, issueState: "OPEN", prState: null, prKnown: true }).status).toBe("ok");
    expect(checkLifecycle({ dirty: false, issueState: "CLOSED", prState: null, prKnown: false }).status).toBe("unknown");
    expect(checkLifecycle({ dirty: false, issueState: null, prState: "OPEN", prKnown: true }).status).toBe("unknown");
  });

  // 临时仓库：带上 task.mjs 与 pre-push 需要的脚本，建一个 PR 已合并没 finish 的 worktree 和一个还在做的 worktree；
  // gh 换成假的，只回答 task.mjs 会问的两种查询。
  const FAKE_GH = [
    `#!${process.execPath}`,
    "// 假 gh：issue view <n> 回 FAKE_GH_ISSUE_<n>（默认 OPEN）；pr list --head task/<n>/… 回 FAKE_GH_PR_<n>（「状态 编号」，没设就是没有 PR）",
    "const args = process.argv.slice(2);",
    "if (process.env.FAKE_GH_OFFLINE) process.exit(1);",
    "// FAKE_GH_FLAKY=<目录>：同一个查询第一次失败、第二次才成功（并发时偶发的接口错误）",
    'if (process.env.FAKE_GH_FLAKY) { const fs = require("node:fs"); const mark = `${process.env.FAKE_GH_FLAKY}/${args.join("_").replace(/[^A-Za-z0-9]/g, "_")}`; if (!fs.existsSync(mark)) { fs.writeFileSync(mark, ""); process.exit(1); } }',
    'if (args[0] === "issue" && args[1] === "view") console.log(process.env[`FAKE_GH_ISSUE_${args[2]}`] ?? "OPEN");',
    'else if (args[0] === "pr" && args[1] === "list") console.log(process.env[`FAKE_GH_PR_${args[args.indexOf("--head") + 1].split("/")[1]}`] ?? " ");',
    "else process.exit(1);",
    "",
  ].join("\n");
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function git(cwd: string, args: string[]) {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }

  function fixture() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "geek-task-check-")));
    dirs.push(root);
    git(root, ["init", "-q", "-b", "stage"]);
    git(root, ["config", "user.email", "ci@example.test"]);
    git(root, ["config", "user.name", "CI"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    mkdirSync(join(root, "scripts"));
    for (const file of SCRIPTS) copyFileSync(join(repoRoot, "scripts", file), join(root, "scripts", file));
    mkdirSync(join(root, ".githooks"));
    copyFileSync(join(repoRoot, ".githooks/pre-push"), join(root, ".githooks/pre-push"));
    writeFileSync(join(root, ".gitignore"), ".claude/\n");
    writeFileSync(join(root, "package.json"), '{ "version": "0.1.0" }\n');
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "base"]);
    git(root, ["worktree", "add", "-q", "-b", "task/7/done", ".claude/worktrees/task-7"]);
    git(root, ["worktree", "add", "-q", "-b", "task/8/wip", ".claude/worktrees/task-8"]);
    const bin = join(root, ".claude/fake-bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), FAKE_GH);
    chmodSync(join(bin, "gh"), 0o755);
    return { root, bin };
  }

  const env = (bin: string, gh: Record<string, string>) => ({ ...cleanEnv(), PATH: `${bin}:${process.env.PATH}`, NODE: process.execPath, ...gh });

  function listCheck(root: string, bin: string, gh: Record<string, string>) {
    return spawnSync(process.execPath, [join(root, "scripts/task.mjs"), "list", "--check"], { cwd: root, encoding: "utf8", env: env(bin, gh) });
  }

  /** 在 task-8 的 worktree 里推 task/8/wip：git 交给 pre-push 的就是这一行 */
  function prePush(root: string, bin: string, gh: Record<string, string>) {
    const wt = join(root, ".claude/worktrees/task-8");
    const sha = git(wt, ["rev-parse", "HEAD"]);
    return spawnSync("sh", [join(wt, ".githooks/pre-push"), "origin", "git@example.test:org/repo.git"], {
      cwd: wt, encoding: "utf8", env: env(bin, gh),
      input: `refs/heads/task/8/wip ${sha} refs/heads/task/8/wip ${"0".repeat(40)}\n`,
    });
  }

  const MERGED = { FAKE_GH_PR_7: "MERGED 12", FAKE_GH_ISSUE_7: "CLOSED", FAKE_GH_PR_8: "OPEN 13" };
  const WORKING = { FAKE_GH_PR_7: "OPEN 12", FAKE_GH_PR_8: "OPEN 13" };

  it("list --check：PR 已合并、没 finish 的 worktree 让它以 1 退出，并给出清理命令", () => {
    const { root, bin } = fixture();
    const result = listCheck(root, bin, MERGED);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("#7 task/7/done（PR #12 MERGED，issue CLOSED）：PR 已合并，还没 finish");
    expect(result.stderr).toContain("node scripts/task.mjs finish <issue>");
    expect(result.stderr).not.toContain("#8 ");

    const working = listCheck(root, bin, WORKING);
    expect(working.status).toBe(0);
    expect(working.stdout).toContain("2 个还在做");
  });

  it("list --check：issue 关了、没有 PR（放弃）也算该清；查不到 GitHub 只警告、以 0 退出", () => {
    const { root, bin } = fixture();
    const abandoned = listCheck(root, bin, { FAKE_GH_ISSUE_7: "CLOSED", FAKE_GH_PR_8: "OPEN 13" });
    expect(abandoned.status).toBe(1);
    expect(abandoned.stderr).toContain("issue 已关闭，没有 PR（放弃），还没 finish");

    const offline = listCheck(root, bin, { FAKE_GH_OFFLINE: "1" });
    expect(offline.status).toBe(0);
    expect(offline.stderr).toContain("查不到 PR 的状态");
    expect(offline.stdout).toContain("2 个查不到状态（只警告）");
  });

  it("gh 偶发失败一次会重试：该拦的照样拦，不被当成查不到", () => {
    const { root, bin } = fixture();
    const flaky = join(root, ".claude/flaky");
    mkdirSync(flaky);
    const result = listCheck(root, bin, { ...MERGED, FAKE_GH_FLAKY: flaky });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("#7 task/7/done");
    expect(result.stderr).not.toContain("查不到");
  });

  it("主工作区停在已合并的 task 分支上：提示切回自己的分支，不提示 finish", () => {
    const { root, bin } = fixture();
    git(root, ["checkout", "-q", "-b", "task/9/main_here"]);
    const result = listCheck(root, bin, { ...WORKING, FAKE_GH_PR_9: "MERGED 20" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`主工作区停在 task/9/main_here 上，finish 只删 .claude/worktrees 下的 worktree，这里要自己切走：git -C ${root} switch dev/<你的 GitHub 用户名>（或 stage）`);
    expect(result.stderr).not.toContain("task.mjs finish <issue>");
  });

  it("pre-push：本机有已合并没 finish 的 worktree 就拒绝推送；清理干净后放行", () => {
    const { root, bin } = fixture();
    const rejected = prePush(root, bin, MERGED);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("#7 task/7/done");
    expect(rejected.stderr).toContain("pre-push: 本机有该清理的 task worktree，推送已被本地钩子拒绝");

    expect(prePush(root, bin, WORKING).status).toBe(0);
    git(root, ["worktree", "remove", ".claude/worktrees/task-7"]);
    expect(prePush(root, bin, MERGED).status).toBe(0);
    expect(prePush(root, bin, { FAKE_GH_OFFLINE: "1" }).status).toBe(0);
  });
});

describe("task.mjs start 的提单检查", () => {
  it("没有「组:类」标签、ui 缺截图、带 needs-evidence 的 issue 不能开工；detail 为空拒绝", async () => {
    const { startGate } = await import("../../scripts/task.mjs");
    expect(startGate({ number: 300, labels: [{ name: "portal" }], body: "x" }).ok).toBe(false);
    expect(startGate({ number: 300, labels: [{ name: "ui:layout" }], body: "手机溢出" }).errors[0]).toContain("截图");
    expect(startGate({ number: 300, labels: [{ name: "ui:layout" }], body: "![a](https://github.com/o/r/assets/1/a.png)" }).ok).toBe(true);
    expect(startGate({ number: 300, labels: [{ name: "infra:ci" }], body: "改工作流" }).ok).toBe(true);
    expect(startGate({ number: 300, labels: [{ name: "infra:ci" }, { name: "needs-evidence" }], body: "改工作流" }).ok).toBe(false);
    expect(startGate({ number: 12, labels: [], body: "" }).ok).toBe(true);
    expect(startGate(null)).toMatchObject({ ok: false, unknown: true });
  });
});

describe("代码托管适配（forge.mjs）：纯函数", () => {
  it("选择：有 gitlab remote 用 GitLab，没有用 GitHub；GEEK_FORGE 强制，写错就报错", () => {
    expect(selectForge({ env: {}, hasGitlabRemote: true })).toBe("gitlab");
    expect(selectForge({ env: {}, hasGitlabRemote: false })).toBe("github");
    expect(selectForge({ env: { GEEK_FORGE: "github" }, hasGitlabRemote: true })).toBe("github");
    expect(selectForge({ env: { GEEK_FORGE: "gitlab" }, hasGitlabRemote: false })).toBe("gitlab");
    expect(() => selectForge({ env: { GEEK_FORGE: "gitea" }, hasGitlabRemote: true })).toThrow(/只能是 gitlab 或 github/);
  });

  it("从 remote 的 URL 推出地址与项目路径；认不出的返回 null", () => {
    expect(parseRemoteUrl("https://git.example.test/geek/admin.git")).toEqual({ base: "https://git.example.test", path: "geek/admin" });
    expect(parseRemoteUrl("https://example.test/gitlab/geek/admin.git")).toEqual({ base: "https://example.test/gitlab", path: "geek/admin" });
    expect(parseRemoteUrl("https://example.test/gitlab/a/b/c.git")).toEqual({ base: "https://example.test/gitlab", path: "a/b/c" });
    expect(parseRemoteUrl("https://git.example.test/gitlab/admin.git")).toEqual({ base: "https://git.example.test", path: "gitlab/admin" });
    expect(parseRemoteUrl("https://git.example.test:8443/a/b")).toEqual({ base: "https://git.example.test:8443", path: "a/b" });
    expect(parseRemoteUrl("git@git.example.test:geek/admin.git")).toEqual({ base: "https://git.example.test", path: "geek/admin" });
    expect(parseRemoteUrl("ssh://git@git.example.test:2222/geek/admin.git")).toEqual({ base: "https://git.example.test", path: "geek/admin" });
    expect(parseRemoteUrl("/srv/git/admin.git")).toBeNull();
  });

  it("令牌：GITLAB_TOKEN 优先；非 macOS 不去钥匙串，取不到就是 null", () => {
    expect(gitlabToken({ env: { GITLAB_TOKEN: " abc " }, host: "example.test", platform: "linux" })).toBe("abc");
    expect(gitlabToken({ env: { GITLAB_TOKEN: "abc" }, host: "example.test", platform: "darwin" })).toBe("abc");
    expect(gitlabToken({ env: {}, host: "example.test", platform: "linux" })).toBeNull();
  });

  it("GitLab 状态映射成 decideCleanup 用的写法；同一分支多个 MR 只看编号最大的那个", () => {
    expect(gitlabIssueState({ state: "opened" })).toBe("OPEN");
    expect(gitlabIssueState({ state: "closed" })).toBe("CLOSED");
    expect(gitlabReviewState({ state: "merged" })).toBe("MERGED");
    expect(gitlabReviewState({ state: "locked" })).toBe("OPEN");
    expect(gitlabReviewState({ state: "closed" })).toBe("CLOSED");
    // 只看最新的 MR：旧的已合并、新的还开着，说明合并之后又有提交，不能按已合并清理。
    expect(pickReview([{ iid: 3, state: "opened", target_branch: "stage" }, { iid: 2, state: "merged", target_branch: "stage" }])).toEqual({ state: "OPEN", number: 3, target: "stage" });
    expect(pickReview([{ iid: 2, state: "merged", target_branch: "main" }, { iid: 1, state: "closed", target_branch: "stage" }])).toEqual({ state: "MERGED", number: 2, target: "main" });
    expect(pickReview([{ iid: 4, state: "closed" }, { iid: 6, state: "opened" }])).toEqual({ state: "OPEN", number: 6, target: null });
    expect(pickReview([{ iid: 4, state: "closed" }, { iid: 5, state: "closed" }])).toEqual({ state: "CLOSED", number: 5, target: null });
    expect(pickReview([])).toEqual({ state: null, number: null, target: null });
  });

  it("令牌只发给 https 地址：明文 http 只认本机回环，别的地址当作没配，也不读令牌", () => {
    const env = { GEEK_FORGE: "gitlab", GEEK_GITLAB_PROJECT: "geek/admin", GITLAB_TOKEN: "glpat-test" };
    expect(createForge(repoRoot, { ...env, GEEK_GITLAB_URL: "http://git.example.test" }).missing()).toContain("必须是 https");
    expect(createForge(repoRoot, { ...env, GEEK_GITLAB_URL: "https://git.example.test" }).missing()).toBe("");
    expect(createForge(repoRoot, { ...env, GEEK_GITLAB_URL: "http://127.0.0.1:8080" }).missing()).toBe("");
    expect(createForge(repoRoot, { ...env, GEEK_GITLAB_URL: "http://127.0.0.1.example.test" }).missing()).toContain("必须是 https");
  });

  it("GitLab 回重定向时不跟：令牌不会被带到重定向后的地址，查询当作查不到", async () => {
    const seen: string[] = [];
    const target = createServer((req, res) => { seen.push(String(req.headers["private-token"] ?? "")); res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
    await new Promise<void>((ready) => target.listen(0, "127.0.0.1", ready));
    const targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
    const hop = createServer((req, res) => { res.writeHead(302, { Location: `${targetUrl}${req.url}` }); res.end(); });
    await new Promise<void>((ready) => hop.listen(0, "127.0.0.1", ready));
    try {
      const forge = createForge(repoRoot, { GEEK_FORGE: "gitlab", GEEK_GITLAB_PROJECT: "geek/admin", GITLAB_TOKEN: "glpat-test", GEEK_GITLAB_URL: `http://127.0.0.1:${(hop.address() as AddressInfo).port}` });
      expect(await forge.issueState(1)).toBeNull();
      expect(seen).toEqual([]);
    } finally {
      await new Promise<void>((done) => hop.close(() => done()));
      await new Promise<void>((done) => target.close(() => done()));
    }
  });

  it("GitLab 的 issue 转成门禁用的 detail：标签是字符串或对象都认", () => {
    expect(normalizeGitLabIssue({ iid: 312, title: "t", state: "opened", labels: ["infra:tooling"], description: "改脚本" })).toEqual({
      number: 312, title: "t", state: "OPEN", labels: [{ name: "infra:tooling" }], body: "改脚本",
    });
    expect(startGate(normalizeGitLabIssue({ iid: 312, state: "opened", labels: [{ name: "infra:tooling" }], description: "x" })).ok).toBe(true);
  });
});

// ── GitLab 适配：假 GitLab（127.0.0.1 上的 REST 桩）+ 本地裸仓库当 gitlab / origin remote，不碰网络 ──────────────

const GL_PROJECT = "geek%2Fadmin";
const GL_REMOTE = "https://example.test/gitlab/geek/admin.git";
const GL_TOKEN = "test-token-312";

interface GitLabIssueSeed {
  state: "opened" | "closed";
  labels: string[];
  description: string;
}

interface GitLabStub {
  url: string;
  issues: Record<number, GitLabIssueSeed>;
  mrs: Record<string, Array<{ iid: number; state: "opened" | "merged" | "closed" }>>;
  notes: Array<{ iid: number; body: string }>;
  requests: string[];
  close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => { raw += chunk.toString("utf8"); });
    req.on("end", () => resolve(raw));
  });
}

/** 只回答 task.mjs 会问的几个接口；令牌不对回 401，用来确认令牌只进请求头 */
async function startGitLabStub(issues: Record<number, GitLabIssueSeed>): Promise<GitLabStub> {
  const stub: GitLabStub = { url: "", issues, mrs: {}, notes: [], requests: [], close: async () => {} };
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    stub.requests.push(`${req.method} ${req.url}`);
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };
    if (req.headers["private-token"] !== GL_TOKEN) return send(401, { message: "401 Unauthorized" });
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const issue = new RegExp(`^/api/v4/projects/${GL_PROJECT}/issues/(\\d+)(/notes)?$`).exec(url.pathname);
    if (issue && !issue[2] && req.method === "GET") {
      const seed = stub.issues[Number(issue[1])];
      if (!seed) return send(404, { message: "404 Not found" });
      return send(200, { iid: Number(issue[1]), title: `测试 issue ${issue[1]}`, state: seed.state, labels: seed.labels, description: seed.description });
    }
    if (issue && issue[2] && req.method === "POST") {
      const text = String(JSON.parse(body).body ?? "");
      stub.notes.push({ iid: Number(issue[1]), body: text });
      return send(201, { id: stub.notes.length, body: text });
    }
    if (url.pathname === `/api/v4/projects/${GL_PROJECT}/merge_requests` && req.method === "GET") {
      const branch = url.searchParams.get("source_branch") ?? "";
      return send(200, (stub.mrs[branch] ?? []).map((mr) => ({ ...mr, source_branch: branch })));
    }
    return send(404, { message: "404 Not found" });
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stub.close = () => new Promise<void>((done) => server.close(() => done()));
  return stub;
}

describe("GitLab 适配：task.mjs 对假 GitLab 的端到端", () => {
  const stubs: GitLabStub[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    for (const stub of stubs.splice(0)) await stub.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function gitIn(cwd: string, args: string[]) {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }

  /**
   * 主工作区：remote gitlab 的地址是 GL_REMOTE，用 url.<本地裸仓库>.insteadOf 改写到本地，git fetch/push 不出网；
   * origin 另放一份更靠前的 stage，用来证明 start 不从 origin/stage 拉。
   */
  function gitlabFixture() {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "geek-task-gitlab-")));
    dirs.push(base);
    gitIn(base, ["init", "-q", "--bare", "gitlab.git"]);
    gitIn(base, ["init", "-q", "--bare", "origin.git"]);
    const root = join(base, "repo");
    mkdirSync(root);
    gitIn(root, ["init", "-q", "-b", "stage"]);
    gitIn(root, ["config", "user.email", "ci@example.test"]);
    gitIn(root, ["config", "user.name", "CI"]);
    gitIn(root, ["config", "commit.gpgsign", "false"]);
    mkdirSync(join(root, "scripts"));
    for (const file of SCRIPTS) copyFileSync(join(repoRoot, "scripts", file), join(root, "scripts", file));
    writeFileSync(join(root, ".gitignore"), ".claude/\n");
    writeFileSync(join(root, "package.json"), '{ "version": "0.1.0" }\n');
    gitIn(root, ["add", "-A"]);
    gitIn(root, ["commit", "-q", "-m", "stage 基线"]);
    const gitlabStage = gitIn(root, ["rev-parse", "HEAD"]);
    gitIn(root, ["remote", "add", "gitlab", GL_REMOTE]);
    gitIn(root, ["config", `url.${join(base, "gitlab.git")}.insteadOf`, GL_REMOTE]);
    gitIn(root, ["push", "-q", "gitlab", "stage"]);
    gitIn(root, ["remote", "add", "origin", join(base, "origin.git")]);
    writeFileSync(join(root, "origin-only.txt"), "origin 的 stage 比 gitlab 超前\n");
    gitIn(root, ["add", "-A"]);
    gitIn(root, ["commit", "-q", "-m", "origin stage 超前"]);
    gitIn(root, ["push", "-q", "origin", "stage"]);
    const originStage = gitIn(root, ["rev-parse", "HEAD"]);
    return { root, gitlabStage, originStage, worktree: join(root, ".claude/worktrees/task-312") };
  }

  async function stubWith(issues: Record<number, GitLabIssueSeed>) {
    const stub = await startGitLabStub(issues);
    stubs.push(stub);
    return stub;
  }

  /** 异步跑 task.mjs（同步的 spawnSync 会挡住本进程里的假服务），退出码与输出一起返回 */
  function runTask(root: string, args: string[], env: NodeJS.ProcessEnv) {
    return execFileAsync(process.execPath, [join(root, "scripts/task.mjs"), ...args], { cwd: root, encoding: "utf8", env }).then(
      ({ stdout, stderr }) => ({ status: 0, stdout, stderr }),
      (error: { code?: unknown; stdout?: string; stderr?: string }) => ({
        status: typeof error.code === "number" ? error.code : 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      }),
    );
  }

  /** 环境：GitLab 地址指向假服务，令牌给进去；执行记录身份照常给 */
  const gitlabEnv = (stub: GitLabStub, { token = true }: { token?: boolean } = {}): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...cleanEnv(), GEEK_NOTES_USER: "fixture-user", GEEK_NOTES_BY: "agent-claude-test", GEEK_GITLAB_URL: stub.url };
    if (token) env.GITLAB_TOKEN = GL_TOKEN;
    return env;
  };

  /** 把 worktree 里的改动（开工记录、INDEX）提交掉，模拟「已经进了 PR」的干净状态 */
  function commitAll(dir: string, message: string) {
    gitIn(dir, ["add", "-A"]);
    gitIn(dir, ["commit", "-q", "-m", message]);
  }

  const OPEN_312 = { 312: { state: "opened" as const, labels: ["infra:tooling"], description: "改 task.mjs 与 forge.mjs" } };

  it("start：GitLab 上开着、标签齐全的 issue → 从 gitlab/stage 建 worktree，并在 issue 上留开工记录", async () => {
    const stub = await stubWith(OPEN_312);
    const fx = gitlabFixture();
    const result = await runTask(fx.root, ["start", "312", "norms_hardening"], gitlabEnv(stub));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("基于：gitlab/stage");
    expect(result.stdout).toContain("已在 issue #312 留开工记录");
    expect(fx.originStage).not.toBe(fx.gitlabStage);
    expect(gitIn(fx.worktree, ["rev-parse", "HEAD"])).toBe(fx.gitlabStage);
    expect(gitIn(fx.worktree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("task/312/norms_hardening");
    expect(stub.notes).toHaveLength(1);
    expect(stub.notes[0].iid).toBe(312);
    expect(stub.notes[0].body).toContain("<!-- yzgc:track v1 kind=progress stage=dev -->");
    expect(stub.notes[0].body).toContain(`从 \`gitlab/stage\`（${fx.gitlabStage.slice(0, 12)}）拉出`);
    expect(stub.requests.some((line) => line.includes(GL_TOKEN))).toBe(false);
    const chains = [...collectChains(fx.worktree).values()];
    expect(chains.some((chain) => chain.slug === "task_312_norms_hardening" && chain.files.some((f) => f.entries.some((e) => e.stage === "开工")))).toBe(true);
  }, 30_000);

  it("start：GitLab 上的 issue 已关闭 → 拒绝，不建 worktree，不留言", async () => {
    const stub = await stubWith({ 312: { ...OPEN_312[312], state: "closed" } });
    const fx = gitlabFixture();
    const result = await runTask(fx.root, ["start", "312", "norms_hardening"], gitlabEnv(stub));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("issue #312 状态是 CLOSED");
    expect(existsSync(fx.worktree)).toBe(false);
    expect(stub.notes).toHaveLength(0);
  }, 30_000);

  it("start：缺「组:类」改动类型标签 → 拒绝，并说明缺什么", async () => {
    const stub = await stubWith({ 312: { ...OPEN_312[312], labels: [] } });
    const fx = gitlabFixture();
    const result = await runTask(fx.root, ["start", "312", "norms_hardening"], gitlabEnv(stub));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("issue #312 还不能开工");
    expect(result.stderr).toContain("缺少改动类型标签");
    expect(existsSync(fx.worktree)).toBe(false);
    expect(stub.notes).toHaveLength(0);
  }, 30_000);

  it("start --no-comment：照常建 worktree，但不在 issue 上留言", async () => {
    const stub = await stubWith(OPEN_312);
    const fx = gitlabFixture();
    const result = await runTask(fx.root, ["start", "312", "norms_hardening", "--no-comment"], gitlabEnv(stub));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("按 --no-comment 没有在 issue #312 留言");
    expect(stub.notes).toHaveLength(0);
    expect(existsSync(fx.worktree)).toBe(true);
  }, 30_000);

  it("finish：GitLab 上 MR 已合并 → 删 worktree 与本地分支", async () => {
    const stub = await stubWith(OPEN_312);
    const fx = gitlabFixture();
    expect((await runTask(fx.root, ["start", "312", "norms_hardening"], gitlabEnv(stub))).status).toBe(0);
    commitAll(fx.worktree, "开工记录入库");
    // MR 合并：分支的提交进了 gitlab/stage
    gitIn(fx.root, ["push", "-q", "gitlab", "task/312/norms_hardening:stage"]);
    stub.mrs["task/312/norms_hardening"] = [{ iid: 7, state: "merged", target_branch: "stage" }];
    const done = await runTask(fx.root, ["finish", "312"], gitlabEnv(stub));
    expect(done.status, done.stderr).toBe(0);
    expect(done.stdout).toContain("已清理 #312");
    // 收尾记录的标题用 GitLab 的 MR 写法 !编号
    expect(execFileSync("grep", ["-rl", "PR !7 已合并，清理 worktree", join(fx.root, ".claude/notes-pending")], { encoding: "utf8" })).toContain("notes-pending");
    expect(existsSync(fx.worktree)).toBe(false);
    expect(gitIn(fx.root, ["branch", "--list", "task/312/norms_hardening"])).toBe("");
  }, 30_000);

  it("finish：MR 合并之后本地又提交过 → 不删 worktree 与分支，说明怎么带走", async () => {
    const stub = await stubWith(OPEN_312);
    const fx = gitlabFixture();
    expect((await runTask(fx.root, ["start", "312", "norms_hardening"], gitlabEnv(stub))).status).toBe(0);
    commitAll(fx.worktree, "开工记录入库");
    gitIn(fx.root, ["push", "-q", "gitlab", "task/312/norms_hardening:stage"]);
    writeFileSync(join(fx.worktree, "after-merge.txt"), "合并之后的提交\n");
    commitAll(fx.worktree, "合并之后的提交");
    stub.mrs["task/312/norms_hardening"] = [{ iid: 7, state: "merged", target_branch: "stage" }];
    const kept = await runTask(fx.root, ["finish", "312"], gitlabEnv(stub));
    expect(kept.status).toBe(1);
    expect(kept.stdout).toContain("有 !7 合并之后的提交，还不在 gitlab/stage 里");
    expect(existsSync(fx.worktree)).toBe(true);
    expect(gitIn(fx.root, ["branch", "--list", "task/312/norms_hardening"])).not.toBe("");

    // 查不到合进了哪条分支：同样不删
    stub.mrs["task/312/norms_hardening"] = [{ iid: 7, state: "merged" }];
    const unknown = await runTask(fx.root, ["finish", "312"], gitlabEnv(stub));
    expect(unknown.status).toBe(1);
    expect(unknown.stdout).toContain("查不到 !7 合进了哪条分支");
    expect(existsSync(fx.worktree)).toBe(true);
  }, 30_000);

  it("list --check：MR 已合并却没 finish 就拦（退出 1，写出 !编号）；MR 还开着就放行", async () => {
    const stub = await stubWith(OPEN_312);
    const fx = gitlabFixture();
    expect((await runTask(fx.root, ["start", "312", "norms_hardening"], gitlabEnv(stub))).status).toBe(0);
    commitAll(fx.worktree, "开工记录入库");
    stub.mrs["task/312/norms_hardening"] = [{ iid: 7, state: "merged" }];
    const merged = await runTask(fx.root, ["list", "--check"], gitlabEnv(stub));
    expect(merged.status).toBe(1);
    expect(merged.stderr).toContain("#312 task/312/norms_hardening（PR !7 MERGED，issue OPEN）：PR 已合并，还没 finish");
    expect(merged.stderr).toContain("node scripts/task.mjs finish <issue>");

    // 从另一个 worktree 推送时，git 给 pre-push 导出 GIT_DIR：带着它查别的 worktree 不能读成推送方的索引，把干净的 worktree 误报成有改动。
    const fromHook = await runTask(fx.root, ["list", "--check"], { ...gitlabEnv(stub), GIT_DIR: join(fx.root, ".git") });
    expect(fromHook.stderr).toContain("PR 已合并，还没 finish");
    expect(fromHook.stderr).not.toContain("未提交的改动");

    stub.mrs["task/312/norms_hardening"] = [{ iid: 7, state: "opened" }];
    const working = await runTask(fx.root, ["list", "--check"], gitlabEnv(stub));
    expect(working.status, working.stderr).toBe(0);
    expect(working.stdout).toContain("1 个还在做");
  }, 30_000);

  it("没有令牌：list --check 只警告、以 0 退出，不发任何请求，也不泄露令牌；start 拒绝并说明缺令牌", async () => {
    const stub = await stubWith(OPEN_312);
    const fx = gitlabFixture();
    expect((await runTask(fx.root, ["start", "312", "norms_hardening"], gitlabEnv(stub))).status).toBe(0);
    commitAll(fx.worktree, "开工记录入库");
    stub.requests.length = 0;
    const offline = await runTask(fx.root, ["list", "--check"], gitlabEnv(stub, { token: false }));
    expect(offline.status, offline.stderr).toBe(0);
    expect(offline.stderr).toContain("GitLab 没有令牌");
    expect(offline.stderr).toContain("查不到 PR 的状态");
    expect(offline.stdout).toContain("1 个查不到状态（只警告）");
    expect(stub.requests).toHaveLength(0);
    expect(`${offline.stdout}${offline.stderr}`).not.toContain(GL_TOKEN);

    stub.issues[313] = OPEN_312[312];
    const noStart = await runTask(fx.root, ["start", "313", "no_token"], gitlabEnv(stub, { token: false }));
    expect(noStart.status).toBe(1);
    expect(noStart.stderr).toContain("查不到（GitLab 没有令牌");
    expect(existsSync(join(fx.root, ".claude/worktrees/task-313"))).toBe(false);
  }, 30_000);
});
