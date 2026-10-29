#!/usr/bin/env node
// issue / PR 的「改动类型」标签与证明要求（docs/conventions/ISSUES.md §2「改动类型标签」）。
//
//   node scripts/issue-labels.mjs sync [--apply]    # 对照仓库标签；不带 --apply 只打印差异
//
// 其余导出都是纯函数（tests/tooling/issue-labels.test.ts 覆盖），pr-contract.mjs、issue-gate.mjs、task.mjs 共用。
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 标签名用「组:类」；每组决定需要什么证明（ISSUES.md §2） */
export const LABEL_GROUPS = {
  ui: {
    title: "界面",
    color: "1d76db",
    proof: "截图",
    labels: {
      "ui:layout": "界面：版式、响应式、溢出、竖屏适配",
      "ui:visual": "界面：配色、字体、图标、动画、3D 观感",
      "ui:interaction": "界面：手势、键盘、焦点、触控目标、无障碍",
      "ui:content": "界面：文案与可见内容",
    },
  },
  func: {
    title: "功能",
    color: "0e8a16",
    proof: "接口",
    labels: {
      "func:api": "功能：路由、请求响应约定、错误码、限流",
      "func:auth": "功能：登录、会话、角色与权限",
      "func:data": "功能：表结构、迁移、导入导出、存储",
      "func:external": "功能：GitHub、发信商、CDN 等外部服务对接",
    },
  },
  infra: {
    title: "基础设施",
    color: "5319e7",
    proof: "命令输出",
    labels: {
      "infra:deploy": "基础设施：镜像、compose、环境变量契约、部署",
      "infra:ci": "基础设施：工作流、检查脚本、钩子",
      "infra:tooling": "基础设施：脚本、规范文档、测试基建",
    },
  },
};

export const NEEDS_EVIDENCE_LABEL = "needs-evidence";

/** 所有「组:类」标签名 */
export const TYPE_LABELS = Object.values(LABEL_GROUPS).flatMap((group) => Object.keys(group.labels));

/** 这个编号起的 issue 才强制「组:类」标签；更早的 issue 是规范生效前建的，不回溯 */
export const TYPE_LABEL_SINCE = 235;

/** 仓库里应当存在的标签：{ name, color, description } */
export function labelDefinitions() {
  const defs = [];
  for (const group of Object.values(LABEL_GROUPS)) {
    for (const [name, description] of Object.entries(group.labels)) defs.push({ name, color: group.color, description });
  }
  defs.push({ name: NEEDS_EVIDENCE_LABEL, color: "d93f0b", description: "缺改动类型标签、截图或接口说明，补齐前不得开工" });
  return defs;
}

/** 从标签名数组（字符串或 { name }）里取出「组:类」标签 */
export function typeLabels(labels) {
  const names = (labels ?? []).map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean);
  return TYPE_LABELS.filter((name) => names.includes(name));
}

/** 标签涉及的组：Set of "ui" | "func" | "infra" */
export function groupsOf(labels) {
  return new Set(typeLabels(labels).map((name) => name.split(":")[0]));
}

/** 截图、录屏、GitHub 附件链接 */
export const IMAGE_RE = /!\[[^\]]*\]\((?:https?:\/\/|\/)[^)]+\)|<(?:img|video)\s[^>]*src=["']?(?:https?:\/\/|\/)[^"'>\s]+|https:\/\/(?:github\.com\/[^\s)]+\/(?:assets|files)\/|user-images\.githubusercontent\.com\/|github-production-user-asset-[^\s)]+)/i;

/** 「无接口变更：<理由>」，理由要有实际文字 */
export const NO_API_RE = /无接口变更[:：]\s*[^\s<>，。,.:：]/;

const METHOD_PATH_RE = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S*/;
const STATUS_RE = /(?:\b[1-5]\d{2}\b|requestId|request_id)/;
const TEST_RUN_RE = /(?:pnpm|vitest|node\s+--test|tests\/\S+\.test\.\w+)/;

/** 去掉 HTML 注释（模板里的提示文字不算内容） */
function visible(text) {
  return String(text ?? "").replace(/<!--[\s\S]*?-->/g, "");
}

/** 取 issue 表单渲染出的某个段落（`### 标题` 到下一个 `###` 之间） */
export function formSection(body, title) {
  const lines = String(body ?? "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => new RegExp(`^#{2,3}\\s+${title}\\s*$`).test(line));
  if (start === -1) return null;
  const rest = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{2,3}\s+/.test(line)) break;
    rest.push(line);
  }
  return visible(rest.join("\n")).trim();
}

