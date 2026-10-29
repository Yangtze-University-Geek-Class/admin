import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { exportSubjects, importSubjects } from "../../deploy/gitlab/migrate-oidc-subjects.mjs";

// GitLab 改接另一个环境的统一登录前搬 sub（#309）：只按不可变身份对账，只新增，冲突整批拒绝。
const Database = createRequire(resolve(process.cwd(), "app/server/package.json"))("better-sqlite3");
const SECTOR = "git.example.test";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function database(users: Array<{ id: string; identities?: Array<[string, string]>; sub?: string; orgRole?: 'admin' | 'member' | null }>) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', org_state TEXT NOT NULL DEFAULT 'active', org_role TEXT);
    CREATE TABLE identities(user_id TEXT, provider TEXT, provider_uid TEXT, login TEXT);
    CREATE TABLE oauth_subjects(sector_id TEXT NOT NULL, user_id TEXT NOT NULL, sub TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(sector_id, user_id), UNIQUE(sector_id, sub));`);
  for (const user of users) {
    db.prepare("INSERT INTO users(id, org_role) VALUES(?, ?)").run(user.id, user.orgRole ?? null);
    for (const [provider, uid] of user.identities ?? []) db.prepare("INSERT INTO identities VALUES(?,?,?,?)").run(user.id, provider, uid, provider === 'github' ? `user-${uid}` : null);
    if (user.sub) db.prepare("INSERT INTO oauth_subjects VALUES(?,?,?,?)").run(SECTOR, user.id, user.sub, 1);
  }
  return db;
}
const rows = (db: any) => db.prepare("SELECT user_id, sub FROM oauth_subjects WHERE sector_id = ? ORDER BY user_id").all(SECTOR);

describe("export", () => {
  it("按不可变身份导出 sub，没有可对账身份的账号只计数", () => {
    const db = database([
      { id: "p1", identities: [["github", "100"]], sub: "sub-a", orgRole: "member" },
      { id: "p2", identities: [["github", "200"], ["google", "g-1"]], sub: "sub-b" },
      { id: "p3", sub: "sub-c" },
      { id: "p4", identities: [["github", "400"]] },
    ]);
    const out = exportSubjects(db, SECTOR);
    expect(out.withoutIdentity).toBe(1);
    expect(out.entries).toEqual([
      { sub: "sub-a", identities: [{ provider: "github", provider_uid: "100" }], provision: { github_login: "user-100", org_role: "member" } },
      { sub: "sub-b", identities: [{ provider: "github", provider_uid: "200" }, { provider: "google", provider_uid: "g-1" }] },
    ]);
  });

  it("sector 不是主机名时拒绝", () => {
    expect(() => exportSubjects(database([]), "x'; DROP TABLE oauth_subjects;--")).toThrow(/主机名/);
  });
});

describe("import", () => {
  const payload = { sector: SECTOR, entries: [
    { sub: "sub-a", identities: [{ provider: "github", provider_uid: "100" }] },
    { sub: "sub-b", identities: [{ provider: "github", provider_uid: "200" }] },
    { sub: "sub-z", identities: [{ provider: "github", provider_uid: "999" }] },
  ] };
  const target = () => database([{ id: "q1", identities: [["github", "100"]] }, { id: "q2", identities: [["github", "200"]] }, { id: "q3", identities: [["github", "300"]] }]);

  it("缺省只演算：报出可迁、对不上的，不写库", () => {
    const db = target();
    const result = importSubjects(db, payload, { sector: SECTOR });
    expect(result.plan.map(p => [p.userId, p.sub])).toEqual([["q1", "sub-a"], ["q2", "sub-b"]]);
    expect(result.unmatched).toEqual(["github:999"]);
    expect(result.applied).toBe(0);
    expect(rows(db)).toEqual([]);
  });

  it("--apply 在一个事务里新增，之后再跑一遍没有可迁的", () => {
    const db = target();
    const complete = { ...payload, entries: payload.entries.slice(0, 2) };
    expect(importSubjects(db, complete, { sector: SECTOR, apply: true, now: 7 }).applied).toBe(2);
    expect(rows(db)).toEqual([{ user_id: "q1", sub: "sub-a" }, { user_id: "q2", sub: "sub-b" }]);
    const again = importSubjects(db, complete, { sector: SECTOR, apply: true });
    expect(again).toMatchObject({ plan: [], conflicts: [], applied: 0 });
  });

  it('目标身份缺失或源账号没有不可变身份时，拒绝整批写入', () => {
    const missing = target();
    const result = importSubjects(missing, payload, { sector: SECTOR, apply: true });
    expect(result.unmatched).toEqual(['github:999']);
    expect(result.applied).toBe(0);
    expect(rows(missing)).toEqual([]);
    const noIdentity = target();
    const unprovable = importSubjects(noIdentity, { ...payload, entries: payload.entries.slice(0, 2), withoutIdentity: 1 }, { sector: SECTOR, apply: true });
    expect(unprovable.withoutIdentity).toBe(1);
    expect(unprovable.applied).toBe(0);
    expect(rows(noIdentity)).toEqual([]);
  });

  it("目标库已有不同的 sub、或 sub 已属于别人时记冲突，整批都不写", () => {
    const db = target();
    db.prepare("INSERT INTO oauth_subjects VALUES(?,?,?,?)").run(SECTOR, "q1", "other-sub", 1);
    const result = importSubjects(db, payload, { sector: SECTOR, apply: true });
    expect(result.conflicts).toEqual(["github:100：目标库该账号已有不同的 sub"]);
    expect(result.applied).toBe(0);
    expect(rows(db)).toEqual([{ user_id: "q1", sub: "other-sub" }]);

    const taken = target();
    taken.prepare("INSERT INTO oauth_subjects VALUES(?,?,?,?)").run(SECTOR, "q3", "sub-b", 1);
    expect(importSubjects(taken, payload, { sector: SECTOR, apply: true }).conflicts).toEqual(["github:200：这个 sub 已属于目标库的另一个账号"]);
  });

  it("两个身份对到目标库不同账号时记冲突，不猜", () => {
    const db = target();
    const split = { sector: SECTOR, entries: [{ sub: "sub-a", identities: [{ provider: "github", provider_uid: "100" }, { provider: "github", provider_uid: "300" }] }] };
    expect(importSubjects(db, split, { sector: SECTOR }).conflicts).toHaveLength(1);
  });

  it("显式允许时才按 GitHub UID 最小补建缺失成员，并保留原 sub", () => {
    const db = target();
    const source = { sector: SECTOR, entries: [{ sub: "sub-legacy", identities: [{ provider: "github", provider_uid: "999" }], provision: { github_login: "legacy-member", org_role: "member" } }] };
    const provisionAccount = ({ githubId, githubLogin, orgRole }: { githubId: number; githubLogin: string; orgRole: string }) => {
      db.prepare("INSERT INTO users(id, org_role) VALUES('new-member', ?)").run(orgRole);
      db.prepare("INSERT INTO identities VALUES('new-member','github',?,?)").run(String(githubId), githubLogin);
      return { accountId: "new-member", created: true };
    };
    // 不带补建的演算（切签发者、开正式写者之前的门禁）仍然算对不上
    expect(importSubjects(db, source, { sector: SECTOR, provisionAccount })).toMatchObject({ unmatched: ["github:999"], provisionable: [] });
    // 带补建的演算（停预发布写者之前）：写入时能补建的单独计数，不算对不上，也不建号
    const dry = importSubjects(db, source, { sector: SECTOR, provisionUnmatched: true, provisionAccount });
    expect(dry).toMatchObject({ unmatched: [], provisionable: ["github:999"], provisioned: [], applied: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'new-member'").get().n).toBe(0);
    const google = { sector: SECTOR, entries: [{ ...source.entries[0], identities: [...source.entries[0].identities, { provider: "google", provider_uid: "g-1" }] }] };
    expect(importSubjects(db, google, { sector: SECTOR, provisionUnmatched: true, provisionAccount })).toMatchObject({ unmatched: ["github:999,google:g-1"], provisionable: [] });
    // 补建出来的账号要拿的 sub 已经属于目标库的别人：演算就报冲突
    db.prepare("INSERT INTO users(id, org_role) VALUES('someone', 'member')").run();
    db.prepare("INSERT INTO oauth_subjects VALUES(?,?,?,?)").run(SECTOR, "someone", "sub-legacy", 1);
    expect(importSubjects(db, source, { sector: SECTOR, provisionUnmatched: true, provisionAccount })).toMatchObject({ provisionable: [], conflicts: ["github:999：这个 sub 已属于目标库的另一个账号"] });
    db.prepare("DELETE FROM oauth_subjects WHERE user_id = 'someone'").run();
    const applied = importSubjects(db, source, { sector: SECTOR, apply: true, provisionUnmatched: true, provisionAccount });
    expect(applied).toMatchObject({ applied: 1, conflicts: [], unmatched: [] });
    expect(applied.provisioned).toEqual([{ label: "github:999", accountId: "new-member", created: true }]);
    expect(rows(db)).toEqual([{ user_id: "new-member", sub: "sub-legacy" }]);
  });

  it("补建后 sub 冲突或建号失败时回滚这个账号，不留下半条迁移", () => {
    const db = target();
    db.prepare("INSERT INTO oauth_subjects VALUES(?,?,?,?)").run(SECTOR, "q3", "sub-legacy", 1);
    const source = { sector: SECTOR, entries: [{ sub: "sub-legacy", identities: [{ provider: "github", provider_uid: "999" }], provision: { github_login: "legacy-member", org_role: "member" } }] };
    const provisionAccount = () => {
      db.prepare("INSERT INTO users(id, org_role) VALUES('new-member', 'member')").run();
      db.prepare("INSERT INTO identities VALUES('new-member','github','999','legacy-member')").run();
      return { accountId: "new-member", created: true };
    };
    const result = importSubjects(db, source, { sector: SECTOR, apply: true, provisionUnmatched: true, provisionAccount });
    expect(result.conflicts).toEqual(["github:999：这个 sub 已属于目标库的另一个账号"]);
    expect(result.provisioned).toEqual([]);
    expect(result.applied).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'new-member'").get().n).toBe(0);
    expect(rows(db)).toEqual([{ user_id: "q3", sub: "sub-legacy" }]);
  });

  it("输入不是同一个 sector 的 export 结果时拒绝", () => {
    expect(() => importSubjects(target(), { sector: "other.example.test", entries: [] }, { sector: SECTOR })).toThrow(/同一个 sector/);
  });
});

describe("命令行", () => {
  it("export 与 import 走真实文件库，演算不改库，--apply 才写", () => {
    const dir = mkdtempSync(join(tmpdir(), "oidc-sub-"));
    dirs.push(dir);
    const script = resolve(process.cwd(), "deploy/gitlab/migrate-oidc-subjects.mjs");
    const dbFile = (name: string, users: Parameters<typeof database>[0]) => {
      const path = join(dir, name);
      const db = new Database(path);
      db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', org_state TEXT NOT NULL DEFAULT 'active', org_role TEXT);
        CREATE TABLE identities(user_id TEXT, provider TEXT, provider_uid TEXT, login TEXT);
        CREATE TABLE oauth_subjects(sector_id TEXT NOT NULL, user_id TEXT NOT NULL, sub TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(sector_id, user_id), UNIQUE(sector_id, sub));`);
      for (const user of users) {
        db.prepare("INSERT INTO users(id, org_role) VALUES(?, ?)").run(user.id, user.orgRole ?? null);
        for (const [provider, uid] of user.identities ?? []) db.prepare("INSERT INTO identities VALUES(?,?,?,?)").run(user.id, provider, uid, provider === 'github' ? `user-${uid}` : null);
        if (user.sub) db.prepare("INSERT INTO oauth_subjects VALUES(?,?,?,?)").run(SECTOR, user.id, user.sub, 1);
      }
      db.close();
      return path;
    };
    const source = dbFile("source.db", [{ id: "p1", identities: [["github", "100"]], sub: "sub-a" }]);
    const dest = dbFile("dest.db", [{ id: "q1", identities: [["github", "100"]] }]);
    const exported = spawnSync("node", [script, "export", "--sector", SECTOR], { env: { ...process.env, DB_PATH: source }, encoding: "utf8" });
    expect(exported.status, exported.stderr).toBe(0);
    const dry = spawnSync("node", [script, "import", "--sector", SECTOR], { env: { ...process.env, DB_PATH: dest }, input: exported.stdout, encoding: "utf8" });
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("演算 sector=git.example.test：可迁 1，冲突 0，目标库对不上 0");
    const applied = spawnSync("node", [script, "import", "--sector", SECTOR, "--apply"], { env: { ...process.env, DB_PATH: dest }, input: exported.stdout, encoding: "utf8" });
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stdout).toContain("已写入 1");
    expect(applied.stdout).toContain("回滚：DELETE FROM oauth_subjects");
    expect(applied.stdout).not.toContain("sub-a");
  });

  it("export 的输出超过管道缓冲（64KB）、对端读得慢时也不被截断", () => {
    const dir = mkdtempSync(join(tmpdir(), "oidc-sub-big-"));
    dirs.push(dir);
    const script = resolve(process.cwd(), "deploy/gitlab/migrate-oidc-subjects.mjs");
    const path = join(dir, "big.db");
    const db = new Database(path);
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', org_state TEXT NOT NULL DEFAULT 'active', org_role TEXT);
      CREATE TABLE identities(user_id TEXT, provider TEXT, provider_uid TEXT, login TEXT);
      CREATE TABLE oauth_subjects(sector_id TEXT NOT NULL, user_id TEXT NOT NULL, sub TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(sector_id, user_id), UNIQUE(sector_id, sub));`);
    db.transaction(() => {
      for (let i = 0; i < 1500; i += 1) {
        db.prepare("INSERT INTO users(id) VALUES(?)").run(`u${i}`);
        db.prepare("INSERT INTO identities VALUES(?,?,?,?)").run(`u${i}`, "github", String(100000 + i), `user-${100000 + i}`);
        db.prepare("INSERT INTO oauth_subjects VALUES(?,?,?,?)").run(SECTOR, `u${i}`, `subject-${"x".repeat(40)}-${i}`, 1);
      }
    })();
    const expected = `${JSON.stringify(exportSubjects(db, SECTOR))}\n`;
    db.close();
    expect(expected.length).toBeGreaterThan(150_000);
    const piped = spawnSync("bash", ["-c", 'node "$SCRIPT" export --sector "$SECTOR" | { sleep 1; wc -c; }'], {
      env: { ...process.env, DB_PATH: path, SCRIPT: script, SECTOR }, encoding: "utf8",
    });
    expect(Number(piped.stdout.trim())).toBe(Buffer.byteLength(expected));
  });
});
