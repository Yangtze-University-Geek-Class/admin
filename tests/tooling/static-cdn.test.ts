import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteCsp } from '../../app/forum/scripts/csp-header.mjs';
import { STATIC_CDN_BASE, STATIC_CDN_BUCKET, STATIC_CDN_ORIGIN, STATIC_CDN_PREFIX } from '../../scripts/static-cdn-base.mjs';
import {
  MAX_FILE_BYTES, UPLOAD_HOST, assertKey, collect, cspAllows, decide, main, mimeFor, originPathOf, parseArgs, qetag,
  readUploadPolicy, signUploadToken, uploadAll, uploadOne, uploadPolicy,
} from '../../scripts/static-cdn.mjs';

// 静态资源 CDN（#146）的上传脚本 scripts/static-cdn.mjs：对象键与前缀守卫、只增不改的上传 token、没有凭据时的同源路径、
// 宿主 CSP 的核对。上传与 CDN 都用假的 fetch，不联网、不用真实凭据。构建开关在 static-cdn-switch.test.ts。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

// 假的 AK/SK，只用来验证签名算法；真实凭据只在所有者本机，不进仓库。
const FAKE_KEYS = { accessKey: 'FAKEACCESSKEYFORTESTS0000000000000000000', secretKey: 'FAKESECRETKEYFORTESTS000000000000000000' };
const NOW = Date.parse('2026-09-26T12:00:00Z');
const DAY = 24 * 3600;
const tokenFor = (policy: Record<string, unknown>) => signUploadToken(policy, FAKE_KEYS);
const validToken = (seconds = 180 * DAY) => tokenFor(uploadPolicy({ now: NOW, seconds }));
const b64 = (buffer: Buffer) => buffer.toString('base64').replaceAll('+', '-').replaceAll('/', '_');

describe('object keys and the prefix guard', () => {
  it('accepts only files under the three build output folders of yzgc/static/site/', () => {
    for (const key of [
      'yzgc/static/site/assets/portal-Br-Bop_b.js',
      'yzgc/static/site/console-assets/index-12345678.css',
      'yzgc/static/site/forum/_nuxt/Bh2i2wUT.js',
      'yzgc/static/site/forum/_nuxt/builds/meta/7bc7befa-4c9a-46aa-ad06-8073788e081b.json',
    ]) expect(assertKey(key)).toBe(key);
  });

  it.each([
    'yzgc/static/site/index.html',
    'yzgc/static/site/forum/index.html',
    'yzgc/static/site/forum/logo.png',
    'yzgc/static/site/assets/',
    'yzgc/static/site/assets//x-12345678.js',
    'yzgc/static/site/assets/./x-12345678.js',
    'yzgc/static/site/assets/../../../promo/x.m3u8',
    'yzgc/static/site/assets/x 12345678.js',
    'yzgc/static/site/assets/x-12345678.js?v=1',
    'yzgc/static/other/assets/x-12345678.js',
    'yzgc/static/assets/x-12345678.js',
    'yzgc/promo/film.m3u8',
    'promo/x.mp4',
    '/yzgc/static/site/assets/x-12345678.js',
    'crosery:yzgc/static/site/assets/x-12345678.js',
    `yzgc/static/site/assets/${'a'.repeat(300)}.js`,
  ])('refuses %s', key => {
    expect(() => assertKey(key)).toThrow(/拒绝写入/);
  });

  it('refuses non-strings', () => {
    for (const key of [undefined, null, 1, ['yzgc/static/site/assets/a-12345678.js']]) expect(() => assertKey(key)).toThrow(/拒绝写入/);
  });

  it('maps every key back to the same path on the origin', () => {
    expect(originPathOf('yzgc/static/site/assets/a-12345678.js')).toBe('/assets/a-12345678.js');
    expect(originPathOf('yzgc/static/site/forum/_nuxt/Bh2i2wUT.js')).toBe('/forum/_nuxt/Bh2i2wUT.js');
  });

  it('knows the content type of every kind of build output, and nothing else', () => {
    expect(mimeFor('a-12345678.js')).toBe('text/javascript');
    expect(mimeFor('a-12345678.css')).toBe('text/css');
    expect(mimeFor('a-12345678.woff2')).toBe('font/woff2');
    expect(mimeFor('logo.aFxUkDTw.png')).toBe('image/png');
    expect(() => mimeFor('a-12345678.html')).toThrow(/不认识的文件类型/);
    expect(() => mimeFor('a-12345678.map')).toThrow(/不认识的文件类型/);
  });
});

