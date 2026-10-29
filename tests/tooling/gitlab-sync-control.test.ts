import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../app/server/src/lib/db';
import { readGitlabSyncSettings, writeGitlabSyncSettings } from '../../app/server/src/lib/gitlab-sync';
import { compareBaseline, readSyncReport, verifyAccounts } from '../../deploy/gitlab/sync-control.mjs';

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
