import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collect, decide, main, uploadAll, uploadOne, verifyOne } from '../../scripts/static-cdn.mjs';
import { boundedRequest, createS3Storage, readS3Config, sha256 } from '../../scripts/static-cdn-s3.mjs';
import { createReleaseManifest, manifestText, releaseKey } from '../../scripts/static-cdn-manifest.mjs';
import { STATIC_CDN_BASE } from '../../scripts/static-cdn-base.mjs';
import { fixtureEnv, startCdnStore, type StoreFault } from './cdn-store-fixture';

const identity = { environment: 'preview', commit: 'b'.repeat(40), generatedAt: '2026-10-26T17:21:00.000Z' };
const REFERER = 'https://prev.yangtzeu.work/';
const quiet = () => {};
const dirs: string[] = [];
const stores: Awaited<ReturnType<typeof startCdnStore>>[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function fixture(fault: StoreFault = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cdn-http-')); dirs.push(dir);
  for (const [path, body] of [
    ['web/assets/portal-Br-Bop_b.js', 'export const a=1;'],
    ['web/console-assets/index-12345678.css', 'body{}'],
    ['forum/_nuxt/Bh2i2wUT.js', 'export{}'],
  ]) {
    mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), body);
  }
  const store = await startCdnStore(fault); stores.push(store);
  const storage = createS3Storage(store.config, { allowLoopbackForTests: true, fetch: store.fetch, backoff: 0, timeoutMs: 150 });
  const roots = { web: join(dir, 'web'), forum: join(dir, 'forum') };
  const entries = collect(roots);
  // 公开地址不经 S3 端点：测试里把公开入口指向假存储，生产里默认是 STATIC_CDN_ORIGIN。
  return { dir, roots, store, storage, entries, options: { storage, fetch: store.fetch, backoff: 0, timeoutMs: 150, referer: REFERER, log: quiet, publicOrigin: store.endpoint } };
}