describe('collect: which files of a build get uploaded', () => {
  let dir = '';
  const put = (path: string, body = path) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  };
  const roots = () => ({ web: join(dir, 'web'), forum: join(dir, 'forum') });
  const fixture = () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    put('web/index.html');
    put('web/sites/portal/index.html');
    put('web/portal/wallpapers/desk.webp');
    put('web/favicon.svg');
    put('web/assets/portal-Br-Bop_b.js');
    put('web/assets/MapleMono-Regular-CzQ1iDN2.woff2');
    put('web/console-assets/index-12345678.css');
    put('forum/index.html');
    put('forum/logo.png');
    put('forum/_nuxt/Bh2i2wUT.js');
    put('forum/_nuxt/entry.AbCdEfGh.css');
    put('forum/_nuxt/logo.aFxUkDTw.png');
    put('forum/_nuxt/builds/latest.json', '{"id":"x"}');
    put('forum/_nuxt/builds/meta/7bc7befa-4c9a-46aa-ad06-8073788e081b.json', '{}');
  };
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'static-cdn-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('takes only the hashed files of assets/, console-assets/ and forum _nuxt/ (plus the per-build meta), never latest.json', () => {
    fixture();
    const entries = collect(roots());
    expect(entries.map(entry => entry.key)).toEqual([
      'yzgc/static/site/assets/MapleMono-Regular-CzQ1iDN2.woff2',
      'yzgc/static/site/assets/portal-Br-Bop_b.js',
      'yzgc/static/site/console-assets/index-12345678.css',
      'yzgc/static/site/forum/_nuxt/Bh2i2wUT.js',
      'yzgc/static/site/forum/_nuxt/builds/meta/7bc7befa-4c9a-46aa-ad06-8073788e081b.json',
      'yzgc/static/site/forum/_nuxt/entry.AbCdEfGh.css',
      'yzgc/static/site/forum/_nuxt/logo.aFxUkDTw.png',
    ]);
    const js = entries.find(entry => entry.key.endsWith('Bh2i2wUT.js'))!;
    expect(js.file).toBe(join(dir, 'forum/_nuxt/Bh2i2wUT.js'));
    expect(js.mime).toBe('text/javascript');
    expect(js.size).toBe('forum/_nuxt/Bh2i2wUT.js'.length);
  });

  it.each([
    ['an unhashed file', () => put('web/assets/readme.js'), /文件名不带内容哈希/],
    ['a hidden file', () => put('web/console-assets/.DS_Store'), /隐藏文件/],
    ['a build meta file that is not a build id', () => put('forum/_nuxt/builds/meta/latest.json'), /文件名不带内容哈希/],
    ['an unknown file type', () => put('web/assets/page-12345678.html'), /不认识的文件类型/],
    ['a symlink', () => symlinkSync('/etc/hosts', join(dir, 'web/assets/hosts-12345678.js')), /符号链接/],
    ['a file over the size limit', () => { put('web/assets/huge-12345678.js'); truncateSync(join(dir, 'web/assets/huge-12345678.js'), MAX_FILE_BYTES + 1); }, /超过/],
    ['a missing output folder', () => rmSync(join(dir, 'forum/_nuxt'), { recursive: true }), /站点根里没有 _nuxt/],
  ])('fails the whole upload on %s instead of skipping it', (_name, change, error) => {
    fixture();
    change();
    expect(() => collect(roots())).toThrow(error);
  });
});

