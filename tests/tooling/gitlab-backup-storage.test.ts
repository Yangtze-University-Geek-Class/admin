import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const backup = join(root, 'deploy/gitlab/backup.sh');
const restore = join(root, 'deploy/gitlab/restore-drill.sh');
const PINNED_IMAGE = 'gitlab/gitlab-ce@sha256:bb79dc86267c557fd11e7feb0cd9dd506dd02e991ecdd6cae11ca7d7e5d36fc3';
// /bin/bash 在 macOS 是 3.2（没有 readarray），脚本需要 bash 4+，按 PATH 解析实际版本
const BASH = execFileSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();
const REAL_SHA256SUM = (() => {
  try {
    return execFileSync('sh', ['-c', 'command -v sha256sum'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
})();
const roots: string[] = [];
let drillRunSerial = 0;
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

// 假 docker / gpg / node / sha256sum + 假 Garage 对象树：不连真实主机，只在临时目录里跑完整演练
function drillFixture(options: { image?: string; archiveImage?: string; configArchive?: 'symlink' | 'absolute'; failAt?: 'restore'; removeContainerFails?: boolean; stamp?: string } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'geek-restore-drill-')));
  roots.push(dir);
  const bin = join(dir, 'bin');
  const drillRoot = join(dir, 'drill-root');
  const srv = join(dir, 'srv-gitlab');
  const objects = join(dir, 'objects');
  for (const path of [bin, srv, objects]) mkdirSync(path);

  const compose = join(srv, 'docker-compose.yml');
  writeFileSync(compose, `services:\n  gitlab:\n    image: ${options.image ?? PINNED_IMAGE}\n`, { mode: 0o600 });
  const archiveTool = join(srv, 'garage-archive.mjs');
  writeFileSync(archiveTool, '// synthetic archive adapter\n', { mode: 0o600 });

  // 假 S3/远端：加密归档本体，演练失败后必须原样还在
  const encryptedBackup = '20261020T031500_gitlab_backup.tar.gpg';
  const encryptedConfig = 'gitlab_config_20261020T031500.tar.gpg';
  const encryptedFiles: Record<string, string> = {
    [encryptedBackup]: 'synthetic encrypted backup bytes',
    [encryptedConfig]: 'synthetic encrypted config bytes',
  };
  // SHA256SUMS 用真实摘要，sha256sum -c 才能通过
  const sums = Object.entries(encryptedFiles)
    .map(([name, content]) => `${createHash('sha256').update(content).digest('hex')}  ${name}`)
    .join('\n') + '\n';
  encryptedFiles.SHA256SUMS = sums;
  for (const [name, content] of Object.entries(encryptedFiles)) writeFileSync(join(objects, name), content, { mode: 0o600 });
  // 适配器 resolve-gitlab-run 返回的对象清单：路径 + 字节数，演练脚本先核对再下载
  const objectsJson = JSON.stringify(Object.entries(encryptedFiles).map(([path, content]) => ({ path, bytes: Buffer.byteLength(content) })));

  // 假 gpg 的“解密”结果：配置归档里必须有 srv/gitlab/config/gitlab-secrets.json，以及备份当时的 compose
  const stage = join(dir, 'stage');
  mkdirSync(join(stage, 'srv/gitlab/config'), { recursive: true });
  writeFileSync(join(stage, 'srv/gitlab/config/gitlab-secrets.json'), '{"synthetic":"secret"}\n', { mode: 0o600 });
  writeFileSync(join(stage, 'srv/gitlab/docker-compose.yml'), `services:\n  gitlab:\n    image: ${options.archiveImage ?? PINNED_IMAGE}\n`, { mode: 0o600 });
  const plainConfigTar = join(dir, 'plain-config.tar');
  const configMembers = ['srv/gitlab/config/gitlab-secrets.json', 'srv/gitlab/docker-compose.yml'];
  if (options.configArchive === 'symlink') {
    symlinkSync('/etc/passwd', join(stage, 'srv/gitlab/config/evil-link'));
    configMembers.push('srv/gitlab/config/evil-link');
  }
  if (options.configArchive === 'absolute') {
    // -P 保留绝对路径：解压这类成员会直接写到根文件系统
    execFileSync('/usr/bin/tar', ['-P', '-cf', plainConfigTar, '-C', stage, ...configMembers, '/etc/hosts']);
  } else {
    execFileSync('/usr/bin/tar', ['-cf', plainConfigTar, '-C', stage, ...configMembers]);
  }

  const state = join(dir, 'docker-state.json');
  const dockerCalls = join(dir, 'docker-calls.jsonl');
  const gpgCalls = join(dir, 'gpg-calls.jsonl');
  writeFileSync(state, JSON.stringify({ container: false, failAt: options.failAt ?? null, removeContainerFails: options.removeContainerFails ?? false, secretsPresentAtStart: false, workDir: null }));

  writeFileSync(join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const statePath = ${JSON.stringify(state)};
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
fs.appendFileSync(${JSON.stringify(dockerCalls)}, JSON.stringify(args) + '\\n');
const name = 'gitlab-drill';
if (args[0] === 'inspect') process.exit(state.container ? 0 : 1);
if (args[0] === 'run') {
  const mount = args.find(arg => arg.endsWith(':/etc/gitlab')) ?? '';
  const hostMount = mount.replace(/:\\/etc\\/gitlab$/, '') || null;
  state.workDir = hostMount ? hostMount.replace(/\\/config$/, '') : null;
  state.secretsPresentAtStart = !!hostMount && fs.existsSync(hostMount + '/gitlab-secrets.json');
  state.container = true; save();
  process.exit(0);
}
if (args[0] === 'logs' && args[1] === name) { console.log('gitlab Reconfigured!'); process.exit(0); }
if (args[0] === 'exec' && args[1] === name) {
  const command = args.slice(2);
  if (command.includes('gitlab-backup') && state.failAt === 'restore') process.exit(41);
  if (command.includes('gitlab-ctl') && command.includes('status')) {
    console.log('run: puma: (pid 11) 5s; run: postgresql: (pid 12) 5s');
    process.exit(0);
  }
  process.exit(0);
}
if (args[0] === 'exec' && args[1] === 'gitlab' && args.includes('gitlab-rails')) {
  console.log('{"projects":3,"users":2,"issues":1}');
  process.exit(0);
}
if (args[0] === 'rm' && args[1] === '-f' && args[2] === name) {
  if (state.removeContainerFails) process.exit(42);
  state.container = false; save();
  process.exit(0);
}
process.exit(43);
`, { mode: 0o700 });

  writeFileSync(join(bin, 'gpg'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(gpgCalls)}, JSON.stringify(args) + '\\n');
const out = args[args.indexOf('--output') + 1];
const input = args[args.length - 1];
if (!out || !input) process.exit(2);
if (/gitlab_config_.*\\.tar\\.gpg$/.test(input)) fs.copyFileSync(${JSON.stringify(plainConfigTar)}, out);
else fs.writeFileSync(out, 'synthetic backup tar bytes');
process.exit(0);
`, { mode: 0o700 });

  // 假 node：只接管归档适配器与 JSON 解析，其余转交给真实 node
  writeFileSync(join(bin, 'node'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const args = process.argv.slice(2);
const delegate = () => {
  const result = cp.spawnSync(process.execPath, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
};
if (args.includes('--input-type=module')) delegate();
if (args[1] === 'resolve-gitlab-run') {
  console.log(JSON.stringify({ day: '2026-10-20', prefix: 'gitlab/2026-10-20/20261020T031500/', objects: ${objectsJson} }));
  process.exit(0);
}
if (args[1] === 'get-tree') {
  const destination = args[args.indexOf('--destination') + 1];
  fs.mkdirSync(destination, { recursive: true });
  for (const name of fs.readdirSync(${JSON.stringify(objects)})) {
    fs.copyFileSync(path.join(${JSON.stringify(objects)}, name), path.join(destination, name));
  }
  process.exit(0);
}
process.exit(3);
`, { mode: 0o700 });

  writeFileSync(join(bin, 'sha256sum'), `#!${process.execPath}
const cp = require('node:child_process');
const real = process.env.REAL_SHA256SUM;
if (!real) process.exit(0);
const result = cp.spawnSync(real, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o700 });

  const run = (extra: string[] = [], extraEnv: Record<string, string> = {}) => spawnSync(BASH, [restore, '--run', '2026-10-20/20261020T031500', ...extra], {
    encoding: 'utf8',
    timeout: 20000,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: dir,
      REAL_SHA256SUM,
      BACKUP_S3_ENDPOINT: 'https://s3.example.invalid',
      BACKUP_S3_REGION: 'test-region-1',
      BACKUP_S3_BUCKET: 'synthetic-backup',
      BACKUP_S3_PREFIX: 'yzgc/test/backup/',
      BACKUP_S3_ACCESS_KEY_ID: 'synthetic_access_key',
      BACKUP_S3_SECRET_ACCESS_KEY: 'synthetic_secret_key',
      GPG_PASSPHRASE: 'synthetic_passphrase',
      GITLAB_DRILL_ROOT: drillRoot,
      GITLAB_COMPOSE_FILE: compose,
      GITLAB_ARCHIVE_TOOL: archiveTool,
      GITLAB_DRILL_STAMP: options.stamp ?? `test-${process.pid}-${++drillRunSerial}`,
      ...extraEnv,
    },
  });

  const readState = () => JSON.parse(readFileSync(state, 'utf8')) as {
    container: boolean; failAt: string | null; removeContainerFails: boolean;
    secretsPresentAtStart: boolean; workDir: string | null;
  };
  const calls = () => (existsSync(dockerCalls) ? readFileSync(dockerCalls, 'utf8').trim().split('\n').filter(Boolean) : [])
    .map(line => (JSON.parse(line) as string[]).join(' '));
  return { dir, bin, drillRoot, objects, compose, encryptedFiles, state: readState, calls, run, dockerCalls, gpgCalls };
}

describe('GitLab restore drill failure teardown and image pinning', () => {
  it('removes the started container and the whole work directory (including plaintext secrets) on failure, keeping the encrypted archive', () => {
    const f = drillFixture({ failAt: 'restore' });
    const result = f.run();

    // 假 docker 让恢复步骤以 41 失败：原始退出码必须原样保留
    expect(result.status, result.stderr).toBe(41);
    const state = f.state();
    const workDir = state.workDir;
    expect(workDir, 'docker run must mount a work directory').toBeTruthy();
    // 失败前明文密钥确实已写进挂载目录，否则这条断言没有意义
    expect(state.secretsPresentAtStart).toBe(true);

    expect(f.calls()).toContain('rm -f gitlab-drill');
    expect(state.container).toBe(false);
    expect(existsSync(workDir!)).toBe(false);
    expect(existsSync(join(workDir!, 'config/gitlab-secrets.json'))).toBe(false);
    expect(readdirSync(f.drillRoot)).toEqual([]);

    // 原始加密归档（远端对象）保持原样
    expect(readdirSync(f.objects).sort()).toEqual(Object.keys(f.encryptedFiles).sort());
    for (const [name, content] of Object.entries(f.encryptedFiles)) {
      expect(readFileSync(join(f.objects, name), 'utf8')).toBe(content);
    }
    expect(result.stderr).toContain('Drill failed; removing gitlab-drill');
  });

  it('warns but keeps the original exit code when teardown itself fails', () => {
    const f = drillFixture({ failAt: 'restore', removeContainerFails: true });
    const result = f.run();

    expect(result.status, result.stderr).toBe(41);
    expect(result.stderr).toContain('Warning: failed to remove container gitlab-drill');
    // 工作目录清理不因容器删除失败而中断
    expect(existsSync(f.state().workDir!)).toBe(false);
  });

  it('rejects a non-digest image before downloading or decrypting anything', () => {
    const f = drillFixture({ image: 'gitlab/gitlab-ce:latest' });
    const result = f.run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gitlab/gitlab-ce:latest');
    expect(result.stderr).toContain('is not a pinned digest');
    expect(existsSync(f.gpgCalls)).toBe(false);
    expect(existsSync(f.dockerCalls)).toBe(false);
    expect(existsSync(f.drillRoot)).toBe(false);
  });

  it('rejects a well-formed but unreviewed digest and names both values', () => {
    const unreviewed = `gitlab/gitlab-ce@sha256:${'a'.repeat(64)}`;
    const f = drillFixture({ image: unreviewed });
    const result = f.run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(unreviewed);
    expect(result.stderr).toContain(PINNED_IMAGE);
    expect(existsSync(f.gpgCalls)).toBe(false);
    expect(existsSync(f.dockerCalls)).toBe(false);
  });

  it('accepts the reviewed pinned digest and starts the drill container', () => {
    const f = drillFixture({ failAt: 'restore' });
    const result = f.run();

    expect(f.calls().some(call => call.startsWith('run -d --name gitlab-drill --hostname gitlab-drill'))).toBe(true);
    expect(result.stderr).not.toContain('is not a pinned digest');
    expect(f.state().secretsPresentAtStart).toBe(true);
  });

  it('refuses a backup whose archived compose pins a different GitLab image', () => {
    // 目标机 compose 是被复核过的 digest，但配置归档里记录的是另一个版本：这次演练证明不了「被复核的版本能读这份备份」。
    const f = drillFixture({ archiveImage: 'gitlab/gitlab-ce@sha256:' + 'a'.repeat(64) });
    const result = f.run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('配置归档里的 GitLab 镜像是 gitlab/gitlab-ce@sha256:');
    expect(result.stderr).toContain('不一致');
    expect(f.calls().some(call => call.startsWith('run -d --name gitlab-drill'))).toBe(false);
    expect(f.state().secretsPresentAtStart).toBe(false);
  });

  it.each([
    ['symlink', 'symlink 成员'],
    ['absolute', '绝对路径成员'],
  ] as const)('refuses to extract a config archive with a %s before starting anything', (configArchive, label) => {
    // 解包以 root 身份发生在 WORK_DIR 里，紧接着就把其中的 gitlab-secrets.json 复制成运行配置：
    // 链接或绝对路径能把写入带出目录，必须先逐条核对再解压。
    const f = drillFixture({ configArchive });
    const result = f.run();

    expect(result.status, label).not.toBe(0);
    expect(result.stderr).toContain('拒绝解压');
    expect(f.calls().some(call => call.startsWith('run -d --name gitlab-drill'))).toBe(false);
  });

  it('refuses to reuse an existing drill directory and never deletes what is in it', () => {
    // 同一秒重跑或上一次保留的现场：复用目录会让失败清理 rm -rf 掉别人保留的明文密钥与日志。
    const f = drillFixture({ stamp: 'retained-scene' });
    mkdirSync(join(f.drillRoot, 'retained-scene'), { recursive: true });
    writeFileSync(join(f.drillRoot, 'retained-scene/kept.log'), 'retained scene\n');

    const result = f.run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('演练目录已存在');
    expect(readFileSync(join(f.drillRoot, 'retained-scene/kept.log'), 'utf8')).toBe('retained scene\n');
    expect(f.calls().some(call => call.startsWith('run -d --name gitlab-drill'))).toBe(false);
  });

  it('keeps the drill scene on success and only removes it with --cleanup', () => {
    const retained = drillFixture();
    const result = retained.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Drill completed successfully. Container and work directory retained.');
    const workDir = retained.state().workDir!;
    expect(retained.state().container).toBe(true);
    expect(existsSync(join(workDir, 'config/gitlab-secrets.json'))).toBe(true);
    // 恢复完成后不再保留解密后的备份包
    expect(existsSync(join(workDir, 'data/backups/20261020T031500_gitlab_backup.tar'))).toBe(false);
    expect(readdirSync(retained.drillRoot)).toHaveLength(1);

    const cleaned = drillFixture();
    const cleanupResult = cleaned.run(['--cleanup']);
    expect(cleanupResult.status, cleanupResult.stderr).toBe(0);
    expect(cleanupResult.stdout).toContain('Cleaned up gitlab-drill container and work directory');
    expect(cleaned.state().container).toBe(false);
    expect(existsSync(cleaned.state().workDir!)).toBe(false);
  });
});

describe('GitLab backup wiring', () => {
  it('refuses restoration before any download when the backup target has no credentials', () => {
    const f = drillFixture();
    const result = f.run(['--environment', 'preview'], { BACKUP_S3_ACCESS_KEY_ID: '' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('BACKUP_S3_ACCESS_KEY_ID');
    expect(existsSync(f.dockerCalls)).toBe(false);
    expect(existsSync(f.gpgCalls)).toBe(false);
  });

  it('keeps both shell entrypoints syntactically valid', () => {
    for (const script of [backup, restore]) {
      const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    }
  });
});
