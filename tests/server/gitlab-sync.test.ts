import { STATIC_CDN_ORIGIN as CDN_ORIGIN } from '../static-cdn-fixture';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createConfig } from '../../app/server/src/config';
import { createGitlabSync, gitlabUsername } from '../../app/server/src/lib/gitlab-sync';
import type { DirectoryAccount } from '../../app/server/src/lib/account-directory';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { REPO_ROOT } from '../../app/server/src/config';
import { NANO_AVATAR_VERSION, nanoAvatarIndex } from '../../app/server/src/lib/nano-avatar';
import { activityRows, signIn as rawSignIn, testApp } from './helpers';

const sharp = createRequire(join(REPO_ROOT, 'app/server/package.json'))('sharp') as typeof import('../../app/server/node_modules/sharp');

/**
 * 这个文件里登录的每一个人都是在测「同步给成员做的事」（GitLab 账号、OIDC 身份、头像、组权限），
 * 和 #262 之前「GitHub 组织成员」同义——#274 去掉组织那道门之后，登录不再自动是成员，这里补上
 * setSiteRole('member')，让本文件的 signIn() 仍然按「这是个成员」的前提工作，不用改每一处调用。
 * 要测「不是成员」「从成员变回注册用户」的用例，在这之后自己再调一次 setSiteRole('none')。
 */
function signIn(app: FastifyInstance, login: string, githubId: number, avatarUrl: string | null = null): string {
  const sid = rawSignIn(app, login, githubId, avatarUrl);
  app.services.identity.setSiteRole({ accountId: app.services.identity.accountForGithub(githubId)!, role: 'member', actor: 'system' });
  return sid;
}

/**
 * GitLab 账号同步（#270）：每个成员在 GitLab 上有一个按 OIDC 身份认人的用户，进 geek 组；离开的封禁，回来的解封，从不删除。
 * GitLab 管理接口与 GitHub 公开资料都由下面的假实现回应，测试不出网。
 */
const GITLAB = 'https://git.example.test';
const SYNC_ENV = { GITLAB_SYNC: 'on', GITLAB_URL: GITLAB, GITLAB_API_TOKEN: 'test-gitlab-token', GITLAB_GROUP: 'geek' };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

type FakeEmail = { id: number; email: string; confirmed_at: string | null };
type FakeUser = {
  id: number; username: string; email: string; name: string; state: 'active' | 'blocked'; extern_uid: string | null; provider: string | null;
  is_admin?: boolean; bot?: boolean; user_type?: string;
  bio?: string; location?: string; website_url?: string; avatar?: string; emails?: FakeEmail[];
};
const CONFIRMED = '2026-10-23T12:00:00.000Z';

/**
 * 假 GitLab：只认管理员令牌，用户名和邮箱不分大小写唯一（主邮箱和次邮箱一起算），组成员按 user id 记权限。`fail` 让下一次匹配的请求失败。
 * 邮箱列表和真的 GitLab 一样连主邮箱也列出来（`emails` 只放次邮箱），主邮箱删不掉；换主邮箱后旧的留成已确认的次邮箱。
 */
function fakeGitlab(base = GITLAB) {
  const users: FakeUser[] = [];
  let nextEmailId = 900;
  const owns = (user: FakeUser, email: string) => [user.email, ...(user.emails ?? []).map(item => item.email)].some(item => item.toLowerCase() === email.toLowerCase());
  const primaryEntry = (user: FakeUser): FakeEmail => ({ id: user.id * 1000, email: user.email, confirmed_at: CONFIRMED });
  const members = new Map<number, number>();
  const calls: string[] = [];
  const failures: { match: string; status: number }[] = [];
  const replies: { match: string; respond: () => Response }[] = [];
  const holds: { match: string; reached: () => void; released: Promise<void> }[] = [];
  let unreachable = false;
  let nextId = 100;
  // #274 控制台概览、项目列表：版本号、group 本身、子组、组内项目，都给合理的默认值，用例可以用 setVersion/setProjects 改。
  let version: string | null = '17.5.0';
  let groupData: Record<string, unknown> = { id: 1, full_path: 'geek', name: '极客班', visibility: 'private' };
  let subgroupsData: Record<string, unknown>[] = [];
  let projectsData: Record<string, unknown>[] = [
    { id: 10, path_with_namespace: 'geek/admin', name: 'admin', description: '极客班官网与后端', visibility: 'private', web_url: `${GITLAB}/geek/admin`, http_url_to_repo: `${GITLAB}/geek/admin.git`, ssh_url_to_repo: 'git@git.example.test:geek/admin.git', last_activity_at: '2026-10-20T00:00:00.000Z', star_count: 3 },
    { id: 11, path_with_namespace: 'geek/site', name: 'site', description: '开源站点', visibility: 'public', web_url: `${GITLAB}/geek/site`, http_url_to_repo: `${GITLAB}/geek/site.git`, ssh_url_to_repo: 'git@git.example.test:geek/site.git', last_activity_at: '2026-10-18T00:00:00.000Z', star_count: 1 },
  ];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  async function fetch(input: string, init: RequestInit = {}): Promise<Response> {
    if (unreachable) throw new TypeError('fetch failed');
    const url = new URL(input);
    expect(url.origin).toBe(new URL(base).origin);
    expect((init.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('test-gitlab-token');
    expect(init.redirect).toBe('error');
    const method = init.method ?? 'GET';
    const prefix = `${new URL(base).pathname.replace(/\/+$/, '')}/api/v4`;
    expect(url.pathname.startsWith(`${prefix}/`)).toBe(true);
    const path = url.pathname.slice(prefix.length);
    const call = `${method} ${path}`;
    calls.push(call);
    const hold = holds.findIndex(item => call.startsWith(item.match));
    if (hold >= 0) {
      const [held] = holds.splice(hold, 1);
      held.reached();
      await held.released;
    }
    const failure = failures.findIndex(item => call.startsWith(item.match));
    if (failure >= 0) return json(failures.splice(failure, 1)[0].status, { message: 'injected failure' });
    const reply = replies.findIndex(item => `${call}${url.search}`.startsWith(item.match));
    if (reply >= 0) return replies.splice(reply, 1)[0].respond();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    let match: RegExpMatchArray | null;
    if (method === 'GET' && path === '/users') {
      return json(200, users.filter(user => user.extern_uid === url.searchParams.get('extern_uid') && user.provider === url.searchParams.get('provider')));
    }
    if (method === 'POST' && path === '/users') {
      const username = String(body!.username);
      const email = String(body!.email);
      if (users.some(user => user.username.toLowerCase() === username.toLowerCase())) return json(409, { message: 'Username has already been taken' });
      if (users.some(user => owns(user, email))) return json(409, { message: 'Email has already been taken' });
      expect(body).toMatchObject({ skip_confirmation: true, force_random_password: true, provider: 'openid_connect' });
      const user: FakeUser = {
        id: nextId++, username, email, name: String(body!.name), state: 'active', extern_uid: String(body!.extern_uid), provider: String(body!.provider),
        bio: String(body!.bio), location: String(body!.location), website_url: String(body!.website_url),
      };
      users.push(user);
      return json(201, { id: user.id, username: user.username });
    }
    if ((match = path.match(/^\/users\/(\d+)$/))) {
      const user = users.find(item => item.id === Number(match![1]));
      if (!user) return json(404, { message: '404 User Not Found' });
      if (method === 'GET') return json(200, {
        is_admin: false, bot: false, ...user,
        identities: user.provider ? [{ provider: user.provider, extern_uid: user.extern_uid }] : [],
      });
      if (method === 'PUT' && body) {
        expect(body).toEqual({ email: expect.any(String), skip_reconfirmation: true });
        const email = String(body.email);
        if (users.some(other => other !== user && owns(other, email))) return json(409, { message: 'Email has already been taken' });
        const secondaries = (user.emails ?? []).filter(item => item.email.toLowerCase() !== email.toLowerCase());
        user.emails = [...secondaries, { id: nextEmailId++, email: user.email, confirmed_at: CONFIRMED }];
        user.email = email;
        return json(200, user);
      }
      if (method === 'PUT') {
        const avatar = (init.body as FormData).get('avatar') as File;
        // GitLab 只收 200 KiB 以内、扩展名是图片的头像
        if (avatar.size > 200 * 1024) return json(400, { message: { avatar: ['is too big (should be at most 200 KiB)'] } });
        if (!/^image\/(png|jpeg|gif|webp)$/.test(avatar.type) || !/\.(png|jpg|gif|webp)$/.test(avatar.name)) return json(400, { message: { avatar: ['file format is not supported'] } });
        user.avatar = `${avatar.type} ${avatar.size} ${avatar.name}`;
        return json(200, user);
      }
    }
    if ((match = path.match(/^\/users\/(\d+)\/emails(?:\/(\d+))?$/))) {
      const user = users.find(item => item.id === Number(match![1]));
      if (!user) return json(404, { message: '404 User Not Found' });
      user.emails ??= [];
      if (method === 'GET' && !match[2]) return json(200, [primaryEntry(user), ...user.emails]);
      if (method === 'POST' && !match[2]) {
        expect(body).toEqual({ email: expect.any(String), skip_confirmation: true });
        const email = String(body!.email);
        if (users.some(other => owns(other, email))) return json(400, { message: { email: ['has already been taken'] } });
        const entry = { id: nextEmailId++, email, confirmed_at: CONFIRMED };
        user.emails.push(entry);
        return json(201, entry);
      }
      if (method === 'DELETE' && match[2]) {
        if (Number(match[2]) === primaryEntry(user).id) return json(400, { message: 'Cannot delete primary email' });
        const index = user.emails.findIndex(item => item.id === Number(match![2]));
        if (index < 0) return json(404, { message: '404 Email Not Found' });
        user.emails.splice(index, 1);
        return new Response(null, { status: 204 });
      }
    }
    if (method === 'POST' && (match = path.match(/^\/users\/(\d+)\/(block|unblock)$/))) {
      const user = users.find(item => item.id === Number(match![1]))!;
      const wanted = match[2] === 'block' ? 'blocked' : 'active';
      if (user.state === wanted) return json(403, { message: `403 Forbidden - A ${user.state} user cannot be ${match[2]}ed` });
      user.state = wanted;
      return json(201, true);
    }
    if (method === 'POST' && path === '/groups/geek/members') {
      const userId = Number(body!.user_id);
      if (members.has(userId)) return json(409, { message: 'Member already exists' });
      members.set(userId, Number(body!.access_level));
      return json(201, { id: userId, access_level: body!.access_level });
    }
    if (method === 'PUT' && (match = path.match(/^\/groups\/geek\/members\/(\d+)$/))) {
      members.set(Number(match[1]), Number(body!.access_level));
      return json(200, { id: Number(match[1]), access_level: body!.access_level });
    }
    if (method === 'GET' && path === '/version') return version === null ? json(500, { message: 'down for maintenance' }) : json(200, { version, revision: 'abc123def' });
    if (method === 'GET' && path === '/groups/geek') return json(200, groupData);
    if (method === 'GET' && path === '/groups/geek/subgroups') return json(200, subgroupsData);
    if (method === 'GET' && path === '/groups/geek/projects') return json(200, projectsData);
    return json(404, { message: `unexpected ${call}` });
  }
  return {
    users, members, calls, fetch,
    fail(match: string, status: number) { failures.push({ match, status }); },
    replyOnce(match: string, respond: () => Response) { replies.push({ match, respond }); },
    /** 下一次匹配的请求停在半路：`reached` 在它到达时兑现，`release()` 之后才继续。 */
    hold(match: string) {
      let reached!: () => void;
      let release!: () => void;
      const hit = new Promise<void>(resolve => { reached = resolve; });
      holds.push({ match, reached, released: new Promise<void>(resolve => { release = resolve; }) });
      return { hit, release: () => release() };
    },
    setUnreachable(value: boolean) { unreachable = value; },
    setVersion(value: string | null) { version = value; },
    setProjects(value: Record<string, unknown>[]) { projectsData = value; },
    writes: () => calls.filter(call => !call.startsWith('GET ')),
  };
}

/** 假 GitHub：只回公开资料和头像，其它地址都算测试漏洞。头像默认回 PNG，`avatar()` 换成别的回应（抛错就是连不上）。 */
function fakeGithub(profiles: Record<number, Record<string, unknown>> = {}) {
  const calls: string[] = [];
  let avatar = () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  async function fetch(input: string): Promise<Response> {
    calls.push(input);
    const profile = input.match(/^https:\/\/api\.github\.com\/user\/(\d+)$/);
    if (profile) {
      const data = profiles[Number(profile[1])];
      return data ? new Response(JSON.stringify(data), { status: 200 }) : new Response('{}', { status: 404 });
    }
    if (input.startsWith('https://avatars.githubusercontent.com/')) return avatar();
    throw new Error(`unexpected GitHub request ${input}`);
  }
  return { calls, fetch, avatar(next: () => Response) { avatar = next; } };
}

const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); });