describe('upload token: prefix-scoped, insert-only, expiring', () => {
  it('signs the Qiniu way (AK:urlsafe_b64(hmac_sha1(SK, policy)):policy) with the narrow policy', () => {
    const policy = uploadPolicy({ now: NOW, seconds: 180 * DAY });
    expect(policy).toEqual({ scope: 'crosery:yzgc/static/site/', isPrefixalScope: 1, insertOnly: 1, deadline: NOW / 1000 + 180 * DAY, fsizeLimit: MAX_FILE_BYTES });
    expect(STATIC_CDN_BUCKET).toBe('crosery');
    const token = tokenFor(policy);
    const [ak, signature, encoded] = token.split(':');
    expect(ak).toBe(FAKE_KEYS.accessKey);
    expect(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))).toEqual(policy);
    expect(signature).toBe(b64(createHmac('sha1', FAKE_KEYS.secretKey).update(encoded).digest()));
    expect(readUploadPolicy(token, NOW)).toEqual(policy);
    expect(() => uploadPolicy({ now: NOW, seconds: 367 * DAY })).toThrow(/有效期/);
    expect(() => signUploadToken(policy, { accessKey: '', secretKey: 'x' })).toThrow(/QINIU_ACCESS_KEY/);
  });

  const base = () => uploadPolicy({ now: NOW, seconds: 180 * DAY }) as Record<string, unknown>;
  it.each([
    ['the whole bucket', { scope: 'crosery' }, /scope/],
    ['a wider prefix', { scope: 'crosery:yzgc/' }, /scope/],
    ['another bucket', { scope: 'other:yzgc/static/site/' }, /scope/],
    ['an exact key instead of a prefix', { isPrefixalScope: 0 }, /isPrefixalScope/],
    ['overwrite allowed', { insertOnly: 0 }, /insertOnly/],
    ['insertOnly missing', { insertOnly: undefined }, /insertOnly/],
    ['expired', { deadline: NOW / 1000 - 1 }, /过期/],
    ['expiring within 10 minutes', { deadline: NOW / 1000 + 300 }, /过期/],
    ['no deadline', { deadline: undefined }, /deadline/],
    ['a callback', { callbackUrl: 'https://example.com/cb' }, /多出字段 callbackUrl/],
    ['persistent processing', { persistentOps: 'avthumb/mp4' }, /多出字段 persistentOps/],
    ['a size limit above the cap', { fsizeLimit: MAX_FILE_BYTES * 2 }, /fsizeLimit/],
  ])('rejects a token with %s, without echoing the token', (_name, change, error) => {
    const policy = { ...base(), ...change };
    for (const [field, value] of Object.entries(change)) if (value === undefined) delete policy[field];
    const token = tokenFor(policy);
    let message = '';
    try { readUploadPolicy(token, NOW); } catch (caught) { message = (caught as Error).message; }
    expect(message).toMatch(error);
    expect(message).not.toContain(token);
    expect(message).not.toContain(FAKE_KEYS.accessKey);
    expect(message).not.toContain(token.split(':')[1]);
  });

  it.each(['', 'abc', 'a:b', 'a:b:c:d', 'a:b:!!!', `a:b:${Buffer.from('not json').toString('base64url')}`, `a:b:${Buffer.from('[1]').toString('base64url')}`])('rejects the malformed token %j', token => {
    expect(() => readUploadPolicy(token, NOW)).toThrow(/STATIC_CDN_UPLOAD_TOKEN/);
  });
});

