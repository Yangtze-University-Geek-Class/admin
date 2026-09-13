#!/usr/bin/env node
/**
 * 发布产物打包与校验。
 *
 * 只读仓库内已构建的产物，按允许列表复制成不可变发布包；不改版本、不创建 tag、不连接服务器、不代表人工验收。
 * 打包与校验都不读取 .env、数据库或任何运行时数据；命中禁止路径直接失败。
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deploymentTarget } from './deployment-environment.mjs';
import { parseReleaseTag, parseVersion } from './release-policy.mjs';

const SHA40 = /^[a-f0-9]{40}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const RUN_FIELD = /^[A-Za-z0-9._:+/-]{1,120}$/;

/** 只有这些路径进入发布包；仓库其余内容一律不打包。 */
export const BUNDLE_ALLOWLIST = Object.freeze([
  { source: 'server/dist', target: 'server/dist', kind: 'tree' },
  { source: 'server/package.json', target: 'server/package.json', kind: 'file' },
  { source: 'web/dist', target: 'web/dist', kind: 'tree' },
  { source: 'web/package.json', target: 'web/package.json', kind: 'file' },
  // 生产启动时 loadConfig 会读取这份公开前端配置来比对 host，缺它会直接启动失败。
  { source: 'web/shared/config/app.config.json', target: 'web/shared/config/app.config.json', kind: 'file' },
  // portal 的 /api/docs 只读这四个公开文档；内部文档不进发布包。
  { source: 'docs/public/README.md', target: 'docs/public/README.md', kind: 'file' },
  { source: 'docs/public/README.en.md', target: 'docs/public/README.en.md', kind: 'file' },
  { source: 'docs/ops/USAGE.md', target: 'docs/ops/USAGE.md', kind: 'file' },
  { source: 'docs/ops/USAGE.en.md', target: 'docs/ops/USAGE.en.md', kind: 'file' },
  { source: 'modules/forum/.output/public', target: 'forum/public', kind: 'tree' },
  { source: 'package.json', target: 'package.json', kind: 'file' },
  { source: 'pnpm-lock.yaml', target: 'pnpm-lock.yaml', kind: 'file' },
  { source: 'pnpm-workspace.yaml', target: 'pnpm-workspace.yaml', kind: 'file' },
  { source: '.nvmrc', target: '.nvmrc', kind: 'file' },
  { source: 'scripts/check-runtime.mjs', target: 'scripts/check-runtime.mjs', kind: 'file' },
  // 目标机只有发布包本身，verify 及其依赖必须随包分发。
  { source: 'scripts/release-bundle.mjs', target: 'scripts/release-bundle.mjs', kind: 'file' },
  { source: 'scripts/release-policy.mjs', target: 'scripts/release-policy.mjs', kind: 'file' },
  { source: 'scripts/deployment-environment.mjs', target: 'scripts/deployment-environment.mjs', kind: 'file' },
  { source: 'deploy/environments.json', target: 'deploy/environments.json', kind: 'file' },
  { source: 'deploy/remote', target: 'deploy/remote', kind: 'tree' },
]);

/** 组件归属由发布包内的顶层目录决定。 */
export const BUNDLE_COMPONENTS = Object.freeze(['server', 'web', 'forum']);
const FORBIDDEN_SEGMENTS = new Set(['node_modules', '.git', '.tools', 'data']);
const MANIFEST_NAME = 'MANIFEST.sha256';
const RELEASE_NAME = 'release.json';

function fail(message) { throw new Error(message); }

/** 禁止列表二次防线：秘密、数据库、依赖目录与工具目录绝不进入发布包。 */
export function assertSafeBundlePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 400) fail(`发布包路径非法：${String(value)}`);
  if (value.includes('\\') || value.includes('\0')) fail(`发布包路径非法：${value}`);
  const segments = value.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') fail(`发布包路径不允许相对或空片段：${value}`);
    if (FORBIDDEN_SEGMENTS.has(segment)) fail(`禁止路径命中（${segment}）：${value}`);
  }
  const base = segments[segments.length - 1];
  if (base.startsWith('.env')) fail(`禁止把环境文件打进发布包：${value}`);
  if (/\.db(-wal|-shm)?$/.test(base)) fail(`禁止把数据库文件打进发布包：${value}`);
  return value;
}

