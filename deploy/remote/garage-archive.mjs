#!/usr/bin/env node
// 私有归档适配器：复用 rclone 的 S3/SigV4 实现，只新增、完整读回核验，不提供覆盖命令。
// 备份角色（GitLab、平台、迁移前数据库）写入 BACKUP_S3_* 指定的 S3 兼容私有桶（七牛），端点、区域、桶、前缀和凭据全部来自环境变量；
// 内容索引角色仍写 Garage 的私有桶（不是备份，未随本次迁移）。
// 唯一的删除入口是 prune-runs：只清理备份角色名下的整日 run，按 日/周/月 保留（见 RETENTION），核验不过零删除。
import { createHash } from 'node:crypto';
import {
  createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';

const REMOTE = 'archive';
// 内容索引仍在 Garage 私有桶（非备份）；只有这一组端点是代码里的常量，备份端点一律来自 BACKUP_S3_ENDPOINT。
const GARAGE = Object.freeze({ endpoint: 'https://cdn.yangtzeu.work', region: 'garage' });
const BACKUP_TARGET = 'backup';
const ROLES = Object.freeze({
  'gitlab-backup': {
    target: BACKUP_TARGET,
    key: /^gitlab\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/,
    prefix: /^gitlab\/(?:\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/?)?$/,
  },
  'gitlab-preview-backup': {
    target: BACKUP_TARGET,
    key: /^gitlab\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/,
    prefix: /^gitlab\/(?:\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/?)?$/,
  },
  'platform-preview-backup': {
    target: BACKUP_TARGET,
    key: /^platform\/preview\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/,
    prefix: /^platform\/preview\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/$/,
  },
  'platform-production-backup': {
    target: BACKUP_TARGET,
    key: /^platform\/production\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/,
    prefix: /^platform\/production\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/$/,
  },
  // 部署前的数据库快照：deploy-stack.sh 在 compose up（即迁移）之前写入，前缀按环境由 BACKUP_S3_PREFIX 区分
  'database-backup': {
    target: BACKUP_TARGET,
    key: /^database\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+$/,
    prefix: /^database\/(?:\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/)?$/,
  },
  'preview-content-index': {
    target: 'garage', bucket: 'geek-preview-private', access: 'PREVIEW_PRIVATE_INDEX_S3_ACCESS_KEY_ID', secret: 'PREVIEW_PRIVATE_INDEX_S3_SECRET_ACCESS_KEY',
    key: /^indexes\/content\/[0-9a-f]{40}\/sha256\.json$/,
  },
  'production-content-index': {
    target: 'garage', bucket: 'geek-production-private', access: 'PRODUCTION_PRIVATE_INDEX_S3_ACCESS_KEY_ID', secret: 'PRODUCTION_PRIVATE_INDEX_S3_SECRET_ACCESS_KEY',
    key: /^indexes\/content\/[0-9a-f]{40}\/sha256\.json$/,
  },
});
// 保留策略（GFS）：每个北京日期、每个 ISO 周、每个自然月各保留最新的一份完整 run；最近 7 天、4 周、3 个月有备份的桶。三条取并集。
const RETENTION = Object.freeze({ daily: 7, weekly: 4, monthly: 3 });

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
    'prune-runs': ['--role'],
  };
  // 无值布尔开关：恢复路径必须显式要求清单校验，缺省下载保持通用；清理缺省只列清单（同 --dry-run），--apply 才删除
  const flagsByCommand = { 'get-tree': ['--require-manifest'], 'prune-runs': ['--apply', '--dry-run'] };
  requireThat(Object.hasOwn(allowedByCommand, command), '用法：garage-archive.mjs put-tree|put-file|get-tree|resolve-gitlab-run|list-gitlab-runs|prune-runs [--dry-run|--apply]');
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

