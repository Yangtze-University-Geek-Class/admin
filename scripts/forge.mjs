// 代码托管适配：task.mjs 只通过这里问 issue 与 MR/PR 的状态、留开工记录、取 stage 的引用（docs/conventions/BRANCHING.md「task worktree」）。
//   GitLab（主用，正式站点的 /gitlab，项目 geek/admin）：REST API，令牌放在 PRIVATE-TOKEN 请求头里。
//   GitHub（历史）：gh 命令行。
//   选择：GEEK_FORGE=gitlab|github 强制；缺省时本机有名为 gitlab 的 remote 用 GitLab，否则用 GitHub。
//   GitLab 地址：GEEK_GITLAB_URL，缺省由 gitlab remote 的 URL 推出（https://<host>，装在 /gitlab 子路径下时带上这一段）；项目：GEEK_GITLAB_PROJECT，缺省取 remote 的路径。
//   令牌：GITLAB_TOKEN；macOS 上没有时读钥匙串 security find-internet-password -s <host> -w。令牌只进请求头，不打印、不上命令行。
//   查不到（离线、没有令牌、没登录、超时）一律返回 null / known: false，由调用方决定是拦还是只警告。
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

export const FORGES = ["gitlab", "github"];
/** 每个 GitLab 请求最多等这么久：离线时 pre-push 不能一直挂着 */
export const GITLAB_TIMEOUT_MS = 15_000;
/** 每个 gh 调用最多等这么久 */
const GH_TIMEOUT_MS = 20_000;
const execFileAsync = promisify(execFile);

/** 选择代码托管：GEEK_FORGE 强制；否则有 gitlab remote 就用 GitLab，没有就用 GitHub */
export function selectForge({ env = process.env, hasGitlabRemote = false } = {}) {
  const forced = String(env.GEEK_FORGE ?? "").trim().toLowerCase();
  if (forced) {
    if (!FORGES.includes(forced)) throw new Error(`GEEK_FORGE 只能是 gitlab 或 github，收到 ${JSON.stringify(env.GEEK_FORGE)}`);
    return forced;
  }
  return hasGitlabRemote ? "gitlab" : "github";
}

function stripGit(path) {
  return path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
}

/** GitLab 装在站点子路径下时的那一段（#335：正式与预发布都在 /gitlab），属于地址，不属于项目路径 */
const GITLAB_RELATIVE_ROOT = "gitlab";

/** 从 git remote 的 URL 推出 { base, path }：https://host[:port][/gitlab]/a/b.git、ssh://[user@]host[:port]/a/b.git、[user@]host:a/b.git；认不出返回 null */
export function parseRemoteUrl(url) {
  const text = String(url ?? "").trim().replace(/\/+$/, "");
  const web = /^(https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/.exec(text);
  if (web) {
    const [first, ...rest] = stripGit(web[3]).split("/");
    // 至少还剩「组/项目」两段才算子路径，免得把名叫 gitlab 的组当成地址
    if (first === GITLAB_RELATIVE_ROOT && rest.length >= 2) return { base: `${web[1]}://${web[2]}/${first}`, path: rest.join("/") };
    return { base: `${web[1]}://${web[2]}`, path: stripGit(web[3]) };
  }
  // ssh 的端口是 SSH 端口，不是 HTTP 端口，推出的地址只取主机名
  const ssh = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(text) ?? /^(?:[^@/]+@)?([^/:]+):(?!\/\/)(.+)$/.exec(text);
  if (ssh) return { base: `https://${ssh[1]}`, path: stripGit(ssh[2]) };
  return null;
}

/** 令牌：GITLAB_TOKEN 优先；macOS 上再读钥匙串。取不到返回 null，不报错，也不打印。 */
export function gitlabToken({ env = process.env, host, platform = process.platform } = {}) {
  const fromEnv = String(env.GITLAB_TOKEN ?? "").trim();
  if (fromEnv) return fromEnv;
  if (platform !== "darwin" || !host) return null;
  try {
    return execFileSync("security", ["find-internet-password", "-s", host, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 }).trim() || null;
  } catch {
    return null;
  }
}

/** GitLab 的 issue 状态映射到 decideCleanup 用的写法：opened → OPEN，closed → CLOSED */
export function gitlabIssueState(issue) {
  if (issue?.state === "opened") return "OPEN";
  if (issue?.state === "closed") return "CLOSED";
  return null;
}

/** GitLab 的 MR 状态映射到 PR 的写法：merged → MERGED；opened 与 locked（正在合并）→ OPEN；closed → CLOSED */
export function gitlabReviewState(mr) {
  if (mr?.state === "merged") return "MERGED";
  if (mr?.state === "closed") return "CLOSED";
  return "OPEN";
}

/** GitLab 的 issue 原始数据 → { number, title, state, labels: [{ name }], body }，与 GitHub 的 gh 输出同形 */
export function normalizeGitLabIssue(raw) {
  return {
    number: Number(raw.iid),
    title: raw.title ?? "",
    state: gitlabIssueState(raw),
    labels: (raw.labels ?? []).map((label) => ({ name: typeof label === "string" ? label : label?.name })),
    body: raw.description ?? "",
  };
}

/**
 * 同一条分支可能有几个 MR（关了重开、改过目标分支）：只看编号最大（最新）的那个。
 * 旧的已合并、新的还开着时，新提交还没合进去，按「已合并」清理会把它们丢掉。target 是它要合进的分支。
 * @returns {{ state: "MERGED" | "OPEN" | "CLOSED" | null, number: number | null, target: string | null }}
 */
export function pickReview(mrs) {
  const latest = [...(mrs ?? [])].sort((a, b) => Number(b.iid) - Number(a.iid))[0];
  return latest ? { state: gitlabReviewState(latest), number: Number(latest.iid), target: latest.target_branch ?? null } : { state: null, number: null, target: null };
}

/**
 * 从 worktree 推送时 git 给 pre-push 导出 GIT_DIR 等变量：带着它们 `git -C <别的目录>` 会读推送方的仓库与索引。
 * 子进程去掉 git 自己列出的这些「本仓库」变量（git rev-parse --local-env-vars）。
 */
let localEnvVars = null;
export function repoNeutralEnv(env = process.env) {
  localEnvVars ??= execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  const next = { ...env };
  for (const key of localEnvVars) delete next[key];
  return next;
}

export function gitConfig(root, key) {
  try {
    return execFileSync("git", ["-C", root, "config", "--get", key], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: repoNeutralEnv() }).trim() || null;
  } catch {
    return null;
  }
}

