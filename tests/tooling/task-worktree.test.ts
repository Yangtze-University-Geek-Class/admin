import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { checkLifecycle, decideCleanup, issueOfBranch, parseWorktrees, taskBranch, worktreePath } from "../../scripts/task.mjs";

describe("task worktree", () => {
  it("分支名与 worktree 路径：一个 issue 一个", () => {
    expect(taskBranch(35, "task_worktree")).toBe("task/35/task_worktree");
    expect(() => taskBranch(35, "task-worktree")).toThrow(/不用 -/);
    expect(() => taskBranch("abc", "x")).toThrow(/数字/);
    expect(worktreePath("/repo", 35)).toBe("/repo/.claude/worktrees/task-35");
    expect(issueOfBranch("task/35/task_worktree")).toBe(35);
    expect(issueOfBranch("dev/crosery")).toBeNull();
  });

  it("解析 git worktree list --porcelain，含 detached 与主工作区", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD 882435e",
      "branch refs/heads/dev/crosery",
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
    expect(list.map((wt: { branch: string | null }) => wt.branch)).toEqual(["dev/crosery", "task/35/task_worktree", null]);
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
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const SCRIPTS = ["task.mjs", "note.mjs", "check-branch-invariants.mjs", "release-policy.mjs", "deployment-environment.mjs"];
  const FAKE_GH = [
    `#!${process.execPath}`,
    "// 假 gh：issue view <n> 回 FAKE_GH_ISSUE_<n>（默认 OPEN）；pr list --head task/<n>/… 回 FAKE_GH_PR_<n>（「状态 编号」，没设就是没有 PR）",
    "const args = process.argv.slice(2);",
    "if (process.env.FAKE_GH_OFFLINE) process.exit(1);",
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

  const env = (bin: string, gh: Record<string, string>) => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE: process.execPath, ...gh });

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
