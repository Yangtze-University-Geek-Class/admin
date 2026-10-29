#!/usr/bin/env node
// Garage 私有归档适配器：复用 rclone 的 S3/SigV4 实现，只新增、完整读回核验，不提供覆盖命令。
// 唯一的删除入口是 prune-runs：备份桶在一台小机器上，空间有限，只清理备份角色名下早于保留窗口的整日 run。
import { createHash } from 'node:crypto';
import {
  createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ENDPOINT = 'https://cdn.yangtzeu.work';
const REGION = 'garage';
const REMOTE = 'geekgarage';
const ROLES = Object.freeze({
  'gitlab-backup': {
    bucket: 'geek-backup', access: 'GITLAB_BACKUP_S3_ACCESS_KEY_ID', secret: 'GITLAB_BACKUP_S3_SECRET_ACCESS_KEY',
    key: /^gitlab\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/,
    prefix: /^gitlab\/(?:\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/?)?$/,
  },
  'gitlab-preview-backup': {
    bucket: 'geek-preview-private', access: 'GITLAB_PREVIEW_BACKUP_S3_ACCESS_KEY_ID', secret: 'GITLAB_PREVIEW_BACKUP_S3_SECRET_ACCESS_KEY',
    key: /^gitlab\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/,
    prefix: /^gitlab\/(?:\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/?)?$/,
  },
  'platform-preview-backup': {
    bucket: 'geek-backup', access: 'PLATFORM_PREVIEW_BACKUP_S3_ACCESS_KEY_ID', secret: 'PLATFORM_PREVIEW_BACKUP_S3_SECRET_ACCESS_KEY',
    key: /^platform\/preview\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/,
    prefix: /^platform\/preview\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/$/,
  },
  'platform-production-backup': {
    bucket: 'geek-backup', access: 'PLATFORM_PRODUCTION_BACKUP_S3_ACCESS_KEY_ID', secret: 'PLATFORM_PRODUCTION_BACKUP_S3_SECRET_ACCESS_KEY',
    key: /^platform\/production\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/,
    prefix: /^platform\/production\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/$/,
  },
  'preview-content-index': {
    bucket: 'geek-preview-private', access: 'PREVIEW_PRIVATE_INDEX_S3_ACCESS_KEY_ID', secret: 'PREVIEW_PRIVATE_INDEX_S3_SECRET_ACCESS_KEY',
    key: /^indexes\/content\/[0-9a-f]{40}\/sha256\.json$/,
  },
  'production-content-index': {
    bucket: 'geek-production-private', access: 'PRODUCTION_PRIVATE_INDEX_S3_ACCESS_KEY_ID', secret: 'PRODUCTION_PRIVATE_INDEX_S3_SECRET_ACCESS_KEY',
    key: /^indexes\/content\/[0-9a-f]{40}\/sha256\.json$/,
  },
});

class ArchiveError extends Error {}
const requireThat = (condition, message) => { if (!condition) throw new ArchiveError(message); };

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const allowedByCommand = {
    'put-tree': ['--role', '--source', '--prefix'],
    'put-file': ['--role', '--source', '--key'],
    'get-tree': ['--role', '--prefix', '--destination'],
    'resolve-gitlab-run': ['--run', '--role'],
    'list-gitlab-runs': ['--day', '--role'],
    'prune-runs': ['--role', '--keep-dates'],
  };
  // 无值布尔开关：恢复路径必须显式要求清单校验，缺省下载保持通用；清理缺省只列清单，--apply 才删除
  const flagsByCommand = { 'get-tree': ['--require-manifest'], 'prune-runs': ['--apply'] };
  requireThat(Object.hasOwn(allowedByCommand, command), '用法：garage-archive.mjs put-tree|put-file|get-tree|resolve-gitlab-run|list-gitlab-runs|prune-runs');
  const allowed = new Set(allowedByCommand[command]);
  const flags = new Set(flagsByCommand[command] ?? []);
  const options = Object.create(null);
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    requireThat(typeof key === 'string' && !Object.hasOwn(options, key), '参数缺失、重复或未知');
    if (flags.has(key)) { options[key] = true; continue; }
    const value = rest[index + 1];
    requireThat(allowed.has(key) && value && !value.startsWith('--'), '参数缺失、重复或未知');
    options[key] = value;
    index += 1;
  }
  const requiredByCommand = {
    'put-tree': ['--role', '--source', '--prefix'],
    'put-file': ['--role', '--source', '--key'],
    'get-tree': ['--role', '--prefix', '--destination'],
    'resolve-gitlab-run': [],
    'list-gitlab-runs': [],
    'prune-runs': ['--role'],
  };
  for (const key of requiredByCommand[command]) requireThat(options[key], `缺少 ${key}`);
  return { command, options };
}

