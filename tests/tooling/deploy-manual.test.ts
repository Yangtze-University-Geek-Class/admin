import { describe, expect, it } from 'vitest';
import {
  RELEASE_TAG_RE, acceptanceComment, acceptanceSays, artifactName, buildJobSucceeded, deploy, deploymentPayload, expectedDigest, parseArgs,
  REQUIRED_CONTEXT, pickRun, previewReleaseMatches, repoFromRemote, sshTarget, templateTarget, withoutSecrets, workflowFile,
} from '../../scripts/deploy-manual.mjs';
import { readFileSync } from 'node:fs';
import { RELEASE_TAG_RE as POLICY_TAG_RE } from '../../scripts/release-policy.mjs';

const COMMIT = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const REPO = 'Yangtze-University-Geek-Class/admin';
const APPROVAL = `https://github.com/${REPO}/issues/63#issuecomment-555`;

describe('deploy-manual arguments', () => {
  it('pairs rc tags with preview and release tags with production', () => {
    expect(parseArgs(['--environment', 'preview', '--tag', 'v0.1.0-rc.1'])).toMatchObject({ environment: 'preview', tag: 'v0.1.0-rc.1', dryRun: false });
    expect(parseArgs(['--environment', 'production', '--tag', 'v0.1.0', '--acceptance', APPROVAL, '--dry-run'])).toMatchObject({ environment: 'production', dryRun: true });
    expect(() => parseArgs(['--environment', 'preview', '--tag', 'v0.1.0'])).toThrow(/只进/);
    expect(() => parseArgs(['--environment', 'production', '--tag', 'v0.1.0-rc.1', '--acceptance', APPROVAL])).toThrow(/只进/);
  });

  it('requires a GitHub comment link as the approval for production and refuses it for preview', () => {
    expect(() => parseArgs(['--environment', 'production', '--tag', 'v0.1.0'])).toThrow(/--acceptance/);
    for (const link of ['https://x.test', 'http://github.com/o/r/issues/1#issuecomment-2', `https://github.com/${REPO}/issues/63`]) {
      expect(() => parseArgs(['--environment', 'production', '--tag', 'v0.1.0', '--acceptance', link])).toThrow(/--acceptance/);
    }
    expect(() => parseArgs(['--environment', 'preview', '--tag', 'v0.1.0-rc.1', '--acceptance', APPROVAL])).toThrow(/只用于正式/);
    expect(acceptanceComment(`https://github.com/${REPO}/pull/70#issuecomment-9`)).toEqual({ repo: REPO, number: 70, id: '9' });
  });

  it('rejects unknown environments, malformed tags and stray options, with the same tag rule as release-policy', () => {
    expect(RELEASE_TAG_RE.source).toBe(POLICY_TAG_RE.source);
    expect(() => parseArgs(['--environment', 'staging', '--tag', 'v0.1.0-rc.1'])).toThrow(/--environment/);
    for (const tag of ['0.1.0-rc.1', 'v0.1.0-rc.0', 'v0.1', 'latest', 'v0.1.0;rm -rf /']) {
      expect(() => parseArgs(['--environment', 'preview', '--tag', tag])).toThrow(/发布 tag/);
    }
    expect(() => parseArgs(['--environment', 'preview', '--tag', 'v0.1.0-rc.1', '--force'])).toThrow(/未知/);
  });
});

