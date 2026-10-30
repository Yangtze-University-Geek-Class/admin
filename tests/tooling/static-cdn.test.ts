import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteCsp } from '../../app/forum/scripts/csp-header.mjs';
import { STATIC_CDN_BASE, STATIC_CDN_ORIGIN, STATIC_CDN_PREFIX } from '../../scripts/static-cdn-base.mjs';
import {
  AREAS, GUIDE_IMAGES, MAX_FILE_BYTES, PUBLIC_DIRS, PUBLISHED_IMAGES, STICKERS,
  assertKey, collect, collectGuideImages, collectPublishedImages, collectStickers, cspAllows, guideImageHash, main, mimeFor, originPathOf,
  uploadAll,
} from '../../scripts/static-cdn.mjs';
import { createS3Storage, readS3Config, sha256 } from '../../scripts/static-cdn-s3.mjs';
import { startCdnStore } from './cdn-store-fixture';
import { buildManifest, manifestText } from '../../scripts/sticker-manifest.mjs';

// 静态资源 CDN（#295）：保留收集与前缀拒绝用例，旧 token 一律退役；S3 使用本地 HTTP 假存储与合成凭据。
// 上传协议、发布清单和构建开关分别在 static-cdn-{http,s3,manifest,switch}.test.ts。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

const NOW = Date.parse('2026-10-26T17:21:00Z');
const DAY = 24 * 3600;
describe('object keys and the prefix guard', () => {
  it('accepts only files under the three build output folders of static/site/', () => {
    for (const key of [
      'static/site/assets/portal-Br-Bop_b.js',
      'static/site/console-assets/index-12345678.css',
      'static/site/forum/_nuxt/Bh2i2wUT.js',
      'static/site/forum/_nuxt/builds/meta/7bc7befa-4c9a-46aa-ad06-8073788e081b.json',
    ]) expect(assertKey(key)).toBe(key);
  });

  it.each([
    'static/site/index.html',
    'static/site/forum/index.html',
    'static/site/forum/logo.png',
    'static/site/assets/',
    'static/site/assets//x-12345678.js',
    'static/site/assets/./x-12345678.js',
    'static/site/assets/../../../promo/x.m3u8',
    'static/site/assets/x 12345678.js',
    'static/site/assets/x-12345678.js?v=1',
    'yzgc/static/other/assets/x-12345678.js',
    'yzgc/static/assets/x-12345678.js',
    'yzgc/promo/film.m3u8',
    'promo/x.mp4',
    '/static/site/assets/x-12345678.js',
    'fixture-scope:static/site/assets/x-12345678.js',
    `static/site/assets/${'a'.repeat(300)}.js`,
  ])('refuses %s', key => {
    expect(() => assertKey(key)).toThrow(/拒绝写入/);
  });

  it('refuses non-strings', () => {
    for (const key of [undefined, null, 1, ['static/site/assets/a-12345678.js']]) expect(() => assertKey(key)).toThrow(/拒绝写入/);
  });

  it('maps every key back to the same path on the origin', () => {
    expect(originPathOf('static/site/assets/a-12345678.js')).toBe('/assets/a-12345678.js');
    expect(originPathOf('static/site/forum/_nuxt/Bh2i2wUT.js')).toBe('/forum/_nuxt/Bh2i2wUT.js');
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
  // 假的源码 public 目录（官网、控制台、论坛），不读仓库里的真实目录。
  const publicDirs = () => ({ web: [join(dir, 'src/web-public'), join(dir, 'src/console-public')], forum: [join(dir, 'src/forum-public')] });
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
    // public 目录里有文件，但不在产物目录里：不影响上传。
    put('src/web-public/logo.png');
    put('src/forum-public/logo.png');
  };
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'static-cdn-')); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('takes only the hashed files of assets/, console-assets/ and forum _nuxt/ (plus the per-build meta), never latest.json', () => {
    fixture();
    const entries = collect(roots(), { publicDirs: publicDirs() });
    expect(entries.map(entry => entry.key)).toEqual([
      'static/site/assets/MapleMono-Regular-CzQ1iDN2.woff2',
      'static/site/assets/portal-Br-Bop_b.js',
      'static/site/console-assets/index-12345678.css',
      'static/site/forum/_nuxt/Bh2i2wUT.js',
      'static/site/forum/_nuxt/builds/meta/7bc7befa-4c9a-46aa-ad06-8073788e081b.json',
      'static/site/forum/_nuxt/entry.AbCdEfGh.css',
      'static/site/forum/_nuxt/logo.aFxUkDTw.png',
    ]);
    const js = entries.find(entry => entry.key.endsWith('Bh2i2wUT.js'))!;
    expect(js.file).toBe(join(dir, 'forum/_nuxt/Bh2i2wUT.js'));
    expect(js.mime).toBe('text/javascript');
    expect(js.size).toBe('forum/_nuxt/Bh2i2wUT.js'.length);
  });

  it('accepts every name shape the current builds produce', () => {
    fixture();
    // 取自本机 web、console、forum 的真实产物（2026-09-27），包括哈希里带 - 和 _、全是小写加数字、名字里带点的。
    const web = [
      'assets/vendor-mo-yqQQ4.js', 'assets/nunito-cyrillic-700-normal-DfHRUDv-.woff', 'assets/quicksand-latin-500-normal-_DbwbYKP.woff2',
      'assets/nunito-latin-ext-400-normal-i-8OOpdj.woff2', 'assets/hls.light-BIr5LmOV.js', 'assets/yugc-thumb-DVfikhFu.webp', 'assets/stage-5kTqngLo.js',
      'console-assets/TitleBadge.vue_vue_type_script_setup_true_lang-D2RTj2fV.js', 'console-assets/purify.es-BPuvlvQ_.js',
      'console-assets/index-q_LTQ-vz.js', 'console-assets/favicon-32-BpVePzBA.png', 'console-assets/Forum-DUck-jVy.js',
    ];
    const forum = ['_nuxt/sok5vuyt.js', '_nuxt/BK-uBHV1.js', '_nuxt/rUyK_OGP.js', '_nuxt/82CXSzep.js', '_nuxt/entry.CWRjoBJd.css', '_nuxt/logo.Dx3Kp_9a.png'];
    for (const path of web) put(`web/${path}`);
    for (const path of forum) put(`forum/${path}`);
    const keys = collect(roots(), { publicDirs: publicDirs() }).map(entry => entry.key);
    for (const path of web) expect(keys).toContain(`${STATIC_CDN_PREFIX}${path}`);
    for (const path of forum) expect(keys).toContain(`${STATIC_CDN_PREFIX}forum/${path}`);
  });

  it.each([
    ['an unhashed file', () => put('web/assets/readme.js'), /文件名不带内容哈希/],
    ['a Vite folder file without the -<hash> part', () => put('web/assets/manifest.json'), /web:assets\/manifest\.json（文件名不带内容哈希/],
    ['a Nuxt-shaped name in the Vite folders', () => put('web/console-assets/12345678.js'), /文件名不带内容哈希/],
    ['a subfolder in the Vite folders', () => put('web/assets/fonts/a-12345678.woff2'), /文件名不带内容哈希/],
    ['a forum file without a hash', () => put('forum/_nuxt/manifest.json'), /forum:_nuxt\/manifest\.json（文件名不带内容哈希/],
    ['a Vite-shaped name in the forum folder', () => put('forum/_nuxt/my-template.js'), /文件名不带内容哈希/],
    ['a bare 8-character forum name that is not a script', () => put('forum/_nuxt/12345678.css'), /文件名不带内容哈希/],
    // 形状和带哈希的产物一样，但它是 public/ 里的文件原样复制进来的：只有对照 public 目录才分得出来。
    ['a public/assets file that looks hashed', () => { put('src/web-public/assets/my-template.js'); put('web/assets/my-template.js'); }, /web:assets\/my-template\.js（是 .*src\/web-public\/assets\/my-template\.js 原样复制进来的/],
    ['a public/_nuxt file that looks hashed', () => { put('src/forum-public/_nuxt/abcdefgh.js'); put('forum/_nuxt/abcdefgh.js'); }, /原样复制进来的/],
    ['a console public file, if the console ever turns its publicDir on', () => { put('src/console-public/console-assets/app-abcdefgh.js'); put('web/console-assets/app-abcdefgh.js'); }, /原样复制进来的/],
    ['a hidden file', () => put('web/console-assets/.DS_Store'), /隐藏文件/],
    ['a build meta file that is not a build id', () => put('forum/_nuxt/builds/meta/latest.json'), /文件名不带内容哈希/],
    ['an unknown file type', () => put('web/assets/page-12345678.html'), /不认识的文件类型/],
    ['a symlink', () => symlinkSync('/etc/hosts', join(dir, 'web/assets/hosts-12345678.js')), /符号链接/],
    ['a symlinked output directory', () => { rmSync(join(dir, 'web/assets'), { recursive: true }); mkdirSync(join(dir, 'outside')); put('outside/portal-Br-Bop_b.js'); symlinkSync(join(dir, 'outside'), join(dir, 'web/assets')); }, /符号链接/],
    ['a file over the size limit', () => { put('web/assets/huge-12345678.js'); truncateSync(join(dir, 'web/assets/huge-12345678.js'), MAX_FILE_BYTES + 1); }, /超过/],
    ['a missing output folder', () => rmSync(join(dir, 'forum/_nuxt'), { recursive: true }), /站点根里没有 _nuxt/],
  ])('fails the whole upload on %s instead of skipping it', (_name, change, error) => {
    fixture();
    change();
    expect(() => collect(roots(), { publicDirs: publicDirs() })).toThrow(error);
  });

  it('checks the real public folders by default, and none of them feeds a hashed output folder', () => {
    // 默认对照本仓库的 public 目录：它们都不往带哈希的产物目录里放文件。web 与论坛容器的 nginx 因此能对整个目录
    // 发一年缓存（^~ /assets/、/console-assets/、/_nuxt/，见 hashed-asset-cache.test.ts）。
    expect(PUBLIC_DIRS).toEqual({ web: ['app/web/public', 'app/console/public'], forum: ['app/forum/public'] });
    for (const dir of ['app/web/public', 'app/forum/public']) expect(existsSync(join(repoRoot, dir)), dir).toBe(true);
    for (const area of AREAS) {
      for (const dir of PUBLIC_DIRS[area.site as 'web' | 'forum']) expect(existsSync(join(repoRoot, dir, area.dir)), `${dir}/${area.dir}`).toBe(false);
    }
    fixture();
    expect(collect(roots()).length).toBe(7);
  });
});

