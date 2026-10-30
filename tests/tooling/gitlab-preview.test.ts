import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const edge = resolve('deploy/remote/edge-gitlab.py');
const preview = resolve('deploy/gitlab/preview.py');
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

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

  it('serves the NANO avatar pool under /gitlab and upgrades a handler installed without it in place, keeping the pre-install rollback target', () => {
    const f = edgeFixture();
    expect(f.act('apply').status).toBe(0);
    const current = readFileSync(f.site, 'utf8');
    const block = current.slice(f.production.length);
    expect(block).toContain('        @gitlab_nano_avatar path_regexp gitlab_nano_avatar ^/gitlab/nano-avatar/20261025/([0-9a-f])[0-9a-f]{63}$\n');
    expect(block).toContain('        @gitlab_nano_fallback path_regexp ^/gitlab/assets/no_avatar(-[a-f0-9]+)?\\.png$\n');
    expect(block).toContain('            root * /var/lib/caddy/gitlab-avatars/20261025\n');
    expect(block).toContain('                f avatar-08.png\n');
    expect(block.indexOf('@gitlab_nano_fallback')).toBeLessThan(block.indexOf('        handle @old_source {\n'));
    // The handler installed before the avatar routes is the same text without them, with a receipt describing that file.
    const routes = block.slice(block.indexOf('        @gitlab_nano_avatar'), block.indexOf('        handle @old_source {\n'));
    const earlier = current.replace(routes, '');
    const receiptPath = join(f.root, 'var/lib/yzgc-edge/receipt.json');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    const installEarlier = (text: string) => { writeFileSync(f.site, text); writeFileSync(receiptPath, JSON.stringify({ before: receipt.before, after: sha256(text) })); };
    installEarlier(earlier);
    expect(JSON.parse(f.act('plan').stdout).changed).toBe(true);
    expect(f.act('verify').status).toBe(1);
    const upgraded = f.act('apply');
    expect(upgraded.status, upgraded.stderr).toBe(0);
    expect(readFileSync(f.site, 'utf8')).toBe(current);
    expect(f.act('verify').status).toBe(0);
    expect(JSON.parse(f.act('apply').stdout).changed).toBe(false);
    expect(f.act('rollback').status).toBe(0);
    expect(readFileSync(f.site, 'utf8')).toBe(f.initial);

    const changed = edgeFixture();
    expect(changed.act('apply').status).toBe(0);
    const tampered = earlier.replace('response_header_timeout 300s', 'response_header_timeout 30s');
    writeFileSync(changed.site, tampered);
    writeFileSync(join(changed.root, 'var/lib/yzgc-edge/receipt.json'), JSON.stringify({ before: receipt.before, after: sha256(tampered) }));
    expect(changed.act('apply').status).toBe(1);
    expect(readFileSync(changed.site, 'utf8')).toBe(tampered);
    // An earlier handler the receipt does not describe is not upgraded either
    const unreceipted = edgeFixture();
    expect(unreceipted.act('apply').status).toBe(0);
    writeFileSync(unreceipted.site, earlier);
    expect(unreceipted.act('apply').status).toBe(1);
    expect(readFileSync(unreceipted.site, 'utf8')).toBe(earlier);
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

  it.each(['apply; id', 'apply --root /tmp', 'bootstrap', '', 'verify\napply', 'production-apply; id', 'production-apply --root /tmp', 'production-bootstrap'])('denies arbitrary SSH commands %j before opening configuration', command => {
    const f = fixture();
    const result = f.run(edge, [], { SSH_ORIGINAL_COMMAND: command });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('only fixed edge actions');
    expect(f.calls()).toEqual([]);
  });
});

// 正式入口（#335）：正式站点块加 /gitlab，旧 GitLab 主机文件换成只做跳转的物料。
const PRODUCTION_ENV = 'GEEK_DEPLOYMENT_ENVIRONMENT=production\nPUBLIC_ORIGIN=https://production.example.test\nGITLAB_URL=https://production.example.test/gitlab\nGITLAB_HTTP_BIND=10.66.0.2:8929\n';
const LEGACY_MATERIAL = '# 旧地址只做跳转\nold.example.test {\n\tredir https://production.example.test/gitlab{uri} 301\n}\n';

