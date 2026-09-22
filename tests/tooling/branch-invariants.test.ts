import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { INVARIANTS, checkInvariants, checkPushes, classifyBranch, parsePushLines } from '../../scripts/check-branch-invariants.mjs';

// 全部夹具都是临时目录里的合成仓库：测试从不修改 geek_main 的分支、远端或工作区。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const script = join(repoRoot, 'scripts/check-branch-invariants.mjs');
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
      'user.name=Branch fixture',
      '-c',
      'user.email=fixture@example.invalid',
      ...args,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();

function fixture({ divergent = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'geek-branch-guard-'));
  roots.push(cwd);
  git(cwd, 'init', '--initial-branch=main');
  git(cwd, 'commit', '--allow-empty', '-m', 'main baseline');
  const mainTip = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', '-b', 'stage');
  git(cwd, 'commit', '--allow-empty', '-m', 'stage integration');
  const stageTip = git(cwd, 'rev-parse', 'HEAD');
  if (divergent) {
    // main 领先 stage：main 上一笔从未进入 stage 的提交。
    git(cwd, 'checkout', 'main');
    git(cwd, 'commit', '--allow-empty', '-m', 'main only');
    git(cwd, 'checkout', 'stage');
  }
  return { cwd, mainTip, stageTip, mainAhead: git(cwd, 'rev-parse', 'main') };
}

describe('branch naming model', () => {
  it('accepts only main/stage as long-lived branches, task/<issue>-<slug> and dev-<user> for work', () => {
    expect(classifyBranch('main')).toBe('long-lived');
    expect(classifyBranch('stage')).toBe('long-lived');
    expect(classifyBranch('task/123-add-login')).toBe('task');
    expect(classifyBranch('dev-crosery')).toBe('personal');
    expect(classifyBranch('next')).toBe('unexpected');
    expect(classifyBranch('feature/x')).toBe('unexpected');
    expect(classifyBranch('task/add-login')).toBe('task-malformed');
    expect(classifyBranch('dev-Joe')).toBe('personal-malformed');
  });
});

describe('hard invariants: stage ≥ main and main never leads stage', () => {
  it('passes when main is an ancestor of stage, and reports stray long-lived branches as warnings only', () => {
    const f = fixture();
    git(f.cwd, 'branch', 'next');
    const result = checkInvariants({ repo: f.cwd });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.warnings.join('\n')).toContain('next');
    expect(checkInvariants({ repo: f.cwd, strictLongLived: true }).ok).toBe(false);
  });

  it('fails with both invariant texts quoted verbatim when main leads stage', () => {
    const f = fixture({ divergent: true });
    const result = checkInvariants({ repo: f.cwd });
    expect(result.ok).toBe(false);
    const joined = result.violations.join('\n');
    for (const invariant of INVARIANTS) expect(joined).toContain(invariant);
    expect(joined).toContain(f.mainAhead.slice(0, 12));
  });

  it('exits non-zero and prints the invariant texts through the CLI', () => {
    const f = fixture({ divergent: true });
    const result = spawnSync(process.execPath, [script, '--repo', f.cwd], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    for (const invariant of INVARIANTS) expect(result.stdout).toContain(invariant);
  });

  it('refuses to judge with local evidence only when remote evidence is required', () => {
    const f = fixture();
    expect(() => checkInvariants({ repo: f.cwd, requireRemote: true })).toThrow(/fetch-depth/);
  });
});

describe('pre-push guard', () => {
  it('parses the four-field pre-push lines and rejects anything else', () => {
    const lines = parsePushLines(`${'a'.repeat(40)} ${'b'.repeat(40)} refs/heads/stage ${'0'.repeat(40)}\n`);
    expect(lines).toEqual([{ localRef: 'a'.repeat(40), localSha: 'b'.repeat(40), remoteRef: 'refs/heads/stage', remoteSha: '0'.repeat(40) }]);
    expect(() => parsePushLines('only-two refs')).toThrow(/四段/);
  });

  it('allows a main push whose tip already exists in stage', () => {
    const f = fixture();
    const result = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/main', localSha: f.mainTip, remoteRef: 'refs/heads/main', remoteSha: f.mainTip }],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a main push that would put commits on main before stage, with fix commands', () => {
    const f = fixture({ divergent: true });
    const result = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/main', localSha: f.mainAhead, remoteRef: 'refs/heads/main', remoteSha: f.mainAhead }],
    });
    expect(result.ok).toBe(false);
    const joined = result.violations.join('\n');
    expect(joined).toContain(INVARIANTS[1]);
    expect(joined).toContain('git merge --no-ff');
  });

  it('rejects a stage push from a dev branch, and one that does not contain origin/main yet', () => {
    const f = fixture({ divergent: true });
    const remoteSha = 'b'.repeat(40);
    git(f.cwd, 'branch', 'dev-crosery');
    const fromDev = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/dev-crosery', localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha }],
    });
    expect(fromDev.ok).toBe(false);
    expect(fromDev.violations.join('\n')).toContain('既不是 stage 自身');

    const behindMain = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/stage', localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha }],
    });
    expect(behindMain.ok).toBe(false);
    expect(behindMain.violations.join('\n')).toContain(INVARIANTS[0]);

    const fromTask = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/task/7-forum-path', localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha }],
    });
    expect(fromTask.violations.join('\n')).not.toContain('既不是 stage 自身');
  });

  it('warns instead of failing for personal/task targets and tag pushes', () => {
    const f = fixture();
    const target = (name: string) => ({ localRef: `refs/heads/${name}`, localSha: f.mainTip, remoteRef: `refs/heads/${name}`, remoteSha: 'b'.repeat(40) });
    const result = checkPushes({
      repo: f.cwd,
      pushes: [
        target('dev-crosery'),
        target('task/7-forum-path'),
        target('scratch'),
        { localRef: 'refs/tags/release-1.0.0', localSha: f.mainTip, remoteRef: 'refs/tags/release-1.0.0', remoteSha: 'b'.repeat(40) },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join('\n')).toContain('refs/heads/scratch');
    expect(result.warnings.join('\n')).toContain('部署身份只由 commit SHA 决定');
  });

  it('reads the hook payload from stdin through the CLI', () => {
    const f = fixture({ divergent: true });
    const stdin = `refs/heads/main ${f.mainAhead} refs/heads/main ${'b'.repeat(40)}\n`;
    const result = spawnSync(process.execPath, [script, '--push', '--repo', f.cwd], { encoding: 'utf8', input: stdin });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(INVARIANTS[1]);
    const passing = spawnSync(process.execPath, [script, '--push', '--repo', f.cwd], {
      encoding: 'utf8',
      input: `refs/heads/dev-crosery ${f.stageTip} refs/heads/dev-crosery ${'b'.repeat(40)}\n`,
    });
    expect(passing.status).toBe(0);
  });
});
