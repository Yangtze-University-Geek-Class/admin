#!/usr/bin/env node
// GitHub 镜像自动同步（#330）：GitLab 的 stage 或 main 更新后，把同一内容经同步分支与 PR 推到 GitHub，
// 必需检查通过后合并，再把 GitLab 快进到 GitHub 合并后的提交。流程见 docs/conventions/BRANCHING.md「GitHub 镜像同步」。
//   node scripts/github-mirror-sync.mjs --branch stage --issue <GitLab 工单号> [--primary gitlab] [--mirror origin] [--repo owner/repo]
// 分叉时拒绝（GitHub 独有的提交不会被覆盖）；main 要求 stage 已包含它。令牌只从 GH_TOKEN 读（gh 自己读），不打印。
// 退出码：0 已同步或无需同步；1 拒绝、检查失败或超时；2 用法错误。
import { execFileSync } from "node:child_process";
import { realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gitConfig, parseRemoteUrl, repoNeutralEnv } from "./forge.mjs";

export const SYNCABLE = ["stage", "main"];
const CHECK_POLL_MS = 30_000;
const CHECK_POLLS = 120;

/** 只看两个提交的祖先关系决定动作：相同不动；GitHub 落后就推；GitHub 在前就只快进 GitLab；分叉就拒绝。 */
export function planSync({ primary, mirror, isAncestor }) {
  if (primary === mirror) return { action: "none" };
  if (isAncestor(mirror, primary)) return { action: "mirror" };
  if (isAncestor(primary, mirror)) return { action: "primary-ff" };
  return { action: "refuse", reason: "GitHub 与 GitLab 分叉：GitHub 上有 GitLab 没有的提交。先按 BRANCHING「GitHub 镜像同步」人工合并，不自动覆盖。" };
}

/** 必需检查的结论：有失败或取消就是 fail；都通过（跳过也算通过）才是 pass；还有进行中的继续等。 */
export function checksVerdict(checks) {
  if (!checks.length) return "pending";
  if (checks.some(check => check.bucket === "fail" || check.bucket === "cancel")) return "fail";
  if (checks.every(check => check.bucket === "pass" || check.bucket === "skipping")) return "pass";
  return "pending";
}

/**
 * 同步一个分支。git 与 gh 是注入的适配器（测试替换成假的）：
 *   git: fetch(remote, branch)、revParse(ref)、treeOf(sha)、isAncestor(a, b)、push(remote, refspec)
 *   gh: findOpenPr({head, base})、createPr({head, base, title, body})、checks(number)、mergePr({number, headSha})
 */
export async function runSync({ branch, issue, primary, mirror, git, gh, sleep = ms => new Promise(done => setTimeout(done, ms)), polls = CHECK_POLLS, pollMs = CHECK_POLL_MS }) {
  if (!SYNCABLE.includes(branch)) throw new Error(`只能同步 stage 或 main：${branch}`);
  git.fetch(primary, branch);
  git.fetch(mirror, branch);
  if (branch === "main") git.fetch(primary, "stage");
  const primaryHead = git.revParse(`${primary}/${branch}`);
  const mirrorHead = git.revParse(`${mirror}/${branch}`);
  if (branch === "main") {
    const stageHead = git.revParse(`${primary}/stage`);
    if (!git.isAncestor(primaryHead, stageHead)) return { status: "refused", reason: "main 还没有被 stage 包含：先让 stage 合入 main，再同步 main。" };
  }
  const plan = planSync({ primary: primaryHead, mirror: mirrorHead, isAncestor: git.isAncestor });
  if (plan.action === "none") return { status: "same" };
  if (plan.action === "refuse") return { status: "refused", reason: plan.reason };
  if (plan.action === "primary-ff") {
    if (git.treeOf(mirrorHead) !== git.treeOf(primaryHead)) return { status: "refused", reason: "GitHub 在前，但文件树与 GitLab 不一致，不自动快进。" };
    git.push(primary, `${mirrorHead}:refs/heads/${branch}`);
    return { status: "primary-fast-forwarded", head: mirrorHead };
  }
  const head = `task/${issue}/github_${branch}_sync`;
  git.push(mirror, `${primaryHead}:refs/heads/${head}`);
  const number = gh.findOpenPr({ head, base: branch }) ?? gh.createPr({ head, base: branch, title: `GitHub 镜像同步：${branch}（GitLab ${primaryHead.slice(0, 12)}）`, body: `自动同步 GitLab 的 ${branch}（${primaryHead}）。必需检查通过后合并，合并后 GitLab 快进到合并后的提交。` });
  let verdict = "pending";
  for (let attempt = 0; attempt < polls && verdict === "pending"; attempt++) {
    verdict = checksVerdict(gh.checks(number));
    if (verdict === "pending") await sleep(pollMs);
  }
  if (verdict === "fail") return { status: "ci-failed", pr: number };
  if (verdict !== "pass") return { status: "timeout", pr: number };
  gh.mergePr({ number, headSha: primaryHead });
  git.fetch(mirror, branch);
  const merged = git.revParse(`${mirror}/${branch}`);
  if (git.treeOf(merged) !== git.treeOf(primaryHead)) return { status: "refused", reason: "合并后 GitHub 的文件树与 GitLab 不一致，停下来人工核对。", pr: number };
  if (merged !== primaryHead) git.push(primary, `${merged}:refs/heads/${branch}`);
  return { status: "synced", pr: number, head: merged };
}

