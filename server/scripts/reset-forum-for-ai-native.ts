import { forumDb } from "../src/lib/forum-db.js";

const NEW_CATEGORIES = [
  { slug: "models", name: "模型与基础", description: "新模型发布、benchmark、scaling 与架构讨论", sort: 1 },
  { slug: "agent-mcp", name: "Agent 与 MCP", description: "Agent 框架、MCP server、工具调用、orchestration", sort: 2 },
  { slug: "ai-coding", name: "AI Coding", description: "Claude Code / Cursor / Aider / Codex 实战与 Skill 分享", sort: 3 },
  { slug: "prompt", name: "Prompt 与上下文工程", description: "Prompt 设计、CoT、RAG、上下文窗口管理", sort: 4 },
  { slug: "products", name: "应用与产品", description: "AI-first 产品 case study、设计、商业化", sort: 5 },
  { slug: "help-resources", name: "求助与资源", description: "新手提问、论文、教程、开源项目分享", sort: 6 },
];

const GROUPS = [
  { name: "游客", description: "未登录用户，仅可浏览", icon: null, color: "#9CA3AF", is_default: 1, sort: 1, permissions: ["thread.view", "post.view"] },
  { name: "成员", description: "登录用户，可发帖回帖", icon: null, color: "#0969da", is_default: 0, sort: 2, permissions: ["thread.view", "post.view", "thread.create", "thread.reply", "thread.like", "thread.editOwn", "thread.hideOwn", "attachment.upload"] },
  { name: "负责人", description: "管理员，拥有全部权限", icon: null, color: "#003F88", is_default: 0, sort: 3, permissions: ["thread.view", "post.view", "thread.create", "thread.reply", "thread.like", "thread.editOwn", "thread.hideOwn", "thread.editAny", "thread.hideAny", "thread.sticky", "thread.essence", "thread.lock", "user.editAny", "group.manage", "category.manage", "attachment.upload"] },
];

const now = Date.now();

forumDb.transaction(() => {
  // mark legacy categories
  const updated = forumDb
    .prepare("UPDATE forum_categories SET is_legacy = 1 WHERE legacy_mbbs_id IS NOT NULL")
    .run();
  console.log(`marked legacy categories: ${updated.changes}`);

  // wipe old groups + perms + memberships (mbbs leftover); we rebuild from scratch
  forumDb.exec(`
    DELETE FROM forum_user_groups;
    DELETE FROM forum_group_permissions;
    DELETE FROM forum_groups;
    DELETE FROM sqlite_sequence WHERE name IN ('forum_groups','forum_group_permissions','forum_user_groups');
  `);

  const insertGroup = forumDb.prepare(
    "INSERT INTO forum_groups (name, description, icon, color, is_default, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertPerm = forumDb.prepare("INSERT INTO forum_group_permissions (group_id, permission) VALUES (?, ?)");
  const groupIdByName = new Map<string, number>();
  for (const g of GROUPS) {
    const r = insertGroup.run(g.name, g.description, g.icon, g.color, g.is_default, g.sort, now, now);
    const gid = Number(r.lastInsertRowid);
    groupIdByName.set(g.name, gid);
    for (const p of g.permissions) insertPerm.run(gid, p);
  }
  console.log(`created groups: ${GROUPS.length}`);

  // assign memberships based on forum_users.role
  const memberGid = groupIdByName.get("成员")!;
  const adminGid = groupIdByName.get("负责人")!;
  const insertMember = forumDb.prepare("INSERT OR IGNORE INTO forum_user_groups (user_id, group_id) VALUES (?, ?)");
  const users = forumDb.prepare("SELECT id, role FROM forum_users").all() as any[];
  for (const u of users) {
    if (u.role === "admin" || u.role === "mod") insertMember.run(u.id, adminGid);
    else insertMember.run(u.id, memberGid);
  }
  console.log(`assigned memberships for ${users.length} users`);

  // create new AI Native categories (idempotent on slug)
  const upsertCat = forumDb.prepare(
    `INSERT INTO forum_categories (slug, name, description, sort, hidden, thread_count, is_legacy, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET name=excluded.name, description=excluded.description, sort=excluded.sort, is_legacy=0, updated_at=excluded.updated_at`,
  );
  for (const c of NEW_CATEGORIES) {
    upsertCat.run(c.slug, c.name, c.description, c.sort, now, now);
  }
  console.log(`seeded AI Native categories: ${NEW_CATEGORIES.length}`);
})();

console.log("reset done");
