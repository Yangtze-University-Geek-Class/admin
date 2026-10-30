import { describe, expect, it } from "vitest";
import { createDatabase } from "../../app/server/src/lib/db";
import { archiveOldDepartments, groupSeeds, runYugcV2Migration } from "../../app/server/src/lib/migrations/2026-10-yugc-v2";
import { createRoleStore } from "../../app/server/src/lib/role-store";

/**
 * #274 迁移脚本（SPEC §3.6）。`createDatabase(':memory:')` 在构造时已经跑过一次迁移
 * （db.ts 的 `yugcV2Migration` 常量），这里测的是：种子的形状对不对、按账号状态分身份对不对、
 * role_assignments 映射对不对、旧表归档、forum_users 回填、account_profiles 建档、
 * audit_logs 复制，以及——最关键的——重跑一遍是不是真的零变化。
 * 迁移演练（对预发布库真实数据跑两遍、核对行数表）另见执行记录，这里只测脚本本身的逻辑。
 */

function makeStorage() {
  return createDatabase(":memory:");
}

describe("种子（节点、组、继承、默认条目）", () => {
  it("组的数量和 groupSeeds() 一致，且已经写进数据库", () => {
    const { db } = makeStorage();
    const count = (db.prepare("SELECT COUNT(*) AS n FROM perm_groups").get() as { n: number }).n;
    expect(count).toBe(groupSeeds().length);
  });

  it("perm_nodes 镜像了 permission-nodes.ts 的全部节点", () => {
    const { db } = makeStorage();
    const count = (db.prepare("SELECT COUNT(*) AS n FROM perm_nodes").get() as { n: number }).n;
    expect(count).toBeGreaterThan(40);
    expect(db.prepare("SELECT meta FROM perm_nodes WHERE node = 'meta.limit.apply.daily'").get()).toEqual({ meta: 1 });
  });

  it("第二次运行不再新增任何组或条目（幂等）", () => {
    const { db } = makeStorage();
    const before = {
      groups: (db.prepare("SELECT COUNT(*) AS n FROM perm_groups").get() as { n: number }).n,
      entries: (db.prepare("SELECT COUNT(*) AS n FROM perm_entries").get() as { n: number }).n,
      parents: (db.prepare("SELECT COUNT(*) AS n FROM perm_group_parents").get() as { n: number }).n,
    };
    const report = runYugcV2Migration(db, Date.now());
    const after = {
      groups: (db.prepare("SELECT COUNT(*) AS n FROM perm_groups").get() as { n: number }).n,
      entries: (db.prepare("SELECT COUNT(*) AS n FROM perm_entries").get() as { n: number }).n,
      parents: (db.prepare("SELECT COUNT(*) AS n FROM perm_group_parents").get() as { n: number }).n,
    };
    expect(after).toEqual(before);
    for (const row of report.tables) expect(row.after, `${row.table} 在零输入变化下不应该变化`).toBe(row.before);
  });
});