// 备份目标只从环境变量读取；错误信息只报键名，不回显任何取值（桶名与凭据都不进日志）。
function backupTarget(env) {
  const endpoint = env.BACKUP_S3_ENDPOINT ?? '';
  requireThat(/^https:\/\/[a-z0-9][a-z0-9.-]*[a-z0-9](?::\d{2,5})?$/.test(endpoint), '缺少或非法 BACKUP_S3_ENDPOINT（必须是 https:// 主机，不带路径）');
  const region = env.BACKUP_S3_REGION ?? '';
  requireThat(/^[a-z0-9-]{2,32}$/.test(region), '缺少或非法 BACKUP_S3_REGION');
  const bucket = env.BACKUP_S3_BUCKET ?? '';
  requireThat(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket), '缺少或非法 BACKUP_S3_BUCKET');
  const prefix = env.BACKUP_S3_PREFIX ?? '';
  // 前缀必须非空：备份不能写在桶根下，否则与桶里其它对象混在同一个清理范围
  requireThat(/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*\/$/.test(prefix) && !prefix.includes('..'), 'BACKUP_S3_PREFIX 必须是以 / 结尾的非空相对前缀，不能写在桶根下');
  return { endpoint, region, bucket, prefix, access: env.BACKUP_S3_ACCESS_KEY_ID ?? '', secret: env.BACKUP_S3_SECRET_ACCESS_KEY ?? '' };
}

function roleConfig(name, env = process.env) {
  const role = ROLES[name];
  requireThat(role, '未知归档角色');
  const target = role.target === BACKUP_TARGET
    ? backupTarget(env)
    : { endpoint: GARAGE.endpoint, region: GARAGE.region, bucket: role.bucket, prefix: '', access: env[role.access] ?? '', secret: env[role.secret] ?? '' };
  const accessKey = role.target === BACKUP_TARGET ? 'BACKUP_S3_ACCESS_KEY_ID' : role.access;
  const secretKey = role.target === BACKUP_TARGET ? 'BACKUP_S3_SECRET_ACCESS_KEY' : role.secret;
  requireThat(target.access && !/[\s:\x00-\x1f\x7f]/.test(target.access), `缺少或非法 ${accessKey}`);
  requireThat(target.secret && !/[\x00-\x1f\x7f]/.test(target.secret), `缺少或非法 ${secretKey}`);
  const childEnv = {
    PATH: env.PATH ?? '/usr/bin:/bin', HOME: env.HOME ?? '/', LANG: 'C.UTF-8',
    ...(env.FAKE_RCLONE_FAIL ? { FAKE_RCLONE_FAIL: env.FAKE_RCLONE_FAIL } : {}),
    ...(env.FAKE_RCLONE_OBJECTS ? { FAKE_RCLONE_OBJECTS: env.FAKE_RCLONE_OBJECTS } : {}),
    ...(env.FAKE_RCLONE_LOG ? { FAKE_RCLONE_LOG: env.FAKE_RCLONE_LOG } : {}),
    RCLONE_CONFIG_ARCHIVE_TYPE: 's3', RCLONE_CONFIG_ARCHIVE_PROVIDER: 'Other',
    RCLONE_CONFIG_ARCHIVE_ACCESS_KEY_ID: target.access, RCLONE_CONFIG_ARCHIVE_SECRET_ACCESS_KEY: target.secret,
    RCLONE_CONFIG_ARCHIVE_REGION: target.region, RCLONE_CONFIG_ARCHIVE_ENDPOINT: target.endpoint,
    RCLONE_CONFIG_ARCHIVE_FORCE_PATH_STYLE: 'true', RCLONE_CONFIG_ARCHIVE_NO_CHECK_BUCKET: 'true',
  };
  return { ...role, name, bucket: target.bucket, keyPrefix: target.prefix, childEnv };
}

// 桶内的对象键 = 角色前缀（BACKUP_S3_PREFIX，按环境区分）+ 角色内相对键；调用方只用相对键
const remotePath = (role, key) => `${REMOTE}:${role.bucket}/${role.keyPrefix}${key}`;

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
    role: role.name, prefix, total: results.length,
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
  // 前缀还没有任何对象（例如第一次清理前的新角色）时 rclone 可能退出码 3：按空列表处理，由调用方决定报错还是跳过
  const list = runJson(['lsjson', remotePath(role, prefix), '--recursive', '--files-only', '--no-modtime', '--no-mimetype'], role, { missingOk: true }) ?? [];
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
    role: role.name, prefix, downloaded: downloaded.length, manifestVerified: Boolean(entries), objects: downloaded,
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
  'database-backup': 'database/',
});

