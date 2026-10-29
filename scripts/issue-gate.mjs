#!/usr/bin/env node
// issue 创建 / 编辑 / 改标签时的检查（docs/conventions/ISSUES.md §2「改动类型标签」「相关 issue」）：
//   1. 表单「改动类型」选了什么，就把它加成标签；用 CLI / API 建单、没有表单的，按内容推测并在评论里建议，不自动加；
//   2. 核对「组:类」标签、ui 截图、func 涉及接口（scripts/issue-labels.mjs 的 checkIssue）；
//   3. 在已有 issue（含已关闭）里找标题相似的，列在评论里供核对。
// 只提示和标记：不关闭、不重开、不改别人的标签；缺证明时加 needs-evidence，补齐后摘掉。
//
//   node scripts/issue-gate.mjs --event <event.json> [--apply]
//
// 不带 --apply 只打印将要做的事。评论用隐藏标记 ISSUE_GATE_MARKER 识别，重复运行只更新同一条。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NEEDS_EVIDENCE_LABEL, TYPE_LABEL_SINCE, checkIssue, findSimilar, labelsFromForm, suggestLabels, typeLabels } from "./issue-labels.mjs";

export const ISSUE_GATE_MARKER = "<!-- yzgc:issue-gate v1 -->";

/**
 * 评论正文。similar 是 findSimilar 的结果，errors 是 checkIssue 的错误。
 * `evidenceLabeled` 告诉评论「这个 issue 身上还挂着 needs-evidence」（#298）：标签不是错误来源，
 * 而是这份评论要维护的状态，所以单独展示——通过时说清「已摘掉」，没通过时说清「补齐后自动摘」。
 * @param {{ errors: string[], similar: Array<{ number: number, title: string, state: string, linked?: boolean }>, added: string[], suggested?: string[], number?: number | string, evidenceLabeled?: boolean }} input
 */
export function buildGateComment({ errors, similar, added, suggested = [], number = "<n>", evidenceLabeled = false }) {
  const lines = [ISSUE_GATE_MARKER, errors.length ? "**提单检查**｜未通过，补齐前不得开工" : "**提单检查**｜通过", ""];
  if (added.length) lines.push(`已把表单「改动类型」里选的值加成标签：${added.map((n) => `\`${n}\``).join("、")}。`, "");
  if (suggested.length) {
    lines.push(`**按标题和正文推测可能的类型**：${suggested.map((n) => `\`${n}\``).join("、")}。这只是关键词推测，不会自动添加；判定口径见 docs/conventions/ISSUES.md §2，确认后自己加：`, "", `\`gh issue edit ${number} --add-label ${suggested[0]}\``, "");
  }
  if (errors.length) lines.push("**需要补的**：", ...errors.map((e) => `- ${e}`), "", "补齐后编辑 issue 正文或标签，本评论会自动更新。", "");
  if (!errors.length && evidenceLabeled) {
    lines.push("已摘掉 `needs-evidence` 标签：改动类型标签、截图与「涉及接口」都齐了，可以开工。", "");
  }
  if (similar.length) {
    lines.push("**可能相关的 issue**（按标题匹配，只供核对）：");
    for (const item of similar) {
      const state = String(item.state).toUpperCase() === "OPEN" ? "开着" : "已关闭";
      lines.push(`- #${item.number} ${item.title}（${state}${item.linked ? "，正文提到" : ""}）`);
    }
    lines.push("", "请在正文「相关 issue」写明关系：重复（不另建，补到原单）、部分重叠（写 `Refs #n` 并说明边界）、续作（`Refs #n`，不重开旧单）。已被取消（not planned）的先在原 issue 里提出并等明确答复。");
  } else {
    lines.push("没有找到标题相似的 issue；若你确认查过，在正文「相关 issue」写明已搜关键词。");
  }
  return `${lines.join("\n")}\n`;
}

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input });
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const eventFile = arg("event");
  if (!eventFile) throw new Error("用法：node scripts/issue-gate.mjs --event <event.json> [--apply]");
  const apply = process.argv.includes("--apply");
  const issue = JSON.parse(readFileSync(eventFile, "utf8")).issue;
  if (!issue || issue.pull_request) return console.log("不是 issue 事件，跳过。");
  if (issue.number < TYPE_LABEL_SINCE) return console.log(`#${issue.number} 早于规范生效线 #${TYPE_LABEL_SINCE}，跳过。`);
  if (String(issue.state).toLowerCase() !== "open") return console.log(`#${issue.number} 已关闭，跳过。`);

  const current = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
  const fromForm = labelsFromForm(issue.body).filter((name) => !current.includes(name));
  const labels = [...current, ...fromForm];
  // 忽略 needs-evidence 标签本身（#298）：它是这里要维护的状态，不是「证据还缺什么」。
  // 不忽略就会自锁——标签在 → 检查报错 → 认为还要证据 → 永远不摘 → 标签一直在。
  const { errors, evidenceLabeled } = checkIssue({ number: issue.number, labels, body: issue.body, ignoreEvidenceLabel: true });
  const others = ghJson(["issue", "list", "--state", "all", "--limit", "500", "--json", "number,title,state"]);
  const similar = findSimilar({ number: issue.number, title: issue.title, body: issue.body }, others);
  const suggested = typeLabels(labels).length ? [] : suggestLabels(`${issue.title}\n${issue.body ?? ""}`);
  const comment = buildGateComment({ errors, similar, added: fromForm, suggested, number: issue.number, evidenceLabeled });
  const wantEvidence = errors.length > 0;
  const hasEvidence = current.includes(NEEDS_EVIDENCE_LABEL);

  console.log(`#${issue.number} 类型标签：${typeLabels(labels).join("、") || "无"}；补标签：${fromForm.join("、") || "无"}；错误 ${errors.length} 条；相似 ${similar.length} 条`);
  if (!apply) return console.log(comment);

  const number = String(issue.number);
  if (fromForm.length) gh(["issue", "edit", number, ...fromForm.flatMap((name) => ["--add-label", name])]);
  if (wantEvidence && !hasEvidence) gh(["issue", "edit", number, "--add-label", NEEDS_EVIDENCE_LABEL]);
  if (!wantEvidence && hasEvidence) gh(["issue", "edit", number, "--remove-label", NEEDS_EVIDENCE_LABEL]);

  const comments = ghJson(["issue", "view", number, "--json", "comments"]).comments;
  const mine = comments.find((c) => String(c.body).startsWith(ISSUE_GATE_MARKER));
  if (mine) {
    if (mine.body !== comment) gh(["api", "-X", "PATCH", `repos/{owner}/{repo}/issues/comments/${String(mine.url).split("-").pop()}`, "-F", "body=@-"], comment);
  } else {
    gh(["issue", "comment", number, "--body-file", "-"], comment);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