function assertLocalPath(path, { mustExist = true } = {}) {
  requireThat(typeof path === 'string' && isAbsolute(path) && normalize(path) === path && path !== '/', '本地路径必须是规范安全绝对路径');
  const resolved = realpathSync(mustExist ? path : dirname(path));
  const checked = mustExist ? resolved : join(resolved, basename(path));
  const root = process.platform === 'darwin' && checked.startsWith('/private/') ? '/private' : sep;
  let current = root;
  const parts = checked.slice(root.length).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length - (mustExist ? 0 : 1); index += 1) {
    current = join(current, parts[index]);
    const info = lstatSync(current);
    requireThat(!info.isSymbolicLink(), '本地路径不得经过符号链接');
  }
  if (mustExist) requireThat(existsSync(checked), '本地路径不存在');
  return checked;
}

function assertObjectPath(role, key, kind = 'key') {
  requireThat(typeof key === 'string' && key.length <= 512 && !key.includes('\\') && !key.includes('%') && !key.includes('?') && !key.includes('#')
    && !key.split('/').some(part => part === '.' || part === '..'), '对象路径含非法字符');
  const pattern = kind === 'prefix' ? role.prefix : role.key;
  requireThat(pattern?.test(key), `对象${kind === 'prefix' ? '前缀' : '键'}不在角色允许范围`);
  return key;
}

function roleConfig(name, env = process.env) {
  const role = ROLES[name];
  requireThat(role, '未知归档角色');
  const access = env[role.access] ?? '';
  const secret = env[role.secret] ?? '';
  requireThat(access && !/[\s:\x00-\x1f\x7f]/.test(access), `缺少或非法 ${role.access}`);
  requireThat(secret && !/[\x00-\x1f\x7f]/.test(secret), `缺少或非法 ${role.secret}`);
  const childEnv = {
    PATH: env.PATH ?? '/usr/bin:/bin', HOME: env.HOME ?? '/', LANG: 'C.UTF-8',
    ...(env.FAKE_RCLONE_FAIL ? { FAKE_RCLONE_FAIL: env.FAKE_RCLONE_FAIL } : {}),
    ...(env.FAKE_RCLONE_OBJECTS ? { FAKE_RCLONE_OBJECTS: env.FAKE_RCLONE_OBJECTS } : {}),
    ...(env.FAKE_RCLONE_LOG ? { FAKE_RCLONE_LOG: env.FAKE_RCLONE_LOG } : {}),
    RCLONE_CONFIG_GEEKGARAGE_TYPE: 's3', RCLONE_CONFIG_GEEKGARAGE_PROVIDER: 'Other',
    RCLONE_CONFIG_GEEKGARAGE_ACCESS_KEY_ID: access, RCLONE_CONFIG_GEEKGARAGE_SECRET_ACCESS_KEY: secret,
    RCLONE_CONFIG_GEEKGARAGE_REGION: REGION, RCLONE_CONFIG_GEEKGARAGE_ENDPOINT: ENDPOINT,
    RCLONE_CONFIG_GEEKGARAGE_FORCE_PATH_STYLE: 'true', RCLONE_CONFIG_GEEKGARAGE_NO_CHECK_BUCKET: 'true',
  };
  return { ...role, name, childEnv };
}