describe('usage guide screenshots (#281)', () => {
  it('uploads the repo screenshots under forum/guides/ only when the name carries the content hash', () => {
    const root = mkdtempSync(join(tmpdir(), 'geek-guide-images-'));
    try {
      expect(collectGuideImages(root)).toEqual([]);
      const dir = join(root, GUIDE_IMAGES.dir);
      mkdirSync(dir, { recursive: true });
      const png = Buffer.from('fake png bytes');
      const name = `console-competitions.${guideImageHash(png)}.png`;
      writeFileSync(join(dir, name), png);
      expect(collectGuideImages(root)).toEqual([{ file: join(dir, name), key: `${STATIC_CDN_PREFIX}forum/guides/${name}`, size: png.length, mime: 'image/png' }]);
      expect(originPathOf(`${STATIC_CDN_PREFIX}forum/guides/${name}`)).toBe(`/forum/guides/${name}`);
      writeFileSync(join(dir, 'stale.AAAAAAAA.webp'), 'other');
      expect(() => collectGuideImages(root)).toThrow(/stale\.AAAAAAAA\.webp（内容哈希是/);
      rmSync(join(dir, 'stale.AAAAAAAA.webp'));
      writeFileSync(join(dir, 'no-hash.webp'), 'x');
      expect(() => collectGuideImages(root)).toThrow(/no-hash\.webp（要是/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps every screenshot in the repo valid and referenced by a guide, and every guide image on the CDN', () => {
    const entries = collectGuideImages();
    const guidesDir = join(repoRoot, 'app/forum/content/guides');
    const text = existsSync(guidesDir) ? readdirSync(guidesDir).filter(name => name.endsWith('.md')).map(name => read(`app/forum/content/guides/${name}`)).join('\n') : '';
    const used = new Set([...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(match => match[1]));
    for (const url of used) expect(url.startsWith(`${STATIC_CDN_BASE}forum/guides/`), url).toBe(true);
    expect([...used].sort()).toEqual(entries.map(entry => `${STATIC_CDN_ORIGIN}/geek-public/${entry.key}`).sort());
  });
});

describe('published topic images (#304)', () => {
  const roots: string[] = [];
  afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'geek-published-cdn-'));
    roots.push(root);
    const body = Buffer.from('exported webp bytes');
    const name = `${sha256(body).slice(0, 16)}.webp`;
    mkdirSync(join(root, PUBLISHED_IMAGES.dir), { recursive: true });
    mkdirSync(dirname(join(root, PUBLISHED_IMAGES.topics)), { recursive: true });
    writeFileSync(join(root, PUBLISHED_IMAGES.dir, name), body);
    const url = `${STATIC_CDN_BASE}forum/published/${name}`;
    writeFileSync(join(root, PUBLISHED_IMAGES.topics), JSON.stringify({ topics: [
      { content: `![a](${url})\n![again](${url})\n![same origin](../published/ffffffffffffffff.webp)` },
    ] }));
    return { root, body, name, url };
  }

  it('collects only referenced content-addressed WebP files, once per object', () => {
    const { root, body, name } = fixture();
    expect(collectPublishedImages(root)).toEqual([{ file: join(root, PUBLISHED_IMAGES.dir, name), key: `${STATIC_CDN_PREFIX}forum/published/${name}`, size: body.length, mime: 'image/webp' }]);
    expect(originPathOf(`${STATIC_CDN_PREFIX}forum/published/${name}`)).toBe(`/forum/published/${name}`);
  });

  it('fails closed when bytes change or a referenced file is missing', () => {
    const { root, name } = fixture();
    writeFileSync(join(root, PUBLISHED_IMAGES.dir, name), 'changed');
    expect(() => collectPublishedImages(root)).toThrow(/内容哈希与文件名不符/);
    rmSync(join(root, PUBLISHED_IMAGES.dir, name));
    expect(() => collectPublishedImages(root)).toThrow(/ENOENT/);
  });

  it('does not infer uploads from unreferenced files or drop rules', () => {
    const root = mkdtempSync(join(tmpdir(), 'geek-published-empty-'));
    roots.push(root);
    expect(collectPublishedImages(root)).toEqual([]);
    mkdirSync(dirname(join(root, PUBLISHED_IMAGES.topics)), { recursive: true });
    writeFileSync(join(root, PUBLISHED_IMAGES.topics), JSON.stringify({ topics: [{ content: '（这张截图没有公开）' }] }));
    expect(collectPublishedImages(root)).toEqual([]);
  });
});

