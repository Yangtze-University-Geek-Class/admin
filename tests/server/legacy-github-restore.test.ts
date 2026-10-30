import { describe, expect, it } from "vitest";
import { createDatabase } from "../../app/server/src/lib/db";
import { runYugcV2Migration } from "../../app/server/src/lib/migrations/2026-10-yugc-v2";
import { setExclusiveGroupMembership } from "../../app/server/src/lib/permissions";

/**
 * #306：v0.1.1 升级后旧 GitHub 用户没有账号、已建账号全落在注册用户。这里按生产当时的形状造库：
 * 旧会话里只有少数人未过期（已建账号、停在 level.registered、两条名册被预先记成已映射），
 * 其余人只存在于 forum_users 与 role_assignments。
 */

type Db = ReturnType<typeof createDatabase>["db"];
const CUTOFF = 5_000;
const BEFORE = 1_000;
const NOW = 9_000;

function bareDb(): Db {
  const { db } = createDatabase(":memory:");
  // createDatabase 构造时已经跑过一遍迁移并占掉了一次性标记；回到「刚升级到 0.1.1、还没跑补齐」的状态
  db.prepare("DELETE FROM console_seeds WHERE name IN ('legacy_github_v1', 'legacy_github_v1_levels')").run();
  db.prepare("UPDATE console_seeds SET seeded_at = ? WHERE name = 'identity_v1'").run(CUTOFF);
  return db;
}
function forumUser(db: Db, id: string, githubId: number | null, username: string, role: string, joinedAt = BEFORE, kind = "member") {
  db.prepare(`INSERT INTO forum_users(id, kind, github_user_id, username, display_name, avatar_color, github_avatar_url, role, joined_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '#000', ?, ?, ?, ?)`).run(id, kind, githubId, username, `${username} 昵称`, githubId ? `https://avatars.test/${githubId}` : null, role, joinedAt, joinedAt);
}
function roster(db: Db, login: string, githubId: number, role: string, accountId: string | null = null) {
  return Number(db.prepare("INSERT INTO role_assignments(github_login, github_user_id, role, department_id, granted_by, created_at, account_id) VALUES (?, ?, ?, '', 'test', ?, ?)")
    .run(login, githubId, role, BEFORE, accountId).lastInsertRowid);
}
function existingAccount(db: Db, id: string, githubId: number, login: string, grantedBy: string) {
  db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES (?, ?, ?)").run(id, BEFORE, BEFORE);
  db.prepare("INSERT INTO identities(id, user_id, provider, provider_uid, login, created_at) VALUES (?, ?, 'github', ?, ?, ?)").run(`i-${id}`, id, String(githubId), login, BEFORE);
  setExclusiveGroupMembership(db, id, "level.registered", BEFORE, grantedBy);
}
const level = (db: Db, accountId: string) =>
  (db.prepare("SELECT group_id FROM perm_members pm JOIN perm_groups g ON g.id = pm.group_id WHERE pm.account_id = ? AND g.kind = 'level'").get(accountId) as { group_id: string } | undefined)?.group_id;
const accountOfGithub = (db: Db, githubId: number) =>
  (db.prepare("SELECT user_id FROM identities WHERE provider = 'github' AND provider_uid = ?").get(String(githubId)) as { user_id: string } | undefined)?.user_id;
const hasOwner = (db: Db, accountId: string) => !!db.prepare("SELECT 1 FROM perm_members WHERE account_id = ? AND group_id = 'title.site.owner'").get(accountId);
const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