const remotePath = (role, key) => `${REMOTE}:${role.bucket}/${key}`;

function runJson(args, role, { missingOk = false } = {}) {
  const result = spawnSync('rclone', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: role.childEnv });
  if (missingOk && result.status === 3) return null;
  requireThat(result.status === 0 && !result.error, `rclone ${args[0]} 失败`);
  try { return JSON.parse(result.stdout); } catch { throw new ArchiveError(`rclone ${args[0]} 返回无效 JSON`); }
}

async function streamRclone(args, role, output) {
  const child = spawn('rclone', args, { env: role.childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); } });
  const sink = output ? createWriteStream(output, { flags: 'wx', mode: 0o600 }) : new Transform({ transform(_chunk, _encoding, callback) { callback(); } });
  child.stderr.on('data', () => {});
  const closed = new Promise((resolvePromise, rejectPromise) => {
    child.on('error', () => rejectPromise(new ArchiveError(`rclone ${args[0]} 启动失败`)));
    child.on('close', resolvePromise);
  });
  let code;
  try { [, code] = await Promise.all([pipeline(child.stdout, meter, sink), closed]); }
  catch { child.kill('SIGKILL'); throw new ArchiveError('rclone cat 读取失败'); }
  requireThat(code === 0, `rclone ${args[0]} 失败`);
  return { bytes, sha256: hash.digest('hex') };
}

async function hashFile(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; hash.update(chunk); }
  return { bytes, sha256: hash.digest('hex') };
}

async function putFile(role, source, key) {
  source = assertLocalPath(source);
  const info = lstatSync(source);
  requireThat(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, '上传源必须是无链接普通文件');
  assertObjectPath(role, key);
  if (role.name.endsWith('-content-index')) validateContentIndex(source, info);
  const local = await hashFile(source);
  const target = remotePath(role, key);
  const current = runJson(['lsjson', target, '--stat', '--no-modtime', '--no-mimetype'], role, { missingOk: true });
  // 真实 rclone 对不存在的键不一定退出 3：Garage 上返回退出码 0 和 IsDir=true 的空条目（rc.27 实测），只有普通对象才算已存在。
  if (current && current.IsDir === false) {
    const remote = await streamRclone(['cat', target], role);
    requireThat(remote.bytes === local.bytes && remote.sha256 === local.sha256, `${key}：同键内容冲突，拒绝覆盖`);
    return { status: 'exists', key, ...local };
  }
  const copied = spawnSync('rclone', ['copyto', source, target, '--immutable', '--no-traverse', '--retries', '3', '--low-level-retries', '5', '--stats', '0'], {
    encoding: 'utf8', env: role.childEnv,
  });
  requireThat(copied.status === 0 && !copied.error, `rclone copyto ${key} 失败`);
  const saved = await streamRclone(['cat', target], role);
  requireThat(saved.bytes === local.bytes && saved.sha256 === local.sha256, `${key}：写后完整 GET SHA-256 不一致`);
  return { status: 'stored', key, ...local };
}

function collectTree(source) {
  source = assertLocalPath(source);
  requireThat(lstatSync(source).isDirectory(), 'put-tree 的 source 必须是目录');
  const files = [];
  function walk(current) {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const info = lstatSync(path);
      requireThat(!info.isSymbolicLink(), '归档目录不得包含符号链接');
      if (info.isDirectory()) walk(path);
      else {
        requireThat(info.isFile() && info.nlink === 1, '归档目录只允许无链接普通文件');
        files.push(path);
      }
    }
  }
  walk(source);
  requireThat(files.length > 0, '归档目录为空');
  return { source, files };
}

