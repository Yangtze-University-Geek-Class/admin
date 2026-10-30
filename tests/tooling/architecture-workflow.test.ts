import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/architecture-alignment.yml", import.meta.url), "utf8");
it("checks all pull requests and edited bodies without skip labels or path filters", () => {
  expect(workflow).toContain("pull_request:");
  for (const event of ["opened", "reopened", "synchronize", "edited", "ready_for_review"]) expect(workflow).toContain(event);
  expect(workflow).not.toMatch(/\b(?:paths|paths-ignore|branches|branches-ignore):/);
  expect(workflow).not.toContain("continue-on-error");
  expect(workflow).not.toContain("exit 0");
  expect(workflow).not.toContain("pull_request_target");
});
it("uses the base policy when available and checks candidate Git objects as data", () => {
  expect(workflow).toContain('git show "${BASE_SHA}:scripts/check-architecture.mjs" > "$policy"');
  expect(workflow).toContain('git show "${BASE_SHA}:scripts/hotfix-windows.mjs" > "${RUNNER_TEMP}/hotfix-windows.mjs"');
  expect(workflow).toContain('--base "$BASE_SHA" --head "$HEAD_SHA"');
  expect(workflow).toContain('--branch "$HEAD_REF" --body-file');
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("contents: read");
  expect(workflow).not.toContain("secrets.");
  expect(workflow).not.toMatch(/pnpm install|npm install/);
  expect(workflow).not.toContain('cp scripts/check-architecture.mjs');
  expect(workflow).not.toContain('cp scripts/hotfix-windows.mjs');
  expect(workflow).toContain('node "$policy"');
});
it("基线还没有隐私门禁时不复制它：set -eu 下 git show 找不到路径会让整步失败", () => {
  const line = 'git show "${BASE_SHA}:scripts/check-privacy.mjs" > "${RUNNER_TEMP}/check-privacy.mjs"';
  const lines = workflow.split("\n");
  const index = lines.findIndex(item => item.trim() === line);
  expect(index).toBeGreaterThan(0);
  expect(lines[index - 1].trim()).toBe('if git cat-file -e "${BASE_SHA}:scripts/check-privacy.mjs" 2>/dev/null; then');
});
it("宏观检查器复制的 hotfix-windows 导入 owner-approval：基线有时放进临时目录，还没有时不复制（目标分支没有检查器时失败关闭，不再有引导路径，#330）", () => {
  expect(workflow).toContain('git show "${BASE_SHA}:scripts/hotfix-windows.mjs" > "${RUNNER_TEMP}/hotfix-windows.mjs"');
  const lines = workflow.split("\n");
  const index = lines.findIndex(item => item.trim() === 'git show "${BASE_SHA}:scripts/owner-approval.mjs" > "${RUNNER_TEMP}/owner-approval.mjs"');
  expect(index).toBeGreaterThan(0);
  expect(lines[index - 1].trim()).toBe('if git cat-file -e "${BASE_SHA}:scripts/owner-approval.mjs" 2>/dev/null; then');
});
it("GitHub 一侧读按平台分开的声明：目标检查器认 --forge 才传 --forge github；没有 FORGES 时按旧参数调用；目标分支没有检查器时失败关闭（#330）", () => {
  expect(workflow).toContain('--report "${RUNNER_TEMP}/architecture-impact.json" ${use_forge:+--forge github}');
  expect(workflow).toContain("grep -q '^export const FORGES' \"$policy\"");
  expect(workflow).toContain("宏观对齐失败：目标分支没有 scripts/check-architecture.mjs，不改用候选分支的检查器放行。");
  expect(workflow).not.toContain("--forge gitlab");
});

/** 候选分支的检查器：三种基线情况都不能让它被执行或被复制进运行目录。 */
const CANDIDATE_CHECKER = 'export const FORGES = ["gitlab", "github"];\nconsole.log("candidate checker");\n';
const BASE_WITH_FORGES = 'export const FORGES = ["gitlab", "github"];\nconsole.log("base checker with forges");\n';
const BASE_WITHOUT_FORGES = 'console.log("base checker without forges");\n';