function sha256OfFile(absolute) {
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}
function byPath(a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; }
/** 摘要只依赖「路径 + 内容」，与 mtime、写入顺序、遍历顺序和平台无关。 */
export function digestEntries(entries) {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort(byPath)) hash.update(`${entry.sha256}  ${entry.path}\n`);
  return hash.digest('hex');
}
export function manifestText(entries) {
  return [...entries].sort(byPath).map(entry => `${entry.sha256}  ${entry.path}\n`).join('');
}
export function componentSummary(entries) {
  const summary = {};
  for (const name of BUNDLE_COMPONENTS) {
    const owned = entries.filter(entry => entry.path === name || entry.path.startsWith(`${name}/`));
    summary[name] = { files: owned.length, sha256: digestEntries(owned) };
  }
  return summary;
}

function walkTree(absoluteDir, targetPrefix, sourcePrefix, out) {
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const absolute = join(absoluteDir, entry.name);
    const target = `${targetPrefix}/${entry.name}`;
    const source = `${sourcePrefix}/${entry.name}`;
    if (entry.isSymbolicLink()) fail(`发布包不接受符号链接：${source}`);
    if (entry.isDirectory()) { walkTree(absolute, target, source, out); continue; }
    if (!entry.isFile()) fail(`发布包只接受普通文件：${source}`);
    out.push({ absolute, source, path: assertSafeBundlePath(target) });
  }
}

/** 按允许列表解析仓库中要打包的文件；任何必需来源缺失即失败，不静默跳过。 */
export function collectBundleFiles(root) {
  const repoRoot = resolve(root);
  const files = [];
  for (const rule of BUNDLE_ALLOWLIST) {
    assertSafeBundlePath(rule.source);
    assertSafeBundlePath(rule.target);
    const absolute = resolve(repoRoot, rule.source);
    if (!existsSync(absolute)) fail(`发布包缺少必需内容：${rule.source}；请先完成对应构建，不允许跳过。`);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`发布包不接受符号链接：${rule.source}`);
    if (rule.kind === 'tree') {
      if (!stat.isDirectory()) fail(`允许列表要求目录，但 ${rule.source} 不是目录。`);
      const collected = [];
      walkTree(absolute, rule.target, rule.source, collected);
      if (collected.length === 0) fail(`发布包必需目录为空：${rule.source}；请先完成对应构建。`);
      files.push(...collected);
    } else {
      if (!stat.isFile()) fail(`允许列表要求普通文件，但 ${rule.source} 不是普通文件。`);
      files.push({ absolute, source: rule.source, path: assertSafeBundlePath(rule.target) });
    }
  }
  const seen = new Set();
  for (const file of files) {
    if (seen.has(file.path)) fail(`发布包内路径重复：${file.path}`);
    seen.add(file.path);
  }
  return files.sort(byPath);
}

function assertPlainToolchain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('toolchain 必须是 JSON 对象。');
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 120) fail(`toolchain.${key} 必须是非空字符串。`);
  }
  return value;
}

/**
 * 解析并校验一次构建的发布身份。
 * 正式环境禁止 @；预发布的 @ 后缀必须等于所选 commit 的前 12 位；tag 与环境、版本必须一致。
 */
