import type Database from "better-sqlite3";

/**
 * 注册邀请码（#262，所有者 2026-10-23 决定注册需要邀请码，并在控制台增加邀请码逻辑）。
 * 用邮箱或 Google 第一次登录、还没有极客班账号时要填一个有效的邀请码才建号；GitHub 登录照旧按组织成员资格建号，不用邀请码。
 * 邀请码是控制台里的管理员数据（持有 `accounts.invites.manage`），存原文：管理员要看得到、复制得了才能发给人。
 * 比较不分大小写，存小写。只有这个模块读写 `invite_codes`；建号时的兑换在身份模块的登录事务里调 `redeemInvite`。
 */
/** 兑换时接受的格式：历史上建过 4 位码，兑换一律照收（#319）。 */
export const INVITE_CODE_PATTERN = "^[A-Za-z0-9_-]{4,40}$";
/** 新建的邀请码至少 8 位（#319，32^8 约 10^12，和 4 位的 105 万不可比）。 */
export const INVITE_CODE_CREATE_PATTERN = "^[A-Za-z0-9_-]{8,40}$";
const CODE_RE = new RegExp(INVITE_CODE_PATTERN);
const CREATE_CODE_RE = new RegExp(INVITE_CODE_CREATE_PATTERN);

export type InviteCode = {
  id: number; code: string; note: string; max_uses: number | null; used_count: number; expires_at: number | null;
  disabled: boolean; created_by: string; created_at: number; updated_at: number;
};
type InviteRow = Omit<InviteCode, "disabled"> & { disabled: number };
export type InviteInput = { code: string; note?: string; max_uses?: number | null; expires_at?: number | null };
export type InvitePatch = { note?: string; max_uses?: number | null; expires_at?: number | null; disabled?: boolean };
/** 兑换不成的原因：不存在（含格式不对）、停用、过期、次数用完。对外一律说「邀请码无效」，不细分。 */
export type InviteRefusal = "invalid_invite";

const COLUMNS = "id, code, note, max_uses, used_count, expires_at, disabled, created_by, created_at, updated_at";
const toInvite = (row: InviteRow): InviteCode => ({ ...row, disabled: row.disabled === 1 });

/** 去掉首尾空白、转小写；格式不对返回 null。 */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return CODE_RE.test(value) ? value.toLowerCase() : null;
}

/** 现在能不能用：没停用、没过期、次数没用完。 */
export function inviteUsable(invite: Pick<InviteCode, "disabled" | "expires_at" | "max_uses" | "used_count">, now: number): boolean {
  return !invite.disabled && (invite.expires_at === null || invite.expires_at > now) && (invite.max_uses === null || invite.used_count < invite.max_uses);
}

/**
 * 兑换一次：条件更新 `used_count + 1`，只在能用时成功，并发的两个注册不会把最后一次用两遍。
 * 必须在调用方的事务里调用：建号失败回滚时这次兑换也一起回滚。
 */
export function redeemInvite(db: Database.Database, raw: unknown, now: number): { ok: true; id: number } | { ok: false; reason: InviteRefusal } {
  const code = normalizeInviteCode(raw);
  if (!code) return { ok: false, reason: "invalid_invite" };
  const row = db.prepare(`UPDATE invite_codes SET used_count = used_count + 1, updated_at = ?
    WHERE code = ? AND disabled = 0 AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR used_count < max_uses)
    RETURNING id`).get(now, code, now) as { id: number } | undefined;
  return row ? { ok: true, id: row.id } : { ok: false, reason: "invalid_invite" };
}

export class InviteCodeError extends Error {
  constructor(readonly code: "invite_code_taken" | "invalid_invite_code", message: string) { super(message); this.name = "InviteCodeError"; }
}

export function createInviteCodeStore(db: Database.Database, clock: () => number = Date.now) {
  function list(): (InviteCode & { usable: boolean })[] {
    const now = clock();
    return (db.prepare(`SELECT ${COLUMNS} FROM invite_codes ORDER BY created_at DESC, id DESC`).all() as InviteRow[])
      .map(toInvite).map(invite => ({ ...invite, usable: inviteUsable(invite, now) }));
  }
  function get(id: number): InviteCode | null {
    const row = db.prepare(`SELECT ${COLUMNS} FROM invite_codes WHERE id = ?`).get(id) as InviteRow | undefined;
    return row ? toInvite(row) : null;
  }
  /** 新建一个邀请码；同名（不分大小写）已存在时抛 invite_code_taken。 */
  function create(input: InviteInput, actor: string): InviteCode {
    const code = normalizeInviteCode(input.code);
    if (!code || !CREATE_CODE_RE.test(code)) throw new InviteCodeError("invalid_invite_code", "邀请码只能用 8–40 位字母、数字、- 和 _");
    const now = clock();
    try {
      const { lastInsertRowid } = db.prepare(`INSERT INTO invite_codes(code, note, max_uses, expires_at, disabled, created_by, created_at, updated_at)
        VALUES(?, ?, ?, ?, 0, ?, ?, ?)`).run(code, (input.note ?? "").trim(), input.max_uses ?? null, input.expires_at ?? null, actor, now, now);
      return get(Number(lastInsertRowid))!;
    } catch (error) {
      if ((error as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new InviteCodeError("invite_code_taken", "已经有同名的邀请码");
      throw error;
    }
  }
  /** 改备注、次数上限、过期时间或停用；返回改动的字段名，不存在时返回 null。邀请码本身不能改，要换就新建一个。 */
  function update(id: number, patch: InvitePatch): string[] | null {
    const current = get(id);
    if (!current) return null;
    const columns: string[] = [];
    const values: unknown[] = [];
    const next: Record<string, unknown> = {
      note: patch.note === undefined ? undefined : patch.note.trim(),
      max_uses: patch.max_uses,
      expires_at: patch.expires_at,
      disabled: patch.disabled === undefined ? undefined : patch.disabled ? 1 : 0,
    };
    const was: Record<string, unknown> = { ...current, disabled: current.disabled ? 1 : 0 };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === was[key]) continue;
      columns.push(`${key} = ?`); values.push(value);
    }
    if (columns.length === 0) return [];
    db.prepare(`UPDATE invite_codes SET ${columns.join(", ")}, updated_at = ? WHERE id = ?`).run(...values, clock(), id);
    return columns.map(column => column.split(" ")[0]);
  }
  return { list, get, create, update };
}
export type InviteCodeStore = ReturnType<typeof createInviteCodeStore>;