/** 表单「改动类型」下拉框选中的值（多选用逗号分隔）→ 标签名；选项以标签名开头，后面可跟「 — 说明」 */
export function labelsFromForm(body) {
  const value = formSection(body, "改动类型");
  if (!value || /^_?No response_?$/i.test(value)) return [];
  const found = new Set();
  for (const part of value.split(/[,，\n]/)) {
    const name = part.trim().split(/[\s—-]/)[0];
    if (TYPE_LABELS.includes(name)) found.add(name);
  }
  return [...found];
}

/**
 * 检查一个 issue 的类型标签与证明。number 小于 TYPE_LABEL_SINCE 的旧 issue 一律放行。
 *
 * `needs-evidence` 标签既是这个检查的**输入**，又是 `issue-gate` 判定要不要打它的**输出**（#298）：
 * 开工门禁（`task.mjs start`）看到这个标签就该拒绝，所以保留这条错误；但 `issue-gate` 自己
 * 决定「补齐了没有」时必须忽略它，否则标签一旦打上就永远算「还有错」，摘除条件永远不成立。
 * 用 `ignoreEvidenceLabel` 区分这两种调用方。
 *
 * @param {{ number: number, labels: Array<string | { name: string }>, body: string, ignoreEvidenceLabel?: boolean }} input
 * @returns {{ ok: boolean, errors: string[], groups: Set<string>, evidenceLabeled: boolean }}
 *   `evidenceLabeled` 是标签本身的状态，与 `errors` 分开给出，供调用方展示提示。
 */
export function checkIssue({ number, labels, body, ignoreEvidenceLabel = false }) {
  const errors = [];
  const labelNames = (labels ?? []).map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);
  const evidenceLabeled = labelNames.includes(NEEDS_EVIDENCE_LABEL);
  if (evidenceLabeled && !ignoreEvidenceLabel) {
    errors.push("issue 带有 needs-evidence 标签：证据或标签尚未补齐，不得开工。");
  }
  const groups = groupsOf(labels);
  if (number < TYPE_LABEL_SINCE) return { ok: errors.length === 0, errors, groups, evidenceLabeled };
  if (groups.size === 0) {
    errors.push(`缺少改动类型标签：从 ${TYPE_LABELS.join("、")} 里至少选一个（跨类就都选）。`);
    return { ok: false, errors, groups, evidenceLabeled };
  }
  if (groups.has("ui") && !IMAGE_RE.test(visible(body))) {
    errors.push("带 ui:* 标签的 issue 正文必须有现状截图（上传至 GitHub 附件或以 Markdown 图片语法提供，不接受裸文件名），没有截图不得开工。");
  }
  if (groups.has("func")) {
    const section = formSection(body, "涉及接口");
    const text = section ?? visible(body);
    const hasApi = METHOD_PATH_RE.test(text) || NO_API_RE.test(text);
    if (!hasApi) errors.push("带 func:* 标签的 issue 要写「涉及接口」：方法 + 路径（例 `POST /api/forum/topics`）、请求响应约定和要补的接口测试；确实没有接口变化写「无接口变更：<理由>」。");
  }
  return { ok: errors.length === 0, errors, groups, evidenceLabeled };
}

/**
 * 检查 PR 的类型标签和证据。issueGroups 是它 Closes 的 issue 的组；prLabels 是 PR 自己的标签。
 * parts 是 pr-contract 的 sections() 结果。
 * @param {{ issueLabels: Array<string | { name: string }>, prLabels: Array<string | { name: string }>, parts: Map<string, string> }} input
 */