describe("按账号状态分身份（SPEC §3.6 第 2 条）", () => {
  function makeUser(db: ReturnType<typeof makeStorage>["db"], overrides: Partial<{ org_role: string; invite_code_id: number }> = {}) {
    const id = `acct-${Math.random().toString(36).slice(2)}`;
    const now = Date.now();
    db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES (?, ?, ?)").run(id, now, now);
    if (overrides.org_role) db.prepare("UPDATE users SET org_role = ? WHERE id = ?").run(overrides.org_role, id);
    if (overrides.invite_code_id) db.prepare("UPDATE users SET invite_code_id = ? WHERE id = ?").run(overrides.invite_code_id, id);
    return id;
  }
  function levelOf(db: ReturnType<typeof makeStorage>["db"], accountId: string): string | undefined {
    return (db.prepare("SELECT group_id FROM perm_members pm JOIN perm_groups g ON g.id = pm.group_id WHERE pm.account_id = ? AND g.kind = 'level'").get(accountId) as { group_id: string } | undefined)?.group_id;
  }

  it("org_role=admin 进 level.member 并且是站长", () => {
    const { db } = makeStorage();
    const account = makeUser(db, { org_role: "admin" });
    runYugcV2Migration(db, Date.now());
    expect(levelOf(db, account)).toBe("level.member");
    expect(db.prepare("SELECT 1 FROM perm_members WHERE account_id = ? AND group_id = 'title.site.owner'").get(account)).toBeTruthy();
  });

  it("org_role=member 进 level.member", () => {
    const { db } = makeStorage();
    const account = makeUser(db, { org_role: "member" });
    runYugcV2Migration(db, Date.now());
    expect(levelOf(db, account)).toBe("level.member");
  });

  it("其余的进 level.registered", () => {
    const { db } = makeStorage();
    const account = makeUser(db);
    runYugcV2Migration(db, Date.now());
    expect(levelOf(db, account)).toBe("level.registered");
  });

  it("重跑不覆盖已经分过的身份", () => {
    const { db } = makeStorage();
    const account = makeUser(db); // 先分到 level.registered
    runYugcV2Migration(db, Date.now());
    expect(levelOf(db, account)).toBe("level.registered");
    db.prepare("UPDATE users SET org_role = 'admin' WHERE id = ?").run(account); // 事后改 org_role，模拟「控制台后来改过」
    runYugcV2Migration(db, Date.now());
    expect(levelOf(db, account)).toBe("level.registered"); // 不会被重新分成 member
  });
});

describe("role_assignments 映射（SPEC §3.6 第 3 条）", () => {
  it("head 角色先进 dept.none，并出现在迁移报告的 unmapped_heads 里", () => {
    const { db } = makeStorage();
    const now = Date.now();
    const account = `acct-head`;
    db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES (?, ?, ?)").run(account, now, now);
    db.prepare("INSERT INTO role_assignments(github_login, role, department_id, granted_by, created_at, account_id) VALUES ('old-head', 'head', 'tech', 'test', ?, ?)").run(now, account);
    const report = runYugcV2Migration(db, now);
    expect(db.prepare("SELECT 1 FROM perm_members WHERE account_id = ? AND group_id = 'dept.none'").get(account)).toBeTruthy();
    expect(report.unmapped_heads.some(item => item.github_login === "old-head" && item.department_id === "tech")).toBe(true);
  });

  it("captain 角色对应站长，alumni 角色对应往届成员", () => {
    const { db } = makeStorage();
    const now = Date.now();
    const captain = "acct-captain", alumni = "acct-alumni";
    for (const id of [captain, alumni]) db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES (?, ?, ?)").run(id, now, now);
    db.prepare("INSERT INTO role_assignments(github_login, role, department_id, granted_by, created_at, account_id) VALUES ('c', 'captain', '', 'test', ?, ?)").run(now, captain);
    db.prepare("INSERT INTO role_assignments(github_login, role, department_id, granted_by, created_at, account_id) VALUES ('a', 'alumni', '', 'test', ?, ?)").run(now, alumni);
    runYugcV2Migration(db, now);
    expect(db.prepare("SELECT 1 FROM perm_members WHERE account_id = ? AND group_id = 'title.site.owner'").get(captain)).toBeTruthy();
    expect(db.prepare("SELECT group_id FROM perm_members pm JOIN perm_groups g ON g.id = pm.group_id WHERE pm.account_id = ? AND g.kind = 'level'").get(alumni)).toEqual({ group_id: "level.alumni" });
  });

  it("已经是成员的账号不会被旧的 alumni 记录降级", () => {
    const { db } = makeStorage();
    const now = Date.now();
    const account = "acct-member-then-alumni-row";
    db.prepare("INSERT INTO users(id, org_role, created_at, updated_at) VALUES (?, 'member', ?, ?)").run(account, now, now);
    db.prepare("INSERT INTO role_assignments(github_login, role, department_id, granted_by, created_at, account_id) VALUES ('x', 'alumni', '', 'test', ?, ?)").run(now, account);
    runYugcV2Migration(db, now);
    expect(db.prepare("SELECT group_id FROM perm_members pm JOIN perm_groups g ON g.id = pm.group_id WHERE pm.account_id = ? AND g.kind = 'level'").get(account)).toEqual({ group_id: "level.member" });
  });
});

