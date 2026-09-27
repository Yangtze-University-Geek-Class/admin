#!/usr/bin/env node
// 带内容哈希的静态文件上传七牛 CDN（#146）。开关与地址的规则在 scripts/static-cdn-base.mjs；
// 部署工作流（.github/workflows/deploy-*.yml）的 cdn-plan job 用它决定开关，build job 用 plan 列清单，
// cdn-upload job 用它上传并核对；流程见 docs/ops/CICD.md「静态资源 CDN」。
//
//   node scripts/static-cdn.mjs decide --origin <https://环境域名>
//        工作流用：stdout 只输出一行 base=<STATIC_CDN_BASE 或空>，追加进 $GITHUB_OUTPUT。
//        没有 STATIC_CDN_UPLOAD_TOKEN → 空（同源构建，不上传）；token 的策略不对 → 失败；
//        环境线上的 CSP 还没放行 CDN（宿主 nginx 模板没重新安装）→ 告警并退回空。
//   node scripts/static-cdn.mjs plan --web <web 站点根> --forum <forum 站点根>
//        只读、不联网：列出要上传的文件和对象键。
//   node scripts/static-cdn.mjs upload --web <web 站点根> --forum <forum 站点根> --referer <https://环境域名/>
//        逐个上传（insertOnly），再经 CDN 带 Referer 与 Origin 逐个 HEAD 核对：200、ETag 等于本地七牛 qetag、
//        长度、Content-Type、JS/CSS/字体的 CORS 头。任一不符即非零退出，部署不会开始。
//   node scripts/static-cdn.mjs mint-token [--env-file <路径>] [--days 180]
//        所有者本机用：用账号 AK/SK 签一个上传 token（只能写 yzgc/static/site/ 前缀、只增不改、有到期时间），
//        只写进管道：node scripts/static-cdn.mjs mint-token --env-file ~/.claude/secrets/.env.cloud \
//                      | gh secret set STATIC_CDN_UPLOAD_TOKEN --env static-cdn --repo <owner/repo>
//
// 站点根是镜像里的 /usr/share/nginx/html（工作流用 docker cp 拷出来）：web 镜像里只取 assets/ 与 console-assets/，
// forum 镜像里只取 _nuxt/（对象键加 forum/ 前缀，与 /forum/_nuxt/ 对应）。
//
// 凭据：上传 token 只从环境变量 STATIC_CDN_UPLOAD_TOKEN 读，不进命令行、不打印；报错只提策略字段，不回显 token。
// 本机证明用的 --owner-env-file 在进程里用 AK/SK 现签一个 1 小时的同策略 token，CI 里拒绝使用。
// 本脚本只调用七牛的表单上传接口，没有任何删除、覆盖、改元信息的调用；token 的策略本身也不允许覆盖。
import { createHash, createHmac } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STATIC_CDN_BASE, STATIC_CDN_BUCKET, STATIC_CDN_ORIGIN, STATIC_CDN_PREFIX } from './static-cdn-base.mjs';

/** 华南（z2）存储区的表单上传地址，与 bucket crosery 所在区域一致。 */
export const UPLOAD_HOST = 'https://up-z2.qiniup.com';
/** 单个文件上限，写进 token 策略（fsizeLimit）；现在最大的产物不到 1MB。 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** decide 在 token 剩余有效期不足这么久时告警，提醒所有者重签。 */
export const RENEW_WARNING_SECONDS = 30 * 24 * 3600;
/** token 最长有效期（366 天）：mint-token 签不出更长的；到期时间比现在晚这么久以上的 token 一律拒绝。 */
export const MAX_TOKEN_SECONDS = 366 * 24 * 3600;
/**
 * decide 要求 token 至少还剩这么久：它之后 build job 最长 60 分钟、cdn-upload 最长 20 分钟（两条部署工作流的
 * timeout-minutes），再留 10 分钟给 job 之间的排队。剩得更少就在构建前失败，不带着上传时会过期的 token 去构建。
 */