describe('qetag (the ETag Qiniu and the CDN report)', () => {
  const sha1 = (data: Buffer) => createHash('sha1').update(data).digest();
  it('is 0x16 + sha1 up to 4MB', () => {
    expect(qetag(Buffer.alloc(0))).toBe('Fto5o-5ea0sNMlW_75VgGJCv2AcJ');
    const body = Buffer.from('console.log(1)');
    expect(qetag(body)).toBe(b64(Buffer.concat([Buffer.from([0x16]), sha1(body)])));
  });
  it('is 0x96 + sha1 of the 4MB block hashes above that', () => {
    const block = 4 * 1024 * 1024;
    const body = Buffer.alloc(block + 3, 7);
    const expected = b64(Buffer.concat([Buffer.from([0x96]), sha1(Buffer.concat([sha1(body.subarray(0, block)), sha1(body.subarray(block))]))]));
    expect(qetag(body)).toBe(expected);
    expect(qetag(body).startsWith('l')).toBe(true);
  });
});

describe('CSP: the CDN must be allowed before the switch goes on', () => {
  it('reads directives like a browser, conservatively', () => {
    const policy = "default-src 'self'; script-src 'self' https://cdn.crosery.com/yzgc/static/site/; style-src 'self'; font-src https://cdn.crosery.com";
    expect(cspAllows(policy, 'script-src', STATIC_CDN_BASE)).toBe(true);
    expect(cspAllows(policy, 'script-src', 'https://cdn.crosery.com/yzgc/promo/x.js')).toBe(false);
    expect(cspAllows(policy, 'style-src', STATIC_CDN_BASE)).toBe(false);
    expect(cspAllows(policy, 'font-src', STATIC_CDN_BASE)).toBe(true);
    expect(cspAllows("default-src https:", 'font-src', STATIC_CDN_BASE)).toBe(true);
    expect(cspAllows("default-src 'self'", 'font-src', STATIC_CDN_BASE)).toBe(false);
    expect(cspAllows("script-src https://*.crosery.com", 'script-src', STATIC_CDN_BASE)).toBe(false);
    expect(cspAllows("script-src https://cdn.crosery.com/yzgc/static/site", 'script-src', STATIC_CDN_BASE)).toBe(false);
    expect(cspAllows('', 'script-src', STATIC_CDN_BASE)).toBe(false);
  });

  it('both host templates allow exactly the upload prefix for scripts, styles and fonts, not the whole CDN host', () => {
    for (const name of ['preview', 'production']) {
      const policy = siteCsp(read(`deploy/nginx/${name}.conf`));
      for (const directive of ['script-src', 'style-src', 'font-src']) {
        expect(cspAllows(policy, directive, STATIC_CDN_BASE), `${name} ${directive}`).toBe(true);
        expect(cspAllows(policy, directive, `${STATIC_CDN_ORIGIN}/yzgc/promo/x.js`), `${name} ${directive} 不能放行整个 CDN 域名`).toBe(false);
      }
    }
  });
});

