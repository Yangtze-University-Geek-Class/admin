#!/usr/bin/env node
// GitHub → GitLab 单向导入（#330）：把 GitHub 上开着的 issue 与 PR 导进 GitLab，在 GitHub 留回链并关闭。
//   node scripts/github-import.mjs            默认 plan：只读，列出要导入的条目与作者对应结果，不写任何东西
//   node scripts/github-import.mjs --apply    真正写：GitLab 建 issue，GitHub 留回链并关闭
// 只做 GitHub → GitLab，不做回写。PR 也导成 GitLab 的 issue，不导成合并请求：PR 的分支只在 GitHub 上，
// GitLab 的合并请求要求源分支存在于 GitLab，导进来的只会是一张指向空分支的单子。
// 作者：GitHub 登录名与 GitLab 用户名精确对上（不区分大小写，且账号 active）的，用管理员令牌加 Sudo 头按原作者建；
// 对不上的不加 Sudo，正文写明原作者与原链接。仓库里不放人员对照表。
// 去重：GitLab 正文第一行「迁自 GitHub：<链接>」是去重依据，重复执行不重复建单；GitHub 没关上的，重跑时补回链并关闭。
// 跳过：同步工单（标签 hot-fix）与同步 PR（分支 task/<编号>/hotfix_stage_sync 或 github_*），不导入。
// 令牌：GitLab 令牌从 GITLAB_TOKEN 或 macOS 钥匙串读（forge.mjs 的 gitlabToken）；GitHub 走 gh 已登录的凭据。
// 所有输出先脱敏；错误信息里不带令牌与正文。
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gitlabToken, repoNeutralEnv, resolveRepos, secureBase } from "./forge.mjs";

/** 同步工单与同步 PR 的分支：hotfix 合回 stage 的同步 PR，以及 GitHub 镜像同步 PR（docs/conventions/BRANCHING.md） */
export const SYNC_BRANCH_RE = /^task\/[0-9]+\/(?:hotfix_stage_sync|github_[a-z0-9]+(?:_[a-z0-9]+)*)$/;
export const SYNC_LABEL = "hot-fix";
const GITHUB_ORIGIN = "https://github.com";
const DESCRIPTION_FILE_LIMIT = 30;

/** 把令牌与常见的凭据形状换成 [redacted]；输出与错误信息都先过这一道 */
export function redactSecrets(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) if (secret) out = out.split(secret).join("[redacted]");
  return out
    .replace(/glpat-[A-Za-z0-9_-]{16,}/g, "[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]");
}

/**
 * 导进 GitLab 的标题与正文先过这一道：引用（> 行、「」『』）里的内容换成「[已脱敏]」，邮箱与家目录路径换成 [已脱敏]。
 * GitHub 镜像是公开的，所有者的原话与个人标识不进仓库，也不进 GitLab 的议题。
 */
export function redactPersonalText(text) {
  // 代码块原样保留：里面的引号与 @ 是代码，不是对话
  return String(text).split(/(```[\s\S]*?```)/).map((part, i) => (i % 2 ? part : redactProse(part))).join("");
}

function redactProse(part) {
  return part
    .replace(/^([ \t]*)>[ \t]?.*$/gm, "$1> 「[已脱敏]」")
    .replace(/「[^」]*」|『[^』]*』|“[^”\n]*”|"[^"\n]*"/g, "「[已脱敏]」")
    .replace(/[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g, "[已脱敏]")
    .replace(/\/(?:Users|home)\/[^\s/`)"'\]]+/g, "[已脱敏]")
    // @用户名 去掉 @，免得 GitLab 去通知别人
    .replace(/(^|[^\w@`/])@(?=[A-Za-z0-9])/g, "$1");
}