async function setup(env: Record<string, string> = SYNC_ENV, profiles: Record<number, Record<string, unknown>> = {}, callback: string | null = `${GITLAB}/users/auth/openid_connect/callback`) {
  const gitlab = fakeGitlab(env.GITLAB_URL?.replace(/\/+$/, '') ?? GITLAB);
  const github = fakeGithub(profiles);
  const context = await testApp({ gitlabFetch: gitlab.fetch, githubProfileFetch: github.fetch }, false, env);
  contexts.push(context);
  const { app } = context;
  // GitLab 在签发者那里登记的客户端：同步按它的回调主机算 sector
  if (callback) app.services.oidcStore.registerClient({ name: 'GitLab', clientId: 'gitlab', redirectUris: [callback] });
  const accountOf = (githubId: number) => app.services.identity.accountForGithub(githubId)!;
  const promote = (githubId: number) => app.services.identity.setSiteRole({ accountId: accountOf(githubId), role: 'admin', actor: 'system' });
  const subOf = (githubId: number) => app.services.oidcStore.subjectFor('git.example.test', accountOf(githubId));
  const row = (githubId: number) => app.services.storage.db.prepare('SELECT * FROM gitlab_accounts WHERE account_id = ?').get(accountOf(githubId)) as Record<string, unknown> | undefined;
  return { app, gitlab, github, accountOf, promote, subOf, row, db: app.services.storage.db };
}

function userNamed(gitlab: ReturnType<typeof fakeGitlab>, username: string) {
  return gitlab.users.find(user => user.username === username);
}

/** GitLab 用户名下的邮箱：主邮箱在前，次邮箱按字母排。 */
function emailsOn(gitlab: ReturnType<typeof fakeGitlab>, username: string) {
  const user = userNamed(gitlab, username)!;
  return [user.email, ...(user.emails ?? []).map(item => item.email).sort()];
}

describe('GitLab managed identity safety (#271)', () => {
  it.each([{ member: undefined }, { status: 'unknown' }, { member: false, site_role: 'member' }])(
    'incomplete source qualification %j cannot block, and does not stop a healthy account',
    async invalid => {
      const { app, gitlab, github, accountOf, db } = await setup();
      signIn(app, 'alice', 101);
      signIn(app, 'bob', 202);
      await app.services.gitlab.reconcile();
      const alice = userNamed(gitlab, 'alice')!;
      const services = app.services;
      const sync = createGitlabSync(db, {
        config: services.config.gitlab,
        directory: {
          listForSync: services.directory.listForSync,
          account(id) {
            const current = services.directory.account(id);
            return current && id === accountOf(101) ? { ...current, ...invalid } as DirectoryAccount : current;
          },
        },
        subjects: services.oidcStore, clients: services.oidcStore, avatars: services.profiles,
        githubAvatars: services.githubAvatars, nanoAvatars: services.nanoAvatars, audit: services.storage.audit,
        fetch: gitlab.fetch, githubFetch: github.fetch,
      });
      const writes = gitlab.writes().length;
      const run = await sync.reconcile();
      expect(run).toMatchObject({ accounts: 2, failed: 1, changed: 0 });
      expect(run.outcomes.find(outcome => outcome.account_id === accountOf(101))?.error).toBe('gitlab_source_incomplete');
      expect(run.outcomes.find(outcome => outcome.account_id === accountOf(202))?.error).toBeNull();
      expect(alice.state).toBe('active');
      expect(gitlab.writes().slice(writes)).toEqual([]);
    },
  );

  it('does not attribute contributions through a stale cached OIDC mapping, even before the next sync', async () => {
    const { app, gitlab, accountOf } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    expect(await app.services.gitlab.accountForGitlabUser(alice.id)).toBe(accountOf(101));
    alice.extern_uid = 'a-different-person';
    expect(await app.services.gitlab.accountForGitlabUser(alice.id)).toBeNull();
  });

  it('does not block a cached remote id after its OIDC binding changes', async () => {
    const { app, gitlab, accountOf } = await setup();
    signIn(app, 'alice', 101);
    expect((await app.services.gitlab.reconcile()).failed).toBe(0);
    const alice = userNamed(gitlab, 'alice')!;
    alice.extern_uid = 'another-subject';
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    const before = gitlab.writes().length;
    const result = await app.services.gitlab.syncAccount(accountOf(101), 'system');
    expect(result?.error).toBe('gitlab_identity_mismatch');
    expect(alice.state).toBe('active');
    expect(gitlab.writes().slice(before)).toEqual([]);
  });

  it('does not block a remote user carrying conflicting bindings for the same provider', async () => {
    const { app, gitlab, accountOf } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    const details = () => new Response(JSON.stringify({ ...alice, is_admin: false, identities: [
      { provider: 'openid_connect', extern_uid: alice.extern_uid },
      { provider: 'openid_connect', extern_uid: 'another-subject' },
    ] }), { status: 200 });
    gitlab.replyOnce(`GET /users/${alice.id}`, details);
    gitlab.replyOnce(`GET /users/${alice.id}`, details);
    const writes = gitlab.writes().length;
    expect((await app.services.gitlab.syncAccount(accountOf(101), 'system'))?.error).toBe('gitlab_identity_mismatch');
    expect(alice.state).toBe('active');
    expect(gitlab.writes().slice(writes)).toEqual([]);
  });

  it.each([{}, null, [null], [{ id: '100', username: 'alice' }]])('does not create on an incomplete identity response: %j', async data => {
    const { app, gitlab } = await setup();
    signIn(app, 'alice', 101);
    gitlab.replyOnce('GET /users?', () => new Response(JSON.stringify(data), { status: 200 }));
    const run = await app.services.gitlab.reconcile();
    expect(run.failed).toBe(1);
    expect(gitlab.writes()).toEqual([]);
    expect(gitlab.users).toEqual([]);
  });

  it('does not block from a partial identity page when the next page fails; retries a complete lookup', async () => {
    const { app, gitlab, accountOf, subOf } = await setup();
    signIn(app, 'alice', 101);
    const sub = subOf(101);
    gitlab.users.push({ id: 444, username: 'alice', name: 'Alice', email: 'same@example.test', state: 'active', provider: 'openid_connect', extern_uid: sub });
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    gitlab.replyOnce('GET /users?', () => new Response(JSON.stringify([{ id: 444, username: 'alice' }]), { status: 200, headers: { 'x-next-page': '2' } }));
    gitlab.replyOnce('GET /users?', () => new Response('{}', { status: 503 }));
    expect((await app.services.gitlab.reconcile()).failed).toBe(1);
    expect(gitlab.users[0].state).toBe('active');
    expect(gitlab.writes()).toEqual([]);
    expect(app.services.gitlab.gitlabUserFor(accountOf(101))).toBeNull();
    expect((await app.services.gitlab.reconcile()).failed).toBe(0);
    expect(gitlab.users[0].state).toBe('blocked');
  });

  it('rechecks authority after awaited identity lookup when an account returns during sync', async () => {
    const { app, gitlab, accountOf } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    const held = gitlab.hold(`GET /users/${alice.id}`);
    const before = gitlab.writes().length;
    const pending = app.services.gitlab.reconcile();
    await held.hit;
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'member', actor: 'system' });
    const immediate = app.services.gitlab.syncAccount(accountOf(101), 'system');
    held.release();
    expect((await pending).failed).toBe(0);
    expect((await immediate)?.error).toBeNull();
    expect(gitlab.writes().slice(before)).toEqual([]);
    expect(alice.state).toBe('active');
  });

  it('does not treat a skipped identity page as a complete lookup before blocking', async () => {
    const { app, gitlab, accountOf, subOf } = await setup();
    signIn(app, 'alice', 101);
    gitlab.users.push({ id: 444, username: 'alice', name: 'Alice', email: 'alice@example.test', state: 'active',
      provider: 'openid_connect', extern_uid: subOf(101) });
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    gitlab.replyOnce('GET /users?', () => new Response(JSON.stringify([{ id: 444, username: 'alice' }]),
      { status: 200, headers: { 'x-next-page': '3' } }));
    gitlab.replyOnce('GET /users?', () => new Response('[]', { status: 200 }));
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('gitlab_pagination_incomplete');
    expect(gitlab.users[0].state).toBe('active');
    expect(gitlab.writes()).toEqual([]);
    expect(app.services.gitlab.gitlabUserFor(accountOf(101))).toBeNull();
  });

  it('reblocks a revoked managed account if its remote state drifted after a successful block', async () => {
    const { app, gitlab, accountOf } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    expect(alice.state).toBe('blocked');
    alice.state = 'active';
    expect((await app.services.gitlab.reconcile()).failed).toBe(0);
    expect(alice.state).toBe('blocked');
  });

  it('converges to restored authority when restoration happens after block was sent', async () => {
    const { app, gitlab, accountOf } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    const sub = alice.extern_uid;
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    const held = gitlab.hold(`POST /users/${alice.id}/block`);
    const pending = app.services.gitlab.reconcile();
    await held.hit;
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'member', actor: 'system' });
    held.release();
    expect((await pending).failed).toBe(0);
    expect(alice.state).toBe('active');
    expect(alice.extern_uid).toBe(sub);
  });

  it('keeps failed block retryable instead of recording a successful revocation', async () => {
    const { app, gitlab, accountOf } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    gitlab.fail(`POST /users/${alice.id}/block`, 503);
    expect((await app.services.gitlab.syncAccount(accountOf(101), 'system'))?.error).toBe('gitlab_block_503');
    expect(alice.state).toBe('active');
    expect((await app.services.gitlab.syncAccount(accountOf(101), 'system'))?.error).toBeNull();
    expect(alice.state).toBe('blocked');
  });

  it.each([401, 403, 404, 429, 500, 503])('HTTP %i during mapped identity verification cannot block, and retry still revokes', async status => {
    const { app, gitlab, accountOf } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    gitlab.fail(`GET /users/${alice.id}`, status);
    const writes = gitlab.writes().length;
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe(`gitlab_lookup_${status}`);
    expect(alice.state).toBe('active');
    expect(gitlab.writes().slice(writes)).toEqual([]);
    expect((await app.services.gitlab.reconcile()).failed).toBe(0);
    expect(alice.state).toBe('blocked');
  });

  it.each([
    { is_admin: true }, { bot: true }, { user_type: 'service_account' }, { username: 'root' },
  ])('never mutates protected remote users: %j', async protectedFields => {
    const { app, gitlab, accountOf } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    Object.assign(alice, protectedFields);
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    const writes = gitlab.writes().length;
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('gitlab_user_protected');
    expect(alice.state).toBe('active');
    expect(gitlab.writes().slice(writes)).toEqual([]);
  });

  it.each([null, { id: 100 }, { id: 100, username: 'alice', state: 'active', is_admin: false }])('incomplete remote details are unknown, not evidence for block: %j', async details => {
    const { app, gitlab, accountOf } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    gitlab.replyOnce(`GET /users/${alice.id}`, () => new Response(JSON.stringify(details), { status: 200 }));
    const writes = gitlab.writes().length;
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('gitlab_user_incomplete');
    expect(alice.state).toBe('active');
    expect(gitlab.writes().slice(writes)).toEqual([]);
  });

  it('missing sub and request timeout do not regenerate a subject or block a cached id', async () => {
    const { app, gitlab, accountOf, db } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    const writes = gitlab.writes().length;
    gitlab.replyOnce(`GET /users/${alice.id}`, () => { throw new DOMException('Synthetic timeout', 'TimeoutError'); });
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('gitlab_unreachable');
    db.prepare('DELETE FROM oauth_subjects WHERE user_id = ?').run(accountOf(101));
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('gitlab_subject_missing');
    expect(app.services.oidcStore.existingSubject('git.example.test', accountOf(101))).toBeNull();
    expect(gitlab.writes().slice(writes)).toEqual([]);
    expect(alice.state).toBe('active');
  });

  it('does not adopt ambiguous lookup results or merge an unmanaged user with the same email', async () => {
    const { app, gitlab, accountOf, subOf } = await setup();
    signIn(app, 'alice', 101);
    const sub = subOf(101);
    gitlab.users.push({ id: 999, username: 'unmanaged', email: 'shared@example.test', name: 'Unmanaged', state: 'active', provider: null, extern_uid: null });
    app.services.identity.linkEmail({ accountId: accountOf(101), email: 'shared@example.test', login: 'alice', claim: () => true });
    gitlab.replyOnce('GET /users?', () => new Response(JSON.stringify([{ id: 100, username: 'alice' }, { id: 101, username: 'other' }]), { status: 200 }));
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('gitlab_identity_ambiguous');
    expect(gitlab.writes()).toEqual([]);
    expect((await app.services.gitlab.reconcile()).failed).toBe(1); // only the duplicate email update fails
    expect(app.services.gitlab.gitlabUserFor(accountOf(101))?.gitlabUserId).not.toBe(999);
    expect(userNamed(gitlab, 'alice')?.extern_uid).toBe(sub);
    expect(gitlab.users[0]).toMatchObject({ id: 999, state: 'active', provider: null, extern_uid: null, email: 'shared@example.test' });
  });
});