/** 令牌只发给 https 地址；明文 http 只认本机回环（测试替身） */
export function secureBase(base) {
  return /^https:\/\//i.test(base) || /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(base);
}

/** 从 git remote 推出两端的仓库：GitHub 取 origin，GitLab 取 gitlab；环境变量可覆盖（GEEK_GITHUB_REPO、GEEK_GITLAB_URL、GEEK_GITLAB_PROJECT） */
export function resolveRepos(root, env = process.env, gitConfigGet = gitConfig) {
  const githubRepo = env.GEEK_GITHUB_REPO ?? parseRemoteUrl(gitConfigGet(root, "remote.origin.url"))?.path ?? "";
  const gitlabRemote = parseRemoteUrl(gitConfigGet(root, "remote.gitlab.url"));
  const base = String(env.GEEK_GITLAB_URL || gitlabRemote?.base || "").replace(/\/+$/, "");
  const project = String(env.GEEK_GITLAB_PROJECT || gitlabRemote?.path || "");
  const [owner, repo] = githubRepo.split("/");
  return { owner, repo, base, project };
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: repoNeutralEnv() }).trim();
}

/** gh 调用：失败（离线、没登录、超时）返回 null；非超时、非没装 gh 的失败再试一次 */
async function gh(args, attempt = 1) {
  try {
    const { stdout } = await execFileAsync("gh", args, { encoding: "utf8", timeout: GH_TIMEOUT_MS, env: repoNeutralEnv() });
    return stdout.trim();
  } catch (error) {
    if (attempt < 2 && !error?.killed && error?.code !== "ENOENT") return gh(args, attempt + 1);
    return null;
  }
}

function githubForge(root) {
  return {
    name: "github",
    label: "gh",
    remote: "origin",
    stageRef: "origin/stage",
    missing: () => "",
    fetchStage() {
      git(root, ["fetch", "--quiet", "origin", "stage"]);
    },
    async issueState(issue) {
      return (await gh(["issue", "view", String(issue), "--json", "state", "--jq", ".state"])) || null;
    },
    async issueDetail(issue) {
      try {
        return JSON.parse((await gh(["issue", "view", String(issue), "--json", "number,labels,body"])) ?? "null");
      } catch {
        return null;
      }
    },
    /** 这条分支最近一个 PR：{ state, number, target, ref, known }；known 为 false 表示没查到，查到但没有 PR 时 state 为 null */
    async review(branch) {
      const out = await gh(["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", "state,number,baseRefName", "--jq", '.[0] // {} | "\\(.state // "") \\(.number // "") \\(.baseRefName // "")"']);
      if (out === null) return { state: null, number: null, target: null, ref: null, known: false };
      const [state, number, target] = out.split(" ");
      return { state: state || null, number: number ? Number(number) : null, target: target || null, ref: number ? `#${number}` : null, known: true };
    },
    async comment(issue, body) {
      return (await gh(["issue", "comment", String(issue), "--body", body])) !== null;
    },
  };
}