describe("旧部门归档（SPEC §3.6 第 4 条，函数已就绪，services.ts 暂不调用）", () => {
  it("createRoleStore() 播种默认部门之后调用 archiveOldDepartments()，4 个旧部门全部 archived=1，不删除", () => {
    // 真实启动顺序会是：createDatabase()（迁移在这里面跑）→ createRoleStore()（这时才播种默认部门）
    // → archiveOldDepartments()，但 services.ts 现在还没接这最后一步——roles.ts 的旧 capabilities
    // 系统仍按「未归档部门」算 headOf，归档会让它当场失效；要等 Phase 2b 把 requireCapability 换成
    // requirePermission 之后才能一起打开。这里只验证函数本身按预期顺序调用时行为正确。
    const { db } = makeStorage();
    createRoleStore(db);
    archiveOldDepartments(db);
    const rows = db.prepare("SELECT id, archived FROM departments").all() as { id: string; archived: number }[];
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every(row => row.archived === 1)).toBe(true);
  });
});

describe("forum_users.account_id 回填（SPEC §3.6 第 5 条）", () => {
  it("能找到对应 GitHub 身份的论坛作者被关联，找不到的保留原样", () => {
    const { db } = makeStorage();
    const now = Date.now();
    const account = "acct-forum-link";
    db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES (?, ?, ?)").run(account, now, now);
    db.prepare("INSERT INTO identities(id, user_id, provider, provider_uid, created_at) VALUES ('id-1', ?, 'github', '88888', ?)").run(account, now);
    db.prepare("INSERT INTO forum_users(id, kind, github_user_id, username, display_name, avatar_color, joined_at, updated_at) VALUES ('fu-linked', 'member', 88888, 'linked-author', '老作者', '#000', ?, ?)").run(now, now);
    db.prepare("INSERT INTO forum_users(id, kind, github_user_id, username, display_name, avatar_color, joined_at, updated_at) VALUES ('fu-orphan', 'member', 77777, 'orphan-author', '没账号的老作者', '#000', ?, ?)").run(now, now);
    runYugcV2Migration(db, now);
    expect((db.prepare("SELECT account_id FROM forum_users WHERE id = 'fu-linked'").get() as { account_id: string }).account_id).toBe(account);
    expect((db.prepare("SELECT account_id FROM forum_users WHERE id = 'fu-orphan'").get() as { account_id: string | null }).account_id).toBeNull();
  });
});

describe("account_profiles 建档（SPEC §3.6 第 6 条）", () => {
  it("用户名重复时加数字后缀，论坛已有资料的沿用论坛的", () => {
    const { db } = makeStorage();
    const now = Date.now();
    const a = "acct-profile-a", b = "acct-profile-b";
    db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES (?, ?, ?)").run(a, now, now);
    db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES (?, ?, ?)").run(b, now, now);
    db.prepare("INSERT INTO identities(id, user_id, provider, provider_uid, login, created_at) VALUES ('id-a', ?, 'github', '1', 'fixtureowner', ?)").run(a, now);
    db.prepare("INSERT INTO identities(id, user_id, provider, provider_uid, email, created_at) VALUES ('id-b', ?, 'email', 'e2', 'fixtureowner@example.test', ?)").run(b, now);
    db.prepare("INSERT INTO forum_users(id, kind, username, display_name, bio, avatar_color, account_id, joined_at, updated_at) VALUES ('fu-a', 'member', 'fixtureforum', '论坛昵称', '简介', '#111', ?, ?, ?)").run(a, now, now);
    runYugcV2Migration(db, now);
    const profileA = db.prepare("SELECT username, display_name, bio FROM account_profiles WHERE account_id = ?").get(a) as { username: string; display_name: string; bio: string };
    const profileB = db.prepare("SELECT username FROM account_profiles WHERE account_id = ?").get(b) as { username: string };
    expect(profileA.username).toBe("fixtureowner");
    expect(profileA.display_name).toBe("论坛昵称"); // 论坛已有资料的沿用论坛头像/昵称
    expect(profileB.username).toBe("fixtureowner2"); // 邮箱前缀撞上 github 登录名，加后缀
  });

  it("论坛作者的头像字节一并搬进 account_avatars，不是只搬 hash（#274 残留修复 H）", () => {
    const { db } = makeStorage();
    const now = Date.now();
    const account = "acct-avatar-copy";
    const hash = "deadbeef".repeat(8); // 64 hex 字符，占位用，不校验真实图片内容
    const bytes = Buffer.from("fake webp bytes");
    db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES (?, ?, ?)").run(account, now, now);
    db.prepare("INSERT INTO forum_avatars(hash, data, created_at) VALUES (?, ?, ?)").run(hash, bytes, now);
    db.prepare(
      "INSERT INTO forum_users(id, kind, username, display_name, bio, avatar_color, avatar_hash, account_id, joined_at, updated_at) VALUES ('fu-avatar', 'member', 'avatar-author', '有头像的作者', '', '#222', ?, ?, ?, ?)",
    ).run(hash, account, now, now);
    runYugcV2Migration(db, now);
    const profile = db.prepare("SELECT avatar_hash FROM account_profiles WHERE account_id = ?").get(account) as { avatar_hash: string };
    expect(profile.avatar_hash).toBe(hash);
    const copied = db.prepare("SELECT data, mime FROM account_avatars WHERE hash = ?").get(hash) as { data: Buffer; mime: string } | undefined;
    expect(copied).toBeTruthy();
    expect(copied!.data.equals(bytes)).toBe(true); // 字节原样搬过去，不是重新编码
    expect(copied!.mime).toBe("image/webp");
  });
});

