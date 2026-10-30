import type Database from "better-sqlite3";
import { GRADE_LABELS, gradeOf, type Grade } from "./grade.js";
import type { PublicAccountProfile } from "./public-profile.js";

/**
 * 账号资料（#274 CONTRACT §2）：论坛、控制台、GitLab 同步、OIDC userinfo、命令行统一读这里。
 * `account_profiles` 由迁移脚本（lib/migrations/2026-10-yugc-v2.ts）给每个账号建一行；这里的 `ensure()`
 * 只是兜底，防止极少数绕过迁移直接插 `users` 行的测试或老流程漏掉。
 */
export type AccountProfile = { username: string; display_name: string; bio: string; avatar_url: string | null; prefs: Record<string, unknown> };
export type ProfilePatch = { display_name?: string; bio?: string; username?: string; prefs?: Record<string, unknown> };
export type ProfileUpdateResult = { ok: true; profile: AccountProfile } | { ok: false; reason: "username_taken" };

/**
 * 实名信息（#280）：真实姓名和入学年份，年级由入学年份按学年现算（lib/grade.ts）。真实姓名只回给本人和有
 * `users.manage` 的管理员，论坛、天梯、比赛、OIDC/GitLab 都不读这里。
 */
export type RealInfo = { real_name: string | null; enrollment_year: number | null; grade: Grade | null; grade_label: string | null };
export const REAL_NAME_MAX = 32;

/** 真实姓名：去掉首尾空白、连续空白并成一个，2–32 个字，只能是文字、空格和「·」「.」「-」；不合格返回 null */
export function normalizeRealName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  return /^[\p{L}\p{M}][\p{L}\p{M} ·.\-]*$/u.test(name) && [...name].length >= 2 && [...name].length <= REAL_NAME_MAX ? name : null;
}

/** 和 routes/identity/profile.ts 的 `GET /api/identity/avatar/:file` 逐字一致；account-directory.ts 用它拼 OIDC/GitLab 要的完整地址。 */
export const avatarPath = (hash: string) => `/api/identity/avatar/${hash}.webp`;

