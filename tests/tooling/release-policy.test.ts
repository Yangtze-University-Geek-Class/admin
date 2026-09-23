import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BRANCH_ENVIRONMENTS, planDeployment } from '../../scripts/release-policy.mjs';
import { validateEnvironmentFiles } from '../../scripts/deployment-environment.mjs';

// 夹具全部是临时目录里合成出来的假仓库 + 真实的环境契约副本；从不改动 geek_main 的分支、tag 或工作区。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const script = join(repoRoot, 'scripts/release-policy.mjs');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgSign=false',
      '-c',
      'user.name=Release fixture',
      '-c',
      'user.email=fixture@example.invalid',
      ...args,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();

/** 合成一个「环境契约 + package.json + main/stage 两条长期分支」的最小仓库。 */
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'geek-branch-model-'));
  roots.push(cwd);
  cpSync(join(repoRoot, 'deploy/env'), join(cwd, 'deploy/env'), { recursive: true });
  cpSync(join(repoRoot, 'deploy/environments.json'), join(cwd, 'deploy/environments.json'));
  writeFileSync(join(cwd, 'package.json'), `${JSON.stringify({ name: 'fixture', version: '0.1.0' }, null, 2)}\n`);
  git(cwd, 'init', '--initial-branch=main');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', 'main baseline');
  const mainTip = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', '-b', 'stage');
  git(cwd, 'commit', '--allow-empty', '-m', 'stage integration');
  const stageTip = git(cwd, 'rev-parse', 'HEAD');
  return { cwd, mainTip, stageTip };
}

describe('branch → environment release identity', () => {
  it('maps only main and stage to the two environments, and refuses personal or task branches', () => {
    expect(BRANCH_ENVIRONMENTS).toEqual({ main: 'production', stage: 'preview' });
    const f = fixture();
    const production = planDeployment({ repo: f.cwd, root: f.cwd, branch: 'main', commit: f.mainTip });
    expect(production).toMatchObject({
      environment: 'production',
      githubEnvironment: 'production',
      origin: 'https://yangtzeu.work',
      branch: 'main',
      version: '0.1.0',
      releaseVersion: '0.1.0',
      imageTag: f.mainTip.slice(0, 12),
      requiresPriorPreviewEvidence: true,
      tagSemantics: false,
      deploymentAuthorized: false,
      enableVar: 'DEPLOY_PRODUCTION_ENABLED',
      sentinelVar: 'DEPLOY_TARGET_ENVIRONMENT',
      envTemplate: 'deploy/env/.env.production',
      runtimeEnvFile: '/opt/yzgc/production/.env.production',
      imagesArchive: `yzgc-images-production-${f.mainTip.slice(0, 12)}.tar.gz`,
      composeFile: 'deploy/compose/production.yml',
    });
    expect(production.images).toEqual({
      server: `yzgc/server:${f.mainTip.slice(0, 12)}`,
      web: `yzgc/web:${f.mainTip.slice(0, 12)}`,
      forum: `yzgc/forum:${f.mainTip.slice(0, 12)}`,
    });

    const preview = planDeployment({ repo: f.cwd, root: f.cwd, branch: 'stage', commit: f.stageTip });
    expect(preview).toMatchObject({
      environment: 'preview',
      origin: 'https://prev.yangtzeu.work',
      releaseVersion: `0.1.0@${f.stageTip.slice(0, 12)}`,
      requiresPriorPreviewEvidence: false,
      enableVar: 'DEPLOY_PREVIEW_ENABLED',
    });
    expect(preview.runtimeEnvFile).toBe('/opt/yzgc/preview/.env.preview');
    expect(preview.buildEnv).toEqual({
      GEEK_DEPLOYMENT_ENVIRONMENT: 'preview',
      GEEK_RELEASE_VERSION: `0.1.0@${f.stageTip.slice(0, 12)}`,
      GEEK_RELEASE_COMMIT: f.stageTip,
    });

    for (const branch of ['task/12/add_login', 'dev/crosery', 'task/12-add-login', 'dev-crosery', 'next', 'feature/x', '']) {
      expect(() => planDeployment({ repo: f.cwd, root: f.cwd, branch, commit: f.stageTip })).toThrow(/main.*stage|部署/);
    }
  });

  it('refuses a commit that is not the tip of the deployed branch, or does not exist locally', () => {
    const f = fixture();
    expect(() => planDeployment({ repo: f.cwd, root: f.cwd, branch: 'stage', commit: f.mainTip })).toThrow(/分支 tip/);
    expect(() => planDeployment({ repo: f.cwd, root: f.cwd, branch: 'main', commit: 'f'.repeat(40) })).toThrow(/找不到该提交/);
    expect(() => planDeployment({ repo: f.cwd, root: f.cwd, branch: 'main', commit: f.mainTip.slice(0, 12) })).toThrow(/40 位/);
    expect(() => planDeployment({ repo: f.cwd, root: f.cwd, branch: 'main', commit: f.mainTip.toUpperCase() })).toThrow(/40 位/);
  });

  it('is read-only: planning never writes files, refs or working tree state', () => {
    const f = fixture();
    const refsBefore = git(f.cwd, 'show-ref');
    const statusBefore = git(f.cwd, 'status', '--porcelain');
    planDeployment({ repo: f.cwd, root: f.cwd, branch: 'stage', commit: f.stageTip });
    planDeployment({ repo: f.cwd, root: f.cwd, branch: 'main', commit: f.mainTip });
    expect(git(f.cwd, 'show-ref')).toBe(refsBefore);
    expect(git(f.cwd, 'status', '--porcelain')).toBe(statusBefore);
  });
});

