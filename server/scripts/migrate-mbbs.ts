import Database from "better-sqlite3";
import { resolve } from "node:path";
import { forumDb } from "../src/lib/forum-db.js";

const MBBS_DB = process.argv[2] ?? resolve(process.cwd(), "forum-migration/bbs.db");

console.log(`reading mbbs db: ${MBBS_DB}`);
const mbbs = new Database(MBBS_DB, { readonly: true });

function toMs(dt: string | null | undefined): number {
  if (!dt) return Date.now();
  const parsed = Date.parse(dt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function slugify(s: string, fallback: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[\s　]+/g, "-")
    .replace(/[^a-z0-9一-龥-]/g, "")
    .slice(0, 32);
  return cleaned || fallback;
}

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 6);
}

const counts = { users: 0, categories: 0, tags: 0, threads: 0, posts: 0 };

forumDb.transaction(() => {
  forumDb.exec(`DELETE FROM forum_user_groups;
                DELETE FROM forum_group_permissions;
                DELETE FROM forum_groups;
                DELETE FROM forum_thread_tags;
                DELETE FROM forum_posts;
                DELETE FROM forum_threads;
                DELETE FROM forum_tags;
                DELETE FROM forum_categories;
                DELETE FROM forum_users;
                DELETE FROM sqlite_sequence WHERE name LIKE 'forum_%';`);

  const insertUser = forumDb.prepare(`
    INSERT INTO forum_users (
      username, display_name, password_bcrypt, email, avatar_url, signature,
      role, legacy_mbbs_id, legacy_qq_uid, thread_count, post_count, liked_count,
      last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const rawUsers = mbbs
    .prepare(
      `SELECT id, username, password, nickname, email, signature, avatar, status,
              login_at, joined_at, created_at, updated_at,
              thread_count, post_count, liked_count
       FROM users WHERE deleted_at IS NULL ORDER BY id`,
    )
    .all() as any[];

  const usedUsernames = new Set<string>();
  for (const u of rawUsers) {
    let username = u.username as string;
    let qqUid: string | null = null;
    if (username.startsWith("[QQ]UID_")) {
      qqUid = username.slice("[QQ]UID_".length);
      const base = slugify(u.nickname ?? "qq", `qq${u.id}`);
      username = `${base}-${shortHash(qqUid)}`;
    } else {
      username = username.replace(/[^a-zA-Z0-9_\-一-龥]/g, "").slice(0, 32) || `user${u.id}`;
    }
    let final = username;
    let n = 1;
    while (usedUsernames.has(final)) final = `${username}-${++n}`;
    usedUsernames.add(final);

    const avatar = u.avatar ? `/forum/r/${u.avatar}` : null;
    const role = u.status === 0 ? "member" : u.status === 2 ? "banned" : "member";

    insertUser.run(
      final,
      u.nickname ?? final,
      u.password ?? null,
      u.email ?? null,
      avatar,
      u.signature ?? null,
      role,
      u.id,
      qqUid,
      u.thread_count ?? 0,
      u.post_count ?? 0,
      u.liked_count ?? 0,
      u.login_at ? toMs(u.login_at) : null,
      toMs(u.created_at),
      toMs(u.updated_at),
    );
    counts.users++;
  }
  const mbbsIdToUserId = new Map<number, number>();
  for (const row of forumDb.prepare("SELECT id, legacy_mbbs_id FROM forum_users WHERE legacy_mbbs_id IS NOT NULL").all() as any[]) {
    mbbsIdToUserId.set(row.legacy_mbbs_id, row.id);
  }
  if (mbbsIdToUserId.size === 1 && rawUsers.length > 0) {
    const adminUser = forumDb.prepare("SELECT id FROM forum_users WHERE legacy_mbbs_id = 1").get() as any;
    if (adminUser) forumDb.prepare("UPDATE forum_users SET role = 'admin' WHERE id = ?").run(adminUser.id);
  } else {
    const admin = forumDb.prepare("SELECT id FROM forum_users WHERE legacy_mbbs_id = 1").get() as any;
    if (admin) forumDb.prepare("UPDATE forum_users SET role = 'admin' WHERE id = ?").run(admin.id);
  }
  console.log(`migrated users: ${counts.users}`);

  const insertCat = forumDb.prepare(`
    INSERT INTO forum_categories (
      slug, name, description, icon, color, parent_id, sort, hidden, thread_count,
      legacy_mbbs_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const rawCats = mbbs
    .prepare(
      `SELECT id, name, description, icon, sort, parent_category_id, hidden, thread_count,
              create_thread_template, home_ui_tip, created_at, updated_at
       FROM categories WHERE deleted_at IS NULL ORDER BY COALESCE(parent_category_id, 0), sort, id`,
    )
    .all() as any[];

  const usedSlugs = new Set<string>();
  const mbbsCatToId = new Map<number, number>();
  for (const c of rawCats) {
    let slug = slugify(c.name, `cat-${c.id}`);
    let final = slug;
    let n = 1;
    while (usedSlugs.has(final)) final = `${slug}-${++n}`;
    usedSlugs.add(final);
    const parentId = c.parent_category_id ? mbbsCatToId.get(c.parent_category_id) ?? null : null;
    const r = insertCat.run(
      final,
      c.name,
      c.description ?? null,
      c.icon ? `/forum/r/${c.icon}` : null,
      null,
      parentId,
      c.sort ?? 0,
      c.hidden ? 1 : 0,
      0,
      c.id,
      toMs(c.created_at),
      toMs(c.updated_at),
    );
    mbbsCatToId.set(c.id, Number(r.lastInsertRowid));
    counts.categories++;
  }
  console.log(`migrated categories: ${counts.categories}`);

  const insertTag = forumDb.prepare(`
    INSERT INTO forum_tags (slug, name, color, bg_color, description, legacy_mbbs_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const rawTags = mbbs.prepare("SELECT * FROM thread_tag WHERE deletedAt IS NULL ORDER BY id").all() as any[];
  const mbbsTagToId = new Map<number, number>();
  const usedTagSlugs = new Set<string>();
  for (const t of rawTags) {
    let slug = slugify(t.name, `tag-${t.id}`);
    let final = slug;
    let n = 1;
    while (usedTagSlugs.has(final)) final = `${slug}-${++n}`;
    usedTagSlugs.add(final);
    const r = insertTag.run(
      final,
      t.name,
      t.color ?? null,
      t.bgcolor ?? null,
      t.description ?? null,
      t.id,
      toMs(t.created_at),
    );
    mbbsTagToId.set(t.id, Number(r.lastInsertRowid));
    counts.tags++;
  }
  console.log(`migrated tags: ${counts.tags}`);

  const insertThread = forumDb.prepare(`
    INSERT INTO forum_threads (
      category_id, user_id, title, content, content_format, view_count, reply_count,
      is_sticky, is_essence, is_locked, is_deleted, last_posted_user_id, last_posted_at,
      legacy_mbbs_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertThreadTag = forumDb.prepare(
    "INSERT INTO forum_thread_tags (thread_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
  );
  const rawThreads = mbbs.prepare("SELECT * FROM threads ORDER BY id").all() as any[];
  const firstPostByThread = new Map<number, any>();
  for (const p of mbbs.prepare("SELECT * FROM posts WHERE is_first = 1").all() as any[]) {
    firstPostByThread.set(p.thread_id, p);
  }
  const mbbsThreadToId = new Map<number, number>();
  for (const t of rawThreads) {
    const userId = mbbsIdToUserId.get(t.user_id);
    const catId = mbbsCatToId.get(t.category_id);
    if (!userId || !catId) continue;
    const firstPost = firstPostByThread.get(t.id);
    const content = firstPost?.content ?? t.content_for_indexes ?? "";
    const r = insertThread.run(
      catId,
      userId,
      t.title ?? "(无标题)",
      content,
      "html",
      t.view_count ?? 0,
      Math.max(0, (t.post_count ?? 0) - 1),
      t.is_sticky ?? 0,
      t.is_essence ?? 0,
      0,
      t.deleted_at ? 1 : 0,
      mbbsIdToUserId.get(t.last_posted_user_id ?? t.user_id) ?? userId,
      toMs(t.posted_at ?? t.modified_at ?? t.created_at),
      t.id,
      toMs(t.created_at),
      toMs(t.updated_at),
    );
    const newThreadId = Number(r.lastInsertRowid);
    mbbsThreadToId.set(t.id, newThreadId);
    if (t.thread_tag_ids) {
      const ids = String(t.thread_tag_ids).split(/[,\s]+/).filter(Boolean).map(Number);
      for (const tid of ids) {
        const mappedTag = mbbsTagToId.get(tid);
        if (mappedTag) insertThreadTag.run(newThreadId, mappedTag);
      }
    }
    counts.threads++;
  }
  console.log(`migrated threads: ${counts.threads}`);

  const insertPost = forumDb.prepare(`
    INSERT INTO forum_posts (
      thread_id, user_id, reply_post_id, content, content_format, like_count,
      is_deleted, legacy_mbbs_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const rawPosts = mbbs
    .prepare("SELECT * FROM posts WHERE is_first = 0 ORDER BY id")
    .all() as any[];
  const mbbsPostToId = new Map<number, number>();
  for (const p of rawPosts) {
    const tId = mbbsThreadToId.get(p.thread_id);
    const uId = mbbsIdToUserId.get(p.user_id);
    if (!tId || !uId) continue;
    const replyToNew = p.reply_post_id ? mbbsPostToId.get(p.reply_post_id) ?? null : null;
    const r = insertPost.run(
      tId,
      uId,
      replyToNew,
      p.content ?? "",
      "html",
      p.like_count ?? 0,
      p.deleted_at ? 1 : 0,
      p.id,
      toMs(p.created_at),
      toMs(p.updated_at),
    );
    mbbsPostToId.set(p.id, Number(r.lastInsertRowid));
    counts.posts++;
  }
  console.log(`migrated posts: ${counts.posts}`);

  forumDb
    .prepare(
      `UPDATE forum_categories SET thread_count = (
         SELECT COUNT(*) FROM forum_threads WHERE category_id = forum_categories.id AND is_deleted = 0
       )`,
    )
    .run();

  // groups
  const insertGroup = forumDb.prepare(
    `INSERT INTO forum_groups (name, icon, is_default, sort, legacy_mbbs_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const rawGroups = mbbs
    .prepare("SELECT * FROM groups WHERE deleted_at IS NULL ORDER BY id")
    .all() as any[];
  const mbbsGroupToId = new Map<number, number>();
  let groupSort = 0;
  for (const g of rawGroups) {
    const icon = g.icon ? `/forum/r/${g.icon}` : null;
    const r = insertGroup.run(
      g.name,
      icon,
      g.default ? 1 : 0,
      groupSort++,
      g.id,
      toMs(g.created_at),
      toMs(g.updated_at),
    );
    mbbsGroupToId.set(g.id, Number(r.lastInsertRowid));
  }
  console.log(`migrated groups: ${rawGroups.length}`);

  // group permissions
  const insertGroupPerm = forumDb.prepare(
    "INSERT OR IGNORE INTO forum_group_permissions (group_id, permission) VALUES (?, ?)",
  );
  const rawPerms = mbbs.prepare("SELECT * FROM group_permission").all() as any[];
  let permCount = 0;
  for (const p of rawPerms) {
    const newGid = mbbsGroupToId.get(p.group_id);
    if (!newGid) continue;
    insertGroupPerm.run(newGid, p.permission);
    permCount++;
  }
  console.log(`migrated group permissions: ${permCount}`);

  // user group memberships
  const insertUserGroup = forumDb.prepare(
    "INSERT OR IGNORE INTO forum_user_groups (user_id, group_id) VALUES (?, ?)",
  );
  const rawUserGroups = mbbs.prepare("SELECT * FROM group_user").all() as any[];
  let ugCount = 0;
  for (const ug of rawUserGroups) {
    const newUid = mbbsIdToUserId.get(ug.user_id);
    const newGid = mbbsGroupToId.get(ug.group_id);
    if (!newUid || !newGid) continue;
    insertUserGroup.run(newUid, newGid);
    ugCount++;
  }
  console.log(`migrated user group memberships: ${ugCount}`);

  // admin user (legacy_mbbs_id=1) into 系统管理员 group
  const adminGroup = forumDb
    .prepare("SELECT id FROM forum_groups WHERE name = '系统管理员' OR legacy_mbbs_id = 6 LIMIT 1")
    .get() as any;
  const adminUser = forumDb
    .prepare("SELECT id FROM forum_users WHERE legacy_mbbs_id = 1")
    .get() as any;
  if (adminGroup && adminUser) {
    insertUserGroup.run(adminUser.id, adminGroup.id);
  }
})();

mbbs.close();
console.log(JSON.stringify({ ok: true, counts }));