export const DECIDE_MIN_REMAINING_SECONDS = 90 * 60;
/** upload 开始时 token 至少还剩这么久：cdn-upload job 最长 20 分钟。 */
export const UPLOAD_MIN_REMAINING_SECONDS = 20 * 60;
const TOKEN_ENV = 'STATIC_CDN_UPLOAD_TOKEN';
const USAGE = 'node scripts/static-cdn.mjs decide --origin <https://…> | plan --web <目录> --forum <目录> | upload --web <目录> --forum <目录> --referer <https://…/> | mint-token [--env-file <路径>] [--days 180]';

if (!STATIC_CDN_PREFIX.startsWith('yzgc/static/') || !STATIC_CDN_PREFIX.endsWith('/')) {
  throw new Error(`上传前缀必须在 yzgc/static/ 下并以 / 结尾：${STATIC_CDN_PREFIX}`);
}

// ── 对象键 ─────────────────────────────────────────────────────────────────

/** 源站目录 → CDN 对象键前缀（在 STATIC_CDN_PREFIX 之后）。只有这三处是带哈希的构建产物。 */
export const AREAS = [
  { site: 'web', dir: 'assets', mount: 'assets/' },
  { site: 'web', dir: 'console-assets', mount: 'console-assets/' },
  { site: 'forum', dir: '_nuxt', mount: 'forum/_nuxt/' },
];
const KEY_RE = new RegExp(`^${STATIC_CDN_PREFIX.replaceAll('/', '\\/')}(?:assets|console-assets|forum\\/_nuxt)\\/[A-Za-z0-9_./-]+$`);

/**
 * 前缀守卫：每个要写的键都过这一关。只能是 yzgc/static/site/ 下三个产物目录里的文件，
 * 不能有空段、`.`、`..`，不能超长。token 的策略在七牛那边再限一次前缀。
 */