describe('planner CLI', () => {
  it('prints the identity as JSON on stdout and keeps the summary on stderr', () => {
    const f = fixture();
    const result = spawnSync(
      process.execPath,
      [script, 'plan', '--branch', 'stage', '--commit', f.stageTip, '--root', f.cwd, '--repo', f.cwd],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    const identity = JSON.parse(result.stdout);
    expect(identity).toMatchObject({ branch: 'stage', environment: 'preview', imageTag: f.stageTip.slice(0, 12) });
    expect(result.stderr).toContain('stage → preview');
    // 部署身份与本地 Git 证据通过，不代表人工试用或部署成功。
    expect(identity.deploymentAuthorized).toBe(false);
  });

  it('refuses tag/version/approval switches and the retired tag modes', () => {
    const f = fixture();
    for (const extra of [['--approved', 'true'], ['--tag', 'release-1.0.0'], ['--base-tag', 'prev-1.0.0'], ['--version', '1.0.0']]) {
      const result = spawnSync(
        process.execPath,
        [script, 'plan', '--branch', 'stage', '--commit', f.stageTip, '--root', f.cwd, '--repo', f.cwd, ...extra],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/批准开关|tag|版本/);
    }
    const legacy = spawnSync(process.execPath, [script, 'preview', '--base-tag', 'prev-1.0.0'], { encoding: 'utf8' });
    expect(legacy.status).toBe(1);
    expect(legacy.stderr).toContain('退役');
  });

  it('rejects a requested origin that contradicts the environment contract', () => {
    const f = fixture();
    const result = spawnSync(
      process.execPath,
      [script, 'plan', '--branch', 'stage', '--commit', f.stageTip, '--root', f.cwd, '--repo', f.cwd, '--origin', 'https://yangtzeu.work'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('https://prev.yangtzeu.work');
  });
});

describe('release identity follows the branch, never a stored field', () => {
  it('carries the X.Y.Z / X.Y.Z@sha12 rule into the build args', () => {
    const f = fixture();
    const production = planDeployment({ repo: f.cwd, root: f.cwd, branch: 'main', commit: f.mainTip });
    expect(production.buildEnv.GEEK_RELEASE_VERSION).toBe('0.1.0');
    const preview = planDeployment({ repo: f.cwd, root: f.cwd, branch: 'stage', commit: f.stageTip });
    expect(preview.buildEnv.GEEK_RELEASE_VERSION).toBe(`0.1.0@${f.stageTip.slice(0, 12)}`);
    expect(preview.buildEnv.GEEK_RELEASE_COMMIT).toBe(f.stageTip);
    // 发布身份是构建期 build args：env 模板里写死就会被契约校验拒绝。
    const templatePath = join(f.cwd, 'deploy/env/.env.production');
    writeFileSync(templatePath, `${readFileSync(templatePath, 'utf8')}\nGEEK_RELEASE_VERSION=0.1.0\n`);
    const report = validateEnvironmentFiles({ root: f.cwd, checkCompose: false });
    expect(report.ok).toBe(false);
    expect(report.problems.join('\n')).toContain('GEEK_RELEASE_VERSION');
  });
});
