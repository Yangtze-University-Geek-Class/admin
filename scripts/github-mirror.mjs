#!/usr/bin/env node
// GitHub 镜像状态（docs/conventions/BRANCHING.md「GitHub 镜像同步」，#330）：只读比较 gitlab 与 origin 两个远端的 main、stage。
//   node scripts/github-mirror.mjs status [--fetch] [--json]
//     --fetch  先 git fetch 两个远端的 main、stage（只更新远端跟踪分支，不推、不改本地分支）
//     --json   输出机器可读结果
// 只读本机已有的远端跟踪引用 refs/remotes/<远端>/<分支>，不连 GitHub API，不推送，不改分支、不写文件。
// 退出码：0 已生成报告（同步与否都只报告，看结论行）；2 缺少远端引用或 git 出错，无法判断。
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repoNeutralEnv } from "./forge.mjs";

/** gitlab 是主平台（issue、MR、编号的唯一来源）；origin 是 GitHub 镜像（代码与 CI） */
export const PRIMARY = "gitlab";
export const MIRROR = "origin";
export const BRANCHES = ["main", "stage"];
/** 报告里最多列出的文件名数，全部数字仍会给出 */
const LIST_LIMIT = 50;

function git(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: repoNeutralEnv() });
  if (result.status !== 0) throw new Error(`git ${args[0]} 失败：${result.stderr.trim()}`);
  return result.stdout.trim();
}