function gitlabForge(root, env, remoteUrl) {
  const parsed = parseRemoteUrl(remoteUrl);
  const base = String(env.GEEK_GITLAB_URL || parsed?.base || "").trim().replace(/\/+$/, "");
  const project = String(env.GEEK_GITLAB_PROJECT || parsed?.path || "").trim();
  // 令牌放在请求头里：只发给 https 地址；明文 http 只认本机回环（测试替身），别的一律不配
  const secure = /^https:\/\//i.test(base) || /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(base);
  const configured = Boolean(base && project && secure);
  const api = configured ? `${base}/api/v4/projects/${encodeURIComponent(project)}` : null;
  // 令牌延后到第一次真正要查询时才读（钥匙串），没有 task worktree 的推送不碰钥匙串
  let tokenValue;
  const token = () => {
    if (tokenValue === undefined) {
      let host = null;
      try {
        host = new URL(base).host;
      } catch {
        host = null;
      }
      tokenValue = configured ? gitlabToken({ env, host }) : null;
    }
    return tokenValue;
  };

  /** 调 GitLab API；令牌只进请求头。查不到返回 null。只有 GET 在网络错误与 5xx 时再试一次，写操作不重试，免得留下两条记录。 */
  async function call(method, path, body, attempt = 1) {
    const key = token();
    if (!api || !key) return null;
    const retry = () => (method === "GET" && attempt < 2 ? call(method, path, body, attempt + 1) : null);
    try {
      const res = await fetch(`${api}${path}`, {
        method,
        headers: { "PRIVATE-TOKEN": key, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(GITLAB_TIMEOUT_MS),
        // 重定向时 fetch 会把自定义请求头带到新地址：不跟，令牌只发给配置的那一个地址
        redirect: "error",
      });
      if (res.status >= 500) return retry();
      if (!res.ok) return null;
      return await res.json();
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") return null;
      return retry();
    }
  }

  return {
    name: "gitlab",
    label: "GitLab",
    remote: "gitlab",
    stageRef: "gitlab/stage",
    /** 查不到时告诉用户缺什么；有地址和令牌时返回空串 */
    missing() {
      if (base && !secure) return `GitLab 地址必须是 https（现在是 ${base}）：令牌不发给明文地址`;
      if (!configured) return "GitLab 地址或项目路径没配：在 gitlab remote 上配好，或设 GEEK_GITLAB_URL / GEEK_GITLAB_PROJECT";
      if (!token()) return "GitLab 没有令牌：设环境变量 GITLAB_TOKEN，或在 macOS 钥匙串里放 GitLab 主机名下的令牌";
      return "";
    },
    fetchStage() {
      if (!gitConfig(root, "remote.gitlab.url")) throw new Error("没有名为 gitlab 的 remote：git remote add gitlab <正式站点>/gitlab/geek/admin.git");
      git(root, ["fetch", "--quiet", "gitlab", "stage"]);
    },
    async issueDetail(issue) {
      const raw = await call("GET", `/issues/${Number(issue)}`);
      return raw ? normalizeGitLabIssue(raw) : null;
    },
    async issueState(issue) {
      const raw = await call("GET", `/issues/${Number(issue)}`);
      return raw ? gitlabIssueState(raw) : null;
    },
    async review(branch) {
      const mrs = await call("GET", `/merge_requests?${new URLSearchParams({ source_branch: branch, state: "all", per_page: "100" })}`);
      if (!Array.isArray(mrs)) return { state: null, number: null, target: null, ref: null, known: false };
      const picked = pickReview(mrs);
      return { ...picked, ref: picked.number ? `!${picked.number}` : null, known: true };
    },
    async comment(issue, body) {
      return (await call("POST", `/issues/${Number(issue)}/notes`, { body })) !== null;
    },
  };
}

/**
 * 按环境选定代码托管，返回适配对象：
 *   name / label（显示用）/ remote（git remote 名）/ stageRef（开工从哪里拉）
 *   fetchStage()、issueState(n)、issueDetail(n)、review(branch)（返回带 ref 的 !编号或 #编号）、comment(n, body)、missing()
 * @param {string} root 主工作区根目录（读 gitlab remote 用）
 */
export function createForge(root, env = process.env) {
  const gitlabUrl = gitConfig(root, "remote.gitlab.url");
  const name = selectForge({ env, hasGitlabRemote: gitlabUrl !== null });
  return name === "gitlab" ? gitlabForge(root, env, gitlabUrl) : githubForge(root);
}