describe('deploy-manual helpers', () => {
  it('names the CI artifact and workflow the way the deploy workflows do', () => {
    expect(artifactName('preview', 'a1b2c3d4e5f6')).toBe('yzgc-images-preview-a1b2c3d4e5f6');
    expect(workflowFile('production')).toBe('deploy-production.yml');
  });

  it('reads owner/repo from the origin remote in either URL form', () => {
    expect(repoFromRemote(`git@github.com:${REPO}.git\n`)).toBe(REPO);
    expect(repoFromRemote(`https://github.com/${REPO}`)).toBe(REPO);
    expect(() => repoFromRemote('https://gitlab.com/o/r.git')).toThrow(/GitHub/);
  });

  it('accepts an approval only as its own line 「批准发布 vX.Y.Z」, not negated, quoted or rc-only', () => {
    expect(acceptanceSays('批准发布 v0.1.0', '0.1.0')).toBe(true);
    expect(acceptanceSays('预发布试过了，登录和成员页都没问题。\n批准发布 v0.1.0。', '0.1.0')).toBe(true);
    expect(acceptanceSays('批准发布 0.1.0.', '0.1.0')).toBe(true);
    for (const text of [
      '暂不批准发布 v0.1.0，等修完', '批准发布 v0.1.0-rc.1 到预发布；v0.1.0 还要再看', '> 批准发布 v0.1.0', '批准发布 v0.1.0-rc.1',
      '看起来不错 v0.1.0', '批准发布 v0.2.0', '批准发布 v0.1.01', '不批准发布 v0.1.0',
      // 渲染后不是正文的地方：代码块、缩进代码、注释、HTML 标签内、引用与懒续行
      '回复下面这行：\n```\n批准发布 v0.1.0\n```', '~~~md\n批准发布 v0.1.0\n~~~', '    批准发布 v0.1.0', '\t批准发布 v0.1.0',
      '<!-- 批准发布 v0.1.0 -->', '<!--\n批准发布 v0.1.0\n-->', '<blockquote>\n批准发布 v0.1.0\n</blockquote>', '<details><summary>模板</summary>\n\n批准发布 v0.1.0\n</details>',
      '> 所有者说：\n批准发布 v0.1.0', '＞ 批准发布 v0.1.0',
    ]) expect(acceptanceSays(text, '0.1.0'), text).toBe(false);
    // 引用结束（空行）之后、代码块关闭之后的正文照常算。
    expect(acceptanceSays('> 上次的讨论\n\n批准发布 v0.1.0', '0.1.0')).toBe(true);
    expect(acceptanceSays('```\nlog\n```\n批准发布 v0.1.0', '0.1.0')).toBe(true);
  });

  it('strips every secret from the environment handed to other child processes', () => {
    const env = { PATH: '/bin', HOME: '/h', OAUTH_CLIENT_SECRET: 's', SESSION_SECRET: 's', ENCRYPTION_KEY: 'k', OAUTH_CLIENT_ID: 'i', TURNSTILE_SITE_KEY: 't', TURNSTILE_SECRET_KEY: 't', DEPLOY_SSH_HOST: 'h' };
    expect(withoutSecrets(env)).toEqual({ PATH: '/bin', HOME: '/h', DEPLOY_SSH_HOST: 'h' });
  });

  it('picks the newest finished push run for exactly this tag and commit', () => {
    const base = { event: 'push', head_branch: 'v0.1.0-rc.1', head_sha: COMMIT, status: 'completed' };
    const runs = [
      { ...base, id: 1, created_at: '2026-09-25T06:00:00Z' },
      { ...base, id: 2, created_at: '2026-09-25T07:00:00Z' },
      { ...base, id: 3, created_at: '2026-09-25T08:00:00Z', status: 'in_progress' },
      { ...base, id: 4, created_at: '2026-09-25T09:00:00Z', event: 'workflow_dispatch' },
      { ...base, id: 5, created_at: '2026-09-25T10:00:00Z', head_sha: 'f'.repeat(40) },
      { ...base, id: 6, created_at: '2026-09-25T11:00:00Z', head_branch: 'v0.1.0-rc.2' },
    ];
    expect(pickRun(runs, { tag: 'v0.1.0-rc.1', commit: COMMIT })?.id).toBe(2);
    expect(pickRun([], { tag: 'v0.1.0-rc.1', commit: COMMIT })).toBeNull();
  });

  it('only trusts a successful build job, whatever happened to the deploy job', () => {
    expect(buildJobSucceeded([{ name: 'build (镜像归档)', conclusion: 'success' }, { name: 'deploy (preview stack)', conclusion: 'failure' }])).toBe(true);
    expect(buildJobSucceeded([{ name: 'build (镜像归档)', conclusion: 'failure' }])).toBe(false);
    expect(buildJobSucceeded([{ name: 'rebuild', conclusion: 'success' }])).toBe(false);
  });

  it('writes the CI payload keys (production also preview_tags) plus where it was deployed from', () => {
    const plan = { environment: 'production', tag: 'v0.1.0', releaseVersion: '0.1.0', imageTag: 'a1b2c3d4e5f6', imageRepository: 'yzgc-production', previewTags: ['v0.1.0-rc.1', 'v0.1.0-rc.2'] };
    expect(deploymentPayload(plan, APPROVAL)).toEqual({
      tag: 'v0.1.0', release_version: '0.1.0', image_tag: 'a1b2c3d4e5f6', image_repository: 'yzgc-production',
      preview_tags: 'v0.1.0-rc.1 v0.1.0-rc.2', deployed_from: 'maintainer', acceptance: APPROVAL,
    });
    expect(deploymentPayload({ ...plan, environment: 'preview', previewTags: [] }, undefined)).not.toHaveProperty('preview_tags');
  });

  it('accepts the preview release.json only for this commit and one of its rc versions', () => {
    const body = { environment: 'preview', commit: COMMIT, version: `0.1.0-rc.2@${COMMIT.slice(0, 12)}` };
    expect(previewReleaseMatches(body, COMMIT, ['v0.1.0-rc.1', 'v0.1.0-rc.2'])).toBe(true);
    expect(previewReleaseMatches({ ...body, environment: 'production' }, COMMIT, ['v0.1.0-rc.2'])).toBe(false);
    expect(previewReleaseMatches({ ...body, commit: 'f'.repeat(40) }, COMMIT, ['v0.1.0-rc.2'])).toBe(false);
    expect(previewReleaseMatches(body, COMMIT, ['v0.1.0-rc.1'])).toBe(false);
    expect(previewReleaseMatches(null, COMMIT, ['v0.1.0-rc.2'])).toBe(false);
  });

  it('reads the digest for the named archive from sha256sum output', () => {
    const hex = 'ab'.repeat(32);
    expect(expectedDigest(`${hex}  yzgc-images-preview-a1b2c3d4e5f6.tar.gz\n`, 'yzgc-images-preview-a1b2c3d4e5f6.tar.gz')).toBe(hex);
    expect(expectedDigest(`${hex}  other.tar.gz\n`, 'yzgc-images-preview-a1b2c3d4e5f6.tar.gz')).toBeNull();
    expect(expectedDigest('not a digest  yzgc.tar.gz', 'yzgc.tar.gz')).toBeNull();
  });

  it('refuses SSH targets that look like options or do not match the environment template', () => {
    const template = templateTarget('DEPLOY_HOST=203.0.113.9\nDEPLOY_PORT=22000\nDEPLOY_USER=root\n');
    const env = { DEPLOY_SSH_HOST: '203.0.113.9', DEPLOY_SSH_PORT: '22000', DEPLOY_SSH_USER: 'root', DEPLOY_SSH_KEY_FILE: '/k', DEPLOY_SSH_KNOWN_HOSTS_FILE: '/h' };
    const [command, args] = sshTarget(env, template).ssh('true');
    expect(command).toBe('ssh');
    expect(args).toEqual(expect.arrayContaining(['-F', 'none', 'StrictHostKeyChecking=yes', 'GlobalKnownHostsFile=/dev/null', 'root@203.0.113.9']));
    expect(() => sshTarget({ ...env, DEPLOY_SSH_HOST: '-oProxyCommand=x' }, template)).toThrow(/格式/);
    expect(() => sshTarget({ ...env, DEPLOY_SSH_PORT: '22 -v' }, template)).toThrow(/格式/);
    expect(() => sshTarget({ ...env, DEPLOY_SSH_PORT: '22' }, template)).toThrow(/拿错/);
  });
});