export function checkPrTypes({ issueLabels = [], prLabels = [], parts, issueNumber = null }) {
  const errors = [];
  const required = typeLabels(issueLabels);
  const have = typeLabels(prLabels);
  if (have.length === 0) {
    errors.push(`PR 缺少改动类型标签：必须从 ${TYPE_LABELS.join("、")} 里至少选一个（跨类就都选）。`);
  }
  const missing = required.filter((name) => !have.includes(name));
  if (missing.length) {
    errors.push(`PR 缺少改动类型标签 ${missing.join("、")}：PR 的标签要覆盖它 Closes 的 issue 的标签。`);
  }
  const combinedGroups = new Set([...groupsOf(issueLabels), ...groupsOf(prLabels)]);
  if (combinedGroups.size === 0) return errors;

  const evidence = visible(parts.get("验收证据") ?? "");
  if (combinedGroups.has("ui")) {
    if (/无界面变化/.test(evidence)) {
      errors.push("关联或自身带 ui:* 标签的 PR，「验收证据」不能写「无界面变化」，必须提供改前改后截图（桌面与手机各一）。");
    } else if (!IMAGE_RE.test(evidence)) {
      errors.push("带 ui:* 标签的 PR，「验收证据」里没有有效截图（需为 GitHub 附件链接或 Markdown 图片格式，不接受裸文件名）。");
    } else {
      const hasBefore = /改前|before/i.test(evidence);
      const hasAfter = /改后|after/i.test(evidence);
      const imageMatches = evidence.match(new RegExp(IMAGE_RE.source, "gi")) || [];
      if ((!hasBefore || !hasAfter) && imageMatches.length < 2) {
        errors.push("带 ui:* 标签的 PR，「验收证据」需明确包含改前与改后两组证据截图。");
      }
    }
  }

  if (combinedGroups.has("func")) {
    const verify = visible(parts.get("验证命令与结果") ?? "");
    const proven = TEST_RUN_RE.test(verify) && METHOD_PATH_RE.test(verify) && STATUS_RE.test(verify);
    if (!proven && !NO_API_RE.test(verify)) {
      errors.push("关联或自身带 func:* 标签的 PR，「验证命令与结果」要有接口测试命令与真实输出，以及对真实接口的请求（方法 + 路径）、状态码或 requestId；确实没有接口变化写「无接口变更：<理由>」。");
    }
  }
  return errors;
}

/** 按内容推测标签用的关键词；只给建议，不自动加（提单人自己确认后加） */
const SUGGEST_RULES = {
  "ui:layout": /溢出|视口|竖屏|横屏|响应式|布局|适配|窄屏|横向滚动|\d{3}\s*[×x]\s*\d{3}/i,
  "ui:visual": /配色|颜色|字体|图标|动画|3D|帧率|卡顿|样式|壁纸|渐变|阴影/i,
  "ui:interaction": /手势|触控|点击|双击|键盘|焦点|无障碍|下拉|滑动|拖拽|按钮/,
  "ui:content": /文案|错别字|提示语|标题写|说明文字|措辞/,
  "func:api": /接口|路由|请求|响应|状态码|限流|\/api\//i,
  "func:auth": /登录|会话|权限|角色|称号|oauth|cookie|令牌/i,
  "func:data": /数据库|迁移|表结构|导入|导出|备份|sqlite|字段/i,
  "func:external": /github|发信|邮件|cdn|七牛|外部服务|第三方/i,
  "infra:deploy": /部署|镜像|compose|docker|环境变量|nginx|证书|预发布|正式环境/i,
  "infra:ci": /工作流|workflow|actions|钩子|hook|流水线|\bci\b/i,
  "infra:tooling": /脚本|规范|文档|测试基建|lint|检查脚本/,
};