/** 假的七牛表单上传 + CDN：bucket 里按键存 qetag；insertOnly 语义与七牛相同（同内容 200，不同内容 614）。 */
function fakeQiniu({ cdn = {}, upload = {} }: {
  cdn?: { status?: number; type?: (key: string) => string | null; acao?: string | null; etag?: (key: string, stored?: string) => string; length?: (size: number) => number };
  upload?: { failFirst?: number; status?: number; hash?: string };
} = {}) {
  const bucket = new Map<string, { etag: string; size: number; type: string }>();
  const calls: { method: string; url: string; headers?: Record<string, string>; key?: string; token?: string }[] = [];
  let failures = upload.failFirst ?? 0;
  const fetchImpl = async (url: string, init: { method?: string; body?: FormData; headers?: Record<string, string> } = {}) => {
    const method = init.method ?? 'GET';
    if (method === 'POST' && url === UPLOAD_HOST) {
      const form = init.body!;
      const key = String(form.get('key'));
      const token = String(form.get('token'));
      calls.push({ method, url, key, token });
      if (failures > 0) { failures -= 1; return new Response('busy', { status: 503 }); }
      if (upload.status) return new Response('{"error":"bad token"}', { status: upload.status });
      const file = form.get('file') as Blob;
      const body = Buffer.from(await file.arrayBuffer());
      const etag = qetag(body);
      const existing = bucket.get(key);
      // Response 构造函数只接受 200–599；真实的 fetch 会原样给出七牛的 614（Node 22 的 fetch 实测），这里用同形状的对象。
      if (existing && existing.etag !== etag) return { status: 614, text: async () => '{"error":"file exists"}' } as unknown as Response;
      bucket.set(key, { etag, size: body.length, type: file.type });
      return Response.json({ key, hash: upload.hash ?? etag });
    }
    if (method === 'HEAD' && url.startsWith(`${STATIC_CDN_ORIGIN}/`)) {
      calls.push({ method, url, headers: init.headers });
      const key = url.slice(STATIC_CDN_ORIGIN.length + 1);
      const stored = bucket.get(key);
      if (!stored || cdn.status) return new Response(null, { status: cdn.status ?? 404 });
      const headers = new Headers({ etag: `"${cdn.etag ? cdn.etag(key, stored.etag) : stored.etag}"`, 'content-length': String(cdn.length ? cdn.length(stored.size) : stored.size) });
      const type = cdn.type ? cdn.type(key) : stored.type;
      if (type) headers.set('content-type', type);
      const acao = cdn.acao === undefined ? '*' : cdn.acao;
      if (acao) headers.set('access-control-allow-origin', acao);
      return new Response(null, { status: 200, headers });
    }
    throw new Error(`假的七牛不认识 ${method} ${url}`);
  };
  return { bucket, calls, fetch: fetchImpl as unknown as typeof fetch };
}