type Call = { command: string; args: string[]; env?: Record<string, string> };
type WorldOptions = { environment?: string; tag?: string; permission?: string; previewState?: string; releaseCommit?: string; failOn?: string | null; commentIssue?: number; approvedAt?: string; editedAt?: string };

/** 假的外部世界：记录每个命令，按命令给出固定回答；可以指定在哪一步失败。 */
function fakeWorld({ environment = 'preview', tag = 'v0.1.0-rc.1', permission = 'admin', previewState = 'success', releaseCommit = COMMIT, failOn = null, commentIssue = 63, approvedAt = '2026-09-25T11:00:00Z', editedAt }: WorldOptions = {}) {
  const calls: Call[] = [];
  const removed: string[] = [];
  const work = '/tmp/yzgc-deploy-test';
  const hash = 'cd'.repeat(32);
  const imagesArchive = `yzgc-images-${environment}-${COMMIT.slice(0, 12)}.tar.gz`;
  const plan = {
    environment, tag, commit: COMMIT, version: '0.1.0', releaseVersion: environment === 'preview' ? `${tag.slice(1)}@${COMMIT.slice(0, 12)}` : '0.1.0',
    imageTag: COMMIT.slice(0, 12), imageRepository: `yzgc-${environment}`, imagesArchive, previewTags: environment === 'production' ? ['v0.1.0-rc.1'] : [],
    stackRoot: `/opt/yzgc/${environment}`, incomingDir: `/opt/yzgc/${environment}/incoming`, origin: 'https://prev.yangtzeu.work',
  };
  const env: Record<string, string> = {
    DEPLOY_TARGET_ENVIRONMENT: environment, PATH: '/usr/bin', HOME: '/home/x',
    OAUTH_CLIENT_ID: 'id', OAUTH_CLIENT_SECRET: 'secret-value', SESSION_SECRET: 'session-value', ENCRYPTION_KEY: 'key-value',
    DEPLOY_SSH_HOST: '203.0.113.9', DEPLOY_SSH_PORT: '22000', DEPLOY_SSH_USER: 'root', DEPLOY_SSH_KEY_FILE: '/k', DEPLOY_SSH_KNOWN_HOSTS_FILE: '/h',
  };
  const answer = (command: string, args: string[]) => {
    const line = [command, ...args].join(' ');
    if (failOn && line.includes(failOn)) throw new Error(`fake failure at ${failOn}`);
    if (line === 'git remote get-url origin') return `git@github.com:${REPO}.git\n`;
    if (command === 'git' && args[0] === 'rev-parse') return `${COMMIT}\n`;
    if (line.includes('release-policy.mjs plan')) return JSON.stringify(plan);
    if (line.includes('/issues/comments/555')) return JSON.stringify({ body: '试过了。\n批准发布 v0.1.0', user: { login: 'Crosery' }, issue_url: `https://api.github.com/repos/${REPO}/issues/${commentIssue}`, created_at: approvedAt, updated_at: editedAt ?? approvedAt });
    if (line.includes('/permission')) return JSON.stringify({ permission });
    if (line.includes('deployments?environment=preview')) return JSON.stringify([{ id: 7, payload: { tag: 'v0.1.0-rc.1' } }]);
    if (line.includes('deployments/7/statuses')) return JSON.stringify([{ state: previewState, created_at: '2026-09-25T10:00:00Z' }]);
    if (line.includes('/runs?event=push')) return JSON.stringify({ workflow_runs: [{ id: 99, event: 'push', head_branch: tag, head_sha: COMMIT, status: 'completed', created_at: 'x', html_url: 'u' }] });
    if (line.includes('/runs/99/jobs')) return JSON.stringify({ jobs: [{ name: 'build (镜像归档)', conclusion: 'success' }] });
    if (line.includes('--method POST') && line.endsWith('--jq .id')) return '4242\n';
    return '';
  };
  const deps = {
    env,
    run: (command: string, args: string[], options: { env?: Record<string, string> } = {}) => { calls.push({ command, args, env: options.env }); return answer(command, args); },
    fetchJson: () => ({ environment: 'preview', commit: releaseCommit, version: `0.1.0-rc.1@${COMMIT.slice(0, 12)}` }),
    readText: (path: string) => (path.endsWith('.sha256') ? `${hash}  ${imagesArchive}\n` : 'DEPLOY_HOST=203.0.113.9\nDEPLOY_PORT=22000\nDEPLOY_USER=root\n'),
    hashFile: async () => hash,
    tempDir: () => work,
    makeDir: () => {},
    removeDir: (path: string) => { removed.push(path); },
    trap: () => () => {},
    log: () => {},
  };
  const index = (needle: string) => calls.findIndex(call => [call.command, ...call.args].join(' ').includes(needle));
  return { deps, calls, removed, work, index };
}