function validateContentIndex(source, info) {
  requireThat((info.mode & 0o777) === 0o600, '私有内容索引权限必须是 0600');
  let parsed;
  try { parsed = JSON.parse(readFileSync(source, 'utf8')); } catch { throw new ArchiveError('私有内容索引 JSON 无效'); }
  requireThat(parsed?.schema_version === 1 && parsed.hashes && parsed.constructor === Object && parsed.hashes.constructor === Object, '私有内容索引 schema 无效');
  for (const [digest, item] of Object.entries(parsed.hashes)) {
    requireThat(/^[0-9a-f]{64}$/.test(digest) && Number.isSafeInteger(item?.bytes) && item.bytes >= 0 && Array.isArray(item.keys)
      && item.keys.length > 0 && item.keys.every(key => typeof key === 'string' && key.length > 0), '私有内容索引条目无效');
  }
}

async function putTree(role, source, prefix) {
  assertObjectPath(role, prefix, 'prefix');
  const collected = collectTree(source);
  source = collected.source;
  const items = collected.files.map(file => ({ file, rel: relative(source, file).split(sep).join('/') }));
  for (const { rel } of items) requireThat(rel && !rel.startsWith('../'), '归档相对路径非法');
  // 清单最后上传：远端出现 SHA256SUMS 就表示同一 run 的数据对象都已写入并读回核验过，中断的上传只会留下无清单的残缺 run
  items.sort((a, b) => Number(a.rel === MANIFEST_NAME) - Number(b.rel === MANIFEST_NAME));
  const results = [];
  for (const { file, rel } of items) results.push(await putFile(role, file, `${prefix}${rel}`));
  return {
    bucket: role.bucket, prefix, total: results.length,
    stored: results.filter(item => item.status === 'stored').length,
    exists: results.filter(item => item.status === 'exists').length,
    objects: results.map(({ key, bytes, sha256 }) => ({ key, bytes, sha256 })),
  };
}

function listPrefix(role, prefix) {
  assertObjectPath(role, prefix, 'prefix');
  return listObjects(role, prefix);
}

