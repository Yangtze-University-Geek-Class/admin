import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { repoNeutralEnv } from "../../scripts/forge.mjs";
import { compareBranch, formatStatus, groupFiles, mirrorStatus } from "../../scripts/github-mirror.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/github-mirror.mjs");
const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

/**
 * 临时仓库：远端不真的存在，直接写远端跟踪引用 refs/remotes/<远端>/<分支>，模拟 gitlab 与 origin 的指向。
 * 提交全是虚构的内容文件。
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "github-mirror-"));
  temporary.push(root);
  const env = { ...repoNeutralEnv(), GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  const commit = (path: string, message: string) => { write(path, message); git("add", "."); git("commit", "-q", "-m", message); return git("rev-parse", "HEAD"); };
  git("init", "-q", "-b", "main"); git("config", "commit.gpgsign", "false");
  const base = commit("a.txt", "base");
  // gitlab 的 stage：在 base 上加 b.txt
  const gitlabStage = commit("b.txt", "gitlab stage");
  // origin 上只在 GitHub 一侧的提交：在 base 上加 c.txt，不包含 gitlab 的 stage
  git("switch", "-q", "-c", "github-only", base);
  const githubOnly = commit("c.txt", "github only");
  // 合并提交：父是 github-only 与 gitlab stage，树取 gitlab stage 的树（同步 PR 合并后的样子）
  const tree = git("rev-parse", `${gitlabStage}^{tree}`);
  const merged = execFileSync("git", ["-C", root, "commit-tree", tree, "-p", githubOnly, "-p", gitlabStage, "-m", "sync"], { encoding: "utf8", env }).trim();
  const ref = (remote: string, branch: string, sha: string) => git("update-ref", `refs/remotes/${remote}/${branch}`, sha);
  return { root, base, gitlabStage, githubOnly, merged, ref };
}

describe("GitHub 镜像状态：只读比较两个远端的 main、stage", () => {
  it("分叉时列出 GitHub 独有的提交（提交号加标题），不只给计数", () => {
    const f = fixture();
    f.ref("gitlab", "stage", f.gitlabStage);
    f.ref("origin", "stage", f.githubOnly);
    const report = mirrorStatus(f.root);
    const pair = report.pairs.find(item => item.branch === "stage")!;
    expect(pair.rightOnlyCommits).toEqual([{ sha: f.githubOnly.slice(0, 7), subject: "github only" }]);
    const text = formatStatus(report);
    expect(text).toContain("origin/stage 独有的提交（共 1 个）：");
    expect(text).toContain(`    ${f.githubOnly.slice(0, 7)} github only`);
  });
  it("同一提交、文件树一致：报告同步", () => {
    const f = fixture();
    f.ref("gitlab", "main", f.base); f.ref("origin", "main", f.base);
    f.ref("gitlab", "stage", f.gitlabStage); f.ref("origin", "stage", f.merged);
    const report = mirrorStatus(f.root);
    expect(report.complete).toBe(true);
    expect(report.synced).toBe(true);
    expect(report.pairs[1]).toMatchObject({ branch: "stage", relation: "mirror-ahead", treeSame: true });
    expect(report.invariants).toEqual({ primaryStageHasMain: true, mirrorStageHasMain: true, mirrorStageHasPrimaryStage: true });
    expect(formatStatus(report)).toContain("结论：已同步");
  });

  it("GitHub stage 包含 GitLab stage 但文件树不同（同步 PR 没合完）：不算同步，并列出 GitHub 独有的文件", () => {
    const f = fixture();
    f.ref("gitlab", "main", f.base); f.ref("origin", "main", f.base);
    f.ref("gitlab", "stage", f.gitlabStage); f.ref("origin", "stage", f.githubOnly);
    const report = mirrorStatus(f.root);
    expect(report.synced).toBe(false);
    const stage = report.pairs[1];
    expect(stage.relation).toBe("diverged");
    expect(stage.files.onlyMirror).toEqual(["c.txt"]);
    expect(stage.files.onlyPrimary).toEqual(["b.txt"]);
    expect(stage.leftOnly).toBe(1);
    expect(stage.rightOnly).toBe(1);
    expect(report.invariants.mirrorStageHasPrimaryStage).toBe(false);
    const text = formatStatus(report);
    expect(text).toContain("分叉");
    expect(text).toContain("只在 origin/stage 的内容文件 1 个：c.txt");
    expect(text).toContain("结论：未同步");
  });

  it("缺少远端跟踪引用时不下结论：列出缺的引用，报告 incomplete", () => {
    const f = fixture();
    f.ref("gitlab", "main", f.base); f.ref("origin", "main", f.base);
    f.ref("gitlab", "stage", f.gitlabStage);
    const report = mirrorStatus(f.root);
    expect(report.complete).toBe(false);
    expect(report.missing).toEqual(["origin/stage"]);
    expect(report.synced).toBe(false);
    expect(formatStatus(report)).toContain("缺少远端跟踪引用：origin/stage");
    expect(formatStatus(report)).toContain("结论：无法判断");
  });

  it("镜像落后：GitHub 的提交是 GitLab 的祖先，报告落后而不是分叉", () => {
    const f = fixture();
    f.ref("gitlab", "main", f.base); f.ref("origin", "main", f.base);
    f.ref("gitlab", "stage", f.merged); f.ref("origin", "stage", f.gitlabStage);
    const stage = compareBranch(f.root, "stage");
    expect(stage.relation).toBe("mirror-behind");
    expect(stage.mergeBase).toBeNull();
  });

  it("文件分组：只在镜像一侧（A）、只在主平台一侧（D）、两边内容不同（M）", () => {
    const diff = ["A\tc.txt", "D\tb.txt", "M\tsub/d.txt", "M\tsub/space name.txt"].join("\n");
    expect(groupFiles(diff)).toEqual({ onlyMirror: ["c.txt"], onlyPrimary: ["b.txt"], changed: ["sub/d.txt", "sub/space name.txt"] });
  });
});

describe("github-mirror.mjs status 命令行", () => {
  it("只读：不改任何分支与引用，缺引用时退出码 2，同步时退出码 0", () => {
    const f = fixture();
    f.ref("gitlab", "main", f.base); f.ref("origin", "main", f.base);
    f.ref("gitlab", "stage", f.gitlabStage); f.ref("origin", "stage", f.merged);
    const before = execFileSync("git", ["-C", f.root, "for-each-ref", "--format=%(refname) %(objectname)"], { encoding: "utf8" });
    const ok = spawnSync(process.execPath, [script, "status", "--json"], { cwd: f.root, encoding: "utf8", env: repoNeutralEnv() });
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout).synced).toBe(true);
    const after = execFileSync("git", ["-C", f.root, "for-each-ref", "--format=%(refname) %(objectname)"], { encoding: "utf8" });
    expect(after).toBe(before);
    f.ref("origin", "stage", f.gitlabStage);
    expect(spawnSync(process.execPath, [script, "status"], { cwd: f.root, encoding: "utf8", env: repoNeutralEnv() }).status).toBe(0);
    execFileSync("git", ["-C", f.root, "update-ref", "-d", "refs/remotes/origin/stage"]);
    const missing = spawnSync(process.execPath, [script, "status"], { cwd: f.root, encoding: "utf8", env: repoNeutralEnv() });
    expect(missing.status).toBe(2);
    expect(missing.stdout).toContain("缺少远端跟踪引用：origin/stage");
  });

  it("未知子命令给出用法并退出 2", () => {
    const f = fixture();
    const result = spawnSync(process.execPath, [script, "push"], { cwd: f.root, encoding: "utf8", env: repoNeutralEnv() });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("用法");
  });
});
