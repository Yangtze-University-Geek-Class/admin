#!/usr/bin/env node
// 新 CDN 静态资源：离线 collect/plan、CSP 构建开关、path-style S3 上传与完整 GET 验证。
// 不读取凭据文件，不调用旧供应商，不删除对象；七牛 S3 兼容接口不提供条件创建，防覆盖在客户端执行。
// 合同见 docs/ops/CDN.md；发布身份用于独立的、不可主动覆盖的公开清单。
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STATIC_CDN_PREFIX, staticCdnOrigin, staticCdnPrefixURL } from './static-cdn-base.mjs';
import { buildManifest, manifestProblem } from './sticker-manifest.mjs';
import { assertObjectContent, assertStorageKey, boundedRequest, CDN_MIME_TYPES as MIME, createS3Storage, readS3Config, readUploadConcurrency, sha256 } from './static-cdn-s3.mjs';
import { contentIndex, createReleaseManifest, manifestText, readEntry, releaseKey, validateReleaseManifest } from './static-cdn-manifest.mjs';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const USAGE = 'static-cdn.mjs decide --origin <https://…> | plan --web <目录> --forum <目录> | upload --web <目录> --forum <目录> --referer <https://…/> --environment <preview|production> --commit <完整SHA> --generated-at <提交时间> | verify-manifest --manifest <文件> --referer <https://…/>';
if (STATIC_CDN_PREFIX !== 'yzgc/static/site/') throw new Error('CDN 目的地不符合合同');

// ── 对象键 ─────────────────────────────────────────────────────────────────

/** 源站目录 → CDN 对象键前缀（在 STATIC_CDN_PREFIX 之后）。只有这三处是带哈希的构建产物。 */
export const AREAS = [
  { site: 'web', dir: 'assets', mount: 'assets/' },
  { site: 'web', dir: 'console-assets', mount: 'console-assets/' },
  { site: 'forum', dir: '_nuxt', mount: 'forum/_nuxt/' },
];
/**
 * 论坛使用说明的截图（#281）：不是构建产物，是仓库里的源文件，正文直接写 CDN 地址。文件名带内容哈希
 * （<名字>.<sha256 的 base64url 前 8 位>.<webp|png>），collectGuideImages 逐个核对哈希，只增不改的上传才不会撞键。
 */
export const GUIDE_IMAGES = { dir: 'app/forum/content/guide-images', mount: 'forum/guides/' };
/**
 * 论坛内置表情包的图片（#286）：同样是仓库里的源文件，不是构建产物。对象键 forum/stickers/<图片内容 sha256>.webp
 * （scripts/sticker-manifest.mjs 的 stickerObjectKey）：内容相同键相同，内容变了就是新键，只增不改的上传不会撞键。
 * 服务端按 manifest.json 决定哪些表情图片走 CDN（app/server/src/lib/sticker-manifest.ts），所以 collectStickers
 * 要求清单与目录一致，不一致整次上传失败，不会出现清单里有、CDN 上没有的地址。
 */
export const STICKERS = { dir: 'app/server/assets/stickers', mount: 'forum/stickers/' };
/**
 * 公开旧帖里显式标记 `cdn: true` 的图片（#304）：导出器把正文地址写成这个前缀，
 * 这里只收正文实际引用的 WebP，未标记的同源图片与 drop 的私人截图都不会进入公开桶。
 */
export const PUBLISHED_IMAGES = { dir: 'app/forum/public/published', topics: 'app/forum/content/published/topics.json', mount: 'forum/published/' };
const KEY_RE = new RegExp(`^${STATIC_CDN_PREFIX.replaceAll('/', '\\/')}(?:assets|console-assets|forum\\/_nuxt|forum\\/guides|forum\\/stickers|forum\\/published)\\/[A-Za-z0-9_./-]+$`);

/**
 * 前缀守卫：每个要写的键都过这一关。只能是 static/site/ 下三个产物目录与三个源文件目录
 * （forum/guides、forum/stickers、forum/published）里的文件，
 */
export function assertKey(key) {
  const ok = typeof key === 'string'
    && key.length <= 300
    && key.startsWith(STATIC_CDN_PREFIX)
    && KEY_RE.test(key)
    && key.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
  if (!ok) throw new Error(`拒绝写入 ${JSON.stringify(key)}：只能写 ${STATIC_CDN_PREFIX}{assets,console-assets,forum/_nuxt,forum/guides,forum/stickers,forum/published}/ 下的文件`);
  return assertStorageKey(key);
}