/** 真正的 git 适配器：只读远端跟踪引用；推送不带 --force。 */
export function gitClient(root) {
  const run = (args, options = {}) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: repoNeutralEnv(), ...options }).trim();
  const ok = args => { try { execFileSync("git", ["-C", root, ...args], { stdio: "ignore", env: repoNeutralEnv() }); return true; } catch { return false; } };
  return {
    fetch: (remote, branch) => run(["fetch", "--quiet", "--no-tags", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]),
    revParse: ref => run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]),
    treeOf: sha => run(["rev-parse", `${sha}^{tree}`]),
    isAncestor: (a, b) => ok(["merge-base", "--is-ancestor", a, b]),
    push: (remote, refspec) => run(["push", "--quiet", remote, refspec]),
  };
}

/** 真正的 gh 适配器：仓库由 --repo 给；令牌由 gh 自己从 GH_TOKEN 读。 */
export function ghClient(repo, { run = ghRun } = {}) {
  const pr = (...args) => JSON.parse(run(["pr", ...args, "--repo", repo]) || "null");
  return {
    findOpenPr: ({ head, base }) => (pr("list", "--head", head, "--base", base, "--state", "open", "--json", "number") ?? [])[0]?.number ?? null,
    createPr: ({ head, base, title, body }) => {
      const file = join(tmpdir(), `github-mirror-sync-${process.pid}.md`);
      writeFileSync(file, body);
      const url = run(["pr", "create", "--repo", repo, "--head", head, "--base", base, "--title", title, "--body-file", file]).trim();
      return Number(url.slice(url.lastIndexOf("/") + 1));
    },
    checks: number => {
      // gh pr checks 在有失败时退出非零，但输出仍是 JSON，所以失败的退出也要读
      const out = run(["pr", "checks", String(number), "--repo", repo, "--json", "name,bucket"], { allowFailure: true });
      return JSON.parse(out || "[]");
    },
    mergePr: ({ number, headSha }) => run(["pr", "merge", String(number), "--repo", repo, "--merge", "--match-head-commit", headSha]),
  };
}

function ghRun(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: repoNeutralEnv() }).trim();
  } catch (error) {
    if (allowFailure && error.stdout) return String(error.stdout).trim();
    throw new Error(`gh ${args[0]} ${args[1] ?? ""} 失败：${String(error.stderr ?? error.message).trim().slice(0, 300)}`);
  }
}

/** 命令行入口：参数校验，然后跑一次同步，结论按退出码报告 */
export async function main(argv, { root = process.cwd(), out = console.log, err = console.error, git = gitClient(root), gh } = {}) {
  const opts = { primary: "gitlab", mirror: "origin" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!["--branch", "--issue", "--primary", "--mirror", "--repo"].includes(flag) || value === undefined) {
      err("用法：node scripts/github-mirror-sync.mjs --branch stage|main --issue <GitLab 工单号> [--primary gitlab] [--mirror origin] [--repo owner/repo]");
      return 2;
    }
    opts[flag.slice(2)] = value;
    i++;
  }
  if (!SYNCABLE.includes(opts.branch) || !/^[0-9]+$/.test(opts.issue ?? "")) {
    err("--branch 只能是 stage 或 main，--issue 必须是 GitLab 工单号。");
    return 2;
  }
  const repo = opts.repo ?? parseRemoteUrl(gitConfig(root, `remote.${opts.mirror}.url`))?.path;
  if (!repo) {
    err("没找到 GitHub 仓库：给 --repo owner/repo，或配置 " + opts.mirror + " 远端。");
    return 2;
  }
  const result = await runSync({ branch: opts.branch, issue: opts.issue, primary: opts.primary, mirror: opts.mirror, git, gh: gh ?? ghClient(repo) });
  out(`GitHub 镜像同步 ${opts.branch}：${result.status}${result.reason ? `（${result.reason}）` : ""}${result.pr ? ` PR #${result.pr}` : ""}`);
  return ["same", "synced", "primary-fast-forwarded"].includes(result.status) ? 0 : 1;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}