describe("audit_logs → activity_events（SPEC §3.6 第 7 条，按水位线增量）", () => {
  it("复制一次之后，重跑不会产生重复行", () => {
    const { db } = makeStorage();
    const now = Date.now();
    db.prepare("INSERT INTO audit_logs(actor, action, created_at) VALUES ('tester', 'auth.signin', ?)").run(now);
    db.prepare("INSERT INTO audit_logs(actor, action, created_at) VALUES ('tester', 'auth.signin', ?)").run(now);
    const firstRun = runYugcV2Migration(db, now);
    expect(firstRun.activity_events_copied_this_run).toBe(2);
    const total = (db.prepare("SELECT COUNT(*) AS n FROM activity_events").get() as { n: number }).n;
    const secondRun = runYugcV2Migration(db, now);
    expect(secondRun.activity_events_copied_this_run).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM activity_events").get() as { n: number }).n).toBe(total);
  });

  it("邀请链接 token 复制时只留前 6 位，不把完整 token 搬进新表（#274 残留修复 I）", () => {
    const { db } = makeStorage();
    const now = Date.now();
    const token = "abcdef0123456789fulltoken";
    db.prepare("INSERT INTO audit_logs(actor, action, target, created_at) VALUES ('fixtureowner', 'invite_link.create', ?, ?)").run(token, now);
    db.prepare("INSERT INTO audit_logs(actor, action, created_at) VALUES (?, 'invite.sent', ?)").run(`public:${token}`, now);
    runYugcV2Migration(db, now);
    const linkRow = db.prepare("SELECT target_id FROM activity_events WHERE action = 'invite_link.create'").get() as { target_id: string };
    expect(linkRow.target_id).toBe("abcdef…");
    const sentRow = db.prepare("SELECT meta FROM activity_events WHERE action = 'invite.sent'").get() as { meta: string };
    expect(JSON.parse(sentRow.meta).legacy_actor).toBe("public:abcdef…");
  });
});

describe("迁移报告：旧能力对照", () => {
  it("找不到新节点的旧能力（GitHub 组织管理类）列在 unmapped_capabilities 里，不静默丢弃", () => {
    const { db } = makeStorage();
    const report = runYugcV2Migration(db, Date.now());
    expect(report.unmapped_capabilities).toContain("github.org.read");
    expect(report.unmapped_capabilities).toContain("github.invites.manage");
    expect(report.unmapped_capabilities).not.toContain("roles.manage");
  });

  it("role_assignments 里 account_id 为空的行数，原样计入 skipped_role_assignments（#274 残留修复 N）", () => {
    const { db } = makeStorage();
    const now = Date.now();
    db.prepare("INSERT INTO role_assignments(github_login, role, department_id, granted_by, created_at, account_id) VALUES ('ghost', 'member', '', 'test', ?, NULL)").run(now);
    const report = runYugcV2Migration(db, now);
    expect(report.skipped_role_assignments).toBe(1);
  });
});