describe('GitLab account sync (#270)', () => {
  it('creates one GitLab user per member with the OIDC identity, profile, avatar and group access', async () => {
    const { app, gitlab, github, accountOf, promote, subOf, row } = await setup(SYNC_ENV, {
      101: { name: 'Alice Liu', bio: 'Rust 和编译器', blog: 'alice.dev', location: '荆州', avatar_url: 'https://avatars.githubusercontent.com/u/101?v=4' },
    });
    signIn(app, 'alice', 101, 'https://avatars.githubusercontent.com/u/101');
    signIn(app, 'admiral', 1);
    promote(1);

    const summary = await app.services.gitlab.reconcile();
    expect(summary).toMatchObject({ mode: 'on', accounts: 2, changed: 2, failed: 0 });

    const alice = userNamed(gitlab, 'alice')!;
    expect(alice).toMatchObject({
      extern_uid: subOf(101), provider: 'openid_connect', email: 'alice@noreply.git.example.test',
      name: 'Alice Liu', bio: 'Rust 和编译器', location: '荆州', website_url: 'https://alice.dev', avatar: `image/png ${PNG.length} avatar.png`,
    });
    expect(alice.extern_uid).not.toBe(accountOf(101));
    const admiral = userNamed(gitlab, 'admiral')!;
    expect(gitlab.members.get(alice.id)).toBe(30);
    expect(gitlab.members.get(admiral.id)).toBe(50);
    expect(github.calls).toContain('https://api.github.com/user/101');
    // 向 GitHub 要 256 像素的头像；没记下头像地址的按 GitHub 数字 id 取
    expect(github.calls).toContain('https://avatars.githubusercontent.com/u/101?s=256');
    expect(github.calls).toContain('https://avatars.githubusercontent.com/u/1?s=256');
    expect(admiral.avatar).toBe(`image/png ${PNG.length} avatar.png`);
    expect(row(101)).toMatchObject({
      gitlab_user_id: alice.id, username: 'alice', state: 'active', access_level: 30, avatar_source: 'https://avatars.githubusercontent.com/u/101', last_error: null,
    });
    // GitHub noreply 邮箱以「已确认」加到名下，提交里用它的能认出是谁（#272）
    expect(emailsOn(gitlab, 'alice')).toEqual(['alice@noreply.git.example.test', '101+alice@users.noreply.github.com', 'alice@users.noreply.github.com']);
    expect(alice.emails!.every(item => item.confirmed_at)).toBe(true);
    expect(JSON.parse(String(row(101)!.emails_source))).toEqual({ primary: null, others: ['101+alice@users.noreply.github.com', 'alice@users.noreply.github.com'] });
    expect(app.services.gitlab.gitlabUserFor(accountOf(101))).toEqual({ gitlabUserId: alice.id, username: 'alice', state: 'active' });
    expect(await app.services.gitlab.accountForGitlabUser(admiral.id)).toBe(accountOf(1));

    // 第二次对账什么都不用做，也不再读 GitHub
    const writes = gitlab.writes().length;
    const githubCalls = github.calls.length;
    expect(await app.services.gitlab.reconcile()).toMatchObject({ changed: 0, failed: 0 });
    expect(gitlab.writes()).toHaveLength(writes);
    expect(github.calls).toHaveLength(githubCalls);
    // 两个账号同一毫秒建号，对账顺序由 ULID 的随机部分决定，这里不比较先后
    const audit = activityRows(app, { action: 'gitlab.sync' }).map(row => row.target_id).sort();
    expect(audit).toEqual(['admiral', 'alice']);
  });

  it('gives GitLab Owner to whoever is in the site owner group, not to the old org_role (#274)', async () => {
    const { app, gitlab, accountOf, db } = await setup(SYNC_ENV);
    signIn(app, 'bob', 202);
    // 控制台任命站长只写 perm_members（PATCH /api/console/users/:id），不碰 users.org_role
    db.prepare("INSERT INTO perm_members(account_id, group_id, expires_at, granted_by, created_at) VALUES (?, 'title.site.owner', NULL, 'test', ?)").run(accountOf(202), Date.now());
    app.services.permissions.bump();
    await app.services.gitlab.reconcile();
    const bob = userNamed(gitlab, 'bob')!;
    expect(gitlab.members.get(bob.id)).toBe(50);

    db.prepare("DELETE FROM perm_members WHERE account_id = ? AND group_id = 'title.site.owner'").run(accountOf(202));
    app.services.permissions.bump();
    await app.services.gitlab.reconcile();
    expect(gitlab.members.get(bob.id)).toBe(30);
  });

  it('uses the verified email, and falls back to a noreply address when GitLab already has it', async () => {
    const { app, gitlab, db, accountOf } = await setup();
    signIn(app, 'carol', 103);
    signIn(app, 'dave', 104);
    db.prepare('UPDATE users SET canonical_email = ? WHERE id = ?').run('carol@example.test', accountOf(103));
    db.prepare('UPDATE users SET canonical_email = ? WHERE id = ?').run('dave@example.test', accountOf(104));
    gitlab.users.push({ id: 7, username: 'someone', email: 'dave@example.test', name: 'someone', state: 'active', extern_uid: null, provider: null });
    const summary = await app.services.gitlab.reconcile();
    expect(userNamed(gitlab, 'carol')!.email).toBe('carol@example.test');
    expect(userNamed(gitlab, 'dave')!.email).toBe('dave@noreply.git.example.test');
    // dave 的邮箱在别的 GitLab 用户名下：改不成主邮箱，成员页看得到原因；noreply 邮箱照样加上（#272）
    expect(summary.outcomes.find(item => item.login === 'dave')).toMatchObject({ error: 'gitlab_email_409', applied: false });
    expect(emailsOn(gitlab, 'dave')).toEqual(['dave@noreply.git.example.test', '104+dave@users.noreply.github.com', 'dave@users.noreply.github.com']);
    expect(summary.outcomes.find(item => item.login === 'carol')).toMatchObject({ error: null });
  });

  it('adds a suffix when the username is reserved, the group name or taken on GitLab, and keeps it afterwards', async () => {
    const { app, gitlab, row } = await setup();
    gitlab.users.push({ id: 5, username: 'Bob', email: 'bob@elsewhere.test', name: 'Bob', state: 'active', extern_uid: null, provider: null });
    signIn(app, 'bob', 202);
    signIn(app, 'admin', 303);
    signIn(app, 'geek', 304);
    signIn(app, 'repo.git', 305);
    const summary = await app.services.gitlab.reconcile();
    expect(summary.failed).toBe(0);
    expect(row(202)).toMatchObject({ username: 'bob_yz', state: 'active' });
    expect(row(303)).toMatchObject({ username: 'admin_yz' });
    expect(row(304)).toMatchObject({ username: 'geek_yz' });
    expect(row(305)).toMatchObject({ username: 'repo_git' });
    // GitLab 上那个 Bob 不是我们建的，不碰它
    expect(gitlab.users.find(user => user.id === 5)).toMatchObject({ username: 'Bob', state: 'active' });
    expect(gitlab.members.has(5)).toBe(false);
  });

  it('blocks accounts that leave or are disabled, unblocks them when they return, and never deletes', async () => {
    const { app, gitlab, accountOf, promote, row, db } = await setup();
    signIn(app, 'alice', 101);
    signIn(app, 'admiral', 1);
    promote(1);
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;

    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    expect(app.services.gitlab.status().find(item => item.login === 'alice')!.pending).toEqual([{ kind: 'block' }]);
    await app.services.gitlab.reconcile();
    expect(alice.state).toBe('blocked');
    expect(row(101)).toMatchObject({ state: 'blocked' });

    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'admin', actor: 'system' });
    await app.services.gitlab.reconcile();
    expect(alice.state).toBe('active');
    expect(gitlab.members.get(alice.id)).toBe(50);
    expect(row(101)).toMatchObject({ state: 'active', access_level: 50 });

    db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(accountOf(101));
    await app.services.gitlab.reconcile();
    expect(alice.state).toBe('blocked');
    // GitLab 那边已经被人手工封了：对账照样认成功
    db.prepare("UPDATE gitlab_accounts SET state = 'active' WHERE account_id = ?").run(accountOf(101));
    expect((await app.services.gitlab.reconcile()).failed).toBe(0);
    expect(row(101)).toMatchObject({ state: 'blocked', last_error: null });
    expect(gitlab.calls.some(call => call.startsWith('DELETE '))).toBe(false);
  });

  it('does not create users for accounts that are not members', async () => {
    const { app, gitlab, accountOf, row } = await setup();
    signIn(app, 'alice', 101);
    signIn(app, 'admiral', 1);
    app.services.identity.setSiteRole({ accountId: accountOf(1), role: 'admin', actor: 'system' });
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    await app.services.gitlab.reconcile();
    expect(row(101)).toBeUndefined();
    expect(userNamed(gitlab, 'alice')).toBeUndefined();
  });

  it('adopts the GitLab user that already carries the OIDC identity instead of creating another', async () => {
    const { app, gitlab, subOf, row } = await setup();
    signIn(app, 'alice', 101);
    gitlab.users.push({ id: 42, username: 'alice-old', email: 'old@example.test', name: 'Alice', state: 'active', extern_uid: subOf(101), provider: 'openid_connect' });
    await app.services.gitlab.reconcile();
    expect(gitlab.calls).not.toContain('POST /users');
    expect(row(101)).toMatchObject({ gitlab_user_id: 42, username: 'alice-old', state: 'active', access_level: 30 });
    expect(gitlab.members.get(42)).toBe(30);
  });

  it('prefers the unified account profile and its uploaded avatar over GitHub (#274: profile source moved from forum_users to account_profiles)', async () => {
    const { app, gitlab, github, accountOf, db } = await setup();
    signIn(app, 'alice', 101, 'https://avatars.githubusercontent.com/u/101');
    const now = Date.now();
    db.prepare('INSERT INTO account_avatars(hash, data, mime, created_at) VALUES(?, ?, ?, ?)').run('a'.repeat(64), Buffer.from('RIFF0000WEBPVP8 '), 'image/webp', now);
    db.prepare('INSERT OR REPLACE INTO account_profiles(account_id, username, display_name, bio, avatar_hash, updated_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(accountOf(101), 'alice', '刘爱丽', '写编译器', 'a'.repeat(64), now);
    await app.services.gitlab.reconcile();
    // account_profiles 没有「所在地」「网站」这两项（统一资料只剩用户名、显示名、简介、头像，SPEC §3.6）：本地已经有简介时
    // 不再去读 GitHub 公开资料补这两项，所以这里是空的——这是模型简化后的真实行为，不是漏填。
    expect(userNamed(gitlab, 'alice')).toMatchObject({ name: '刘爱丽', bio: '写编译器', location: '', website_url: '', avatar: 'image/webp 16 avatar.webp' });
    expect(github.calls).toEqual([]);
  });

  it('records the failure, keeps the reserved username and finishes on the next run', async () => {
    const { app, gitlab, row } = await setup();
    signIn(app, 'alice', 101);
    gitlab.fail('POST /groups/geek/members', 500);
    const first = await app.services.gitlab.reconcile();
    expect(first).toMatchObject({ changed: 0, failed: 1 });
    expect(first.outcomes[0]).toMatchObject({ login: 'alice', error: 'gitlab_member_500', applied: false });
    expect(row(101)).toMatchObject({ username: 'alice', state: 'active', access_level: null, last_error: 'gitlab_member_500' });
    expect(app.services.gitlab.status()[0].pending).toEqual([{ kind: 'set_access', access_level: 30 }, { kind: 'set_avatar' }, { kind: 'set_emails' }]);

    gitlab.setUnreachable(true);
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('gitlab_unreachable');
    gitlab.setUnreachable(false);

    const second = await app.services.gitlab.reconcile();
    expect(second).toMatchObject({ changed: 1, failed: 0 });
    expect(second.outcomes[0].actions).toEqual([{ kind: 'set_access', access_level: 30 }, { kind: 'set_avatar' }, { kind: 'set_emails' }]);
    expect(row(101)).toMatchObject({ access_level: 30, last_error: null, last_error_at: null });
    expect(gitlab.users.filter(user => user.username === 'alice')).toHaveLength(1);
  });

  it('asks GitHub for a small avatar, names the file by its type and holds back one GitLab would refuse (#271)', async () => {
    const { app, gitlab, github, row } = await setup();
    signIn(app, 'alice', 101, 'https://avatars.githubusercontent.com/u/101?v=4');
    const jpeg = Buffer.alloc(1024, 1);
    github.avatar(() => new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg; charset=binary' } }));
    await app.services.gitlab.reconcile();
    expect(github.calls).toContain('https://avatars.githubusercontent.com/u/101?v=4&s=256');
    expect(userNamed(gitlab, 'alice')!.avatar).toBe(`image/jpeg ${jpeg.length} avatar.jpg`);

    // 256 像素的还超过 200 KiB：不传，成员页看得到原因，下一轮再下载一次
    signIn(app, 'bob', 202, 'https://avatars.githubusercontent.com/u/202?v=4');
    github.avatar(() => new Response(Buffer.alloc(200 * 1024 + 1), { status: 200, headers: { 'content-type': 'image/png' } }));
    const summary = await app.services.gitlab.reconcile();
    expect(summary).toMatchObject({ changed: 0, failed: 1 });
    expect(summary.outcomes.find(item => item.login === 'bob')).toMatchObject({ error: 'avatar_too_large', applied: false });
    expect(userNamed(gitlab, 'bob')!.state).toBe('active');
    expect(userNamed(gitlab, 'bob')!.avatar).toBeUndefined();
    expect(gitlab.calls.filter(call => call.startsWith('PUT /users/'))).toHaveLength(1);
    expect(row(202)).toMatchObject({ state: 'active', access_level: 30, avatar_source: null, last_error: 'avatar_too_large' });
    expect(app.services.gitlab.status().find(item => item.login === 'bob')!.pending).toEqual([{ kind: 'set_avatar' }]);
    const githubCalls = github.calls.length;
    expect((await app.services.gitlab.reconcile()).failed).toBe(1);
    expect(github.calls.length).toBeGreaterThan(githubCalls);

    // GitHub 说没有这个头像（404）、回的不是图片：同样记下原因，下一轮再试
    github.avatar(() => new Response('not found', { status: 404 }));
    expect((await app.services.gitlab.reconcile()).outcomes.find(item => item.login === 'bob')!.error).toBe('github_avatar_404');
    github.avatar(() => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect((await app.services.gitlab.reconcile()).outcomes.find(item => item.login === 'bob')!.error).toBe('github_avatar_not_image');

    // 账号资料指向的头像已经不在库里（#274：头像来源换成 account_avatars，没有外键约束，不用切 foreign_keys）
    signIn(app, 'carol', 103);
    const now = Date.now();
    const carolAccountId = app.services.identity.accountForGithub(103)!;
    app.services.storage.db.prepare('INSERT INTO account_avatars(hash, data, mime, created_at) VALUES(?, ?, ?, ?)').run('c'.repeat(64), Buffer.from('RIFF0000WEBPVP8 '), 'image/webp', now);
    app.services.storage.db.prepare('INSERT OR REPLACE INTO account_profiles(account_id, username, display_name, avatar_hash, updated_at) VALUES(?, ?, ?, ?, ?)').run(carolAccountId, 'carol', 'carol', 'c'.repeat(64), now);
    app.services.storage.db.prepare('DELETE FROM account_avatars WHERE hash = ?').run('c'.repeat(64));
    expect((await app.services.gitlab.reconcile()).outcomes.find(item => item.login === 'carol')!.error).toBe('forum_avatar_missing');

    // 头像小下来以后，下一轮传上去，错误清掉
    github.avatar(() => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }));
    await app.services.gitlab.reconcile();
    expect(userNamed(gitlab, 'bob')!.avatar).toBe(`image/png ${PNG.length} avatar.png`);
    expect(row(202)).toMatchObject({ avatar_source: 'https://avatars.githubusercontent.com/u/202?v=4', last_error: null });
  });

  it('records a refused or failed avatar upload and retries it on the next round (#271)', async () => {
    const { app, gitlab, github, row } = await setup();
    signIn(app, 'alice', 101);
    gitlab.fail('PUT /users/', 400);
    const first = await app.services.gitlab.reconcile();
    expect(first.outcomes[0]).toMatchObject({ error: 'gitlab_avatar_400', applied: false });
    // 建号、进组已经做完，只剩头像
    expect(row(101)).toMatchObject({ state: 'active', access_level: 30, avatar_source: null, last_error: 'gitlab_avatar_400' });
    expect(app.services.gitlab.status()[0].pending).toEqual([{ kind: 'set_avatar' }]);

    // GitHub 回 5xx、429 或连不上：下一轮再试
    github.avatar(() => new Response('', { status: 503 }));
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('github_avatar_503');
    github.avatar(() => new Response('', { status: 429 }));
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('github_avatar_429');
    github.avatar(() => { throw new TypeError('fetch failed'); });
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('github_avatar_unreachable');
    expect(row(101)).toMatchObject({ avatar_source: null, last_error: 'github_avatar_unreachable' });

    github.avatar(() => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }));
    const last = await app.services.gitlab.reconcile();
    expect(last).toMatchObject({ changed: 1, failed: 0 });
    expect(last.outcomes[0].actions).toEqual([{ kind: 'set_avatar' }]);
    expect(userNamed(gitlab, 'alice')!.avatar).toBe(`image/png ${PNG.length} avatar.png`);
    expect(row(101)).toMatchObject({ avatar_source: 'https://avatars.githubusercontent.com/u/101', last_error: null });
    expect(gitlab.users.filter(user => user.username === 'alice')).toHaveLength(1);
  });

  it('uploads the avatar for accounts synced before avatars were tracked, and again when the account avatar changes (#271, #274)', async () => {
    const { app, gitlab, accountOf, row, db } = await setup();
    signIn(app, 'alice', 101, 'https://avatars.githubusercontent.com/u/101?v=4');
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    // 上一个版本建的号：没有头像，也没记来源
    db.prepare('UPDATE gitlab_accounts SET avatar_source = NULL').run();
    alice.avatar = undefined;
    const before = gitlab.writes().length;
    expect(app.services.gitlab.status()[0].pending).toEqual([{ kind: 'set_avatar' }]);
    expect(await app.services.gitlab.reconcile()).toMatchObject({ changed: 1, failed: 0 });
    expect(gitlab.writes().slice(before)).toEqual([`PUT /users/${alice.id}`]);
    expect(alice.avatar).toBe(`image/png ${PNG.length} avatar.png`);

    // 账号换了头像（#274：头像来源从 forum_users/forum_avatars 换成 account_profiles/account_avatars）：下一轮传新的
    const now = Date.now();
    db.prepare('INSERT INTO account_avatars(hash, data, mime, created_at) VALUES(?, ?, ?, ?)').run('b'.repeat(64), Buffer.from('RIFF0000WEBPVP8 '), 'image/webp', now);
    // 第一轮 reconcile 已经 ensure() 过这一行（account-profiles.ts 的兜底）：这里是改头像，不是建新资料
    db.prepare('UPDATE account_profiles SET avatar_hash = ?, updated_at = ? WHERE account_id = ?').run('b'.repeat(64), now, accountOf(101));
    expect(app.services.gitlab.status()[0].pending).toEqual([{ kind: 'set_avatar' }]);
    await app.services.gitlab.reconcile();
    expect(alice.avatar).toBe('image/webp 16 avatar.webp');
    expect(row(101)).toMatchObject({ avatar_source: `forum:${'b'.repeat(64)}` });
    expect(app.services.gitlab.status()[0].pending).toEqual([]);
  });

  it('uploads the same unified avatar the site shows: identicon → NANO, real GitHub photo → its site copy, upload → the site file (#343)', async () => {
    const { app, gitlab, github, accountOf, row, db } = await setup();
    // GitHub 自动生成的像素图（420×420、#F0F0F0 底、一种前景色）和一张渐变照片
    const pixels = Buffer.alloc(420 * 420 * 3, 0xf0);
    for (let y = 35; y < 385; y++) for (let x = 35; x < 385; x++) if (((x - 35) / 70 | 0) % 2 === ((y - 35) / 70 | 0) % 2) pixels.set([0x5b, 0x9b, 0xd5], (y * 420 + x) * 3);
    const identicon = await sharp(pixels, { raw: { width: 420, height: 420, channels: 3 } }).png().toBuffer();
    const gradient = Buffer.alloc(420 * 420 * 3);
    for (let i = 0; i < 420 * 420; i++) gradient.set([i % 420 * 255 / 420 | 0, (i / 420 | 0) * 255 / 420 | 0, 128], i * 3);
    const photo = await sharp(gradient, { raw: { width: 420, height: 420, channels: 3 } }).jpeg().toBuffer();
    github.avatar(() => new Response(new Uint8Array(identicon), { status: 200, headers: { 'content-type': 'image/png' } }));
    signIn(app, 'pixel', 301, 'https://avatars.githubusercontent.com/u/301?v=4');
    expect(await app.services.gitlab.reconcile()).toMatchObject({ failed: 0 });
    const pixel = userNamed(gitlab, 'pixel')!;
    // GitLab 头像服务按主邮箱挑图，站内用的是同一个地址：这里没有主邮箱，是建号用的占位地址
    const index = nanoAvatarIndex(pixel.email);
    const nano = readFileSync(join(REPO_ROOT, 'deploy/gitlab/ui/nano-avatars', NANO_AVATAR_VERSION, `avatar-0${index}.png`));
    expect(pixel.avatar).toBe(`image/png ${nano.length} avatar.png`);
    expect(row(301)).toMatchObject({ avatar_source: `nano:${NANO_AVATAR_VERSION}/${index}`, last_error: null });
    expect(app.services.avatars.urlOf(accountOf(301))).toBe(`/api/identity/default-avatar/${NANO_AVATAR_VERSION}/${index}.png`);

    github.avatar(() => new Response(new Uint8Array(photo), { status: 200, headers: { 'content-type': 'image/jpeg' } }));
    signIn(app, 'photo', 302, 'https://avatars.githubusercontent.com/u/302?v=4');
    await app.services.gitlab.reconcile();
    const site = app.services.avatars.ofAccount(accountOf(302));
    expect(site).toMatchObject({ kind: 'github', checked: true, url: expect.stringMatching(/^\/api\/identity\/avatar\/[0-9a-f]{64}\.webp$/) });
    const copy = app.services.profiles.avatar((site as { hash: string }).hash)!;
    expect(userNamed(gitlab, 'photo')!.avatar).toBe(`image/webp ${copy.length} avatar.webp`);
    expect(row(302)).toMatchObject({ avatar_source: 'https://avatars.githubusercontent.com/u/302?v=4', last_error: null });

    // 同一张像素图下一轮不再传；在站内上传了头像就改传站内那张
    const before = gitlab.writes().length;
    await app.services.gitlab.reconcile();
    expect(gitlab.writes().slice(before)).toEqual([]);
    const now = Date.now();
    db.prepare('INSERT INTO account_avatars(hash, data, mime, created_at) VALUES(?, ?, ?, ?)').run('d'.repeat(64), Buffer.from('RIFF0000WEBPVP8 '), 'image/webp', now);
    db.prepare('UPDATE account_profiles SET avatar_hash = ?, updated_at = ? WHERE account_id = ?').run('d'.repeat(64), now, accountOf(301));
    await app.services.gitlab.reconcile();
    expect(pixel.avatar).toBe('image/webp 16 avatar.webp');
    expect(row(301)).toMatchObject({ avatar_source: `forum:${'d'.repeat(64)}` });
  });

  it('blocks the user GitLab created at sign-in when the account leaves before it was ever synced', async () => {
    const { app, gitlab, accountOf, subOf, row } = await setup();
    signIn(app, 'alice', 101);
    signIn(app, 'erin', 105);
    // 同步关着、或者在下一轮对账之前：alice 用极客班登录过 GitLab，GitLab 按她的 sub 自动建了号
    gitlab.users.push({ id: 61, username: 'alice', email: 'alice@example.test', name: 'Alice', state: 'active', extern_uid: subOf(101), provider: 'openid_connect' });
    // erin 走到过 GitLab 的登录，有 sub，但 GitLab 上没有她
    subOf(105);
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    app.services.identity.setSiteRole({ accountId: accountOf(105), role: 'none', actor: 'system' });
    expect(app.services.gitlab.status().find(item => item.login === 'alice')!.pending).toEqual([{ kind: 'find_and_block' }]);

    expect(await app.services.gitlab.reconcile()).toMatchObject({ changed: 1, failed: 0 });
    expect(gitlab.users.find(user => user.id === 61)!.state).toBe('blocked');
    expect(row(101)).toMatchObject({ gitlab_user_id: 61, username: 'alice', state: 'blocked', last_error: null });
    expect(row(105)).toBeUndefined();
    expect(gitlab.calls.filter(call => call === 'POST /users')).toEqual([]);

    // 对上了的不再找；没对上的 erin 每轮照样按身份找一次，没找到就不写也不记审计
    const audit = () => activityRows(app, { action: 'gitlab.sync' }).length;
    const audits = audit();
    const calls = gitlab.calls.length;
    expect(await app.services.gitlab.reconcile()).toMatchObject({ changed: 0, failed: 0 });
    expect(gitlab.calls.slice(calls).sort()).toEqual(['GET /users', 'GET /users/61']);
    expect(audit()).toEqual(audits);
    // GitLab 不通时 erin 的查找失败：算进 failed，可她没有这一行、什么也没改，同样不写审计
    gitlab.setUnreachable(true);
    expect(await app.services.gitlab.reconcile()).toMatchObject({ changed: 0, failed: 2 });
    gitlab.setUnreachable(false);
    expect(row(105)).toBeUndefined();
    expect(audit()).toEqual(audits + 1); // 已管理的 alice 记核验失败，未找到的 erin 仍不记。

    // 回来了：alice 解封沿用原来的号，erin 照常建号
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'member', actor: 'system' });
    app.services.identity.setSiteRole({ accountId: accountOf(105), role: 'member', actor: 'system' });
    expect(await app.services.gitlab.reconcile()).toMatchObject({ changed: 2, failed: 0 });
    expect(gitlab.users.find(user => user.id === 61)!.state).toBe('active');
    expect(row(101)).toMatchObject({ gitlab_user_id: 61, state: 'active', access_level: 30 });
    expect(userNamed(gitlab, 'erin')).toMatchObject({ extern_uid: subOf(105), state: 'active' });
    expect(row(105)).toMatchObject({ username: 'erin', state: 'active', access_level: 30 });
  });

  it('keeps looking for a departed account that signs in to GitLab again between two rounds', async () => {
    const { app, gitlab, accountOf, subOf, row } = await setup();
    signIn(app, 'erin', 105);
    const sub = subOf(105);
    const role = (value: 'member' | 'none') => app.services.identity.setSiteRole({ accountId: accountOf(105), role: value, actor: 'system' });
    role('none');
    await app.services.gitlab.reconcile();
    expect(gitlab.users).toEqual([]);

    // 她回来，回来那一轮 GitLab 不通；这期间她用极客班登录了一次 GitLab（GitLab 自动建号），下一轮之前又离开
    role('member');
    gitlab.setUnreachable(true);
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('gitlab_unreachable');
    gitlab.setUnreachable(false);
    gitlab.users.push({ id: 71, username: 'erin', email: 'erin@example.test', name: 'Erin', state: 'active', extern_uid: sub, provider: 'openid_connect' });
    role('none');
    expect(await app.services.gitlab.reconcile()).toMatchObject({ changed: 1, failed: 0 });
    expect(gitlab.users[0].state).toBe('blocked');
    expect(row(105)).toMatchObject({ gitlab_user_id: 71, state: 'blocked', last_error: null });

    // 同样的事不经过失败的那一轮也一样：离开、没找到，回来登录、下一轮之前又离开
    signIn(app, 'finn', 106);
    const finnSub = subOf(106);
    app.services.identity.setSiteRole({ accountId: accountOf(106), role: 'none', actor: 'system' });
    await app.services.gitlab.reconcile();
    gitlab.users.push({ id: 72, username: 'finn', email: 'finn@example.test', name: 'Finn', state: 'active', extern_uid: finnSub, provider: 'openid_connect' });
    await app.services.gitlab.reconcile();
    expect(gitlab.users.find(user => user.id === 72)!.state).toBe('blocked');
  });

  it('decides on the account as it is now, not on the list taken when the round started', async () => {
    const { app, gitlab, accountOf, db } = await setup();
    signIn(app, 'alice', 101);
    signIn(app, 'bob', 202);
    // 两个号可能同一毫秒建成，对账按建号先后、再按随机的 id 排：让 bob 一定排在 alice 后面
    db.prepare('UPDATE users SET created_at = created_at + 1000 WHERE id = ?').run(accountOf(202));
    await app.services.gitlab.reconcile();
    const bob = userNamed(gitlab, 'bob')!;
    // alice 这一轮要改组权限，停在半路；这时管理员把 bob 移出成员并立即同步
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'admin', actor: 'system' });
    const held = gitlab.hold('POST /groups/geek/members');
    const round = app.services.gitlab.reconcile();
    await held.hit;
    app.services.identity.setSiteRole({ accountId: accountOf(202), role: 'none', actor: 'system' });
    expect(await app.services.gitlab.syncAccount(accountOf(202), 'system')).toMatchObject({ actions: [{ kind: 'block' }], error: null });
    held.release();
    await round;
    expect(bob.state).toBe('blocked');
  });

  it('leaves alone an account that was merged into another while the round was running', async () => {
    const { app, gitlab, accountOf, db } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    signIn(app, 'bob', 202);
    const alice = accountOf(101);
    const bob = accountOf(202);
    db.prepare('UPDATE users SET created_at = created_at + 1000 WHERE id = ?').run(bob);
    // alice 这一轮要改组权限，停在半路；这时 bob 被合并进 alice，这一轮开头的名单里他还是个没建号的成员
    app.services.identity.setSiteRole({ accountId: alice, role: 'admin', actor: 'system' });
    const held = gitlab.hold('POST /groups/geek/members');
    const round = app.services.gitlab.reconcile();
    await held.hit;
    db.prepare("UPDATE users SET status = 'merged', merged_into = ? WHERE id = ?").run(alice, bob);
    held.release();
    const summary = await round;
    expect(summary.outcomes.map(item => item.login)).toEqual(['alice', 'bob']);
    expect(summary.outcomes[1]).toEqual({ account_id: bob, login: 'bob', actions: [], applied: false, error: null });
    expect(gitlab.users.map(user => user.username)).toEqual(['alice']);
    expect(db.prepare('SELECT 1 FROM gitlab_accounts WHERE account_id = ?').get(bob)).toBeUndefined();
  });

  it('never runs a manual sync of an account at the same time as the scheduled one', async () => {
    const { app, gitlab, accountOf, row } = await setup();
    signIn(app, 'bob', 202);
    const [summary, manual] = await Promise.all([app.services.gitlab.reconcile(), app.services.gitlab.syncAccount(accountOf(202), 'system')]);
    expect(summary.failed).toBe(0);
    expect(manual).toMatchObject({ actions: [], error: null });
    expect(gitlab.calls.filter(call => call === 'POST /users')).toHaveLength(1);
    expect(gitlab.users.map(user => user.username)).toEqual(['bob']);
    expect(row(202)).toMatchObject({ gitlab_user_id: gitlab.users[0].id, username: 'bob', state: 'active', last_error: null });
  });

  it('takes the sector from the GitLab client, not from GITLAB_URL, and creates nobody until the client is registered', async () => {
    const internal = await setup({ ...SYNC_ENV }, {}, 'https://code.example.test/users/auth/openid_connect/callback');
    signIn(internal.app, 'alice', 101);
    await internal.app.services.gitlab.reconcile();
    const sub = internal.app.services.oidcStore.subjectFor('code.example.test', internal.accountOf(101));
    expect(userNamed(internal.gitlab, 'alice')).toMatchObject({ extern_uid: sub, email: 'alice@noreply.code.example.test' });
    expect(internal.app.services.oidcStore.existingSubject('git.example.test', internal.accountOf(101))).toBeNull();

    const missing = await setup(SYNC_ENV, {}, null);
    signIn(missing.app, 'alice', 101);
    expect(await missing.app.services.gitlab.reconcile()).toMatchObject({ skipped: 'gitlab_client_missing', accounts: 0, outcomes: [] });
    expect(await missing.app.services.gitlab.syncAccount(missing.accountOf(101), 'system')).toMatchObject({ error: 'gitlab_client_missing', applied: false });
    expect(missing.app.services.gitlab.clientRegistered()).toBe(false);
    // 定时对账每一轮记一条错误日志，说出缺的是哪个客户端
    const logs: unknown[][] = [];
    missing.app.services.gitlab.start({ info: (...args) => logs.push(['info', ...args]), error: (...args) => logs.push(['error', ...args]) });
    await vi.waitFor(() => expect(logs).toEqual([['error', { reason: 'gitlab_client_missing', client_id: 'gitlab' }, 'gitlab sync skipped']]));
    await missing.app.services.gitlab.stop();
    expect(missing.gitlab.calls).toEqual([]);
    expect(activityRows(missing.app, { action: 'gitlab.sync' })).toEqual([]);
  });

  it('drops a GitHub blog that is not a web address', async () => {
    const { app, gitlab } = await setup(SYNC_ENV, { 101: { blog: 'my blog' }, 102: { blog: 'http://bob.dev/posts' }, 103: { blog: 'mailto:c@example.test' } });
    signIn(app, 'alice', 101);
    signIn(app, 'bob', 102);
    signIn(app, 'carol', 103);
    await app.services.gitlab.reconcile();
    expect(userNamed(gitlab, 'alice')!.website_url).toBe('');
    expect(userNamed(gitlab, 'bob')!.website_url).toBe('http://bob.dev/posts');
    expect(userNamed(gitlab, 'carol')!.website_url).toBe('');
  });

  it('finishes the account at hand and stops the round when the server shuts down', async () => {
    const { app, gitlab } = await setup();
    signIn(app, 'alice', 101);
    signIn(app, 'bob', 202);
    const round = app.services.gitlab.reconcile();
    await app.services.gitlab.stop();
    expect((await round).accounts).toBe(1);
    expect(gitlab.users).toHaveLength(1);
  });

  it('only plans in dry-run mode and does nothing when off', async () => {
    const dry = await setup({ GITLAB_SYNC: 'dry-run', GITLAB_URL: GITLAB });
    signIn(dry.app, 'alice', 101);
    const summary = await dry.app.services.gitlab.reconcile();
    expect(summary.outcomes).toEqual([{
      account_id: dry.accountOf(101), login: 'alice', actions: [{ kind: 'create', username: 'alice', access_level: 30 }, { kind: 'set_avatar' }, { kind: 'set_emails' }], applied: false, error: null,
    }]);
    expect(dry.github.calls).toEqual([]);
    expect(dry.gitlab.calls).toEqual([]);
    expect(dry.db.prepare('SELECT COUNT(*) AS n FROM gitlab_accounts').get()).toEqual({ n: 0 });

    const off = await setup({});
    signIn(off.app, 'alice', 101);
    expect(await off.app.services.gitlab.reconcile()).toMatchObject({ mode: 'off', accounts: 0 });
    expect(off.app.services.gitlab.status()[0].pending).toEqual([]);
    expect(off.gitlab.calls).toEqual([]);
  });
});