export function resolveReleaseIdentity(input) {
  const { environment, displayVersion, baseVersion, commit, tag = null, builtAt, runId, runNumber, toolchain } = input ?? {};
  const target = deploymentTarget(environment);
  if (typeof commit !== 'string' || !SHA40.test(commit)) fail('必须提供准确的 40 位小写 commit SHA。');
  parseVersion(baseVersion);
  if (typeof displayVersion !== 'string' || displayVersion.length === 0) fail('必须提供展示版本。');
  const shortCommit = commit.slice(0, 12);
  if (environment === 'production') {
    if (displayVersion !== baseVersion) fail(`正式环境禁止 @ 后缀，展示版本必须等于 ${baseVersion}。`);
  } else if (displayVersion !== baseVersion && displayVersion !== `${baseVersion}@${shortCommit}`) {
    fail(`预发布展示版本只能是 ${baseVersion} 或 ${baseVersion}@${shortCommit}。`);
  }
  let resolvedTag = null;
  if (tag !== null && tag !== undefined) {
    const parsed = parseReleaseTag(tag);
    if (parsed.environment !== environment) fail(`tag ${tag} 属于 ${parsed.environment}，与目标环境 ${environment} 不一致。`);
    if (parsed.version !== baseVersion) fail(`tag ${tag} 的版本与基础版本 ${baseVersion} 不一致。`);
    resolvedTag = parsed.tag;
  }
  if (typeof builtAt !== 'string' || !ISO_8601.test(builtAt) || Number.isNaN(Date.parse(builtAt))) fail('builtAt 必须是合法的 ISO 8601 时间。');
  if (typeof runId !== 'string' || !RUN_FIELD.test(runId)) fail('runId 必须是简短的安全字符串。');
  if (typeof runNumber !== 'string' || !RUN_FIELD.test(runNumber)) fail('runNumber 必须是简短的安全字符串。');
  assertPlainToolchain(toolchain);
  // releaseId 用于文件系统与目录名，永远不含 @。
  const releaseId = `${baseVersion}-${shortCommit}`;
  return {
    environment, publicOrigin: target.origin, baseVersion, displayVersion, commit, shortCommit,
    tag: resolvedTag, releaseId, artifactName: `geek-${environment}-${releaseId}`,
    builtAt, run: { id: runId, number: runNumber }, toolchain,
  };
}