export function createAccountProfiles(db: Database.Database, deps: { clock?: () => number } = {}) {
  const clock = deps.clock ?? Date.now;
  const selectRow = db.prepare("SELECT username, display_name, bio, avatar_hash, prefs FROM account_profiles WHERE account_id = ?");
  const selectPublicRows = db.prepare("SELECT account_id, username, display_name, bio, avatar_hash FROM account_profiles WHERE account_id IN (SELECT value FROM json_each(?))");
  const usernameTaken = db.prepare("SELECT 1 FROM account_profiles WHERE username = ? COLLATE NOCASE AND account_id <> ?");
  const updateStmt = db.prepare("UPDATE account_profiles SET username = ?, display_name = ?, bio = ?, prefs = ?, updated_at = ? WHERE account_id = ?");
  const insertIfMissing = db.prepare("INSERT OR IGNORE INTO account_profiles(account_id, username, display_name, bio, prefs, updated_at) VALUES (?, ?, ?, '', '{}', ?)");
  const setAvatarStmt = db.prepare("UPDATE account_profiles SET avatar_hash = ?, updated_at = ? WHERE account_id = ?");
  const insertAvatarData = db.prepare("INSERT OR IGNORE INTO account_avatars(hash, data, mime, created_at) VALUES (?, ?, 'image/webp', ?)");
  const avatarDataStmt = db.prepare("SELECT data FROM account_avatars WHERE hash = ?");
  const selectReal = db.prepare("SELECT real_name, enrollment_year FROM account_profiles WHERE account_id = ?");
  const setRealStmt = db.prepare("UPDATE account_profiles SET real_name = ?, enrollment_year = ?, updated_at = ? WHERE account_id = ?");

  function avatarUrl(hash: string | null): string | null {
    return hash ? avatarPath(hash) : null;
  }

  function ensure(accountId: string): void {
    // 账号 id 是 Crockford base32（见 identity-store.ts 的 newAccountId），字母是大写的；兜底用户名必须小写，
    // 否则不满足 PATCH /api/identity/profile 的 username 合同（^[a-z0-9_]{3,24}$，CONTRACT-274 §2）。
    if (!selectRow.get(accountId)) insertIfMissing.run(accountId, `acct_${accountId.replace(/-/g, "").slice(0, 16).toLowerCase()}`, "", clock());
  }

  function get(accountId: string): AccountProfile {
    ensure(accountId);
    const row = selectRow.get(accountId) as { username: string; display_name: string; bio: string; avatar_hash: string | null; prefs: string };
    return { username: row.username, display_name: row.display_name, bio: row.bio, avatar_url: avatarUrl(row.avatar_hash), prefs: JSON.parse(row.prefs || "{}") };
  }

  /** 历史作者投影只批量读已存在的公开字段；缺行不建档，也不逐账号触发 get()/ensure()。 */
  function findMany(accountIds: string[]): Map<string, PublicAccountProfile> {
    if (!accountIds.length) return new Map();
    const rows = selectPublicRows.all(JSON.stringify([...new Set(accountIds)])) as {
      account_id: string; username: string; display_name: string; bio: string; avatar_hash: string | null;
    }[];
    return new Map(rows.map(row => [row.account_id, {
      username: row.username, display_name: row.display_name, bio: row.bio, avatar_url: avatarUrl(row.avatar_hash),
    }]));
  }

  /** `prefs` 是合并写，不是整份替换（CONTRACT §2）；`username` 唯一性不分大小写，自己原来的名字不算占用。 */
  function update(accountId: string, patch: ProfilePatch): ProfileUpdateResult {
    ensure(accountId);
    const current = selectRow.get(accountId) as { username: string; display_name: string; bio: string; prefs: string };
    if (patch.username !== undefined && patch.username.toLowerCase() !== current.username.toLowerCase() && usernameTaken.get(patch.username, accountId)) {
      return { ok: false, reason: "username_taken" };
    }
    const username = patch.username ?? current.username;
    const displayName = patch.display_name ?? current.display_name;
    const bio = patch.bio ?? current.bio;
    const prefs = { ...JSON.parse(current.prefs || "{}"), ...(patch.prefs ?? {}) };
    updateStmt.run(username, displayName, bio, JSON.stringify(prefs), clock(), accountId);
    return { ok: true, profile: get(accountId) };
  }

  /** `data` 为 null 表示字节已经在对象存储里（#352），库里不再存一份。 */
  function setAvatar(accountId: string, hash: string, data: Buffer | null): void {
    ensure(accountId);
    if (data) insertAvatarData.run(hash, data, clock());
    setAvatarStmt.run(hash, clock(), accountId);
  }

  function clearAvatar(accountId: string): void {
    const previous = selectRow.get(accountId) as { avatar_hash: string | null } | undefined;
    setAvatarStmt.run(null, clock(), accountId);
    if (previous?.avatar_hash) {
      // 同一张图也可能是某个 GitHub 头像的副本（#343，github_avatar_checks.avatar_hash），还有人用就留着
      db.prepare(`DELETE FROM account_avatars WHERE hash = ? AND NOT EXISTS (SELECT 1 FROM account_profiles WHERE avatar_hash = ?)
        AND NOT EXISTS (SELECT 1 FROM github_avatar_checks WHERE avatar_hash = ?)`)
        .run(previous.avatar_hash, previous.avatar_hash, previous.avatar_hash);
    }
  }

  function avatar(hash: string): Buffer | null {
    return (avatarDataStmt.get(hash) as { data: Buffer } | undefined)?.data ?? null;
  }

  function realInfo(accountId: string): RealInfo {
    const row = selectReal.get(accountId) as { real_name: string | null; enrollment_year: number | null } | undefined;
    const grade = gradeOf(row?.enrollment_year ?? null, clock());
    return { real_name: row?.real_name || null, enrollment_year: row?.enrollment_year ?? null, grade, grade_label: grade === null ? null : GRADE_LABELS[grade] };
  }

  /** 缺姓名或年级：登录后先去补资料页（lib/email-gate.ts 的关口）；入学年份在将来算不出年级，也当作缺 */
  function profileRequired(accountId: string): boolean {
    const info = realInfo(accountId);
    return !info.real_name || info.grade === null;
  }

  /** 调用方负责校验（normalizeRealName、enrollmentYearFor）和权限；`null` 表示清空这一项 */
  function setRealInfo(accountId: string, realName: string | null, enrollmentYear: number | null): void {
    ensure(accountId);
    setRealStmt.run(realName, enrollmentYear, clock(), accountId);
  }

  return { get, findMany, update, setAvatar, clearAvatar, avatar, avatarUrl, realInfo, profileRequired, setRealInfo };
}
export type AccountProfileStore = ReturnType<typeof createAccountProfiles>;
