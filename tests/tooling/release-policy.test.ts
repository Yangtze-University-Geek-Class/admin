import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RELEASE_TAG_RE, TAG_KINDS, parseReleaseTag, planDeployment, previewTagsFor } from '../../scripts/release-policy.mjs';
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
      'tag.gpgSign=false',
      '-c',
      'user.name=Release fixture',
      '-c',
      'user.email=fixture@example.invalid',
      ...args,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();

const writeVersion = (cwd: string, version: string) =>
  writeFileSync(join(cwd, 'package.json'), `${JSON.stringify({ name: 'fixture', version }, null, 2)}\n`);

/**
 * 合成「环境契约 + package.json + main/stage 两条长期分支」的最小仓库：
 * main 在 0.1.0 的基线上；stage 比 main 多一个提交（mainTip 是 stageTip 的祖先）。
 */
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'geek-tag-model-'));
  roots.push(cwd);
  cpSync(join(repoRoot, 'deploy/env'), join(cwd, 'deploy/env'), { recursive: true });
  cpSync(join(repoRoot, 'deploy/environments.json'), join(cwd, 'deploy/environments.json'));
  writeVersion(cwd, '0.1.0');
  git(cwd, 'init', '--initial-branch=main');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', 'main baseline');
  const mainTip = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', '-b', 'stage');
  git(cwd, 'commit', '--allow-empty', '-m', 'stage integration');
  const stageTip = git(cwd, 'rev-parse', 'HEAD');
  return { cwd, mainTip, stageTip };
}

const plan = (cwd: string, tag: string, commit: string, extra: Record<string, unknown> = {}) =>
  planDeployment({ repo: cwd, root: cwd, tag, commit, ...extra });

describe('release tag grammar', () => {
  it('pins the exact SemVer tag regex and maps rc → preview/stage, final → production/main', () => {
    expect(RELEASE_TAG_RE.source).toBe('^v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-rc\\.([1-9]\\d*))?$');
    expect(TAG_KINDS).toEqual({ rc: { environment: 'preview', branch: 'stage' }, final: { environment: 'production', branch: 'main' } });
    expect(parseReleaseTag('v0.1.0-rc.1')).toMatchObject({ kind: 'rc', version: '0.1.0', rc: 1, environment: 'preview', branch: 'stage' });
    expect(parseReleaseTag('v10.20.30-rc.12')).toMatchObject({ kind: 'rc', version: '10.20.30', rc: 12 });
    expect(parseReleaseTag('v0.1.0')).toMatchObject({ kind: 'final', version: '0.1.0', rc: null, environment: 'production', branch: 'main' });
  });

  it('rejects branch names, SHAs, latest and every malformed tag', () => {
    for (const bad of [
      'main', 'stage', 'task/7/tag_release', 'dev/crosery', 'latest', 'HEAD',
      'a'.repeat(40), 'abcdef123456', '0.1.0', 'v0.1', 'v0.1.0.0', 'V0.1.0', 'v01.1.0', 'v0.01.0', 'v0.1.00',
      'v0.1.0-rc', 'v0.1.0-rc.0', 'v0.1.0-rc.01', 'v0.1.0-rc1', 'v0.1.0-RC.1', 'v0.1.0-beta.1', 'v0.1.0-rc.1.1',
      'v0.1.0+build', 'v0.1.0-rc.1@abcdef123456', 'release-0.1.0', 'prev-0.1.0', ' v0.1.0', 'v0.1.0\n', '',
    ]) {
      expect(parseReleaseTag(bad), bad).toBeNull();
    }
  });

  it('keeps the tag regex in RELEASES.md identical to the script', () => {
    const doc = readFileSync(join(repoRoot, 'docs/conventions/RELEASES.md'), 'utf8');
    expect(doc).toContain(`\`${RELEASE_TAG_RE.source}\``);
  });
});