describe('upload and verification', () => {
  let dir = '';
  const entries = () => collect({ web: join(dir, 'web'), forum: join(dir, 'forum') });
  const REFERER = 'https://prev.yangtzeu.work/';
  const quiet = () => {};
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'static-cdn-up-'));
    const put = (path: string, body: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body); };
    put('web/assets/portal-Br-Bop_b.js', 'export const a = 1;');
    put('web/assets/MapleMono-Regular-CzQ1iDN2.woff2', 'wOF2');
    put('web/console-assets/index-12345678.css', 'body{}');
    put('forum/_nuxt/Bh2i2wUT.js', 'import "./x.js";');
    put('forum/_nuxt/logo.aFxUkDTw.png', 'PNG');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('uploads every file insert-only under the prefix, then checks each one through the CDN with our Referer and Origin', async () => {
    const qiniu = fakeQiniu();
    const token = tokenFor(uploadPolicy({ now: Date.now(), seconds: DAY }));
    const result = await uploadAll(entries(), { token, referer: REFERER, fetch: qiniu.fetch, log: quiet, backoff: 0 });
    expect(result).toMatchObject({ stored: 5, exists: 0, total: 5 });
    const posts = qiniu.calls.filter(call => call.method === 'POST');
    expect(posts).toHaveLength(5);
    for (const post of posts) {
      expect(post.url).toBe('https://up-z2.qiniup.com');
      expect(post.key!.startsWith(STATIC_CDN_PREFIX)).toBe(true);
      expect(post.token).toBe(token);
    }
    const heads = qiniu.calls.filter(call => call.method === 'HEAD');
    expect(heads).toHaveLength(5);
    for (const head of heads) {
      expect(head.url.startsWith(STATIC_CDN_BASE)).toBe(true);
      expect(head.headers).toMatchObject({ Referer: REFERER, Origin: 'https://prev.yangtzeu.work', 'Accept-Encoding': 'identity' });
    }
    expect(qiniu.bucket.get('yzgc/static/site/assets/portal-Br-Bop_b.js')?.type).toBe('text/javascript');
  });

  it('treats a key that already holds the same content as success (preview and production share the prefix)', async () => {
    const qiniu = fakeQiniu();
    const token = tokenFor(uploadPolicy({ now: Date.now(), seconds: DAY }));
    await uploadAll(entries(), { token, referer: REFERER, fetch: qiniu.fetch, log: quiet, backoff: 0 });
    const again = await uploadAll(entries(), { token, referer: 'https://yangtzeu.work/', fetch: qiniu.fetch, log: quiet, backoff: 0 });
    expect(again).toMatchObject({ total: 5 });
  });

  it('fails when a key already holds different content (insert-only never overwrites; the CDN ETag differs)', async () => {
    const qiniu = fakeQiniu();
    qiniu.bucket.set('yzgc/static/site/forum/_nuxt/Bh2i2wUT.js', { etag: qetag(Buffer.from('other build')), size: 16, type: 'text/javascript' });
    const token = tokenFor(uploadPolicy({ now: Date.now(), seconds: DAY }));
    await expect(uploadAll(entries(), { token, referer: REFERER, fetch: qiniu.fetch, log: quiet, backoff: 0 })).rejects.toThrow(/Bh2i2wUT\.js：ETag .* ≠ 本地/);
    expect(qiniu.bucket.get('yzgc/static/site/forum/_nuxt/Bh2i2wUT.js')?.etag).toBe(qetag(Buffer.from('other build')));
  });

  it.each([
    ['Qiniu stored a different hash', { upload: { hash: 'FtotallyDifferentHash000000000000' } }, /不一致/],
    ['the upload is refused', { upload: { status: 401 } }, /HTTP 401/],
    ['the CDN answers 403 to our Referer', { cdn: { status: 403 } }, /HTTP 403/],
    ['module scripts lack a CORS header', { cdn: { acao: null } }, /Access-Control-Allow-Origin/],
    ['CORS only for another site', { cdn: { acao: 'https://evil.example' } }, /Access-Control-Allow-Origin/],
    ['the CDN serves the wrong type', { cdn: { type: (key: string) => (key.endsWith('.js') ? 'application/octet-stream' : null) } }, /Content-Type/],
    ['the length differs', { cdn: { length: (size: number) => size + 1 } }, /长度/],
  ])('fails the job when %s', async (_name, options, error) => {
    const qiniu = fakeQiniu(options as Parameters<typeof fakeQiniu>[0]);
    const token = tokenFor(uploadPolicy({ now: Date.now(), seconds: DAY }));
    await expect(uploadAll(entries(), { token, referer: REFERER, fetch: qiniu.fetch, log: quiet, backoff: 0 })).rejects.toThrow(error);
  });

  it('does not need CORS on images (they load as plain <img>)', async () => {
    const qiniu = fakeQiniu({ cdn: { acao: null } });
    const token = tokenFor(uploadPolicy({ now: Date.now(), seconds: DAY }));
    const png = entries().filter(entry => entry.key.endsWith('.png'));
    await expect(uploadAll(png, { token, referer: REFERER, fetch: qiniu.fetch, log: quiet, backoff: 0 })).resolves.toMatchObject({ total: 1 });
  });

  it('retries a busy upload endpoint', async () => {
    const qiniu = fakeQiniu({ upload: { failFirst: 2 } });
    const token = tokenFor(uploadPolicy({ now: Date.now(), seconds: DAY }));
    await expect(uploadAll(entries(), { token, referer: REFERER, fetch: qiniu.fetch, log: quiet, backoff: 0, concurrency: 1 })).resolves.toMatchObject({ total: 5 });
  });

  it('never sends a key outside the prefix, even if an entry is tampered with', async () => {
    const qiniu = fakeQiniu();
    const token = tokenFor(uploadPolicy({ now: Date.now(), seconds: DAY }));
    const [entry] = entries();
    for (const key of ['yzgc/promo/film.m3u8', 'yzgc/static/site/index.html', 'yzgc/static/site/assets/../../promo/x.js']) {
      await expect(uploadOne({ ...entry, key }, { token, fetch: qiniu.fetch })).rejects.toThrow(/拒绝写入/);
      await expect(uploadAll([{ ...entry, key }], { token, referer: REFERER, fetch: qiniu.fetch, log: quiet })).rejects.toThrow(/拒绝写入/);
    }
    expect(qiniu.calls).toEqual([]);
  });

  it('refuses a token with the wrong policy before sending anything', async () => {
    const qiniu = fakeQiniu();
    const wide = tokenFor({ ...uploadPolicy({ now: Date.now(), seconds: DAY }), scope: 'crosery' });
    await expect(uploadAll(entries(), { token: wide, referer: REFERER, fetch: qiniu.fetch, log: quiet })).rejects.toThrow(/scope/);
    expect(qiniu.calls).toEqual([]);
  });

  it('only ever calls the form upload endpoint and CDN reads: no delete, move or metadata calls exist in the script', () => {
    const source = read('scripts/static-cdn.mjs');
    expect(source).not.toMatch(/rs(?:f)?\.qiniu|\/delete\/|\/move\/|\/chgm\/|\/chtype\/|\/deleteAfterDays\/|api\.qiniu/);
    const hosts = [...source.matchAll(/https:\/\/[a-z0-9.-]+/g)].map(match => match[0]);
    expect(new Set(hosts)).toEqual(new Set(['https://up-z2.qiniup.com']));
  });
});

