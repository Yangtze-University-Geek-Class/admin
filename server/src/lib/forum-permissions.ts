import { forumDb } from "./forum-db.js";

export function getUserPermissions(userId: number): Set<string> {
  const directRows = forumDb
    .prepare(
      `SELECT DISTINCT p.permission FROM forum_group_permissions p
       JOIN forum_user_groups ug ON ug.group_id = p.group_id
       WHERE ug.user_id = ?`,
    )
    .all(userId) as any[];
  const defaultRows = forumDb
    .prepare(
      `SELECT DISTINCT p.permission FROM forum_group_permissions p
       JOIN forum_groups g ON g.id = p.group_id
       WHERE g.is_default = 1`,
    )
    .all() as any[];
  const out = new Set<string>();
  for (const r of directRows) out.add(r.permission);
  for (const r of defaultRows) out.add(r.permission);
  return out;
}

export function getGuestPermissions(): Set<string> {
  const rows = forumDb
    .prepare(
      `SELECT DISTINCT p.permission FROM forum_group_permissions p
       JOIN forum_groups g ON g.id = p.group_id
       WHERE g.is_default = 1`,
    )
    .all() as any[];
  return new Set(rows.map((r) => r.permission));
}

export function getUserGroups(userId: number) {
  return forumDb
    .prepare(
      `SELECT g.id, g.name, g.icon, g.color, g.is_default
       FROM forum_groups g
       JOIN forum_user_groups ug ON ug.group_id = g.id
       WHERE ug.user_id = ?
       ORDER BY g.sort, g.id`,
    )
    .all(userId);
}

export function hasPermission(userId: number | null, permission: string, role?: string): boolean {
  if (role === "admin" || role === "mod") return true;
  const perms = userId == null ? getGuestPermissions() : getUserPermissions(userId);
  if (perms.has(permission)) return true;
  return false;
}

export function hasCategoryPermission(userId: number | null, categoryLegacyId: number | null, base: string, role?: string): boolean {
  if (role === "admin" || role === "mod") return true;
  const perms = userId == null ? getGuestPermissions() : getUserPermissions(userId);
  if (perms.has(base)) return true;
  if (categoryLegacyId != null && perms.has(`category${categoryLegacyId}.${base}`)) return true;
  return false;
}

const TEACHER_GROUP_NAME = "老师";
const ADMIN_GROUP_NAME = "负责人";
const MEMBER_GROUP_NAME = "成员";

export function ensureGroup(name: string, isDefault: 0 | 1, sort: number, color: string | null, description: string) {
  const existing = forumDb.prepare("SELECT id FROM forum_groups WHERE name = ?").get(name) as any;
  if (existing) return existing.id as number;
  const now = Date.now();
  const r = forumDb
    .prepare(
      "INSERT INTO forum_groups (name, description, color, is_default, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(name, description, color, isDefault, sort, now, now);
  return Number(r.lastInsertRowid);
}

// Maps a user's role to the matching forum group membership. Called whenever a
// user is created (password register / GitHub OAuth / admin create) or their
// role changes, so every account lands in a group that grants posting rights.
// Without this a new "member" only inherits the default 游客 group (view-only)
// and gets HTTP 403 "你所在的组没有发帖权限" on thread.create.
export function syncRoleToGroup(userId: number, role: string) {
  const adminGid = ensureGroup(ADMIN_GROUP_NAME, 0, 3, "#003F88", "管理员，拥有全部权限");
  const memberGid = ensureGroup(MEMBER_GROUP_NAME, 0, 2, "#0969da", "登录用户");
  const teacherGid = ensureGroup(TEACHER_GROUP_NAME, 0, 4, "#7C3AED", "校内老师，可查看全部状态");
  forumDb
    .prepare("DELETE FROM forum_user_groups WHERE user_id = ? AND group_id IN (?, ?, ?)")
    .run(userId, adminGid, memberGid, teacherGid);
  const ins = forumDb.prepare("INSERT OR IGNORE INTO forum_user_groups (user_id, group_id) VALUES (?, ?)");
  if (role === "admin" || role === "mod") ins.run(userId, adminGid);
  else if (role === "teacher") ins.run(userId, teacherGid);
  else if (role === "member") ins.run(userId, memberGid);
}
