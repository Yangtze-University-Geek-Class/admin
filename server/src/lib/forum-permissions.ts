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
