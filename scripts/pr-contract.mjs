#!/usr/bin/env node
// PR 正文契约（docs/conventions/PULL-REQUESTS.md「正文契约」）：一件事 = 一个 issue = 一个 task 分支 = 一个 PR。
//
//   node scripts/pr-contract.mjs check  --branch <head ref> --body-file <path> [--issue-state-file <path>] [--labels-file <path>]
//   node scripts/pr-contract.mjs issue  --branch <head ref>      # 只打印分支对应的 issue 号
//
// check 只做文本判断（纯函数 checkPullRequest，tests/tooling/pr-contract.test.ts 覆盖），不联网；
// 工作流先用 gh 取 issue 状态写成 JSON，再用 --issue-state-file 交给它，这样本地与 CI 结论一致。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TYPE_LABEL_SINCE, checkPrTypes } from "./issue-labels.mjs";
import { parsePrSections, visibleProse } from "./pr-markdown.mjs";

/** task/<issue>/<slug>：slug 小写字母数字与下划线（与 check-branch-invariants.mjs 的 TASK_BRANCH_RE 一致） */
export const TASK_BRANCH_RE = /^task\/([0-9]+)\/[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * PR 正文必须有的段落（三级标题 `### <名字>`）。顺序不限；名字逐字匹配，后面可以跟括号说明，
 * 例如 `### 验证命令与结果（HEAD abc123）`。
 */
export const REQUIRED_SECTIONS = ["目的", "关联", "变更范围", "宏观对齐", "解决链路", "验证命令与结果", "验收证据", "人工验收步骤", "审查结论", "风险与回滚"];

/** 验收证据里算作「证据」的东西：图片、视频、GitHub 附件链接、或明确写出的「无界面变化」理由 */
const EVIDENCE_RE = /!\[[^\]]*\]\((?:https?:\/\/|\/)[^)]+\)|<(?:img|video)\s[^>]*src=["']?(?:https?:\/\/|\/)[^"'>\s]+|https:\/\/(?:github\.com\/[^\s)]+\/(?:assets|files)\/|user-images\.githubusercontent\.com\/|github-production-user-asset-[^\s)]+)|无界面变化[:：]/i;

/** 把正文按 `### 标题` 切成段落；标题里括号及之后的说明去掉，只留名字 */
export function sections(body) {
  return parsePrSections(body).parts;
}

/** 正文里 closes/fixes/resolves #n（大小写不敏感，GitHub 的关闭关键字） */
export function closingIssues(body) {
  const found = new Set();
  for (const match of String(body ?? "").matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#([0-9]+)\b/gi)) found.add(Number(match[1]));
  return [...found];
}

export function issueFromBranch(branch) {
  const match = TASK_BRANCH_RE.exec(String(branch ?? ""));
  return match ? Number(match[1]) : null;
}

/**
 * 检查一个 PR。issue 是 gh 取回的 `{ number, state, title, labels? }`（state: OPEN / CLOSED）；拿不到时传 null，
 * 只做文本检查。labels 是 PR 自己的标签；issue 编号不小于 TYPE_LABEL_SINCE 且带「组:类」标签时，
 * 按标签组核对 PR 的标签与证据（scripts/issue-labels.mjs）。返回 { ok, errors[], issue }；errors 是给人看的中文句子，每条说清怎么改。
 * @param {{ branch: string, body: string, labels?: Array<string | { name: string }>, issue?: { number: number, state: string, title?: string, labels?: Array<string | { name: string }> } | null }} input
 */
export function checkPullRequest({ branch, body, labels = [], issue = null }) {
  const errors = [];
  const number = issueFromBranch(branch);
  if (number === null) {
    errors.push(`分支名 ${branch} 不是 task/<issue>/<slug>：进入 stage 的 PR 只能来自对应 issue 的 task 分支（docs/conventions/BRANCHING.md）。`);
  }
  const closes = closingIssues(visibleProse(body));
  if (number !== null) {
    if (!closes.includes(number)) errors.push(`正文没有 \`Closes #${number}\`：分支 ${branch} 对应 issue #${number}，「关联」段要写 Closes #${number}。`);
    const extra = closes.filter((n) => n !== number);
    if (extra.length) errors.push(`正文关闭了分支以外的 issue（${extra.map((n) => `#${n}`).join("、")}）：一个 PR 只处理一个 issue，其它 issue 用「Refs #n」引用，不要用 Closes。`);
  }
  const { parts, duplicates } = parsePrSections(body);
  for (const name of REQUIRED_SECTIONS) {
    if (duplicates.has(name)) errors.push(`必需段落「### ${name}」重复，必须保留唯一正文。`);
    const text = parts.get(name);
    if (text === undefined) errors.push(`缺少段落「### ${name}」（PR 模板 .github/pull_request_template.md）。`);
    else if (!text.replace(/<!--[\s\S]*?-->/g, "").trim()) errors.push(`段落「### ${name}」是空的：删掉模板里的注释后要写实际内容。`);
  }
  const evidence = parts.get("验收证据");
  if (evidence !== undefined && evidence.trim() && !EVIDENCE_RE.test(evidence.replace(/<!--[\s\S]*?-->/g, ""))) {
    errors.push("「验收证据」里没有截图、录屏或附件链接：界面改动要放改前改后截图（或逐帧图、录屏）；确实没有界面变化时写「无界面变化：<理由>」。");
  }
  const review = parts.get("审查结论") ?? "";
  const conclusions = [...review.matchAll(/^\*\*结论：(通过|有条件通过|阻塞)\*\*[ \t]*$/gm)];
  if (conclusions.length !== 1) errors.push("「审查结论」必须有且仅有一行可见的 `**结论：通过**`／`**结论：有条件通过**`／`**结论：阻塞**`，注释或代码块不算（docs/conventions/CODE-REVIEW.md）。");
  else if (conclusions[0][1] === "阻塞") errors.push("审查结论为阻塞：先修正并重新审查，通过后才能合并。");
  if (issue) {
    if (number !== null && issue.number !== number) errors.push(`取回的 issue 是 #${issue.number}，与分支里的 #${number} 不一致。`);
    else if (String(issue.state).toUpperCase() !== "OPEN") errors.push(`issue #${issue.number} 已经关闭：先重新打开它（或新开一个 issue 并改分支名），再提 PR。`);
  }
  if (number !== null && number >= TYPE_LABEL_SINCE) {
    errors.push(...checkPrTypes({ issueLabels: issue?.labels ?? [], prLabels: labels, parts, issueNumber: number }));
  }
  return { ok: errors.length === 0, errors, issue: number };
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const command = process.argv[2];
  const branch = arg("branch");
  if (command === "issue") {
    const number = issueFromBranch(branch);
    if (number === null) process.exitCode = 1;
    else console.log(number);
    return;
  }
  if (command !== "check") throw new Error("用法：node scripts/pr-contract.mjs check --branch <ref> --body-file <path> [--issue-state-file <path>] [--labels-file <path>]");
  const bodyFile = arg("body-file");
  if (!bodyFile) throw new Error("缺少 --body-file");
  const body = readFileSync(bodyFile, "utf8");
  const stateFile = arg("issue-state-file");
  const issue = stateFile ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
  const labelsFile = arg("labels-file");
  const labels = labelsFile ? JSON.parse(readFileSync(labelsFile, "utf8")) : [];
  const result = checkPullRequest({ branch, body, labels, issue });
  if (result.ok) {
    console.log(`PR 正文契约通过：分支 ${branch} ↔ issue #${result.issue}，${REQUIRED_SECTIONS.length} 个段落齐全，有验收证据。`);
    return;
  }
  for (const error of result.errors) console.log(`::error title=PR 正文契约::${error}`);
  console.error(`PR 正文契约未通过（${result.errors.length} 项），按上面逐条改 PR 描述后会自动重跑。`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