// 调用方负责保证 prefix 受信；每个返回对象的键仍要通过角色的 key 正则
function listObjects(role, prefix) {
  const list = runJson(['lsjson', remotePath(role, prefix), '--recursive', '--files-only', '--no-modtime', '--no-mimetype'], role);
  requireThat(Array.isArray(list), 'rclone lsjson 结果无效');
  return list.map(item => {
    const path = item?.Path;
    requireThat(typeof path === 'string' && path && !path.includes('\\') && !path.includes('%') && !path.startsWith('/')
      && !path.split('/').some(part => !part || part === '.' || part === '..'), '远端对象路径非法');
    const key = `${prefix}${path}`;
    assertObjectPath(role, key);
    return { path, key, bytes: item.Size };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

const MANIFEST_NAME = 'SHA256SUMS';

// 只接受 `sha256sum -- *.gpg > SHA256SUMS` 产出的严格格式：64 位小写摘要 + 两个空格/星号 + 相对路径
function parseManifest(text) {
  const lines = text.split('\n').filter(line => line.trim() !== '');
  requireThat(lines.length > 0, 'SHA256SUMS 为空');
  const entries = new Map();
  for (const line of lines) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    requireThat(match, 'SHA256SUMS 行格式无效');
    const name = match[2];
    requireThat(!name.startsWith('/') && !name.includes('\\') && !name.includes('%')
      && !name.split('/').some(part => !part || part === '.' || part === '..'), 'SHA256SUMS 含非法路径');
    requireThat(!entries.has(name), `SHA256SUMS 条目重复：${name}`);
    entries.set(name, match[1]);
  }
  return entries;
}

async function getTree(role, prefix, destination, { requireManifest = false } = {}) {
  assertObjectPath(role, prefix, 'prefix');
  destination = assertLocalPath(destination, { mustExist: false });
  requireThat(!existsSync(destination), '下载目标已存在，拒绝覆盖');
  const objects = listPrefix(role, prefix);
  requireThat(objects.length > 0, '远端前缀为空');
  mkdirSync(destination, { mode: 0o700 });
  // 顺序固定：先按列举长度核对长度，再由清单确认对象集合，最后才逐个比对 SHA-256；
  // 任一检查失败都丢弃 .partial，绝不把未通过校验的字节放进恢复目录
  const fetchObject = async (item, expected) => {
    requireThat(Number.isSafeInteger(item.bytes) && item.bytes >= 0, `对象长度无效：${item.path}`);
    const path = join(destination, ...item.path.split('/'));
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const partial = `${path}.partial`;
    let result;
    try { result = await streamRclone(['cat', remotePath(role, item.key)], role, partial); }
    catch (error) { rmSync(partial, { force: true }); throw error; }
    const discard = message => { rmSync(partial, { force: true }); throw new ArchiveError(message); };
    if (result.bytes !== item.bytes) discard(`${item.path}：实际长度与远端列举不一致`);
    if (expected !== undefined && result.sha256 !== expected) discard(`${item.path}：SHA-256 与 SHA256SUMS 不一致`);
    renameSync(partial, path);
    return { path: item.path, ...result };
  };
  const downloaded = [];
  let entries = null;
  if (requireManifest) {
    const manifest = objects.find(item => item.path === MANIFEST_NAME);
    requireThat(manifest, `${prefix} 缺少 SHA256SUMS，拒绝恢复`);
    requireThat(Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0, 'SHA256SUMS 为空或长度无效');
    const sums = await fetchObject(manifest);
    downloaded.push(sums);
    entries = parseManifest(readFileSync(join(destination, MANIFEST_NAME), 'utf8'));
    const listed = new Map(objects.filter(item => item.path !== MANIFEST_NAME).map(item => [item.path, item]));
    requireThat(listed.size === objects.length - 1, '远端对象列表含重复路径');
    requireThat(listed.size > 0, '远端除 SHA256SUMS 外没有对象');
    for (const name of entries.keys()) {
      requireThat(listed.has(name), `SHA256SUMS 列出的对象缺失：${name}`);
    }
    // 集合必须完全相等：清单被截断或出现未登记对象都直接失败，绝不退化成只校验清单里的子集
    requireThat(entries.size === listed.size, 'SHA256SUMS 与远端对象列表不一致（清单被截断或存在未登记对象）');
  }
  for (const item of objects) {
    if (entries && item.path === MANIFEST_NAME) continue;
    downloaded.push(await fetchObject(item, entries ? entries.get(item.path) : undefined));
  }
  if (entries) {
    // 恢复前的人工比对依据：只打印 run 标识与对象摘要，不打印任何对象内容
    const total = downloaded.reduce((sum, item) => sum + item.bytes, 0);
    process.stderr.write(`[garage-archive] run ${prefix} objects=${downloaded.length} bytes=${total}\n`);
    for (const item of downloaded) process.stderr.write(`[garage-archive]   ${item.path} ${item.bytes} ${item.sha256}\n`);
  }
  return {
    bucket: role.bucket, prefix, downloaded: downloaded.length, manifestVerified: Boolean(entries), objects: downloaded,
  };
}

const RUN_SELECTOR = /^(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9._-]+)$/;

function gitlabRunTarget(run) {
  requireThat(typeof run === 'string' && run !== '', '必须显式指定 --run <YYYY-MM-DD>/<run>');
  const match = RUN_SELECTOR.exec(run);
  requireThat(match, '--run 必须是 <YYYY-MM-DD>/<run>');
  return { day: match[1], run: match[2], prefix: `gitlab/${match[1]}/${match[2]}/` };
}

function listGitlabRuns(day, env, roleName) {
  if (day !== undefined) requireThat(/^\d{4}-\d{2}-\d{2}$/.test(day), '--day 必须是 YYYY-MM-DD');
  const role = roleConfig(roleName, env);
  const runs = new Set();
  for (const item of listPrefix(role, 'gitlab/')) {
    const match = /^(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9._-]+)\/SHA256SUMS$/.exec(item.path);
    if (match && (!day || match[1] === day)) runs.add(`${match[1]}/${match[2]}`);
  }
  return [...runs].sort((a, b) => a.localeCompare(b, 'en'));
}