describe('GitLab commit emails (#272)', () => {
  const link = (app: FastifyInstance, accountId: string, email: string) =>
    expect(app.services.identity.linkEmail({ accountId, email, login: 'test', claim: () => true })).toEqual({ ok: true });
  const emailIds = (app: FastifyInstance, accountId: string) =>
    app.services.identity.accountView(accountId).identities.filter(item => item.provider === 'email') as { id: string; label: string }[];

  it('swaps the placeholder for the bound email, adds the others confirmed, drops removed ones and leaves GitLab alone when nothing changed', async () => {
    const { app, gitlab, accountOf, row } = await setup();
    signIn(app, 'alice', 101);
    await app.services.gitlab.reconcile();
    const alice = userNamed(gitlab, 'alice')!;
    const placeholder = alice.emails!.length;
    expect(placeholder).toBe(2);

    link(app, accountOf(101), 'alice@example.test');
    link(app, accountOf(101), 'alice@work.example.test');
    expect(app.services.gitlab.status()[0].pending).toEqual([{ kind: 'set_emails' }]);
    let before = gitlab.calls.length;
    expect(await app.services.gitlab.reconcile()).toMatchObject({ changed: 1, failed: 0 });
    expect(emailsOn(gitlab, 'alice')).toEqual(['alice@example.test', '101+alice@users.noreply.github.com', 'alice@users.noreply.github.com', 'alice@work.example.test']);
    expect(gitlab.calls.slice(before)).toEqual([
      `GET /users/${alice.id}`, `GET /users/${alice.id}`,
      `GET /users/${alice.id}`, `PUT /users/${alice.id}`, `GET /users/${alice.id}/emails`, `POST /users/${alice.id}/emails`, expect.stringMatching(new RegExp(`^DELETE /users/${alice.id}/emails/\\d+$`)),
    ]);
    expect(JSON.parse(String(row(101)!.emails_source))).toEqual({
      primary: 'alice@example.test', others: ['101+alice@users.noreply.github.com', 'alice@users.noreply.github.com', 'alice@work.example.test'],
    });

    // 没变：只核验绑定与远端状态，不重写邮箱。
    before = gitlab.calls.length;
    expect(await app.services.gitlab.reconcile()).toMatchObject({ changed: 0, failed: 0 });
    expect(gitlab.calls.slice(before)).toEqual([`GET /users/${alice.id}`]);

    // 在极客班删掉工作邮箱：GitLab 上也删掉，别的不动
    const work = emailIds(app, accountOf(101)).find(item => item.label.startsWith('a***@work'))!;
    expect(app.services.identity.unlinkEmail({ accountId: accountOf(101), identityId: work.id, login: 'alice' })).toEqual({ ok: true });
    expect(app.services.gitlab.status()[0].pending).toEqual([{ kind: 'set_emails' }]);
    await app.services.gitlab.reconcile();
    expect(emailsOn(gitlab, 'alice')).toEqual(['alice@example.test', '101+alice@users.noreply.github.com', 'alice@users.noreply.github.com']);
    expect(gitlab.calls.filter(call => call.startsWith('PUT '))).toHaveLength(2);
  });

  it('records a refused email, still uploads the avatar and the other emails, and retries on the next round', async () => {
    const { app, gitlab, github, accountOf, row } = await setup();
    signIn(app, 'alice', 101);
    gitlab.users.push({ id: 9, username: 'someone', email: 'someone@example.test', name: 'someone', state: 'active', extern_uid: null, provider: null,
      emails: [{ id: 1, email: 'alice@work.example.test', confirmed_at: CONFIRMED }] });
    link(app, accountOf(101), 'alice@example.test');
    link(app, accountOf(101), 'alice@work.example.test');
    const first = await app.services.gitlab.reconcile();
    expect(first.outcomes[0]).toMatchObject({ error: 'gitlab_email_400', applied: false });
    const alice = userNamed(gitlab, 'alice')!;
    expect(alice.avatar).toBe(`image/png ${PNG.length} avatar.png`);
    expect(emailsOn(gitlab, 'alice')).toEqual(['alice@example.test', '101+alice@users.noreply.github.com', 'alice@users.noreply.github.com']);
    // 只记做成的：工作邮箱不在里面，和要有的不一样，下一轮再试
    expect(row(101)).toMatchObject({ last_error: 'gitlab_email_400', avatar_source: 'https://avatars.githubusercontent.com/u/101' });
    expect(JSON.parse(String(row(101)!.emails_source))).toEqual({ primary: 'alice@example.test', others: ['101+alice@users.noreply.github.com', 'alice@users.noreply.github.com'] });
    expect(app.services.gitlab.status()[0].pending).toEqual([{ kind: 'set_emails' }]);

    // 头像下载失败也不耽误邮箱：两边都试过，报先失败的那个
    gitlab.users[0].emails = [];
    app.services.storage.db.prepare('UPDATE gitlab_accounts SET avatar_source = NULL').run();
    github.avatar(() => new Response('', { status: 503 }));
    const second = await app.services.gitlab.reconcile();
    expect(second.outcomes[0]).toMatchObject({ actions: [{ kind: 'set_avatar' }, { kind: 'set_emails' }], error: 'github_avatar_503' });
    expect(emailsOn(gitlab, 'alice')).toContain('alice@work.example.test');
    expect(row(101)).toMatchObject({ avatar_source: null, last_error: 'github_avatar_503' });
    expect(app.services.gitlab.status()[0].pending).toEqual([{ kind: 'set_avatar' }]);
  });

  it('still drops an email removed on the site while another email keeps being refused', async () => {
    const { app, gitlab, accountOf, row } = await setup();
    signIn(app, 'alice', 101);
    // 主邮箱在别的 GitLab 用户名下：每一轮改主邮箱都回 409
    gitlab.users.push({ id: 9, username: 'someone', email: 'alice@example.test', name: 'someone', state: 'active', extern_uid: null, provider: null });
    link(app, accountOf(101), 'alice@example.test');
    link(app, accountOf(101), 'alice@work.example.test');
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('gitlab_email_409');
    expect(emailsOn(gitlab, 'alice')).toContain('alice@work.example.test');

    // 失败的那一轮加上去的工作邮箱，在极客班删掉以后照样从 GitLab 删掉
    const work = emailIds(app, accountOf(101)).find(item => item.label.startsWith('a***@work'))!;
    app.services.identity.unlinkEmail({ accountId: accountOf(101), identityId: work.id, login: 'alice' });
    expect((await app.services.gitlab.reconcile()).outcomes[0].error).toBe('gitlab_email_409');
    expect(emailsOn(gitlab, 'alice')).toEqual(['alice@noreply.git.example.test', '101+alice@users.noreply.github.com', 'alice@users.noreply.github.com']);
    expect(JSON.parse(String(row(101)!.emails_source))).toEqual({ primary: null, others: ['101+alice@users.noreply.github.com', 'alice@users.noreply.github.com'] });

    // 占用的人把邮箱让出来：下一轮换上主邮箱，删掉占位地址，之后不再调 GitLab
    gitlab.users.find(user => user.id === 9)!.email = 'someone@example.test';
    expect(await app.services.gitlab.reconcile()).toMatchObject({ failed: 0 });
    expect(emailsOn(gitlab, 'alice')).toEqual(['alice@example.test', '101+alice@users.noreply.github.com', 'alice@users.noreply.github.com']);
    const calls = gitlab.calls.length;
    await app.services.gitlab.reconcile();
    expect(gitlab.calls.slice(calls)).toEqual([`GET /users/${userNamed(gitlab, 'alice')!.id}`]);
  });

  it('replaces an email someone added on GitLab but could not confirm', async () => {
    const { app, gitlab } = await setup();
    signIn(app, 'alice', 101);
    gitlab.users.push({ id: 42, username: 'alice', email: 'alice@noreply.git.example.test', name: 'Alice', state: 'active', extern_uid: null, provider: null,
      emails: [{ id: 5, email: 'Alice@users.noreply.github.com', confirmed_at: null }] });
    gitlab.users[0].extern_uid = app.services.oidcStore.subjectFor('git.example.test', app.services.identity.accountForGithub(101)!);
    gitlab.users[0].provider = 'openid_connect';
    await app.services.gitlab.reconcile();
    const emails = gitlab.users[0].emails!;
    expect(emails.map(item => item.email).sort()).toEqual(['101+alice@users.noreply.github.com', 'alice@users.noreply.github.com']);
    expect(emails.every(item => item.confirmed_at)).toBe(true);
    expect(gitlab.calls).toContain('DELETE /users/42/emails/5');
  });
});