describe('tag → environment release identity', () => {
  it('plans an rc tag on stage as a preview release with the X.Y.Z-rc.N@sha12 display version', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.stageTip);
    const preview = plan(f.cwd, 'v0.1.0-rc.1', f.stageTip);
    const short = f.stageTip.slice(0, 12);
    expect(preview).toMatchObject({
      model: 'tag',
      tag: 'v0.1.0-rc.1',
      tagKind: 'rc',
      rc: 1,
      branch: 'stage',
      containedIn: 'refs/heads/stage',
      environment: 'preview',
      githubEnvironment: 'preview',
      origin: 'https://prev.yangtzeu.work',
      version: '0.1.0',
      releaseVersion: `0.1.0-rc.1@${short}`,
      imageTag: short,
      requiresPriorPreviewEvidence: false,
      deploymentAuthorized: false,
      enableVar: 'DEPLOY_PREVIEW_ENABLED',
      sentinelVar: 'DEPLOY_TARGET_ENVIRONMENT',
      envTemplate: 'deploy/env/.env.preview',
      runtimeEnvFile: '/opt/yzgc/preview/.env.preview',
      imagesArchive: `yzgc-images-preview-${short}.tar.gz`,
      composeFile: 'deploy/compose/preview.yml',
    });
    expect(preview.imageRepository).toBe('yzgc-preview');
    expect(preview.images).toEqual({ server: `yzgc-preview/server:${short}`, web: `yzgc-preview/web:${short}`, forum: `yzgc-preview/forum:${short}` });
    expect(preview.buildEnv).toEqual({
      GEEK_DEPLOYMENT_ENVIRONMENT: 'preview',
      GEEK_RELEASE_VERSION: `0.1.0-rc.1@${short}`,
      GEEK_RELEASE_COMMIT: f.stageTip,
    });
  });

  it('plans a final tag on main as production with a bare X.Y.Z, only when an rc tag sits on the same commit', () => {
    const f = fixture();
    // 正常流程：rc 打在 stage 的提交上 → 所有者验收 → main 快进到同一提交 → 打正式 tag。
    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.mainTip);
    git(f.cwd, 'tag', '-a', 'v0.1.0-rc.2', '-m', 'annotated rc', f.mainTip);
    // 打正式 tag 之前先规划同一提交的预发布：打了正式 tag 以后这个版本不能再发 rc。
    const preview = plan(f.cwd, 'v0.1.0-rc.2', f.mainTip);
    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    const production = plan(f.cwd, 'v0.1.0', f.mainTip);
    const short = f.mainTip.slice(0, 12);
    expect(production).toMatchObject({
      tag: 'v0.1.0',
      tagKind: 'final',
      rc: null,
      branch: 'main',
      environment: 'production',
      origin: 'https://yangtzeu.work',
      version: '0.1.0',
      releaseVersion: '0.1.0',
      previewTags: ['v0.1.0-rc.1', 'v0.1.0-rc.2'],
      imageTag: short,
      requiresPriorPreviewEvidence: true,
      deploymentAuthorized: false,
      enableVar: 'DEPLOY_PRODUCTION_ENABLED',
      runtimeEnvFile: '/opt/yzgc/production/.env.production',
      composeFile: 'deploy/compose/production.yml',
    });
    expect(production.buildEnv.GEEK_RELEASE_VERSION).toBe('0.1.0');
    expect(previewTagsFor(f.cwd, '0.1.0', f.mainTip)).toEqual(['v0.1.0-rc.1', 'v0.1.0-rc.2']);
    // 同一提交的预发布与正式镜像：IMAGE_TAG 相同，镜像引用必须不同（两套栈共用一个 Docker 守护进程）。
    expect(production.imageTag).toBe(preview.imageTag);
    expect(production.imageRepository).toBe('yzgc-production');
    for (const service of ['server', 'web', 'forum'] as const) {
      expect(production.images[service]).toBe(`yzgc-production/${service}:${short}`);
      expect(production.images[service]).not.toBe(preview.images[service]);
    }
  });

  it('refuses a final tag whose commit has no rc tag of the same version', () => {
    const f = fixture();
    expect(() => plan(f.cwd, 'v0.1.0', f.mainTip)).toThrow(/没有 v0\.1\.0-rc\.N/);
    // 其它版本或其它提交上的 rc 都不算。
    git(f.cwd, 'tag', 'v0.0.9-rc.1', f.mainTip);
    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.stageTip);
    expect(() => plan(f.cwd, 'v0.1.0', f.mainTip)).toThrow(/没有 v0\.1\.0-rc\.N/);
  });

  it('refuses an rc tag whose commit is not on stage', () => {
    const f = fixture();
    git(f.cwd, 'checkout', '-b', 'task/7/tag_release', f.stageTip);
    git(f.cwd, 'commit', '--allow-empty', '-m', 'unmerged task work');
    const taskTip = git(f.cwd, 'rev-parse', 'HEAD');
    expect(() => plan(f.cwd, 'v0.1.0-rc.1', taskTip)).toThrow(/必须打在 stage 的提交上/);
    // origin/stage 优先于本地 stage：远端证据说了算。
    git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', f.mainTip);
    expect(() => plan(f.cwd, 'v0.1.0-rc.1', f.stageTip)).toThrow(/refs\/remotes\/origin\/stage/);
    // 显式 --branch-ref（CI 固定用 origin/stage）同样生效；stage 的祖先提交可以打 rc。
    expect(plan(f.cwd, 'v0.1.0-rc.1', f.mainTip, { branchRef: 'refs/remotes/origin/stage' }).containedIn).toBe('refs/remotes/origin/stage');
    expect(() => plan(f.cwd, 'v0.1.0-rc.1', f.stageTip, { branchRef: 'refs/remotes/origin/stage' })).toThrow(/必须打在 stage 的提交上/);
  });

  it('refuses a final tag whose commit is not on main, even when it is on stage and has an rc', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.stageTip);
    expect(() => plan(f.cwd, 'v0.1.0', f.stageTip)).toThrow(/必须打在 main 的提交上/);
  });

  it('refuses a tag whose X.Y.Z differs from package.json at that commit (not the working tree)', () => {
    const f = fixture();
    expect(() => plan(f.cwd, 'v0.2.0-rc.1', f.stageTip)).toThrow(/package\.json 的 version 0\.1\.0/);
    // 工作区改了 version 但没提交：以提交里的 package.json 为准。
    writeVersion(f.cwd, '0.2.0');
    expect(() => plan(f.cwd, 'v0.2.0-rc.1', f.stageTip)).toThrow(/package\.json 的 version 0\.1\.0/);
    expect(plan(f.cwd, 'v0.1.0-rc.1', f.stageTip).version).toBe('0.1.0');
    git(f.cwd, 'commit', '-am', 'bump version to 0.2.0');
    const bumped = git(f.cwd, 'rev-parse', 'HEAD');
    expect(plan(f.cwd, 'v0.2.0-rc.1', bumped).releaseVersion).toBe(`0.2.0-rc.1@${bumped.slice(0, 12)}`);
    expect(() => plan(f.cwd, 'v0.1.0-rc.2', bumped)).toThrow(/package\.json 的 version 0\.2\.0/);
  });

  it('refuses another rc for a version that already has a final tag', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.mainTip);
    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    expect(() => plan(f.cwd, 'v0.1.0-rc.2', f.stageTip)).toThrow(/已有正式 tag/);
  });

  it('refuses a tag that exists locally but points at another commit, and requireTag without the tag', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.mainTip);
    expect(() => plan(f.cwd, 'v0.1.0-rc.1', f.stageTip)).toThrow(/tag 不可移动/);
    expect(() => plan(f.cwd, 'v0.1.0-rc.2', f.stageTip, { requireTag: true })).toThrow(/找不到 refs\/tags\/v0\.1\.0-rc\.2/);
    expect(plan(f.cwd, 'v0.1.0-rc.2', f.stageTip).notes.join('\n')).toContain('本地还没有 refs/tags/v0.1.0-rc.2');
  });

  it('refuses branch names, latest, short SHAs, unknown commits and malformed tags', () => {
    const f = fixture();
    for (const tag of ['stage', 'main', 'latest', 'v0.1.0-rc.0', 'v0.1', 'release-0.1.0', f.stageTip.slice(0, 12), f.stageTip, '']) {
      expect(() => plan(f.cwd, tag, f.stageTip), tag).toThrow(/发布 tag 只接受/);
    }
    expect(() => plan(f.cwd, 'v0.1.0-rc.1', f.stageTip.slice(0, 12))).toThrow(/40 位/);
    expect(() => plan(f.cwd, 'v0.1.0-rc.1', f.stageTip.toUpperCase())).toThrow(/40 位/);
    expect(() => plan(f.cwd, 'v0.1.0-rc.1', 'f'.repeat(40))).toThrow(/找不到该提交/);
  });

  it('is read-only: planning never writes files, refs or working tree state', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.mainTip);
    const refsBefore = git(f.cwd, 'show-ref');
    const statusBefore = git(f.cwd, 'status', '--porcelain');
    plan(f.cwd, 'v0.1.0-rc.2', f.stageTip);
    plan(f.cwd, 'v0.1.0', f.mainTip);
    expect(git(f.cwd, 'show-ref')).toBe(refsBefore);
    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    const refsWithFinal = git(f.cwd, 'show-ref');
    expect(() => plan(f.cwd, 'v0.1.0-rc.9', f.stageTip)).toThrow();
    expect(git(f.cwd, 'show-ref')).toBe(refsWithFinal);
    expect(git(f.cwd, 'status', '--porcelain')).toBe(statusBefore);
  });
});