/**
 * 产物目录里（相对 assets/、console-assets/、_nuxt/）的文件名，必须是构建配置实际产出的形状，8 位哈希是 Rolldown/Rollup
 * 的 base64url 字符。只认这几种，别的名字（manifest.json、readme.js、子目录……）都拒绝：
 *   - Vite（官网、控制台，平铺）：<name>-<hash>.<ext>，例 portal-pdTh_Fhq.js、nunito-latin-400-normal-r8SDr6Up.woff2；
 *   - Nuxt（论坛，@nuxt/vite-builder 的 [hash].js 与 <name>.[hash].[ext]）：<hash>.js，或 <name>.<hash>.<ext>（entry.<hash>.css、logo.<hash>.png）；
 *   - Nuxt 每次构建一个的清单 builds/meta/<构建 id>.json：构建 id 是随机 UUID，每次构建都是新键，只增不改没有冲突。
 * 名字的形状只能挡住形状不对的文件：my-template.js 与 name-<8 位哈希>.js 形状相同，而真实的哈希也可能全是小写字母
 * （论坛现在的产物里就有 sok5vuyt.js），按「像不像随机串」去猜会随机挡下正常的构建。所以另有一道：产物目录里的
 * 文件如果在源码的 public 目录里有同名同路径的文件（PUBLIC_DIRS），就是构建时原样复制过去的、不带哈希，一律拒绝。
 */
const HASH = '[A-Za-z0-9_-]{8}';
const NAME = '[A-Za-z0-9_.-]+';
const HASHED_NAMES = {
  web: new RegExp(`^${NAME}-${HASH}\\.[a-z0-9]+$`),
  forum: new RegExp(`^(?:${HASH}\\.js|${NAME}\\.${HASH}\\.[a-z0-9]+|builds\\/meta\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.json)$`),
};
/** Nuxt 的「最新构建」指针：文件名固定、内容每次都变，不能上传（论坛在开关打开时也不再读它）。 */
const NUXT_LATEST = 'builds/latest.json';
/**
 * 构建时原样复制进站点根的源码目录（相对仓库根）：官网 Vite 的 publicDir、论坛 Nuxt 的 public/；控制台现在是
 * publicDir: false，它的默认目录也列上，免得以后打开时漏掉。这里的 assets/、console-assets/、_nuxt/ 下的文件会
 * 不带哈希地出现在产物目录里。
 */
export const PUBLIC_DIRS = { web: ['app/web/public', 'app/console/public'], forum: ['app/forum/public'] };
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 浏览器按 CORS 取的类型：模块脚本、带 crossorigin 的样式表、字体、fetch 的 JSON/GLB。 */
const CORS_EXTENSIONS = new Set(['js', 'mjs', 'css', 'json', 'woff2', 'woff', 'ttf', 'otf', 'wasm', 'glb']);

export function extensionOf(name) {
  return (/\.([a-z0-9]+)$/.exec(name)?.[1] ?? '');
}

export function mimeFor(name) {
  const type = MIME[extensionOf(name)];
  if (!type) throw new Error(`不认识的文件类型：${name}（在 scripts/static-cdn.mjs 的 MIME 表里加上再上传）`);
  return type;
}

function walk(root, dir, out) {
  if (lstatSync(root).isSymbolicLink() || lstatSync(join(root, dir)).isSymbolicLink()) throw new Error(`产物目录不应是符号链接：${dir}`);
  for (const name of readdirSync(join(root, dir)).sort()) {
    const rel = `${dir}/${name}`;
    const stat = lstatSync(join(root, rel));
    if (stat.isSymbolicLink()) throw new Error(`产物里不应有符号链接：${rel}`);
    if (stat.isDirectory()) walk(root, rel, out);
    else if (stat.isFile()) out.push({ rel, size: stat.size });
    else throw new Error(`产物里有不是普通文件的条目：${rel}`);
  }
}

