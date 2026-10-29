import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'deploy/remote/garage-archive.mjs');
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture(): ArchiveFixture {
  const dir = mkdtempSync(join(tmpdir(), 'geek-garage-archive-'));
  roots.push(dir);
  const bin = join(dir, 'bin');
  const objects = join(dir, 'objects');
  const log = join(dir, 'calls.jsonl');
  mkdirSync(bin);
  mkdirSync(objects);
  writeFileSync(join(bin, 'rclone'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, config: {
  type: process.env.RCLONE_CONFIG_GEEKGARAGE_TYPE,
  provider: process.env.RCLONE_CONFIG_GEEKGARAGE_PROVIDER,
  endpoint: process.env.RCLONE_CONFIG_GEEKGARAGE_ENDPOINT,
  region: process.env.RCLONE_CONFIG_GEEKGARAGE_REGION,
  pathStyle: process.env.RCLONE_CONFIG_GEEKGARAGE_FORCE_PATH_STYLE,
  hasAccess: Boolean(process.env.RCLONE_CONFIG_GEEKGARAGE_ACCESS_KEY_ID),
  hasSecret: Boolean(process.env.RCLONE_CONFIG_GEEKGARAGE_SECRET_ACCESS_KEY),
} }) + '\\n');
if (process.env.FAKE_RCLONE_FAIL === '1') {
  console.error('provider error ' + process.env.RCLONE_CONFIG_GEEKGARAGE_SECRET_ACCESS_KEY);
  process.exit(91);
}
function remote(value) {
  const match = /^geekgarage:([^/]+)\\/(.+)$/.exec(value || '');
  if (!match) process.exit(92);
  return { bucket: match[1], key: match[2], file: path.join(${JSON.stringify(objects)}, match[1], ...match[2].split('/')) };
}
if (args[0] === 'lsjson' && args.includes('--stat')) {
  const item = remote(args[1]);
  // 真实 rclone v1.75.0 对 Garage 里不存在的键：退出码 0，输出一个空路径的目录条目（rc.27 的 cdn-upload 实测）。
  if (!fs.existsSync(item.file) || !fs.statSync(item.file).isFile()) {
    console.log(JSON.stringify({ Path: '', Name: '', Size: -1, ModTime: '', IsDir: true }));
    process.exit(0);
  }
  const info = fs.statSync(item.file);
  console.log(JSON.stringify({ Path: path.basename(item.file), Name: path.basename(item.file), Size: info.size, IsDir: false }));
} else if (args[0] === 'copyto') {
  const item = remote(args[2]);
  if (fs.existsSync(item.file)) process.exit(4);
  fs.mkdirSync(path.dirname(item.file), { recursive: true });
  fs.copyFileSync(args[1], item.file);
} else if (args[0] === 'cat') {
  const item = remote(args[1]);
  if (!fs.existsSync(item.file)) process.exit(3);
  process.stdout.write(fs.readFileSync(item.file));
} else if (args[0] === 'deletefile') {
  const item = remote(args[1]);
  if (!fs.existsSync(item.file)) process.exit(3);
  fs.unlinkSync(item.file);
} else if (args[0] === 'lsjson' && args.includes('--recursive')) {
  const item = remote(args[1]);
  const base = item.file;
  const output = [];
  function walk(current, prefix = '') {
    if (!fs.existsSync(current)) return;
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name);
      const rel = prefix ? prefix + '/' + name : name;
      const info = fs.statSync(file);
      if (info.isDirectory()) walk(file, rel);
      else output.push({ Path: rel, Name: name, Size: info.size, IsDir: false });
    }
  }
  walk(base);
  console.log(JSON.stringify(output));
} else {
  console.error('unexpected rclone command');
  process.exit(93);
}
`, { mode: 0o700 });
  const credentials = {
    GITLAB_BACKUP_S3_ACCESS_KEY_ID: 'synthetic-access',
    GITLAB_BACKUP_S3_SECRET_ACCESS_KEY: 'synthetic-secret-never-disclose',
    GITLAB_PREVIEW_BACKUP_S3_ACCESS_KEY_ID: 'gitlab-preview-access',
    GITLAB_PREVIEW_BACKUP_S3_SECRET_ACCESS_KEY: 'gitlab-preview-secret-never-disclose',
    PLATFORM_PREVIEW_BACKUP_S3_ACCESS_KEY_ID: 'preview-access',
    PLATFORM_PREVIEW_BACKUP_S3_SECRET_ACCESS_KEY: 'preview-secret-never-disclose',
    PLATFORM_PRODUCTION_BACKUP_S3_ACCESS_KEY_ID: 'production-access',
    PLATFORM_PRODUCTION_BACKUP_S3_SECRET_ACCESS_KEY: 'production-secret-never-disclose',
    PREVIEW_PRIVATE_INDEX_S3_ACCESS_KEY_ID: 'preview-index-access',
    PREVIEW_PRIVATE_INDEX_S3_SECRET_ACCESS_KEY: 'preview-index-secret-never-disclose',
    PRODUCTION_PRIVATE_INDEX_S3_ACCESS_KEY_ID: 'production-index-access',
    PRODUCTION_PRIVATE_INDEX_S3_SECRET_ACCESS_KEY: 'production-index-secret-never-disclose',
  };
  const run = (args: string[], extraEnv: Record<string, string> = {}) => spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8', timeout: 15000,
    env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir, FAKE_RCLONE_ROOT: objects, ...credentials, ...extraEnv },
  });
  const calls = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  return { dir, bin, objects, log, credentials, run, calls };
}

type ManifestMode = 'full' | 'missing' | 'truncated' | 'forged';

interface ArchiveFixture {
  dir: string;
  bin: string;
  objects: string;
  log: string;
  credentials: Record<string, string>;
  run: (args: string[], extraEnv?: Record<string, string>) => SpawnSyncReturns<string>;
  calls: () => { args: string[]; config: Record<string, unknown> }[];
}

// 用真实 SHA-256 造一个 run：manifest 模式覆盖正常、缺清单、被截断、摘要被伪造四种情况
function writeRun(f: ArchiveFixture, prefix: string, files: Record<string, string>, mode: ManifestMode = 'full') {
  const source = join(f.dir, 'run-src', prefix.replaceAll('/', '_'));
  mkdirSync(source, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(source, name), body, { mode: 0o600 });
  if (mode !== 'missing') {
    const names = Object.keys(files);
    const listed = mode === 'truncated' ? names.slice(0, 1) : names;
    const lines = listed.map((name, index) => {
      const digest = mode === 'forged' && index === 0 ? '0'.repeat(64) : createHash('sha256').update(files[name]).digest('hex');
      return `${digest}  ${name}`;
    });
    writeFileSync(join(source, 'SHA256SUMS'), `${lines.join('\n')}\n`, { mode: 0o600 });
  }
  const uploaded = f.run(['put-tree', '--role', 'gitlab-backup', '--source', source, '--prefix', prefix]);
  expect(uploaded.status, uploaded.stderr).toBe(0);
  return source;
}

describe('Garage immutable archive adapter', () => {
  it('uploads a GitLab run additively, reuses byte-identical objects and rejects a conflicting key', () => {
    const f = fixture();
    const source = join(f.dir, 'gitlab-run');
    mkdirSync(source);
    writeFileSync(join(source, 'backup.tar.gpg'), 'encrypted backup', { mode: 0o600 });
    writeFileSync(join(source, 'SHA256SUMS'), 'synthetic checksum\n', { mode: 0o600 });
    const args = ['put-tree', '--role', 'gitlab-backup', '--source', source, '--prefix', 'gitlab/2026-10-27/20261027T040500/'];
    const first = f.run(args);
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ stored: 2, exists: 0, bucket: 'geek-backup' });
    expect(readFileSync(join(f.objects, 'geek-backup/gitlab/2026-10-27/20261027T040500/backup.tar.gpg'), 'utf8')).toBe('encrypted backup');

    const second = f.run(args);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({ stored: 0, exists: 2 });
    expect(f.calls().filter(call => call.args[0] === 'copyto')).toHaveLength(2);

    writeFileSync(join(source, 'backup.tar.gpg'), 'different encrypted backup', { mode: 0o600 });
    const conflict = f.run(args);
    expect(conflict.status).toBe(1);
    expect(conflict.stderr).toContain('同键内容冲突');
    expect(conflict.stdout + conflict.stderr).not.toContain('synthetic-secret-never-disclose');
    expect(readFileSync(join(f.objects, 'geek-backup/gitlab/2026-10-27/20261027T040500/backup.tar.gpg'), 'utf8')).toBe('encrypted backup');

    for (const call of f.calls()) {
      expect(call.config).toEqual({
        type: 's3', provider: 'Other', endpoint: 'https://cdn.yangtzeu.work', region: 'garage', pathStyle: 'true', hasAccess: true, hasSecret: true,
      });
      expect(['lsjson', 'copyto', 'cat']).toContain(call.args[0]);
      expect(call.args).not.toContain('sync');
      expect(call.args).not.toContain('purge');
      expect(call.args).not.toContain('delete');
    }
  });

  it('downloads every object by full GET into a new tree and never overwrites local evidence', () => {
    const f = fixture();
    const source = join(f.dir, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'a.gpg'), 'alpha', { mode: 0o600 });
    mkdirSync(join(source, 'nested'));
    writeFileSync(join(source, 'nested/b.gpg'), 'beta', { mode: 0o600 });
    expect(f.run(['put-tree', '--role', 'gitlab-backup', '--source', source, '--prefix', 'gitlab/2026-10-27/run-a/']).status).toBe(0);
    const destination = join(f.dir, 'download');
    const downloaded = f.run(['get-tree', '--role', 'gitlab-backup', '--prefix', 'gitlab/2026-10-27/run-a/', '--destination', destination]);
    expect(downloaded.status, downloaded.stderr).toBe(0);
    expect(JSON.parse(downloaded.stdout)).toMatchObject({ downloaded: 2, bucket: 'geek-backup' });
    expect(readFileSync(join(destination, 'a.gpg'), 'utf8')).toBe('alpha');
    expect(readFileSync(join(destination, 'nested/b.gpg'), 'utf8')).toBe('beta');
    expect(statSync(join(destination, 'a.gpg')).mode & 0o777).toBe(0o600);
    writeFileSync(join(destination, 'a.gpg'), 'preserve me', { mode: 0o600 });
    const repeated = f.run(['get-tree', '--role', 'gitlab-backup', '--prefix', 'gitlab/2026-10-27/run-a/', '--destination', destination]);
    expect(repeated.status).toBe(1);
    expect(readFileSync(join(destination, 'a.gpg'), 'utf8')).toBe('preserve me');
  });

  it('keeps preview/production content indexes in separate private buckets and requires a 0600 validated index', () => {
    const f = fixture();
    const commit = 'a'.repeat(40);
    const index = join(f.dir, 'sha256.json');
    writeFileSync(index, `${JSON.stringify({ schema_version: 1, hashes: { ['b'.repeat(64)]: { bytes: 3, keys: ['static/site/assets/app-12345678.js'] } } })}\n`, { mode: 0o600 });
    for (const environment of ['preview', 'production'] as const) {
      const result = f.run(['put-file', '--role', `${environment}-content-index`, '--source', index, '--key', `indexes/content/${commit}/sha256.json`]);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout).bucket).toBe(`geek-${environment}-private`);
      expect(readFileSync(join(f.objects, `geek-${environment}-private/indexes/content/${commit}/sha256.json`), 'utf8')).toContain('schema_version');
    }
    chmodSync(index, 0o644);
    expect(f.run(['put-file', '--role', 'preview-content-index', '--source', index, '--key', `indexes/content/${'c'.repeat(40)}/sha256.json`]).status).toBe(1);
    chmodSync(index, 0o600);
    expect(f.run(['put-file', '--role', 'preview-content-index', '--source', index, '--key', 'indexes/content/not-a-commit/sha256.json']).status).toBe(1);
  });

  it('requires an explicit run, lists candidates and never downloads or guesses', () => {
    const f = fixture();
    writeRun(f, 'gitlab/2026-10-26/20261026T030000/', { 'a.tar.gpg': 'alpha-one' });
    writeRun(f, 'gitlab/2026-10-27/20261027T030000/', { 'a.tar.gpg': 'alpha-two' });
    // 拥有写凭据的人后来追加的“更晚”run：没有 --run 时它绝不能被自动选中
    writeRun(f, 'gitlab/2026-10-27/20261027T235959/', { 'a.tar.gpg': 'forged-later' });
    const baseline = f.calls().length;

    const implicit = f.run(['resolve-gitlab-run']);
    expect(implicit.status).toBe(1);
    expect(implicit.stdout).toBe('');
    expect(implicit.stderr).toContain('--run');
    expect(implicit.stderr).toContain('2026-10-27/20261027T235959');
    // 没有选中任何 run，因此一个对象都没有下载
    expect(f.calls().slice(baseline).filter(call => call.args[0] === 'cat')).toHaveLength(0);

    const listed = f.run(['list-gitlab-runs']);
    expect(listed.status, listed.stderr).toBe(0);
    expect(JSON.parse(listed.stdout).runs).toEqual([
      '2026-10-26/20261026T030000',
      '2026-10-27/20261027T030000',
      '2026-10-27/20261027T235959',
    ]);
    const dayListed = f.run(['list-gitlab-runs', '--day', '2026-10-26']);
    expect(JSON.parse(dayListed.stdout).runs).toEqual(['2026-10-26/20261026T030000']);
    expect(f.run(['list-gitlab-runs', '--day', '2026/10/26']).status).toBe(1);
    expect(f.calls().slice(baseline).filter(call => call.args[0] === 'cat')).toHaveLength(0);

    // 显式点名旧 run 时，后来追加的 run 不影响结果
    const selected = f.run(['resolve-gitlab-run', '--run', '2026-10-26/20261026T030000']);
    expect(selected.status, selected.stderr).toBe(0);
    expect(JSON.parse(selected.stdout)).toMatchObject({
      day: '2026-10-26', run: '20261026T030000', prefix: 'gitlab/2026-10-26/20261026T030000/',
    });
    expect(JSON.parse(selected.stdout).objects.map((item: { path: string }) => item.path).sort()).toEqual(['SHA256SUMS', 'a.tar.gpg']);
    expect(selected.stdout).not.toContain('alpha-one');

    for (const run of ['2026-10-26', '2026-10-26/../etc', '../../etc/passwd', '2026-10/26/x', '/abs/2026-10-26/x']) {
      expect(f.run(['resolve-gitlab-run', '--run', run]).status, run).toBe(1);
    }
    const absent = f.run(['resolve-gitlab-run', '--run', '2026-10-27/20261027T999999']);
    expect(absent.status).toBe(1);
    expect(absent.stderr).toContain('远端不存在');
  });

  it('fails closed when SHA256SUMS is missing, truncated or forged', () => {
    const f = fixture();
    writeRun(f, 'gitlab/2026-10-27/missing/', { 'a.tar.gpg': 'alpha' }, 'missing');
    writeRun(f, 'gitlab/2026-10-27/truncated/', { 'a.tar.gpg': 'alpha', 'b.tar.gpg': 'beta' }, 'truncated');
    writeRun(f, 'gitlab/2026-10-27/forged/', { 'a.tar.gpg': 'alpha', 'b.tar.gpg': 'beta' }, 'forged');

    const missingResolve = f.run(['resolve-gitlab-run', '--run', '2026-10-27/missing']);
    expect(missingResolve.status).toBe(1);
    expect(missingResolve.stderr).toContain('SHA256SUMS');
    const missingListed = f.run(['list-gitlab-runs']);
    expect(JSON.parse(missingListed.stdout).runs).not.toContain('2026-10-27/missing');

    const missingDestination = join(f.dir, 'dl-missing');
    const missing = f.run(['get-tree', '--role', 'gitlab-backup', '--prefix', 'gitlab/2026-10-27/missing/', '--destination', missingDestination, '--require-manifest']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('SHA256SUMS');
    expect(readdirSync(missingDestination)).toEqual([]);

    const truncatedDestination = join(f.dir, 'dl-truncated');
    const truncated = f.run(['get-tree', '--role', 'gitlab-backup', '--prefix', 'gitlab/2026-10-27/truncated/', '--destination', truncatedDestination, '--require-manifest']);
    expect(truncated.status).toBe(1);
    expect(truncated.stderr).toContain('不一致');
    // 清单只覆盖一个对象时不允许“部分通过”：只有清单本身落盘，归档对象一个字节都没提交
    expect(readdirSync(truncatedDestination)).toEqual(['SHA256SUMS']);

    const forgedDestination = join(f.dir, 'dl-forged');
    const forged = f.run(['get-tree', '--role', 'gitlab-backup', '--prefix', 'gitlab/2026-10-27/forged/', '--destination', forgedDestination, '--require-manifest']);
    expect(forged.status).toBe(1);
    expect(forged.stderr).toContain('SHA-256');
    expect(forged.stdout).toBe('');
    // 摘要不符的对象只存在过 .partial，随后被丢弃
    expect(readdirSync(forgedDestination)).toEqual(['SHA256SUMS']);
    expect(existsSync(join(forgedDestination, 'a.tar.gpg'))).toBe(false);
    expect(existsSync(join(forgedDestination, 'a.tar.gpg.partial'))).toBe(false);
  });

  it('restores only the explicitly named run after verifying every object and prints a content-free summary', () => {
    const f = fixture();
    const files = {
      '20261027_gitlab_backup.tar.gpg': 'encrypted backup payload',
      'gitlab_config_20261027.tar.gpg': 'encrypted config payload',
    };
    writeRun(f, 'gitlab/2026-10-27/20261027T040500/', files);
    // 同一阶段追加的第二个 run 不应被“最新”逻辑带进来
    writeRun(f, 'gitlab/2026-10-27/20261027T050000/', { '20261027_gitlab_backup.tar.gpg': 'later payload' });
    const baseline = f.calls().length;

    const destination = join(f.dir, 'dl-ok');
    const result = f.run(['get-tree', '--role', 'gitlab-backup', '--prefix', 'gitlab/2026-10-27/20261027T040500/', '--destination', destination, '--require-manifest']);
    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({ downloaded: 3, manifestVerified: true, prefix: 'gitlab/2026-10-27/20261027T040500/' });
    expect(summary.objects.map((item: { path: string }) => item.path).sort())
      .toEqual(['20261027_gitlab_backup.tar.gpg', 'SHA256SUMS', 'gitlab_config_20261027.tar.gpg']);

    for (const [name, body] of Object.entries(files)) {
      expect(readFileSync(join(destination, name), 'utf8')).toBe(body);
      expect(statSync(join(destination, name)).mode & 0o777).toBe(0o600);
    }

    // 摘要包含 run 标识、路径、长度和 SHA-256，但不包含任何对象内容
    expect(result.stderr).toContain('gitlab/2026-10-27/20261027T040500/');
    expect(result.stderr).toContain('20261027_gitlab_backup.tar.gpg');
    expect(result.stderr).toContain(createHash('sha256').update(files['20261027_gitlab_backup.tar.gpg']).digest('hex'));
    expect(result.stderr).not.toContain('encrypted backup payload');

    const calls = f.calls().slice(baseline);
    expect(calls.filter(call => call.args[0] === 'cat')).toHaveLength(3);
    for (const call of calls) {
      expect(['lsjson', 'cat']).toContain(call.args[0]);
      expect(call.args).not.toContain('sync');
      expect(call.args).not.toContain('delete');
      expect(call.args).not.toContain('purge');
    }
  });

  it('makes the restore drill refuse to guess or download without an explicit --run', () => {
    const f = fixture();
    writeRun(f, 'gitlab/2026-10-26/20261026T030000/', { 'a.tar.gpg': 'alpha-one' });
    writeRun(f, 'gitlab/2026-10-27/20261027T040500/', { 'a.tar.gpg': 'alpha-two' });
    const baseline = f.calls().length;
    const drill = join(root, 'deploy/gitlab/restore-drill.sh');
    const drillRoot = join(f.dir, 'drill');
    const result = spawnSync('bash', [drill], {
      encoding: 'utf8', timeout: 20000,
      env: {
        PATH: `${f.bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: f.dir,
        ...f.credentials,
        GPG_PASSPHRASE: 'synthetic-passphrase-never-disclose',
        GITLAB_ARCHIVE_TOOL: script,
        GITLAB_DRILL_ROOT: drillRoot,
      },
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('--run');
    expect(result.stderr).toContain('available run: 2026-10-27/20261027T040500');
    // 未点名 run：既没有下载对象，也没有创建任何工作目录
    expect(f.calls().slice(baseline).filter(call => call.args[0] === 'cat')).toHaveLength(0);
    expect(existsSync(drillRoot)).toBe(false);
    expect(result.stdout).not.toContain('alpha-two');
  });

  it('stores the first copy of a key that rclone reports as an empty directory entry instead of exiting 3 (rc.27)', () => {
    const f = fixture();
    const source = join(f.dir, 'first.gpg');
    writeFileSync(source, 'first copy', { mode: 0o600 });
    const key = 'gitlab/2026-10-28/run/first.gpg';
    const stored = f.run(['put-file', '--role', 'gitlab-backup', '--source', source, '--key', key]);
    expect(stored.status, stored.stderr).toBe(0);
    expect(stored.stdout).toContain('stored');
    const again = f.run(['put-file', '--role', 'gitlab-backup', '--source', source, '--key', key]);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain('exists');
    writeFileSync(source, 'different bytes', { mode: 0o600 });
    const conflict = f.run(['put-file', '--role', 'gitlab-backup', '--source', source, '--key', key]);
    expect(conflict.status).toBe(1);
    expect(conflict.stderr).toContain('同键内容冲突');
  });

  it('fails closed for missing role credentials or rclone errors without leaking provider output', () => {
    const f = fixture();
    const source = join(f.dir, 'one.gpg');
    writeFileSync(source, 'encrypted', { mode: 0o600 });
    const missing = f.run(['put-file', '--role', 'gitlab-backup', '--source', source, '--key', 'gitlab/2026-10-27/run/one.gpg'], { GITLAB_BACKUP_S3_SECRET_ACCESS_KEY: '' });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('GITLAB_BACKUP_S3_SECRET_ACCESS_KEY');
    const failed = f.run(['put-file', '--role', 'gitlab-backup', '--source', source, '--key', 'gitlab/2026-10-27/run/one.gpg'], { FAKE_RCLONE_FAIL: '1' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('rclone');
    expect(failed.stdout + failed.stderr).not.toContain('synthetic-secret-never-disclose');
  });
});