describe('planner CLI', () => {
  const run = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [script, 'plan', ...args, '--root', cwd, '--repo', cwd], { encoding: 'utf8' });

  it('prints the identity as JSON on stdout and keeps the summary on stderr', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.stageTip);
    const result = run(f.cwd, '--tag', 'v0.1.0-rc.1', '--commit', f.stageTip, '--branch-ref', 'refs/heads/stage', '--require-tag');
    expect(result.status).toBe(0);
    const identity = JSON.parse(result.stdout);
    expect(identity).toMatchObject({ tag: 'v0.1.0-rc.1', environment: 'preview', imageTag: f.stageTip.slice(0, 12) });
    expect(result.stderr).toContain('v0.1.0-rc.1 → preview');
    // tag 与本地 Git 证据通过，不代表人工试用或部署成功。
    expect(identity.deploymentAuthorized).toBe(false);
  });

  it('exits 1 with an explanation for every rejected case', () => {
    const f = fixture();
    const cases: Array<[string[], RegExp]> = [
      [['--tag', 'v0.1.0', '--commit', f.stageTip], /必须打在 main 的提交上/],
      [['--tag', 'v0.1.0', '--commit', f.mainTip], /没有 v0\.1\.0-rc\.N/],
      [['--tag', 'v0.3.0-rc.1', '--commit', f.stageTip], /version 0\.1\.0/],
      [['--tag', 'stage', '--commit', f.stageTip], /发布 tag 只接受/],
      [['--tag', 'latest', '--commit', f.stageTip], /发布 tag 只接受/],
      [['--tag', 'v0.1.0-rc.1', '--commit', f.stageTip.slice(0, 12)], /40 位/],
      [['--tag', 'v0.1.0-rc.1', '--commit', f.stageTip, '--require-tag'], /找不到 refs\/tags/],
      [['--commit', f.stageTip], /--tag/],
      [['--tag', 'v0.1.0-rc.1'], /--commit/],
    ];
    for (const [args, message] of cases) {
      const result = run(f.cwd, ...args);
      expect(result.status, args.join(' ')).toBe(1);
      expect(result.stderr, args.join(' ')).toMatch(message);
      expect(result.stdout, args.join(' ')).toBe('');
    }
  });

  it('refuses the retired branch model and version/approval switches', () => {
    const f = fixture();
    for (const [extra, message] of [
      [['--branch', 'stage'], /分支参数/],
      [['--approved', 'true'], /批准开关/],
      [['--base-tag', 'prev-1.0.0'], /基准 tag/],
      [['--version', '1.0.0'], /版本参数/],
      [['--display-version', '1.0.0'], /展示版本/],
    ] as Array<[string[], RegExp]>) {
      const result = run(f.cwd, '--tag', 'v0.1.0-rc.1', '--commit', f.stageTip, ...extra);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(message);
    }
    const legacy = spawnSync(process.execPath, [script, 'preview', '--base-tag', 'prev-1.0.0'], { encoding: 'utf8' });
    expect(legacy.status).toBe(1);
    expect(legacy.stderr).toContain('退役');
  });

  it('rejects a requested origin that contradicts the environment contract', () => {
    const f = fixture();
    const result = run(f.cwd, '--tag', 'v0.1.0-rc.1', '--commit', f.stageTip, '--origin', 'https://yangtzeu.work');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('https://prev.yangtzeu.work');
  });
});