/** 按标题和正文里的关键词推测可能的「组:类」标签，命中多的在前，最多 limit 个；没有命中返回 [] */
export function suggestLabels(text, limit = 3) {
  const source = visible(text);
  const hits = [];
  for (const [name, re] of Object.entries(SUGGEST_RULES)) {
    const found = source.match(new RegExp(re.source, `${re.flags.replace("g", "")}g`));
    if (found) hits.push({ name, count: found.length });
  }
  return hits.sort((a, b) => b.count - a.count).slice(0, limit).map((hit) => hit.name);
}

const STOP = new Set(["the", "and", "for", "with"]);

/** 标题切成比较用的词：去掉「模块：」前缀；中文取相邻两字，英文数字取整词 */
export function titleTokens(title) {
  const text = String(title ?? "").replace(/^[^：:]{1,12}[：:]/, "").toLowerCase();
  const tokens = new Set();
  for (const word of text.match(/[a-z0-9_]{3,}/g) ?? []) if (!STOP.has(word)) tokens.add(word);
  for (const run of text.match(/[一-鿿]+/g) ?? []) {
    for (let i = 0; i < run.length - 1; i += 1) tokens.add(run.slice(i, i + 2));
  }
  return tokens;
}

/** 英文数字词比相邻两字更能说明是同一件事，权重高；同模块前缀只作加分 */
const WORD_WEIGHT = 3;

/**
 * 在已有 issue 里找和 target 相似的：共有标题词的加权和（英文数字词 3，中文相邻两字 1），同模块前缀加 1，
 * 达到 minWeight 入选；正文里直接提到的 issue 一定入选。只用于提示，不做判定。
 * candidates: [{ number, title, state }]
 */
export function findSimilar(target, candidates, { limit = 5, minWeight = 4 } = {}) {
  const mine = titleTokens(target.title);
  const prefix = /^([^：:]{1,12})[：:]/.exec(String(target.title ?? ""))?.[1];
  const rawTargetTitle = String(target.title ?? "").replace(/^[^：:]{1,12}[：:]/, "").trim();
  const mentioned = new Set([...String(target.body ?? "").matchAll(/#([0-9]+)/g)].map((m) => Number(m[1])));
  const scored = [];
  for (const other of candidates) {
    if (other.number === target.number) continue;
    const rawOtherTitle = String(other.title ?? "").replace(/^[^：:]{1,12}[：:]/, "").trim();
    const isExactTitle = Boolean(rawTargetTitle && rawTargetTitle === rawOtherTitle);
    const theirs = titleTokens(other.title);
    let score = 0;
    for (const token of mine) if (theirs.has(token)) score += /^[a-z0-9_]+$/.test(token) ? WORD_WEIGHT : 1;
    if (score > 0 && prefix && String(other.title ?? "").startsWith(`${prefix}：`)) score += 1;
    const linked = mentioned.has(other.number);
    if (isExactTitle || score >= minWeight || linked) {
      scored.push({
        number: other.number,
        title: other.title,
        state: other.state,
        score: isExactTitle ? Math.max(score, 100) : score,
        linked,
      });
    }
  }
  return scored.sort((a, b) => Number(b.linked) - Number(a.linked) || b.score - a.score).slice(0, limit);
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function sync(apply) {
  const existing = new Map(JSON.parse(gh(["label", "list", "--limit", "200", "--json", "name,color,description"])).map((l) => [l.name, l]));
  let changed = 0;
  for (const def of labelDefinitions()) {
    const have = existing.get(def.name);
    if (have && have.color === def.color && have.description === def.description) continue;
    changed += 1;
    console.log(`${have ? "更新" : "新建"}标签 ${def.name}`);
    if (apply) gh(["label", have ? "edit" : "create", def.name, "--color", def.color, "--description", def.description]);
  }
  console.log(changed === 0 ? "仓库标签已与定义一致。" : apply ? `已处理 ${changed} 个标签。` : `有 ${changed} 个标签待处理；加 --apply 写入仓库。`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== "sync") throw new Error("用法：node scripts/issue-labels.mjs sync [--apply]");
    sync(process.argv.includes("--apply"));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
