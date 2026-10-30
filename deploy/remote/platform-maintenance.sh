#!/usr/bin/env bash
# 宿主只读看护 / 离线系统备份；不启动应用、不清理宿主或其它 Docker 资源。
# 依赖 Bash、Node >=22；Docker 使用本机 default context，不接受进程环境的远端地址。
set -euo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec node --input-type=module - "$HERE" "$@" <<'NODE'
import { constants, chmodSync, closeSync, createReadStream, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, statfsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { freemem, loadavg, totalmem, uptime } from 'node:os';
import { basename, dirname, join, normalize, parse, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

process.umask(0o077);
class MaintenanceError extends Error {}
function requireThat(condition, message) {
  if (!condition) throw new MaintenanceError(message);
}
function safePath(path) {
  requireThat(typeof path === 'string' && /^\/[A-Za-z0-9_./-]+$/.test(path)
    && path !== '/' && normalize(path) === path && !path.endsWith('/')
    && !path.split('/').some(part => part === '.' || part === '..'), '需要规范的安全绝对路径');
  return path;
}
function checkExistingPath(path) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split(sep)) {
    current = join(current, part);
    const info = lstatSync(current);
    requireThat(!info.isSymbolicLink(), '路径不得经过符号链接');
  }
}
function readSettings(envFile, environment) {
  safePath(envFile);
  checkExistingPath(envFile);
  const fd = openSync(envFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  const settings = Object.create(null);
  try {
    requireThat(fstatSync(fd).isFile(), 'env 必须是普通文件');
    const allowed = new Set(['GEEK_DEPLOYMENT_ENVIRONMENT', 'COMPOSE_PROJECT_NAME', 'STACK_ROOT', 'IMAGE_TAG', 'DB_PATH']);
    for (const line of readFileSync(fd, 'utf8').split(/\r?\n/)) {
      const eq = line.indexOf('=');
      const key = line.slice(0, eq).trim();
      if (eq < 1 || !allowed.has(key)) continue;
      requireThat(!Object.hasOwn(settings, key), `env 重复声明 ${key}`);
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      requireThat(value.length > 0, `env 缺少 ${key}`);
      settings[key] = value;
    }
    for (const key of allowed) requireThat(Object.hasOwn(settings, key), `env 缺少 ${key}`);
  } finally { closeSync(fd); }
  requireThat(settings.GEEK_DEPLOYMENT_ENVIRONMENT === environment, 'env 与请求环境不一致');
  requireThat(settings.COMPOSE_PROJECT_NAME === `yzgc-${environment}`, 'Compose 项目与环境不一致');
  safePath(settings.STACK_ROOT);
  requireThat(basename(settings.STACK_ROOT) === environment && envFile === join(settings.STACK_ROOT, `.env.${environment}`), 'env 不是本环境 STACK_ROOT 内的 canonical 文件');
  requireThat(/^[a-f0-9]{12}$/.test(settings.IMAGE_TAG), 'IMAGE_TAG 必须是明确的 sha12');
  requireThat(settings.DB_PATH === '/data/data.db', 'DB_PATH 不符合现行命名卷备份合同');
  return settings;
}
function docker(args, timeout = 30000) {
  const result = spawnSync('docker', ['--context', 'default', ...args], {
    encoding: 'utf8', timeout, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' },
  });
  requireThat(result.status === 0 && !result.error, `Docker ${args[0]} ${args[1]} 失败（退出码 ${result.status ?? 'unknown'}）`);
  return result.stdout.trim();
}
const containerFormat = '{"id":{{json .Id}},"image_id":{{json .Image}},"running":{{json .State.Running}},"status":{{json .State.Status}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"mounts":{{json .Mounts}}}';
const imageMetadataFormat = '{{range .Config.Env}}{{$key := index (split . "=") 0}}{{if or (eq $key "GEEK_DEPLOYMENT_ENVIRONMENT") (eq $key "GEEK_RELEASE_VERSION") (eq $key "GEEK_RELEASE_COMMIT")}}{{println .}}{{end}}{{end}}';

function requireNewOutput(output) {
  safePath(output);
  checkExistingPath(dirname(output));
  requireThat(lstatSync(dirname(output)).isDirectory(), '输出父路径必须是目录');
  let exists = true;
  try { lstatSync(output); } catch (error) {
    if (error.code === 'ENOENT') exists = false;
    else throw error;
  }
  requireThat(!exists, '输出目标已存在（包括空目录或符号链接），拒绝覆盖');
}

function verifySource(project, imageId) {
  const info = JSON.parse(docker(['container', 'inspect', `${project}-server`, '--format', containerFormat]));
  requireThat(info.running === true && info.project === project && info.service === 'server' && info.image_id === imageId, '运行中的本环境 server 与预期镜像 ID 不一致');
  requireThat(Array.isArray(info.mounts) && info.mounts.some(mount => mount.Type === 'volume' && mount.Name === `${project}-data` && mount.Destination === '/data'), '运行中的 server 未使用本环境数据卷');
  return info;
}

async function backup(here, settings, options, environment) {
  const root = settings.STACK_ROOT;
  const project = settings.COMPOSE_PROJECT_NAME;
  const tag = settings.IMAGE_TAG;
  let output = options['--out'];
  if (output) requireNewOutput(output);
  const exporter = join(here, 'export-stack-snapshot.mjs');
  safePath(exporter);
  checkExistingPath(exporter);
  requireThat(lstatSync(exporter).isFile(), '缺少同目录 export-stack-snapshot.mjs');
  const sourceRef = `${project}/server:${tag}`;
  const sourceId = docker(['image', 'inspect', sourceRef, '--format', '{{.Id}}']);
  requireThat(/^sha256:[a-f0-9]{64}$/.test(sourceId), '源镜像 ID 非法');
  verifySource(project, sourceId);
  requireThat(docker(['volume', 'inspect', `${project}-data`, '--format', '{{.Name}}']) === `${project}-data`, '本环境数据卷不存在');
  const metadata = Object.create(null);
  for (const line of docker(['image', 'inspect', sourceId, '--format', imageMetadataFormat]).split('\n')) {
    const eq = line.indexOf('=');
    const key = line.slice(0, eq);
    requireThat(['GEEK_DEPLOYMENT_ENVIRONMENT', 'GEEK_RELEASE_VERSION', 'GEEK_RELEASE_COMMIT'].includes(key) && !Object.hasOwn(metadata, key), '源镜像发布身份缺失或重复');
    metadata[key] = line.slice(eq + 1);
  }
  const version = metadata.GEEK_RELEASE_VERSION;
  requireThat(metadata.GEEK_DEPLOYMENT_ENVIRONMENT === environment && /^[a-f0-9]{40}$/.test(metadata.GEEK_RELEASE_COMMIT ?? '') && metadata.GEEK_RELEASE_COMMIT.startsWith(tag), '源镜像环境或提交与运行配置不一致');
  requireThat(typeof version === 'string' && (environment === 'production' ? /^\d+\.\d+\.\d+$/.test(version) : new RegExp(`^\\d+\\.\\d+\\.\\d+(?:-rc\\.[1-9]\\d*|-hf\\.[1-9]\\d*|-stable)@${tag}$`).test(version)), '源镜像版本与环境不一致');
  const helperRef = options['--helper-image'] ?? sourceRef;
  requireThat(/^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,255}$/.test(helperRef), 'helper-image 必须是明确的本地镜像引用');
  const helperId = helperRef === sourceRef ? sourceId : docker(['image', 'inspect', helperRef, '--format', '{{.Id}}']);
  requireThat(/^sha256:[a-f0-9]{64}$/.test(helperId), 'helper 镜像 ID 非法');
  // 镜像声明了 VOLUME /data；显式用 tmpfs 遮住，避免 helper 隐式创建匿名数据卷。
  // 源卷属于 UID 1000，目录可能是 700、数据库是 600；root 仅保留 DAC_OVERRIDE，卷仍只读。
  const isolation = ['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--memory', '512m', '--cpus', '0.5', '--pids-limit', '64', '--cap-drop', 'ALL', '--cap-add', 'DAC_OVERRIDE', '--security-opt', 'no-new-privileges:true', '--user', '0:0', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=256m', '--mount', 'type=tmpfs,dst=/data,tmpfs-size=1048576'];
  try {
    docker([...isolation, '--entrypoint', 'node', helperId, '--input-type=module', '-e', "const m = await import('/app/app/server/dist/lib/system-backup.js'); if (typeof m.prepareSystemBackup !== 'function') process.exit(2);"]);
  } catch {
    throw new MaintenanceError(options['--helper-image'] ? '指定的 helper 镜像未通过离线备份能力检查；未导出数据' : '当前 server 镜像没有可用的备份模块（旧正式 0.1.0 不支持）；如需导出，必须显式 --helper-image 指定已存在且经核对的备份镜像；不会自动换镜像或 pull/build');
  }
  const current = readSettings(options['--env-file'], environment);
  requireThat(Object.keys(settings).every(key => settings[key] === current[key]), '导出前运行配置已变化，停止备份');
  verifySource(project, sourceId);
  if (!output) {
    const parent = join(root, 'backups');
    try { mkdirSync(parent, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    checkExistingPath(parent);
    const info = lstatSync(parent);
    requireThat(info.isDirectory() && (info.mode & 0o077) === 0, 'STACK_ROOT/backups 必须是权限 700 的私有目录');
    output = join(parent, `system-${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}`);
  }
  requireNewOutput(output);
  mkdirSync(output, { mode: 0o700 });
  docker([...isolation,
    '--mount', `type=volume,src=${project}-data,dst=/source,readonly`,
    '--mount', `type=bind,src=${exporter},dst=/work/export-stack-snapshot.mjs,readonly`,
    '--mount', `type=bind,src=${output},dst=/output`,
    '--entrypoint', 'node', helperId, '/work/export-stack-snapshot.mjs', environment, version, tag,
  ], 30 * 60 * 1000);
  const after = readSettings(options['--env-file'], environment);
  requireThat(Object.keys(settings).every(key => settings[key] === after[key]), '导出期间运行配置已变化；保留归档，不生成成功收据');
  verifySource(project, sourceId);
  requireThat(readdirSync(output).sort().join(',') === 'manifest.json,system-backup.tar.gz', '导出产物不符合系统备份合同；保留现场，不生成成功收据');
  const hashes = {};
  for (const name of ['system-backup.tar.gz', 'manifest.json']) {
    const path = join(output, name);
    const info = lstatSync(path);
    requireThat(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, '备份产物必须是无链接的普通文件');
    chmodSync(path, 0o600);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    hashes[name] = hash.digest('hex');
    writeFileSync(`${path}.sha256`, `${hashes[name]}  ${name}\n`, { flag: 'wx', mode: 0o600 });
  }
  const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
  requireThat(manifest.format === 'yzgc-system-backup@1' && manifest.environment === environment && manifest.app?.version === version && manifest.app?.image_tag === tag && Array.isArray(manifest.files), '导出 manifest 与本环境版本不一致；不生成成功收据');
  const createdAt = new Date().toISOString();
  const dayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(createdAt)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const archiveDay = `${dayParts.year}-${dayParts.month}-${dayParts.day}`;
  const archiveRun = `${createdAt.replace(/[-:.]/g, '')}-${tag}`;
  const receipt = {
    format: 'yzgc-platform-backup-receipt@1', created_at: createdAt, environment, stack_root: root,
    source_image: { reference: sourceRef, id: sourceId }, helper_image: { reference: helperRef, id: helperId },
    backup_files: manifest.files.length, sha256: hashes,
    archive: { role: `platform-${environment}-backup`, prefix: `platform/${environment}/${archiveDay}/${archiveRun}/` },
  };
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  writeFileSync(join(output, 'receipt.json'), receiptText, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(output, 'receipt.json.sha256'), `${createHash('sha256').update(receiptText).digest('hex')}  receipt.json\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ created_at: receipt.created_at, environment, source_image_id: sourceId, helper_image_id: helperId, backup_files: receipt.backup_files, output, sha256: hashes }));
}

try {
  const [, , here, command, ...args] = process.argv;
  requireThat(command === 'status' || command === 'backup', '用法：platform-maintenance.sh status|backup --environment production|preview --env-file <canonical env> [backup: --out <全新绝对目录> --helper-image <本地镜像>]');
  const options = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const allowed = command === 'status' ? ['--environment', '--env-file'] : ['--environment', '--env-file', '--out', '--helper-image'];
    requireThat(allowed.includes(flag) && !Object.hasOwn(options, flag) && args[index + 1], '参数缺失、重复或未知');
    options[flag] = args[index + 1];
  }
  const environment = options['--environment'];
  requireThat(environment === 'production' || environment === 'preview', '必须显式选择 production 或 preview');
  const settings = readSettings(options['--env-file'], environment);
  const project = settings.COMPOSE_PROJECT_NAME;
  if (command === 'backup') {
    await backup(here, settings, options, environment);
  } else {
    const names = docker(['container', 'ls', '--all', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Names}}']).split('\n').filter(Boolean);
    const containers = names.map(name => {
      requireThat(['server', 'web', 'forum'].some(service => name === `${project}-${service}`), '本环境有无法识别的容器，停止采样');
      const info = JSON.parse(docker(['container', 'inspect', name, '--format', containerFormat]));
      requireThat(info.project === project, '容器 Compose 项目不匹配');
      return info;
    });
    const running = containers.filter(info => info.running).map(info => info.id);
    const resources = running.length ? docker(['stats', '--no-stream', '--format', '{{json .}}', ...running]).split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    const disk = statfsSync(settings.STACK_ROOT);
    console.log(JSON.stringify({
      created_at: new Date().toISOString(), environment, containers, resources,
      host: { memory_total_bytes: totalmem(), memory_free_bytes: freemem(), load_average: loadavg(), uptime_seconds: uptime(), disk_total_bytes: disk.blocks * disk.bsize, disk_available_bytes: disk.bavail * disk.bsize },
    }));
  }
} catch (error) {
  console.error(error instanceof MaintenanceError ? error.message : '维护失败：I/O 或 Docker 响应不可用；未执行清理或应用启停');
  process.exitCode = 1;
}
NODE