describe('decide: the switch in the deploy workflow', () => {
  const preview = siteCsp(read('deploy/nginx/preview.conf'));
  const site = (csp: string | null) => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init: { method?: string } = {}) => {
      calls.push(`${init.method} ${url}`);
      return new Response(null, { status: 200, headers: csp === null ? {} : { 'content-security-policy': csp } });
    };
    return { calls, fetch: fetchImpl as unknown as typeof fetch };
  };

  it('stays same-origin without a token and does not contact anything', async () => {
    const origin = site(preview);
    for (const token of [undefined, '', '  ']) {
      expect(await decide({ token, origin: 'https://prev.yangtzeu.work', now: NOW, fetch: origin.fetch })).toMatchObject({ base: '', warnings: [] });
    }
    expect(origin.calls).toEqual([]);
  });

  it('turns on only when the token is right and the live CSP already allows the CDN', async () => {
    const origin = site(preview);
    const result = await decide({ token: validToken(), origin: 'https://prev.yangtzeu.work', now: NOW, fetch: origin.fetch });
    expect(result.base).toBe(STATIC_CDN_BASE);
    expect(result.warnings).toEqual([]);
    expect(origin.calls).toEqual(['HEAD https://prev.yangtzeu.work/']);
  });

  it('falls back to same-origin with a warning while the host template is not installed yet', async () => {
    const old = preview.replaceAll(` ${STATIC_CDN_BASE}`, '');
    const result = await decide({ token: validToken(), origin: 'https://yangtzeu.work', now: NOW, fetch: site(old).fetch });
    expect(result.base).toBe('');
    expect(result.warnings.join('\n')).toMatch(/script-src、style-src、font-src/);
    expect((await decide({ token: validToken(), origin: 'https://yangtzeu.work', now: NOW, fetch: site(null).fetch })).base).toBe('');
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await decide({ token: validToken(), origin: 'https://yangtzeu.work', now: NOW, fetch: down })).toMatchObject({ base: '' });
  });

  it('fails the run on a token with the wrong policy, and warns a month before it expires', async () => {
    await expect(decide({ token: tokenFor({ ...uploadPolicy({ now: NOW, seconds: DAY }), insertOnly: 0 }), origin: 'https://prev.yangtzeu.work', now: NOW, fetch: site(preview).fetch })).rejects.toThrow(/insertOnly/);
    const soon = await decide({ token: validToken(10 * DAY), origin: 'https://prev.yangtzeu.work', now: NOW, fetch: site(preview).fetch });
    expect(soon.base).toBe(STATIC_CDN_BASE);
    expect(soon.warnings.join('\n')).toMatch(/到期/);
  });

  it('accepts only an https origin without a path', async () => {
    for (const origin of ['http://prev.yangtzeu.work', 'https://prev.yangtzeu.work/forum/', 'prev.yangtzeu.work']) {
      await expect(decide({ token: '', origin, now: NOW, fetch: site(preview).fetch }), origin).rejects.toThrow(/--origin/);
    }
  });
});

