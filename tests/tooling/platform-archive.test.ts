import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'deploy/remote/platform-archive.sh');
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

function sha(bytes: Buffer | string) { return createHash('sha256').update(bytes).digest('hex'); }

function fixture(environment = 'preview') {
  const dir = mkdtempSync(join(tmpdir(), 'geek-platform-archive-'));
  roots.push(dir);
  const bin = join(dir, 'bin');
  const objects = join(dir, 'objects');
  const calls = join(dir, 'calls.jsonl');
  mkdirSync(bin);
  mkdirSync(objects);
  const fakeRcloneSource = readFileSync(join(root, 'tests/tooling/fixtures/fake-garage-rclone.cjs'), 'utf8');
  writeFileSync(join(bin, 'rclone'), `#!${process.execPath}\n${fakeRcloneSource}`, { mode: 0o700 });
  writeFileSync(join(bin, 'gpg'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--list-keys')) process.exit(0);
const output = args[args.indexOf('--output') + 1];
const input = args.at(-1);
fs.appendFileSync(process.env.FAKE_GPG_LOG, JSON.stringify(args) + '\\n');
fs.writeFileSync(output, Buffer.concat([Buffer.from('encrypted:'), fs.readFileSync(input)]), { flag: 'wx', mode: 0o600 });
`, { mode: 0o700 });
  const source = join(dir, 'snapshot');
  mkdirSync(source);
  const archive = Buffer.from('synthetic platform backup');
  const manifest = Buffer.from(`${JSON.stringify({ format: 'yzgc-system-backup@1', environment })}\n`);
  writeFileSync(join(source, 'system-backup.tar.gz'), archive, { mode: 0o600 });
  writeFileSync(join(source, 'system-backup.tar.gz.sha256'), `${sha(archive)}  system-backup.tar.gz\n`, { mode: 0o600 });
  writeFileSync(join(source, 'manifest.json'), manifest, { mode: 0o600 });
  writeFileSync(join(source, 'manifest.json.sha256'), `${sha(manifest)}  manifest.json\n`, { mode: 0o600 });
  const prefix = `platform/${environment}/2026-10-27/20261027T040500000Z-02cb751c0b83/`;
  const receipt = Buffer.from(`${JSON.stringify({
    format: 'yzgc-platform-backup-receipt@1', environment, created_at: '2026-10-26T20:05:00.000Z',
    archive: { role: `platform-${environment}-backup`, prefix },
  })}\n`);
  writeFileSync(join(source, 'receipt.json'), receipt, { mode: 0o600 });
  writeFileSync(join(source, 'receipt.json.sha256'), `${sha(receipt)}  receipt.json\n`, { mode: 0o600 });
  const output = join(dir, 'encrypted');
  const env = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir,
    FAKE_RCLONE_OBJECTS: objects, FAKE_RCLONE_LOG: calls, FAKE_GPG_LOG: join(dir, 'gpg.jsonl'),
    BACKUP_GPG_RECIPIENT: 'backup@example.invalid',
    BACKUP_S3_ENDPOINT: 'https://s3.example.invalid',
    BACKUP_S3_REGION: 'test-region-1',
    BACKUP_S3_BUCKET: 'synthetic-backup',
    BACKUP_S3_PREFIX: 'yzgc/test/backup/',
    BACKUP_S3_ACCESS_KEY_ID: 'backup-access',
    BACKUP_S3_SECRET_ACCESS_KEY: 'backup-secret-never-disclose',
  };
  const run = (extra: string[] = [], extraEnv: Record<string, string> = {}) => spawnSync('bash', [script, '--environment', environment, '--source', source, '--out', output, ...extra], {
    encoding: 'utf8', timeout: 15000, env: { ...env, ...extraEnv },
  });
  return { dir, bin, objects, calls, source, output, prefix, env, run };
}

describe('platform encrypted off-host archive step', () => {
  it('verifies the local receipt, encrypts before upload and preserves the original snapshot', () => {
    const f = fixture();
    const before = ['manifest.json', 'manifest.json.sha256', 'receipt.json', 'receipt.json.sha256', 'system-backup.tar.gz', 'system-backup.tar.gz.sha256'];
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ environment: 'preview', prefix: f.prefix, prune: { mode: 'apply', runs: { complete: 1, kept: 1, removed: 0 } } });
    expect(readFileSync(join(f.objects, 'synthetic-backup', 'yzgc/test/backup/', f.prefix, 'platform-backup.tar.gpg')).subarray(0, 10).toString()).toBe('encrypted:');
    expect(readFileSync(join(f.objects, 'synthetic-backup', 'yzgc/test/backup/', f.prefix, 'SHA256SUMS'), 'utf8')).toMatch(/platform-backup\.tar\.gpg/);
    expect(before.every(name => existsSync(join(f.source, name)))).toBe(true);
    expect(readFileSync(join(f.source, 'system-backup.tar.gz')).toString()).toBe('synthetic platform backup');
    expect(readFileSync(f.env.FAKE_GPG_LOG, 'utf8')).toContain('--encrypt');
    expect(result.stdout + result.stderr).not.toContain('preview-secret-never-disclose');
  });

  it('fails before encryption/upload for a mismatched environment or damaged local checksum', () => {
    const wrong = fixture('preview');
    const receiptPath = join(wrong.source, 'receipt.json');
    const changed = readFileSync(receiptPath, 'utf8').replace('"environment":"preview"', '"environment":"production"');
    writeFileSync(receiptPath, changed, { mode: 0o600 });
    writeFileSync(receiptPath + '.sha256', `${sha(changed)}  receipt.json\n`, { mode: 0o600 });
    expect(wrong.run().status).toBe(1);
    expect(existsSync(wrong.env.FAKE_GPG_LOG)).toBe(false);
    expect(existsSync(wrong.calls)).toBe(false);

    const damaged = fixture();
    writeFileSync(join(damaged.source, 'system-backup.tar.gz'), 'tampered', { mode: 0o600 });
    expect(damaged.run().status).not.toBe(0);
    expect(existsSync(damaged.env.FAKE_GPG_LOG)).toBe(false);
    expect(existsSync(damaged.calls)).toBe(false);
  });

  it('fails closed without backup credentials and lets immutable remote conflicts fail closed', () => {
    const f = fixture();
    expect(f.run([], { BACKUP_S3_SECRET_ACCESS_KEY: '' }).status).toBe(1);
    expect(existsSync(f.output)).toBe(false);
    expect(f.run().status).toBe(0);
    const secondOut = join(f.dir, 'encrypted-second');
    writeFileSync(join(f.source, 'system-backup.tar.gz'), 'changed bytes', { mode: 0o600 });
    writeFileSync(join(f.source, 'system-backup.tar.gz.sha256'), `${sha('changed bytes')}  system-backup.tar.gz\n`, { mode: 0o600 });
    const conflict = spawnSync('bash', [script, '--environment', 'preview', '--source', f.source, '--out', secondOut], { encoding: 'utf8', timeout: 15000, env: f.env });
    expect(conflict.status).toBe(1);
    expect(conflict.stderr).toContain('同键内容冲突');
    expect(conflict.stdout + conflict.stderr).not.toContain('preview-secret-never-disclose');
  });
});