describe('built-in sticker images (#286)', () => {
  /** 过得了清单校验的假 WebP：RIFF 头加上按名字不同的内容。 */
  const fakeWebp = (seed: string) => {
    const payload = Buffer.from(seed.repeat(8));
    const header = Buffer.alloc(12);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(payload.length + 4, 4);
    header.write('WEBP', 8, 'latin1');
    return Buffer.concat([header, payload]);
  };
  const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
  const roots: string[] = [];
  afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

  /** 仓库根的替身：app/server/assets/stickers 下两个包、三个表情，其中 cats-bye 与 cats-hi 是同一张图。 */
  function repo() {
    const root = mkdtempSync(join(tmpdir(), 'geek-stickers-cdn-'));
    roots.push(root);
    const assets = join(root, STICKERS.dir);
    const pack = (id: string, name: string, stickers: { id: string; label: string }[], images: Record<string, Buffer>) => {
      mkdirSync(join(assets, id), { recursive: true });
      writeFileSync(join(assets, id, 'pack.json'), JSON.stringify({ id, name, stickers }));
      for (const [file, bytes] of Object.entries(images)) writeFileSync(join(assets, id, file), bytes);
    };
    const hi = fakeWebp('cats/hi');
    pack('cats', '猫猫', [{ id: 'hi', label: '招手' }, { id: 'bye', label: '再见' }], { 'hi.webp': hi, 'bye.webp': hi });
    pack('dogs', '狗狗', [{ id: 'run', label: '跑' }], { 'run.webp': fakeWebp('dogs/run') });
    const regenerate = () => writeFileSync(join(assets, 'manifest.json'), manifestText(buildManifest(assets)));
    regenerate();
    return { root, assets, regenerate, hi };
  }

  it('plans one object per distinct image at forum/stickers/<sha256>.webp, the same image in two stickers once', () => {
    const { root, assets, hi } = repo();
    const entries = collectStickers(root);
    const run = fakeWebp('dogs/run');
    expect(entries).toEqual([hi, run].map(bytes => ({ file: expect.any(String), key: `${STATIC_CDN_PREFIX}forum/stickers/${sha256(bytes)}.webp`, size: bytes.length, mime: 'image/webp' })).sort((a, b) => a.key.localeCompare(b.key)));
    expect(entries.find(entry => entry.key.includes(sha256(run)))!.file).toBe(join(assets, 'dogs/run.webp'));
    for (const entry of entries) {
      expect(assertKey(entry.key)).toBe(entry.key);
      expect(originPathOf(entry.key)).toBe(`/forum/stickers/${entry.key.split('/').pop()}`);
    }
  });

  it('plans nothing when the folder does not exist, and the real repo plans exactly the manifest', () => {
    const empty = mkdtempSync(join(tmpdir(), 'geek-stickers-none-'));
    roots.push(empty);
    expect(collectStickers(empty)).toEqual([]);
    const manifest = buildManifest();
    const keys = new Set(manifest.packs.flatMap(pack => pack.stickers.map(sticker => `${STATIC_CDN_PREFIX}${sticker.key}`)));
    expect(collectStickers().map(entry => entry.key).sort()).toEqual([...keys].sort());
    expect(keys.size).toBeGreaterThanOrEqual(24);
  });

  it.each([
    ['manifest.json is missing', (c: ReturnType<typeof repo>) => rmSync(join(c.assets, 'manifest.json')), /manifest\.json 不存在/],
    ['an image was added and the manifest not regenerated', (c: ReturnType<typeof repo>) => { writeFileSync(join(c.assets, 'dogs/sit.webp'), fakeWebp('sit')); writeFileSync(join(c.assets, 'dogs/pack.json'), JSON.stringify({ id: 'dogs', name: '狗狗', stickers: [{ id: 'run', label: '跑' }, { id: 'sit', label: '坐' }] })); }, /manifest\.json 和目录对不上/],
    ['an image changed after the manifest was written', (c: ReturnType<typeof repo>) => writeFileSync(join(c.assets, 'dogs/run.webp'), fakeWebp('changed')), /manifest\.json 和目录对不上/],
    ['pack.json is broken', (c: ReturnType<typeof repo>) => writeFileSync(join(c.assets, 'dogs/pack.json'), '{'), /不能上传：.*dogs\/pack\.json：读不出来/s],
    ['an image is not listed in pack.json', (c: ReturnType<typeof repo>) => writeFileSync(join(c.assets, 'dogs/extra.webp'), fakeWebp('extra')), /dogs\/extra\.webp：没有写进 pack\.json/],
    ['a file is not a WebP', (c: ReturnType<typeof repo>) => writeFileSync(join(c.assets, 'dogs/run.webp'), Buffer.from('not an image at all')), /不是 WebP 图片/],
  ])('fails the whole plan when %s, so the CDN never lacks an address the manifest lists', (_name, change, error) => {
    const context = repo();
    change(context);
    expect(() => collectStickers(context.root)).toThrow(error);
  });

  it('plan prints the forum/stickers object count and total bytes, offline and read-only', async () => {
    const web = mkdtempSync(join(tmpdir(), 'geek-stickers-plan-'));
    roots.push(web);
    for (const path of ['web/assets/portal-Br-Bop_b.js', 'web/console-assets/index-12345678.css', 'forum/_nuxt/Bh2i2wUT.js']) {
      mkdirSync(dirname(join(web, path)), { recursive: true });
      writeFileSync(join(web, path), 'x');
    }
    const lines: string[] = [];
    const logs: string[] = [];
    const offline = (() => { throw new Error('plan 不联网'); }) as unknown as typeof fetch;
    const { entries } = await main(['plan', '--web', join(web, 'web'), '--forum', join(web, 'forum')], { env: {}, stdout: { write: (text: string) => { lines.push(text); return true; } } as never, log: (text: string) => { logs.push(text); }, fetch: offline, now: NOW });
    const stickers = entries.filter((entry: { key: string }) => entry.key.startsWith(`${STATIC_CDN_PREFIX}forum/stickers/`));
    const manifest = buildManifest();
    const distinct = new Set(manifest.packs.flatMap(pack => pack.stickers.map(sticker => sticker.sha256)));
    const bytes = manifest.packs.flatMap(pack => pack.stickers).filter((sticker, index, all) => all.findIndex(other => other.sha256 === sticker.sha256) === index).reduce((sum, sticker) => sum + sticker.size, 0);
    expect(stickers).toHaveLength(distinct.size);
    expect(logs.join('\n')).toContain(`内置表情图片 ${distinct.size} 个对象`);
    expect(bytes).toBeGreaterThan(0);
    expect(lines.filter(line => line.includes('/forum/stickers/'))).toHaveLength(distinct.size);
    for (const line of lines.filter(line => line.includes('/forum/stickers/'))) expect(line).toMatch(/^static\/site\/forum\/stickers\/[0-9a-f]{64}\.webp\t\d+\timage\/webp\n$/);
    expect(entries.length).toBe(3 + collectGuideImages().length + distinct.size + collectPublishedImages().length);
  });

  it('uploads stickers through signed S3 and never overwrites a conflicting key', async () => {
    const { root } = repo();
    const store = await startCdnStore({ acao: null });
    try {
      const storage = createS3Storage(store.config, { fetch: store.fetch, allowLoopbackForTests: true, backoff: 0 });
      const entries = collectStickers(root);
      expect(await uploadAll(entries, { storage, fetch: store.fetch, referer: 'https://prev.yangtzeu.work/', log: () => {}, backoff: 0 })).toMatchObject({ stored: 2, total: 2 });
      expect(await uploadAll(entries, { storage, fetch: store.fetch, referer: 'https://yangtzeu.work/', log: () => {}, backoff: 0 })).toMatchObject({ exists: 2, total: 2 });
      const first = entries[0];
      store.objects.set(first.key, { body: Buffer.from('someone else'), type: 'image/webp' });
      const writes = store.calls.filter(call => call.method === 'PUT').length;
      await expect(uploadAll([first], { storage, fetch: store.fetch, referer: 'https://prev.yangtzeu.work/', log: () => {} })).rejects.toThrow(/SHA-256.*冲突/);
      expect(store.objects.get(first.key)?.body.toString()).toBe('someone else');
      expect(store.calls.filter(call => call.method === 'PUT')).toHaveLength(writes);
    } finally { await store.close(); }
  });

  it('keeps the prefix guard: the stickers folder is open, its siblings and path tricks are not', () => {
    const hash = 'ab'.repeat(32);
    expect(assertKey(`${STATIC_CDN_PREFIX}forum/stickers/${hash}.webp`)).toBe(`${STATIC_CDN_PREFIX}forum/stickers/${hash}.webp`);
    for (const key of [`${STATIC_CDN_PREFIX}forum/stickers`, `${STATIC_CDN_PREFIX}forum/stickers/`, `${STATIC_CDN_PREFIX}forum/stickers/../index.html`, `${STATIC_CDN_PREFIX}forum/stickers//x.webp`, `${STATIC_CDN_PREFIX}forum/sticker/${hash}.webp`, `${STATIC_CDN_PREFIX}stickers/${hash}.webp`, `yzgc/promo/forum/stickers/${hash}.webp`]) {
      expect(() => assertKey(key), key).toThrow(/拒绝写入/);
    }
  });
});

