import type Database from "better-sqlite3";
import type { AuditActor } from "./db.js";
import type { ActivityOutcome, ActivitySurface } from "./activity.js";
import type { DirectoryAccount } from "./account-directory.js";

/**
 * GitLab 账号同步（#270）：每个是成员的极客班账号在自建 GitLab 上有一个用户，进 `GITLAB_GROUP` 组（舰员 Developer，提督 Owner）；
 * 停用或不再是成员的封禁（block），恢复后解封，从不删除。GitLab 用户按 OIDC 身份（provider = openid_connect，extern_uid =
 * 这个账号在 GitLab 那个客户端的 sector 里的 `sub`）认人，不按用户名或邮箱认。用户名在第一次同步时定下：有 GitHub 的用 GitHub 登录名，
 * 没有的用站内登录名（yz_…），被占用或是保留名时加后缀，之后不再改名。
 * 头像（#271）：论坛上传的头像优先，没有时用 GitHub 头像；GitLab 收下后记下来源（avatar_source），来源变了再传，传失败下一轮再试。
 * 还没记过来源的（以前建的号、GitLab 在登录时自动建的号）会传一次，盖掉 GitLab 上原来的头像。
 * 邮箱（#272）：GitLab 按提交里的作者邮箱认人，只认用户名下已确认的邮箱。主邮箱写成 GitLab 的主邮箱，其它绑定的邮箱和 GitHub 给的
 * noreply 邮箱以「已确认」加到用户名下（GitLab 没配发信，成员自己加的邮箱确认不了）；在极客班删掉的从 GitLab 删掉。
 * 记下同步过去的邮箱（emails_source），变了再同步，失败下一轮再试。
 * 只有这个模块读写 gitlab_accounts；`mode` 为 dry-run 时只算出要做什么，不写表、不改 GitLab。
 */
export const GITLAB_OIDC_PROVIDER = "openid_connect";
/** GitLab 组成员的权限级别：Developer 30，Owner 50。 */
export const GITLAB_ACCESS = { developer: 30, owner: 50 } as const;
/** on 模式下每 10 分钟对一次账（启动时先对一次）。 */
export const GITLAB_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
/** GitLab 只收 200 KiB 以内的头像，超过回 400。 */
const AVATAR_MAX_BYTES = 200 * 1024;
/** 向 GitHub 要的头像边长（像素），原图常常超过 GitLab 的上限。 */
const GITHUB_AVATAR_SIZE = 256;
const AVATAR_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
/** avatar_source 里论坛头像的写法：前缀加图的散列；GitHub 头像直接写地址。 */
const FORUM_AVATAR_PREFIX = "forum:";
const GITHUB_AVATAR_BASE = "https://avatars.githubusercontent.com/";
const GITHUB_NOREPLY_DOMAIN = "users.noreply.github.com";
/** 没有验证过的邮箱、或邮箱在 GitLab 上被占用时，建号用的占位地址。 */
const placeholderEmail = (username: string, sectorId: string) => `${username.toLowerCase()}@noreply.${sectorId}`;
/** GitLab 不让用、或者会和路由撞上的用户名，碰到直接加后缀，不用等 GitLab 拒绝。 */
const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "ghost", "support", "support-bot", "alert-bot", "security-bot", "automation-bot", "api", "help",
  "explore", "groups", "users", "dashboard", "projects", "snippets", "search", "import", "oauth", "public", "profile", "assets", "uploads",
]);

export type GitlabSyncConfig = { mode: "off" | "dry-run" | "on"; url: string | null; token: string | null; group: string; clientId: string };
export type GitlabSyncSettings = { mode: GitlabSyncConfig["mode"]; group: string; interval_minutes: number };

export function readGitlabSyncSettings(db: Database.Database): Partial<GitlabSyncSettings> | null {
  const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get("gitlab_settings") as { value: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.value) as Partial<GitlabSyncSettings>; } catch { return null; }
}

/** 只改持久值。运行中的实例仍须 applySettings()；离线运维必须先停实例，再写入并重启。 */
export function writeGitlabSyncSettings(db: Database.Database, settings: GitlabSyncSettings): void {
  db.prepare("INSERT INTO app_state(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run("gitlab_settings", JSON.stringify(settings), Date.now());
}
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type SyncAction =
  | { kind: "create"; username: string; access_level: number }
  | { kind: "block" }
  | { kind: "find_and_block" }
  | { kind: "unblock" }
  | { kind: "set_access"; access_level: number }
  | { kind: "set_avatar" }
  | { kind: "set_emails" };
export type GitlabAccountState = "pending" | "active" | "blocked";
export type GitlabAccountRow = {
  account_id: string; gitlab_user_id: number | null; username: string; state: GitlabAccountState; access_level: number | null;
  avatar_source: string | null; emails_source: string | null; last_error: string | null; last_error_at: number | null; synced_at: number | null; created_at: number; updated_at: number;
};
export type SyncOutcome = { account_id: string; login: string; actions: SyncAction[]; applied: boolean; error: string | null };
/** `skipped` 不为空时这一轮没做：GitLab 的客户端还没登记（gitlab_client_missing）。 */
export type SyncSummary = { mode: GitlabSyncConfig["mode"]; accounts: number; changed: number; failed: number; skipped: string | null; outcomes: SyncOutcome[] };
export type SyncLogger = { info(details: Record<string, unknown>, message: string): void; error(details: Record<string, unknown>, message: string): void };
/** 上一轮全量对账的小结（#274 控制台概览用），进程重启后清空。 */
export type LastRun = { at: number; changed: number; failed: number };
export type GitlabGroupInfo = { id: number; full_path: string; name: string; visibility: string };
export type GitlabProjectInfo = {
  id: number; path_with_namespace: string; name: string; description: string | null; visibility: string;
  web_url: string; http_url_to_repo: string; ssh_url_to_repo: string; last_activity_at: string | null; star_count: number;
};
/** `available`：false 表示没配 URL、连不上或 GitLab 拒绝了请求——这时 groups/projects 一定是空的，但空也可能只是真的没有项目。 */
export type GitlabProjectsSummary = { groups: GitlabGroupInfo[]; projects: GitlabProjectInfo[]; available: boolean };

class SyncError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SyncError"; }
}