// 显式选择：只核对调用者点名的 run，绝不按字典序或时间来“猜”要恢复哪一份
function resolveGitlabRun(run, env, roleName) {
  const target = gitlabRunTarget(run);
  const role = roleConfig(roleName, env);
  const objects = listPrefix(role, target.prefix);
  requireThat(objects.length > 0, `远端不存在 ${target.prefix}`);
  const manifest = objects.find(item => item.path === MANIFEST_NAME);
  requireThat(manifest, `${target.prefix} 缺少 SHA256SUMS，拒绝恢复`);
  requireThat(Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0, `${target.prefix} 的 SHA256SUMS 为空或长度无效`);
  for (const item of objects) {
    requireThat(Number.isSafeInteger(item.bytes) && item.bytes >= 0, `${target.prefix} 对象长度无效：${item.path}`);
  }
  return { day: target.day, run: target.run, prefix: target.prefix, objects: objects.map(({ path, bytes }) => ({ path, bytes })) };
}

const PRUNE_FAMILIES = Object.freeze({
  'gitlab-backup': 'gitlab/',
  'gitlab-preview-backup': 'gitlab/',
  'platform-preview-backup': 'platform/preview/',
  'platform-production-backup': 'platform/production/',
});
const DEFAULT_KEEP_DATES = 3;

function catText(role, key) {
  const result = spawnSync('rclone', ['cat', remotePath(role, key)], { encoding: 'utf8', maxBuffer: 1024 * 1024, env: role.childEnv });
  requireThat(result.status === 0 && !result.error, `rclone cat ${key} 失败`);
  return result.stdout;
}

// 保留最近 N 个「清单与对象列表逐项对得上的备份日期」，更早的整日 run 删除。
// 任何前置核对不过都零删除：目录结构意外、出现晚于北京今天的日期（主机时钟超前会把截止日推后）、
// 已核验的日期不足 N 个、最新一份带清单的 run 对不上。保留窗口内对不上的旧 run 不计入日期，也不会被删。
// 每个 run 先删 SHA256SUMS：中途失败时它变成无清单的残缺 run，恢复路径不会再选它，下一次清理会收走剩余对象。
const beijingToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function runMatchesManifest(role, entry) {
  let entries;
  try { entries = parseManifest(catText(role, `${entry.prefix}${MANIFEST_NAME}`)); }
  catch (error) { if (error instanceof ArchiveError && error.message.startsWith('SHA256SUMS')) return false; throw error; }
  const listed = new Map(entry.objects.filter(object => object.name !== MANIFEST_NAME).map(object => [object.name, object]));
  return listed.size === entries.size && [...entries.keys()].every(name => listed.get(name)?.bytes > 0);
}