function productionShape(): Db {
  const db = bareDb();
  // 已建账号：所有者（论坛旧管理员）、有名册的 Cyclara、没有名册的论坛成员 quest
  forumUser(db, "fu-owner", 100, "fixture-owner", "admin");
  forumUser(db, "fu-cyclara", 101, "Cyclara", "member");
  forumUser(db, "fu-quest", 102, "quest-123", "member");
  existingAccount(db, "acct-owner", 100, "fixture-owner", "migration:2026-10-yugc-v2");
  existingAccount(db, "acct-cyclara", 101, "Cyclara", "migration:2026-10-yugc-v2");
  existingAccount(db, "acct-quest", 102, "quest-123", "migration:2026-10-yugc-v2");
  db.prepare("UPDATE forum_users SET account_id = 'acct-owner' WHERE id = 'fu-owner'").run();
  db.prepare("UPDATE forum_users SET account_id = 'acct-cyclara' WHERE id = 'fu-cyclara'").run();
  db.prepare("UPDATE forum_users SET account_id = 'acct-quest' WHERE id = 'fu-quest'").run();
  const cyclaraRoster = roster(db, "cyclara", 101, "member", "acct-cyclara");
  db.prepare("INSERT OR IGNORE INTO perm_seed_applied(key, applied_at) VALUES (?, ?)").run(`role_assignment:${cyclaraRoster}`, BEFORE);
  // 没有账号的旧用户：论坛成员 B、只在名册里的 D、往届 G、升级之后才注册的 E、没有 GitHub id 的官方号 F
  forumUser(db, "fu-b", 201, "member-b", "member");
  forumUser(db, "fu-roster-also", 202, "roster-forum", "member");
  roster(db, "roster-forum", 202, "member");
  roster(db, "roster-only", 203, "member");
  roster(db, "old-alumni", 204, "alumni");
  forumUser(db, "fu-late", 205, "late-comer", "member", CUTOFF + 1);
  forumUser(db, "u-geekclass", null, "geekclass", "admin", BEFORE, "official");
  return db;
}