describe('HTTP upload and public verification', () => {
  it('uploads every file via SigV4, then verifies anonymous HEAD/GET/Range with MIME and CORS for both environments', async () => {
    const f = await fixture();
    expect(await uploadAll(f.entries, f.options)).toMatchObject({ stored: 3, exists: 0, total: 3 });
    expect(await uploadAll(f.entries, { ...f.options, referer: 'https://yangtzeu.work/' })).toMatchObject({ exists: 3, total: 3 });
    expect(f.store.calls.filter(call => call.method === 'PUT')).toHaveLength(3);
    for (const call of f.store.calls) {
      expect(['GET', 'HEAD', 'PUT']).toContain(call.method);
      if (call.method === 'PUT') {
        expect(call.signed).toBe(true);
        expect(call.headers).not.toHaveProperty('if-none-match');
        expect(call.headers['x-amz-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
      }
      if (!call.signed) {
        expect([REFERER, 'https://yangtzeu.work/']).toContain(call.headers.referer);
        const encodings = (call.headers['accept-encoding'] ?? '').split(',').map(value => value.trim()).filter(Boolean);
        expect(encodings.length).toBeGreaterThan(0);
        expect(encodings.every(value => value === 'identity')).toBe(true);
      }
    }
  });

  it('does not overwrite an existing different build, even though the fake S3 server itself allows overwrite', async () => {
    const f = await fixture();
    const entry = f.entries[0];
    f.store.objects.set(entry.key, { body: Buffer.from('other build'), type: entry.mime });
    await expect(uploadAll([entry], f.options)).rejects.toThrow(/SHA-256.*冲突/);
    expect(f.store.objects.get(entry.key)?.body.toString()).toBe('other build');
    expect(f.store.calls.some(call => call.method === 'PUT')).toBe(false);
  });

  it.each([
    ['the upload is refused', { putStatus: 401 }, /HTTP 401/],
    ['the storage read is forbidden', { readStatus: 403 }, /HTTP 403/],
    ['module scripts lack CORS', { acao: null }, /Access-Control-Allow-Origin/],
    ['CORS is for another site', { acao: 'https://evil.example' }, /Access-Control-Allow-Origin/],
    ['MIME is wrong', { type: 'application/octet-stream' }, /Content-Type/],
    ['HEAD length differs', { headLength: 99 }, /长度/],
    ['Range is ignored', { rangeStatus: 200 }, /Range/],
    ['Content-Range is wrong', { contentRange: 'bytes 0-1/999' }, /Range/],
    ['Range bytes differ', { rangeBody: Buffer.from('wrong') }, /Range/],
    ['Range MIME differs', { rangeType: 'text/html' }, /Content-Type/],
    ['Range CORS differs', { rangeAcao: 'https://evil.example' }, /Access-Control/],
    ['cache forbids storage despite public', { cacheControl: 'public, max-age=31536000, no-store' }, /Cache-Control/],
  ])('fails closed when %s', async (_name, fault, error) => {
    const f = await fixture(fault);
    await expect(uploadAll(f.entries, f.options)).rejects.toThrow(error);
  });

  it('checks full GET SHA-256, not opaque S3 ETags or a claimed metadata hash', async () => {
    const f = await fixture();
    const [entry] = f.entries;
    const original = readFileSync(entry.file);
    f.store.objects.set(entry.key, { body: original, type: entry.mime });
    expect(await verifyOne(entry, f.options)).toBe('');
    f.store.fault.body = Buffer.alloc(original.length, 9);
    expect(await verifyOne(entry, f.options)).toMatch(/完整 GET SHA-256/);
  });

  it('images need no CORS; fetched GLB, WASM, JSON and fonts do', async () => {
    const f = await fixture({ acao: null });
    for (const [extension, mime, cors] of [
      ['png', 'image/png', false], ['glb', 'model/gltf-binary', true], ['wasm', 'application/wasm', true],
      ['json', 'application/json', true], ['woff2', 'font/woff2', true],
    ] as const) {
      const file = join(f.dir, `fixture.${extension}`); writeFileSync(file, 'fixture');
      const entry = { key: `yzgc/static/site/assets/file-12345678.${extension}`, file, size: 7, mime };
      if (cors) await expect(uploadAll([entry], f.options)).rejects.toThrow(/Access-Control-Allow-Origin/);
      else expect(await uploadAll([entry], f.options)).toMatchObject({ total: 1 });
    }
  });

  it('retries bounded 429/503 reads and reconciles a lost PUT response by GET, not by overwriting', async () => {
    const f = await fixture({ busy: 2, lostPut: true });
    expect(await uploadAll(f.entries, { ...f.options, concurrency: 1 })).toMatchObject({ total: 3 });
    expect(f.store.calls.filter(call => call.method === 'PUT')).toHaveLength(3);
    f.store.fault.busy = 10;
    const before = f.store.calls.length;
    await expect(f.storage.request('GET', f.entries[0].key)).rejects.toThrow(/HTTP 429/);
    expect(f.store.calls.length - before).toBe(3);
    f.store.fault.busy = 2; f.store.fault.busyStatus = 503;
    expect((await f.storage.request('GET', f.entries[0].key)).status).toBe(200);
  });

  it('refuses tampered keys, oversized files, duplicates and invalid concurrency before any request', async () => {
    const f = await fixture();
    const entry = f.entries[0];
    for (const key of [
      'yzgc/promo/film.m3u8', 'yzgc/static/site/index.html', 'yzgc/static/site/assets/../../promo/x.js',
      'yzgc/static/site/assets/%2e%2e/x.js', 'yzgc/static/site/assets/x.js?token=fixture', '//evil.example/x',
      'yzgc/static/site/assets/./x.js', 'yzgc/static/site/assets/x\\evil.js',
    ]) {
      await expect(uploadOne({ ...entry, key }, f.options)).rejects.toThrow(/拒绝写入/);
    }
    await expect(uploadAll([entry, entry], f.options)).rejects.toThrow(/重复/);
    for (const concurrency of [0, 9, NaN, 1.5]) await expect(uploadAll([entry], { ...f.options, concurrency })).rejects.toThrow(/concurrency/);
    await expect(uploadOne({ ...entry, size: 99999999 }, f.options)).rejects.toThrow(/长度/);
    expect(f.store.calls).toEqual([]);
  });

  it('never follows redirects with credentials or includes provider responses in errors', async () => {
    const f = await fixture({ redirect: 'https://evil.example/collect' });
    await expect(uploadAll(f.entries, { ...f.options, concurrency: 1 })).rejects.toThrow(/重定向/);
    expect(f.store.calls).toHaveLength(1);
    f.store.fault.redirect = undefined; f.store.fault.putStatus = 401;
    try { await uploadAll(f.entries, f.options); } catch (error) {
      expect((error as Error).message).not.toContain('fixture-secret');
    }
    const broken = async () => { throw new Error('fixture-secret-and-signed-url'); };
    expect(await verifyOne(f.entries[0], { ...f.options, fetch: broken })).not.toContain('fixture-secret');
  });

  it('times out delayed headers and stalled bodies, with finite request and response limits', async () => {
    const f = await fixture({ delayMs: 50 });
    const start = Date.now();
    await expect(boundedRequest(`${f.store.endpoint}/fixture-bucket/${f.entries[0].key}`, { method: 'GET' }, { fetch: f.store.fetch, timeoutMs: 10 })).rejects.toThrow(/超时/);
    expect(Date.now() - start).toBeLessThan(1000);
    f.store.fault.delayMs = 0; f.store.fault.hangBody = true;
    f.store.objects.set(f.entries[0].key, { body: Buffer.from('fixture'), type: 'text/javascript' });
    await expect(boundedRequest(`${f.store.endpoint}/fixture-bucket/${f.entries[0].key}`, { method: 'GET' }, { fetch: f.store.fetch, timeoutMs: 10 })).rejects.toThrow(/超时/);
    f.store.fault.hangBody = false; f.store.fault.length = 11 * 1024 * 1024;
    await expect(boundedRequest(`${f.store.endpoint}/fixture-bucket/${f.entries[0].key}`, { method: 'GET' }, { fetch: f.store.fetch })).rejects.toThrow(/长度超限/);
  });
});

describe('release manifest and restore provenance at the CLI seam', () => {
  it('rejects malformed recovery JSON without echoing its contents or making HTTP requests', async () => {
    const f = await fixture();
    const file = join(f.dir, 'bad-manifest.json');
    writeFileSync(file, 'fixture-secret-must-not-appear');
    await expect(main(['verify-manifest', '--manifest', file, '--referer', REFERER], { env: {}, ...f.options })).rejects.toThrow('清单 JSON 无效');
    expect(f.store.calls).toHaveLength(0);
  });

  it('publishes the exact release index only after assets verify; re-runs compare bytes, changed provenance cannot replace the old index', async () => {
    const f = await fixture();
    const manifest = createReleaseManifest(f.entries, identity);
    expect(await uploadAll(f.entries, { ...f.options, manifest })).toMatchObject({ manifestKey: releaseKey(manifest) });
    const key = releaseKey(manifest);
    expect(f.store.objects.get(key)?.body.toString()).toBe(manifestText(manifest));
    await uploadAll(f.entries, { ...f.options, manifest });
    const changed = { ...manifest, generated_at: '2026-10-26T17:22:00.000Z' };
    await expect(uploadAll(f.entries, { ...f.options, manifest: changed })).rejects.toThrow(/冲突/);
    expect(f.store.calls.filter(call => call.method === 'PUT' && call.key === key)).toHaveLength(1);
    const file = join(f.dir, 'release.json'); writeFileSync(file, manifestText(manifest));
    const result = await main(['verify-manifest', '--manifest', file, '--referer', REFERER], { env: {}, ...f.options });
    expect(result.manifest.commit).toBe(identity.commit);
    f.store.objects.delete(f.entries[0].key);
    await expect(main(['verify-manifest', '--manifest', file, '--referer', REFERER], { env: {}, ...f.options })).rejects.toThrow(/HTTP 404/);
  });

  it('never publishes a release index when asset verification fails or its object list was tampered', async () => {
    const f = await fixture({ acao: null });
    const manifest = createReleaseManifest(f.entries, identity);
    await expect(uploadAll(f.entries, { ...f.options, manifest })).rejects.toThrow(/CORS|Access-Control/);
    expect(f.store.objects.has(releaseKey(manifest))).toBe(false);
    f.store.calls.length = 0;
    await expect(uploadAll(f.entries, { ...f.options, manifest: { ...manifest, objects: [] } })).rejects.toThrow(/清单与上传/);
    expect(f.store.calls).toEqual([]);
  });

  it('runs CLI upload and recovery on synthetic files; keeps content index private and refuses local overwrite before HTTP', async () => {
    const f = await fixture();
    const sourceRoot = join(f.dir, 'source'); mkdirSync(sourceRoot);
    const manifest = join(f.dir, 'manifest.json');
    const index = join(f.dir, 'private-index.json');
    const args = ['upload', '--web', f.roots.web, '--forum', f.roots.forum, '--referer', REFERER,
      '--environment', identity.environment, '--commit', identity.commit, '--generated-at', identity.generatedAt,
      '--manifest', manifest, '--content-index', index];
    await main(args, { env: {}, ...f.options, sourceRoot });
    expect(statSync(index).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(index, 'utf8'))).not.toHaveProperty('commit');
    expect([...f.store.objects.keys()].sort()).toEqual([...f.entries.map(entry => entry.key), releaseKey(identity)].sort());
    expect(JSON.stringify([...f.store.objects.values()].map(object => object.body.toString()))).not.toContain('"hashes"');
    await main(['verify-manifest', '--manifest', manifest, '--referer', REFERER], { env: {}, ...f.options });
    f.store.calls.length = 0;
    await expect(main(args, { env: {}, ...f.options, sourceRoot })).rejects.toThrow(/存在|EEXIST/);
    expect(f.store.calls).toHaveLength(0);
    const failed = join(f.dir, 'failed.json');
    f.store.fault.acao = null;
    const retry = [...args]; retry[retry.indexOf(manifest)] = failed; retry[retry.indexOf(index)] = join(f.dir, 'failed-index.json');
    await expect(main(retry, { env: {}, ...f.options, sourceRoot })).rejects.toThrow(/Access-Control/);
    expect(existsSync(failed)).toBe(false);
  });

  it('keeps plan offline, refuses missing upload credentials and retires owner-env-file/mint-token', async () => {
    const f = await fixture();
    const stdout = { write: () => true };
    const offline = async () => { throw new Error('offline'); };
    const args = ['--web', f.roots.web, '--forum', f.roots.forum];
    expect((await main(['plan', ...args], { env: {}, stdout: stdout as never, log: quiet, fetch: offline })).entries.length).toBeGreaterThan(3);
    await expect(main(['upload', ...args, '--referer', REFERER, '--environment', identity.environment, '--commit', identity.commit, '--generated-at', identity.generatedAt], { env: {}, fetch: offline })).rejects.toThrow(/没有完整 S3/);
    for (const args of [['mint-token'], ['upload', '--owner-env-file', '/private/.env'], ['delete']]) await expect(main(args, { env: fixtureEnv })).rejects.toThrow(/退役|不认识|用法/);
  });
});

describe('build selection', () => {
  const csp = `script-src ${STATIC_CDN_BASE}; style-src ${STATIC_CDN_BASE}; font-src ${STATIC_CDN_BASE}`;
  it('keeps the original no-credentials/CSP fallback but fails closed on S3 401 instead of reverting provider', async () => {
    const f = await fixture();
    const opts = { origin: 'https://prev.yangtzeu.work', config: readS3Config(fixtureEnv), storage: f.storage };
    expect(await decide({ origin: opts.origin, fetch: async () => { throw new Error('no request'); } })).toMatchObject({ base: '' });
    for (const policy of ['', "default-src 'self'"]) expect(await decide({ ...opts, fetch: async () => new Response(null, { headers: { 'content-security-policy': policy } }) })).toMatchObject({ base: '' });
    expect(await decide({ ...opts, fetch: async () => new Response(null, { headers: { 'content-security-policy': csp } }) })).toMatchObject({ base: STATIC_CDN_BASE });
    f.store.fault.readStatus = 401;
    await expect(decide({ ...opts, fetch: async () => new Response(null, { headers: { 'content-security-policy': csp } }) })).rejects.toThrow(/HTTP 401/);
    for (const origin of ['http://prev.yangtzeu.work', 'https://prev.yangtzeu.work/forum/', 'prev.yangtzeu.work']) await expect(decide({ origin })).rejects.toThrow(/--origin/);
  });
});