function siteBlock(host: string, upstream: string) {
  return `${host} {
    request_body {
        max_size 6291456
    }
    @outside_forum not path /forum/*
    header @outside_forum Content-Security-Policy "script-src 'self'"
    @old_source remote_ip 192.0.2.1
    handle @old_source {
        reverse_proxy ${upstream}
    }
    handle {
        reverse_proxy ${upstream}
    }
}
`;
}

function legacyProxy(host: string, upstream: string) {
  return `# ${host} → GitLab
${host} {
\trequest_body {
\t\tmax_size 2GB
\t}
\thandle {
\t\treverse_proxy ${upstream} {
\t\t\tflush_interval -1
\t\t}
\t}
}
`;
}

function productionFixture(options: { env?: string; material?: string; legacyHost?: string; production?: string } = {}) {
  const f = fixture();
  const env = options.env ?? PRODUCTION_ENV;
  const values = new Map(env.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(/=(.*)/s).slice(0, 2) as [string, string]));
  const host = new URL(values.get('PUBLIC_ORIGIN')!).hostname;
  const upstream = values.get('GITLAB_HTTP_BIND')!;
  const material = options.material ?? LEGACY_MATERIAL;
  const productionEnv = join(f.root, 'production.env');
  writeFileSync(productionEnv, env);
  mkdirSync(join(f.root, 'etc/caddy/sites'), { recursive: true });
  mkdirSync(join(f.root, 'usr/local/share/yzgc-edge'), { recursive: true });
  writeFileSync(join(f.root, 'etc/caddy/Caddyfile'), 'import sites/*.caddy\n');
  const production = options.production ?? siteBlock(host, '10.66.0.2:18100');
  const previewBlock = siteBlock('preview.example.test', '10.66.0.2:18200');
  const initial = production + previewBlock;
  const site = join(f.root, 'etc/caddy/sites/yzgc.caddy');
  const legacy = join(f.root, 'etc/caddy/sites/gitlab.caddy');
  const oldHost = options.legacyHost ?? material.split('\n').find(line => line.endsWith(' {'))!.slice(0, -2);
  const old = legacyProxy(oldHost, upstream);
  writeFileSync(site, initial);
  writeFileSync(legacy, old);
  writeFileSync(join(f.root, 'usr/local/share/yzgc-edge/gitlab-legacy.caddy'), material);
  const boot = f.run(edge, ['bootstrap', '--root', f.root, '--env-file', f.envFile, '--production-env-file', productionEnv]);
  expect(boot.status, boot.stderr).toBe(0);
  const act = (action: string, env: Record<string, string> = {}) => f.run(edge, [action, '--root', f.root, '--caddy', f.command, '--systemctl', f.command], env);
  const read = () => ({ site: readFileSync(site, 'utf8'), legacy: readFileSync(legacy, 'utf8') });
  return { ...f, productionEnv, site, legacy, initial, production, previewBlock, old, material, upstream, act, read };
}