function revision(root, ref) {
  const result = spawnSync("git", ["-C", root, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: repoNeutralEnv() });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** a 是 b 的祖先（b 包含 a）。退出码 1 是「不是」，其它错误抛出，不当作没包含。 */
function isAncestor(root, a, b) {
  const result = spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", a, b], { stdio: ["ignore", "ignore", "pipe"], env: repoNeutralEnv() });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`git merge-base 失败：${String(result.stderr).trim()}`);
}

/** 两个提交之间文件的增删改：A 只在第二个（GitHub 一侧）、D 只在第一个、M 两边内容不同 */
export function groupFiles(nameStatus) {
  const groups = { onlyMirror: [], onlyPrimary: [], changed: [] };
  for (const line of nameStatus.split("\n").filter(Boolean)) {
    const [status, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (status === "A") groups.onlyMirror.push(path);
    else if (status === "D") groups.onlyPrimary.push(path);
    else groups.changed.push(path);
  }
  return groups;
}

/** 比较某个分支在两个远端上的指向：同一提交、镜像领先（包含主平台且多出提交）、镜像落后，或分叉 */
export function compareBranch(root, branch) {
  const left = `${PRIMARY}/${branch}`;
  const right = `${MIRROR}/${branch}`;
  const leftSha = revision(root, `refs/remotes/${left}`);
  const rightSha = revision(root, `refs/remotes/${right}`);
  const missing = [leftSha ? null : left, rightSha ? null : right].filter(Boolean);
  if (missing.length) return { branch, left, right, missing };
  const treeSame = git(root, ["rev-parse", `${leftSha}^{tree}`]) === git(root, ["rev-parse", `${rightSha}^{tree}`]);
  const [leftOnly, rightOnly] = git(root, ["rev-list", "--left-right", "--count", `${leftSha}...${rightSha}`]).split(/\s+/).map(Number);
  let relation;
  if (leftSha === rightSha) relation = "same";
  else if (isAncestor(root, leftSha, rightSha)) relation = "mirror-ahead";
  else if (isAncestor(root, rightSha, leftSha)) relation = "mirror-behind";
  else relation = "diverged";
  const mergeBase = relation === "diverged" ? git(root, ["merge-base", leftSha, rightSha]) : null;
  const files = treeSame ? groupFiles("") : groupFiles(git(root, ["diff", "--no-renames", "--name-status", leftSha, rightSha]));
  // 镜像一侧独有的提交：分叉时要看清是哪几个，不能只给计数
  const rightOnlyCommits = rightOnly ? git(root, ["log", "--format=%h %s", `${leftSha}..${rightSha}`]).split("\n").filter(Boolean).map(line => ({ sha: line.slice(0, line.indexOf(" ")), subject: line.slice(line.indexOf(" ") + 1) })) : [];
  return { branch, left, right, leftSha, rightSha, relation, treeSame, leftOnly, rightOnly, rightOnlyCommits, mergeBase, files };
}

/** 主要不变量：每个平台 main 包含在 stage 里；GitHub 的 stage 包含 GitHub 的 main 与 GitLab 的 stage */
export function invariants(root) {
  const ref = (remote, branch) => revision(root, `refs/remotes/${remote}/${branch}`);
  const check = (a, b) => (a && b ? isAncestor(root, a, b) : null);
  return {
    primaryStageHasMain: check(ref(PRIMARY, "main"), ref(PRIMARY, "stage")),
    mirrorStageHasMain: check(ref(MIRROR, "main"), ref(MIRROR, "stage")),
    mirrorStageHasPrimaryStage: check(ref(PRIMARY, "stage"), ref(MIRROR, "stage")),
  };
}

/** 整体结论：两个分支的文件树都一致，且三条包含关系都成立；有缺失引用时不下结论 */
export function mirrorStatus(root) {
  const pairs = BRANCHES.map(branch => compareBranch(root, branch));
  const missing = pairs.flatMap(pair => pair.missing ?? []);
  const inv = invariants(root);
  const complete = missing.length === 0;
  const synced = complete && pairs.every(pair => pair.treeSame) && Object.values(inv).every(value => value === true);
  return { root, pairs, invariants: inv, missing, synced, complete };
}

const RELATION_TEXT = {
  same: "同一提交",
  "mirror-ahead": "GitHub 领先（包含 GitLab，多出提交）",
  "mirror-behind": "GitHub 落后（不包含 GitLab 的提交）",
  diverged: "分叉：两边都有对方没有的提交，不能快进",
};

const yes = value => (value === true ? "是" : value === false ? "否" : "未知（缺引用）");

/** 把 mirrorStatus 的结果排成给人看的文字 */
export function formatStatus(report) {
  const lines = ["GitHub 镜像状态（gitlab 为主平台，origin 为 GitHub 镜像）"];
  if (report.missing.length) {
    lines.push(`缺少远端跟踪引用：${report.missing.join("、")}。先运行 node scripts/github-mirror.mjs status --fetch，或 git fetch gitlab main stage / git fetch origin main stage。`);
  }
  for (const pair of report.pairs) {
    if (pair.missing) continue;
    lines.push("", `分支 ${pair.branch}`);
    lines.push(`  ${pair.left} ${pair.leftSha.slice(0, 12)}  ${pair.right} ${pair.rightSha.slice(0, 12)}`);
    lines.push(`  关系：${RELATION_TEXT[pair.relation]}；${pair.left} 独有 ${pair.leftOnly} 个提交，${pair.right} 独有 ${pair.rightOnly} 个提交`);
    if (pair.rightOnlyCommits.length) {
      lines.push(`  ${pair.right} 独有的提交（共 ${pair.rightOnlyCommits.length} 个）：`);
      for (const commit of pair.rightOnlyCommits.slice(0, LIST_LIMIT)) lines.push(`    ${commit.sha} ${commit.subject}`);
      if (pair.rightOnlyCommits.length > LIST_LIMIT) lines.push(`    ……另有 ${pair.rightOnlyCommits.length - LIST_LIMIT} 个未列出`);
    }
    if (pair.relation === "diverged") lines.push(`  合并基点：${pair.mergeBase.slice(0, 12)}。分叉时只能用同步 PR 合进 ${pair.right}，再让 ${pair.left} 快进到同一个合并提交（docs/conventions/BRANCHING.md「GitHub 镜像同步」）。`);
    lines.push(`  文件树：${pair.treeSame ? "一致" : "不一致"}`);
    if (!pair.treeSame) {
      const { onlyMirror, onlyPrimary, changed } = pair.files;
      lines.push(`  只在 ${pair.right} 的内容文件 ${onlyMirror.length} 个${onlyMirror.length ? `：${onlyMirror.slice(0, LIST_LIMIT).join("、")}${onlyMirror.length > LIST_LIMIT ? "……" : ""}` : ""}`);
      lines.push(`  只在 ${pair.left} 的内容文件 ${onlyPrimary.length} 个${onlyPrimary.length ? `：${onlyPrimary.slice(0, LIST_LIMIT).join("、")}${onlyPrimary.length > LIST_LIMIT ? "……" : ""}` : ""}`);
      lines.push(`  两边内容不同的文件 ${changed.length} 个${changed.length ? `：${changed.slice(0, LIST_LIMIT).join("、")}${changed.length > LIST_LIMIT ? "……" : ""}` : ""}`);
    }
  }
  lines.push(
    "",
    "包含关系：",
    `  ${PRIMARY}/stage 包含 ${PRIMARY}/main：${yes(report.invariants.primaryStageHasMain)}`,
    `  ${MIRROR}/stage 包含 ${MIRROR}/main：${yes(report.invariants.mirrorStageHasMain)}`,
    `  ${MIRROR}/stage 包含 ${PRIMARY}/stage：${yes(report.invariants.mirrorStageHasPrimaryStage)}`,
  );
  lines.push("", report.synced ? "结论：已同步（两个分支文件树一致，包含关系齐全）" : report.complete ? "结论：未同步（见上面的文件树与包含关系）" : "结论：无法判断（缺远端跟踪引用）");
  return lines.join("\n");
}

function main(argv) {
  const [command, ...flags] = argv;
  if (command !== "status") {
    console.error("用法：node scripts/github-mirror.mjs status [--fetch] [--json]");
    return 2;
  }
  const json = flags.includes("--json");
  const root = process.cwd();
  if (flags.includes("--fetch")) {
    for (const remote of [PRIMARY, MIRROR]) {
      const result = spawnSync("git", ["-C", root, "fetch", "--quiet", "--no-tags", remote, "main", "stage"], { stdio: "inherit", env: repoNeutralEnv() });
      if (result.status !== 0) throw new Error(`git fetch ${remote} 失败`);
    }
  }
  const report = mirrorStatus(root);
  console.log(json ? JSON.stringify(report, null, 2) : formatStatus(report));
  return report.complete ? 0 : 2;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
