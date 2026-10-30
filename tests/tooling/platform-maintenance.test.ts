import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'deploy/remote/platform-maintenance.sh');
const imageId = `sha256:${'a'.repeat(64)}`;
const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture(environment = 'preview') {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'geek-platform-maintenance-')));
  roots.push(dir);
  const stack = join(dir, environment);
  const bin = join(dir, 'bin');
  mkdirSync(stack);
  mkdirSync(bin);
  const envFile = join(stack, `.env.${environment}`);
  const envText = [
    `GEEK_DEPLOYMENT_ENVIRONMENT=${environment}`,
    `STACK_ROOT=${stack}`,
    `COMPOSE_PROJECT_NAME=yzgc-${environment}`,
    'IMAGE_TAG=02cb751c0b83',
    'DB_PATH=/data/data.db',
    'SESSION_SECRET=synthetic_secret_never_disclose',
    `ENCRYPTION_KEY=$(touch ${join(dir, 'injection-executed')})`,
    '',
  ].join('\n');
  writeFileSync(envFile, envText, { mode: 0o600 });
  const stateFile = join(dir, 'docker-state.json');
  const logFile = join(dir, 'docker-calls.jsonl');
  const state = { environment, imageId, expectedImageId: imageId, version: environment === 'preview' ? '0.1.1-rc.25@02cb751c0b83' : '0.1.1' };
  writeFileSync(stateFile, JSON.stringify(state));
  writeFileSync(join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const rawArgs = process.argv.slice(2);
if (rawArgs[0] !== '--context' || rawArgs[1] !== 'default') process.exit(92);
const args = rawArgs.slice(2);
const state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(args) + '\\n');
const project = 'yzgc-' + state.environment;
if (args[0] === 'container' && args[1] === 'ls' && args.includes('label=com.docker.compose.project=' + project)) {
  console.log(project + '-server');
} else if (args[0] === 'container' && args[1] === 'inspect' && args.includes(project + '-server')) {
  console.log(JSON.stringify({ id: 'b'.repeat(64), image_id: state.imageId, running: state.running ?? true, status: 'running', health: state.health ?? 'healthy', project: state.project ?? project, service: 'server', mounts: [{ Type: 'volume', Name: state.volume ?? project + '-data', Destination: '/data', RW: true }] }));
} else if (args[0] === 'stats' && args.includes('--no-stream')) {
  console.log(JSON.stringify({ ID: 'b'.repeat(64), Name: project + '-server', CPUPerc: '0.10%', MemUsage: '32MiB / 512MiB', MemPerc: '6.25%', BlockIO: '1MB / 0B', PIDs: '12' }));
} else if (args[0] === 'image' && args[1] === 'inspect') {
  if (state.missingHelper && args.includes('local/backup:approved')) process.exit(93);
  if (args.includes('{{.Id}}')) console.log(args.includes('local/backup:approved') ? 'sha256:' + 'd'.repeat(64) : state.expectedImageId);
  else console.log('GEEK_DEPLOYMENT_ENVIRONMENT=' + (state.buildEnvironment ?? state.environment) + '\\nGEEK_RELEASE_VERSION=' + state.version + '\\nGEEK_RELEASE_COMMIT=' + (state.commit ?? '02cb751c0b83' + 'c'.repeat(28)));
} else if (args[0] === 'volume' && args[1] === 'inspect' && args.includes(project + '-data')) {
  console.log(project + '-data');
} else if (args[0] === 'run' && args.includes('--entrypoint') && args.includes('node')) {
  if (args.includes('-e') && state.claimOutput) {
    fs.mkdirSync(state.claimOutput);
    fs.writeFileSync(state.claimOutput + '/sentinel', 'claimed by another backup');
  }
  if (args.includes('-e') && state.missingModule && !args.includes('sha256:' + 'd'.repeat(64))) process.exit(94);
  if (args.includes('/work/export-stack-snapshot.mjs')) {
    const mount = args.find(arg => arg.endsWith(',dst=/output'));
    const output = mount.slice('type=bind,src='.length, -',dst=/output'.length);
    fs.writeFileSync(output + '/system-backup.tar.gz', 'synthetic archive bytes', { mode: 0o600, flag: 'wx' });
    if (state.exportFailure) { console.error('synthetic_secret_never_disclose'); process.exit(95); }
    fs.writeFileSync(output + '/manifest.json', JSON.stringify({ format: 'yzgc-system-backup@1', environment: state.manifestEnvironment ?? state.environment, app: { version: state.version, image_tag: '02cb751c0b83' }, files: [{ path: 'data.db' }] }), { mode: 0o600, flag: 'wx' });
    if (state.driftOnExport) fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify({ ...state, imageId: 'sha256:' + 'f'.repeat(64) }));
  }
} else {
  console.error('Unexpected Docker operation');
  process.exitCode = 91;
}
`, { mode: 0o700 });
  const run = (command = 'status', args: string[] = []) => spawnSync('bash', [script, command, '--environment', environment, '--env-file', envFile, ...args], {
    encoding: 'utf8', timeout: 15000,
    env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: dir },
  });
  const calls = () => existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]) : [];
  return { dir, stack, envFile, envText, state, stateFile, logFile, run, calls };
}

describe('platform maintenance CLI', () => {
  it('reports only the selected stack and host capacity without mutating Docker or creating state files', () => {
    const f = fixture();
    const before = readdirSync(f.stack);
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    const status = JSON.parse(result.stdout);
    expect(status).toMatchObject({
      environment: 'preview',
      containers: [{ image_id: imageId, running: true, health: 'healthy', service: 'server' }],
      resources: [{ Name: 'yzgc-preview-server', MemUsage: '32MiB / 512MiB' }],
    });
    expect(status.host.memory_total_bytes).toBeGreaterThan(0);
    expect(status.host.disk_total_bytes).toBeGreaterThan(0);
    expect(f.calls().every(args => ['container', 'stats'].includes(args[0]))).toBe(true);
    expect(JSON.stringify(f.calls())).not.toContain('production');
    expect(readdirSync(f.stack)).toEqual(before);
    expect(readFileSync(f.envFile, 'utf8')).toBe(f.envText);
    expect(result.stdout + result.stderr).not.toContain('synthetic_secret_never_disclose');
    expect(existsSync(join(f.dir, 'injection-executed'))).toBe(false);
  });

  it('exports with immutable current-image identity, no network, read-only source and verifiable private receipts', () => {
    const f = fixture();
    const output = join(f.dir, 'snapshot');
    const result = f.run('backup', ['--out', output]);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ environment: 'preview', source_image_id: imageId, helper_image_id: imageId, backup_files: 1, output });
    const receipt = JSON.parse(readFileSync(join(output, 'receipt.json'), 'utf8'));
    expect(receipt).toMatchObject({
      environment: 'preview',
      source_image: { reference: 'yzgc-preview/server:02cb751c0b83', id: imageId },
      helper_image: { reference: 'yzgc-preview/server:02cb751c0b83', id: imageId },
      archive: {
        role: 'platform-preview-backup',
        prefix: expect.stringMatching(/^platform\/preview\/\d{4}-\d{2}-\d{2}\/\d{8}T\d{9}Z-02cb751c0b83\/$/),
      },
    });
    for (const name of ['system-backup.tar.gz', 'manifest.json', 'receipt.json']) {
      const digest = createHash('sha256').update(readFileSync(join(output, name))).digest('hex');
      expect(readFileSync(join(output, name + '.sha256'), 'utf8')).toBe(digest + '  ' + name + '\n');
      expect(statSync(join(output, name)).mode & 0o777).toBe(0o600);
      expect(statSync(join(output, name + '.sha256')).mode & 0o777).toBe(0o600);
    }
    expect(statSync(output).mode & 0o777).toBe(0o700);
    const helpers = f.calls().filter(args => args[0] === 'run');
    expect(helpers.length).toBe(2);
    for (const args of helpers) {
      expect(args).toContain('--read-only');
      expect(args).toContain(imageId);
      expect(args[args.indexOf('--network') + 1]).toBe('none');
      expect(args[args.indexOf('--pull') + 1]).toBe('never');
      expect(args[args.indexOf('--entrypoint') + 1]).toBe('node');
      expect(args[args.indexOf('--memory') + 1]).toBe('512m');
      expect(args[args.indexOf('--cpus') + 1]).toBe('0.5');
      expect(args).not.toContain('--env-file');
    }
    const exporting = helpers.find(args => args.includes('/work/export-stack-snapshot.mjs'))!;
    expect(exporting).toContain('type=volume,src=yzgc-preview-data,dst=/source,readonly');
    expect(f.calls().some(args => ['prune', 'rm', 'restart', 'stop', 'save', 'pull', 'build'].includes(args[0]))).toBe(false);
    expect(readFileSync(f.envFile, 'utf8')).toBe(f.envText);
    expect(result.stdout + result.stderr + readFileSync(join(output, 'receipt.json'), 'utf8')).not.toContain('synthetic_secret_never_disclose');
  });

  it.each(['STACK_ROOT', 'COMPOSE_PROJECT_NAME', 'IMAGE_TAG'])('refuses a missing %s instead of falling back', key => {
    const f = fixture();
    writeFileSync(f.envFile, f.envText.split('\n').filter(line => !line.startsWith(key + '=')).join('\n'));
    const output = join(f.dir, 'snapshot');
    const result = f.run('backup', ['--out', output]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(key);
    expect(f.calls()).toEqual([]);
    expect(existsSync(output)).toBe(false);
  });

  it.each([
    ['GEEK_DEPLOYMENT_ENVIRONMENT=preview', 'GEEK_DEPLOYMENT_ENVIRONMENT=production'],
    ['COMPOSE_PROJECT_NAME=yzgc-preview', 'COMPOSE_PROJECT_NAME=yzgc-production'],
    ['IMAGE_TAG=02cb751c0b83', 'IMAGE_TAG=unset'],
    ['DB_PATH=/data/data.db', 'DB_PATH=/data/other.db'],
  ])('rejects inconsistent runtime identity: %s', (from, to) => {
    const f = fixture();
    writeFileSync(f.envFile, f.envText.replace(from, to));
    const result = f.run();
    expect(result.status).toBe(1);
    expect(f.calls()).toEqual([]);
    expect(result.stdout + result.stderr).not.toContain('synthetic_secret_never_disclose');
  });

  it('rejects a shell expression in STACK_ROOT without evaluating it', () => {
    const f = fixture();
    writeFileSync(f.envFile, f.envText.replace(`STACK_ROOT=${f.stack}`, `STACK_ROOT=$(touch ${join(f.dir, 'injection-executed')})`));
    expect(f.run().status).toBe(1);
    expect(existsSync(join(f.dir, 'injection-executed'))).toBe(false);
    expect(f.calls()).toEqual([]);
  });

  it('refuses duplicate identity keys and a non-canonical env file', () => {
    const f = fixture();
    writeFileSync(f.envFile, f.envText + 'IMAGE_TAG=ffffffffffff\n');
    expect(f.run().status).toBe(1);
    expect(f.calls()).toEqual([]);
    writeFileSync(f.envFile, f.envText.replace(`STACK_ROOT=${f.stack}`, `STACK_ROOT=${join(f.dir, 'elsewhere', 'preview')}`));
    expect(f.run().status).toBe(1);
    expect(f.calls()).toEqual([]);
  });

  it('refuses a canonical env file replaced by a symlink', () => {
    const f = fixture();
    const copy = join(f.dir, 'runtime-copy');
    writeFileSync(copy, f.envText);
    rmSync(f.envFile);
    symlinkSync(copy, f.envFile);
    expect(f.run().status).toBe(1);
    expect(readFileSync(copy, 'utf8')).toBe(f.envText);
    expect(f.calls()).toEqual([]);
  });

  it.each(['empty', 'nonempty', 'symlink', 'dangling'])('never overwrites an existing %s destination', kind => {
    const f = fixture();
    const output = join(f.dir, 'snapshot');
    const target = join(f.dir, 'preserved');
    mkdirSync(target);
    writeFileSync(join(target, 'sentinel'), 'previous useful backup');
    if (kind === 'symlink' || kind === 'dangling') symlinkSync(kind === 'symlink' ? target : join(f.dir, 'absent'), output);
    else {
      mkdirSync(output);
      if (kind === 'nonempty') writeFileSync(join(output, 'sentinel'), 'previous useful backup');
    }
    expect(f.run('backup', ['--out', output]).status).toBe(1);
    expect(readFileSync(join(target, 'sentinel'), 'utf8')).toBe('previous useful backup');
    if (kind === 'nonempty') expect(readFileSync(join(output, 'sentinel'), 'utf8')).toBe('previous useful backup');
    expect(f.calls()).toEqual([]);
  });

  it.each(['relative', 'traversal', 'mount-injection', 'symlink-parent'])('rejects an unsafe %s output path before touching Docker', kind => {
    const f = fixture();
    const target = join(f.dir, 'preserved');
    mkdirSync(target);
    symlinkSync(target, join(f.dir, 'alias'));
    const output = kind === 'relative' ? 'relative-output' : kind === 'traversal' ? f.dir + '/preview/../snapshot' : kind === 'mount-injection' ? join(f.dir, 'snapshot,dst=/source') : join(f.dir, 'alias', 'snapshot');
    expect(f.run('backup', ['--out', output]).status).toBe(1);
    expect(readdirSync(target)).toEqual([]);
    expect(f.calls()).toEqual([]);
  });

  it.each([
    { imageId: `sha256:${'f'.repeat(64)}` },
    { running: false },
    { volume: 'yzgc-production-data' },
    { project: 'yzgc-production' },
    { buildEnvironment: 'production' },
    { commit: 'f'.repeat(40) },
    { version: '0.1.1' },
    { version: '0.1.1-stable.1@02cb751c0b83' },
  ])('refuses source drift before starting any helper: %j', patch => {
    const f = fixture();
    writeFileSync(f.stateFile, JSON.stringify({ ...f.state, ...patch }));
    const output = join(f.dir, 'snapshot');
    const result = f.run('backup', ['--out', output]);
    expect(result.status).toBe(1);
    expect(f.calls().filter(args => args[0] === 'run')).toEqual([]);
    expect(existsSync(output)).toBe(false);
    expect(readFileSync(f.envFile, 'utf8')).toBe(f.envText);
  });

  it('fails closed for old production without a backup module, rather than silently switching images', () => {
    const f = fixture('production');
    writeFileSync(f.stateFile, JSON.stringify({ ...f.state, version: '0.1.0', missingModule: true }));
    const output = join(f.dir, 'snapshot');
    const result = f.run('backup', ['--out', output]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--helper-image');
    expect(existsSync(output)).toBe(false);
    expect(f.calls().some(args => args.includes('local/backup:approved') || args.includes('/work/export-stack-snapshot.mjs'))).toBe(false);
  });

  it('records an explicitly chosen existing helper without changing the source identity', () => {
    const f = fixture('production');
    writeFileSync(f.stateFile, JSON.stringify({ ...f.state, version: '0.1.0', missingModule: true }));
    const output = join(f.dir, 'snapshot');
    const result = f.run('backup', ['--out', output, '--helper-image', 'local/backup:approved']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(output, 'receipt.json'), 'utf8'))).toMatchObject({
      source_image: { reference: 'yzgc-production/server:02cb751c0b83', id: imageId },
      helper_image: { reference: 'local/backup:approved', id: `sha256:${'d'.repeat(64)}` },
    });
    const exporting = f.calls().find(args => args.includes('/work/export-stack-snapshot.mjs'))!;
    expect(exporting).toContain('type=volume,src=yzgc-production-data,dst=/source,readonly');
    expect(exporting.slice(-3)).toEqual(['production', '0.1.0', '02cb751c0b83']);
    expect(readFileSync(f.envFile, 'utf8')).toBe(f.envText);
  });

  it('does not pull or export when an explicit helper image is absent', () => {
    const f = fixture();
    writeFileSync(f.stateFile, JSON.stringify({ ...f.state, missingHelper: true }));
    const output = join(f.dir, 'snapshot');
    const result = f.run('backup', ['--out', output, '--helper-image', 'local/backup:approved']);
    expect(result.status).toBe(1);
    expect(f.calls().some(args => args[0] === 'run' || args.includes('pull') || args.includes('build'))).toBe(false);
    expect(existsSync(output)).toBe(false);
  });

  it('preserves partial output and useful previous backups on an exporter failure without leaking stderr', () => {
    const f = fixture();
    writeFileSync(f.stateFile, JSON.stringify({ ...f.state, exportFailure: true }));
    const previous = join(f.stack, 'previous.tar.gz');
    writeFileSync(previous, 'previous useful backup');
    const output = join(f.dir, 'snapshot');
    const result = f.run('backup', ['--out', output]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('synthetic_secret_never_disclose');
    expect(readFileSync(previous, 'utf8')).toBe('previous useful backup');
    expect(readFileSync(join(output, 'system-backup.tar.gz'), 'utf8')).toBe('synthetic archive bytes');
    expect(existsSync(join(output, 'receipt.json'))).toBe(false);
    expect(readFileSync(f.envFile, 'utf8')).toBe(f.envText);
  });

  it('does not claim success for a manifest from the other environment', () => {
    const f = fixture();
    writeFileSync(f.stateFile, JSON.stringify({ ...f.state, manifestEnvironment: 'production' }));
    const output = join(f.dir, 'snapshot');
    const result = f.run('backup', ['--out', output]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(existsSync(join(output, 'receipt.json'))).toBe(false);
  });

  it('does not issue a success receipt when the running image changes during export', () => {
    const f = fixture();
    writeFileSync(f.stateFile, JSON.stringify({ ...f.state, driftOnExport: true }));
    const output = join(f.dir, 'snapshot');
    const result = f.run('backup', ['--out', output]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(existsSync(join(output, 'receipt.json'))).toBe(false);
    expect(readFileSync(join(output, 'system-backup.tar.gz'), 'utf8')).toBe('synthetic archive bytes');
  });

  it('preserves a destination claimed by another exporter during preflight', () => {
    const f = fixture();
    const output = join(f.dir, 'snapshot');
    writeFileSync(f.stateFile, JSON.stringify({ ...f.state, claimOutput: output }));
    expect(f.run('backup', ['--out', output]).status).toBe(1);
    expect(readFileSync(join(output, 'sentinel'), 'utf8')).toBe('claimed by another backup');
    expect(f.calls().some(args => args.includes('/work/export-stack-snapshot.mjs'))).toBe(false);
  });

  it.each(['preview', 'production'])('derives a new private %s backup directory only from its validated STACK_ROOT', environment => {
    const f = fixture(environment);
    const result = f.run('backup');
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout).output as string;
    expect(dirname(output)).toBe(join(f.stack, 'backups'));
    expect(statSync(dirname(output)).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(join(output, 'receipt.json'), 'utf8')).environment).toBe(environment);
    expect(readdirSync(f.stack).sort()).toEqual([`.env.${environment}`, 'backups']);
  });
});