/**
 * 从两个站点根里挑出要上传的文件。三个产物目录必须都在；目录里除 Nuxt 的 latest.json 外，
 * 每个文件都必须是构建产出的带哈希文件（HASHED_NAMES），而且不能是从 public 目录原样复制过去的，
 * 否则整个上传失败，不悄悄跳过。
 * @param {{ web: string, forum: string }} roots
 * @param {{ publicDirs?: Record<'web' | 'forum', string[]> }} [options] public 目录的绝对路径（测试用），默认是本仓库的 PUBLIC_DIRS
 * @returns {{ file: string, key: string, size: number, mime: string }[]}
 */
export function collect(roots, { publicDirs } = {}) {
  const sources = publicDirs ?? Object.fromEntries(Object.entries(PUBLIC_DIRS).map(([site, dirs]) => [site, dirs.map(dir => join(REPO_ROOT, dir))]));
  const entries = [];
  const problems = [];
  for (const area of AREAS) {
    const root = roots[area.site];
    if (!root) throw new Error(`缺 --${area.site}`);
    let found = [];
    try { walk(root, area.dir, found); } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`${area.site} 站点根里没有 ${area.dir}/：${resolve(root)}`);
      throw error;
    }
    for (const { rel, size } of found) {
      const inner = rel.slice(area.dir.length + 1);
      if (area.site === 'forum' && inner === NUXT_LATEST) continue;
      const name = basename(inner);
      if (name.startsWith('.')) { problems.push(`${area.site}:${rel}（隐藏文件）`); continue; }
      if (!HASHED_NAMES[area.site].test(inner)) { problems.push(`${area.site}:${rel}（文件名不带内容哈希）`); continue; }
      const copied = (sources[area.site] ?? []).find(dir => existsSync(join(dir, rel)));
      if (copied) { problems.push(`${area.site}:${rel}（是 ${join(copied, rel)} 原样复制进来的，不带内容哈希）`); continue; }
      if (size > MAX_FILE_BYTES) { problems.push(`${area.site}:${rel}（${size} 字节，超过 ${MAX_FILE_BYTES}）`); continue; }
      const key = assertKey(`${STATIC_CDN_PREFIX}${area.mount}${inner}`);
      entries.push({ file: join(root, rel), key, size, mime: mimeFor(name) });
    }
  }
  if (problems.length) throw new Error(`这些文件不能上传 CDN（只传带内容哈希的构建产物）：\n  ${problems.join('\n  ')}`);
  const keys = new Set();
  for (const entry of entries) {
    if (keys.has(entry.key)) throw new Error(`对象键重复：${entry.key}`);
    keys.add(entry.key);
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}

/** 截图文件名里的哈希：sha256 的 base64url 前 8 位。 */
export function guideImageHash(buffer) {
  return b64url(createHash('sha256').update(buffer).digest()).slice(0, 8);
}

/**
 * 使用说明的截图（GUIDE_IMAGES）：目录不存在就没有；每个文件名都要是 <名字>.<哈希>.<webp|png>，哈希和内容对得上。
 * @param {string} [root] 仓库根（测试用）
 * @returns {{ file: string, key: string, size: number, mime: string }[]}
 */
export function collectGuideImages(root = REPO_ROOT) {
  const dir = join(root, GUIDE_IMAGES.dir);
  if (!existsSync(dir)) return [];
  if (lstatSync(dir).isSymbolicLink()) throw new Error('截图目录不能是符号链接');
  const problems = [];
  const entries = [];
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name);
    const stat = lstatSync(file);
    const match = /^[a-z0-9-]+\.([A-Za-z0-9_-]{8})\.(webp|png)$/.exec(name);
    if (!stat.isFile() || !match) { problems.push(`${name}（要是 <名字>.<8 位哈希>.<webp|png> 的普通文件）`); continue; }
    if (stat.size > MAX_FILE_BYTES) { problems.push(`${name}（${stat.size} 字节，超过 ${MAX_FILE_BYTES}）`); continue; }
    const hash = guideImageHash(readFileSync(file));
    if (hash !== match[1]) { problems.push(`${name}（内容哈希是 ${hash}）`); continue; }
    entries.push({ file, key: assertKey(`${STATIC_CDN_PREFIX}${GUIDE_IMAGES.mount}${name}`), size: stat.size, mime: mimeFor(name) });
  }
  if (problems.length) throw new Error(`${GUIDE_IMAGES.dir} 里这些文件不能上传：\n  ${problems.join('\n  ')}`);
  return entries;
}