export function assertKey(key) {
  const ok = typeof key === 'string'
    && key.length <= 300
    && key.startsWith(STATIC_CDN_PREFIX)
    && KEY_RE.test(key)
    && key.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
  if (!ok) throw new Error(`拒绝写入 ${JSON.stringify(key)}：只能写 ${STATIC_CDN_PREFIX}{assets,console-assets,forum/_nuxt}/ 下的文件`);
  return key;
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

const MIME = {
  js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', ico: 'image/x-icon', wasm: 'application/wasm', glb: 'model/gltf-binary',
};
/** 浏览器按 CORS 取的类型：模块脚本、带 crossorigin 的样式表、字体、fetch 的 JSON。 */
const CORS_EXTENSIONS = new Set(['js', 'mjs', 'css', 'json', 'woff2', 'woff', 'ttf', 'otf', 'wasm']);

export function extensionOf(name) {
  return (/\.([a-z0-9]+)$/.exec(name)?.[1] ?? '');
}

export function mimeFor(name) {
  const type = MIME[extensionOf(name)];
  if (!type) throw new Error(`不认识的文件类型：${name}（在 scripts/static-cdn.mjs 的 MIME 表里加上再上传）`);
  return type;
}

/** 七牛的 ETag（qetag）：≤4MB 是 0x16 + sha1(内容)；更大的按 4MB 分块，0x96 + sha1(各块 sha1 相连)。 */
export function qetag(buffer) {
  const BLOCK = 4 * 1024 * 1024;
  const sha1 = data => createHash('sha1').update(data).digest();
  let tagged;
  if (buffer.length <= BLOCK) tagged = Buffer.concat([Buffer.from([0x16]), sha1(buffer)]);
  else {
    const blocks = [];
    for (let offset = 0; offset < buffer.length; offset += BLOCK) blocks.push(sha1(buffer.subarray(offset, offset + BLOCK)));
    tagged = Buffer.concat([Buffer.from([0x96]), sha1(Buffer.concat(blocks))]);
  }
  return b64url(tagged);
}

function walk(root, dir, out) {
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

// ── 上传 token ──────────────────────────────────────────────────────────────

export function b64url(buffer) {
  return Buffer.from(buffer).toString('base64').replaceAll('+', '-').replaceAll('/', '_');
}

/** token 允许出现的策略字段；多出任何字段（saveKey、回调、持久化处理……）都拒绝。 */
const POLICY_FIELDS = new Set(['scope', 'isPrefixalScope', 'insertOnly', 'deadline', 'fsizeLimit']);

/** 上传 token 的策略：只能写 crosery:yzgc/static/site/ 前缀（isPrefixalScope），只增不改（insertOnly），到期作废。 */
export function uploadPolicy({ now = Date.now(), seconds }) {
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > MAX_TOKEN_SECONDS) throw new Error('token 有效期要在 1 分钟到 366 天之间');
  return {
    scope: `${STATIC_CDN_BUCKET}:${STATIC_CDN_PREFIX}`,
    isPrefixalScope: 1,
    insertOnly: 1,
    deadline: Math.floor(now / 1000) + seconds,
    fsizeLimit: MAX_FILE_BYTES,
  };
}

/** 七牛上传 token：AK:urlsafe_b64(hmac_sha1(SK, 编码后的策略)):编码后的策略。 */
export function signUploadToken(policy, { accessKey, secretKey }) {
  if (!accessKey || !secretKey) throw new Error('缺少 QINIU_ACCESS_KEY / QINIU_SECRET_KEY');
  const encoded = b64url(JSON.stringify(policy));
  const signature = b64url(createHmac('sha1', secretKey).update(encoded).digest());
  return `${accessKey}:${signature}:${encoded}`;
}

/**
 * 读出 token 里的策略并核对：只要本脚本签出来的那种 token，别的一律拒绝（失败关闭）。
 * 到期时间要在 now + minRemainingSeconds 之后、now + 366 天之内。报错只说哪个字段不对，不回显 token。
 * @param {string} token
 * @param {number} [now]
 * @param {number} [minRemainingSeconds] decide 用默认的 90 分钟，upload 用 20 分钟
 */
export function readUploadPolicy(token, now = Date.now(), minRemainingSeconds = DECIDE_MIN_REMAINING_SECONDS) {
  const parts = String(token ?? '').trim().split(':');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_=-]+$/.test(part))) throw new Error(`${TOKEN_ENV} 不是七牛上传 token 的格式（AK:签名:策略）`);
  let policy;
  try { policy = JSON.parse(Buffer.from(parts[2], 'base64url').toString('utf8')); } catch { throw new Error(`${TOKEN_ENV} 的策略段不是 JSON`); }
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error(`${TOKEN_ENV} 的策略段不是对象`);
  const extra = Object.keys(policy).filter(field => !POLICY_FIELDS.has(field));
  const problems = [];
  if (extra.length) problems.push(`多出字段 ${extra.join('、')}`);
  if (policy.scope !== `${STATIC_CDN_BUCKET}:${STATIC_CDN_PREFIX}`) problems.push(`scope 必须是 ${STATIC_CDN_BUCKET}:${STATIC_CDN_PREFIX}（现在是 ${JSON.stringify(policy.scope)}）`);
  if (policy.isPrefixalScope !== 1) problems.push('isPrefixalScope 必须是 1');
  if (policy.insertOnly !== 1) problems.push('insertOnly 必须是 1');
  if (!Number.isInteger(policy.deadline)) problems.push('缺 deadline');
  else if (policy.deadline * 1000 <= now + minRemainingSeconds * 1000) problems.push(`已过期或 ${minRemainingSeconds / 60} 分钟内过期（deadline ${new Date(policy.deadline * 1000).toISOString()}）`);
  else if (policy.deadline * 1000 > now + MAX_TOKEN_SECONDS * 1000) problems.push(`到期时间太远（deadline ${new Date(policy.deadline * 1000).toISOString()}），有效期最多 ${MAX_TOKEN_SECONDS / 86400} 天`);
  if (policy.fsizeLimit !== undefined && (!Number.isInteger(policy.fsizeLimit) || policy.fsizeLimit <= 0 || policy.fsizeLimit > MAX_FILE_BYTES)) problems.push(`fsizeLimit 必须是不超过 ${MAX_FILE_BYTES} 的正整数`);
  if (problems.length) throw new Error(`${TOKEN_ENV} 的策略不对：${problems.join('；')}。按 docs/ops/CICD.md「静态资源 CDN」重签`);
  return policy;
}