function catText(role, key) {
  const result = spawnSync('rclone', ['cat', remotePath(role, key)], { encoding: 'utf8', maxBuffer: 1024 * 1024, env: role.childEnv });
  requireThat(result.status === 0 && !result.error, `rclone cat ${key} 失败`);
  return result.stdout;
}

// 清理只看北京日期（与 run 名无关）：日期、ISO 周（取周一的日期）、自然月。
const beijingToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function isoWeekStart(date) {
  const [year, month, day] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
  return utc.toISOString().slice(0, 10);
}
const runId = entry => `${entry.date}/${entry.run}`;

// 每个桶（日 / 周 / 月）取最新的一份完整 run，三种桶各取最近的 N 个，并集即保留集合。entries 必须按时间从旧到新排序。
function retainedRunIds(entries) {
  const keep = new Set();
  const newestPerBucket = (bucketOf, count) => {
    const newest = new Map();
    for (const entry of entries) newest.set(bucketOf(entry.date), entry);
    for (const bucket of [...newest.keys()].sort().slice(-count)) keep.add(runId(newest.get(bucket)));
  };
  newestPerBucket(date => date, RETENTION.daily);
  newestPerBucket(isoWeekStart, RETENTION.weekly);
  newestPerBucket(date => date.slice(0, 7), RETENTION.monthly);
  return keep;
}

function runMatchesManifest(role, entry) {
  let entries;
  try { entries = parseManifest(catText(role, `${entry.prefix}${MANIFEST_NAME}`)); }
  catch (error) { if (error instanceof ArchiveError && error.message.startsWith('SHA256SUMS')) return false; throw error; }
  const listed = new Map(entry.objects.filter(object => object.name !== MANIFEST_NAME).map(object => [object.name, object]));
  return listed.size === entries.size && [...entries.keys()].every(name => listed.get(name)?.bytes > 0);
}

// 只删整日 run：先选出要保留的完整 run（有 SHA256SUMS），逐个核对它与对象列表一致，任一不一致就零删除。
// 删除的是其余完整 run；没有清单的残缺 run（上传中断留下的）只在保留窗口最旧的日期之前才清理。
// 每个 run 先删 SHA256SUMS：中途失败时它变成无清单的残缺 run，恢复路径不会再选它，下一次清理会收走剩余对象。
function pruneRuns(role, { apply = false } = {}) {
  const family = PRUNE_FAMILIES[role.name];
  requireThat(family, '该角色不支持清理');
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
  const complete = [...runs.values()].filter(entry => entry.objects.some(object => object.name === MANIFEST_NAME)).sort(byAge);
  const incomplete = [...runs.values()].filter(entry => !complete.includes(entry));
  const keep = retainedRunIds(complete);
  const kept = complete.filter(entry => keep.has(runId(entry)));
  for (const entry of kept) requireThat(runMatchesManifest(role, entry), `${entry.prefix} 的 SHA256SUMS 与对象列表不一致，拒绝清理`);
  const oldestKept = kept[0]?.date;
  const doomed = [
    ...complete.filter(entry => !keep.has(runId(entry))),
    ...(oldestKept ? incomplete.filter(entry => entry.date < oldestKept) : []),
  ].sort(byAge);
  const result = {
    mode: apply ? 'apply' : 'dry-run',
    retention: { ...RETENTION },
    runs: { complete: complete.length, kept: kept.length, removed: doomed.length, incomplete: incomplete.length },
    objects: 0,
    bytes: 0,
  };
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
  }
  return result;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { command, options } = parseArgs(argv);
  if (command === 'prune-runs') {
    requireThat(!(options['--apply'] && options['--dry-run']), '--apply 与 --dry-run 只能二选一');
    return pruneRuns(roleConfig(options['--role'], env), { apply: options['--apply'] === true });
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
  if (command === 'put-file') return { role: role.name, ...(await putFile(role, options['--source'], options['--key'])) };
  if (command === 'put-tree') return await putTree(role, options['--source'], options['--prefix']);
  if (command === 'get-tree') return await getTree(role, options['--prefix'], options['--destination'], { requireManifest: options['--require-manifest'] === true });
  throw new ArchiveError('未知命令');
}

const direct = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) main().then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(`[garage-archive] ${error instanceof ArchiveError ? error.message : '失败：本地 I/O 或 rclone 不可用'}`);
  process.exitCode = 1;
});