describe("旧 GitHub 用户账号补齐（#306）", () => {
  it("有论坛记录或名册的旧用户都有账号和 GitHub 身份，论坛用户与名册被认领", () => {
    const db = productionShape();
    const before = { forum: count(db, "forum_users"), roster: count(db, "role_assignments"), users: count(db, "users") };
    const report = runYugcV2Migration(db, NOW);

    for (const githubId of [201, 202, 203, 204]) expect(accountOfGithub(db, githubId), `GitHub ${githubId}`).toBeTruthy();
    expect(report.legacy_github.ran).toBe(true);
    expect(report.legacy_github.created).toBe(4);
    expect(count(db, "users")).toBe(before.users + 4);
    expect(count(db, "forum_users")).toBe(before.forum);
    expect(count(db, "role_assignments")).toBe(before.roster);

    const identity = db.prepare("SELECT login, avatar_url FROM identities WHERE provider = 'github' AND provider_uid = '201'").get() as { login: string; avatar_url: string | null };
    expect(identity).toEqual({ login: "member-b", avatar_url: "https://avatars.test/201" });
    expect(db.prepare("SELECT account_id FROM forum_users WHERE id = 'fu-b'").get()).toEqual({ account_id: accountOfGithub(db, 201) });
    expect(db.prepare("SELECT account_id FROM role_assignments WHERE github_login = 'roster-only'").get()).toEqual({ account_id: accountOfGithub(db, 203) });
    expect(count(db, "account_profiles")).toBe(count(db, "users"));
  });

  it("成员资格按旧记录恢复：论坛成员与名册成员是成员，往届是往届成员", () => {
    const db = productionShape();
    runYugcV2Migration(db, NOW);
    expect(level(db, accountOfGithub(db, 201)!)).toBe("level.member");
    expect(level(db, accountOfGithub(db, 202)!)).toBe("level.member");
    expect(level(db, accountOfGithub(db, 203)!)).toBe("level.member");
    expect(level(db, accountOfGithub(db, 204)!)).toBe("level.alumni");
  });

  it("已建账号：论坛旧管理员恢复成成员与站长，名册成员被映射，论坛成员恢复成成员", () => {
    const db = productionShape();
    const report = runYugcV2Migration(db, NOW);
    expect(level(db, "acct-owner")).toBe("level.member");
    expect(hasOwner(db, "acct-owner")).toBe(true);
    expect(level(db, "acct-cyclara")).toBe("level.member");
    expect(level(db, "acct-quest")).toBe("level.member");
    expect(hasOwner(db, "acct-cyclara")).toBe(false);
    expect(hasOwner(db, "acct-quest")).toBe(false);
    expect(report.legacy_github.ledger_reset).toBe(1);
    expect(report.legacy_github.levels_repaired).toBe(2);
  });

  it("升级之后才出现的人、没有 GitHub id 的官方号不补账号，也不会被提成成员", () => {
    const db = productionShape();
    runYugcV2Migration(db, NOW);
    expect(accountOfGithub(db, 205)).toBeUndefined();
    expect(db.prepare("SELECT account_id FROM forum_users WHERE id = 'fu-late'").get()).toEqual({ account_id: null });
    expect(db.prepare("SELECT account_id FROM forum_users WHERE id = 'u-geekclass'").get()).toEqual({ account_id: null });
  });

  it("升级后用 GitHub 登录过、停在 github-signin 注册用户的旧成员也恢复，邀请码或控制台设定的不动", () => {
    const db = bareDb();
    forumUser(db, "fu-signed", 300, "signed-in", "member");
    existingAccount(db, "acct-signed", 300, "signed-in", "github-signin");
    db.prepare("UPDATE users SET org_state = 'not_member' WHERE id = 'acct-signed'").run();
    forumUser(db, "fu-demoted", 301, "demoted-by-owner", "member");
    existingAccount(db, "acct-demoted", 301, "demoted-by-owner", "console:owner");
    runYugcV2Migration(db, NOW);
    expect(level(db, "acct-signed")).toBe("level.member");
    expect(db.prepare("SELECT org_state, org_role FROM users WHERE id = 'acct-signed'").get()).toEqual({ org_state: "active", org_role: "member" });
    expect(level(db, "acct-demoted")).toBe("level.registered");
  });

  it("只跑一次：重跑不增加账号，之后被降回自动授予的注册用户的也不会再被提成成员", () => {
    const db = productionShape();
    runYugcV2Migration(db, NOW);
    const users = count(db, "users");
    const identities = count(db, "identities");
    // 第一次之后再把成员降回「自动授予」来源的注册用户：没有一次性标记的话，重跑会把它改回成员
    setExclusiveGroupMembership(db, "acct-quest", "level.registered", NOW + 1, "github-signin");
    setExclusiveGroupMembership(db, "acct-cyclara", "level.registered", NOW + 1, "migration:2026-10-yugc-v2");
    const again = runYugcV2Migration(db, NOW + 2);
    expect(again.legacy_github.ran).toBe(false);
    expect(again.legacy_github.levels_repaired).toBe(0);
    expect(count(db, "users")).toBe(users);
    expect(count(db, "identities")).toBe(identities);
    expect(level(db, "acct-quest")).toBe("level.registered");
    expect(level(db, "acct-cyclara")).toBe("level.registered");
  });

  it("只补不删：旧表整行不变（只允许 account_id 从空变成账号），其余表行数不减", () => {
    const db = productionShape();
    db.prepare("INSERT INTO sessions(id, login, user_id, avatar_url, access_token_encrypted, created_at, expires_at) VALUES ('s-old', 'member-b', 201, NULL, 'x', ?, ?)").run(BEFORE, NOW * 1000);
    db.prepare("INSERT INTO audit_logs(actor, action, created_at) VALUES ('tester', 'auth.signin', ?)").run(BEFORE);
    const snapshot = () => ({
      forum: db.prepare("SELECT id, kind, github_user_id, username, display_name, bio, role, joined_at, updated_at FROM forum_users ORDER BY id").all(),
      roster: db.prepare("SELECT id, github_login, github_user_id, role, department_id, note, granted_by, created_at FROM role_assignments ORDER BY id").all(),
      sessions: db.prepare("SELECT * FROM sessions ORDER BY id").all(),
      audit: db.prepare("SELECT actor, action, created_at FROM audit_logs WHERE action = 'auth.signin' ORDER BY id").all(),
    });
    const before = snapshot();
    const identityBefore = db.prepare("SELECT id, user_id, provider_uid, login FROM identities ORDER BY id").all();
    runYugcV2Migration(db, NOW);
    expect(snapshot()).toEqual(before);
    const identityAfter = db.prepare("SELECT id, user_id, provider_uid, login FROM identities ORDER BY id").all();
    for (const row of identityBefore) expect(identityAfter).toContainEqual(row);
    expect(count(db, "users")).toBeGreaterThan(3);
  });

  it("升级后才登记论坛行的 GitHub 登录账号不会被提成成员；名册里的舰长得到站长，往届名册加论坛成员行只是往届", () => {
    const db = bareDb();
    forumUser(db, "fu-late-signed", 310, "late-signed", "member", CUTOFF + 10);
    existingAccount(db, "acct-late", 310, "late-signed", "github-signin");
    db.prepare("UPDATE users SET org_state = 'not_member' WHERE id = 'acct-late'").run();
    forumUser(db, "fu-captain", 311, "the-captain", "member");
    roster(db, "the-captain", 311, "captain");
    forumUser(db, "fu-alumnus", 312, "the-alumnus", "member");
    roster(db, "the-alumnus", 312, "alumni");
    runYugcV2Migration(db, NOW);
    expect(level(db, "acct-late")).toBe("level.registered");
    expect(db.prepare("SELECT org_state, org_role FROM users WHERE id = 'acct-late'").get()).toEqual({ org_state: "not_member", org_role: null });
    expect(hasOwner(db, accountOfGithub(db, 311)!)).toBe(true);
    expect(level(db, accountOfGithub(db, 312)!)).toBe("level.alumni");
  });

  it("所有者在控制台设成「不是成员」的旧用户：等级、站内角色字段都不改，台账键保留", () => {
    const db = bareDb();
    forumUser(db, "fu-removed", 320, "removed-by-owner", "member");
    existingAccount(db, "acct-removed", 320, "removed-by-owner", "console:set-site-role");
    db.prepare("UPDATE users SET org_state = 'not_member', org_role = NULL WHERE id = 'acct-removed'").run();
    const rosterId = roster(db, "removed-by-owner", 320, "member", "acct-removed");
    db.prepare("INSERT OR IGNORE INTO perm_seed_applied(key, applied_at) VALUES (?, ?)").run(`role_assignment:${rosterId}`, BEFORE);
    const report = runYugcV2Migration(db, NOW);
    expect(level(db, "acct-removed")).toBe("level.registered");
    expect(db.prepare("SELECT org_state, org_role FROM users WHERE id = 'acct-removed'").get()).toEqual({ org_state: "not_member", org_role: null });
    expect(db.prepare("SELECT 1 FROM perm_seed_applied WHERE key = ?").get(`role_assignment:${rosterId}`)).toBeTruthy();
    expect(report.legacy_github.ledger_reset).toBe(0);
  });

  it("全新空库：一次性标记写好，不建任何账号", () => {
    const { db } = createDatabase(":memory:");
    expect(db.prepare("SELECT name FROM console_seeds WHERE name LIKE 'legacy_github%' ORDER BY name").all()).toEqual([{ name: "legacy_github_v1" }, { name: "legacy_github_v1_levels" }]);
    expect(count(db, "users")).toBe(0);
  });

  it("补建账号留一条系统审计，只记数量", () => {
    const db = productionShape();
    runYugcV2Migration(db, NOW);
    const row = db.prepare("SELECT details FROM audit_logs WHERE action = 'identity.legacy_restore'").get() as { details: string };
    expect(JSON.parse(row.details)).toMatchObject({ created: 4, ledger_reset: 1 });
    expect(row.details).not.toContain("member-b");
  });
});