describe('console GitLab sync endpoints (#270)', () => {
  async function consoleSetup(env: Record<string, string> = SYNC_ENV) {
    const context = await setup(env);
    const admiralSid = signIn(context.app, 'admiral', 1);
    context.promote(1);
    const memberSid = signIn(context.app, 'alice', 101);
    // 记下站内角色：没记过的账号解析权限时会去问 GitHub，测试里 GitHub 不通
    context.app.services.identity.setSiteRole({ accountId: context.accountOf(101), role: 'member', actor: 'system' });
    const as = (sid: string) => ({ cookie: `sid=${sid}`, origin: 'https://example.test' });
    return { ...context, admiral: as(admiralSid), member: as(memberSid) };
  }
  const sync = (app: FastifyInstance, accountId: string, headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: `/api/console/gitlab/accounts/${accountId}/resync`, headers });

  it('serves GitLab from a path on the site origin with its old sector: links, API base and console follow GITLAB_URL (#335)', async () => {
    const base = 'https://example.test/gitlab';
    const { app, admiral, member, accountOf, subOf, gitlab } = await consoleSetup({ ...SYNC_ENV, GITLAB_URL: base, GITLAB_OIDC_SECTOR: 'git.example.test' });
    // 搬家：先加新回调，验证过再去掉旧的；sector 钉在旧主机上
    app.services.oidcStore.addRedirectUri('gitlab', `${base}/users/auth/openid_connect/callback`);
    app.services.oidcStore.removeRedirectUri('gitlab', `${GITLAB}/users/auth/openid_connect/callback`);
    gitlab.setProjects([
      { id: 11, path_with_namespace: 'geek/site', name: 'site', description: '开源站点', visibility: 'public', web_url: `${base}/geek/site`, http_url_to_repo: `${base}/geek/site.git`, ssh_url_to_repo: 'git@example.test:geek/site.git', last_activity_at: '2026-10-18T00:00:00.000Z', star_count: 1 },
    ]);
    expect((await app.inject('/api/public/gitlab')).headers.location).toBe(`${base}/geek`);
    const links = { web_url: `${base}/geek/site`, http_url_to_repo: `${base}/geek/site.git` };
    expect((await app.inject('/api/public/gitlab/projects')).json().projects).toEqual([expect.objectContaining(links)]);
    expect((await app.inject({ url: '/api/me/gitlab/projects', headers: member })).json().projects).toEqual([expect.objectContaining(links)]);
    expect((await app.inject({ url: '/api/console/gitlab/status', headers: admiral })).json()).toMatchObject({ url: base, healthy: true });
    expect((await app.inject({ url: '/api/console/gitlab/accounts', headers: admiral })).json()).toMatchObject({ gitlab_url: base, client_registered: true });

    const res = await sync(app, accountOf(101), admiral);
    expect(res.json()).toMatchObject({ applied: true, error: null });
    expect(userNamed(gitlab, 'alice')).toMatchObject({ extern_uid: subOf(101), email: 'alice@noreply.git.example.test' });
    // 假 GitLab 只认 <基址路径>/api/v4 下的请求，走到这里说明一次也没丢掉 /gitlab
    expect(gitlab.calls).toContain('POST /users');

    // 库里钉住的 sector 不是本环境配置的：不认人、不建号，说出原因
    const other = await setup({ ...SYNC_ENV, GITLAB_URL: base, GITLAB_OIDC_SECTOR: 'example.test' });
    signIn(other.app, 'alice', 101);
    expect(await other.app.services.gitlab.reconcile()).toMatchObject({ skipped: 'gitlab_sector_mismatch', accounts: 0, outcomes: [] });
    expect(await other.app.services.gitlab.syncAccount(other.accountOf(101), 'system')).toMatchObject({ error: 'gitlab_sector_mismatch', applied: false });
    expect(other.app.services.gitlab.clientRegistered()).toBe(false);
    expect(other.gitlab.calls).toEqual([]);
    expect(other.app.services.oidcStore.existingSubject('git.example.test', other.accountOf(101))).toBeNull();
  });

  it('lists every account with what is still to do, for the people who manage roles', async () => {
    const { app, admiral, member, accountOf } = await consoleSetup();
    const res = await app.inject({ url: '/api/console/gitlab/accounts', headers: admiral });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mode: 'on', gitlab_url: GITLAB, group: 'geek', client_registered: true });
    expect(res.json().accounts).toContainEqual({
      account_id: accountOf(101), login: 'alice', username: null, gitlab_user_id: null, state: null, access_level: null,
      last_error: null, last_error_at: null, synced_at: null, pending: [{ kind: 'create', username: 'alice', access_level: 30 }, { kind: 'set_avatar' }, { kind: 'set_emails' }],
    });
    expect((await app.inject({ url: '/api/console/gitlab/accounts', headers: member })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/console/gitlab/accounts' })).statusCode).toBe(401);
  });

  it('syncs one account on request and records who asked', async () => {
    const { app, admiral, member, accountOf, gitlab } = await consoleSetup();
    expect((await sync(app, accountOf(101), member)).statusCode).toBe(403);
    const res = await sync(app, accountOf(101), admiral);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      mode: 'on', account_id: accountOf(101), applied: true, error: null, actions: [{ kind: 'create', username: 'alice', access_level: 30 }, { kind: 'set_avatar' }, { kind: 'set_emails' }],
    });
    expect(userNamed(gitlab, 'alice')).toBeDefined();
    // gitlab.sync 这个名字和权限节点 gitlab.sync 撞了：member 那次 403 被 http-policy.ts 的全局钩子按
    // node 记成了同名的一条 outcome=denied 记录，和真正同步完成的这条区分不开，按 outcome 过滤。
    const audit = activityRows(app, { action: 'gitlab.sync' }).find(row => row.outcome === 'ok')!;
    expect(audit.account_id).toBe(accountOf(1));
    expect((await sync(app, '01ARZ3NDEKTSV4RRFFQ69G5FAV', admiral)).statusCode).toBe(404);
    expect((await sync(app, accountOf(101), { ...admiral, origin: 'https://evil.test' })).statusCode).toBe(403);
  });

  it('refuses a manual sync while sync is off', async () => {
    const { app, admiral, accountOf } = await consoleSetup({});
    const res = await sync(app, accountOf(101), admiral);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('gitlab_sync_off');
  });
});