/** 解析 KEY=VALUE 形式的 env 文件（与所有者宣传片脚本的读法相同），只取需要的键。 */
export function parseEnvFile(text) {
  return Object.fromEntries(
    text.split('\n')
      .map(line => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]),
  );
}

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
  try { url = new URL(value); } catch { throw new Error(`${name} 不是地址：${JSON.stringify(value)}`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`${name} 必须是 https:// 地址：${JSON.stringify(value)}`);
  return url;
}

/**
 * 决定这次构建的 STATIC_CDN_BASE。
 * @returns {Promise<{ base: string, notices: string[], warnings: string[] }>}
 */
export async function decide({ token, origin, now = Date.now(), fetch = globalThis.fetch }) {
  const site = assertHttpsOrigin(origin, '--origin');
  if (site.pathname !== '/') throw new Error(`--origin 只写协议和域名：${origin}`);
  if (!String(token ?? '').trim()) return { base: '', notices: [`没有配置 ${TOKEN_ENV}：这次同源构建，不上传 CDN。`], warnings: [] };
  const policy = readUploadPolicy(token, now);
  const notices = [`上传 token 策略核对通过：scope=${policy.scope}，只增不改，到期 ${new Date(policy.deadline * 1000).toISOString()}`];
  const warnings = [];
  if (policy.deadline * 1000 - now < RENEW_WARNING_SECONDS * 1000) warnings.push(`${TOKEN_ENV} 将在 ${new Date(policy.deadline * 1000).toISOString()} 到期，请所有者重签（docs/ops/CICD.md「静态资源 CDN」）。`);
  let csp = '';
  try {
    const res = await fetch(`${site.origin}/`, { method: 'HEAD', redirect: 'manual' });
    csp = res.headers.get('content-security-policy') ?? '';
  } catch (error) {
    warnings.push(`读不到 ${site.origin}/ 的 CSP（${error.message}）：这次同源构建，不上传 CDN。`);
    return { base: '', notices, warnings };
  }
  const missing = CSP_DIRECTIVES.filter(directive => !cspAllows(csp, directive, STATIC_CDN_BASE));
  if (missing.length) {
    warnings.push(`${site.origin} 线上的 CSP 还没在 ${missing.join('、')} 放行 ${STATIC_CDN_BASE}：先把入库的 deploy/nginx 模板装到宿主机（docs/ops/DEPLOY.md），这次同源构建，不上传 CDN。`);
    return { base: '', notices, warnings };
  }
  notices.push(`${site.origin} 的 CSP 已放行 ${STATIC_CDN_BASE}：这次带哈希的静态文件从 CDN 加载。`);
  return { base: STATIC_CDN_BASE, notices, warnings };
}

// ── 上传与核对 ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(done => setTimeout(done, ms));

/** 只截取七牛返回里的错误说明，避免把整段响应（可能很长）打进日志。 */
function brief(text) {
  return String(text ?? '').replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * 表单上传一个文件。200：七牛返回的 hash 必须等于本地 qetag（同键同内容时七牛同样返回 200）；
 * 614：键已存在且内容不同，交给后面的 CDN 核对判定失败。网络错误、429、5xx 重试两次。
 */
export async function uploadOne(entry, { token, fetch = globalThis.fetch, attempts = 3, backoff = 1500 }) {
  assertKey(entry.key);
  const body = readFileSync(entry.file);
  entry.etag ??= qetag(body);
  for (let attempt = 1; ; attempt += 1) {
    const form = new FormData();
    form.set('token', token);
    form.set('key', entry.key);
    form.set('file', new Blob([body], { type: entry.mime }), basename(entry.key));
    let res;
    try {
      res = await fetch(UPLOAD_HOST, { method: 'POST', body: form });
    } catch (error) {
      if (attempt < attempts) { await sleep(backoff * attempt); continue; }
      throw new Error(`上传 ${entry.key} 失败：${error.message}`);
    }
    const text = await res.text();
    if (res.status === 200) {
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(`上传 ${entry.key}：七牛返回的不是 JSON`); }
      if (json.key !== entry.key || json.hash !== entry.etag) throw new Error(`上传 ${entry.key}：七牛记下的 key/hash（${json.key} ${json.hash}）与本地（${entry.etag}）不一致`);
      return 'stored';
    }
    if (res.status === 614) return 'exists';
    if ((res.status === 429 || res.status >= 500) && attempt < attempts) { await sleep(backoff * attempt); continue; }
    throw new Error(`上传 ${entry.key} 失败：HTTP ${res.status} ${brief(text)}`);
  }
}