describe('command line', () => {
  const capture = (isTTY = false) => {
    const out: string[] = [];
    return { out, stream: { isTTY, write: (text: string) => { out.push(text); return true; } } };
  };
  const noFetch = (async (url: string) => { throw new Error(`不应联网：${url}`); }) as unknown as typeof fetch;
  const logs: string[] = [];
  const log = (line: string) => { logs.push(line); };

  it('decide prints base= (empty) without a token', async () => {
    const stdout = capture();
    await main(['decide', '--origin', 'https://prev.yangtzeu.work'], { env: {}, stdout: stdout.stream as never, log, fetch: noFetch, now: NOW });
    expect(stdout.out.join('')).toBe('base=\n');
  });

  it('upload refuses to run without a token, and --owner-env-file is refused in CI', async () => {
    const args = ['upload', '--web', '/nonexistent/web', '--forum', '/nonexistent/forum', '--referer', 'https://prev.yangtzeu.work/'];
    await expect(main(args, { env: {}, stdout: capture().stream as never, log, fetch: noFetch, now: NOW })).rejects.toThrow(/没有 STATIC_CDN_UPLOAD_TOKEN/);
    for (const env of [{ GITHUB_ACTIONS: 'true' }, { CI: 'true' }]) {
      await expect(main([...args, '--owner-env-file', '/nonexistent/.env'], { env, stdout: capture().stream as never, log, fetch: noFetch, now: NOW })).rejects.toThrow(/只给所有者本机/);
    }
  });

  it('mint-token writes the token only into a pipe, without a newline, and logs the policy but not the token', async () => {
    const env = { QINIU_ACCESS_KEY: FAKE_KEYS.accessKey, QINIU_SECRET_KEY: FAKE_KEYS.secretKey };
    await expect(main(['mint-token'], { env, stdout: capture(true).stream as never, log, fetch: noFetch, now: NOW })).rejects.toThrow(/只写进管道/);
    logs.length = 0;
    const stdout = capture();
    await main(['mint-token', '--days', '90'], { env, stdout: stdout.stream as never, log, fetch: noFetch, now: NOW });
    const token = stdout.out.join('');
    expect(token).not.toMatch(/\s/);
    expect(readUploadPolicy(token, NOW)).toMatchObject({ scope: 'crosery:yzgc/static/site/', isPrefixalScope: 1, insertOnly: 1, deadline: NOW / 1000 + 90 * DAY });
    expect(logs.join('\n')).not.toContain(token);
    expect(logs.join('\n')).not.toContain(FAKE_KEYS.secretKey);
    expect(logs.join('\n')).toMatch(/insertOnly=1/);
    await expect(main(['mint-token', '--days', '400'], { env, stdout: capture().stream as never, log, fetch: noFetch, now: NOW })).rejects.toThrow(/--days/);
  });

  it('rejects unknown commands and flags', () => {
    expect(() => parseArgs(['delete', '--key', 'x'])).toThrow(/用法/);
    expect(() => parseArgs(['upload', '--web', 'a', '--forum', 'b', '--referer', 'https://x/', '--overwrite', '1'])).toThrow(/不认识参数 --overwrite/);
    expect(() => parseArgs(['decide'])).toThrow(/缺 --origin/);
    expect(() => parseArgs(['plan', '--web', '--forum', 'b'])).toThrow(/缺值/);
  });
});