/** 只收 topics.json 实际引用的旧帖 CDN 图片；文件名与内容 SHA-256 前 16 位必须一致。 */
export function collectPublishedImages(root = REPO_ROOT, base = staticCdnPrefixURL()) {
  const topicsFile = join(root, PUBLISHED_IMAGES.topics);
  if (!existsSync(topicsFile)) return [];
  const topics = JSON.parse(readFileSync(topicsFile, 'utf8'));
  const prefix = `${base}${PUBLISHED_IMAGES.mount}`;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = new Set();
  for (const topic of topics.topics ?? []) {
    for (const match of String(topic.content ?? '').matchAll(new RegExp(`${escaped}([^\\s)"']+)`, 'g'))) names.add(match[1]);
  }
  const entries = [];
  for (const name of [...names].sort()) {
    if (!/^[a-f0-9]{16}\.webp$/.test(name)) throw new Error(`旧帖 CDN 图片名不合合同：${name}`);
    const file = join(root, PUBLISHED_IMAGES.dir, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`旧帖 CDN 图片不是普通文件：${name}`);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`旧帖 CDN 图片超过 ${MAX_FILE_BYTES} 字节：${name}`);
    const body = readFileSync(file);
    if (sha256(body).slice(0, 16) !== name.slice(0, 16)) throw new Error(`旧帖 CDN 图片的内容哈希与文件名不符：${name}`);
    entries.push({ file, key: assertKey(`${STATIC_CDN_PREFIX}${PUBLISHED_IMAGES.mount}${name}`), size: stat.size, mime: mimeFor(name) });
  }
  return entries;
}

/**
 * 内置表情包的图片（STICKERS）：目录不存在就没有；存在就要求目录合规（scripts/sticker-manifest.mjs 的全部校验）
 * 且 manifest.json 与目录一致，每张图一个对象 forum/stickers/<sha256>.webp，同一张图在多个表情里只上传一次。
 * @param {string} [root] 仓库根（测试用）
 * @returns {{ file: string, key: string, size: number, mime: string }[]}
 */