/** 经 CDN 核对一个文件：带环境域名的 Referer 与 Origin，关掉压缩，这样长度与 ETag 都是原文件的。 */
export async function verifyOne(entry, { referer, fetch = globalThis.fetch, attempts = 3, backoff = 2000 }) {
  const origin = new URL(referer).origin;
  const url = `${STATIC_CDN_ORIGIN}/${entry.key}`;
  let problems = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    problems = [];
    let res;
    try {
      res = await fetch(url, { method: 'HEAD', headers: { Referer: referer, Origin: origin, 'Accept-Encoding': 'identity' } });
    } catch (error) {
      problems.push(`请求失败 ${error.message}`);
    }
    if (res) {
      const etag = (res.headers.get('etag') ?? '').replace(/^W\//, '').replaceAll('"', '');
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const length = res.headers.get('content-length');
      const allow = res.headers.get('access-control-allow-origin');
      if (res.status !== 200) problems.push(`HTTP ${res.status}`);
      else {
        if (etag !== entry.etag) problems.push(`ETag ${etag || '(无)'} ≠ 本地 ${entry.etag}（CDN 上同名文件内容不同）`);
        if (length !== null && Number(length) !== entry.size) problems.push(`长度 ${length} ≠ ${entry.size}`);
        if (type !== entry.mime) problems.push(`Content-Type ${type || '(无)'} ≠ ${entry.mime}`);
        if (CORS_EXTENSIONS.has(extensionOf(entry.key)) && allow !== '*' && allow !== origin) problems.push(`没有放行 ${origin} 的 Access-Control-Allow-Origin（${allow ?? '无'}）`);
      }
      // 只有「还没回源到」这类暂时状态才值得再问一次；内容不一致重试也不会变。
      if (!problems.length || (res.status === 200 && problems.some(problem => problem.startsWith('ETag')))) break;
    }
    if (attempt < attempts) await sleep(backoff * attempt);
  }
  return problems.length ? `${url}：${problems.join('；')}` : '';
}

async function pool(items, size, task) {
  const queue = [...items];
  const results = [];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) results.push(await task(item));
  }));
  return results;
}

/**
 * 上传并核对全部文件。返回汇总；任何上传错误直接抛出，核对不通过也抛出（列出每个问题）。
 * @param {{ file: string, key: string, size: number, mime: string, etag?: string }[]} entries
 */
export async function uploadAll(entries, { token, referer, fetch = globalThis.fetch, concurrency = 8, log = console.error, backoff, now = Date.now() }) {
  readUploadPolicy(token, now, UPLOAD_MIN_REMAINING_SECONDS);
  assertHttpsOrigin(referer, '--referer');
  for (const entry of entries) {
    assertKey(entry.key);
    entry.etag ??= qetag(readFileSync(entry.file));
  }
  const counts = { stored: 0, exists: 0 };
  let done = 0;
  await pool(entries, concurrency, async entry => {
    counts[await uploadOne(entry, { token, fetch, ...(backoff === undefined ? {} : { backoff }) })] += 1;
    done += 1;
    if (done % 50 === 0 || done === entries.length) log(`已上传 ${done}/${entries.length}`);
  });
  const problems = (await pool(entries, concurrency, entry => verifyOne(entry, { referer, fetch, ...(backoff === undefined ? {} : { backoff }) }))).filter(Boolean);
  if (problems.length) throw new Error(`CDN 核对不通过（${problems.length}/${entries.length}）：\n  ${problems.sort().join('\n  ')}`);
  const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  log(`CDN 核对通过：${entries.length} 个文件（${(bytes / 1048576).toFixed(2)} MiB），七牛新写入或同内容确认 ${counts.stored} 个，键已存在 ${counts.exists} 个；经 ${referer} 取回的状态、ETag、长度、类型、CORS 全部一致`);
  return { ...counts, total: entries.length, bytes };
}