/** 取出「按真实 diff 核对宏观颗粒度」步骤的 run 块，去掉 YAML 缩进，原样交给 bash 执行。 */
function stepRunBlock(): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex(line => line.includes("name: 按真实 diff 核对宏观颗粒度"));
  const run = lines.indexOf("        run: |", start);
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** 虚构的仓库：基线提交放目标检查器（或没有），候选提交改成另一份检查器，origin 指向本仓库。 */
function fixture(baseChecker: string | null) {
  const root = mkdtempSync(join(tmpdir(), "arch-workflow-repo-"));
  const runnerTemp = mkdtempSync(join(tmpdir(), "arch-workflow-temp-"));
  temps.push(root, runnerTemp);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "fixture");
  mkdirSync(join(root, "scripts"));
  for (const name of ["hotfix-windows.mjs", "check-doc-sync.mjs", "note.mjs", "pr-markdown.mjs"]) {
    writeFileSync(join(root, "scripts", name), "// fixture\n");
  }
  if (baseChecker !== null) writeFileSync(join(root, "scripts", "check-architecture.mjs"), baseChecker);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(root, "scripts", "check-architecture.mjs"), CANDIDATE_CHECKER);
  git("add", "-A");
  git("commit", "-q", "-m", "candidate");
  const head = git("rev-parse", "HEAD");
  git("remote", "add", "origin", root);
  return { root, runnerTemp, base, head };
}

/** 用假的 node 记录参数和它收到的检查器内容；真正的检查器不执行。 */
function runStep(fx: ReturnType<typeof fixture>) {
  const bin = mkdtempSync(join(tmpdir(), "arch-workflow-bin-"));
  temps.push(bin);
  const argsFile = join(fx.runnerTemp, "node-args.txt");
  const policyCopy = join(fx.runnerTemp, "policy-copy.mjs");
  writeFileSync(join(bin, "node"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\ncp "$1" "${policyCopy}"\n`, { mode: 0o755 });
  const result = spawnSync("bash", ["-c", stepRunBlock()], {
    cwd: fx.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      BASE_SHA: fx.base,
      HEAD_SHA: fx.head,
      HEAD_REF: "task/307/github_stage_sync",
      PR_BODY: "宏观对齐\n",
      RUNNER_TEMP: fx.runnerTemp,
      GITHUB_WORKSPACE: fx.root,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    args: existsSync(argsFile) ? readFileSync(argsFile, "utf8").trimEnd().split("\n") : null,
    policy: existsSync(policyCopy) ? readFileSync(policyCopy, "utf8") : null,
  };
}

describe("宏观对齐工作流的检查器选择（#330）", () => {
  it("目标检查器认 --forge：传 --forge github，并且只用目标分支的检查器", () => {
    const run = runStep(fixture(BASE_WITH_FORGES));
    expect(run.status).toBe(0);
    expect(run.args?.[run.args.indexOf("--forge") + 1]).toBe("github");
    expect(run.policy).toBe(BASE_WITH_FORGES);
  });
  it("目标检查器不认 --forge：按旧参数调用，不传 --forge，仍只用目标分支的检查器", () => {
    const run = runStep(fixture(BASE_WITHOUT_FORGES));
    expect(run.status).toBe(0);
    expect(run.args).not.toContain("--forge");
    expect(run.args).toContain("--report");
    expect(run.policy).toBe(BASE_WITHOUT_FORGES);
  });
  it("目标分支没有检查器：失败关闭，候选检查器不被执行", () => {
    const run = runStep(fixture(null));
    expect(run.status).not.toBe(0);
    expect(run.stdout).toContain("目标分支没有 scripts/check-architecture.mjs");
    expect(run.args).toBeNull();
    expect(run.policy).toBeNull();
  });
});
