import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { AuditActor } from "./db.js";

/**
 * 极客班账号（#262，docs/plan/UNIFIED-LOGIN.md）：`users` 一行是一个账号，`id` 就是接口里的 `account_id`（极客班 OpenID）；
 * `identities` 一行是一种登录方式，交付 1 只有 GitHub（`provider_uid` 是 GitHub 数字 id 的十进制串，不用会变的登录名）。
 * 只有这个模块读写 `users`、`identities` 与 `identity_audit`；业务代码从会话拿 `account_id`，不读身份表。
 */
export type IdentityProvider = "github" | "google" | "email";
export type GithubAccount = { id: number; login: string; avatarUrl: string | null };
/** auth.createSession 的入参：会话记账号和本次登录方式，旧列（登录名、GitHub id、头像、加密 token）照写，供回滚后的旧镜像读。 */
export type NewSession = { accountId: string; provider: IdentityProvider; login: string; userId: number; avatarUrl: string | null; accessToken: string };
export type GithubSigninResult =
  | { ok: true; sid: string; accountId: string }
  | { ok: false; reason: "account_disabled"; accountId: string };
/** 启动回填的计数，写进 `identity.backfill` 审计（规格「交付 1：回填」第 5 步）。 */
export type IdentityBackfillReport = {
  users: number; identities: number; sessions_mapped: number; sessions_unmapped: number;
  assignments_claimed: number; assignments_unclaimed: number; forum_claimed: number;
};

/** `merged_into` 最多走 8 跳；更长或成环说明数据坏了，登录按 `failed` 处理。 */
export const MERGE_HOPS_MAX = 8;

/** 合并链超长、成环或指向不存在的账号。登录事务整体回滚，路由记错误日志（只记 code）后回跳 `failed`。 */
export class IdentityChainError extends Error {
  readonly code = "identity_chain_invalid";
  constructor(message: string) { super(message); this.name = "IdentityChainError"; }
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function base32(value: bigint, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) { out = CROCKFORD[Number(value & 31n)] + out; value >>= 5n; }
  return out;
}
const randomBits = (bytes: number) => BigInt(`0x${randomBytes(bytes).toString("hex")}`);
/** 账号 id：128 位随机数编成 26 位 Crockford Base32。不用自增、不用任何渠道的 id，永不复用。 */
export const newAccountId = () => base32(randomBits(16), 26);
/** 身份 id：ULID（48 位毫秒时间 + 80 位随机，26 位 Crockford Base32）。 */
export const newUlid = (now: number) => base32(BigInt(now), 10) + base32(randomBits(10), 16);

type AccountRow = { id: string; status: "active" | "disabled" | "merged"; merged_into: string | null };
/** 这个 GitHub id 对应的账号（provider_uid 存十进制串）：回填与登录共用的匹配写法。 */
const ACCOUNT_OF_GITHUB_ID = (column: string) =>
  `(SELECT i.user_id FROM identities i WHERE i.provider = 'github' AND i.provider_uid = CAST(${column} AS TEXT))`;

/** 沿 `merged_into` 走到终点账号（`active` 或 `disabled`）；超过 MERGE_HOPS_MAX 跳、成环或断链抛 IdentityChainError。 */
function terminalAccount(db: Database.Database, accountId: string): { id: string; status: "active" | "disabled" } {
  const select = db.prepare("SELECT id, status, merged_into FROM users WHERE id = ?");
  const seen = new Set<string>();
  let current = select.get(accountId) as AccountRow | undefined;
  for (let hops = 0; current; hops++) {
    if (current.status !== "merged") return { id: current.id, status: current.status };
    if (hops >= MERGE_HOPS_MAX) throw new IdentityChainError(`merge chain longer than ${MERGE_HOPS_MAX} hops`);
    if (seen.has(current.id)) throw new IdentityChainError("merge chain has a cycle");
    seen.add(current.id);
    current = select.get(current.merged_into) as AccountRow | undefined;
  }
  throw new IdentityChainError("merge chain points to a missing account");
}

/**
 * 启动回填（规格「交付 1：回填」）：每次启动在一个事务里跑，全是带条件的更新，可以重跑——回滚到旧镜像期间产生的
 * 会话、称号和论坛用户，重新上线时由同一段代码补上。
 * 1. 建号：未过期会话里出现过、还没有 GitHub 身份的每个 user_id，各建一个账号和 GitHub 身份（登录名、头像取该 id 最新的会话）。
 * 2. 映射会话：有 user_id 的会话写上账号；user_id 为空的旧会话不映射，读到时按未登录处理（auth.getSession）。
 * 3. 认领称号：github_user_id 等于某个 GitHub 身份的写上账号；github_user_id 为空的只能按登录名匹配，**不认领**。
 * 4. 认领论坛用户：github_user_id 等于某个 GitHub 身份的写上账号。
 * 5. 报告：第一次跑完写 console_seeds 的 identity_v1 和一条 identity.backfill 审计；之后只有补到了东西才再写一条。
 */