// ── 命令行 ────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const allowed = {
    decide: ['--origin'],
    plan: ['--web', '--forum'],
    upload: ['--web', '--forum', '--referer', '--owner-env-file'],
    'mint-token': ['--env-file', '--days'],
  }[command];
  if (!allowed) throw new Error(`用法：${USAGE}`);
  const options = { command };
  for (let i = 0; i < rest.length; i += 2) {
    const [key, value] = [rest[i], rest[i + 1]];
    if (!allowed.includes(key)) throw new Error(`${command} 不认识参数 ${key}；用法：${USAGE}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${key} 缺值`);
    options[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  const required = { decide: ['origin'], plan: ['web', 'forum'], upload: ['web', 'forum', 'referer'], 'mint-token': [] }[command];
  for (const key of required) if (!options[key]) throw new Error(`${command} 缺 --${key}；用法：${USAGE}`);
  return options;
}

function readOwnerKeys(path, env) {
  const source = path ? parseEnvFile(readFileSync(path, 'utf8')) : env;
  return { accessKey: source.QINIU_ACCESS_KEY, secretKey: source.QINIU_SECRET_KEY };
}

export async function main(argv, { env = process.env, stdout = process.stdout, log = console.error, fetch = globalThis.fetch, now = Date.now() } = {}) {
  const options = parseArgs(argv);
  if (options.command === 'decide') {
    const result = await decide({ token: env[TOKEN_ENV], origin: options.origin, now, fetch });
    for (const line of result.notices) log(line);
    for (const line of result.warnings) log(env.GITHUB_ACTIONS ? `::warning title=静态资源 CDN::${line}` : `警告：${line}`);
    stdout.write(`base=${result.base}\n`);
    return result;
  }
  if (options.command === 'plan') {
    const entries = collect({ web: options.web, forum: options.forum });
    for (const entry of entries) stdout.write(`${entry.key}\t${entry.size}\t${entry.mime}\n`);
    const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    log(`共 ${entries.length} 个文件，${(bytes / 1048576).toFixed(2)} MiB，全部在 ${STATIC_CDN_PREFIX} 下`);
    return { entries };
  }
  if (options.command === 'upload') {
    let token = env[TOKEN_ENV];
    if (options.ownerEnvFile) {
      if (env.GITHUB_ACTIONS || env.CI) throw new Error('--owner-env-file 只给所有者本机证明用；CI 只用 STATIC_CDN_UPLOAD_TOKEN');
      token = signUploadToken(uploadPolicy({ now, seconds: 3600 }), readOwnerKeys(options.ownerEnvFile, {}));
      log('用 --owner-env-file 的 AK/SK 在进程里签了一个 1 小时的上传 token（同样只能写 yzgc/static/site/、只增不改），不落盘、不打印');
    }
    if (!String(token ?? '').trim()) throw new Error(`没有 ${TOKEN_ENV}：不能上传（工作流在没有凭据时根本不会走到这一步）`);
    const entries = collect({ web: options.web, forum: options.forum });
    log(`准备上传 ${entries.length} 个文件到 ${STATIC_CDN_BASE}`);
    return uploadAll(entries, { token, referer: options.referer, fetch, log, now });
  }
  // mint-token
  if (stdout.isTTY) throw new Error('token 只写进管道（例如 | gh secret set STATIC_CDN_UPLOAD_TOKEN --env static-cdn），不往终端打印');
  const days = options.days === undefined ? 180 : Number(options.days);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error('--days 要在 1 到 366 之间');
  const policy = uploadPolicy({ now, seconds: days * 24 * 3600 });
  const token = signUploadToken(policy, readOwnerKeys(options.envFile, env));
  readUploadPolicy(token, now);
  stdout.write(token);
  log(`已签发上传 token：scope=${policy.scope}，isPrefixalScope=1，insertOnly=1，单文件上限 ${policy.fsizeLimit} 字节，到期 ${new Date(policy.deadline * 1000).toISOString()}`);
  return { policy };
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url;
  } catch {
    return false;
  }
}
if (isDirectRun()) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`[static-cdn] 失败：${error.message}`);
    process.exit(1);
  });
}

// 供测试核对：键与源站路径一一对应（源站 /X ↔ 键 yzgc/static/site/X）。
export function originPathOf(key) {
  assertKey(key);
  return `/${key.slice(STATIC_CDN_PREFIX.length)}`;
}