describe('GitLab console overview, projects and settings (#274)', () => {
  async function consoleSetup(env: Record<string, string> = SYNC_ENV) {
    const context = await setup(env);
    const admiralSid = signIn(context.app, 'admiral', 1);
    context.promote(1);
    const memberSid = signIn(context.app, 'alice', 101);
    context.app.services.identity.setSiteRole({ accountId: context.accountOf(101), role: 'member', actor: 'system' });
    const as = (sid: string) => ({ cookie: `sid=${sid}`, origin: 'https://example.test' });
    return { ...context, admiral: as(admiralSid), member: as(memberSid) };
  }

  it('reports health, version, the last reconcile summary and recent failures only to role managers', async () => {
    const { app, admiral, member, gitlab } = await consoleSetup();
    expect((await app.inject({ url: '/api/console/gitlab/status' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/console/gitlab/status', headers: member })).statusCode).toBe(403);
    const first = await app.inject({ url: '/api/console/gitlab/status', headers: admiral });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ mode: 'on', url: GITLAB, group: 'geek', token_configured: true, version: '17.5.0', healthy: true, last_run: null, errors_24h: 0 });

    gitlab.fail('POST /users', 500);
    const summary = await app.services.gitlab.reconcile();
    expect(summary.failed).toBe(1);
    const after = await app.inject({ url: '/api/console/gitlab/status', headers: admiral });
    expect(after.json()).toMatchObject({ last_run: { changed: summary.changed, failed: 1 }, errors_24h: 1 });
    expect(after.json().last_run.at).toEqual(expect.any(Number));

    // GitLab 连不上：健康检查本身也失败，不让 /version 的异常冒出到控制台接口
    gitlab.setUnreachable(true);
    expect((await app.inject({ url: '/api/console/gitlab/status', headers: admiral })).json()).toMatchObject({ healthy: false, version: null });
  });

  it('lists the group, its subgroups and every project (including private ones) for role managers, cached for 5 minutes', async () => {
    const { app, admiral, gitlab } = await consoleSetup();
    gitlab.setProjects([
      { id: 20, path_with_namespace: 'geek/secret', name: 'secret', description: null, visibility: 'private', web_url: `${GITLAB}/geek/secret`, http_url_to_repo: `${GITLAB}/geek/secret.git`, ssh_url_to_repo: 'git@git.example.test:geek/secret.git', last_activity_at: '2026-10-21T00:00:00.000Z', star_count: 0 },
    ]);
    const res = await app.inject({ url: '/api/console/gitlab/projects', headers: admiral });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      groups: [{ id: 1, full_path: 'geek', name: '极客班', visibility: 'private' }],
      projects: [{ id: 20, path_with_namespace: 'geek/secret', name: 'secret', description: null, visibility: 'private', web_url: `${GITLAB}/geek/secret`, http_url_to_repo: `${GITLAB}/geek/secret.git`, ssh_url_to_repo: 'git@git.example.test:geek/secret.git', last_activity_at: '2026-10-21T00:00:00.000Z', star_count: 0 }],
    });
    const calls = gitlab.calls.length;
    gitlab.setProjects([]); // 改了也读不到：5 分钟内还是缓存
    expect((await app.inject({ url: '/api/console/gitlab/projects', headers: admiral })).json().projects).toHaveLength(1);
    expect(gitlab.calls).toHaveLength(calls);
  });

  it('reads and writes sync settings, validating bounds and refusing to flip to on without a token', async () => {
    const { app, admiral, member } = await consoleSetup();
    expect((await app.inject({ url: '/api/console/gitlab/settings', headers: admiral })).json()).toEqual({
      sync_mode: 'on', group_path: 'geek', interval_minutes: 10, token_configured: true,
    });
    expect((await app.inject({ method: 'PATCH', url: '/api/console/gitlab/settings', headers: member, payload: { sync_mode: 'off' } })).statusCode).toBe(403);

    const bad = await app.inject({ method: 'PATCH', url: '/api/console/gitlab/settings', headers: admiral, payload: { group_path: 'bad group!' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_group_path');
    expect((await app.inject({ method: 'PATCH', url: '/api/console/gitlab/settings', headers: admiral, payload: { interval_minutes: 2 } })).json().error).toBe('validation_error');

    const patched = await app.inject({ method: 'PATCH', url: '/api/console/gitlab/settings', headers: admiral, payload: { sync_mode: 'dry-run', group_path: 'yzgc-geek', interval_minutes: 30 } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual({ sync_mode: 'dry-run', group_path: 'yzgc-geek', interval_minutes: 30, token_configured: true });
    // 改过的设置持久化在 app_state，不止是进程内存里
    const row = app.services.storage.db.prepare("SELECT value FROM app_state WHERE key = 'gitlab_settings'").get() as { value: string };
    expect(JSON.parse(row.value)).toEqual({ mode: 'dry-run', group: 'yzgc-geek', interval_minutes: 30 });
    expect((await app.inject({ url: '/api/console/gitlab/settings', headers: admiral })).json().sync_mode).toBe('dry-run');
  });

  it('refuses turning sync on without a configured token, and keeps the URL requirement for dry-run', async () => {
    const { app, admiral } = await consoleSetup({ GITLAB_URL: GITLAB }); // 没有 GITLAB_API_TOKEN：on 需要令牌
    const noToken = await app.inject({ method: 'PATCH', url: '/api/console/gitlab/settings', headers: admiral, payload: { sync_mode: 'on' } });
    expect(noToken.statusCode).toBe(409);
    expect(noToken.json().error).toBe('gitlab_token_missing');
    expect((await app.inject({ url: '/api/console/gitlab/settings', headers: admiral })).json().sync_mode).toBe('off');

    const { app: app2, admiral: admiral2 } = await consoleSetup({}); // 完全没配 GITLAB_URL：dry-run 需要 URL
    const noUrl = await app2.inject({ method: 'PATCH', url: '/api/console/gitlab/settings', headers: admiral2, payload: { sync_mode: 'dry-run' } });
    expect(noUrl.statusCode).toBe(409);
    expect(noUrl.json().error).toBe('gitlab_url_missing');
  });

  it('re-arms the reconcile timer on the new interval once a running sync is told to change settings', async () => {
    const { app, admiral } = await consoleSetup();
    await app.services.gitlab.start({ info() {}, error() {} });
    const patched = await app.inject({ method: 'PATCH', url: '/api/console/gitlab/settings', headers: admiral, payload: { interval_minutes: 15 } });
    expect(patched.json().interval_minutes).toBe(15);
    await app.services.gitlab.stop();
  });

  it('serves only public projects anonymously, straight from the same list the console sees', async () => {
    const { app, gitlab } = await consoleSetup();
    gitlab.setProjects([
      { id: 10, path_with_namespace: 'geek/admin', name: 'admin', description: '极客班官网与后端', visibility: 'private', web_url: `${GITLAB}/geek/admin`, http_url_to_repo: `${GITLAB}/geek/admin.git`, ssh_url_to_repo: 'x', last_activity_at: '2026-10-20T00:00:00.000Z', star_count: 3 },
      { id: 11, path_with_namespace: 'geek/site', name: 'site', description: '开源站点', visibility: 'public', web_url: `${GITLAB}/geek/site`, http_url_to_repo: `${GITLAB}/geek/site.git`, ssh_url_to_repo: 'y', last_activity_at: '2026-10-18T00:00:00.000Z', star_count: 1 },
    ]);
    const res = await app.inject('/api/public/gitlab/projects');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ projects: [{ name: 'site', path_with_namespace: 'geek/site', description: '开源站点', web_url: `${GITLAB}/geek/site`, http_url_to_repo: `${GITLAB}/geek/site.git`, last_activity_at: '2026-10-18T00:00:00.000Z' }] });
  });

  it('lets ordinary active members read private group projects without granting console access', async () => {
    const { app, member } = await consoleSetup();
    const result = await app.inject({ url: '/api/me/gitlab/projects', headers: member });
    expect(result.statusCode).toBe(200);
    expect(result.headers['cache-control']).toMatch(/(?:^|,)\s*no-store\s*(?:,|$)/);
    expect(result.json().projects.map((project: { path_with_namespace: string }) => project.path_with_namespace)).toEqual(['geek/admin', 'geek/site']);
    expect((await app.inject({ url: '/api/console/gitlab/projects', headers: member })).statusCode).toBe(403);
    // 即使带成员 cookie，公开端点也不能混入私有项目。
    const publicResult = await app.inject({ url: '/api/public/gitlab/projects', headers: member });
    expect(publicResult.json().projects.map((project: { path_with_namespace: string }) => project.path_with_namespace)).toEqual(['geek/site']);
  });

  it('rejects guests, registered accounts, expired members and disabled sessions before querying private projects', async () => {
    const { app, gitlab, accountOf } = await setup();
    expect((await app.inject('/api/me/gitlab/projects')).statusCode).toBe(401);
    const registered = rawSignIn(app, 'registered', 707);
    expect((await app.inject({ url: '/api/me/gitlab/projects', headers: { cookie: `sid=${registered}` } })).statusCode).toBe(403);
    const expired = signIn(app, 'expired', 708);
    app.services.storage.db.prepare("UPDATE perm_members SET expires_at = ? WHERE account_id = ? AND group_id = 'level.member'").run(Date.now() - 1, accountOf(708));
    app.services.permissions.bump();
    expect((await app.inject({ url: '/api/me/gitlab/projects', headers: { cookie: `sid=${expired}` } })).statusCode).toBe(403);
    const disabled = signIn(app, 'disabled', 709);
    app.services.storage.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(accountOf(709));
    expect((await app.inject({ url: '/api/me/gitlab/projects', headers: { cookie: `sid=${disabled}` } })).statusCode).toBe(401);
    expect(gitlab.calls).toEqual([]);
  });

  it('allows active alumni and rechecks eligibility even when the private list is cached', async () => {
    const { app, member, accountOf } = await consoleSetup();
    const accountId = accountOf(101);
    app.services.storage.db.prepare("UPDATE perm_members SET group_id = 'level.alumni' WHERE account_id = ? AND group_id = 'level.member'").run(accountId);
    app.services.permissions.bump();
    expect((await app.inject({ url: '/api/me/gitlab/projects', headers: member })).json().projects[0].path_with_namespace).toBe('geek/admin');
    app.services.identity.setSiteRole({ accountId, role: 'none', actor: 'system' });
    const denied = await app.inject({ url: '/api/me/gitlab/projects', headers: member });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).not.toHaveProperty('projects');
  });

  it('does not send a late private list after membership is revoked during the GitLab request', async () => {
    const { app, member, gitlab, accountOf } = await consoleSetup();
    const held = gitlab.hold('GET /groups/geek');
    const request = Promise.resolve(app.inject({ url: '/api/me/gitlab/projects', headers: member }));
    await held.hit;
    app.services.identity.setSiteRole({ accountId: accountOf(101), role: 'none', actor: 'system' });
    held.release();
    const result = await request;
    expect(result.statusCode).toBe(403);
    expect(result.json()).not.toHaveProperty('projects');
  });

  it('tells the public endpoint apart from "really has zero public projects" when GitLab cannot be reached', async () => {
    const { app, gitlab } = await consoleSetup();
    gitlab.setUnreachable(true);
    expect((await app.inject('/api/public/gitlab/projects')).json()).toEqual({ projects: [], unavailable: true });
  });

  it('does not turn a GitLab projects HTTP failure into a genuine empty member list', async () => {
    const { app, gitlab, member } = await consoleSetup();
    gitlab.fail('GET /groups/geek/projects', 503);
    const result = await app.inject({ url: '/api/me/gitlab/projects', headers: member });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ projects: [], unavailable: true });
  });

  it('reports unavailable without calling out when GitLab sync is not configured at all', async () => {
    const { app } = await setup({});
    expect((await app.inject('/api/public/gitlab/projects')).json()).toEqual({ projects: [], unavailable: true });
  });

  it('opens only the current environment group and preserves its GitLab base path', async () => {
    const { app, gitlab } = await setup({ ...SYNC_ENV, GITLAB_URL: `${GITLAB}/gitlab/`, GITLAB_OIDC_CLIENT: 'gitlab_preview' });
    expect((await app.inject('/api/public/gitlab?next=https://untrusted.example')).statusCode).toBe(400);
    const entry = await app.inject('/api/public/gitlab');
    expect(entry.statusCode).toBe(302);
    expect(entry.headers.location).toBe(`${GITLAB}/gitlab/geek`);
    expect(entry.headers['cache-control']).toContain('no-store');
    app.services.oidcStore.registerClient({ name: 'Preview', clientId: 'gitlab_preview', redirectUris: ['https://preview.example.test/gitlab/users/auth/openid_connect/callback'] });
    signIn(app, 'preview-member', 801);
    const accountId = app.services.identity.accountForGithub(801)!;
    await app.services.gitlab.reconcile();
    const user = gitlab.users.find(user => user.username === 'preview-member');
    expect(user?.extern_uid).toBe(app.services.oidcStore.existingSubject('preview.example.test', accountId));
    expect(user?.extern_uid).toBeTruthy();
    expect(app.services.oidcStore.existingSubject('git.example.test', accountId)).toBeNull();
    expect((await app.inject('/api/public/gitlab/projects')).json().unavailable).not.toBe(true);
    const disabled = await setup({});
    expect((await disabled.app.inject('/api/public/gitlab')).statusCode).toBe(503);
  });
});