describe('retired-token refusal (old policy rejection cases remain refused)', () => {
  it.each([
    ['the whole bucket', { scope: 'fixture-scope' }, /scope/],
    ['a wider prefix', { scope: 'fixture-scope:yzgc/' }, /scope/],
    ['another bucket', { scope: 'other:static/site/' }, /scope/],
    ['an exact key instead of a prefix', { isPrefixalScope: 0 }, /isPrefixalScope/],
    ['overwrite allowed', { insertOnly: 0 }, /insertOnly/],
    ['insertOnly missing', { insertOnly: undefined }, /insertOnly/],
    ['expired', { deadline: NOW / 1000 - 1 }, /过期/],
    ['expiring within 10 minutes', { deadline: NOW / 1000 + 300 }, /过期/],
    // 保留旧 token 的期限拒绝探针；新 S3 凭据不继承七牛有效期策略。
    ['expiring within 90 minutes', { deadline: NOW / 1000 + 90 * 60 }, /已过期或 90 分钟内过期/],
    ['a deadline one second past 366 days', { deadline: NOW / 1000 + 366 * DAY + 1 }, /到期时间太远.*最多 366 天/],
    ['a 50-year deadline', { deadline: NOW / 1000 + 50 * 365 * DAY }, /到期时间太远/],
    ['no deadline', { deadline: undefined }, /deadline/],
    ['a callback', { callbackUrl: 'https://example.com/cb' }, /多出字段 callbackUrl/],
    ['persistent processing', { persistentOps: 'avthumb/mp4' }, /多出字段 persistentOps/],
    ['a size limit above the cap', { fsizeLimit: MAX_FILE_BYTES * 2 }, /fsizeLimit/],
  ])('rejects %s instead of activating a legacy provider', (_name, change) => {
    const token = `fixture:${Buffer.from(JSON.stringify(change)).toString('base64url')}:retired`;
    expect(() => readS3Config({ STATIC_CDN_UPLOAD_TOKEN: token })).toThrow(/退役/);
    try { readS3Config({ STATIC_CDN_UPLOAD_TOKEN: token }); } catch (error) {
      expect((error as Error).message).not.toContain(token);
    }
  });
  it.each(['', 'abc', 'a:b', 'a:b:c:d', 'a:b:!!!', `a:b:${Buffer.from('not json').toString('base64url')}`, `a:b:${Buffer.from('[1]').toString('base64url')}`])('never accepts malformed legacy token %j', token => {
    if (!token) expect(readS3Config({ STATIC_CDN_UPLOAD_TOKEN: token })).toBeNull();
    else expect(() => readS3Config({ STATIC_CDN_UPLOAD_TOKEN: token })).toThrow(/退役/);
  });
});