/** 北京时间 YYYY-MM-DD HH:mm */
export function beijing(iso) {
  return new Date(new Date(iso).getTime() + 8 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
}

/** 同步工单或同步 PR：不导入。标签 hot-fix 对 issue 与 PR 都算；分支规则只看 PR 的 head */
export function syncReason({ labels = [], headRef = null }) {
  if (labels.includes(SYNC_LABEL)) return `同步工单（标签 ${SYNC_LABEL}）`;
  if (headRef && SYNC_BRANCH_RE.test(headRef)) return `同步 PR（分支 ${headRef}）`;
  return null;
}

/**
 * 正文里的裸 #编号改成 GitHub 的完整链接：导进 GitLab 后 #编号 指向的是 GitLab 的编号，会错链。
 * 代码块、行内代码与 URL 原样保留；&#123; 之类的实体不动。
 */
export function rewriteRefs(text, { owner, repo }) {
  const plain = segment => segment.replace(/(?<![\w&/#.\-])#(\d{1,6})(?!\w)/g, (_, n) => `[#${n}](${GITHUB_ORIGIN}/${owner}/${repo}/issues/${n})`);
  // URL 遇到空白、括号、CJK 与全角标点即结束，避免吞掉紧跟其后的 #编号
  const parts = String(text).split(/(```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>()"'`\]\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]+)/);
  return parts.map((part, i) => (i % 2 === 1 ? part : plain(part))).join("");
}

/** 从 GitLab 议题列表里找出已导入的：第一行「迁自 GitHub：<链接>」与 GitHub 链接完全相等。同一链接对应多张单就拒绝，不替人选。 */
export function indexImported(gitlabIssues) {
  const byUrl = new Map();
  for (const issue of gitlabIssues) {
    const firstLine = String(issue.description ?? "").split("\n", 1)[0];
    const url = /^迁自 GitHub：(\S+)/.exec(firstLine)?.[1];
    if (!url) continue;
    if (byUrl.has(url)) throw new Error(`同一 GitHub 链接对应多张 GitLab 议题：#${byUrl.get(url).iid} 与 #${issue.iid}（${url}），先人工合并，不自动选`);
    byUrl.set(url, issue);
  }
  return byUrl;
}

/** GitLab 用户精确对上：用户名不区分大小写，账号必须是 active */
export function matchGitlabUser(login, users) {
  const wanted = String(login ?? "").toLowerCase();
  return (users ?? []).find(user => String(user.username ?? "").toLowerCase() === wanted && user.state === "active") ?? null;
}

/** GitLab 议题正文：去重行、原作者、原创建时间、PR 的链接与改动摘要，然后是原正文（裸 #编号已改成 GitHub 链接） */
export function buildDescription({ item, owner, repo, author, pr }) {
  const lines = [`迁自 GitHub：${item.url}`];
  lines.push(author.gitlab
    ? `GitHub 原作者：\`${item.login}\`，已按原作者建单（GitLab 用户 \`${author.gitlab.username}\`）`
    : `GitHub 原作者：\`${item.login}\`，GitLab 上没有同名账号，建单人是导入的管理员，原作者只在这里注明`);
  lines.push(`GitHub 原创建：${beijing(item.createdAt)}（北京时间）`);
  if (pr) {
    lines.push(`类型：Pull Request（GitLab 上是 issue，不是合并请求；分支只在 GitHub 上）`);
    lines.push(`head 分支：\`${pr.ref}\`；改动 ${pr.changedFiles} 个文件，+${pr.additions} −${pr.deletions}`);
    const shown = pr.files.slice(0, DESCRIPTION_FILE_LIMIT);
    lines.push(`文件：${shown.map(file => `\`${file}\``).join("、") || "无"}${pr.files.length > shown.length ? `……（共 ${pr.files.length} 个）` : ""}`);
  }
  const body = item.body ? rewriteRefs(redactPersonalText(item.body), { owner, repo }) : "（原正文为空）";
  // 第一行的标记是去重依据（indexImported），来源链接也放在正文末尾，便于读完原文后回到出处
  return `${lines.join("\n")}\n\n---\n\n${body}\n\n来源：${item.url}`;
}

/**
 * 把 GitHub 的评论逐条补到 GitLab 议题上：第一行是原评论链接（去重依据），正文脱敏、裸 #编号改成链接。
 * 已有同链接标记的跳过，所以重跑只补漏的那几条，不重复。
 */
export async function migrateComments({ github, gitlab, owner, repo, number, iid }) {
  const comments = await github.list(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`);
  if (!comments.length) return 0;
  const notes = await gitlab.list(`/issues/${iid}/notes?per_page=100`);
  let added = 0;
  for (const comment of comments) {
    // 机器人留言（入口说明、回链）是本工具与入口工作流自己留的，不迁回 GitLab
    if (comment.user?.type === "Bot" || String(comment.body ?? "").startsWith("已迁到 GitLab：")) continue;
    if (notes.some(note => String(note.body ?? "").startsWith(`迁自 GitHub 评论：${comment.html_url}`))) continue;
    const head = [`迁自 GitHub 评论：${comment.html_url}`, `GitHub 原评论人：\`${comment.user?.login ?? "ghost"}\`，原时间 ${beijing(comment.created_at)}（北京时间）`, ""];
    const body = [...head, rewriteRefs(redactPersonalText(comment.body ?? ""), { owner, repo })].join("\n");
    const res = await gitlab.request("POST", `/issues/${iid}/notes`, { body: { body } });
    if (res.status !== 201) throw new Error(`GitLab 评论 HTTP ${res.status}`);
    added += 1;
  }
  return added;
}

/** 回链评论：指向 GitLab 的议题；一条 GitHub 条目只留一条 */
export function backlinkText({ gitlabWebUrl, gitlabIid }) {
  return `已迁到 GitLab：${gitlabWebUrl}（GitLab #${gitlabIid}）。之后在 GitLab 跟踪，这里关闭；GitHub 上不再继续讨论。`;
}

/**
 * 计划：只读。github 与 gitlab 是注入的客户端（测试替换成虚构响应）：
 *   github.list(path) 分页读；github.request(method, path) 读单个；
 *   gitlab.request(method, path) → { status, body }；gitlab.list(path) 分页读。
 */
export async function buildPlan({ github, gitlab, owner, repo }) {
  const openItems = await github.list(`/repos/${owner}/${repo}/issues?state=open&per_page=100`);
  const gitlabIssues = await gitlab.list("/issues?state=all&per_page=100");
  const imported = indexImported(gitlabIssues);
  const labelNames = new Set((await gitlab.list("/labels?per_page=100")).map(label => label.name));
  const users = new Map();
  const lookupUser = async login => {
    if (!users.has(login)) {
      const found = await gitlab.request("GET", `/users?username=${encodeURIComponent(login)}`);
      if (found.status !== 200) throw new Error(`GitLab 查询作者失败：HTTP ${found.status}，不按无同名账号建单`);
      users.set(login, matchGitlabUser(login, found.body));
    }
    return users.get(login);
  };
  const entries = [];
  for (const raw of openItems) {
    try {
      const isPr = Boolean(raw.pull_request);
      const number = raw.number;
      const url = `${GITHUB_ORIGIN}/${owner}/${repo}/issues/${number}`;
      const labels = (raw.labels ?? []).map(label => (typeof label === "string" ? label : label.name));
      const base = { number, kind: isPr ? "PR" : "issue", title: raw.title, url, state: "open", login: raw.user?.login ?? "ghost", createdAt: raw.created_at, labels, body: raw.body ?? "" };
      let pr = null;
      if (isPr) {
        const detail = await github.request("GET", `/repos/${owner}/${repo}/pulls/${number}`);
        pr = { ref: detail.head?.ref ?? null, additions: detail.additions ?? 0, deletions: detail.deletions ?? 0, changedFiles: detail.changed_files ?? 0 };
      }
      const skip = syncReason({ labels, headRef: pr?.ref ?? null });
      if (skip) {
        entries.push({ ...base, action: "skip", reason: skip });
        continue;
      }
      const existing = imported.get(url);
      if (existing) {
        entries.push({ ...base, action: "linked", gitlabIid: existing.iid, gitlabWebUrl: existing.web_url, author: null, labels: [] });
        continue;
      }
      let user;
      try {
        user = await lookupUser(base.login);
      } catch (error) {
        entries.push({ ...base, action: "error", reason: error.message });
        continue;
      }
      const filesLabels = labels.filter(label => labelNames.has(label));
      let files = [];
      if (pr) files = (await github.list(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`)).map(file => file.filename);
      entries.push({
        ...base, action: "create", labels: filesLabels, skippedLabels: labels.filter(label => !labelNames.has(label)),
        author: { login: base.login, gitlab: user ? { username: user.username, id: user.id } : null },
        pr: pr ? { ...pr, files } : null,
      });
    } catch (error) {
      // 一条查询失败不影响其它条目：这一条标为出错，执行时只报告它
      entries.push({ number: raw.number, kind: raw.pull_request ? "PR" : "issue", title: raw.title ?? "", url: `${GITHUB_ORIGIN}/${owner}/${repo}/issues/${raw.number}`, action: "error", reason: error.message });
    }
  }
  return { owner, repo, entries };
}

/** 计划里一条的一行说明（不含正文） */
export function describeEntry(entry) {
  const head = `#${entry.number} ${entry.kind}「${redactPersonalText(entry.title)}」`;
  if (entry.action === "skip") return `${head}  跳过：${entry.reason}`;
  if (entry.action === "error") return `${head}  出错，跳过，不建单：${entry.reason}`;
  if (entry.action === "linked") return `${head}  已在 GitLab #${entry.gitlabIid}：只补回链并关闭 GitHub 条目`;
  const who = entry.author.gitlab
    ? `作者 \`${entry.author.login}\` → GitLab \`${entry.author.gitlab.username}\`（按原作者建单）`
    : `作者 \`${entry.author.login}\` → 未对应（不用 Sudo，正文写明原作者）`;
  const dropped = entry.skippedLabels?.length ? `；标签未对上，未带过去：${entry.skippedLabels.join("、")}` : "";
  return `${head}  ${who}；建单后回链并关闭${dropped}`;
}

/**
 * 执行：每条独立。GitLab 建单失败就不碰 GitHub；建单成功但 GitHub 回链或关闭失败，下次重跑会按链接找到 GitLab 那张单，
 * 只补回链与关闭，不再建第二张。
 */
export async function applyPlan(plan, { github, gitlab, owner, repo, secrets = [] }) {
  const results = [];
  for (const entry of plan.entries) {
    try {
      if (entry.action === "skip") {
        results.push({ number: entry.number, status: "skipped", reason: entry.reason });
        continue;
      }
      if (entry.action === "error") {
        results.push({ number: entry.number, status: "failed", step: "plan", error: redactSecrets(entry.reason, secrets) });
        continue;
      }
      let gitlabIid = entry.gitlabIid ?? null;
      let gitlabWebUrl = entry.gitlabWebUrl ?? null;
      let timeKept = null;
      if (entry.action === "create") {
        const headers = entry.author.gitlab ? { sudo: entry.author.gitlab.username } : {};
        // created_at 让 GitLab 保留 GitHub 的原始创建时间（需要管理员或项目所有者令牌）；竞赛收集器按这个时间算窗口
        const payload = { title: redactPersonalText(entry.title), description: buildDescription({ item: entry, owner, repo, author: entry.author, pr: entry.pr }), created_at: entry.createdAt };
        if (entry.labels.length) payload.labels = entry.labels.join(",");
        const created = await gitlab.request("POST", "/issues", { ...headers, body: payload });
        if (created.status !== 201 || !created.body?.iid) {
          results.push({ number: entry.number, status: "failed", step: "gitlab-create", error: redactSecrets(`GitLab HTTP ${created.status}`, secrets) });
          continue;
        }
        gitlabIid = created.body.iid;
        gitlabWebUrl = created.body.web_url;
        timeKept = Math.abs(Date.parse(created.body.created_at) - Date.parse(entry.createdAt)) < 60_000;
      }
      try {
        await migrateComments({ github, gitlab, owner, repo, number: entry.number, iid: gitlabIid });
      } catch (error) {
        results.push({ number: entry.number, status: "failed", step: "gitlab-note", gitlabIid, error: redactSecrets(error.message, secrets) });
        continue;
      }
      try {
        const comments = await github.list(`/repos/${owner}/${repo}/issues/${entry.number}/comments?per_page=100`);
        if (!comments.some(comment => String(comment.body ?? "").includes(gitlabWebUrl))) {
          await github.request("POST", `/repos/${owner}/${repo}/issues/${entry.number}/comments`, { body: backlinkText({ gitlabWebUrl, gitlabIid }) });
        }
      } catch (error) {
        results.push({ number: entry.number, status: "failed", step: "github-backlink", gitlabIid, error: redactSecrets(error.message, secrets) });
        continue;
      }
      try {
        await github.request("PATCH", `/repos/${owner}/${repo}/issues/${entry.number}`, { state: "closed" });
      } catch (error) {
        results.push({ number: entry.number, status: "failed", step: "github-close", gitlabIid, error: redactSecrets(error.message, secrets) });
        continue;
      }
      results.push({ number: entry.number, status: entry.action === "create" ? "created" : "linked", gitlabIid, gitlabWebUrl, ...(entry.action === "create" ? { timeKept } : {}) });
    } catch (error) {
      // 每条独立：这一条抛错只记为它失败，其余条目照常执行
      results.push({ number: entry.number, status: "failed", step: "unexpected", error: redactSecrets(error.message, secrets) });
    }
  }
  return results;
}

/** GitHub 客户端：通过 gh api 读写（凭据是 gh 已登录的），失败抛错，错误带的 stderr 已脱敏 */
export function ghClient({ run = ghApi, secrets = [] } = {}) {
  const request = (method, path, body) => {
    const text = run(method, path, body, secrets);
    return text ? JSON.parse(text) : null;
  };
  return {
    request,
    async list(path) {
      const out = [];
      const sep = path.includes("?") ? "&" : "?";
      for (let page = 1; page < 200; page++) {
        const chunk = request("GET", `${path}${sep}page=${page}`);
        if (!Array.isArray(chunk)) throw new Error(`GitHub 列表返回不是数组：${path.split("?")[0]}`);
        out.push(...chunk);
        if (chunk.length < 100) break;
      }
      return out;
    },
  };
}

function ghApi(method, path, body, secrets) {
  const args = ["api", "--method", method, path];
  if (body !== undefined) args.push("--input", "-");
  try {
    return execFileSync("gh", args, { encoding: "utf8", input: body === undefined ? undefined : JSON.stringify(body), stdio: ["pipe", "pipe", "pipe"], env: repoNeutralEnv(), maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    throw new Error(redactSecrets(`gh api ${method} ${path.split("?")[0]} 失败：${String(error.stderr ?? error.message).trim()}`, secrets));
  }
}

/** GitLab 客户端：令牌只进请求头；Sudo 头只在要按原作者建单时才带 */
export function gitlabClient({ base, project, token, fetchImpl = fetch }) {
  const api = `${base}/api/v4/projects/${encodeURIComponent(project)}`;
  const userApi = `${base}/api/v4`;
  const request = async (method, path, { sudo, body } = {}) => {
    const url = path.startsWith("/users") ? `${userApi}${path}` : `${api}${path}`;
    const headers = { "PRIVATE-TOKEN": token, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(sudo ? { Sudo: sudo } : {}) };
    const res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };
  return {
    request,
    async list(path) {
      const out = [];
      const sep = path.includes("?") ? "&" : "?";
      for (let page = 1; page < 200; page++) {
        const res = await request("GET", `${path}${sep}page=${page}`);
        if (res.status !== 200 || !Array.isArray(res.body)) throw new Error(`GitLab GET ${path.split("?")[0]} 第 ${page} 页 HTTP ${res.status}`);
        out.push(...res.body);
        if (res.body.length < 100) break;
      }
      return out;
    },
  };
}

/** 文字输出：计划与执行结果，不含正文 */
export function formatPlan(plan) {
  const lines = [`GitHub → GitLab 导入（${plan.apply ? "执行" : "演算，未写任何东西；加 --apply 才写"}）`, `源：${plan.owner}/${plan.repo}（GitHub） → ${plan.project}（GitLab）`, ""];
  for (const entry of plan.entries) lines.push(describeEntry(entry));
  const counts = { create: 0, linked: 0, skip: 0 };
  for (const entry of plan.entries) counts[entry.action] += 1;
  const issues = plan.entries.filter(entry => entry.action === "create" && entry.kind === "issue").length;
  const prs = plan.entries.filter(entry => entry.action === "create" && entry.kind === "PR").length;
  lines.push("", `合计：要导入 ${counts.create} 个（issue ${issues}、PR ${prs}）；已在 GitLab ${counts.linked} 个；跳过 ${counts.skip} 个。`);
  return lines.join("\n");
}

export function formatResults(results) {
  return results.map(result => {
    if (result.status === "skipped") return `#${result.number} 跳过：${result.reason}`;
    if (result.status === "failed") return `#${result.number} 失败（${result.step}）：${result.error}${result.gitlabIid ? `；GitLab #${result.gitlabIid} 已建，GitHub 未关，重跑会补齐` : "；GitHub 未动"}`;
    const warning = result.timeKept === false ? "；创建时间没有保留（令牌可能不是管理员），竞赛窗口会按导入时间计" : "";
    return `#${result.number} ${result.status === "created" ? "已导入" : "已补齐"} → GitLab #${result.gitlabIid} ${result.gitlabWebUrl}${warning}`;
  }).join("\n");
}

/** 命令行入口。默认只读；--apply 才写。退出码：0 全部成功或无事可做；1 有失败；2 用法或配置错误 */
export async function main(argv, { root = process.cwd(), env = process.env, github, gitlab, out = console.log, err = console.error, readToken = ({ host }) => gitlabToken({ env, host }) } = {}) {
  const flags = new Set(argv);
  const unknown = [...flags].filter(flag => flag !== "--apply");
  if (unknown.length) {
    err(`未知参数：${unknown.join(" ")}。用法：node scripts/github-import.mjs [--apply]`);
    return 2;
  }
  const repos = resolveRepos(root, env);
  if (!repos.owner || !repos.repo || !repos.project || !repos.base) {
    err("没找到两端仓库：需要 origin（GitHub）与 gitlab 两个 remote，或设 GEEK_GITHUB_REPO=owner/repo、GEEK_GITLAB_URL、GEEK_GITLAB_PROJECT。");
    return 2;
  }
  const token = env.GITLAB_TOKEN?.trim() || readToken({ host: new URL(repos.base).host });
  if (!token) {
    err("GitLab 没有令牌：设 GITLAB_TOKEN，或在 macOS 钥匙串里放 GitLab 主机名下的令牌。");
    return 2;
  }
  if (!secureBase(repos.base)) {
    err(`GitLab 地址必须是 https（现在是 ${repos.base}）：令牌不发给明文地址。`);
    return 2;
  }
  const secrets = [token];
  const githubApi = github ?? ghClient({ secrets });
  const gitlabApi = gitlab ?? gitlabClient({ base: repos.base, project: repos.project, token });
  const plan = await buildPlan({ github: githubApi, gitlab: gitlabApi, owner: repos.owner, repo: repos.repo });
  plan.project = repos.project;
  plan.apply = flags.has("--apply");
  out(redactSecrets(formatPlan(plan), secrets));
  if (!plan.apply) return 0;
  const results = await applyPlan(plan, { github: githubApi, gitlab: gitlabApi, owner: repos.owner, repo: repos.repo, secrets });
  out(redactSecrets(formatResults(results), secrets));
  return results.some(result => result.status === "failed") ? 1 : 0;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
    process.exitCode = 2;
  });
}