describe('GitLab and OIDC configuration (#270)', () => {
  const env = () => ({
    NODE_ENV: 'test', PUBLIC_ORIGIN: 'https://example.test', STATIC_CDN_ORIGIN: CDN_ORIGIN, DB_PATH: ':memory:', FORUM_DB_PATH: ':memory:',
    SESSION_SECRET: 'configuration-test-secret-at-least-32', ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64'),
    OAUTH_CLIENT_ID: 'test-client', OAUTH_CLIENT_SECRET: 'test-secret',
  });

  it('keeps sync off by default and asks for the URL and token when it is on', () => {
    expect(createConfig(env()).gitlab.mode).toBe('off');
    expect(createConfig({ ...env(), ...SYNC_ENV, GITLAB_URL: `${GITLAB}/` }).gitlab.url).toBe(GITLAB);
    expect(() => createConfig({ ...env(), GITLAB_SYNC: 'yes' })).toThrow('off, dry-run or on');
    // dry-run 只算出要做什么，不调 GitLab，不要令牌；on 才要
    expect(createConfig({ ...env(), GITLAB_SYNC: 'dry-run', GITLAB_URL: GITLAB }).gitlab.mode).toBe('dry-run');
    expect(() => createConfig({ ...env(), GITLAB_SYNC: 'dry-run' })).toThrow('GITLAB_SYNC needs GITLAB_URL');
    expect(() => createConfig({ ...env(), GITLAB_SYNC: 'on', GITLAB_URL: GITLAB })).toThrow('GITLAB_SYNC=on needs GITLAB_API_TOKEN');
    for (const url of ['file:///gitlab', `https://user:secret@git.example.test/gitlab`, `${GITLAB}/gitlab?token=x`, `${GITLAB}/gitlab#anchor`]) {
      expect(() => createConfig({ ...env(), ...SYNC_ENV, GITLAB_URL: url })).toThrow();
    }
    expect(() => createConfig({ ...env(), ...SYNC_ENV, GITLAB_GROUP: 'geek group' })).toThrow('group path');
    // GitLab 项目事件的间隔（#370）：空是 10 分钟，0 是关闭，1 到 1440 是间隔；不看 GITLAB_SYNC
    expect(createConfig({ ...env(), ...SYNC_ENV }).gitlab.eventsIntervalMinutes).toBe(10);
    expect(createConfig({ ...env(), ...SYNC_ENV, GITLAB_EVENTS_INTERVAL_MINUTES: '0' }).gitlab.eventsIntervalMinutes).toBe(0);
    expect(createConfig({ ...env(), GITLAB_URL: GITLAB, GITLAB_EVENTS_INTERVAL_MINUTES: '30' }).gitlab.eventsIntervalMinutes).toBe(30);
    expect(createConfig({ ...env(), ...SYNC_ENV, GITLAB_EVENTS_INTERVAL_MINUTES: '1440' }).gitlab.eventsIntervalMinutes).toBe(1440);
    for (const minutes of ['-1', '01', '1441', '1.5', 'ten']) {
      expect(() => createConfig({ ...env(), ...SYNC_ENV, GITLAB_EVENTS_INTERVAL_MINUTES: minutes })).toThrow('GITLAB_EVENTS_INTERVAL_MINUTES');
    }
    expect(createConfig({ ...env(), ...SYNC_ENV }).gitlab.sector).toBeNull();
    expect(createConfig({ ...env(), ...SYNC_ENV, GITLAB_OIDC_SECTOR: 'Git.Example.Test' }).gitlab.sector).toBe('git.example.test');
    expect(createConfig({ ...env(), ...SYNC_ENV, GITLAB_OIDC_SECTOR: '127.0.0.1:8930' }).gitlab.sector).toBe('127.0.0.1:8930');
    for (const sector of ['https://git.example.test', 'git.example.test/gitlab', '-bad.example.test']) {
      expect(() => createConfig({ ...env(), ...SYNC_ENV, GITLAB_OIDC_SECTOR: sector })).toThrow('GITLAB_OIDC_SECTOR');
    }
  });

  it('accepts a private RSA JWK Set as JSON or base64 and nothing else', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const privateSet = JSON.stringify({ keys: [{ ...rsa.privateKey.export({ format: 'jwk' }), kid: 'k1' }] });
    expect(createConfig(env()).oidc).toBeNull();
    expect(createConfig({ ...env(), OIDC_JWKS: privateSet }).oidc!.issuer).toBe('https://example.test/oidc');
    expect(createConfig({ ...env(), OIDC_JWKS: Buffer.from(privateSet).toString('base64') }).oidc!.jwks.keys).toHaveLength(1);
    expect(() => createConfig({ ...env(), OIDC_JWKS: JSON.stringify({ keys: [rsa.publicKey.export({ format: 'jwk' })] }) })).toThrow('private keys');
    expect(() => createConfig({ ...env(), OIDC_JWKS: JSON.stringify({ keys: [ec.privateKey.export({ format: 'jwk' })] }) })).toThrow('RSA key');
    expect(() => createConfig({ ...env(), OIDC_JWKS: 'not json' })).toThrow('JWK Set');
  });

  it('turns logins into GitLab usernames', () => {
    expect(gitlabUsername('alice')).toBe('alice');
    expect(gitlabUsername('yz_小明')).toBe('yz___');
    expect(gitlabUsername('-dash.start')).toBe('dash.start');
    expect(gitlabUsername('trailing.')).toBe('trailing');
    expect(gitlabUsername('repo.atom')).toBe('repo_atom');
    expect(gitlabUsername('...')).toBe('member');
    expect(gitlabUsername('x'.repeat(80))).toHaveLength(60);
  });
});
