import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../app/server/src/lib/db';
import { readGitlabSyncSettings, writeGitlabSyncSettings } from '../../app/server/src/lib/gitlab-sync';
import { compareBaseline, readSyncReport, repairDuplicates, verifyAccounts } from '../../deploy/gitlab/sync-control.mjs';

const databases: Array<{ close(): void }> = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const SECTOR = 'git.example.test';
const ENV = { GITLAB_SYNC: 'on', GITLAB_URL: `https://${SECTOR}`, GITLAB_GROUP: 'geek', GITLAB_API_TOKEN: 'fixture-token' };
const NOW = 100_000;

function fixture() {
  const { db } = createDatabase(':memory:');
  databases.push(db);
  db.prepare("INSERT INTO users(id,status,created_at,updated_at) VALUES('account-a','active',?,?)").run(NOW, NOW);
  db.prepare("INSERT INTO identities(id,user_id,provider,provider_uid,login,created_at,last_login_at) VALUES('identity-a','account-a','github','101','alice',?,?)").run(NOW, NOW);
  db.prepare("INSERT INTO perm_members(account_id,group_id,granted_by,created_at) VALUES('account-a','level.member','fixture',?)").run(NOW);
  db.prepare("INSERT INTO oauth_subjects(sector_id,user_id,sub,created_at) VALUES(?,'account-a','private-fixture-sub',?)").run(SECTOR, NOW);
  db.prepare("INSERT INTO gitlab_accounts(account_id,gitlab_user_id,username,state,access_level,created_at,updated_at) VALUES('account-a',42,'alice','active',30,?,?)").run(NOW, NOW);
  return db;
}

function remote(overrides: Record<string, unknown> = {}, access = 30) {
  const calls: string[] = [];
  async function fetcher(input: string, init: RequestInit = {}) {
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual({ 'PRIVATE-TOKEN': 'fixture-token' });
    const path = new URL(input).pathname;
    calls.push(path);
    const body = path === '/api/v4/users/42'
      ? { id: 42, username: 'alice', state: 'active', is_admin: false, bot: false, user_type: 'human', identities: [{ provider: 'openid_connect', extern_uid: 'private-fixture-sub' }], ...overrides }
      : { id: 42, access_level: access };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }
  return { fetcher, calls };
}

