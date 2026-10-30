import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RELEASE_TAG_RE, TAG_KINDS, displayBodyOf, nextPreviewNumber, parseReleaseTag, planDeployment, previewTagsFor } from '../../scripts/release-policy.mjs';
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
  it('pins the exact SemVer tag regex and maps rc / hf / stable → preview/stage, final → production/main', () => {
    expect(RELEASE_TAG_RE.source).toBe('^v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(rc|hf|stable)\\.([1-9]\\d*))?$');
    expect(TAG_KINDS).toEqual({
      rc: { environment: 'preview', branch: 'stage' },
      hf: { environment: 'preview', branch: 'stage' },
      stable: { environment: 'preview', branch: 'stage' },
      final: { environment: 'production', branch: 'main' },
    });
    expect(parseReleaseTag('v0.1.0-rc.1')).toMatchObject({ kind: 'rc', version: '0.1.0', rc: 1, number: 1, environment: 'preview', branch: 'stage' });
    expect(parseReleaseTag('v10.20.30-rc.12')).toMatchObject({ kind: 'rc', version: '10.20.30', rc: 12 });
    expect(parseReleaseTag('v0.1.1-hf.3')).toMatchObject({ kind: 'hf', version: '0.1.1', number: 3, rc: null, environment: 'preview', branch: 'stage' });
    expect(parseReleaseTag('v0.1.1-stable.2')).toMatchObject({ kind: 'stable', version: '0.1.1', number: 2, rc: null, environment: 'preview', branch: 'stage' });
    expect(parseReleaseTag('v0.1.0')).toMatchObject({ kind: 'final', version: '0.1.0', rc: null, number: null, environment: 'production', branch: 'main' });
  });

  it('shows hf as X.Y.Z-hf.N and stable without its N, the way the owner wrote it', () => {
    expect(displayBodyOf(parseReleaseTag('v0.1.1-hf.4'))).toBe('0.1.1-hf.4');
    expect(displayBodyOf(parseReleaseTag('v0.1.1-stable.4'))).toBe('0.1.1-stable');
    expect(displayBodyOf(parseReleaseTag('v0.1.1-rc.4'))).toBe('0.1.1-rc.4');
    expect(displayBodyOf(parseReleaseTag('v0.1.1'))).toBe('0.1.1');
  });

  it('counts N per (X.Y.Z, kind) from 1, and never reuses or skips a number', () => {
    expect(nextPreviewNumber([], { version: '0.1.1', kind: 'hf' })).toBe(1);
    expect(nextPreviewNumber(['v0.1.1-hf.1', 'v0.1.1-hf.2', 'v0.1.1-rc.25', 'v0.1.1-stable.1'], { version: '0.1.1', kind: 'hf' })).toBe(3);
    // 别的版本、别的种类不占这个号。
    expect(nextPreviewNumber(['v0.1.2-hf.7', 'v0.1.1-stable.5', 'v0.1.1-rc.9'], { version: '0.1.1', kind: 'hf' })).toBe(1);
    expect(nextPreviewNumber(['v0.1.1-stable.1', 'v0.1.1-stable.2'], { version: '0.1.1', kind: 'stable' })).toBe(3);
    // 格式不合规的名字不计入。
    expect(nextPreviewNumber(['v0.1.1-hf.01', 'v0.1.1-hf'], { version: '0.1.1', kind: 'hf' })).toBe(1);
  });

  it('rejects branch names, SHAs, latest and every malformed tag', () => {
    for (const bad of [
      'main', 'stage', 'task/7/tag_release', 'dev/alice', 'latest', 'HEAD',
      'a'.repeat(40), 'abcdef123456', '0.1.0', 'v0.1', 'v0.1.0.0', 'V0.1.0', 'v01.1.0', 'v0.01.0', 'v0.1.00',
      'v0.1.0-rc', 'v0.1.0-rc.0', 'v0.1.0-rc.01', 'v0.1.0-rc1', 'v0.1.0-RC.1', 'v0.1.0-beta.1', 'v0.1.0-rc.1.1',
      'v0.1.0+build', 'v0.1.0-rc.1@abcdef123456', 'release-0.1.0', 'prev-0.1.0', ' v0.1.0', 'v0.1.0\n', '',
      'v0.1.0-hf', 'v0.1.0-hf.0', 'v0.1.0-hf.01', 'v0.1.0-hf.1.1', 'v0.1.0-HF.1', 'v0.1.0-hotfix.1',
      'v0.1.0-stable', 'v0.1.0-stable.0', 'v0.1.0-stable.01', 'v0.1.0-stable@abcdef123456', 'v0.1.0-stable.1.1', 'v0.1.0-Stable.1',
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
    // 正常流程：rc 打在 stage 的提交上 → 预发布验收 → main 快进到同一提交 → 打正式 tag。
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

/** 在当前分支上提交一份热修复窗口登记，返回新提交。 */
function commitWindowRegistry(cwd: string, text: string, message = 'chore(deploy): 关闭 hotfix 窗口 #9') {
  mkdirSync(join(cwd, 'deploy/hotfix'), { recursive: true });
  writeFileSync(join(cwd, 'deploy/hotfix/windows.json'), text);
  git(cwd, 'add', 'deploy/hotfix/windows.json');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}
const beijing = (ms: number) => `${new Date(ms + 8 * 3600e3).toISOString().slice(0, 19)}+08:00`;
const APPROVAL = '所有者 10-29 在会话中批准：走 hotfix';
const openWindow = (version: string) => `${JSON.stringify({
  schemaVersion: 1,
  windows: [{ issue: 9, tag: `v${version}`, status: 'open', approvedBy: '所有者', approvedAt: beijing(Date.now() - 3600e3), expiresAt: beijing(Date.now() + 3 * 86400e3), approval: APPROVAL }],
}, null, 2)}\n`;
const closedWindow = (version: string, evidence = '合回 stage 的提交与线上核对（测试夹具）') => `${JSON.stringify({
  schemaVersion: 1,
  windows: [{ issue: 9, tag: `v${version}`, status: 'closed', approvedBy: '所有者', approvedAt: beijing(Date.now() - 3600e3), closedAt: beijing(Date.now()), evidence, approval: APPROVAL }],
}, null, 2)}\n`;
/** 把 main 合进 stage（--no-ff，与 hotfix-sync 一致），返回合并提交。 */
function mergeMainIntoStage(cwd: string) {
  git(cwd, 'checkout', '--quiet', 'stage');
  git(cwd, 'merge', '--no-ff', '--no-edit', '-m', "Merge branch 'main' into 'stage' (hotfix #9)", 'main');
  return git(cwd, 'rev-parse', 'HEAD');
}
/** 在 main 上登记 #9 窗口并提交一个引用 #9 的修复，再合进 stage：hf 的形态。 */
function hotfixMerge(cwd: string, version = '0.1.0', fix = 'fix(server): 登录回跳修正 #9') {
  git(cwd, 'checkout', '--quiet', 'main');
  commitWindowRegistry(cwd, openWindow(version), 'chore(deploy): 登记 hotfix 窗口 #9');
  git(cwd, 'commit', '--allow-empty', '-m', fix);
  return mergeMainIntoStage(cwd);
}
/** 在 main 上关闭 #9 窗口再合进 stage：stable 的形态。 */
function closingMerge(cwd: string, version = '0.1.0', evidence?: string) {
  git(cwd, 'checkout', '--quiet', 'main');
  commitWindowRegistry(cwd, closedWindow(version, evidence));
  return mergeMainIntoStage(cwd);
}

describe('hotfix and stable preview tags', () => {
  it('plans hf on the merge that brings a main hotfix into stage, with X.Y.Z-hf.N@sha12, and keeps that answer after the window closes', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    const merged = hotfixMerge(f.cwd);
    const hf = plan(f.cwd, 'v0.1.0-hf.1', merged);
    const short = merged.slice(0, 12);
    expect(hf).toMatchObject({
      tag: 'v0.1.0-hf.1',
      tagKind: 'hf',
      rc: null,
      branch: 'stage',
      environment: 'preview',
      version: '0.1.0',
      releaseVersion: `0.1.0-hf.1@${short}`,
      imageTag: short,
      previewTags: [],
      deploymentAuthorized: false,
    });
    expect(hf.buildEnv.GEEK_RELEASE_VERSION).toBe(`0.1.0-hf.1@${short}`);
    // 判定只看提交本身：窗口之后关闭、main 继续前进，同一个 tag 重跑部署结论不变。
    closingMerge(f.cwd);
    expect(plan(f.cwd, 'v0.1.0-hf.1', merged).tag).toBe('v0.1.0-hf.1');
  });

  it('refuses hf on a commit that is not a merge from main, or on a merge whose main commits belong to no hotfix window', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    expect(() => plan(f.cwd, 'v0.1.0-hf.1', f.stageTip)).toThrow(/只打在把 main 合进 stage 的合并提交上/);
    // task 分支合进 stage：是合并提交，但合进来的不在 main 上。
    git(f.cwd, 'checkout', '--quiet', '-b', 'task/9/fix', 'stage');
    git(f.cwd, 'commit', '--allow-empty', '-m', 'fix(server): 登录回跳修正 #9');
    git(f.cwd, 'checkout', '--quiet', 'stage');
    git(f.cwd, 'merge', '--no-ff', '--no-edit', 'task/9/fix');
    expect(() => plan(f.cwd, 'v0.1.0-hf.1', git(f.cwd, 'rev-parse', 'HEAD'))).toThrow(/只打在把 main 合进 stage 的合并提交上/);
    // main 合进 stage，但 main 上的提交没有引用开着的窗口（晋升窗口的合回就是这样）。
    const f2 = fixture();
    git(f2.cwd, 'tag', 'v0.1.0', f2.mainTip);
    const plain = hotfixMerge(f2.cwd, '0.0.9', 'fix(server): 普通修正');
    expect(() => plan(f2.cwd, 'v0.1.0-hf.1', plain)).toThrow(/不归属 v0\.1\.0 的 hotfix 窗口/);
  });

  it('plans stable only on the merge that newly closes a window for the same version, and shows it without N', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    const hf = hotfixMerge(f.cwd);
    expect(() => plan(f.cwd, 'v0.1.0-stable.1', hf)).toThrow(/没有新关闭的 v0\.1\.0 hotfix 窗口/);
    const closed = closingMerge(f.cwd);
    const stable = plan(f.cwd, 'v0.1.0-stable.1', closed);
    expect(stable).toMatchObject({ tagKind: 'stable', environment: 'preview', releaseVersion: `0.1.0-stable@${closed.slice(0, 12)}` });
    expect(stable.buildEnv.GEEK_RELEASE_VERSION).not.toMatch(/stable\.1/);
    // 已经关过的窗口随下一次合并再进 stage：不是新关闭，不算。
    git(f.cwd, 'checkout', '--quiet', 'main');
    git(f.cwd, 'commit', '--allow-empty', '-m', 'docs: 收尾说明 #9');
    expect(() => plan(f.cwd, 'v0.1.0-stable.1', mergeMainIntoStage(f.cwd))).toThrow(/没有新关闭的 v0\.1\.0 hotfix 窗口/);
    // 直接提交在 stage 上的收尾登记：不是从 main 合进来的。
    // 换一句 evidence，保证这次提交确实改了文件（closedAt 精确到秒，同一秒内内容会相同）。
    const direct = commitWindowRegistry(f.cwd, closedWindow('0.1.0', '直接写在 stage 上的收尾登记（测试夹具）'));
    expect(() => plan(f.cwd, 'v0.1.0-stable.1', direct)).toThrow(/只打在把 main 合进 stage 的合并提交上/);
  });

  it('refuses stable when the registry on that commit is invalid or closes a window for another version', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    hotfixMerge(f.cwd);
    expect(() => plan(f.cwd, 'v0.1.0-stable.1', closingMerge(f.cwd, '0.1.0', '短'))).toThrow(/不合规：#9：closed 要有 closedAt 和 evidence/);
    const g = fixture();
    git(g.cwd, 'tag', 'v0.1.0', g.mainTip);
    hotfixMerge(g.cwd, '0.0.9');
    expect(() => plan(g.cwd, 'v0.1.0-stable.1', closingMerge(g.cwd, '0.0.9'))).toThrow(/没有新关闭的 v0\.1\.0 hotfix 窗口/);
  });

  it('numbers hf from 1 with no gaps: an existing tag on the same commit is accepted, a skipped or reused-looking number is refused', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    const merged = hotfixMerge(f.cwd);
    expect(() => plan(f.cwd, 'v0.1.0-hf.2', merged)).toThrow(/N 必须是 1/);
    git(f.cwd, 'tag', 'v0.1.0-hf.1', merged);
    expect(plan(f.cwd, 'v0.1.0-hf.1', merged).tag).toBe('v0.1.0-hf.1');
    expect(() => plan(f.cwd, 'v0.1.0-hf.3', merged)).toThrow(/N 必须是 2/);
    expect(plan(f.cwd, 'v0.1.0-hf.2', merged).releaseVersion).toBe(`0.1.0-hf.2@${merged.slice(0, 12)}`);
  });

  it('refuses hf or stable for a version that has no final tag yet, and keeps the X.Y.Z-equals-package.json rule', () => {
    const f = fixture();
    expect(() => plan(f.cwd, 'v0.1.0-hf.1', f.stageTip)).toThrow(/还没有正式 tag v0\.1\.0/);
    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    expect(() => plan(f.cwd, 'v0.2.0-hf.1', f.stageTip)).toThrow(/package\.json 的 version 0\.1\.0/);
  });

  it('never lets hf or stable satisfy the rc that a final tag needs on the same commit', () => {
    const f = fixture();
    git(f.cwd, 'tag', 'v0.1.0-hf.1', f.mainTip);
    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    expect(previewTagsFor(f.cwd, '0.1.0', f.mainTip)).toEqual([]);
    expect(() => plan(f.cwd, 'v0.1.0', f.mainTip)).toThrow(/没有 v0\.1\.0-rc\.N/);
  });
});
