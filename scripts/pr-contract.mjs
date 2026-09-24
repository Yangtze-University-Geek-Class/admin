#!/usr/bin/env node
// PR 正文契约（docs/conventions/PULL-REQUESTS.md「正文契约」）：一件事 = 一个 issue = 一个 task 分支 = 一个 PR。
//
//   node scripts/pr-contract.mjs check  --branch <head ref> --body-file <path> [--issue-state-file <path>]
//   node scripts/pr-contract.mjs issue  --branch <head ref>      # 只打印分支对应的 issue 号
//
// check 只做文本判断（纯函数 checkPullRequest，tests/tooling/pr-contract.test.ts 覆盖），不联网；
// 工作流先用 gh 取 issue 状态写成 JSON，再用 --issue-state-file 交给它，这样本地与 CI 结论一致。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** task/<issue>/<slug>：slug 小写字母数字与下划线（与 check-branch-invariants.mjs 的 TASK_BRANCH_RE 一致） */
export const TASK_BRANCH_RE = /^task\/([0-9]+)\/[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * PR 正文必须有的段落（三级标题 `### <名字>`）。顺序不限；名字逐字匹配，后面可以跟括号说明，
 * 例如 `### 验证命令与结果（HEAD abc123）`。
 */
export const REQUIRED_SECTIONS = ["目的", "关联", "变更范围", "解决链路", "验证命令与结果", "验收证据", "人工验收步骤", "审查结论", "风险与回滚"];

/** 验收证据里算作「证据」的东西：图片、视频、GitHub 附件链接、或明确写出的「无界面变化」理由 */
const EVIDENCE_RE = /!\[[^\]]*\]\([^)]+\)|<img\s[^>]*src=|<video\s|https:\/\/github\.com\/[^\s)]+\/(?:assets|files)\/|https:\/\/user-images\.githubusercontent\.com\/|\.(?:png|jpe?g|webp|gif|mp4|webm|mov)\b|无界面变化[:：]/i;

/** 把正文按 `### 标题` 切成段落；标题里括号及之后的说明去掉，只留名字 */
export function sections(body) {
  const out = new Map();
  let current = null;
  for (const line of String(body ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1].replace(/[（(].*$/, "").trim();
      out.set(current, "");
      continue;
    }
    if (current !== null) out.set(current, `${out.get(current)}${line}\n`);
  }
  return out;
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
 * 检查一个 PR。issue 是 gh 取回的 `{ number, state, title }`（state: OPEN / CLOSED）；拿不到时传 null，
 * 只做文本检查。返回 { ok, errors[], issue }；errors 是给人看的中文句子，每条说清怎么改。
 * @param {{ branch: string, body: string, issue?: { number: number, state: string, title?: string } | null }} input
 */
export function checkPullRequest({ branch, body, issue = null }) {
  const errors = [];
  const number = issueFromBranch(branch);
  if (number === null) {
    errors.push(`分支名 ${branch} 不是 task/<issue>/<slug>：进入 stage 的 PR 只能来自对应 issue 的 task 分支（docs/conventions/BRANCHING.md）。`);
  }
  const closes = closingIssues(body);
  if (number !== null) {
    if (!closes.includes(number)) errors.push(`正文没有 \`Closes #${number}\`：分支 ${branch} 对应 issue #${number}，「关联」段要写 Closes #${number}。`);
    const extra = closes.filter((n) => n !== number);
    if (extra.length) errors.push(`正文关闭了分支以外的 issue（${extra.map((n) => `#${n}`).join("、")}）：一个 PR 只处理一个 issue，其它 issue 用「Refs #n」引用，不要用 Closes。`);
  }
  const parts = sections(body);
  for (const name of REQUIRED_SECTIONS) {
    const text = parts.get(name);
    if (text === undefined) errors.push(`缺少段落「### ${name}」（PR 模板 .github/pull_request_template.md）。`);
    else if (!text.replace(/<!--[\s\S]*?-->/g, "").trim()) errors.push(`段落「### ${name}」是空的：删掉模板里的注释后要写实际内容。`);
  }
  const evidence = parts.get("验收证据");
  if (evidence !== undefined && evidence.trim() && !EVIDENCE_RE.test(evidence.replace(/<!--[\s\S]*?-->/g, ""))) {
    errors.push("「验收证据」里没有截图、录屏或附件链接：界面改动要放改前改后截图（或逐帧图、录屏）；确实没有界面变化时写「无界面变化：<理由>」。");
  }
  const review = parts.get("审查结论") ?? "";
  if (review.trim() && !/\*\*结论：(?:通过|有条件通过|阻塞)/.test(review)) errors.push("「审查结论」没有 `**结论：通过**`／`**结论：有条件通过**`／`**结论：阻塞**` 这一行（docs/conventions/CODE-REVIEW.md）。");
  if (issue) {
    if (number !== null && issue.number !== number) errors.push(`取回的 issue 是 #${issue.number}，与分支里的 #${number} 不一致。`);
    else if (String(issue.state).toUpperCase() !== "OPEN") errors.push(`issue #${issue.number} 已经关闭：先重新打开它（或新开一个 issue 并改分支名），再提 PR。`);
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
  if (command !== "check") throw new Error("用法：node scripts/pr-contract.mjs check --branch <ref> --body-file <path> [--issue-state-file <path>]");
  const bodyFile = arg("body-file");
  if (!bodyFile) throw new Error("缺少 --body-file");
  const body = readFileSync(bodyFile, "utf8");
  const stateFile = arg("issue-state-file");
  const issue = stateFile ? JSON.parse(readFileSync(stateFile, "utf8")) : null;
  const result = checkPullRequest({ branch, body, issue });
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
