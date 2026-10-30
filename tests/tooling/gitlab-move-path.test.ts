import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// GitLab 搬到正式入口的 /gitlab（#335）：move-path.sh 串起 Arch 与香港两半和公网核对。两半与 curl 都是假的，只看调用顺序和失败时是否两半都恢复。
const script = resolve('deploy/gitlab/move-path.sh');
const GITLAB = 'https://site.example.test/gitlab';
const LEGACY = 'https://old.example.test';
const ISSUER = 'https://site.example.test';
const CALLBACK = `${GITLAB}/users/auth/openid_connect/callback`;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gitlab-move-path-')));
  roots.push(root);
  const log = join(root, 'calls.log');
  const side = (name: string) => {
    const path = join(root, name);
    writeFileSync(path, `#!/usr/bin/env bash
echo "${name} $*" >> "${log}"
fail="FAIL_${name.toUpperCase()}"
[[ "\${!fail:-}" == "$*" ]] && exit 1
exit 0
`, { mode: 0o755 });
    return path;
  };
  const curl = join(root, 'curl');
  writeFileSync(curl, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const url = args[args.length - 1];
const format = args.includes('-w') ? args[args.indexOf('-w') + 1] : '';
fs.appendFileSync(${JSON.stringify(log)}, 'curl ' + (args.includes('POST') ? 'POST ' : '') + url + '\\n');
const env = process.env;
if (url === ${JSON.stringify(`${GITLAB}/users/sign_in?auto_sign_in=false`)}) {
  if (format) process.stdout.write(env.FAKE_SIGNIN || '200');
  else process.stdout.write('<head><meta name="csrf-token" content="csrf-secret-token" /></head>');
} else if (url === ${JSON.stringify(`${LEGACY}/geek/admin.git/info/refs?service=git-upload-pack`)}) {
  process.stdout.write(env.FAKE_LEGACY || ${JSON.stringify(`301 ${GITLAB}/geek/admin.git/info/refs?service=git-upload-pack`)});
} else if (url === ${JSON.stringify(`${GITLAB}/users/auth/openid_connect`)}) {
  const callback = env.FAKE_CALLBACK || ${JSON.stringify(CALLBACK)};
  process.stdout.write(${JSON.stringify(`${ISSUER}/oidc/auth?client_id=gitlab&redirect_uri=`)} + encodeURIComponent(callback) + '&state=session-secret');
} else if (url.startsWith(${JSON.stringify(`${ISSUER}/oidc/auth?`)})) {
  process.stdout.write(env.FAKE_AUTH || '303');
} else {
  process.exit(7);
}
`, { mode: 0o755 });
  const run = (args: string[], env: Record<string, string> = {}) => spawnSync('bash', [script, ...args], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, ARCH: side('arch'), EDGE: side('edge'), CURL: curl, ...env },
  });
  const calls = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  return { run, calls };
}

const base = ['--gitlab-url', GITLAB, '--legacy-origin', LEGACY, '--issuer-origins', `${ISSUER} https://prev.example.test`];
const VERIFY = [
  `curl ${GITLAB}/users/sign_in?auto_sign_in=false`,
  `curl ${LEGACY}/geek/admin.git/info/refs?service=git-upload-pack`,
  `curl ${GITLAB}/users/sign_in?auto_sign_in=false`,
  `curl POST ${GITLAB}/users/auth/openid_connect`,
];
const RESTORE = ['edge production-rollback', 'arch rollback-production-path --apply'];

describe('move-path.sh（#335）', () => {
  it('status and the dry run only read both halves', () => {
    const status = fixture();
    expect(status.run(['status', ...base]).status).toBe(0);
    expect(status.calls()).toEqual(['arch path-status', 'edge production-plan']);
    const dry = fixture();
    const result = dry.run(['move', ...base]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('演算');
    expect(dry.calls()).toEqual(['arch move-production-path', 'edge production-plan']);
  });

  it('moves Arch, then the edge, verifies in public, checks the members, and only then removes the old callback', () => {
    const f = fixture();
    const result = f.run(['move', ...base, '--apply']);
    expect(result.status, result.stderr).toBe(0);
    expect(f.calls()).toEqual([
      'arch move-production-path --apply', 'edge production-apply', ...VERIFY,
      expect.stringMatching(/^curl https:\/\/site\.example\.test\/oidc\/auth\?/), 'arch check-production-path', 'arch finish-production-path --apply',
    ]);
    expect(result.stdout).toContain('新地址登录页：HTTP 200');
    expect(result.stdout).toContain('旧地址：HTTP 301，跳到新地址的同一路径');
    expect(result.stdout).toContain(`统一登录：跳到 ${ISSUER}/oidc/auth，带新回调`);
    expect(result.stdout).toContain('签发者对新回调：HTTP 303');
    expect(result.stdout + result.stderr).not.toMatch(/csrf-secret-token|session-secret|state=/);
  });

  it.each([
    ['新地址打不开', { FAKE_SIGNIN: '502' }],
    ['旧地址没有跳到同一路径', { FAKE_LEGACY: `301 ${GITLAB}/` }],
    ['统一登录还带旧回调', { FAKE_CALLBACK: `${LEGACY}/users/auth/openid_connect/callback` }],
    ['签发者不接受新回调', { FAKE_AUTH: '400' }],
  ])('restores both halves when the public check fails: %s', (_name, env) => {
    const f = fixture();
    const result = f.run(['move', ...base, '--apply'], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('公网核对未通过，已恢复原地址');
    expect(f.calls().slice(0, 2)).toEqual(['arch move-production-path --apply', 'edge production-apply']);
    expect(f.calls().slice(-2)).toEqual(RESTORE);
    expect(f.calls()).not.toContain('arch finish-production-path --apply');
  });

  it('restores both halves when the members check fails (a sub changed or GitLab got an account nobody owns)', () => {
    const f = fixture();
    const result = f.run(['move', ...base, '--apply'], { FAIL_ARCH: 'check-production-path' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('账号核对未通过，已整批恢复原地址');
    expect(f.calls().slice(-3)).toEqual(['arch check-production-path', ...RESTORE]);
    expect(f.calls()).not.toContain('arch finish-production-path --apply');
  });

  it('leaves the edge alone when Arch fails, and restores Arch when the edge fails (the receiver restores itself)', () => {
    const arch = fixture();
    const archFailed = arch.run(['move', ...base, '--apply'], { FAIL_ARCH: 'move-production-path --apply' });
    expect(archFailed.status).toBe(1);
    expect(archFailed.stderr).toContain('香港入口未动');
    expect(arch.calls()).toEqual(['arch move-production-path --apply']);
    const edge = fixture();
    const edgeFailed = edge.run(['move', ...base, '--apply'], { FAIL_EDGE: 'production-apply' });
    expect(edgeFailed.status).toBe(1);
    expect(edgeFailed.stderr).toContain('香港入口切换失败，已恢复');
    expect(edge.calls()).toEqual(['arch move-production-path --apply', 'edge production-apply', 'arch rollback-production-path --apply']);
  });

  it('reports a failed restore instead of claiming it, and keeps the move when only the finish step fails', () => {
    const restore = fixture();
    const failed = restore.run(['move', ...base, '--apply'], { FAKE_SIGNIN: '502', FAIL_EDGE: 'production-rollback' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('香港入口恢复失败，需人工处理');
    expect(failed.stderr).toContain('恢复也没有完成');
    expect(restore.calls().slice(-2)).toEqual(RESTORE);
    const finish = fixture();
    const unfinished = finish.run(['move', ...base, '--apply'], { FAIL_ARCH: 'finish-production-path --apply' });
    expect(unfinished.status).toBe(1);
    expect(unfinished.stderr).toContain('重跑 move');
    expect(finish.calls()).not.toContain('edge production-rollback');
  });

  it('rolls back only with apply, edge first', () => {
    const dry = fixture();
    expect(dry.run(['rollback', ...base]).status).toBe(0);
    expect(dry.calls()).toEqual(['arch rollback-production-path']);
    const f = fixture();
    expect(f.run(['rollback', ...base, '--apply']).status).toBe(0);
    expect(f.calls()).toEqual(RESTORE);
  });

  it.each([
    ['--gitlab-url', 'https://site.example.test'],
    ['--gitlab-url', 'http://site.example.test/gitlab'],
    ['--legacy-origin', 'https://old.example.test/path'],
    ['--issuer-origins', 'https://site.example.test;id'],
  ])('refuses %s %s before touching anything', (flag, value) => {
    const f = fixture();
    const args = [...base];
    args[args.indexOf(flag) + 1] = value;
    expect(f.run(['move', ...args, '--apply']).status).toBe(1);
    expect(f.calls()).toEqual([]);
  });

  it('the GitLab compose template rotates container logs with the same json-file values as both site stacks', () => {
    const logging = (file: string) => [...readFileSync(resolve(file), 'utf8').matchAll(/^ {4}logging:\n {6}driver: (\S+)\n {6}options:\n {8}max-size: "([^"]+)"\n {8}max-file: "([^"]+)"\n/gm)].map(match => match.slice(1));
    const gitlab = logging('deploy/gitlab/docker-compose.yml');
    expect(gitlab).toEqual([['json-file', '10m', '3']]);
    for (const stack of ['deploy/compose/production.yml', 'deploy/compose/preview.yml']) {
      const values = logging(stack);
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) expect(value).toEqual(gitlab[0]);
    }
  });

  it('gitlab-cutover.yml sends the three steps to move-path.sh with the template values and keeps them out of cutover.sh', () => {
    const workflow = readFileSync(resolve('.github/workflows/gitlab-cutover.yml'), 'utf8');
    for (const step of ['path-status', 'move-production-path', 'rollback-production-path']) expect(workflow).toContain(`          - ${step}\n`);
    expect(workflow).toContain('bash deploy/gitlab/move-path.sh "$action" --gitlab-url "$gitlab_url" --legacy-origin "$legacy_origin" --issuer-origins "$production_origin $preview_origin" $flag');
    expect(workflow).toContain(`if: "!startsWith(inputs.step, 'edge-') && !contains(fromJSON('[\\"path-status\\", \\"move-production-path\\", \\"rollback-production-path\\"]'), inputs.step)"`);
    expect(workflow.match(/--sector \$sector/g)).toHaveLength(2);
    expect(workflow).not.toContain('|| true');
    const legacy = spawnSync('sed', ['-n', 's/^\\([a-z0-9.-]*\\) {$/\\1/p', resolve('deploy/gitlab/gitlab.caddy')], { encoding: 'utf8' }).stdout.trim();
    const production = readFileSync(resolve('deploy/env/.env.production'), 'utf8');
    const gitlabUrl = production.match(/^GITLAB_URL=(.*)$/m)![1];
    expect(legacy.split('\n')).toHaveLength(1);
    expect(legacy).not.toBe(new URL(gitlabUrl).hostname);
    expect(readFileSync(resolve('deploy/gitlab/gitlab.caddy'), 'utf8')).toContain(`redir ${gitlabUrl}{uri} 301`);
    expect(production).toContain(`GITLAB_OIDC_SECTOR=${legacy}\n`);
  });
});