function pruneRuns(role, { keepDates = DEFAULT_KEEP_DATES, apply = false } = {}) {
  const family = PRUNE_FAMILIES[role.name];
  requireThat(family, '该角色不支持清理');
  requireThat(Number.isSafeInteger(keepDates) && keepDates >= 1 && keepDates <= 30, '--keep-dates 必须是 1 到 30 的整数');
  const runs = new Map();
  for (const item of listObjects(role, family)) {
    const match = /^(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9._-]+)\/(.+)$/.exec(item.path);
    requireThat(match, `${item.key}：不在 <日期>/<run>/ 结构内，拒绝清理`);
    requireThat(Number.isSafeInteger(item.bytes) && item.bytes >= 0, `${item.key}：对象长度无效`);
    const id = `${match[1]}/${match[2]}`;
    const entry = runs.get(id) ?? { date: match[1], run: match[2], prefix: `${family}${id}/`, objects: [] };
    entry.objects.push({ key: item.key, name: match[3], bytes: item.bytes });
    runs.set(id, entry);
  }
  const today = beijingToday();
  for (const entry of runs.values()) requireThat(entry.date <= today, `${entry.prefix}：日期晚于北京今天 ${today}，疑似主机时钟错误，拒绝清理`);

  const byAge = (a, b) => a.date.localeCompare(b.date, 'en') || a.run.localeCompare(b.run, 'en');
  const withManifest = [...runs.values()].filter(entry => entry.objects.some(object => object.name === MANIFEST_NAME)).sort(byAge);
  const verifiedDates = new Set();
  const unverifiedRuns = [];
  // 从新到旧逐个核验，凑够 N 个日期就停：窗口之外更旧的 run 不需要读清单
  for (let index = withManifest.length - 1; index >= 0 && verifiedDates.size < keepDates; index -= 1) {
    const entry = withManifest[index];
    if (runMatchesManifest(role, entry)) { verifiedDates.add(entry.date); continue; }
    requireThat(index !== withManifest.length - 1, `${entry.prefix} 最新一份 run 的 SHA256SUMS 与对象列表不一致，拒绝清理`);
    unverifiedRuns.push(entry.prefix);
  }
  const kept = [...verifiedDates].sort();
  const result = { bucket: role.bucket, family, mode: apply ? 'apply' : 'dry-run', keepDates, keptDates: kept, unverifiedRuns, removedRuns: [], objects: 0, bytes: 0 };
  if (kept.length < keepDates) return result;

  const cutoff = kept[0];
  const doomed = [...runs.values()].filter(entry => entry.date < cutoff).sort(byAge);
  for (const entry of doomed) {
    const ordered = [...entry.objects].sort((a, b) => Number(b.name === MANIFEST_NAME) - Number(a.name === MANIFEST_NAME));
    for (const object of ordered) {
      if (apply) {
        const deleted = spawnSync('rclone', ['deletefile', remotePath(role, object.key)], { encoding: 'utf8', env: role.childEnv });
        requireThat(deleted.status === 0 && !deleted.error, `rclone deletefile ${object.key} 失败`);
      }
      result.objects += 1;
      result.bytes += object.bytes;
    }
    result.removedRuns.push(entry.prefix);
  }
  return result;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { command, options } = parseArgs(argv);
  if (command === 'prune-runs') {
    const keepDates = options['--keep-dates'] === undefined ? DEFAULT_KEEP_DATES : Number(options['--keep-dates']);
    return pruneRuns(roleConfig(options['--role'], env), { keepDates, apply: options['--apply'] === true });
  }
  const gitlabRole = options['--role'] ?? 'gitlab-backup';
  if (command === 'list-gitlab-runs' || command === 'resolve-gitlab-run') requireThat(['gitlab-backup', 'gitlab-preview-backup'].includes(gitlabRole), 'GitLab 恢复只接受 GitLab 备份角色');
  if (command === 'list-gitlab-runs') return { runs: listGitlabRuns(options['--day'], env, gitlabRole) };
  if (command === 'resolve-gitlab-run') {
    if (!options['--run']) {
      const runs = listGitlabRuns(undefined, env, gitlabRole);
      throw new ArchiveError(`必须显式指定 --run <YYYY-MM-DD>/<run>，不会自动选择最新 run。可用 run：${runs.length > 0 ? runs.join('、') : '（无）'}`);
    }
    return resolveGitlabRun(options['--run'], env, gitlabRole);
  }
  const role = roleConfig(options['--role'], env);
  if (command === 'put-file') return { bucket: role.bucket, ...(await putFile(role, options['--source'], options['--key'])) };
  if (command === 'put-tree') return await putTree(role, options['--source'], options['--prefix']);
  if (command === 'get-tree') return await getTree(role, options['--prefix'], options['--destination'], { requireManifest: options['--require-manifest'] === true });
  throw new ArchiveError('未知命令');
}

const direct = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) main().then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(`[garage-archive] ${error instanceof ArchiveError ? error.message : '失败：本地 I/O 或 rclone 不可用'}`);
  process.exitCode = 1;
});