describe("种子台账：所有者的改动不会被重跑覆盖（#274 残留修复 C，blocker）", () => {
  it("撤销一个由 role_assignments captain 映射出来的站长，重跑不会被种回来", () => {
    const { db } = makeStorage();
    const now = Date.now();
    const account = "acct-captain-revoke";
    db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES (?, ?, ?)").run(account, now, now);
    db.prepare("INSERT INTO role_assignments(github_login, role, department_id, granted_by, created_at, account_id) VALUES ('c', 'captain', '', 'test', ?, ?)").run(now, account);
    runYugcV2Migration(db, now);
    expect(db.prepare("SELECT 1 FROM perm_members WHERE account_id = ? AND group_id = 'title.site.owner'").get(account)).toBeTruthy();
    db.prepare("DELETE FROM perm_members WHERE account_id = ? AND group_id = 'title.site.owner'").run(account); // 所有者在控制台撤销
    runYugcV2Migration(db, Date.now());
    expect(db.prepare("SELECT 1 FROM perm_members WHERE account_id = ? AND group_id = 'title.site.owner'").get(account)).toBeFalsy();
  });

  it("删掉一条种子条目，重跑不会把它种回来", () => {
    const { db } = makeStorage();
    expect(db.prepare("SELECT 1 FROM perm_entries WHERE subject_type = 'group' AND subject_id = 'level.member' AND node = 'forum.topic.create'").get()).toBeTruthy();
    db.prepare("DELETE FROM perm_entries WHERE subject_type = 'group' AND subject_id = 'level.member' AND node = 'forum.topic.create'").run(); // 所有者删掉这条
    runYugcV2Migration(db, Date.now());
    expect(db.prepare("SELECT 1 FROM perm_entries WHERE subject_type = 'group' AND subject_id = 'level.member' AND node = 'forum.topic.create'").get()).toBeFalsy();
  });

  it("删掉一条种子继承边，重跑不会把它种回来", () => {
    const { db } = makeStorage();
    expect(db.prepare("SELECT 1 FROM perm_group_parents WHERE group_id = 'level.registered' AND parent_id = 'level.visitor'").get()).toBeTruthy();
    db.prepare("DELETE FROM perm_group_parents WHERE group_id = 'level.registered' AND parent_id = 'level.visitor'").run();
    runYugcV2Migration(db, Date.now());
    expect(db.prepare("SELECT 1 FROM perm_group_parents WHERE group_id = 'level.registered' AND parent_id = 'level.visitor'").get()).toBeFalsy();
  });

  it("收紧一条 meta 限额条目之后，重跑不会把它放宽回种子的值", () => {
    const { db } = makeStorage();
    const before = db.prepare("SELECT meta_value FROM perm_entries WHERE subject_type = 'group' AND subject_id = 'level.member' AND node = 'meta.limit.apply.daily'").get() as { meta_value: string };
    expect(before.meta_value).toBe("-1"); // 种子给的是不限
    db.prepare("UPDATE perm_entries SET meta_value = '5' WHERE subject_type = 'group' AND subject_id = 'level.member' AND node = 'meta.limit.apply.daily'").run(); // 所有者收紧到 5
    runYugcV2Migration(db, Date.now());
    const after = db.prepare("SELECT meta_value FROM perm_entries WHERE subject_type = 'group' AND subject_id = 'level.member' AND node = 'meta.limit.apply.daily'").get() as { meta_value: string };
    expect(after.meta_value).toBe("5");
  });

  it("alumni 记录映射之后所有者把账号降级，重跑不会把账号升回往届成员", () => {
    const { db } = makeStorage();
    const now = Date.now();
    const account = "acct-alumni-demote";
    db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES (?, ?, ?)").run(account, now, now);
    db.prepare("INSERT INTO role_assignments(github_login, role, department_id, granted_by, created_at, account_id) VALUES ('a', 'alumni', '', 'test', ?, ?)").run(now, account);
    runYugcV2Migration(db, now);
    expect(db.prepare("SELECT group_id FROM perm_members pm JOIN perm_groups g ON g.id = pm.group_id WHERE pm.account_id = ? AND g.kind = 'level'").get(account)).toEqual({ group_id: "level.alumni" });
    // 所有者后来把这个账号降回注册用户
    db.prepare("DELETE FROM perm_members WHERE account_id = ? AND group_id = 'level.alumni'").run(account);
    db.prepare("INSERT INTO perm_members(account_id, group_id, expires_at, granted_by, created_at) VALUES (?, 'level.registered', NULL, 'test', ?)").run(account, Date.now());
    runYugcV2Migration(db, Date.now());
    expect(db.prepare("SELECT group_id FROM perm_members pm JOIN perm_groups g ON g.id = pm.group_id WHERE pm.account_id = ? AND g.kind = 'level'").get(account)).toEqual({ group_id: "level.registered" });
  });

  it("head 记录映射进 dept.none 之后所有者改派了真实部门，重跑不会把账号塞回 dept.none", () => {
    const { db } = makeStorage();
    const now = Date.now();
    const account = "acct-head-reassign";
    db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES (?, ?, ?)").run(account, now, now);
    db.prepare("INSERT INTO role_assignments(github_login, role, department_id, granted_by, created_at, account_id) VALUES ('h', 'head', 'tech', 'test', ?, ?)").run(now, account);
    runYugcV2Migration(db, now);
    expect(db.prepare("SELECT 1 FROM perm_members WHERE account_id = ? AND group_id = 'dept.none'").get(account)).toBeTruthy();
    // 站长在控制台把这个账号改派到 AI 部门
    db.prepare("DELETE FROM perm_members WHERE account_id = ? AND group_id = 'dept.none'").run(account);
    db.prepare("INSERT INTO perm_members(account_id, group_id, expires_at, granted_by, created_at) VALUES (?, 'dept.ai', NULL, 'test', ?)").run(account, Date.now());
    runYugcV2Migration(db, Date.now());
    expect(db.prepare("SELECT group_id FROM perm_members pm JOIN perm_groups g ON g.id = pm.group_id WHERE pm.account_id = ? AND g.kind = 'department'").get(account)).toEqual({ group_id: "dept.ai" });
  });

  it("升级老库时，台账第一次创建按现状回填，不会把现有的组、边、条目、映射重新种一遍", () => {
    const { db } = makeStorage(); // createDatabase() 已经跑过一次迁移，台账已经按这次的种子结果建好
    const beforeCounts = {
      groups: (db.prepare("SELECT COUNT(*) AS n FROM perm_groups").get() as { n: number }).n,
      entries: (db.prepare("SELECT COUNT(*) AS n FROM perm_entries").get() as { n: number }).n,
      parents: (db.prepare("SELECT COUNT(*) AS n FROM perm_group_parents").get() as { n: number }).n,
      ledger: (db.prepare("SELECT COUNT(*) AS n FROM perm_seed_applied").get() as { n: number }).n,
    };
    expect(beforeCounts.ledger).toBeGreaterThan(0); // 第一次迁移已经把台账填满
    runYugcV2Migration(db, Date.now());
    const after = {
      groups: (db.prepare("SELECT COUNT(*) AS n FROM perm_groups").get() as { n: number }).n,
      entries: (db.prepare("SELECT COUNT(*) AS n FROM perm_entries").get() as { n: number }).n,
      parents: (db.prepare("SELECT COUNT(*) AS n FROM perm_group_parents").get() as { n: number }).n,
      ledger: (db.prepare("SELECT COUNT(*) AS n FROM perm_seed_applied").get() as { n: number }).n,
    };
    expect(after).toEqual(beforeCounts); // 台账不是空表，不会再触发回填，也不会重新种
  });
});
