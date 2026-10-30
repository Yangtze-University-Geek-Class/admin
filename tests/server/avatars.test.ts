import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { REPO_ROOT } from '../../app/server/src/config';
import { GITHUB_AVATAR_RECHECK_MS, githubAvatarUrl, isGithubIdenticon } from '../../app/server/src/lib/github-avatars';
import { loadNanoAvatars, NANO_AVATAR_VERSION, nanoAvatarIndex, nanoAvatarPath } from '../../app/server/src/lib/nano-avatar';
import { processAvatar } from '../../app/server/src/lib/forum-avatar';
import { avatarHtml } from '../../app/web/sites/contests/oss-2026-1/src/util';
import { accountIdOf, grantPermGroup, signIn, testApp } from './helpers';

const sharp = createRequire(join(REPO_ROOT, 'app/server/package.json'))('sharp') as typeof import('../../app/server/node_modules/sharp');

/**
 * 统一头像（#343）：上传的头像 → GitHub 头像（GitHub 自动生成的像素图不算）→ NANO 默认头像，
 * 每个接口给同一个人的是同一个地址；像素图的识别只在后台做，网站请求里不下载 GitHub 图片。
 */
const NANO_DIR = join(REPO_ROOT, 'deploy/gitlab/ui/nano-avatars', NANO_AVATAR_VERSION);
const NANO_URL = new RegExp(`^/api/identity/default-avatar/${NANO_AVATAR_VERSION}/[1-8]\\.png$`);