/** 按 GitLab 的用户名规则整理：只留字母、数字、_、-、.，不以 - 或 . 开头，不以 . 结尾，最长 60。 */
export function gitlabUsername(base: string): string {
  const cleaned = base.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^[-.]+/, "").replace(/\.+$/, "").replace(/\.(git|atom)$/i, "_$1").slice(0, 60);
  return cleaned || "member";
}

export function createGitlabSync(db: Database.Database, deps: {
  config: GitlabSyncConfig;
  directory: { listForSync(): DirectoryAccount[]; account(accountId: string): DirectoryAccount | null };
  subjects: { subjectFor(sectorId: string, accountId: string): string; existingSubject(sectorId: string, accountId: string): string | null };
  clients: { sectorOf(clientId: string): string | null };
  avatars: { avatar(hash: string): Buffer | null };
  audit: (actor: AuditActor, action: string, target?: string, details?: unknown, ip?: string, opts?: { surface?: ActivitySurface; outcome?: ActivityOutcome }) => void;
  fetch?: FetchLike;
  githubFetch?: FetchLike;
  clock?: () => number;
}) {
  // 可变：控制台「GitLab 设置」（#274）能在运行时改 mode、group、对账间隔，存在 app_state（键 gitlab_settings），
  // 重启后从这里读回来盖在 env 的初始值上；令牌只读 env，不在这里改、不持久化。
  const persisted = readGitlabSyncSettings(db);
  let config = { ...deps.config, ...(persisted?.mode !== undefined ? { mode: persisted.mode } : {}), ...(persisted?.group !== undefined ? { group: persisted.group } : {}) };
  let intervalMs = persisted?.interval_minutes !== undefined ? persisted.interval_minutes * 60_000 : GITLAB_SYNC_INTERVAL_MS;
  const clock = deps.clock ?? Date.now;
  const fetchGitlab = deps.fetch ?? fetch;
  const fetchGithub = deps.githubFetch ?? fetch;
  // sector 不取 GITLAB_URL 的主机，免得它和签发者给 GitLab 的 sub 对不上；客户端还没登记时为 null，这时 on 模式整轮跳过
  const sector = () => deps.clients.sectorOf(config.clientId);
  const selectRow = db.prepare("SELECT * FROM gitlab_accounts WHERE account_id = ?");
  const usernameTaken = db.prepare("SELECT 1 FROM gitlab_accounts WHERE username = ? COLLATE NOCASE AND account_id <> ?");

  const rowOf = (accountId: string) => selectRow.get(accountId) as GitlabAccountRow | undefined;
  const wantedAccess = (account: DirectoryAccount) => account.site_role === "admin" ? GITLAB_ACCESS.owner : GITLAB_ACCESS.developer;
  const wanted = (account: DirectoryAccount) => account.status === "active" && account.member;

  function assertCurrent(account: DirectoryAccount): void {
    const current = deps.directory.account(account.account_id);
    if (!current || current.status !== account.status || current.member !== account.member || current.site_role !== account.site_role) {
      throw new SyncError("gitlab_account_changed");
    }
  }

  function writeApi(account: DirectoryAccount, method: string, path: string, body?: Record<string, unknown> | FormData) {
    assertCurrent(account);
    return gitlab(method, path, body);
  }

  /** 第一次同步时的用户名：GitHub 登录名或站内登录名；保留名或已被别的账号占用时依次加 _yz、_yz2……。 */
  function freeUsername(account: DirectoryAccount, avoid: Set<string> = new Set()): string {
    const base = gitlabUsername(account.github?.login ?? account.handle ?? account.login);
    const blocked = (name: string) => RESERVED_USERNAMES.has(name.toLowerCase()) || name.toLowerCase() === config.group.toLowerCase()
      || avoid.has(name.toLowerCase()) || Boolean(usernameTaken.get(name, account.account_id));
    if (!blocked(base)) return base;
    for (let n = 1; ; n++) {
      const candidate = `${base.slice(0, 54)}_yz${n === 1 ? "" : n}`;
      if (!blocked(candidate)) return candidate;
    }
  }

  /** 头像从哪来：论坛上传的头像（forum:<散列>），否则 GitHub 头像（没记下地址时按 GitHub 数字 id 拼）；都没有为 null。 */
  function avatarSource(account: DirectoryAccount): string | null {
    if (account.profile?.avatarHash) return `${FORUM_AVATAR_PREFIX}${account.profile.avatarHash}`;
    if (!account.github) return null;
    const url = account.github.avatar_url;
    return url?.startsWith(GITHUB_AVATAR_BASE) ? url : `${GITHUB_AVATAR_BASE}u/${account.github.id}`;
  }

  /**
   * GitLab 上要有的邮箱（都转小写）：主邮箱（没有时为 null，GitLab 上留着建号时的占位地址），其它绑定的邮箱加上 GitHub noreply 邮箱。
   * GitHub 的 noreply 邮箱有按数字 id 的新式和按登录名的旧式两种，在 GitHub 网页上提交、或者打开了邮箱保护时提交里用的就是它。
   */
  type WantedEmails = { primary: string | null; others: string[] };
  function wantedEmails(account: DirectoryAccount): WantedEmails {
    const primary = account.email?.toLowerCase() ?? null;
    const noreply = account.github ? [`${account.github.id}+${account.github.login}@${GITHUB_NOREPLY_DOMAIN}`, `${account.github.login}@${GITHUB_NOREPLY_DOMAIN}`] : [];
    const others = new Set([...account.emails, ...noreply].map(email => email.toLowerCase()));
    if (primary) others.delete(primary);
    return { primary, others: [...others].sort() };
  }
  /** emails_source 的写法：plan() 比较和 setEmails() 记录都用它，键的顺序和排序一致才能按字符串比较。 */
  const emailsJson = (emails: WantedEmails) => JSON.stringify({ primary: emails.primary, others: [...emails.others].sort() });
  const emailsSource = (account: DirectoryAccount) => emailsJson(wantedEmails(account));

  /**
   * 这个账号现在要做什么（不碰 GitLab）。是成员、还没建号的建号；建过的按成员资格封禁或解封、调组权限。
   * 是成员、有头像来源、和上次传上去的来源不同（包括从没传过）时传头像；要有的邮箱和上次同步过去的不同（包括从没同步过）时同步邮箱。
   * 不是成员、也没有对上 GitLab 用户的：只要他在 GitLab 的 sector 有过 `sub`（用极客班登录过 GitLab，GitLab 可能已经自动建了号，
   * 例如同步关着时、或者在下一轮对账之前），每一轮都去 GitLab 按身份找，找到就封禁。找不到也不记「找过了」：他可能回来、
   * 用极客班登录一次（GitLab 又自动建号）、在下一轮之前又离开。这类账号很少，每人每轮一次只读请求。
   */
  function plan(account: DirectoryAccount): SyncAction[] {
    const row = rowOf(account.account_id);
    const access = wantedAccess(account);
    const avatar = avatarSource(account);
    if (!row || row.state === "pending" || row.gitlab_user_id === null) {
      if (wanted(account)) {
        const actions: SyncAction[] = [{ kind: "create", username: row?.username ?? freeUsername(account), access_level: access }];
        if (avatar) actions.push({ kind: "set_avatar" });
        if (emailsSource(account) !== row?.emails_source) actions.push({ kind: "set_emails" });
        return actions;
      }
      const sectorId = sector();
      return sectorId && deps.subjects.existingSubject(sectorId, account.account_id) ? [{ kind: "find_and_block" }] : [];
    }
    if (!wanted(account)) return row.state === "blocked" ? [] : [{ kind: "block" }];
    const actions: SyncAction[] = [];
    if (row.state === "blocked") actions.push({ kind: "unblock" });
    if (row.access_level !== access) actions.push({ kind: "set_access", access_level: access });
    if (avatar && avatar !== row.avatar_source) actions.push({ kind: "set_avatar" });
    if (emailsSource(account) !== row.emails_source) actions.push({ kind: "set_emails" });
    return actions;
  }

  async function gitlab(method: string, path: string, body?: Record<string, unknown> | FormData): Promise<{ status: number; data: unknown; nextPage: number | null }> {
    const form = body instanceof FormData;
    let res: Response;
    try {
      res = await fetchGitlab(`${config.url}/api/v4${path}`, {
        method,
        headers: { "PRIVATE-TOKEN": config.token ?? "", Accept: "application/json", ...(body && !form ? { "Content-Type": "application/json" } : {}) },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
        // 不跟随跳转：跳到别的源时管理员令牌会跟着过去
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new SyncError("gitlab_unreachable");
    }
    const text = await res.text().catch(() => "");
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    const rawNext = res.headers.get("x-next-page") ?? "";
    if (rawNext && !/^[1-9]\d*$/.test(rawNext)) throw new SyncError("gitlab_pagination_incomplete");
    const next = Number(rawNext);
    return { status: res.status, data, nextPage: Number.isInteger(next) && next > 0 ? next : null };
  }

  /**
   * 只读的 GitLab 接口（#278 比赛贡献收集用）：同一个管理令牌、同一个请求函数（不跟随跳转、15 秒超时），只发 GET。
   * 没配 URL 或令牌时抛 gitlab_not_configured，连不上抛 gitlab_unreachable（都是 SyncError，`code` 可读）。
   */
  async function readApi(path: string): Promise<{ status: number; data: unknown; nextPage: number | null }> {
    if (!config.url || !config.token) throw new SyncError("gitlab_not_configured");
    return gitlab("GET", path);
  }

  /** POST /users 被拒的原因：用户名或邮箱已被占用（409），或者用户名不合规则、是保留名（400）。 */
  function conflictOf(result: { status: number; data: unknown }): "username" | "email" | null {
    const message = (result.data as { message?: unknown } | null)?.message;
    const text = typeof message === "string" ? message : JSON.stringify(message ?? "");
    if (result.status === 409 || result.status === 400) {
      if (/username/i.test(text)) return "username";
      if (/email/i.test(text)) return "email";
    }
    return null;
  }

  /**
   * 建号时一次性补资料（#274 改成统一资料 account_profiles 优先）：显示名、简介有本地值就用本地的；
   * account_profiles 没有「所在地」「网站」这两项（统一资料只有用户名、显示名、简介、头像，SPEC §3.6），
   * 这两项、以及本地简介还没填时的兜底，都读一次 GitHub 公开资料（匿名，只在有 GitHub 身份时读）。
   * 读不到就只用登录名，不让同步失败。头像另算（set_avatar）。
   */
  type GithubProfile = { name?: string | null; bio?: string | null; blog?: string | null; location?: string | null };
  async function profileFor(account: DirectoryAccount) {
    let github: GithubProfile | null = null;
    if (account.github && !account.profile?.bio) {
      try {
        const res = await fetchGithub(`https://api.github.com/user/${account.github.id}`, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "yzgc-gitlab-sync" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (res.ok) github = await res.json() as GithubProfile;
      } catch { github = null; }
    }
    return {
      name: (account.profile?.displayName.trim() || github?.name?.trim() || account.name || account.login).slice(0, 255),
      bio: (account.profile?.bio || github?.bio || "").slice(0, 255),
      location: (github?.location || "").slice(0, 255),
      website_url: websiteOf(github?.blog || ""),
    };
  }

  /** GitHub 的 blog 是随手填的文字：没写协议的补 https://，补完还不是带点号主机名、不带账号口令的 http(s) 网址就不传，免得 GitLab 因为它拒绝建号。 */
  function websiteOf(raw: string): string {
    const value = raw.trim();
    if (!value) return "";
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(withScheme);
      return /^https?:$/.test(url.protocol) && url.hostname.includes(".") && !url.username && !url.password && withScheme.length <= 255 ? withScheme : "";
    } catch {
      return "";
    }
  }

  /**
   * 要传的头像：论坛上传的（WebP）直接取库里的；GitHub 头像下载 256 像素的。拿不到能传的图都抛错、记进 last_error，下一轮再试：
   * GitHub 连不上（github_avatar_unreachable）或不是 200（github_avatar_<状态码>）、不是图片（github_avatar_not_image）、
   * 超过 GitLab 的 200 KiB（avatar_too_large）、论坛里已经没有这张图（forum_avatar_missing）。在论坛上换个头像，来源变了就按新的来。
   */
  async function avatarFor(source: string): Promise<Blob> {
    if (source.startsWith(FORUM_AVATAR_PREFIX)) {
      const data = deps.avatars.avatar(source.slice(FORUM_AVATAR_PREFIX.length));
      if (!data) throw new SyncError("forum_avatar_missing");
      if (data.length > AVATAR_MAX_BYTES) throw new SyncError("avatar_too_large");
      return new Blob([new Uint8Array(data)], { type: "image/webp" });
    }
    const url = new URL(source);
    url.searchParams.set("s", String(GITHUB_AVATAR_SIZE));
    let res: Response;
    let data: ArrayBuffer;
    try {
      res = await fetchGithub(url.href, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      data = res.ok ? await res.arrayBuffer() : new ArrayBuffer(0);
    } catch {
      throw new SyncError("github_avatar_unreachable");
    }
    if (!res.ok) throw new SyncError(`github_avatar_${res.status}`);
    const type = (res.headers.get("content-type") ?? "").split(";")[0];
    if (!AVATAR_EXTENSIONS[type]) throw new SyncError("github_avatar_not_image");
    if (data.byteLength > AVATAR_MAX_BYTES) throw new SyncError("avatar_too_large");
    return new Blob([data], { type });
  }

  /** 传头像，GitLab 收下（200）后记下来源，来源不变就不再传；GitLab 没收（例如 400 太大）抛错，下一轮再试。 */
  async function setAvatar(account: DirectoryAccount, userId: number): Promise<void> {
    const source = avatarSource(account);
    if (!source) return;
    const avatar = await avatarFor(source);
    const form = new FormData();
    form.append("avatar", avatar, `avatar.${AVATAR_EXTENSIONS[avatar.type]}`);
    const result = await writeApi(account, "PUT", `/users/${userId}`, form);
    if (result.status !== 200) throw new SyncError(`gitlab_avatar_${result.status}`);
    db.prepare("UPDATE gitlab_accounts SET avatar_source = ?, updated_at = ? WHERE account_id = ?").run(source, clock(), account.account_id);
  }

  /**
   * 同步邮箱：主邮箱和 GitLab 的不同时改过去（不再发确认信），其它邮箱缺的以「已确认」加上，GitLab 上有但没确认的删掉重加；
   * 以前同步过去、现在不要的，和建号时用过的占位地址（换成真的主邮箱后 GitLab 会把它留成次邮箱），从 GitLab 删掉，GitLab 现在的主邮箱不动。
   * 每一项都试一遍。emails_source 记的是这一轮之后 GitLab 上实际有、由同步管的邮箱：全做成时和要有的一样；有被拒的（例如邮箱已经是
   * 别的 GitLab 用户的，400）时只记做成的，和要有的不一样，下一轮再试，这一轮加上去的以后在极客班删掉也照样从 GitLab 删。然后抛 gitlab_email_<状态码>。
   */
  async function setEmails(account: DirectoryAccount, userId: number): Promise<void> {
    const wanted = wantedEmails(account);
    const row = rowOf(account.account_id)!;
    const before = row.emails_source ? JSON.parse(row.emails_source) as WantedEmails : null;
    const refused: number[] = [];
    const user = await gitlab("GET", `/users/${userId}`);
    if (user.status !== 200) throw new SyncError(`gitlab_lookup_${user.status}`);
    let primary = String((user.data as { email?: unknown } | null)?.email ?? "").toLowerCase();
    if (wanted.primary && wanted.primary !== primary) {
      const updated = await writeApi(account, "PUT", `/users/${userId}`, { email: wanted.primary, skip_reconfirmation: true });
      if (updated.status === 200) primary = wanted.primary;
      else refused.push(updated.status);
    }
    const listed = await gitlab("GET", `/users/${userId}/emails`);
    if (listed.status !== 200 || !Array.isArray(listed.data)) throw new SyncError(`gitlab_email_${listed.status}`);
    const have = new Map((listed.data as { id: number; email: string; confirmed_at?: string | null }[])
      .map(item => [item.email.toLowerCase(), { id: item.id, confirmed: Boolean(item.confirmed_at) }]));
    const present = new Set<string>();
    for (const email of wanted.others) {
      const existing = have.get(email);
      if (email === primary || existing?.confirmed) { present.add(email); continue; }
      if (existing && !await deleteEmail(account, userId, existing.id, refused)) continue;
      const added = await writeApi(account, "POST", `/users/${userId}/emails`, { email, skip_confirmation: true });
      if (added.status === 201) present.add(email);
      else refused.push(added.status);
    }
    const sectorId = sector();
    const stale = new Set([
      ...(before?.primary ? [before.primary] : []), ...(before?.others ?? []), ...(sectorId ? [placeholderEmail(row.username, sectorId)] : []),
    ]);
    for (const email of stale) {
      const existing = have.get(email);
      if (!existing || email === primary || email === wanted.primary || wanted.others.includes(email)) continue;
      if (!await deleteEmail(account, userId, existing.id, refused)) present.add(email);
    }
    const synced = { primary: primary === wanted.primary ? wanted.primary : before?.primary ?? null, others: [...present] };
    db.prepare("UPDATE gitlab_accounts SET emails_source = ?, updated_at = ? WHERE account_id = ?").run(emailsJson(synced), clock(), account.account_id);
    if (refused.length) throw new SyncError(`gitlab_email_${refused[0]}`);
  }

  /** 删 GitLab 用户名下的一个次邮箱；没删掉时把状态码记进 refused。 */
  async function deleteEmail(account: DirectoryAccount, userId: number, emailId: number, refused: number[]): Promise<boolean> {
    const removed = await writeApi(account, "DELETE", `/users/${userId}/emails/${emailId}`);
    if (removed.status === 204) return true;
    refused.push(removed.status);
    return false;
  }

  async function ensureMembership(account: DirectoryAccount, userId: number, accessLevel: number): Promise<void> {
    const group = encodeURIComponent(config.group);
    const added = await writeApi(account, "POST", `/groups/${group}/members`, { user_id: userId, access_level: accessLevel });
    if (added.status === 201) return;
    if (added.status !== 409) throw new SyncError(`gitlab_member_${added.status}`);
    const updated = await writeApi(account, "PUT", `/groups/${group}/members/${userId}`, { access_level: accessLevel });
    if (updated.status !== 200) throw new SyncError(`gitlab_member_${updated.status}`);
  }

  /** 封禁或解封；GitLab 对已经是这个状态的用户可能回错，再读一次状态，已经是想要的就算成功。 */
  async function setBlocked(account: DirectoryAccount, userId: number, blocked: boolean): Promise<void> {
    const result = await writeApi(account, "POST", `/users/${userId}/${blocked ? "block" : "unblock"}`);
    if (result.status === 201) return;
    const user = await gitlab("GET", `/users/${userId}`);
    const state = (user.data as { state?: string } | null)?.state;
    if (user.status === 200 && (blocked ? state === "blocked" : state === "active")) return;
    throw new SyncError(`gitlab_${blocked ? "block" : "unblock"}_${result.status}`);
  }

  /** 按 OIDC 身份找 GitLab 用户：同步建的，或者他用极客班登录时 GitLab 自动建的。 */
  async function userByIdentity(sub: string): Promise<{ id: number; username: string } | undefined> {
    const users: { id: number; username: string }[] = [];
    let page = 1;
    for (let count = 0; count < 10; count++) {
      const found = await gitlab("GET", `/users?extern_uid=${encodeURIComponent(sub)}&provider=${GITLAB_OIDC_PROVIDER}&per_page=100&page=${page}`);
      if (found.status !== 200) throw new SyncError(`gitlab_lookup_${found.status}`);
      if (!Array.isArray(found.data) || found.data.some(user => !user || !Number.isSafeInteger(user.id) || user.id <= 0
        || typeof user.username !== "string" || !user.username)) throw new SyncError("gitlab_lookup_incomplete");
      users.push(...found.data);
      const next = found.nextPage ?? (found.data.length === 100 ? page + 1 : null);
      if (next === null) {
        if (users.length > 1) throw new SyncError("gitlab_identity_ambiguous");
        return users[0];
      }
      if (next !== page + 1) throw new SyncError("gitlab_pagination_incomplete");
      page = next;
    }
    throw new SyncError("gitlab_pagination_incomplete");
  }

  /** 缓存的数字 id 不是身份凭证；每次写远端之前核对现存 sub 与管理员接口返回的完整绑定。 */
  async function managedUser(account: DirectoryAccount, userId: number): Promise<{ id: number; username: string; state: "active" | "blocked" }> {
    const sectorId = sector();
    const sub = sectorId ? deps.subjects.existingSubject(sectorId, account.account_id) : null;
    if (!sub) throw new SyncError("gitlab_subject_missing");
    const result = await gitlab("GET", `/users/${userId}`);
    if (result.status !== 200) throw new SyncError(`gitlab_lookup_${result.status}`);
    const user = result.data as {
      id?: unknown; username?: unknown; state?: unknown; is_admin?: unknown; bot?: unknown; user_type?: unknown;
      identities?: { provider?: unknown; extern_uid?: unknown }[];
    } | null;
    if (!user || user.id !== userId || typeof user.username !== "string" || !user.username
      || (user.state !== "active" && user.state !== "blocked") || typeof user.is_admin !== "boolean"
      || !Array.isArray(user.identities)) throw new SyncError("gitlab_user_incomplete");
    const bindings = user.identities.filter(identity => identity?.provider === GITLAB_OIDC_PROVIDER);
    if (bindings.length !== 1 || bindings[0].extern_uid !== sub) {
      throw new SyncError("gitlab_identity_mismatch");
    }
    if (user.is_admin || user.bot === true || (user.user_type != null && user.user_type !== "human")
      || RESERVED_USERNAMES.has(user.username.toLowerCase())) throw new SyncError("gitlab_user_protected");
    const mapped = mappedAccount(userId);
    if (mapped && mapped !== account.account_id) throw new SyncError("gitlab_identity_mismatch");
    return { id: userId, username: user.username, state: user.state };
  }

  /**
   * 建号：先按 OIDC 身份找（上次建到一半、或者 GitLab 上已经有了），找不到再建；用户名、邮箱被占用时换一个再试。
   * 没有验证过的邮箱、或邮箱在 GitLab 上被占用时用 `<用户名>@noreply.<sector>`（sector 是 GitLab 对外的主机）。
   */
  async function create(account: DirectoryAccount, action: Extract<SyncAction, { kind: "create" }>): Promise<void> {
    const sectorId = sector();
    if (!sectorId) throw new SyncError("gitlab_client_missing");
    const now = clock();
    let username = action.username;
    // 先占下用户名：建到一半失败时，下次沿用同一个名字
    db.prepare(`INSERT INTO gitlab_accounts(account_id, gitlab_user_id, username, state, access_level, created_at, updated_at)
      VALUES(?, NULL, ?, 'pending', NULL, ?, ?) ON CONFLICT(account_id) DO NOTHING`).run(account.account_id, username, now, now);
    const sub = deps.subjects.subjectFor(sectorId, account.account_id);
    let user = await userByIdentity(sub);
    if (!user) {
      const profile = await profileFor(account);
      const tried = new Set<string>();
      let useNoreply = !account.email;
      for (let attempt = 0; attempt < 6 && !user; attempt++) {
        tried.add(username.toLowerCase());
        const created = await writeApi(account, "POST", "/users", {
          username, name: profile.name, email: useNoreply ? placeholderEmail(username, sectorId) : account.email,
          extern_uid: sub, provider: GITLAB_OIDC_PROVIDER, skip_confirmation: true, force_random_password: true,
          bio: profile.bio, location: profile.location, website_url: profile.website_url,
        });
        if (created.status === 201) { user = created.data as { id: number; username: string }; break; }
        const conflict = conflictOf(created);
        if (conflict === "email" && !useNoreply) { useNoreply = true; continue; }
        if (conflict !== "username") throw new SyncError(`gitlab_create_${created.status}`);
        username = freeUsername(account, tried);
        db.prepare("UPDATE gitlab_accounts SET username = ?, updated_at = ? WHERE account_id = ?").run(username, clock(), account.account_id);
      }
      if (!user) throw new SyncError("gitlab_username_exhausted");
    }
    const verified = await managedUser(account, user.id);
    db.prepare("UPDATE gitlab_accounts SET gitlab_user_id = ?, username = ?, state = ?, updated_at = ? WHERE account_id = ?")
      .run(verified.id, verified.username, verified.state, clock(), account.account_id);
    if (verified.state === "blocked") {
      await setBlocked(account, user.id, false);
      db.prepare("UPDATE gitlab_accounts SET state = 'active' WHERE account_id = ?").run(account.account_id);
    }
    await ensureMembership(account, user.id, action.access_level);
    db.prepare("UPDATE gitlab_accounts SET access_level = ?, updated_at = ? WHERE account_id = ?").run(action.access_level, clock(), account.account_id);
  }

  /** 按身份找一个还没对上 GitLab 用户的账号（见 plan）：找到就记下这个用户再封禁，返回 true；找不到什么也不改，返回 false。 */
  async function findAndBlock(account: DirectoryAccount): Promise<boolean> {
    const sectorId = sector();
    const sub = sectorId ? deps.subjects.existingSubject(sectorId, account.account_id) : null;
    const user = sub ? await userByIdentity(sub) : undefined;
    if (!user) return false;
    await managedUser(account, user.id);
    const now = clock();
    db.prepare(`INSERT INTO gitlab_accounts(account_id, gitlab_user_id, username, state, access_level, created_at, updated_at)
      VALUES(?, ?, ?, 'active', NULL, ?, ?) ON CONFLICT(account_id) DO UPDATE SET gitlab_user_id = excluded.gitlab_user_id,
        username = excluded.username, state = 'active', updated_at = excluded.updated_at`).run(account.account_id, user.id, user.username, now, now);
    await setBlocked(account, user.id, true);
    db.prepare("UPDATE gitlab_accounts SET state = 'blocked', updated_at = ? WHERE account_id = ?").run(clock(), account.account_id);
    return true;
  }

  /**
   * 按顺序做完这些事，返回真正做了的（find_and_block 没找到人不算）。头像和邮箱互不依赖：一个失败不耽误另一个，
   * 都试过以后再报先失败的那个。
   */
  async function apply(account: DirectoryAccount, actions: SyncAction[]): Promise<SyncAction[]> {
    const done: SyncAction[] = [];
    const failures: unknown[] = [];
    for (const action of actions) {
      if (action.kind === "create") { await create(account, action); done.push(action); continue; }
      if (action.kind === "find_and_block") { if (await findAndBlock(account)) done.push(action); continue; }
      const userId = rowOf(account.account_id)!.gitlab_user_id!;
      await managedUser(account, userId);
      if (action.kind === "set_avatar" || action.kind === "set_emails") {
        try {
          await (action.kind === "set_avatar" ? setAvatar(account, userId) : setEmails(account, userId));
        } catch (error) {
          failures.push(error);
          continue;
        }
      } else if (action.kind === "block" || action.kind === "unblock") {
        await setBlocked(account, userId, action.kind === "block");
        db.prepare("UPDATE gitlab_accounts SET state = ?, updated_at = ? WHERE account_id = ?").run(action.kind === "block" ? "blocked" : "active", clock(), account.account_id);
      } else {
        await ensureMembership(account, userId, action.access_level);
        db.prepare("UPDATE gitlab_accounts SET access_level = ?, updated_at = ? WHERE account_id = ?").run(action.access_level, clock(), account.account_id);
      }
      done.push(action);
    }
    if (failures.length) throw failures[0];
    return done;
  }

  /**
   * 同步一个账号。dry-run 只返回要做什么；on 时照做，失败的原因记在 last_error，下次对账再试。
   * 是不是成员、什么角色按这一刻的账号重读，不用这一轮开头的名单：一轮跑到一半时管理员移除了某人并立即同步封了他，轮到他时不会按旧名单解封。
   * 这一刻已经查不到的账号（被合并进别的账号）什么都不做，也不拿旧名单里的数据去建号或解封。
   */
  async function syncNow(snapshot: DirectoryAccount, actor: AuditActor, retries = 0): Promise<SyncOutcome> {
    const account = deps.directory.account(snapshot.account_id);
    if (!account) return { account_id: snapshot.account_id, login: snapshot.login, actions: [], applied: false, error: null };
    let actions: SyncAction[] = [];
    const outcome: SyncOutcome = { account_id: account.account_id, login: account.login, actions, applied: false, error: null };
    const now = clock();
    let done: SyncAction[] = [];
    try {
      if (account.account_id !== snapshot.account_id || !["active", "disabled"].includes(account.status)
        || typeof account.member !== "boolean"
        || (account.member ? account.status !== "active" || !["member", "admin"].includes(account.site_role ?? "") : account.site_role !== null)) {
        throw new SyncError("gitlab_source_incomplete");
      }
      actions = plan(account);
      outcome.actions = actions;
      if (config.mode !== "on") return outcome;
      if (!sector()) { outcome.error = "gitlab_client_missing"; return outcome; }
      const row = rowOf(account.account_id);
      if (row?.gitlab_user_id != null) {
        const remote = await managedUser(account, row.gitlab_user_id);
        assertCurrent(account);
        db.prepare("UPDATE gitlab_accounts SET state = ? WHERE account_id = ?").run(remote.state, account.account_id);
        actions = plan(account);
        outcome.actions = actions;
      }
      if (actions.length) done = await apply(account, actions);
      assertCurrent(account);
      db.prepare("UPDATE gitlab_accounts SET last_error = NULL, last_error_at = NULL, synced_at = ? WHERE account_id = ?").run(clock(), account.account_id);
      outcome.applied = done.length > 0;
    } catch (error) {
      // 网络等待期间资格可能改变；在同一账号锁内重算，已发送的状态变更也由新计划收敛。
      if (error instanceof SyncError && error.code === "gitlab_account_changed" && retries < 2) return syncNow(snapshot, actor, retries + 1);
      outcome.error = error instanceof SyncError ? error.code : "gitlab_sync_failed";
      if (config.mode === "on") {
        db.prepare("UPDATE gitlab_accounts SET last_error = ?, last_error_at = ?, updated_at = ? WHERE account_id = ?").run(outcome.error, now, now, account.account_id);
      }
    }
    // 按身份找、没找到人，或者找的时候就失败了（还没有这一行，什么也没改）：不写审计，免得 GitLab 出故障时这类账号每人每轮记一条
    const row = rowOf(account.account_id);
    if (config.mode === "on" && (done.length || (outcome.error && row))) {
      deps.audit(actor, "gitlab.sync", row?.username ?? account.login,
        { account_id: account.account_id, actions: actions.map(item => item.kind), error: outcome.error }, undefined, { surface: "system" });
    }
    return outcome;
  }

  const inFlight = new Map<string, Promise<SyncOutcome>>();
  /** 同一个账号同一时间只同步一次：定时对账和控制台的「立即同步」碰上时，后来的等前一次做完，再按那时的记录重新算要做什么。 */
  function syncOne(account: DirectoryAccount, actor: AuditActor = "system"): Promise<SyncOutcome> {
    const id = account.account_id;
    const next = (inFlight.get(id) ?? Promise.resolve()).catch(() => undefined).then(() => syncNow(account, actor));
    inFlight.set(id, next);
    const release = () => { if (inFlight.get(id) === next) inFlight.delete(id); };
    next.then(release, release);
    return next;
  }

  let running: Promise<SyncSummary> | null = null;
  let stopping = false;
  /** 上一轮全量对账的小结（#274 `GET /api/console/gitlab/status` 用），只存在进程内存里，重启后为 null。 */
  let lastRun: LastRun | null = null;
  /**
   * 全部账号对一次账；上一次还没跑完时返回同一个结果，不同时跑两轮。停下（stop）时做完手上这个账号就结束。
   * on 模式下 GitLab 的客户端还没登记时整轮跳过（skipped），不逐个账号记错误和审计。
   */
  function reconcile(): Promise<SyncSummary> {
    if (running) return running;
    running = (async () => {
      const outcomes: SyncOutcome[] = [];
      if (config.mode === "on" && !sector()) return { mode: config.mode, accounts: 0, changed: 0, failed: 0, skipped: "gitlab_client_missing", outcomes };
      for (const account of deps.directory.listForSync()) {
        if (config.mode === "off" || stopping) break;
        outcomes.push(await syncOne(account));
      }
      return {
        mode: config.mode, accounts: outcomes.length,
        changed: outcomes.filter(item => item.applied).length, failed: outcomes.filter(item => item.error).length, skipped: null, outcomes,
      };
    })().then(summary => {
      if (!summary.skipped) lastRun = { at: clock(), changed: summary.changed, failed: summary.failed };
      return summary;
    }).finally(() => { running = null; });
    return running;
  }

  /** 控制台手动重试一个账号；同步关着时不做。 */
  async function syncAccount(accountId: string, actor: AuditActor): Promise<SyncOutcome | null> {
    const account = deps.directory.account(accountId);
    if (!account) return null;
    return syncOne(account, actor);
  }

  /** 控制台成员页的同步状态：每个账号的 GitLab 用户名、用户 id、状态、组权限、最后一次错误，以及现在还要做什么。 */
  function status() {
    return deps.directory.listForSync().map(account => {
      const row = rowOf(account.account_id);
      return {
        account_id: account.account_id, login: account.login,
        username: row?.username ?? null, gitlab_user_id: row?.gitlab_user_id ?? null, state: row?.state ?? null, access_level: row?.access_level ?? null,
        last_error: row?.last_error ?? null, last_error_at: row?.last_error_at ?? null, synced_at: row?.synced_at ?? null,
        pending: config.mode === "off" ? [] : plan(account),
      };
    });
  }

  /** 给以后的比赛记分（#239）：极客班账号在 GitLab 上是谁。还没建好时为 null。 */
  function gitlabUserFor(accountId: string): { gitlabUserId: number; username: string; state: GitlabAccountState } | null {
    const row = rowOf(accountId);
    return row && row.gitlab_user_id !== null ? { gitlabUserId: row.gitlab_user_id, username: row.username, state: row.state } : null;
  }

  function mappedAccount(gitlabUserId: number): string | null {
    return (db.prepare("SELECT account_id FROM gitlab_accounts WHERE gitlab_user_id = ?").get(gitlabUserId) as { account_id: string } | undefined)?.account_id ?? null;
  }

  /** 贡献归属也核对现存 OIDC 绑定，不能将缓存的数字 id 当成作者或审核人身份。HTTP 不确定则让调用方中止本轮。 */
  async function accountForGitlabUser(gitlabUserId: number): Promise<string | null> {
    const accountId = mappedAccount(gitlabUserId);
    const account = accountId ? deps.directory.account(accountId) : null;
    if (!account) return null;
    try {
      await managedUser(account, gitlabUserId);
      return account.account_id;
    } catch (error) {
      if (error instanceof SyncError && ["gitlab_subject_missing", "gitlab_identity_mismatch", "gitlab_user_protected"].includes(error.code)) return null;
      throw error;
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let activeLogger: SyncLogger | null = null;
  /** on 模式才开定时对账（buildApp 的 gitlabSync，index.ts 打开）；立即对一次，之后每 intervalMs。出错只记日志。 */
  function start(logger: SyncLogger): void {
    activeLogger = logger;
    if (timer || config.mode !== "on") return;
    stopping = false;
    const run = () => {
      reconcile().then(summary => {
        if (summary.skipped) logger.error({ reason: summary.skipped, client_id: config.clientId }, "gitlab sync skipped");
        else if (summary.changed || summary.failed) logger.info({ changed: summary.changed, failed: summary.failed }, "gitlab sync finished");
      }).catch(error => logger.error({ error: (error as Error)?.name ?? "error" }, "gitlab sync failed"));
    };
    run();
    timer = setInterval(run, intervalMs);
    timer.unref();
  }
  async function stop(): Promise<void> {
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    await running?.catch(() => undefined);
  }

  /** GitLab 的客户端（client id gitlab）登记了没有；没登记时 on 模式什么也不做。 */
  const clientRegistered = () => sector() !== null;

  /** 过去 24 小时内仍处于失败状态的账号数（不是错误事件总数，只是当前 last_error_at 落在这个窗口里的账号）。 */
  function errors24h(): number {
    const since = clock() - 24 * 60 * 60 * 1000;
    return (db.prepare("SELECT COUNT(*) AS n FROM gitlab_accounts WHERE last_error_at IS NOT NULL AND last_error_at >= ?").get(since) as { n: number }).n;
  }

  /** 控制台概览的健康检查：能不能连上、GitLab 版本号。没配 URL 时不发请求，直接当作不健康。 */
  async function health(): Promise<{ version: string | null; healthy: boolean }> {
    if (!config.url) return { version: null, healthy: false };
    try {
      const result = await gitlab("GET", "/version");
      if (result.status !== 200) return { version: null, healthy: false };
      const version = (result.data as { version?: unknown } | null)?.version;
      return { version: typeof version === "string" ? version : null, healthy: true };
    } catch {
      return { version: null, healthy: false };
    }
  }

  /**
   * 控制台「代码仓库」与门户公开列表共用的项目清单（#274）：`GITLAB_GROUP` 本身加它的子组，以及组内全部项目
   * （含子组，按最近活跃排序，最多 100 个）。用管理令牌读，私有项目也在列表里；只给公开项目的过滤由调用方做
   * （`GET /api/public/gitlab/projects`）。没配 URL、连不上或 GitLab 拒绝时给空列表，不让调用方的接口跟着报错。
   */
  async function listProjects(): Promise<GitlabProjectsSummary> {
    if (!config.url) return { groups: [], projects: [], available: false };
    const groupPath = encodeURIComponent(config.group);
    try {
      const groups: GitlabGroupInfo[] = [];
      const own = await gitlab("GET", `/groups/${groupPath}`);
      if (own.status !== 200) return { groups: [], projects: [], available: false };
      const data = own.data as { id?: unknown; full_path?: unknown; name?: unknown; visibility?: unknown };
      if (typeof data.id === "number") groups.push({ id: data.id, full_path: String(data.full_path ?? config.group), name: String(data.name ?? config.group), visibility: String(data.visibility ?? "private") });
      const subgroups = await gitlab("GET", `/groups/${groupPath}/subgroups?per_page=100`);
      if (subgroups.status === 200 && Array.isArray(subgroups.data)) {
        for (const item of subgroups.data as Record<string, unknown>[]) {
          if (typeof item.id === "number") groups.push({ id: item.id, full_path: String(item.full_path ?? ""), name: String(item.name ?? ""), visibility: String(item.visibility ?? "private") });
        }
      }
      const projects: GitlabProjectInfo[] = [];
      const listed = await gitlab("GET", `/groups/${groupPath}/projects?include_subgroups=true&per_page=100&order_by=last_activity_at`);
      if (listed.status !== 200 || !Array.isArray(listed.data)) return { groups: [], projects: [], available: false };
      for (const item of listed.data as Record<string, unknown>[]) {
        if (typeof item.id !== "number") continue;
        projects.push({
          id: item.id, path_with_namespace: String(item.path_with_namespace ?? ""), name: String(item.name ?? ""),
          description: typeof item.description === "string" ? item.description : null,
          visibility: String(item.visibility ?? "private"), web_url: String(item.web_url ?? ""),
          http_url_to_repo: String(item.http_url_to_repo ?? ""), ssh_url_to_repo: String(item.ssh_url_to_repo ?? ""),
          last_activity_at: typeof item.last_activity_at === "string" ? item.last_activity_at : null,
          star_count: typeof item.star_count === "number" ? item.star_count : 0,
        });
      }
      return { groups, projects, available: true };
    } catch {
      return { groups: [], projects: [], available: false };
    }
  }

  /**
   * 控制台「GitLab 设置」的写口（#274）：改 mode（同步开关）、group（成员进的组路径）、intervalMinutes（对账间隔）。
   * 令牌只读 env，这里不改。mode 从 on 切走、切回来，或者间隔变了都要重新排定时器，统一做法是先停（等手上这一轮跑完）
   * 再按新设置决定要不要重开；没调用过 `start()` 时（例如测试直接 new 一个 sync 不跑定时器）就什么也不重开，
   * 只更新设置，下次手动 `reconcile()`/`syncAccount()` 用的已经是新设置。
   */
  async function applySettings(patch: { mode?: GitlabSyncConfig["mode"]; group?: string; intervalMinutes?: number }): Promise<void> {
    await stop();
    stopping = false; // stop() 是为关进程设计的永久停止；这里只是暂停去换设置，manual reconcile/syncAccount 照常要能跑
    config = { ...config, ...(patch.mode !== undefined ? { mode: patch.mode } : {}), ...(patch.group !== undefined ? { group: patch.group } : {}) };
    if (patch.intervalMinutes !== undefined) intervalMs = patch.intervalMinutes * 60_000;
    writeGitlabSyncSettings(db, { mode: config.mode, group: config.group, interval_minutes: Math.round(intervalMs / 60_000) });
    if (activeLogger) start(activeLogger);
  }

  return {
    get mode() { return config.mode; }, get url() { return config.url; }, get group() { return config.group; },
    get intervalMinutes() { return Math.round(intervalMs / 60_000); },
    plan, reconcile, syncAccount, status, clientRegistered, gitlabUserFor, accountForGitlabUser, start, stop, applySettings, readApi,
    lastRun: () => lastRun, errors24h, health, listProjects,
  };
}
export type GitlabSync = ReturnType<typeof createGitlabSync>;