describe('restricted production edge receiver（#335）', () => {
  it('moves the production block onto /gitlab and the old host onto the redirect material, then rolls both back exactly', () => {
    const f = productionFixture();
    const plan = f.act('production-plan');
    expect(plan.status, plan.stderr).toBe(0);
    expect(JSON.parse(plan.stdout).changed).toBe(true);
    expect(f.read()).toEqual({ site: f.initial, legacy: f.old });
    const applied = f.act('production-apply');
    expect(applied.status, applied.stderr).toBe(0);
    const { site, legacy } = f.read();
    expect(site.endsWith(f.previewBlock)).toBe(true);
    const block = site.slice(0, site.length - f.previewBlock.length);
    expect(block).toContain('    @gitlab_production path /gitlab /gitlab/*\n');
    expect(block).toContain('    @platform_body not path /gitlab /gitlab/*\n    request_body @platform_body {\n');
    expect(block).toContain('    @outside_forum not path /forum/* /gitlab /gitlab/*\n');
    expect(block).toContain('^/gitlab/nano-avatar/20261025/([0-9a-f])[0-9a-f]{63}$');
    expect(block).toContain('^/gitlab/assets/no_avatar(-[a-f0-9]+)?\\.png$');
    expect(block.match(/reverse_proxy 10\.66\.0\.2:8929 \{/g)).toHaveLength(2);
    expect(block).toContain('flush_interval -1');
    expect(block.indexOf('# yzgc:gitlab-production end')).toBeLessThan(block.indexOf('    handle @old_source {\n        reverse_proxy 10.66.0.2:18100'));
    expect(legacy).toBe(f.material);
    expect(f.act('production-verify').status).toBe(0);
    expect(JSON.parse(f.act('production-apply').stdout).changed).toBe(false);
    const rolled = f.act('production-rollback');
    expect(rolled.status, rolled.stderr).toBe(0);
    expect(f.read()).toEqual({ site: f.initial, legacy: f.old });
    expect(f.calls().some(args => args.includes('restart'))).toBe(false);
  });

  it('keeps the preview receipt in step so either handler verifies and rolls back in either order', () => {
    const first = productionFixture();
    expect(first.act('apply').status).toBe(0);
    expect(first.act('production-apply').status).toBe(0);
    expect(first.act('verify').status).toBe(0);
    expect(first.act('rollback').status).toBe(0);
    expect(first.read().site).toContain('@gitlab_production');
    expect(first.read().site).not.toContain('@gitlab_preview');
    expect(first.act('production-verify').status).toBe(0);
    expect(first.act('production-rollback').status).toBe(0);
    expect(first.read()).toEqual({ site: first.initial, legacy: first.old });

    const second = productionFixture();
    expect(second.act('production-apply').status).toBe(0);
    expect(second.act('apply').status).toBe(0);
    expect(second.act('production-rollback').status).toBe(0);
    expect(second.read().site).toContain('@gitlab_preview');
    expect(second.read().site).not.toContain('@gitlab_production');
    expect(second.act('verify').status).toBe(0);
    expect(second.act('rollback').status).toBe(0);
    expect(second.read()).toEqual({ site: second.initial, legacy: second.old });
  });

  it.each(['FAIL_VALIDATE', 'FAIL_RELOAD'])('restores both files when %s fails', failure => {
    const f = productionFixture();
    const result = f.act('production-apply', { [failure]: '1' });
    expect(result.status).toBe(1);
    expect(f.read()).toEqual({ site: f.initial, legacy: f.old });
    if (failure === 'FAIL_RELOAD') expect(f.calls().filter(args => args[0] === 'reload')).toHaveLength(2);
  });

  it('refuses an unfamiliar production block, an unknown old host file and redirect material that goes elsewhere', () => {
    const block = productionFixture({ production: siteBlock('production.example.test', '10.66.0.2:18100').replace('    @old_source', '    handle /gitlab/* {\n        respond 404\n    }\n    @old_source') });
    expect(block.act('production-apply').status).toBe(1);
    expect(block.read()).toEqual({ site: block.initial, legacy: block.old });
    const host = productionFixture({ legacyHost: 'other.example.test' });
    expect(host.act('production-apply').status).toBe(1);
    expect(host.read()).toEqual({ site: host.initial, legacy: host.old });
    for (const material of [LEGACY_MATERIAL.replace('production.example.test', 'elsewhere.example.test'), LEGACY_MATERIAL.replace(' 301', ' 302'), LEGACY_MATERIAL + 'extra.example.test {\n\trespond "x"\n}\n']) {
      const f = productionFixture({ material, legacyHost: 'old.example.test' });
      expect(f.act('production-apply').status).toBe(1);
      expect(f.read()).toEqual({ site: f.initial, legacy: f.old });
    }
    const never = productionFixture();
    const rollback = never.act('production-rollback');
    expect(rollback.status).toBe(1);
    expect(rollback.stderr).toContain('never activated');
    expect(never.read()).toEqual({ site: never.initial, legacy: never.old });
    const changed = productionFixture();
    expect(changed.act('production-apply').status).toBe(0);
    writeFileSync(changed.legacy, changed.material + '# later edit\n');
    expect(changed.act('production-rollback').status).toBe(1);
    expect(changed.read().legacy).toBe(changed.material + '# later edit\n');
  });

  it('refuses a production target that differs from the installed one and a non-production file', () => {
    const f = productionFixture();
    writeFileSync(f.productionEnv, PRODUCTION_ENV.replace('8929', '8939'));
    expect(f.run(edge, ['bootstrap', '--root', f.root, '--env-file', f.envFile, '--production-env-file', f.productionEnv]).status).toBe(1);
    writeFileSync(f.productionEnv, readFileSync(f.envFile, 'utf8'));
    expect(f.run(edge, ['bootstrap', '--root', f.root, '--env-file', f.envFile, '--production-env-file', f.productionEnv]).status).toBe(1);
  });

  it('accepts the repository redirect material against the production template', () => {
    const f = productionFixture({ env: readFileSync(resolve('deploy/env/.env.production'), 'utf8'), material: readFileSync(resolve('deploy/gitlab/gitlab.caddy'), 'utf8') });
    const applied = f.act('production-apply');
    expect(applied.status, applied.stderr).toBe(0);
    expect(f.read().legacy).toBe(f.material);
    expect(f.act('production-rollback').status).toBe(0);
    expect(f.read()).toEqual({ site: f.initial, legacy: f.old });
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
    fs.writeFileSync(stateFile, JSON.stringify([{ Config: { Labels: { 'com.docker.compose.project': 'gitlab-preview' } }, State: { Running: true, Health: { Status: process.env.FAKE_PREVIEW_HEALTH || ${JSON.stringify(healthy ? 'healthy' : 'unhealthy')} } }, Mounts: [['config','/etc/gitlab'],['logs','/var/log/gitlab'],['data','/var/opt/gitlab']].map(([name,Destination]) => ({ Destination, Source: path.join(root,name) })) }]));
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

  it('upgrades an instance rendered from the template without the yzgc-ui.rb line in place, restores it when the upgrade fails, and refuses other drift', () => {
    const f = previewFixture();
    expect(f.act('apply', ['--apply']).status).toBe(0);
    const composePath = join(f.root, 'srv/gitlab-preview/docker-compose.yml');
    const markerPath = join(f.root, 'srv/gitlab-preview/installation.json');
    const current = readFileSync(composePath, 'utf8');
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    const loader = "        from_file '/etc/gitlab/yzgc-ui.rb' if File.file?('/etc/gitlab/yzgc-ui.rb')\n";
    expect(current).toContain("        from_file '/etc/gitlab/yzgc-oidc.rb' if File.file?('/etc/gitlab/yzgc-oidc.rb')\n" + loader);
    const earlier = current.replace(loader, '');
    const installed = (compose: string) => { writeFileSync(composePath, compose); writeFileSync(markerPath, JSON.stringify({ ...marker, compose_sha256: sha256(compose) })); };
    const ups = (from: number) => f.calls().slice(from).filter(args => args[0] === 'compose' && args.includes('up')).length;

    installed(earlier);
    const plan = f.act('plan');
    expect(plan.status, plan.stderr).toBe(0);
    expect(JSON.parse(plan.stdout).upgrade).toBe(true);
    expect(f.act('verify').stderr).toContain('earlier compose');
    let from = f.calls().length;
    const failed = f.run(preview, ['apply', '--root', f.root, '--env-file', f.envFile, '--docker', join(f.root, 'docker'), '--health-timeout', '0', '--apply'], { FAKE_PREVIEW_HEALTH: 'starting' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('earlier compose restored');
    expect(readFileSync(composePath, 'utf8')).toBe(earlier);
    expect(JSON.parse(readFileSync(markerPath, 'utf8')).compose_sha256).toBe(sha256(earlier));
    expect(ups(from)).toBe(2);
    expect(f.calls().slice(from).some(args => args.includes('stop'))).toBe(false);

    from = f.calls().length;
    const upgraded = f.act('apply', ['--apply']);
    expect(upgraded.status, upgraded.stderr).toBe(0);
    expect(JSON.parse(upgraded.stdout).upgraded).toBe(true);
    expect(readFileSync(composePath, 'utf8')).toBe(current);
    expect(JSON.parse(readFileSync(markerPath, 'utf8'))).toEqual(marker);
    expect(ups(from)).toBe(1);
    expect(f.act('verify').status).toBe(0);
    expect(JSON.parse(f.act('apply', ['--apply']).stdout).upgraded).toBe(false);

    for (const drift of [earlier + '# hand edit\n', current.replace('mem_limit: 6g', 'mem_limit: 8g')]) {
      installed(drift);
      const refused = f.act('apply', ['--apply']);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain('drift');
      expect(readFileSync(composePath, 'utf8')).toBe(drift);
    }
    writeFileSync(markerPath, JSON.stringify({ ...marker, compose_sha256: sha256(earlier) }));
    writeFileSync(composePath, current);
    expect(f.act('apply', ['--apply']).status).toBe(1);
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