export function collectStickers(root = REPO_ROOT) {
  const dir = join(root, STICKERS.dir);
  if (!existsSync(dir)) return [];
  if (lstatSync(dir).isSymbolicLink()) throw new Error('表情目录不能是符号链接');
  let problem;
  let manifest;
  try {
    problem = manifestProblem(dir);
    manifest = buildManifest(dir);
  } catch (error) {
    throw new Error(`${STICKERS.dir} 里的表情包不能上传：${error.message}`);
  }
  if (problem) throw new Error(`${STICKERS.dir} 里的表情包不能上传：${problem}`);
  const entries = new Map();
  for (const pack of manifest.packs) {
    for (const sticker of pack.stickers) {
      const key = assertKey(`${STATIC_CDN_PREFIX}${STICKERS.mount}${sticker.sha256}.webp`);
      if (!entries.has(key)) entries.set(key, { file: join(dir, pack.id, sticker.file), key, size: sticker.size, mime: mimeFor(sticker.file) });
    }
  }
  return [...entries.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export const b64url = buffer => Buffer.from(buffer).toString('base64url');

// ── CSP ─────────────────────────────────────────────────────────────────────

/** CSP 的某个指令（没写时退回 default-src）是否放行 url。只认 https 源表达式；主机通配一律当作不放行。 */
export function cspAllows(policy, directive, url) {
  const directives = new Map();
  for (const part of String(policy ?? '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
  }
  const sources = directives.get(directive) ?? directives.get('default-src');
  if (!policy || !sources) return false;
  const target = new URL(url);
  return sources.some(source => {
    if (source === '*' || source === 'https:') return target.protocol === 'https:';
    if (!source.startsWith('https://')) return false;
    let parsed;
    try { parsed = new URL(source); } catch { return false; }
    if (parsed.origin !== target.origin) return false;
    const path = source.slice(parsed.origin.length);
    if (!path) return true;
    return path.endsWith('/') ? target.pathname.startsWith(path) : target.pathname === path;
  });
}
const CSP_DIRECTIVES = ['script-src', 'style-src', 'font-src'];

function assertHttpsOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} 不是有效地址`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`${name} 必须是无用户信息和查询参数的 https:// 地址`);
  return url;
}

/**
 * 决定这次构建的 STATIC_CDN_BASE（CDN 源站来自 env 的 STATIC_CDN_ORIGIN）。
 * @returns {Promise<{ base: string, notices: string[], warnings: string[] }>}
 */
export async function decide({ config, token, origin, fetch = globalThis.fetch, storage, timeoutMs = 15000, env = process.env }) {
  const site = assertHttpsOrigin(origin, '--origin');
  if (site.pathname !== '/') throw new Error('--origin 只写协议和域名');
  if (token) throw new Error('七牛 token 已退役');
  if (!config && !storage) return { base: '', notices: ['没有配置 S3 凭据：这次同源构建，不上传 CDN。'], warnings: [] };
  const notices = [];
  const warnings = [];
  let csp = '';
  try {
    const response = await boundedRequest(`${site.origin}/`, { method: 'HEAD' }, { fetch, timeoutMs });
    if (response.status !== 200) throw new Error('首页非 200');
    csp = response.headers.get('content-security-policy') ?? '';
  } catch {
    return { base: '', notices, warnings: ['读不到首页 CSP：这次同源构建，不上传 CDN。'] };
  }
  const base = staticCdnPrefixURL(env);
  const missing = CSP_DIRECTIVES.filter(directive => !cspAllows(csp, directive, base));
  if (missing.length) return { base: '', notices, warnings: [`CSP 未在 ${missing.join('、')} 放行新 CDN：这次同源构建。`] };
  const adapter = storage ?? createS3Storage(config, { fetch, timeoutMs });
  const probe = await adapter.request('HEAD', `${STATIC_CDN_PREFIX}assets/cdn-probe-00000000.js`);
  if (![200, 404].includes(probe.status)) throw new Error(`S3 认证探测失败：HTTP ${probe.status}`);
  notices.push(`CSP 已放行 ${base}，S3 端点已响应；启用 CDN。`);
  return { base, notices, warnings };
}

// ── 上传与核对 ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(done => setTimeout(done, ms));
/** 公开地址是域名绑定到桶之后的 origin + 对象键，不经过 S3 端点，也没有桶名这一段。 */
const publicURL = (key, publicOrigin) => `${publicOrigin}/${key}`;

export async function uploadOne(entry, { config, storage, fetch = globalThis.fetch, attempts = 3, backoff = 300, timeoutMs = 15000 }) {
  assertKey(entry.key);
  const body = readEntry(entry);
  assertObjectContent(entry.key, body, entry.mime);
  const adapter = storage ?? createS3Storage(config, { fetch, attempts, backoff, timeoutMs });
  return adapter.ensure(entry.key, body, entry.mime);
}

/** HEAD、完整 GET SHA-256 与 Range 都走公开入口，不发送 S3 Authorization。ETag 只当作不透明值。 */
export async function verifyOne(entry, { referer, publicOrigin = staticCdnOrigin(), fetch = globalThis.fetch, attempts = 3, backoff = 300, timeoutMs = 15000 }) {
  assertStorageKey(entry.key);
  const site = assertHttpsOrigin(referer, '--referer');
  if (site.pathname !== '/') throw new Error('--referer 必须是环境根地址');
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3 || !Number.isFinite(backoff) || backoff < 0 || backoff > 5000) throw new Error('校验重试参数超限');
  const expectedHash = entry.sha256 ?? sha256(readEntry(entry));
  const headers = { Referer: referer, Origin: site.origin, 'Accept-Encoding': 'identity' };
  const url = publicURL(entry.key, publicOrigin);
  const get = async (method, extra = {}) => {
    for (let attempt = 1; ; attempt += 1) {
      const result = await boundedRequest(url, { method, headers: { ...headers, ...extra } }, { fetch, timeoutMs });
      if ((result.status !== 429 && result.status < 500) || attempt >= attempts) return result;
      await sleep(backoff * attempt);
    }
  };
  const checkHeaders = (res, method, length) => {
    if (res.headers.get('content-length') !== String(length)) throw new Error(`${method} 长度不一致`);
    if ((res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== entry.mime) throw new Error(`${method} Content-Type 不一致`);
    const allow = res.headers.get('access-control-allow-origin');
    if (CORS_EXTENSIONS.has(extensionOf(entry.key)) && allow !== '*' && allow !== site.origin) throw new Error(`${method} Access-Control-Allow-Origin 未放行`);
    if (res.headers.get('content-encoding') && res.headers.get('content-encoding') !== 'identity') throw new Error('拒绝压缩后的校验响应');
    const cache = res.headers.get('cache-control') ?? '';
    if (/(?:^|,)\s*(?:private|no-store|no-cache)(?:[=,]|$)/i.test(cache)
      || !/(?:^|,)\s*public(?:,|$)/i.test(cache) || !/(?:^|,)\s*max-age=[1-9]\d*(?:\s*,|$)/i.test(cache)) throw new Error(`${method} Cache-Control 未允许公开长缓存`);
  };
  try {
    let fullBody;
    for (const method of ['HEAD', 'GET']) {
      const res = await get(method);
      if (res.status !== 200) throw new Error(`${method} HTTP ${res.status}`);
      checkHeaders(res, method, entry.size);
      if (method === 'GET' && (res.body.length !== entry.size || sha256(res.body) !== expectedHash)) throw new Error('完整 GET SHA-256 / 字节不一致');
      if (method === 'GET') fullBody = res.body;
    }
    if (entry.size) {
      const end = Math.min(31, entry.size - 1);
      const res = await get('GET', { Range: `bytes=0-${end}` });
      if (res.status !== 206 || res.headers.get('content-range') !== `bytes 0-${end}/${entry.size}` || res.body.length !== end + 1) throw new Error('Range 状态、长度或 Content-Range 不一致');
      checkHeaders(res, 'Range', end + 1);
      if (!res.body.equals(fullBody.subarray(0, end + 1))) throw new Error('Range 字节不一致');
    }
    return '';
  } catch (error) {
    return `${url}：${error.message.includes('http') ? '请求失败' : error.message}`;
  }
}

async function pool(items, size, task) {
  const queue = [...items];
  const results = [];
  let failure;
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (!failure && queue.length) {
      const item = queue.shift();
      try { results.push(await task(item)); } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

export async function uploadAll(entries, { config, storage, referer, publicOrigin = staticCdnOrigin(), fetch = globalThis.fetch, concurrency = 4, log = console.error, backoff = 300, timeoutMs = 15000, manifest }) {
  if (assertHttpsOrigin(referer, '--referer').pathname !== '/') throw new Error('--referer 必须是环境根地址');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('concurrency 必须在 1–8');
  const keys = new Set();
  for (const entry of entries) {
    assertKey(entry.key);
    if (keys.has(entry.key)) throw new Error('对象键重复');
    keys.add(entry.key);
    const body = readEntry(entry);
    assertObjectContent(entry.key, body, entry.mime);
    entry.sha256 = sha256(body);
  }
  if (manifest) {
    validateReleaseManifest(manifest);
    if (manifest.objects.length !== entries.length || manifest.objects.some(object => !entries.some(entry => entry.key === object.key && entry.sha256 === object.sha256 && entry.size === object.bytes && entry.mime === object.content_type))) throw new Error('清单与上传对象不一致');
  }
  const adapter = storage ?? createS3Storage(config, { fetch, backoff, timeoutMs });
  const counts = { stored: 0, exists: 0 };
  await pool(entries, concurrency, async entry => { counts[await uploadOne(entry, { storage: adapter, fetch, backoff, timeoutMs })] += 1; });
  const problems = (await pool(entries, concurrency, entry => verifyOne(entry, { referer, publicOrigin, fetch, backoff, timeoutMs }))).filter(Boolean);
  if (problems.length) throw new Error(`CDN 核对不通过：\n${problems.sort().join('\n')}`);
  if (manifest) {
    const key = releaseKey(manifest);
    const body = Buffer.from(manifestText(manifest));
    await adapter.ensure(key, body, 'application/json');
    const problem = await verifyOne({ key, size: body.length, mime: 'application/json', sha256: sha256(body) }, { referer, publicOrigin, fetch, backoff, timeoutMs });
    if (problem) throw new Error(problem);
  }
  const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  log(`CDN 完整核对：${entries.length} 个文件，${bytes} 字节；新写入 ${counts.stored}，已存在逐字一致 ${counts.exists}；HEAD/GET SHA-256/Range/MIME/CORS 一致`);
  return { ...counts, total: entries.length, bytes, ...(manifest ? { manifestKey: releaseKey(manifest) } : {}) };
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const identity = ['--environment', '--commit', '--generated-at'];
  const allowed = {
    decide: ['--origin'], plan: ['--web', '--forum', '--manifest', '--content-index', ...identity],
    upload: ['--web', '--forum', '--referer', '--manifest', '--content-index', ...identity],
    'verify-manifest': ['--manifest', '--referer'],
  }[command];
  if (!allowed) throw new Error(`用法：${USAGE}；旧 mint-token 已退役`);
  const options = { command };
  for (let i = 0; i < rest.length; i += 2) {
    const [key, value] = [rest[i], rest[i + 1]];
    if (!allowed.includes(key)) throw new Error(`${command} 不认识参数 ${key}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} 缺值`);
    const name = key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (options[name] !== undefined) throw new Error(`参数重复：${key}`);
    options[name] = value;
  }
  const required = { decide: ['origin'], plan: ['web', 'forum'], upload: ['web', 'forum', 'referer', 'environment', 'commit', 'generatedAt'], 'verify-manifest': ['manifest', 'referer'] }[command];
  for (const name of required) if (!options[name]) throw new Error(`${command} 缺 --${name}`);
  return options;
}

export async function main(argv, { env = process.env, stdout = process.stdout, log = console.error, fetch = globalThis.fetch, storage, publicOrigin, sourceRoot = REPO_ROOT } = {}) {
  const options = parseArgs(argv);
  if (options.command === 'decide') {
    const result = await decide({ config: readS3Config(env), origin: options.origin, fetch, storage, env });
    for (const line of [...result.notices, ...result.warnings]) log(line);
    stdout.write(`base=${result.base}\n`);
    return result;
  }
  if (options.command === 'verify-manifest') {
    const text = readFileSync(options.manifest, 'utf8');
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('清单 JSON 无效'); }
    const manifest = validateReleaseManifest(parsed);
    for (const object of manifest.objects) {
      const problem = await verifyOne({ key: object.key, sha256: object.sha256, size: object.bytes, mime: object.content_type }, { referer: options.referer, publicOrigin: publicOrigin ?? staticCdnOrigin(env), fetch });
      if (problem) throw new Error(problem);
    }
    log(`恢复追溯核对：${manifest.environment}/${manifest.commit}，${manifest.objects.length} 个对象完整 GET SHA-256 一致`);
    return { manifest };
  }
  const config = options.command === 'upload' ? readS3Config(env) : undefined;
  if (options.command === 'upload' && !config && !storage) throw new Error('没有完整 S3 凭据：不能上传');
  const entries = [...collect({ web: options.web, forum: options.forum }), ...collectGuideImages(sourceRoot), ...collectStickers(sourceRoot), ...collectPublishedImages(sourceRoot, staticCdnPrefixURL(env))];
  let manifest;
  const outputs = [options.manifest, options.contentIndex].filter(Boolean).map(file => resolve(file));
  if (new Set(outputs).size !== outputs.length || outputs.some(file => existsSync(file))) throw new Error('本地清单或私有索引已存在，拒绝覆盖');
  const writeOutputs = () => {
    if (options.manifest) writeFileSync(options.manifest, manifestText(manifest), { flag: 'wx', mode: 0o600 });
    if (options.contentIndex) writeFileSync(options.contentIndex, JSON.stringify(contentIndex(manifest), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  };
  if (options.command === 'upload' || options.manifest || options.contentIndex || options.environment || options.commit || options.generatedAt) {
    manifest = createReleaseManifest(entries, { ...options, sourceRoot });
  }
  if (options.command === 'plan') {
    writeOutputs();
    for (const entry of entries) stdout.write(`${entry.key}\t${entry.size}\t${entry.mime}\n`);
    log(`共 ${entries.length} 个文件，全部在 ${STATIC_CDN_PREFIX} 下；内置表情图片 ${entries.filter(entry => entry.key.startsWith(`${STATIC_CDN_PREFIX}${STICKERS.mount}`)).length} 个对象`);
    return { entries, manifest };
  }
  const result = await uploadAll(entries, { config, storage, referer: options.referer, publicOrigin: publicOrigin ?? staticCdnOrigin(env), concurrency: readUploadConcurrency(env), fetch, log, manifest });
  writeOutputs();
  return result;
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try { return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url; } catch { return false; }
}
if (isDirectRun()) main(process.argv.slice(2)).catch(error => { console.error(`[static-cdn] 失败：${error.message}`); process.exit(1); });

export function originPathOf(key) {
  assertKey(key);
  return `/${key.slice(STATIC_CDN_PREFIX.length)}`;
}