export function backfillIdentity(db: Database.Database, now: number): { report: IdentityBackfillReport; recorded: boolean } {
  return db.transaction(() => {
    const candidates = db.prepare(`SELECT user_id, login, avatar_url, created_at FROM sessions
      WHERE expires_at > ? AND user_id IS NOT NULL AND ${ACCOUNT_OF_GITHUB_ID("sessions.user_id")} IS NULL
      ORDER BY user_id, created_at DESC, rowid DESC`).all(now) as { user_id: number; login: string; avatar_url: string | null; created_at: number }[];
    const insertUser = db.prepare("INSERT INTO users(id, status, org_state, org_checked_at, created_at, updated_at) VALUES(?, 'active', 'active', ?, ?, ?)");
    const insertIdentity = db.prepare(`INSERT INTO identities(id, user_id, provider, provider_uid, login, avatar_url, created_at, last_login_at)
      VALUES(?, ?, 'github', ?, ?, ?, ?, ?)`);
    const created = new Set<number>();
    for (const row of candidates) {
      if (created.has(row.user_id)) continue;
      created.add(row.user_id);
      const accountId = newAccountId();
      // 会话签发时 GitHub 刚确认过组织资格，所以 org_checked_at、last_login_at 都取这条会话的签发时间
      insertUser.run(accountId, row.created_at, now, now);
      insertIdentity.run(newUlid(now), accountId, String(row.user_id), row.login, row.avatar_url, now, row.created_at);
    }
    const sessionsMapped = db.prepare(`UPDATE sessions SET openid = ${ACCOUNT_OF_GITHUB_ID("sessions.user_id")}, provider = 'github'
      WHERE openid IS NULL AND user_id IS NOT NULL AND ${ACCOUNT_OF_GITHUB_ID("sessions.user_id")} IS NOT NULL`).run().changes;
    const assignmentsClaimed = db.prepare(`UPDATE role_assignments SET account_id = ${ACCOUNT_OF_GITHUB_ID("role_assignments.github_user_id")}
      WHERE account_id IS NULL AND github_user_id IS NOT NULL AND ${ACCOUNT_OF_GITHUB_ID("role_assignments.github_user_id")} IS NOT NULL`).run().changes;
    const forumClaimed = db.prepare(`UPDATE forum_users SET account_id = ${ACCOUNT_OF_GITHUB_ID("forum_users.github_user_id")}
      WHERE account_id IS NULL AND github_user_id IS NOT NULL AND ${ACCOUNT_OF_GITHUB_ID("forum_users.github_user_id")} IS NOT NULL`).run().changes;
    const count = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number }).n;
    const report: IdentityBackfillReport = {
      users: created.size,
      identities: created.size,
      sessions_mapped: sessionsMapped,
      sessions_unmapped: count("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ? AND openid IS NULL", now),
      assignments_claimed: assignmentsClaimed,
      assignments_unclaimed: count("SELECT COUNT(*) AS n FROM role_assignments WHERE account_id IS NULL AND github_user_id IS NULL"),
      forum_claimed: forumClaimed,
    };
    const first = db.prepare("INSERT OR IGNORE INTO console_seeds(name, seeded_at) VALUES('identity_v1', ?)").run(now).changes === 1;
    const filled = report.users + report.identities + report.sessions_mapped + report.assignments_claimed + report.forum_claimed > 0;
    if (first || filled) {
      db.prepare("INSERT INTO audit_logs(org, actor, action, target, details, ip, created_at, actor_account_id) VALUES(NULL, 'system', 'identity.backfill', NULL, ?, NULL, ?, NULL)")
        .run(JSON.stringify(report), now);
    }
    return { report, recorded: first || filled };
  }).immediate();
}

export type IdentityDeps = {
  /** auth.createSession：在登录事务里插入会话 */
  createSession: (input: NewSession) => string;
  /** storage.audit */
  audit: (org: string | null, actor: AuditActor, action: string, target?: string, details?: unknown, ip?: string) => void;
  consoleOrg: string;
  clock?: () => number;
};