describe('同步运维状态', () => {
  it('纯只读状态不建资料、不输出 sub、邮箱或令牌；持久配置优先于 env', () => {
    const db = fixture();
    writeGitlabSyncSettings(db, { mode: 'off', group: 'geek', interval_minutes: 15 });
    const profiles = db.prepare('SELECT COUNT(*) AS n FROM account_profiles').get();
    db.pragma('query_only = ON');
    const report = readSyncReport(db, ENV, SECTOR, NOW);
    expect(report.configuration).toMatchObject({ mode: 'off', env_mode: 'on', persisted_mode: 'off', interval_minutes: 15, token_configured: true });
    expect(report).toMatchObject({ eligible_members: 1, mapped_members: 1, missing_subjects: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_profiles').get()).toEqual(profiles);
    expect(JSON.stringify(report)).not.toMatch(/private-fixture-sub|fixture-token|account-a/);
    expect(readGitlabSyncSettings(db)).toEqual({ mode: 'off', group: 'geek', interval_minutes: 15 });
  });

  it.each(['expired', 'disabled', 'owner-only', 'inherited'])('%s 不被运维计数误认为有效直接成员', kind => {
    const db = fixture();
    if (kind === 'expired') db.prepare("UPDATE perm_members SET expires_at=? WHERE account_id='account-a'").run(NOW);
    if (kind === 'disabled') db.prepare("UPDATE users SET status='disabled' WHERE id='account-a'").run();
    if (kind === 'owner-only') db.prepare("UPDATE perm_members SET group_id='title.site.owner' WHERE account_id='account-a'").run();
    if (kind === 'inherited') {
      db.prepare("UPDATE perm_members SET group_id='dept.ai' WHERE account_id='account-a'").run();
      db.prepare("INSERT INTO perm_group_parents(group_id,parent_id) VALUES('dept.ai','level.member')").run();
    }
    expect(readSyncReport(db, ENV, SECTOR, NOW).eligible_members).toBe(0);
  });

  it('有效 alumni 保留资格；有效直接 owner 才要求 Owner 50', () => {
    const db = fixture();
    db.prepare("UPDATE perm_members SET group_id='level.alumni' WHERE account_id='account-a'").run();
    expect(readSyncReport(db, ENV, SECTOR, NOW).bindings[0].expected_access).toBe(30);
    db.prepare("INSERT INTO perm_members(account_id,group_id,granted_by,created_at,expires_at) VALUES('account-a','title.site.owner','fixture',?,?)").run(NOW, NOW + 1);
    expect(readSyncReport(db, ENV, SECTOR, NOW).bindings[0].expected_access).toBe(50);
    expect(readSyncReport(db, ENV, SECTOR, NOW + 1).bindings[0].expected_access).toBe(30);
  });
});

describe('逐成员 GitLab 验收', () => {
  it('只有本地映射、唯一 OIDC 绑定和组权限同时一致才通过', async () => {
    const db = fixture();
    const gitlab = remote();
    const baseline = readSyncReport(db, ENV, SECTOR, NOW);
    const result = await verifyAccounts(db, ENV, SECTOR, { ...gitlab, baseline, now: NOW });
    expect(result.verified_members).toBe(1);
    expect(result.failures).toEqual([]);
    expect(gitlab.calls).toEqual(['/api/v4/users/42', '/api/v4/groups/geek/members/all/42']);
    expect(JSON.stringify(result)).not.toMatch(/private-fixture-sub|fixture-token/);
  });

  it('verifies a subpath instance without sending its administrator token to the origin root', async () => {
    const db = fixture();
    const gitlab = remote();
    const paths: string[] = [];
    const result = await verifyAccounts(db, { ...ENV, GITLAB_URL: `${ENV.GITLAB_URL}/gitlab/` }, SECTOR, {
      now: NOW,
      fetcher: async (input, init) => {
        const url = new URL(input);
        paths.push(url.pathname);
        if (!url.pathname.startsWith('/gitlab/api/v4/')) return new Response(null, { status: 404 });
        return gitlab.fetcher(`${url.origin}${url.pathname.slice('/gitlab'.length)}`, init);
      },
    });
    expect(result.verified_members).toBe(1);
    expect(result.failures).toEqual([]);
    expect(paths).toEqual(['/gitlab/api/v4/users/42', '/gitlab/api/v4/groups/geek/members/all/42']);
  });

  it.each([
    { user: { identities: [] }, reason: 'oidc_binding_mismatch' },
    { user: { identities: [{ provider: 'openid_connect', extern_uid: 'other' }, { provider: 'openid_connect', extern_uid: 'private-fixture-sub' }] }, reason: 'oidc_binding_mismatch' },
    { user: { is_admin: true }, reason: 'gitlab_user_not_managed_active' },
    { user: { user_type: 'service_account' }, reason: 'gitlab_user_not_managed_active' },
    { user: { username: 'geek-sync' }, reason: 'gitlab_user_not_managed_active' },
    { user: { state: 'blocked' }, reason: 'gitlab_user_not_managed_active' },
    { user: {}, access: 20, reason: 'group_access_mismatch' },
  ])('拒绝不一致账号 $reason', async ({ user, access, reason }) => {
    const result = await verifyAccounts(fixture(), ENV, SECTOR, { ...remote(user, access), now: NOW });
    expect(result.verified_members).toBe(0);
    expect(result.failures).toEqual([{ identities: ['github:101'], gitlab_id: 42, reason }]);
  });

  it('旧成员缺失或 GitLab ID 改变会阻止切换，不按名字或邮箱合号', () => {
    const report = readSyncReport(fixture(), ENV, SECTOR, NOW);
    expect(compareBaseline(report, { bindings: [{ identities: ['github:999'], gitlab_id: 7 }] })).toMatchObject([{ reason: 'baseline_member_missing' }]);
    expect(compareBaseline(report, { bindings: [{ identities: ['github:101'], gitlab_id: 7 }] })).toMatchObject([{ reason: 'existing_gitlab_id_changed' }]);
  });

  it('GitLab 503 或包含敏感内容的异常都只报告失败码', async () => {
    const db = fixture();
    const failed = await verifyAccounts(db, ENV, SECTOR, { now: NOW, fetcher: async () => new Response('fixture-token private-fixture-sub', { status: 503 }) });
    expect(failed.failures[0].reason).toBe('gitlab_http_503');
    const thrown = await verifyAccounts(db, ENV, SECTOR, { now: NOW, fetcher: async () => { throw new Error('fixture-token private-fixture-sub'); } });
    expect(thrown.failures[0].reason).toBe('gitlab_unreachable');
    expect(JSON.stringify([failed, thrown])).not.toMatch(/fixture-token|private-fixture-sub/);
  });
});

describe('改接前正式同步建出的重复号', () => {
  // 正式库：account-a 已有正式的 sub，映射到同步建出来的 59（alice_yz）；GitLab 上原来的号 8 绑着预发布的 sub
  function duplicated() {
    const db = fixture();
    db.prepare("UPDATE oauth_subjects SET sub='production-sub' WHERE user_id='account-a'").run();
    db.prepare("UPDATE gitlab_accounts SET gitlab_user_id=59, username='alice_yz', last_error='gitlab_email_500', avatar_source='a', emails_source='e' WHERE account_id='account-a'").run();
    return db;
  }
  const PAYLOAD = { sector: SECTOR, entries: [{ sub: 'preview-sub', identities: [{ provider: 'github', provider_uid: '101' }] }], withoutIdentity: 0 };

  function gitlab(overrides: { original?: Record<string, unknown>; duplicate?: Record<string, unknown>; extra?: Record<number, Record<string, unknown>> } = {}) {
    const users: Record<number, Record<string, unknown>> = {
      8: { id: 8, username: 'alice', state: 'active', is_admin: false, bot: false, user_type: 'human', identities: [{ provider: 'openid_connect', extern_uid: 'preview-sub' }], last_sign_in_at: '2026-10-20T00:00:00Z', current_sign_in_at: '2026-10-20T00:00:00Z', ...overrides.original },
      59: { id: 59, username: 'alice_yz', state: 'active', is_admin: false, bot: false, user_type: 'human', identities: [{ provider: 'openid_connect', extern_uid: 'production-sub' }], last_sign_in_at: null, current_sign_in_at: null, ...overrides.duplicate },
      ...overrides.extra,
    };
    const writes: string[] = [];
    async function fetcher(input: string, init: RequestInit = {}) {
      expect(init.redirect).toBe('error');
      expect(init.headers).toEqual({ 'PRIVATE-TOKEN': 'fixture-token' });
      const url = new URL(input);
      const method = init.method ?? 'GET';
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (method === 'GET' && url.pathname === '/api/v4/users') {
        const sub = url.searchParams.get('extern_uid');
        return json(Object.values(users).filter(user => ((user.identities ?? []) as { extern_uid: string }[]).some(identity => identity.extern_uid === sub)).map(user => ({ id: user.id, username: user.username })));
      }
      const match = url.pathname.match(/^\/api\/v4\/users\/(\d+)(\/.*)?$/);
      const user = match ? users[Number(match[1])] : undefined;
      if (!user) return json({ message: '404 User Not Found' }, 404);
      if (method === 'GET' && !match![2]) return json(user);
      writes.push(`${method} ${url.pathname}`);
      if (method === 'DELETE' && match![2] === '/identities/openid_connect') {
        const before = (user.identities as unknown[]).length;
        user.identities = (user.identities as { provider: string }[]).filter(identity => identity.provider !== 'openid_connect');
        return new Response(null, { status: before === (user.identities as unknown[]).length ? 404 : 204 });
      }
      if (method === 'POST' && match![2] === '/block') { user.state = 'blocked'; return json(true, 201); }
      return json({}, 400);
    }
    return { fetcher, users, writes };
  }
  const row = (db: ReturnType<typeof fixture>) => db.prepare("SELECT gitlab_user_id, username, state, access_level, avatar_source, emails_source, last_error FROM gitlab_accounts WHERE account_id='account-a'").get();
  const sub = (db: ReturnType<typeof fixture>) => (db.prepare("SELECT sub FROM oauth_subjects WHERE user_id='account-a'").get() as { sub: string }).sub;

  it('演算只读：列出重复号与原号，不碰 GitLab 写接口和正式库，输出不含 sub 与令牌', async () => {
    const db = duplicated();
    const remote = gitlab();
    db.pragma('query_only = ON');
    const result = await repairDuplicates(db, ENV, SECTOR, PAYLOAD, { fetcher: remote.fetcher, now: NOW });
    expect(result).toEqual({ plan: [{ label: 'github:101', duplicate: 59, original: 8 }], refused: [], repaired: [] });
    expect(remote.writes).toEqual([]);
    expect(sub(db)).toBe('production-sub');
    expect(JSON.stringify(result)).not.toMatch(/preview-sub|production-sub|fixture-token|account-a/);
  });

  it('写入：先解绑并封禁重复号，再把 sub 与映射改回原号，清掉同步缓存让下一轮重新对齐；重跑什么也不做', async () => {
    const db = duplicated();
    const remote = gitlab();
    const result = await repairDuplicates(db, ENV, SECTOR, PAYLOAD, { fetcher: remote.fetcher, apply: true, now: NOW + 5 });
    expect(result.repaired).toEqual([{ label: 'github:101', duplicate: 59, original: 8 }]);
    expect(remote.writes).toEqual(['DELETE /api/v4/users/59/identities/openid_connect', 'POST /api/v4/users/59/block']);
    expect(remote.users[59]).toMatchObject({ state: 'blocked', identities: [] });
    expect(remote.users[8]).toMatchObject({ state: 'active', identities: [{ provider: 'openid_connect', extern_uid: 'preview-sub' }] });
    expect(sub(db)).toBe('preview-sub');
    expect(row(db)).toEqual({ gitlab_user_id: 8, username: 'alice', state: 'active', access_level: null, avatar_source: null, emails_source: null, last_error: null });
    const again = await repairDuplicates(db, ENV, SECTOR, PAYLOAD, { fetcher: remote.fetcher, apply: true, now: NOW + 6 });
    expect(again).toEqual({ plan: [], refused: [], repaired: [] });
    expect(remote.writes).toHaveLength(2);
  });

  it('上次在 GitLab 上解绑封禁之后中断：重跑接着改正式库，不再调写接口', async () => {
    const db = duplicated();
    const remote = gitlab({ duplicate: { identities: [], state: 'blocked' } });
    const result = await repairDuplicates(db, ENV, SECTOR, PAYLOAD, { fetcher: remote.fetcher, apply: true, now: NOW });
    expect(result.repaired).toHaveLength(1);
    expect(remote.writes).toEqual([]);
    expect(sub(db)).toBe('preview-sub');
  });

  it.each([
    { name: '重复号登录过', remote: { duplicate: { last_sign_in_at: '2026-10-29T08:00:00Z' } }, reason: 'duplicate_used' },
    { name: '读不到重复号的登录记录', remote: { duplicate: { last_sign_in_at: undefined } }, reason: 'duplicate_activity_unknown' },
    { name: '重复号绑着别的身份', remote: { duplicate: { identities: [{ provider: 'openid_connect', extern_uid: 'someone-else' }] } }, reason: 'duplicate_identity_unexpected' },
    { name: '重复号是管理员', remote: { duplicate: { is_admin: true } }, reason: 'duplicate_not_managed' },
    { name: 'GitLab 上找不到原号', remote: { original: { identities: [] } }, reason: 'original_missing' },
    { name: '原号是管理员', remote: { original: { is_admin: true } }, reason: 'original_not_managed' },
    { name: '同一个预发布 sub 对到两个号', remote: { extra: { 70: { id: 70, username: 'x', state: 'active', is_admin: false, identities: [{ provider: 'openid_connect', extern_uid: 'preview-sub' }] } } }, reason: 'original_ambiguous' },
  ])('$name：整批拒绝，什么也不写', async ({ remote: overrides, reason }) => {
    const db = duplicated();
    const remote = gitlab(overrides as Parameters<typeof gitlab>[0]);
    const result = await repairDuplicates(db, ENV, SECTOR, PAYLOAD, { fetcher: remote.fetcher, apply: true, now: NOW });
    expect(result).toEqual({ plan: [], refused: [{ label: 'github:101', reason }], repaired: [] });
    expect(remote.writes).toEqual([]);
    expect(sub(db)).toBe('production-sub');
    expect(row(db)).toMatchObject({ gitlab_user_id: 59 });
  });

  it('解绑或封禁返回意外状态：抛错停下，正式库不改；修好 GitLab 后重跑接着做', async () => {
    const db = duplicated();
    const remote = gitlab();
    const failing = async (input: string, init: RequestInit = {}) => (init.method === 'POST' ? new Response('fixture-token preview-sub', { status: 500 }) : remote.fetcher(input, init));
    await expect(repairDuplicates(db, ENV, SECTOR, PAYLOAD, { fetcher: failing, apply: true, now: NOW })).rejects.toThrow(/^repair_block_500$/);
    expect(sub(db)).toBe('production-sub');
    expect(row(db)).toMatchObject({ gitlab_user_id: 59 });
    expect(remote.users[59]).toMatchObject({ identities: [], state: 'active' });
    const again = await repairDuplicates(db, ENV, SECTOR, PAYLOAD, { fetcher: remote.fetcher, apply: true, now: NOW });
    expect(again.repaired).toHaveLength(1);
    expect(remote.users[59]).toMatchObject({ state: 'blocked' });
    expect(sub(db)).toBe('preview-sub');
  });

  it('GitLab 连不上：只报 gitlab_unreachable，不带异常原文', async () => {
    const result = await repairDuplicates(duplicated(), ENV, SECTOR, PAYLOAD, { now: NOW, fetcher: async () => { throw new Error('fixture-token preview-sub'); } });
    expect(result.refused).toEqual([{ label: 'github:101', reason: 'gitlab_unreachable' }]);
    expect(JSON.stringify(result)).not.toMatch(/fixture-token|preview-sub/);
  });

  it('原号是封禁状态：映射照改，状态记成 blocked，留给同步按资格决定解不解封', async () => {
    const db = duplicated();
    const remote = gitlab({ original: { state: 'blocked' } });
    await repairDuplicates(db, ENV, SECTOR, PAYLOAD, { fetcher: remote.fetcher, apply: true, now: NOW });
    expect(row(db)).toMatchObject({ gitlab_user_id: 8, state: 'blocked' });
  });

  it('多条里有一条被拒，或同一个正式账号出现两次：整批不写', async () => {
    const db = duplicated();
    db.prepare("INSERT INTO users(id,status,created_at,updated_at) VALUES('account-b','active',?,?)").run(NOW, NOW);
    db.prepare("INSERT INTO identities(id,user_id,provider,provider_uid,login,created_at,last_login_at) VALUES('identity-b','account-b','github','202','bob',?,?)").run(NOW, NOW);
    db.prepare("INSERT INTO oauth_subjects(sector_id,user_id,sub,created_at) VALUES(?,'account-b','production-sub-b',?)").run(SECTOR, NOW);
    db.prepare("INSERT INTO gitlab_accounts(account_id,gitlab_user_id,username,state,access_level,created_at,updated_at) VALUES('account-b',60,'bob_yz','active',30,?,?)").run(NOW, NOW);
    const remote = gitlab({ extra: { 60: { id: 60, username: 'bob_yz', state: 'active', is_admin: false, identities: [{ provider: 'openid_connect', extern_uid: 'production-sub-b' }], last_sign_in_at: '2026-10-29T09:00:00Z', current_sign_in_at: null } } });
    const mixed = { ...PAYLOAD, entries: [...PAYLOAD.entries, { sub: 'preview-sub-b', identities: [{ provider: 'github', provider_uid: '202' }] }] };
    const refused = await repairDuplicates(db, ENV, SECTOR, mixed, { fetcher: remote.fetcher, apply: true, now: NOW });
    expect(refused.refused).toEqual([{ label: 'github:202', reason: 'original_missing' }]);
    expect(refused.repaired).toEqual([]);
    expect(remote.writes).toEqual([]);
    expect(sub(db)).toBe('production-sub');
    const twice = { ...PAYLOAD, entries: [PAYLOAD.entries[0], { sub: 'preview-sub', identities: [{ provider: 'github', provider_uid: '101' }] }] };
    const repeated = await repairDuplicates(db, ENV, SECTOR, twice, { fetcher: gitlab().fetcher, apply: true, now: NOW });
    expect(repeated.refused.map(item => item.reason)).toEqual(expect.arrayContaining(['account_repeated', 'duplicate_repeated', 'original_repeated']));
    expect(repeated.repaired).toEqual([]);
    expect(sub(db)).toBe('production-sub');
  });

  it('原号的用户名已被正式库别的账号占用、或 GitLab 没返回身份列表：拒绝', async () => {
    const named = duplicated();
    named.prepare("INSERT INTO users(id,status,created_at,updated_at) VALUES('account-b','active',?,?)").run(NOW, NOW);
    named.prepare("INSERT INTO gitlab_accounts(account_id,gitlab_user_id,username,state,access_level,created_at,updated_at) VALUES('account-b',NULL,'ALICE','pending',NULL,?,?)").run(NOW, NOW);
    expect((await repairDuplicates(named, ENV, SECTOR, PAYLOAD, { fetcher: gitlab().fetcher, now: NOW })).refused).toEqual([{ label: 'github:101', reason: 'original_username_taken' }]);
    const unreadable = await repairDuplicates(duplicated(), ENV, SECTOR, PAYLOAD, { fetcher: gitlab({ duplicate: { identities: undefined } }).fetcher, now: NOW });
    expect(unreadable.refused).toEqual([{ label: 'github:101', reason: 'identities_unreadable' }]);
  });

  it('原号已经映射给正式库的另一个账号、或预发布的 sub 已属于别人：拒绝', async () => {
    const mapped = duplicated();
    mapped.prepare("INSERT INTO users(id,status,created_at,updated_at) VALUES('account-b','active',?,?)").run(NOW, NOW);
    mapped.prepare("INSERT INTO gitlab_accounts(account_id,gitlab_user_id,username,state,access_level,created_at,updated_at) VALUES('account-b',8,'bob','active',30,?,?)").run(NOW, NOW);
    expect((await repairDuplicates(mapped, ENV, SECTOR, PAYLOAD, { fetcher: gitlab().fetcher, now: NOW })).refused).toEqual([{ label: 'github:101', reason: 'original_already_mapped' }]);
    const taken = duplicated();
    taken.prepare("INSERT INTO users(id,status,created_at,updated_at) VALUES('account-b','active',?,?)").run(NOW, NOW);
    taken.prepare("INSERT INTO oauth_subjects(sector_id,user_id,sub,created_at) VALUES(?,'account-b','preview-sub',?)").run(SECTOR, NOW);
    expect((await repairDuplicates(taken, ENV, SECTOR, PAYLOAD, { fetcher: gitlab().fetcher, now: NOW })).refused).toEqual([{ label: 'github:101', reason: 'source_sub_taken' }]);
  });

  it('sub 已经一致、或正式库对不上账号的条目不归这里管', async () => {
    const db = fixture();
    const remote = gitlab();
    const payload = { sector: SECTOR, entries: [
      { sub: 'private-fixture-sub', identities: [{ provider: 'github', provider_uid: '101' }] },
      { sub: 'other', identities: [{ provider: 'github', provider_uid: '999' }] },
    ], withoutIdentity: 0 };
    expect(await repairDuplicates(db, ENV, SECTOR, payload, { fetcher: remote.fetcher, apply: true, now: NOW })).toEqual({ plan: [], refused: [], repaired: [] });
    await expect(repairDuplicates(db, ENV, SECTOR, { ...payload, sector: 'other.test' }, { fetcher: remote.fetcher })).rejects.toThrow('sector');
  });
});