describe("名册台账不再预先记账（#306）", () => {
  it("台账为空时，账号还没有任何权限成员记录的名册行仍会被映射", () => {
    const { db } = createDatabase(":memory:");
    db.prepare("DELETE FROM perm_seed_applied").run();
    db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES ('acct-fresh', ?, ?)").run(BEFORE, BEFORE);
    roster(db, "fresh", 400, "member", "acct-fresh");
    runYugcV2Migration(db, NOW);
    expect(level(db, "acct-fresh")).toBe("level.member");
  });

  it("账号已经有权限成员记录的名册行照旧记成已映射，不会被重新映射", () => {
    const { db } = createDatabase(":memory:");
    db.prepare("DELETE FROM perm_seed_applied").run();
    db.prepare("INSERT INTO users(id, created_at, updated_at) VALUES ('acct-done', ?, ?)").run(BEFORE, BEFORE);
    setExclusiveGroupMembership(db, "acct-done", "level.registered", BEFORE, "console:owner");
    const id = roster(db, "done", 401, "member", "acct-done");
    runYugcV2Migration(db, NOW);
    expect(db.prepare("SELECT 1 FROM perm_seed_applied WHERE key = ?").get(`role_assignment:${id}`)).toBeTruthy();
    expect(level(db, "acct-done")).toBe("level.registered");
  });
});