describe('release identity follows the tag, never a stored field', () => {
  it('carries the X.Y.Z / X.Y.Z-rc.N@sha12 rule into the build args', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0-rc.3', f.mainTip);
    const production = plan(f.cwd, 'v0.1.0', f.mainTip);
    expect(production.buildEnv.GEEK_RELEASE_VERSION).toBe('0.1.0');
    expect(production.buildEnv.GEEK_RELEASE_VERSION).not.toMatch(/[@-]/);
    const preview = plan(f.cwd, 'v0.1.0-rc.4', f.stageTip);
    expect(preview.buildEnv.GEEK_RELEASE_VERSION).toBe(`0.1.0-rc.4@${f.stageTip.slice(0, 12)}`);
    expect(preview.buildEnv.GEEK_RELEASE_COMMIT).toBe(f.stageTip);
  });

  it('keeps release identity out of the env templates', () => {
    const f = fixture();
    // 发布身份是构建期 build args：env 模板里写死就会被契约校验拒绝。
    const templatePath = join(f.cwd, 'deploy/env/.env.production');
    writeFileSync(templatePath, `${readFileSync(templatePath, 'utf8')}\nGEEK_RELEASE_VERSION=0.1.0\n`);
    const report = validateEnvironmentFiles({ root: f.cwd, checkCompose: false });
    expect(report.ok).toBe(false);
    expect(report.problems.join('\n')).toContain('GEEK_RELEASE_VERSION');
  });
});