describe('CSP: the CDN must be allowed before the switch goes on', () => {
  it('reads directives like a browser, conservatively', () => {
    const policy = "default-src 'self'; script-src 'self' https://cdn.yangtzeu.work/geek-public/static/site/; style-src 'self'; font-src https://cdn.yangtzeu.work";
    expect(cspAllows(policy, 'script-src', STATIC_CDN_BASE)).toBe(true);
    expect(cspAllows(policy, 'script-src', 'https://cdn.yangtzeu.work/yzgc/promo/x.js')).toBe(false);
    expect(cspAllows(policy, 'style-src', STATIC_CDN_BASE)).toBe(false);
    expect(cspAllows(policy, 'font-src', STATIC_CDN_BASE)).toBe(true);
    expect(cspAllows("default-src https:", 'font-src', STATIC_CDN_BASE)).toBe(true);
    expect(cspAllows("default-src 'self'", 'font-src', STATIC_CDN_BASE)).toBe(false);
    expect(cspAllows("script-src https://*.yangtzeu.work", 'script-src', STATIC_CDN_BASE)).toBe(false);
    expect(cspAllows("script-src https://cdn.yangtzeu.work/yzgc/static/site", 'script-src', STATIC_CDN_BASE)).toBe(false);
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

describe('CSP: built-in sticker images (#286)', () => {
  it('both host templates already let images load from the CDN prefix (img-src), so the switch needs no CSP change for stickers', () => {
    const url = `${STATIC_CDN_BASE}forum/stickers/${'ab'.repeat(32)}.webp`;
    for (const name of ['preview', 'production']) {
      const policy = siteCsp(read(`deploy/nginx/${name}.conf`));
      expect(cspAllows(policy, 'img-src', url), name).toBe(true);
      expect(cspAllows(policy, 'img-src', 'http://cdn-old.example.test/static/site/forum/stickers/x.webp'), `${name} 不放行 http`).toBe(false);
    }
  });
});