describe('Garage archive retention (prune-runs)', () => {
  const day = (date: string, run = 'run1') => `gitlab/${date}/${run}/`;
  // 对象存储没有目录：假 rclone 删完文件会留下空目录，只数还剩文件的前缀
  const hasFiles = (path: string): boolean => existsSync(path)
    && readdirSync(path, { withFileTypes: true }).some(entry => (entry.isDirectory() ? hasFiles(join(path, entry.name)) : true));
  const exists = (f: ArchiveFixture, prefix: string) => hasFiles(join(f.objects, 'geek-backup', ...prefix.split('/').filter(Boolean)));
  const seed = (f: ArchiveFixture, dates: string[]) => { for (const date of dates) writeRun(f, day(date), { 'a.gpg': `a-${date}`, 'b.gpg': `b-${date}` }); };

  it('preview upload, selection and pruning cannot read or delete production GitLab backups', () => {
    const f = fixture();
    const dates = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'];
    for (const date of dates) {
      const source = writeRun(f, day(date), { 'backup.gpg': `encrypted-${date}` });
      const upload = f.run(['put-tree', '--role', 'gitlab-preview-backup', '--source', source, '--prefix', day(date)]);
      expect(upload.status, upload.stderr).toBe(0);
    }
    const denied = f.run(['list-gitlab-runs', '--role', 'gitlab-preview-backup'], { GITLAB_PREVIEW_BACKUP_S3_ACCESS_KEY_ID: '' });
    expect(denied.status).toBe(1);
    const pruned = f.run(['prune-runs', '--role', 'gitlab-preview-backup', '--apply']);
    expect(pruned.status, pruned.stderr).toBe(0);
    expect(existsSync(join(f.objects, 'geek-preview-private', day(dates[0]), 'backup.gpg'))).toBe(false);
    for (const date of dates) expect(readFileSync(join(f.objects, 'geek-backup', day(date), 'backup.gpg'), 'utf8')).toBe(`encrypted-${date}`);
    const missing = f.run(['resolve-gitlab-run', '--role', 'gitlab-preview-backup', '--run', `${dates[0]}/run1`]);
    expect(missing.status).toBe(1);
    const production = f.run(['resolve-gitlab-run', '--run', `${dates[0]}/run1`]);
    expect(production.status, production.stderr).toBe(0);
  });

  it('lists what it would remove by default and deletes nothing', () => {
    const f = fixture();
    seed(f, ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    const result = f.run(['prune-runs', '--role', 'gitlab-backup']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: 'dry-run', keepDates: 3, keptDates: ['2026-10-22', '2026-10-23', '2026-10-24'],
      removedRuns: [day('2026-10-20'), day('2026-10-21')], objects: 6,
    });
    expect(f.calls().filter(call => call.args[0] === 'deletefile')).toHaveLength(0);
    expect(exists(f, day('2026-10-20'))).toBe(true);
  });

  it('with --apply removes only runs older than the newest three dates, manifest first', () => {
    const f = fixture();
    seed(f, ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    const result = f.run(['prune-runs', '--role', 'gitlab-backup', '--apply']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'apply', objects: 6 });
    expect(exists(f, day('2026-10-20'))).toBe(false);
    expect(exists(f, day('2026-10-21'))).toBe(false);
    for (const date of ['2026-10-22', '2026-10-23', '2026-10-24']) expect(exists(f, day(date))).toBe(true);
    const deletes = f.calls().filter(call => call.args[0] === 'deletefile').map(call => String(call.args[1]));
    expect(deletes).toHaveLength(6);
    expect(deletes[0]).toBe('geekgarage:geek-backup/gitlab/2026-10-20/run1/SHA256SUMS');
    for (const call of f.calls()) for (const banned of ['sync', 'purge', 'delete', 'move']) expect(call.args).not.toContain(banned);
    expect(JSON.stringify(f.calls())).not.toContain('synthetic-secret-never-disclose');
  });

  it('keeps everything while fewer than the retention count of dated backups exist', () => {
    const f = fixture();
    seed(f, ['2026-10-23', '2026-10-24']);
    const result = f.run(['prune-runs', '--role', 'gitlab-backup', '--apply']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ removedRuns: [], objects: 0 });
    expect(f.calls().filter(call => call.args[0] === 'deletefile')).toHaveLength(0);
  });

  it('never counts an upload in progress as a kept backup and never removes it', () => {
    const f = fixture();
    seed(f, ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    writeRun(f, day('2026-10-24'), { 'a.gpg': 'partial' }, 'missing');
    const result = f.run(['prune-runs', '--role', 'gitlab-backup', '--apply']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ keptDates: ['2026-10-21', '2026-10-22', '2026-10-23'] });
    expect(exists(f, day('2026-10-20'))).toBe(false);
    expect(exists(f, day('2026-10-24'))).toBe(true);
  });

  it('refuses to delete anything when the newest backup does not match its SHA256SUMS', () => {
    const f = fixture();
    seed(f, ['2026-10-20', '2026-10-21', '2026-10-22']);
    writeRun(f, day('2026-10-23'), { 'a.gpg': 'one', 'b.gpg': 'two' }, 'truncated');
    const result = f.run(['prune-runs', '--role', 'gitlab-backup', '--apply']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SHA256SUMS');
    expect(f.calls().filter(call => call.args[0] === 'deletefile')).toHaveLength(0);
    expect(exists(f, day('2026-10-20'))).toBe(true);
  });

  it('refuses unexpected layouts, bad retention counts and roles that have no backup family', () => {
    const f = fixture();
    seed(f, ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    const stray = join(f.objects, 'geek-backup', 'gitlab', 'loose.txt');
    writeFileSync(stray, 'x');
    const layout = f.run(['prune-runs', '--role', 'gitlab-backup', '--apply']);
    expect(layout.status).toBe(1);
    expect(f.calls().filter(call => call.args[0] === 'deletefile')).toHaveLength(0);
    rmSync(stray);
    for (const bad of ['0', '31', '2.5', 'abc']) {
      const result = f.run(['prune-runs', '--role', 'gitlab-backup', '--keep-dates', bad]);
      expect(result.status, bad).toBe(1);
      expect(result.stderr).toContain('--keep-dates');
    }
    const index = f.run(['prune-runs', '--role', 'preview-content-index', '--apply']);
    expect(index.status).toBe(1);
    expect(f.calls().filter(call => call.args[0] === 'deletefile')).toHaveLength(0);
  });

  it('uploads SHA256SUMS after every data object so an interrupted upload never leaves a manifest without data', () => {
    const f = fixture();
    writeRun(f, day('2026-10-24'), { 'a.gpg': 'a', 'z.gpg': 'z', 'm.gpg': 'm' });
    const targets = f.calls().filter(call => call.args[0] === 'copyto').map(call => String(call.args[2]));
    expect(targets).toHaveLength(4);
    expect(targets.at(-1)).toBe('geekgarage:geek-backup/gitlab/2026-10-24/run1/SHA256SUMS');
  });

  it('does not count a run whose manifest lists an object that is not there, and keeps it', () => {
    const f = fixture();
    seed(f, ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    rmSync(join(f.objects, 'geek-backup', 'gitlab', '2026-10-23', 'run1', 'b.gpg'));
    const result = f.run(['prune-runs', '--role', 'gitlab-backup', '--apply']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      keptDates: ['2026-10-21', '2026-10-22', '2026-10-24'], unverifiedRuns: [day('2026-10-23')], removedRuns: [day('2026-10-20')],
    });
    expect(exists(f, day('2026-10-20'))).toBe(false);
    for (const date of ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']) expect(exists(f, day(date))).toBe(true);
  });

  it('does not count a run whose manifest is unreadable as a backup date', () => {
    const f = fixture();
    seed(f, ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    writeFileSync(join(f.objects, 'geek-backup', 'gitlab', '2026-10-22', 'run1', 'SHA256SUMS'), 'not a manifest\n');
    const result = f.run(['prune-runs', '--role', 'gitlab-backup', '--apply']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ keptDates: ['2026-10-20', '2026-10-21', '2026-10-23', '2026-10-24'].slice(1), unverifiedRuns: [day('2026-10-22')], removedRuns: [day('2026-10-20')] });
    expect(exists(f, day('2026-10-22'))).toBe(true);
  });

  it('refuses to delete anything when a run is dated after Beijing today', () => {
    const f = fixture();
    seed(f, ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2099-01-01']);
    const result = f.run(['prune-runs', '--role', 'gitlab-backup', '--apply']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('北京今天');
    expect(f.calls().filter(call => call.args[0] === 'deletefile')).toHaveLength(0);
    expect(exists(f, day('2026-10-20'))).toBe(true);
  });

  it('keeps the platform put-tree and get-tree prefixes pinned to a single run', () => {
    const f = fixture();
    const source = join(f.dir, 'platform-src');
    mkdirSync(source);
    writeFileSync(join(source, 'platform-backup.tar.gpg'), 'x');
    for (const environment of ['preview', 'production']) {
      const role = `platform-${environment}-backup`;
      const family = `platform/${environment}/`;
      expect(f.run(['put-tree', '--role', role, '--source', source, '--prefix', family]).status).toBe(1);
      expect(f.run(['get-tree', '--role', role, '--prefix', family, '--destination', join(f.dir, `out-${environment}`)]).status).toBe(1);
    }
    expect(f.calls().filter(call => ['copyto', 'cat', 'lsjson'].includes(call.args[0]))).toHaveLength(0);
  });

  it('leaves other backup families in the same bucket alone', () => {
    const f = fixture();
    seed(f, ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    const platform = join(f.objects, 'geek-backup', 'platform', 'production', '2026-10-01', 'run1');
    mkdirSync(platform, { recursive: true });
    writeFileSync(join(platform, 'platform-backup.tar.gpg'), 'old platform');
    const result = f.run(['prune-runs', '--role', 'gitlab-backup', '--apply']);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(platform, 'platform-backup.tar.gpg'))).toBe(true);
  });
});