/** GitHub 给没设头像的人生成的那种图：420×420，#F0F0F0 底，留边 35 像素，5×5 格左右对称，一种前景色。 */
async function identicon(color: [number, number, number] = [0x5b, 0x9b, 0xd5]): Promise<Buffer> {
  const size = 420, cell = 70, pad = 35;
  const pixels = Buffer.alloc(size * size * 3, 0xf0);
  const half = [[1, 0, 1], [0, 1, 1], [1, 1, 0], [0, 0, 1], [1, 0, 0]];
  for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
    if (!half[row]![col < 3 ? col : 4 - col]) continue;
    for (let y = pad + row * cell; y < pad + (row + 1) * cell; y++) for (let x = pad + col * cell; x < pad + (col + 1) * cell; x++) {
      pixels.set(color, (y * size + x) * 3);
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

/** 真头像的替身：420×420 的渐变照片（JPEG），中间一块人像，四周是接近 #F0F0F0 的浅色背景。 */
async function photo(): Promise<Buffer> {
  const size = 420;
  const pixels = Buffer.alloc(size * size * 3, 0xf0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x - 210) ** 2 + (y - 230) ** 2 > 150 ** 2) continue;
    pixels.set([(x * 255 / size) | 0, (y * 255 / size) | 0, ((x + y) * 127 / size) | 0], (y * size + x) * 3);
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

/** 假 GitHub 头像服务：按地址回图，没登记的地址算连不上；记下每次请求。 */
function fakeAvatars() {
  const images = new Map<string, Buffer>();
  const calls: string[] = [];
  async function fetch(input: string, init: RequestInit = {}): Promise<Response> {
    calls.push(input);
    expect(init.redirect).toBe('error');
    const image = images.get(input);
    if (!image) throw new TypeError('fetch failed');
    return new Response(new Uint8Array(image), { status: 200, headers: { 'content-type': image[0] === 0xff ? 'image/jpeg' : 'image/png' } });
  }
  return { images, calls, fetch };
}

const contexts: Awaited<ReturnType<typeof testApp>>[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  let now = Date.now();
  const github = fakeAvatars();
  const context = await testApp({ githubProfileFetch: github.fetch, clock: () => now });
  contexts.push(context);
  const { app } = context;
  // GitLab 在签发者那里登记的客户端：没有主邮箱的人按 `<GitLab 用户名>@noreply.<回调主机>` 挑默认头像
  app.services.oidcStore.registerClient({ name: 'GitLab', clientId: 'gitlab', redirectUris: ['https://git.example.test/users/auth/openid_connect/callback'] });
  const get = (url: string, sid?: string) => app.inject({ url, headers: sid ? { cookie: `sid=${sid}` } : {} });
  return { app, github, get, advance: (ms: number) => { now += ms; } };
}

describe('NANO 默认头像', () => {
  it('挑图规则和 GitLab 前置一样：标识去空白转小写取 SHA-256，第一位十六进制模 8', () => {
    // GitLab 搬到 /gitlab 之后（#335），前置的映射由 deploy/remote/edge-gitlab.py 生成：拿它真正生成的 Caddy 片段核对
    const edge = join(REPO_ROOT, 'deploy/remote/edge-gitlab.py');
    const render = `import importlib.util, sys\nspec = importlib.util.spec_from_file_location('edge', sys.argv[1])\nedge = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(edge)\nprint(edge.production_handler({'production_origin': 'https://example.test', 'upstream': '127.0.0.1:1'}))`;
    const rendered = spawnSync('python3', ['-I', '-c', render, edge], { encoding: 'utf8', timeout: 20_000 });
    expect(rendered.status, rendered.stderr).toBe(0);
    expect(rendered.stdout).toContain(`^/gitlab/nano-avatar/${NANO_AVATAR_VERSION}/([0-9a-f])[0-9a-f]{63}$`);
    const map = new Map([...rendered.stdout.matchAll(/^\s+([0-9a-f]) avatar-0([1-8])\.png$/gm)].map(match => [match[1]!, Number(match[2])]));
    expect(map.size).toBe(16);
    for (const identifier of ['Alice@Example.test', '  bob@noreply.git.example.test ', 'carol', 'yz_0a1b2c3d']) {
      const digest = createHash('sha256').update(identifier.trim().toLowerCase()).digest('hex');
      expect(nanoAvatarIndex(identifier)).toBe(map.get(digest[0]!));
    }
    expect(nanoAvatarIndex('Alice@Example.test')).toBe(nanoAvatarIndex('alice@example.test'));
    expect(nanoAvatarPath(3)).toBe(`/api/identity/default-avatar/${NANO_AVATAR_VERSION}/3.png`);
  });

  it('按清单核对 8 张图的字节，缺图或对不上就不让启动', () => {
    const avatars = loadNanoAvatars(NANO_DIR);
    expect(avatars(1)).toEqual(readFileSync(join(NANO_DIR, 'avatar-01.png')));
    expect(avatars(8)).toEqual(readFileSync(join(NANO_DIR, 'avatar-08.png')));
    expect([0, 9, 1.5].map(avatars)).toEqual([null, null, null]);

    const dir = mkdtempSync(join(tmpdir(), 'nano-avatars-'));
    dirs.push(dir);
    cpSync(NANO_DIR, dir, { recursive: true });
    const tampered = readFileSync(join(dir, 'avatar-05.png'));
    tampered[tampered.length - 1] ^= 0xff;
    writeFileSync(join(dir, 'avatar-05.png'), tampered);
    expect(() => loadNanoAvatars(dir)).toThrow(/avatar-05\.png does not match/);
    rmSync(join(dir, 'avatar-05.png'));
    expect(() => loadNanoAvatars(dir)).toThrow();
  });

  it('同源地址下发镜像里的图：PNG、长期缓存、nosniff，版本或编号不对 404', async () => {
    const { get } = await setup();
    const res = await get(`/api/identity/default-avatar/${NANO_AVATAR_VERSION}/3.png`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    expect(res.rawPayload).toEqual(readFileSync(join(NANO_DIR, 'avatar-03.png')));

    const wrongVersion = await get('/api/identity/default-avatar/20250101/3.png');
    expect(wrongVersion.statusCode).toBe(404);
    expect(wrongVersion.headers['cache-control']).toBe('no-store');
    expect((await get(`/api/identity/default-avatar/${NANO_AVATAR_VERSION}/9.png`)).statusCode).toBe(400);
    expect((await get(`/api/identity/default-avatar/${NANO_AVATAR_VERSION}/avatar-03.png`)).statusCode).toBe(400);
  });
});

describe('GitHub 像素图识别', () => {
  it('420×420、两种颜色占 97% 以上且有 #F0F0F0 才算；照片、别的尺寸、别的底色、解不开的都不算', async () => {
    expect(await isGithubIdenticon(await identicon())).toBe(true);
    expect(await isGithubIdenticon(await identicon([0xd5, 0x5b, 0x8a]))).toBe(true);
    expect(await isGithubIdenticon(await photo())).toBe(false);
    expect(await isGithubIdenticon(await sharp(await identicon()).resize(460, 460, { kernel: 'nearest' }).png().toBuffer())).toBe(false);
    const darkBackground = await sharp(await identicon()).negate().png().toBuffer();
    expect(await isGithubIdenticon(darkBackground)).toBe(false);
    expect(await isGithubIdenticon(Buffer.from('not an image'))).toBe(false);
  });

  it('GitHub 头像地址：登录时记下的 GitHub 域名地址照用，别的或没有时按数字 id 拼', () => {
    expect(githubAvatarUrl({ id: 7, avatar_url: 'https://avatars.githubusercontent.com/u/7?v=4' })).toBe('https://avatars.githubusercontent.com/u/7?v=4');
    expect(githubAvatarUrl({ id: 7, avatar_url: 'https://evil.example.test/a.png' })).toBe('https://avatars.githubusercontent.com/u/7');
    expect(githubAvatarUrl({ id: 7, avatar_url: null })).toBe('https://avatars.githubusercontent.com/u/7');
  });
});

describe('统一头像的取法', () => {
  it('上传的头像优先；GitHub 头像没结论时照常显示、真头像换成站内副本、像素图换 NANO；没有 GitHub 的按主邮箱挑 NANO', async () => {
    const { app, github, get } = await setup();
    const realUrl = 'https://avatars.githubusercontent.com/u/501?v=4';
    const identiconUrl = 'https://avatars.githubusercontent.com/u/502?v=4';
    signIn(app, 'real-person', 501, realUrl);
    signIn(app, 'pixel-person', 502, identiconUrl);
    const uploaderSid = signIn(app, 'uploader', 503, 'https://avatars.githubusercontent.com/u/503?v=4');
    const real = accountIdOf(app, 'real-person');
    const pixel = accountIdOf(app, 'pixel-person');
    const uploader = accountIdOf(app, 'uploader');
    const emailOnly = app.services.identity.signInWithEmailCode({ email: 'Mail.Only@Example.test', claim: () => true });
    if (!emailOnly.ok) throw new Error('email sign-in refused');

    // 还没识别：照常显示 GitHub 地址，网站请求不下载图片
    expect(app.services.avatars.ofAccount(real)).toMatchObject({ kind: 'github', url: realUrl, checked: false });
    expect(app.services.avatars.urlOf(pixel)).toBe(identiconUrl);
    expect(github.calls).toEqual([]);

    // 上传的头像排第一
    const upload = await get('/api/identity/profile', uploaderSid);
    expect(upload.statusCode).toBe(200);
    expect((await app.inject({
      method: 'PUT', url: '/api/identity/avatar', payload: await photo(),
      headers: { cookie: `sid=${uploaderSid}`, 'content-type': 'image/jpeg', origin: 'https://example.test' },
    })).statusCode).toBe(200);
    expect(app.services.avatars.ofAccount(uploader)).toMatchObject({ kind: 'upload', url: expect.stringMatching(/^\/api\/identity\/avatar\/[0-9a-f]{64}\.webp$/) });

    // 没有 GitHub 的人：NANO，按主邮箱（GitLab 用的同一个地址）挑
    const mailAvatar = app.services.avatars.ofAccount(emailOnly.accountId);
    expect(mailAvatar).toEqual({ kind: 'nano', url: nanoAvatarPath(nanoAvatarIndex('mail.only@example.test')), index: nanoAvatarIndex('mail.only@example.test') });

    // 后台识别一轮：真头像存副本，像素图记下结论；上传了头像的人用不到 GitHub 头像，不下载
    github.images.set(realUrl, await photo());
    github.images.set(identiconUrl, await identicon());
    expect(app.services.githubAvatars.pending()).toEqual([realUrl, identiconUrl]);
    expect(await app.services.githubAvatars.runOnce()).toEqual({ checked: 2, identicons: 1, failed: 0 });
    const checked = app.services.avatars.ofAccount(real);
    expect(checked).toMatchObject({ kind: 'github', source: realUrl, checked: true, url: expect.stringMatching(/^\/api\/identity\/avatar\/[0-9a-f]{64}\.webp$/) });
    const copy = await get(checked.url);
    expect(copy.statusCode).toBe(200);
    expect(copy.headers['content-type']).toBe('image/webp');
    expect((await sharp(copy.rawPayload).metadata())).toMatchObject({ width: 512, height: 512 });

    // 像素图：NANO，没有主邮箱时按 GitLab 建号会用的占位地址挑
    const placeholder = 'pixel-person@noreply.git.example.test';
    expect(app.services.avatars.ofAccount(pixel)).toEqual({ kind: 'nano', url: nanoAvatarPath(nanoAvatarIndex(placeholder)), index: nanoAvatarIndex(placeholder) });
    // 已经有结论的不再下载；连不上的跳过，下一轮再查
    const calls = github.calls.length;
    expect(await app.services.githubAvatars.runOnce()).toEqual({ checked: 0, identicons: 0, failed: 0 });
    expect(github.calls.slice(calls)).toEqual([]);
    signIn(app, 'offline-person', 504, 'https://avatars.githubusercontent.com/u/504?v=4');
    expect(await app.services.githubAvatars.runOnce()).toEqual({ checked: 0, identicons: 0, failed: 1 });
    expect(app.services.avatars.ofAccount(accountIdOf(app, 'offline-person'))).toMatchObject({ kind: 'github', url: 'https://avatars.githubusercontent.com/u/504?v=4', checked: false });
  });

  it('结论 7 天后重看：GitHub 上换了头像就换副本、旧副本没人用就删；换成像素图就改用 NANO', async () => {
    const { app, github, advance } = await setup();
    const url = 'https://avatars.githubusercontent.com/u/601?v=4';
    signIn(app, 'changer', 601, url);
    const id = accountIdOf(app, 'changer');
    github.images.set(url, await photo());
    await app.services.githubAvatars.runOnce();
    const first = app.services.avatars.ofAccount(id);
    expect(first).toMatchObject({ kind: 'github', hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const firstHash = (first as { hash: string }).hash;

    github.images.set(url, await sharp(await photo()).flop().jpeg().toBuffer());
    advance(GITHUB_AVATAR_RECHECK_MS - 1000);
    expect(app.services.githubAvatars.pending()).toEqual([]);
    advance(2000);
    expect(app.services.githubAvatars.pending()).toEqual([url]);
    await app.services.githubAvatars.runOnce();
    const second = app.services.avatars.ofAccount(id) as { hash: string };
    expect(second.hash).not.toBe(firstHash);
    expect(app.services.profiles.avatar(firstHash)).toBeNull();

    github.images.set(url, await identicon());
    advance(GITHUB_AVATAR_RECHECK_MS + 1000);
    await app.services.githubAvatars.runOnce();
    expect(app.services.avatars.ofAccount(id)).toMatchObject({ kind: 'nano' });
    expect(app.services.profiles.avatar(second.hash)).toBeNull();
  });

  it('转不出副本时照常显示 GitHub 地址，到期重看再补副本；重看下载失败时保留原来的副本', async () => {
    const { app, github, advance } = await setup();
    const url = 'https://avatars.githubusercontent.com/u/651?v=4';
    signIn(app, 'broken-image', 651, url);
    const id = accountIdOf(app, 'broken-image');
    // 声称是 PNG、实际解不开：不是像素图，结论是真头像，但 512 WebP 副本转不出来
    github.images.set(url, Buffer.from('not an image'));
    expect(await app.services.githubAvatars.runOnce()).toEqual({ checked: 1, identicons: 0, failed: 0 });
    expect(app.services.avatars.ofAccount(id)).toEqual({ kind: 'github', url, source: url, hash: null, checked: true });
    expect(app.services.storage.db.prepare('SELECT verdict, avatar_hash FROM github_avatar_checks WHERE url = ?').get(url)).toEqual({ verdict: 'real', avatar_hash: null });

    github.images.set(url, await photo());
    advance(GITHUB_AVATAR_RECHECK_MS + 1000);
    await app.services.githubAvatars.runOnce();
    const copied = app.services.avatars.ofAccount(id) as { url: string; hash: string };
    expect(copied).toMatchObject({ kind: 'github', checked: true, url: `/api/identity/avatar/${copied.hash}.webp` });

    github.images.delete(url);
    advance(GITHUB_AVATAR_RECHECK_MS + 1000);
    expect(await app.services.githubAvatars.runOnce()).toEqual({ checked: 0, identicons: 0, failed: 1 });
    expect(app.services.avatars.ofAccount(id)).toEqual(copied);
    expect(app.services.profiles.avatar(copied.hash)).not.toBeNull();
  });

  it('比赛官网的头像小工具（sandbox，只认同源地址）：站内副本、上传的、NANO 都显示成图片；还没识别的 GitHub 地址退回首字母', async () => {
    const { app, github, get } = await setup();
    const realUrl = 'https://avatars.githubusercontent.com/u/661?v=4';
    signIn(app, 'contest-real', 661, realUrl);
    signIn(app, 'contest-pixel', 662, 'https://avatars.githubusercontent.com/u/662?v=4');
    const uploaderSid = signIn(app, 'contest-upload', 663);
    signIn(app, 'contest-pending', 664, 'https://avatars.githubusercontent.com/u/664?v=4');
    github.images.set(realUrl, await photo());
    github.images.set('https://avatars.githubusercontent.com/u/662?v=4', await identicon());
    await app.services.githubAvatars.runOnce();
    expect((await app.inject({
      method: 'PUT', url: '/api/identity/avatar', payload: await sharp(await photo()).flop().jpeg().toBuffer(),
      headers: { cookie: `sid=${uploaderSid}`, 'content-type': 'image/jpeg', origin: 'https://example.test' },
    })).statusCode).toBe(200);

    const shown = { 'contest-real': 'github', 'contest-pixel': 'nano', 'contest-upload': 'upload' } as const;
    for (const [login, kind] of Object.entries(shown)) {
      const avatar = app.services.avatars.ofAccount(accountIdOf(app, login));
      expect(avatar.kind).toBe(kind);
      expect(avatar.url).toMatch(kind === 'nano' ? NANO_URL : /^\/api\/identity\/avatar\/[0-9a-f]{64}\.webp$/);
      expect(avatarHtml({ username: login, display_name: '', avatar_url: avatar.url })).toContain(`<img src="${avatar.url}"`);
      const image = await get(avatar.url);
      expect(image.statusCode).toBe(200);
      expect(image.headers['content-type']).toMatch(/^image\/(webp|png)$/);
    }
    const pending = app.services.avatars.urlOf(accountIdOf(app, 'contest-pending'));
    expect(pending).toBe('https://avatars.githubusercontent.com/u/664?v=4');
    expect(avatarHtml({ username: 'contest-pending', display_name: '', avatar_url: pending })).not.toContain('<img');
  });

  it('上传的头像和 GitHub 副本是同一张图时，撤销上传不删别人还在用的副本', async () => {
    const { app, github } = await setup();
    const url = 'https://avatars.githubusercontent.com/u/701?v=4';
    signIn(app, 'shared-github', 701, url);
    const sid = signIn(app, 'shared-upload', 702);
    const image = await photo();
    github.images.set(url, image);
    await app.services.githubAvatars.runOnce();
    const copy = app.services.avatars.ofAccount(accountIdOf(app, 'shared-github')) as { hash: string };
    expect((await app.inject({
      method: 'PUT', url: '/api/identity/avatar', payload: image,
      headers: { cookie: `sid=${sid}`, 'content-type': 'image/jpeg', origin: 'https://example.test' },
    })).json()).toEqual({ avatar_url: `/api/identity/avatar/${copy.hash}.webp` });
    app.services.profiles.clearAvatar(accountIdOf(app, 'shared-upload'));
    expect(app.services.profiles.avatar(copy.hash)).not.toBeNull();
  });

  it('还没对上账号的旧论坛成员：论坛上传的、记下的 GitHub 头像（像素图不算）、按用户名挑的 NANO', async () => {
    const { app, github, get } = await setup();
    const db = app.services.storage.db;
    const now = Date.now();
    const insert = db.prepare(`INSERT INTO forum_users(id, kind, github_user_id, username, display_name, avatar_color, github_avatar_url, avatar_hash, role, joined_at, updated_at)
      VALUES (?, 'member', ?, ?, ?, '#336699', ?, ?, 'member', ?, ?)`);
    const forumUpload = await processAvatar(await photo());
    db.prepare('INSERT INTO forum_avatars(hash, data, created_at) VALUES (?, ?, ?)').run(forumUpload.hash, forumUpload.data, now);
    insert.run('m801', 801, 'legacy-upload', '旧成员一', 'https://avatars.githubusercontent.com/u/801?v=4', forumUpload.hash, now, now);
    insert.run('m802', 802, 'legacy-pixel', '旧成员二', 'https://avatars.githubusercontent.com/u/802?v=4', null, now, now);
    insert.run('m803', 803, 'legacy-real', '旧成员三', 'https://avatars.githubusercontent.com/u/803?v=4', null, now, now);
    github.images.set('https://avatars.githubusercontent.com/u/802?v=4', await identicon());
    github.images.set('https://avatars.githubusercontent.com/u/803?v=4', await photo());
    // 论坛上传了头像的旧成员用不到 GitHub 头像，不下载
    expect(app.services.githubAvatars.pending()).toEqual(['https://avatars.githubusercontent.com/u/802?v=4', 'https://avatars.githubusercontent.com/u/803?v=4']);
    await app.services.githubAvatars.runOnce();

    const users = (await get('/api/forum/state')).json().state.users as { id: string; avatarUrl?: string }[];
    const avatarOf = (id: string) => users.find(user => user.id === id)?.avatarUrl;
    expect(avatarOf('m801')).toBe(`/api/forum/avatars/${forumUpload.hash}.webp`);
    expect(avatarOf('m802')).toBe(nanoAvatarPath(nanoAvatarIndex('legacy-pixel')));
    expect(avatarOf('m803')).toMatch(/^\/api\/identity\/avatar\/[0-9a-f]{64}\.webp$/);
    // 官方账号不是人，不换头像（色块）
    expect(users.filter(user => user.id.startsWith('o')).every(user => user.avatarUrl === undefined)).toBe(true);
  });
});

describe('同一个人，每个接口都是同一个头像地址', () => {
  async function urlsFor(app: FastifyInstance, login: string, sid: string, adminSid: string) {
    const id = accountIdOf(app, login);
    const inject = (url: string, as: string) => app.inject({ url, headers: { cookie: `sid=${as}` } });
    expect((await inject('/api/forum/state', sid)).statusCode).toBe(200);
    const forumUsers = (await inject('/api/forum/state', adminSid)).json().state.users as { id: string; avatarUrl?: string }[];
    const forumId = (app.services.storage.db.prepare('SELECT id FROM forum_users WHERE account_id = ?').get(id) as { id: string }).id;
    const users = (await inject('/api/console/users', adminSid)).json().items as { account_id: string; avatar_url: string }[];
    const members = (await inject('/api/console/permission-groups/level.member/members', adminSid)).json().members as { account_id: string; avatar_url: string }[];
    const activity = (await inject(`/api/console/accounts/${id}/activity`, adminSid)).json().items as { account: { avatar_url: string } | null }[];
    const suggest = (await inject(`/api/forum/users/suggest?q=${login}`, adminSid)).json().users as { avatar_url: string }[];
    const picture = app.services.directory.oidcAccount(id)?.picture;
    return {
      '/auth/me': (await inject('/auth/me', sid)).json().avatar_url,
      '/api/console/me': (await inject('/api/console/me', sid)).json().avatar_url,
      '/api/console/users': users.find(item => item.account_id === id)?.avatar_url,
      '/api/console/permission-groups/:id/members': members.find(item => item.account_id === id)?.avatar_url,
      '/api/console/accounts/:id/activity': activity.find(item => item.account)?.account?.avatar_url,
      '/api/forum/state': forumUsers.find(user => user.id === forumId)?.avatarUrl,
      '/api/forum/users/suggest': suggest[0]?.avatar_url,
      'competition person': app.services.competitionSignups.person(id).avatar_url,
      'OIDC picture': picture?.startsWith(app.services.config.publicOrigin) ? picture.slice(app.services.config.publicOrigin.length) : picture,
    };
  }

  it('GitHub 真头像、像素图、上传的头像三种人，九个出口给的都一样', async () => {
    const { app, github } = await setup();
    const adminSid = signIn(app, 'site-owner', 900);
    grantPermGroup(app, accountIdOf(app, 'site-owner'), 'title.site.owner');
    const people = [
      { login: 'avatar-real', githubId: 901, image: await photo() },
      { login: 'avatar-pixel', githubId: 902, image: await identicon() },
      { login: 'avatar-upload', githubId: 903, image: null },
    ];
    const sids = new Map<string, string>();
    for (const person of people) {
      const url = `https://avatars.githubusercontent.com/u/${person.githubId}?v=4`;
      sids.set(person.login, signIn(app, person.login, person.githubId, url));
      grantPermGroup(app, accountIdOf(app, person.login), 'level.member');
      if (person.image) github.images.set(url, person.image);
      // 账号活动里要有这个人的一条记录
      expect((await app.inject({
        method: 'PATCH', url: '/api/identity/profile', payload: { bio: '写点东西' },
        headers: { cookie: `sid=${sids.get(person.login)}`, origin: 'https://example.test' },
      })).statusCode).toBe(200);
    }
    expect((await app.inject({
      method: 'PUT', url: '/api/identity/avatar', payload: await photo(),
      headers: { cookie: `sid=${sids.get('avatar-upload')}`, 'content-type': 'image/jpeg', origin: 'https://example.test' },
    })).statusCode).toBe(200);
    await app.services.githubAvatars.runOnce();

    const expected = {
      'avatar-real': /^\/api\/identity\/avatar\/[0-9a-f]{64}\.webp$/,
      'avatar-pixel': NANO_URL,
      'avatar-upload': /^\/api\/identity\/avatar\/[0-9a-f]{64}\.webp$/,
    };
    for (const person of people) {
      const urls = await urlsFor(app, person.login, sids.get(person.login)!, adminSid);
      const resolved = app.services.avatars.urlOf(accountIdOf(app, person.login));
      expect(resolved).toMatch(expected[person.login as keyof typeof expected]);
      expect(urls).toEqual(Object.fromEntries(Object.keys(urls).map(key => [key, resolved])));
    }
  });
});
