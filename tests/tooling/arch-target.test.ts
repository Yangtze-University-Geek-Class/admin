import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(environment = 'preview', proxyJump = 'root@156.238.244.78:22') {
  const root = mkdtempSync(join(tmpdir(), 'geek-ssh-target-'));
  roots.push(root);
  mkdirSync(join(root, 'deploy/env'), { recursive: true });
  writeFileSync(join(root, 'deploy/environments.json'), readFileSync(join(repoRoot, 'deploy/environments.json')));
  const templatePath = join(root, `deploy/env/.env.${environment}`);
  writeFileSync(templatePath, `GEEK_DEPLOYMENT_ENVIRONMENT=${environment}\nDEPLOY_HOST=10.66.0.2\nDEPLOY_PORT=22\nDEPLOY_USER=root\nDEPLOY_PROXY_JUMP=${proxyJump}\n`);
  const keyFile = join(root, 'deploy key');
  const knownHostsFile = join(root, 'known hosts');
  const out = join(root, 'ssh_config');
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '', DEPLOY_TARGET_ENVIRONMENT: environment,
    DEPLOY_SSH_HOST: '10.66.0.2', DEPLOY_SSH_PORT: '22', DEPLOY_SSH_USER: 'root',
  };
  const run = (overrides: Record<string, string | undefined> = {}) => spawnSync(process.execPath, [
    join(repoRoot, 'scripts/deployment-environment.mjs'), 'ssh-config', '--root', root,
    '--environment', environment, '--out', out, '--key-file', keyFile, '--known-hosts-file', knownHostsFile,
  ], { encoding: 'utf8', env: { ...env, ...overrides } });
  return { root, templatePath, keyFile, knownHostsFile, out, env, run };
}