export function createIdentityStore(db: Database.Database, deps: IdentityDeps) {
  const clock = deps.clock ?? Date.now;
  const githubIdentity = db.prepare("SELECT id, user_id FROM identities WHERE provider = 'github' AND provider_uid = ?");
  const insertUser = db.prepare("INSERT INTO users(id, status, org_state, org_checked_at, created_at, updated_at) VALUES(?, 'active', 'active', ?, ?, ?)");
  const insertIdentity = db.prepare(`INSERT INTO identities(id, user_id, provider, provider_uid, login, avatar_url, created_at, last_login_at)
    VALUES(?, ?, 'github', ?, ?, ?, ?, ?)`);
  const refreshIdentity = db.prepare("UPDATE identities SET login = ?, avatar_url = ?, last_login_at = ? WHERE id = ?");
  const markActive = db.prepare("UPDATE users SET org_state = 'active', org_checked_at = ?, updated_at = ? WHERE id = ?");
  const claimAssignments = db.prepare("UPDATE role_assignments SET account_id = ? WHERE account_id IS NULL AND github_user_id = ?");
  // 论坛用户按账号唯一：账号已经有论坛用户时不再认领第二个
  const claimForumUser = db.prepare(`UPDATE forum_users SET account_id = ? WHERE account_id IS NULL AND github_user_id = ?
    AND NOT EXISTS (SELECT 1 FROM forum_users f WHERE f.account_id = ?)`);
  const deleteSession = db.prepare("DELETE FROM sessions WHERE id = ?");
  const insertAccountEvent = db.prepare("INSERT INTO identity_audit(user_id, action, provider, result, reason, created_at) VALUES(?, ?, ?, ?, ?, ?)");

  /** 本人可见的账号记录：不存 IP、UA、邮箱原文和第三方标识。 */
  function accountEvent(accountId: string, action: "login" | "login_denied" | "logout", provider: IdentityProvider, result: "ok" | "denied" | "failed", reason: string | null, now = clock()) {
    insertAccountEvent.run(accountId, action, provider, result, reason, now);
  }

  /** 这个 GitHub id 现在属于哪个账号（走到合并链终点）；还没登录过（没有身份）或合并链坏了时为 null。 */
  function accountForGithub(githubUserId: number): string | null {
    const identity = githubIdentity.get(String(githubUserId)) as { user_id: string } | undefined;
    if (!identity) return null;
    try { return terminalAccount(db, identity.user_id).id; } catch { return null; }
  }

  /**
   * GitHub 登录事务（规格「登录事务」）：外部请求（换 token、查用户和组织资格）都已在事务外做完，这里在一个
   * `BEGIN IMMEDIATE` 事务里找身份或建号、沿合并链走到终点、刷新身份、认领称号与论坛用户、插入会话、删请求带来的旧会话、
   * 写 identity_audit 与 auth.signin。终点账号停用时只写拒绝记录（auth.signin_denied、login_denied）、不建会话。
   * 任何一步抛错整体回滚：不留半个账号，请求带来的旧会话照常有效；调用方回跳 `failed`。
   */
  function signInWithGithub(input: { github: GithubAccount; accessToken: string; previousSid?: string | null; ip?: string }): GithubSigninResult {
    const { github } = input;
    const avatarUrl = github.avatarUrl || null;
    return db.transaction((): GithubSigninResult => {
      const now = clock();
      let identity = githubIdentity.get(String(github.id)) as { id: string; user_id: string } | undefined;
      if (!identity) {
        // 只有 GitHub 能建号：通过了组织门槛、这个 GitHub id 还没有账号
        const accountId = newAccountId();
        insertUser.run(accountId, now, now, now);
        identity = { id: newUlid(now), user_id: accountId };
        insertIdentity.run(identity.id, accountId, String(github.id), github.login, avatarUrl, now, now);
      }
      const account = terminalAccount(db, identity.user_id);
      if (account.status === "disabled") {
        accountEvent(account.id, "login_denied", "github", "denied", "account_disabled", now);
        deps.audit(null, { login: github.login, account_id: account.id }, "auth.signin_denied", github.login,
          { org: deps.consoleOrg, reason: "account_disabled", provider: "github" }, input.ip);
        return { ok: false, reason: "account_disabled", accountId: account.id };
      }
      refreshIdentity.run(github.login, avatarUrl, now, identity.id);
      markActive.run(now, now, account.id);
      // 只按 GitHub 数字 id 认领：登录名会改，旧名字也可能被别人注册
      claimAssignments.run(account.id, github.id);
      claimForumUser.run(account.id, github.id, account.id);
      const sid = deps.createSession({ accountId: account.id, provider: "github", login: github.login, userId: github.id, avatarUrl, accessToken: input.accessToken });
      // 换号登录、重复登录：请求带来的旧会话作废
      if (input.previousSid && input.previousSid !== sid) deleteSession.run(input.previousSid);
      accountEvent(account.id, "login", "github", "ok", null, now);
      deps.audit(null, { login: github.login, account_id: account.id }, "auth.signin", github.login, { provider: "github" }, input.ip);
      return { ok: true, sid, accountId: account.id };
    }).immediate();
  }

  /**
   * GitHub 登录被组织门槛拒绝（不是成员、邀请没接受）：写 auth.signin_denied；这个 GitHub id 已经有账号时
   * 带上 actor_account_id，并给本人记一条 login_denied。不建号、不建会话。
   */
  function recordGithubDenied(input: { github: GithubAccount; reason: string; ip?: string }): void {
    db.transaction(() => {
      const accountId = accountForGithub(input.github.id);
      if (accountId) accountEvent(accountId, "login_denied", "github", "denied", input.reason);
      deps.audit(null, { login: input.github.login, account_id: accountId }, "auth.signin_denied", input.github.login,
        { org: deps.consoleOrg, reason: input.reason, provider: "github" }, input.ip);
    })();
  }

  /** 退出：给本人记一条 logout（auth.signout 审计由路由写）。 */
  function recordSignout(accountId: string, provider: IdentityProvider): void {
    accountEvent(accountId, "logout", provider, "ok", null);
  }

  return { signInWithGithub, recordGithubDenied, recordSignout, accountForGithub };
}
export type IdentityStore = ReturnType<typeof createIdentityStore>;