function writeFileTo(bundleDir, relativePath, content) {
  const absolute = join(bundleDir, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

function tar(args, cwd) {
  return execFileSync('tar', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
    // macOS 的 bsdtar 默认会写 AppleDouble 元数据文件，关掉以保持发布包内容可预期。
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
}

function assertPortableArchive(tarPath) {
  const entries = tar(['-tzf', tarPath]).split('\n').filter(Boolean);
  for (const entry of entries) {
    if (entry.startsWith('/')) fail(`归档包含绝对路径条目：${entry}`);
    if (entry.split('/').includes('..')) fail(`归档包含向上跳出的条目：${entry}`);
  }
  return entries.length;
}

/** 生成发布包目录、MANIFEST、release.json 与 tar.gz。返回构建身份与摘要。 */
export function buildBundle(options) {
  const root = resolve(options.root ?? process.cwd());
  const outDir = resolve(options.out);
  const identity = resolveReleaseIdentity(options);
  const files = collectBundleFiles(root);
  const bundleDir = join(outDir, identity.artifactName);
  if (existsSync(bundleDir)) fail(`输出目录已存在 ${identity.artifactName}；请改用干净目录，本脚本不删除既有内容。`);
  mkdirSync(bundleDir, { recursive: true });

  const entries = [];
  for (const file of files) {
    const content = readFileSync(file.absolute);
    writeFileTo(bundleDir, file.path, content);
    entries.push({ path: file.path, sha256: createHash('sha256').update(content).digest('hex') });
  }
  const manifest = manifestText(entries);
  const manifestSha256 = createHash('sha256').update(manifest).digest('hex');
  const components = componentSummary(entries);
  const release = {
    schemaVersion: 1,
    environment: identity.environment,
    publicOrigin: identity.publicOrigin,
    baseVersion: identity.baseVersion,
    displayVersion: identity.displayVersion,
    commit: identity.commit,
    shortCommit: identity.shortCommit,
    tag: identity.tag,
    releaseId: identity.releaseId,
    artifactName: identity.artifactName,
    builtAt: identity.builtAt,
    run: identity.run,
    toolchain: identity.toolchain,
    components,
    manifestSha256,
    deploymentAuthorized: false,
    note: '构建身份，不代表人工验收或部署批准',
  };
  const releaseJsonPath = writeFileTo(bundleDir, RELEASE_NAME, `${JSON.stringify(release, null, 2)}\n`);
  writeFileTo(bundleDir, MANIFEST_NAME, manifest);

  const tarPath = join(outDir, `${identity.artifactName}.tar.gz`);
  if (existsSync(tarPath)) fail(`归档已存在：${tarPath}；不覆盖既有产物。`);
  tar(['-czf', tarPath, '-C', bundleDir, '.']);
  assertPortableArchive(tarPath);
  const tarSha256 = sha256OfFile(tarPath);
  writeFileSync(`${tarPath}.sha256`, `${tarSha256}  ${identity.artifactName}.tar.gz\n`);

  return { ...identity, bundleDir, tarPath, tarSha256, manifestSha256, components, releaseJsonPath, release };
}

function walkBundle(bundleDir, prefix, out) {
  const absoluteDir = prefix ? join(bundleDir, prefix) : bundleDir;
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    // 已部署的版本目录里必然有 pnpm install --prod 生成的 node_modules（含 .pnpm 与大量符号链接）。
    // 它不属于发布包内容、不登记进 MANIFEST，整棵子树跳过：不进入、不计数、不做符号链接检查。
    // build 侧对源路径 node_modules 的拒绝不受影响（assertSafeBundlePath 仍然生效）。
    if (entry.name === 'node_modules') continue;
    if (entry.isSymbolicLink()) fail(`发布包内存在符号链接，拒绝校验：${path}`);
    if (entry.isDirectory()) { walkBundle(bundleDir, path, out); continue; }
    if (!entry.isFile()) fail(`发布包内存在非普通文件：${path}`);
    if (!prefix && (entry.name === MANIFEST_NAME || entry.name === RELEASE_NAME)) continue;
    out.push({ path: assertSafeBundlePath(path), sha256: sha256OfFile(join(bundleDir, path)) });
  }
  return out;
}

/** 校验解包后的发布包：重算全部文件摘要，并与 MANIFEST、release.json 交叉比对。 */
export function verifyBundle({ dir, expectEnvironment, expectCommit }) {
  const bundleDir = resolve(dir);
  if (!existsSync(bundleDir) || !lstatSync(bundleDir).isDirectory()) fail(`发布包目录不存在：${bundleDir}`);
  const manifestPath = join(bundleDir, MANIFEST_NAME);
  const releasePath = join(bundleDir, RELEASE_NAME);
  for (const [label, path] of [[MANIFEST_NAME, manifestPath], [RELEASE_NAME, releasePath]]) {
    if (!existsSync(path) || !lstatSync(path).isFile()) fail(`发布包缺少 ${label}。`);
  }
  let release;
  try { release = JSON.parse(readFileSync(releasePath, 'utf8')); } catch { fail('release.json 不是合法 JSON。'); }
  if (release.schemaVersion !== 1) fail('release.json 的 schemaVersion 必须为 1。');
  if (release.deploymentAuthorized !== false) fail('release.json 不允许声明已获部署批准。');

  const entries = walkBundle(bundleDir, '', []);
  const recomputed = manifestText(entries);
  const declared = readFileSync(manifestPath, 'utf8');
  if (recomputed !== declared) {
    const declaredMap = new Map(declared.split('\n').filter(Boolean).map(line => [line.slice(66), line.slice(0, 64)]));
    const actualMap = new Map(entries.map(entry => [entry.path, entry.sha256]));
    const problems = [];
    for (const [path, sha] of declaredMap) {
      if (!actualMap.has(path)) problems.push(`缺少文件 ${path}`);
      else if (actualMap.get(path) !== sha) problems.push(`内容被篡改 ${path}`);
    }
    for (const path of actualMap.keys()) if (!declaredMap.has(path)) problems.push(`多出未登记文件 ${path}`);
    fail(`发布包校验失败：${problems.slice(0, 10).join('；') || 'MANIFEST 格式不一致'}`);
  }
  const manifestSha256 = createHash('sha256').update(recomputed).digest('hex');
  if (release.manifestSha256 !== manifestSha256) fail('release.json 的 manifestSha256 与重算结果不一致。');
  const components = componentSummary(entries);
  for (const name of BUNDLE_COMPONENTS) {
    const declaredComponent = release.components?.[name];
    if (!declaredComponent || declaredComponent.sha256 !== components[name].sha256 || declaredComponent.files !== components[name].files) {
      fail(`组件摘要不一致：${name}`);
    }
  }
  // 重新执行与构建期相同的身份规则，避免有人只改 release.json 的字段。
  const identity = resolveReleaseIdentity({
    environment: release.environment, displayVersion: release.displayVersion, baseVersion: release.baseVersion,
    commit: release.commit, tag: release.tag ?? null, builtAt: release.builtAt,
    runId: release.run?.id, runNumber: release.run?.number, toolchain: release.toolchain,
  });
  if (identity.publicOrigin !== release.publicOrigin) fail('release.json 的 publicOrigin 与环境合同不一致。');
  if (identity.releaseId !== release.releaseId || identity.artifactName !== release.artifactName) fail('release.json 的 releaseId/artifactName 与身份规则不一致。');
  if (expectEnvironment !== undefined && release.environment !== expectEnvironment) fail(`环境不符：期望 ${expectEnvironment}，实际 ${release.environment}。`);
  if (expectCommit !== undefined && release.commit !== expectCommit) fail(`提交不符：期望 ${expectCommit}，实际 ${release.commit}。`);
  return { ...identity, files: entries.length, manifestSha256, components, deploymentAuthorized: false };
}

const BUILD_OPTIONS = new Map([
  ['--environment', 'environment'], ['--display-version', 'displayVersion'], ['--base-version', 'baseVersion'],
  ['--commit', 'commit'], ['--tag', 'tag'], ['--built-at', 'builtAt'], ['--run-id', 'runId'],
  ['--run-number', 'runNumber'], ['--toolchain', 'toolchain'], ['--out', 'out'], ['--root', 'root'],
]);
const VERIFY_OPTIONS = new Map([['--dir', 'dir'], ['--expect-environment', 'expectEnvironment'], ['--expect-commit', 'expectCommit']]);

function parseOptions(allowed, argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = allowed.get(argv[index]);
    const value = argv[index + 1];
    if (!key || value === undefined || value.startsWith('--') || key in options) fail('未知、重复或缺少取值的参数；不接受任何批准开关。');
    options[key] = value;
  }
  return options;
}

const USAGE = `发布产物打包与校验，不打 tag、不部署：
  node scripts/release-bundle.mjs build --environment <preview|production> --display-version <X.Y.Z|X.Y.Z@sha12> \\
    --base-version <X.Y.Z> --commit <40位SHA> [--tag <prev-X.Y.Z|release-X.Y.Z>] --built-at <ISO8601> \\
    --run-id <str> --run-number <str> --toolchain <JSON> --out <dir> [--root <仓库根>]
  node scripts/release-bundle.mjs verify --dir <解包后的发布包目录> [--expect-environment <env>] [--expect-commit <40位SHA>]`;

function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help') { console.log(USAGE); return; }
  if (command === 'build') {
    const options = parseOptions(BUILD_OPTIONS, rest);
    for (const required of ['environment', 'displayVersion', 'baseVersion', 'commit', 'builtAt', 'runId', 'runNumber', 'toolchain', 'out']) {
      if (!(required in options)) fail(`缺少必填参数 --${required.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}。`);
    }
    let toolchain;
    try { toolchain = JSON.parse(options.toolchain); } catch { fail('--toolchain 必须是合法 JSON 字符串。'); }
    const result = buildBundle({ ...options, toolchain });
    console.error(`发布包已生成：${result.bundleDir}`);
    console.error(`环境 ${result.environment} · 展示版本 ${result.displayVersion} · commit ${result.commit}`);
    console.error('机器构建完成不代表人工验收或部署批准。');
    console.log(JSON.stringify({
      artifactName: result.artifactName, releaseId: result.releaseId, tarPath: result.tarPath,
      tarSha256: result.tarSha256, manifestSha256: result.manifestSha256,
      components: Object.fromEntries(BUNDLE_COMPONENTS.map(name => [name, result.components[name].sha256])),
      releaseJsonPath: result.releaseJsonPath,
    }));
    return;
  }
  if (command === 'verify') {
    const options = parseOptions(VERIFY_OPTIONS, rest);
    if (!options.dir) fail('缺少必填参数 --dir。');
    const result = verifyBundle(options);
    console.log(`校验通过：${result.files} 个文件，环境 ${result.environment}，展示版本 ${result.displayVersion}，commit ${result.commit}，manifest ${result.manifestSha256.slice(0, 16)}…；校验通过不代表已获部署批准。`);
    return;
  }
  fail(`未知子命令 ${command}。\n${USAGE}`);
}

// 入口判定必须走 realpath：Node 会把 ESM 入口解析成真实路径（例如 macOS 的 /tmp -> /private/tmp），
// 直接比较 resolve(process.argv[1]) 会不相等，导致 CLI 静默不执行却返回 0，被误当作“校验通过”。
function isDirectRun() {
  if (!process.argv[1]) return false;
  try { return pathToFileURL(realpathSync(resolve(process.argv[1]))).href === import.meta.url; } catch { return false; }
}
if (isDirectRun()) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
