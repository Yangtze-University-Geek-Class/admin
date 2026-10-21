import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceOverrides } from '../../app/server/src/services';
import { MERGE_HOPS_MAX } from '../../app/server/src/lib/identity-store';
import { signIn, testApp } from './helpers';

/**
 * 极客班账号与 GitHub 登录事务（#262 交付 1，docs/plan/UNIFIED-LOGIN.md「登录事务」「交付 1：回填」）。
 * 旧库升级与回填在 tests/server/legacy-database.test.ts；这里是登录本身：建号、复用、改名、停用、合并链与回滚。
 */
const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const c of contexts.splice(0)) await c.close(); });

/** 假的 GitHub：换 token、取当前用户（github.id / login 可在用例里改）、撤销授权 */
const github = { id: 7, login: 'test-github-user' };
const grantRevokes: string[] = [];
beforeEach(() => { Object.assign(github, { id: 7, login: 'test-github-user' }); grantRevokes.length = 0; });
const httpRequest = (async (url: string, options: { body?: string } = {}) => {
  if (url.includes('/grant')) { grantRevokes.push(options.body ?? ''); return { statusCode: 204, body: { dump: async () => undefined } }; }
  return { statusCode: 200, body: { json: async () => url.includes('/access_token') ? { access_token: 'test-provider-token' } : { id: github.id, login: github.login, avatar_url: '' } } };
}) as unknown as ServiceOverrides['httpRequest'];
/** 登录门槛：当前用户是组织的正式成员 */
const octokitFactory = (() => ({ request: async () => ({ data: { state: 'active', role: 'member' } }) })) as unknown as ServiceOverrides['octokitFactory'];

async function setup() {
  const context = await testApp({ httpRequest, octokitFactory });
  contexts.push(context);
  const { app } = context;
  const db = app.services.storage.db;
  /** 走一遍真实的 /auth/github → /auth/callback；sid 是浏览器带来的旧会话 */
  async function callback(sid?: string) {
    const start = await app.inject('/auth/github?return_to=https%3A%2F%2Fexample.test%2Fforum%2F');
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    const cookie = [String(start.headers['set-cookie']).split(';')[0], ...(sid ? [`sid=${sid}`] : [])].join('; ');
    const response = await app.inject({ url: `/auth/callback?code=ok&state=${state}`, headers: { cookie } });
    const issued = ([] as string[]).concat((response.headers['set-cookie'] as string[] | string | undefined) ?? [])
      .find(c => c.startsWith('sid='))?.split(';')[0].slice(4) ?? null;
    return { location: String(response.headers.location), sid: issued };
  }
  const me = async (sid: string) => (await app.inject({ url: '/auth/me', headers: { cookie: `sid=${sid}` } })).json();
  const accountOf = (githubId: number) => (db.prepare("SELECT user_id FROM identities WHERE provider = 'github' AND provider_uid = ?").get(String(githubId)) as { user_id: string } | undefined)?.user_id ?? null;
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { app, db, callback, me, accountOf, count };
}