describe('deploy-manual orchestration', () => {
  it('refuses to start when the exported secrets are not for this environment', async () => {
    const world = fakeWorld();
    world.deps.env.DEPLOY_TARGET_ENVIRONMENT = 'production';
    await expect(deploy({ environment: 'preview', tag: 'v0.1.0-rc.1' }, world.deps)).rejects.toThrow(/DEPLOY_TARGET_ENVIRONMENT/);
    expect(world.calls).toEqual([]);
  });

  it('takes every deploy material from the tagged commit, not the working tree', async () => {
    const world = fakeWorld();
    await deploy({ environment: 'preview', tag: 'v0.1.0-rc.1' }, world.deps);
    const archive = world.calls[world.index('git archive')];
    expect(archive.args).toEqual(expect.arrayContaining([COMMIT, 'deploy', 'scripts', 'package.json']));
    expect(world.index('git archive')).toBeLessThan(world.index('release-policy.mjs plan'));
    const src = `${world.work}/src`;
    for (const needle of ['release-policy.mjs plan', 'deployment-environment.mjs --check', 'deployment-environment.mjs render']) {
      expect(world.calls[world.index(needle)].args[0].startsWith(src)).toBe(true);
    }
    const scps = world.calls.filter(call => call.command === 'scp').flatMap(call => call.args.filter(arg => arg.includes('deploy/')));
    expect(scps.length).toBeGreaterThan(0);
    for (const path of scps.filter(arg => !arg.includes(':'))) expect(path.startsWith(src)).toBe(true);
    // 部署记录只要求 CI 的 verify 通过（与两条部署工作流一致），不会被部署 job 自己的检查挡住。
    const create = world.calls.find(call => call.args.includes('--jq') && call.args.some(arg => arg.endsWith('/deployments')))!;
    expect(create.args).toContain(`required_contexts[]=${REQUIRED_CONTEXT}`);
    for (const env of ['preview', 'production']) {
      const workflow = readFileSync(new URL(`../../.github/workflows/deploy-${env}.yml`, import.meta.url), 'utf8');
      expect(workflow).toContain(`-f "required_contexts[]=${REQUIRED_CONTEXT}"`);
      const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
      expect(ci).toContain(`name: ${REQUIRED_CONTEXT}`);
    }
    // 部署成功后记录置为 success，临时目录删掉。
    expect(world.calls.some(call => call.args.includes('state=success'))).toBe(true);
    expect(world.removed).toEqual([world.work]);
  });

  it('hands secrets to render through the child environment only', async () => {
    const world = fakeWorld();
    await deploy({ environment: 'preview', tag: 'v0.1.0-rc.1', dryRun: true }, world.deps);
    const render = world.calls[world.index('deployment-environment.mjs render')];
    // plan、--check、render 都用和脚本同一个 Node。
    for (const needle of ['release-policy.mjs plan', 'deployment-environment.mjs --check', 'deployment-environment.mjs render']) {
      expect(world.calls[world.index(needle)].command).toBe(process.execPath);
    }
    expect(render.env).toMatchObject({ SESSION_SECRET: 'session-value', ENCRYPTION_KEY: 'key-value' });
    for (const call of world.calls) expect(call.args.join(' ')).not.toMatch(/secret-value|session-value|key-value/);
  });

  it('dry-run stops after download and render: no SSH, no deployment record', async () => {
    const world = fakeWorld();
    await deploy({ environment: 'preview', tag: 'v0.1.0-rc.1', dryRun: true }, world.deps);
    expect(world.index('gh run download')).toBeGreaterThan(-1);
    expect(world.calls.filter(call => call.command === 'ssh' || call.command === 'scp')).toEqual([]);
    expect(world.calls.filter(call => call.args.includes('POST'))).toEqual([]);
    expect(world.removed).toEqual([world.work]);
  });

  it('production checks the approval and preview evidence before downloading anything', async () => {
    const options = { environment: 'production', tag: 'v0.1.0', acceptance: APPROVAL };
    for (const [overrides, message] of [
      [{ permission: 'write' }, /不是仓库管理员/],
      [{ previewState: 'failure' }, /成功预发布部署记录/],
      [{ releaseCommit: 'f'.repeat(40) }, /release\.json/],
      [{ commentIssue: 64 }, /不在链接写的 #63/],
      [{ approvedAt: '2026-09-25T09:00:00Z' }, /早于预发布部署成功/],
      [{ editedAt: '2026-09-25T12:00:00Z' }, /被编辑过/],
    ]) {
      const world = fakeWorld({ environment: 'production', tag: 'v0.1.0', ...overrides });
      await expect(deploy(options, world.deps)).rejects.toThrow(message);
      expect(world.index('gh run download')).toBe(-1);
      expect(world.calls.filter(call => call.command === 'ssh')).toEqual([]);
      expect(world.removed).toEqual([world.work]);
    }
    const world = fakeWorld({ environment: 'production', tag: 'v0.1.0' });
    await deploy({ ...options, dryRun: true }, world.deps);
    expect(world.index('/permission')).toBeLessThan(world.index('gh run download'));
  });

  it('marks the deployment record failed and cleans up when the remote step fails', async () => {
    const world = fakeWorld({ failOn: "bash '" });
    await expect(deploy({ environment: 'preview', tag: 'v0.1.0-rc.1' }, world.deps)).rejects.toThrow(/fake failure/);
    expect(world.calls.some(call => call.args.includes('state=failure'))).toBe(true);
    expect(world.calls.some(call => call.args.includes('state=success'))).toBe(false);
    expect(world.removed).toEqual([world.work]);
  });
});