describe('deployment SSH configuration CLI', () => {
  it('rejects missing or mismatched environment targets before producing any SSH configuration', () => {
    for (const environment of ['preview', 'production']) {
      for (const [field, values] of Object.entries({
        DEPLOY_TARGET_ENVIRONMENT: [undefined, '', environment === 'preview' ? 'production' : 'preview'],
        DEPLOY_SSH_HOST: [undefined, '', '103.117.123.226', '-oProxyCommand=id', '10.66.0.2\nProxyCommand id'],
        DEPLOY_SSH_PORT: [undefined, '', '22000', '22 -v'],
        DEPLOY_SSH_USER: [undefined, '', 'another_user', 'root;id'],
      })) {
        for (const value of values) {
          const world = fixture(environment);
          const result = world.run({ [field]: value });
          expect(result.status, `${environment}: ${field}=${value}`).toBe(1);
          expect(result.stderr, `${environment}: ${field}=${value}`).toContain(field);
          expect(existsSync(world.out)).toBe(false);
        }
      }
    }
  });

  it('applies the same strict key policy to Arch and its jump without reading an ambient config', () => {
    const world = fixture();
    const ambient = join(world.root, 'ambient_config');
    writeFileSync(ambient, 'Host *\n  HostName attacker.example\n  StrictHostKeyChecking no\n  ProxyCommand false\n');
    const result = world.run({ DEPLOY_SSH_CONFIG_FILE: ambient });
    expect(result.status, result.stderr).toBe(0);
    expect(statSync(world.out).mode & 0o777).toBe(0o600);
    for (const [destination, hostname] of [
      ['yzgc-target', '10.66.0.2'],
      ['root@156.238.244.78', '156.238.244.78'],
    ]) {
      const output = execFileSync('ssh', ['-G', '-F', world.out, destination], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const policy = Object.fromEntries(output.trim().split('\n').map(line => {
        const space = line.indexOf(' ');
        return [line.slice(0, space), line.slice(space + 1)];
      }));
      expect(policy).toMatchObject({ hostname, user: 'root', port: '22', stricthostkeychecking: 'true', identitiesonly: 'yes',
        batchmode: 'yes', globalknownhostsfile: '/dev/null', identityfile: world.keyFile, userknownhostsfile: world.knownHostsFile });
      if (destination === 'yzgc-target') {
        expect(policy.proxyjump?.match(/^([^@]+)@\[?([^\[\]:]+)\]?:([0-9]+)$/)?.slice(1)).toEqual(['root', '156.238.244.78', '22']);
      } else expect(policy.proxyjump).toBeUndefined();
      expect(policy.proxycommand).toBeUndefined();
    }
  });

  it('accepts an explicitly direct loopback deployment without inserting a jump', () => {
    const world = fixture('production', '');
    writeFileSync(world.templatePath, readFileSync(world.templatePath, 'utf8').replace('DEPLOY_HOST=10.66.0.2', 'DEPLOY_HOST=127.0.0.1'));
    const result = world.run({ DEPLOY_SSH_HOST: '127.0.0.1' });
    expect(result.status, result.stderr).toBe(0);
    const output = execFileSync('ssh', ['-G', '-F', world.out, 'yzgc-target'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(output).toMatch(/^hostname 127\.0\.0\.1$/m);
    expect(output).not.toMatch(/^proxyjump /m);
  });

  it('rejects whitespace-normalized jumps instead of silently accepting another template value', () => {
    const world = fixture('preview', '" root@156.238.244.78:22 "');
    const result = world.run();
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('DEPLOY_PROXY_JUMP');
    expect(existsSync(world.out)).toBe(false);
  });

  it('rejects stale or missing CI targets before the workflow can create a deployment record', () => {
    for (const environment of ['preview', 'production']) {
      const workflow = readFileSync(join(repoRoot, `.github/workflows/deploy-${environment}.yml`), 'utf8');
      const deployment = workflow.slice(workflow.indexOf('\n  deploy:\n'));
      const scripts = deployment.split(/^ {6}- name: /m).slice(1).flatMap(step => {
        const name = step.slice(0, step.indexOf('\n'));
        if (!name.includes('SSH') && !name.startsWith('校验环境哨兵') && !name.startsWith('创建部署记录')) return [];
        const run = /\n {8}run: \|\n((?: {10}.*\n|\n)+)/.exec(step);
        if (!run) throw new Error(`工作流步骤缺少 shell 脚本：${name}`);
        return [run[1].replace(/^ {10}/gm, '')];
      });
      for (const overrides of [{ DEPLOY_SSH_HOST: '103.117.123.226' }, { DEPLOY_SSH_PORT: '' }, { DEPLOY_SSH_USER: '' }]) {
        const world = fixture(environment);
        mkdirSync(join(world.root, 'scripts'));
        cpSync(join(repoRoot, 'scripts/deployment-environment.mjs'), join(world.root, 'scripts/deployment-environment.mjs'));
        const bin = join(world.root, 'bin');
        mkdirSync(bin);
        writeFileSync(join(bin, 'gh'), '#!/bin/sh\nprintf "record\\n" >> "$CALLS_FILE"\nprintf "4242\\n"\n');
        chmodSync(join(bin, 'gh'), 0o755);
        const calls = join(world.root, 'calls');
        const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', scripts.join('\n')], {
          cwd: world.root, encoding: 'utf8', env: { ...world.env, ...overrides, PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
            RUNNER_TEMP: world.root, CALLS_FILE: calls, DEPLOY_SSH_KEY: 'synthetic-key', DEPLOY_SSH_KNOWN_HOSTS: 'synthetic-host',
            GITHUB_REPOSITORY: 'fixture/repository', GITHUB_OUTPUT: join(world.root, 'output'), COMMIT: 'a'.repeat(40),
            RELEASE_TAG: environment === 'preview' ? 'v0.1.0-rc.1' : 'v0.1.0', RELEASE_VERSION: '0.1.0',
            IMAGE_TAG: 'a'.repeat(12), IMAGE_REPOSITORY: `yzgc-${environment}`, STACK_ROOT: `/opt/yzgc/${environment}`, PREVIEW_TAGS: 'v0.1.0-rc.1' },
        });
        expect(result.status, `${environment}: ${JSON.stringify(overrides)}: ${result.stderr}`).toBe(1);
        expect(existsSync(calls), `${environment}: a deployment record was created`).toBe(false);
      }
    }
  });

  it.each(['preview', 'production'])('ships same-tag rollback material with the %s workflow payload', environment => {
    const world = fixture(environment);
    const workflow = readFileSync(join(repoRoot, `.github/workflows/deploy-${environment}.yml`), 'utf8');
    const step = workflow.slice(workflow.indexOf('\n  deploy:\n')).split(/^ {6}- name: /m)
      .find(block => block.startsWith('分发镜像、env 文件与 compose 物料\n'));
    const script = /\n {8}run: \|\n((?: {10}.*\n|\n)+)/.exec(step ?? '')?.[1].replace(/^ {10}/gm, '');
    if (!script) throw new Error('找不到部署分发 shell');
    const tagged = new Map<string, string>();
    mkdirSync(join(world.root, 'deploy/remote'), { recursive: true });
    mkdirSync(join(world.root, 'deploy/compose'), { recursive: true });
    mkdirSync(join(world.root, 'bundle'));
    for (const name of ['deploy-stack.sh', 'rollback-stack.sh', 'garage-archive.mjs']) {
      const text = readFileSync(join(repoRoot, 'deploy/remote', name), 'utf8') + `\n# tagged workflow fixture ${environment}\n`;
      tagged.set(name, text);
      writeFileSync(join(world.root, 'deploy/remote', name), text);
    }
    for (const name of ['preview', 'production']) cpSync(join(repoRoot, `deploy/compose/${name}.yml`), join(world.root, `deploy/compose/${name}.yml`));
    const archive = `yzgc-images-${environment}-aaaaaaaaaaaa.tar.gz`;
    for (const name of [archive, `${archive}.sha256`, `.env.${environment}`]) writeFileSync(join(world.root, 'bundle', name), 'synthetic payload\n');
    const bin = join(world.root, 'bin');
    const received = join(world.root, 'received');
    mkdirSync(bin);
    writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nexit 0\n');
    writeFileSync(join(bin, 'scp'), `#!${process.execPath}\nconst {cpSync,mkdirSync}=require('node:fs');\nconst {basename,join}=require('node:path');\nconst args=process.argv.slice(2);\nconst destination=args.at(-1);\nif(args[0]!=='-F'||!destination.startsWith('yzgc-target:/opt/yzgc/'))process.exit(2);\nconst target=join(process.env.RECEIVED_ROOT,destination.slice('yzgc-target:'.length));\nmkdirSync(target,{recursive:true});\nfor(const source of args.slice(2,-1))cpSync(source,join(target,basename(source)));\n`);
    for (const name of ['ssh', 'scp']) chmodSync(join(bin, name), 0o755);
    const stackRoot = `/opt/yzgc/${environment}`;
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', script], {
      cwd: world.root, encoding: 'utf8', env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        RUNNER_TEMP: world.root, RECEIVED_ROOT: received, STACK_ROOT: stackRoot, INCOMING_DIR: `${stackRoot}/incoming`, IMAGES_ARCHIVE: archive },
    });
    expect(result.status, result.stderr).toBe(0);
    const incoming = join(received, 'opt/yzgc', environment, 'incoming');
    expect(readdirSync(incoming).filter(name => name.endsWith('.sh')).sort()).toEqual(['deploy-stack.sh', 'rollback-stack.sh']);
    for (const [name, text] of tagged) expect(readFileSync(join(incoming, name), 'utf8'), name).toBe(text);
    const rollback = spawnSync('/bin/bash', [join(incoming, 'rollback-stack.sh'), '--help'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
    expect(rollback.status, rollback.stderr).toBe(0);
    expect(rollback.stderr).toContain('rollback-stack.sh --environment');
  });
});