describe('GitHub sign-in creates or finds the 极客班 account (#262)', () => {
  it('creates one account on the first sign-in, reuses it afterwards and reports it on /auth/me', async () => {
    const { app, db, callback, me, accountOf, count } = await setup();
    const first = await callback();
    expect(first.location).toBe('https://example.test/forum/');
    const accountId = accountOf(7);
    expect(accountId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(await me(first.sid!)).toMatchObject({ signed_in: true, login: 'test-github-user', user_id: 7, account_id: accountId, provider: 'github' });
    // 再登录一次：同一个账号；浏览器带来的旧会话作废
    const second = await callback(first.sid!);
    expect(accountOf(7)).toBe(accountId);
    expect(count('users')).toBe(1);
    expect(await me(first.sid!)).toEqual({ signed_in: false });
    expect((await me(second.sid!)).account_id).toBe(accountId);
    // 审计带上账号；本人可见的账号记录不存 IP
    expect(db.prepare("SELECT actor, actor_account_id, details FROM audit_logs WHERE action = 'auth.signin'").all())
      .toEqual([1, 2].map(() => ({ actor: 'test-github-user', actor_account_id: accountId, details: JSON.stringify({ provider: 'github' }) })));
    expect(db.prepare('SELECT user_id, action, provider, result FROM identity_audit ORDER BY id').all())
      .toEqual([1, 2].map(() => ({ user_id: accountId, action: 'login', provider: 'github', result: 'ok' })));
    expect((await app.inject({ method: 'POST', url: '/auth/signout', headers: { cookie: `sid=${second.sid}`, origin: 'https://example.test' } })).statusCode).toBe(200);
    expect(db.prepare("SELECT actor_account_id FROM audit_logs WHERE action = 'auth.signout'").get()).toEqual({ actor_account_id: accountId });
    expect(db.prepare("SELECT action FROM identity_audit ORDER BY id DESC LIMIT 1").get()).toEqual({ action: 'logout' });
  });

  it('keeps titles and the forum user across a GitHub rename, and an old login name claims nothing', async () => {
    const { app, db, accountOf } = await setup();
    // carol 第一次登录之前被授予了部长；另有一条很早以前没记 GitHub id、只有登录名的称号
    app.services.roles.insertAssignment({ github_login: 'carol', github_user_id: 103, role: 'head', department_id: 'tech', note: null, granted_by: 'alice' });
    app.services.roles.insertAssignment({ github_login: 'olduser', github_user_id: null, role: 'member', department_id: '', note: null, granted_by: 'alice' });
    signIn(app, 'carol', 103);
    const carol = accountOf(103)!;
    const forumUser = app.services.forum.ensureMember({ accountId: carol, githubUserId: 103, login: 'carol', avatarUrl: null, role: 'member', title: null });
    // 改名后：同一个账号，称号和论坛用户都还在
    signIn(app, 'carol-renamed', 103);
    expect(accountOf(103)).toBe(carol);
    expect(app.services.roles.assignmentsFor('carol-renamed', 103, carol).map(row => row.role)).toEqual(['head']);
    expect(app.services.forum.ensureMember({ accountId: carol, githubUserId: 103, login: 'carol-renamed', avatarUrl: null, role: 'member', title: null })).toBe(forumUser);
    // 别人注册了 carol 这个旧名字：读不到 carol 的称号
    signIn(app, 'carol', 555);
    expect(app.services.roles.assignmentsFor('carol', 555, accountOf(555))).toEqual([]);
    // 只有登录名的旧称号：登录名相同的人登录也不认领（照旧只按登录名读）
    signIn(app, 'olduser', 777);
    expect(db.prepare("SELECT account_id FROM role_assignments WHERE github_login = 'olduser'").get()).toEqual({ account_id: null });
  });

  it('refuses a disabled account, ends its sessions and revokes the grant', async () => {
    const { app, db, callback, me, accountOf, count } = await setup();
    const sid = signIn(app, 'test-github-user', 7);
    const accountId = accountOf(7);
    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(accountId);
    expect(await me(sid)).toEqual({ signed_in: false });
    expect(count('sessions')).toBe(0);
    const result = await callback();
    expect(result).toEqual({ location: 'https://example.test/signin?signin=account_disabled&return_to=%2Fforum%2F', sid: null });
    expect(count('sessions')).toBe(0);
    expect(grantRevokes).toEqual([JSON.stringify({ access_token: 'test-provider-token' })]);
    expect(db.prepare("SELECT actor_account_id, details FROM audit_logs WHERE action = 'auth.signin_denied'").get())
      .toEqual({ actor_account_id: accountId, details: JSON.stringify({ org: 'Yangtze-University-Geek-Class', reason: 'account_disabled', provider: 'github' }) });
    expect(db.prepare("SELECT action, result, reason FROM identity_audit ORDER BY id DESC LIMIT 1").get()).toEqual({ action: 'login_denied', result: 'denied', reason: 'account_disabled' });
  });

  it.each([
    ['longer than the hop limit', MERGE_HOPS_MAX + 1, false],
    ['a cycle', 2, true],
  ] as const)('answers failed for a merge chain that is %s and leaves everything as it was', async (_case, merged, cycle) => {
    const { app, db, callback, me, accountOf, count } = await setup();
    signIn(app, 'test-github-user', 7);
    const bob = signIn(app, 'bob', 102);                 // 浏览器里原本登着的人
    const start = accountOf(7)!;
    const now = Date.now();
    // start → a1 → a2 …：建好终点，再从后往前标成 merged（CHECK 要求 status 与 merged_into 同时改）
    const chain = [start, ...Array.from({ length: merged }, (_, i) => `TESTMERGEDACCOUNT${String(i).padStart(9, '0')}`)];
    for (const id of chain.slice(1)) db.prepare("INSERT INTO users(id, status, org_state, created_at, updated_at) VALUES(?, 'active', 'active', ?, ?)").run(id, now, now);
    const link = db.prepare("UPDATE users SET status = 'merged', merged_into = ? WHERE id = ?");
    for (let i = chain.length - 2; i >= 0; i--) link.run(chain[i + 1], chain[i]);
    if (cycle) link.run(start, chain.at(-1));
    const before = { users: count('users'), sessions: count('sessions'), audits: count('audit_logs') };
    expect(await callback(bob)).toEqual({ location: 'https://example.test/signin?signin=failed&return_to=%2Fforum%2F', sid: null });
    expect({ users: count('users'), sessions: count('sessions'), audits: count('audit_logs') }).toEqual(before);
    expect((await me(bob)).login).toBe('bob');
  });

  it('rolls the whole sign-in back when a step fails: no half account, the old session stays valid', async () => {
    const { app, db, callback, me, accountOf, count } = await setup();
    const bob = signIn(app, 'bob', 102);
    db.exec("CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test: sessions are read-only'); END");
    const before = { users: count('users'), identities: count('identities'), audits: count('identity_audit') };
    expect(await callback(bob)).toEqual({ location: 'https://example.test/signin?signin=failed&return_to=%2Fforum%2F', sid: null });
    expect({ users: count('users'), identities: count('identities'), audits: count('identity_audit') }).toEqual(before);
    expect(accountOf(7)).toBeNull();
    db.exec('DROP TRIGGER reject_session');
    expect((await me(bob)).login).toBe('bob');
  });

  it('lists GitHub as the only sign-in method in this delivery', async () => {
    const { app } = await setup();
    const response = await app.inject('/auth/providers');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ providers: [{ id: 'github', name: 'GitHub', kind: 'redirect', start: '/auth/github', can_register: true }] });
  });
});
