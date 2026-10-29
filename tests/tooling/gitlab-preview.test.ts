import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const edge = resolve('deploy/remote/edge-gitlab.py');
const preview = resolve('deploy/gitlab/preview.py');

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gitlab-preview-')));
  roots.push(root);
  const envFile = join(root, 'preview.env');
  writeFileSync(envFile, 'GEEK_DEPLOYMENT_ENVIRONMENT=preview\nPUBLIC_ORIGIN=https://preview.example.test\nDEPLOY_HOST=10.66.0.2\nGITLAB_URL=https://preview.example.test/gitlab\nGITLAB_OIDC_CLIENT=gitlab_preview\nGITLAB_STACK_ROOT=/srv/gitlab-preview\nGITLAB_HTTP_BIND=10.66.0.2:8930\nGITLAB_DOCKER_SUBNET=172.31.30.0/24\nGITLAB_DOCKER_GATEWAY=172.31.30.1\n');
  const log = join(root, 'calls.jsonl');
  const command = join(root, 'command');
  writeFileSync(command, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (process.env.FAIL_VALIDATE && args[0] === 'validate') process.exit(1);
if (process.env.FAIL_RELOAD && args[0] === 'reload' && !fs.existsSync(${JSON.stringify(join(root, 'failed-once'))})) {
  fs.writeFileSync(${JSON.stringify(join(root, 'failed-once'))}, 'failed'); process.exit(1);
}
`, { mode: 0o700 });
  const run = (script: string, args: string[], env: Record<string, string> = {}) => spawnSync('python3', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 20_000 });
  const calls = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]) : [];
  return { root, envFile, command, run, calls };
}

function edgeFixture() {
  const f = fixture();
  mkdirSync(join(f.root, 'etc/caddy/sites'), { recursive: true });
  writeFileSync(join(f.root, 'etc/caddy/Caddyfile'), 'import sites/*.caddy\n');
  const production = 'production.example.test {\n    respond "untouched"\n}\n';
  const initial = production + `preview.example.test {
    request_body {
        max_size 6291456
    }
    @outside_forum not path /forum/*
    header @outside_forum Content-Security-Policy "script-src 'self'"
    @old_source remote_ip 192.0.2.1
    handle @old_source {
        reverse_proxy 10.66.0.2:18200
    }
    handle {
        reverse_proxy 10.66.0.2:18200
    }
}
`;
  const site = join(f.root, 'etc/caddy/sites/yzgc.caddy');
  writeFileSync(site, initial);
  const boot = f.run(edge, ['bootstrap', '--root', f.root, '--env-file', f.envFile]);
  expect(boot.status, boot.stderr).toBe(0);
  const act = (action: string, env: Record<string, string> = {}) => f.run(edge, [action, '--root', f.root, '--caddy', f.command, '--systemctl', f.command], env);
  return { ...f, site, initial, production, act };
}

describe('restricted preview edge receiver', () => {
  it('adds only a restricted dedicated key while preserving existing keys and refusing silent rotation', () => {
    const f = fixture();
    mkdirSync(join(f.root, 'root/.ssh'), { recursive: true });
    const authorized = join(f.root, 'root/.ssh/authorized_keys');
    const original = 'ssh-ed25519 existing-owner-key owner\n\n';
    writeFileSync(authorized, original);
    const key = `ssh-ed25519 ${'A'.repeat(68)} edge`;
    const install = (publicKey: string) => spawnSync('python3', [edge, 'bootstrap', '--root', f.root, '--env-file', f.envFile, '--public-key-stdin'], { encoding: 'utf8', input: publicKey });
    expect(install(key).status).toBe(0);
    const installed = readFileSync(authorized, 'utf8');
    expect(installed.startsWith(original)).toBe(true);
    expect(installed.slice(original.length)).toBe(`restrict,command="/usr/bin/python3 /usr/local/libexec/yzgc-edge" ssh-ed25519 ${'A'.repeat(68)} yzgc-edge-deploy\n`);
    expect(install(key).status).toBe(0);
    expect(readFileSync(authorized, 'utf8')).toBe(installed);
    expect(install(`ssh-ed25519 ${'B'.repeat(68)} changed`).status).toBe(1);
    expect(readFileSync(authorized, 'utf8')).toBe(installed);
    expect(install(key + '\ncommand="sh" ssh-ed25519 injected').status).toBe(1);
  });

  it('keeps production bytes and platform fallback while installing an exact prefix-preserving GitLab handler, then rolls back', () => {
    const f = edgeFixture();
    expect(JSON.parse(f.act('plan').stdout).changed).toBe(true);
    expect(readFileSync(f.site, 'utf8')).toBe(f.initial);
    const applied = f.act('apply');
    expect(applied.status, applied.stderr).toBe(0);
    const installed = readFileSync(f.site, 'utf8');
    expect(installed.startsWith(f.production)).toBe(true);
    expect(installed).toContain('@gitlab_preview path /gitlab /gitlab/*');
    expect(installed).not.toContain('handle_path');
    expect(installed).toContain('@outside_forum not path /forum/* /gitlab /gitlab/*');
    expect(installed).toContain('reverse_proxy 10.66.0.2:18200');
    expect(installed).toContain('header_up X-Real-IP {http.request.header.X-Real-IP}');
    expect(f.act('verify').status).toBe(0);
    expect(JSON.parse(f.act('apply').stdout).changed).toBe(false);
    expect(f.act('rollback').status).toBe(0);
    expect(readFileSync(f.site, 'utf8')).toBe(f.initial);
    expect(f.calls().some(args => args.includes('restart'))).toBe(false);
  });

  it.each(['FAIL_VALIDATE', 'FAIL_RELOAD'])('restores the original bytes when %s fails', failure => {
    const f = edgeFixture();
    const result = f.act('apply', { [failure]: '1' });
    expect(result.status).toBe(1);
    expect(readFileSync(f.site, 'utf8')).toBe(f.initial);
    if (failure === 'FAIL_RELOAD') expect(f.calls().filter(args => args[0] === 'reload')).toHaveLength(2);
  });

  it('rejects changed rollback targets and unknown site structure', () => {
    const f = edgeFixture();
    expect(f.act('apply').status).toBe(0);
    const changed = readFileSync(f.site, 'utf8') + '# subsequent change\n';
    writeFileSync(f.site, changed);
    expect(f.act('rollback').status).toBe(1);
    expect(readFileSync(f.site, 'utf8')).toBe(changed);
    writeFileSync(f.site, f.initial.replace('@outside_forum', '@custom_policy'));
    expect(f.act('apply').status).toBe(1);
  });

  it.each(['apply; id', 'apply --root /tmp', 'bootstrap', '', 'verify\napply'])('denies arbitrary SSH commands %j before opening configuration', command => {
    const f = fixture();
    const result = f.run(edge, [], { SSH_ORIGINAL_COMMAND: command });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('only fixed edge actions');
    expect(f.calls()).toEqual([]);
  });
});

function previewFixture(healthy = true) {
  const f = fixture();
  const docker = join(f.root, 'docker');
  const stateFile = join(f.root, 'docker-state.json');
  const log = join(f.root, 'calls.jsonl');
  writeFileSync(docker, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const stateFile = ${JSON.stringify(stateFile)};
if (args[0] === 'image' && args[1] === 'inspect') process.exit(0);
if (args[0] === 'inspect') {
  if (!fs.existsSync(stateFile)) process.exit(1);
  console.log(fs.readFileSync(stateFile, 'utf8')); process.exit(0);
}
if (args[0] === 'compose') {
  if (args.includes('up')) {
    const root = path.dirname(args[args.indexOf('-f') + 1]);
    fs.writeFileSync(stateFile, JSON.stringify([{ Config: { Labels: { 'com.docker.compose.project': 'gitlab-preview' } }, State: { Running: true, Health: { Status: ${JSON.stringify(healthy ? 'healthy' : 'unhealthy')} } }, Mounts: [['config','/etc/gitlab'],['logs','/var/log/gitlab'],['data','/var/opt/gitlab']].map(([name,Destination]) => ({ Destination, Source: path.join(root,name) })) }]));
  }
  process.exit(0);
}
if (args[0] === 'exec' && args[2] === 'gitlab-preview') process.exit(0);
process.exit(90);
`, { mode: 0o700 });
  const act = (action: string, extra: string[] = []) => f.run(preview, [action, '--root', f.root, '--env-file', f.envFile, '--docker', docker, '--health-timeout', '0', ...extra]);
  return { ...f, act };
}

describe('independent preview GitLab lifecycle', () => {
  it('plans without creating an instance and requires explicit apply; reruns preserve the same instance', () => {
    const f = previewFixture();
    expect(f.act('plan').status).toBe(0);
    expect(existsSync(join(f.root, 'srv'))).toBe(false);
    expect(f.act('apply').status).toBe(1);
    const result = f.act('apply', ['--apply']);
    expect(result.status, result.stderr).toBe(0);
    expect(f.act('verify').status).toBe(0);
    expect(f.act('apply', ['--apply']).status).toBe(0);
    expect(f.calls().some(args => args.includes('pull') || args.includes('build') || args.includes('gitlab'))).toBe(false);
  });

  it('stops only the new failed instance and retains its data directory', () => {
    const f = previewFixture(false);
    const result = f.act('apply', ['--apply']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('readiness timed out');
    expect(f.calls().some(args => args.includes('stop'))).toBe(true);
    expect(existsSync(join(f.root, 'srv/gitlab-preview/data'))).toBe(true);
    expect(existsSync(join(f.root, 'srv/gitlab'))).toBe(false);
  });

  it('refuses a production target and an unowned populated preview directory', () => {
    const f = previewFixture();
    writeFileSync(f.envFile, readFileSync(f.envFile, 'utf8').replace('ENVIRONMENT=preview', 'ENVIRONMENT=production'));
    expect(f.act('apply', ['--apply']).status).toBe(1);
    expect(f.calls()).toEqual([]);
    const existing = previewFixture();
    mkdirSync(join(existing.root, 'srv/gitlab-preview'), { recursive: true });
    writeFileSync(join(existing.root, 'srv/gitlab-preview/user-data'), 'preserved');
    expect(existing.act('apply', ['--apply']).status).toBe(1);
    expect(readFileSync(join(existing.root, 'srv/gitlab-preview/user-data'), 'utf8')).toBe('preserved');
  });
});
