import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEV_BRANCH_RE,
  INVARIANTS,
  TASK_BRANCH_RE,
  checkInvariants,
  checkPushes,
  classifyBranch,
  parsePushLines,
} from '../../scripts/check-branch-invariants.mjs';

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
  it('accepts only main/stage as long-lived branches, task/<issue>/<slug> and dev/<user> for work', () => {
    expect(classifyBranch('main')).toBe('long-lived');
    expect(classifyBranch('stage')).toBe('long-lived');
    expect(classifyBranch('task/123/add_login')).toBe('task');
    expect(classifyBranch('task/12/portal')).toBe('task');
    expect(classifyBranch('dev/crosery')).toBe('personal');
    expect(classifyBranch('dev/joe_smith')).toBe('personal');
    expect(classifyBranch('next')).toBe('unexpected');
    expect(classifyBranch('feature/x')).toBe('unexpected');
    expect(classifyBranch('task/add_login')).toBe('task-malformed');
    expect(classifyBranch('dev/Joe')).toBe('personal-malformed');
  });

  it('rejects "-" anywhere in a branch name: the old dash forms are now malformed', () => {
    // 所有者指令（2026-09-23）：分支名一律不用 -，只用 / 分层。
    for (const name of ['task/123-add-login', 'task/12-foo', 'task/12/add-login', 'task-12/foo', 'task-12-foo']) {
      expect(classifyBranch(name)).toBe('task-malformed');
    }
    for (const name of ['dev-crosery', 'dev-Joe', 'dev/joe-smith', 'dev-crosery/x']) {
      expect(classifyBranch(name)).toBe('personal-malformed');
    }
  });

  it('pins the exact segment grammar: [a-z0-9]+ words joined by single "_"', () => {
    for (const name of ['task/12/', 'task//x', 'task/12/x/y', 'task/1a/x', 'task/12/_x', 'task/12/x_', 'task/12/x__y', 'task/12/X']) {
      expect(TASK_BRANCH_RE.test(name)).toBe(false);
    }
    for (const name of ['dev/', 'dev/crosery/x', 'dev/_x', 'dev/x_', 'dev/a__b', 'dev/Crosery']) {
      expect(DEV_BRANCH_RE.test(name)).toBe(false);
    }
    expect(TASK_BRANCH_RE.test('task/7/forum_path')).toBe(true);
    expect(DEV_BRANCH_RE.test('dev/crosery')).toBe(true);
  });

  it('keeps the regex table in BRANCHING.md identical to the script', () => {
    const doc = readFileSync(join(repoRoot, 'docs/conventions/BRANCHING.md'), 'utf8');
    expect(doc).toContain(`\`${TASK_BRANCH_RE.source}\``);
    expect(doc).toContain(`\`${DEV_BRANCH_RE.source}\``);
  });

  it('names the new form in the hygiene warning for an old dash branch', () => {
    const f = fixture();
    git(f.cwd, 'branch', 'dev-crosery');
    git(f.cwd, 'branch', 'task/12-foo');
    git(f.cwd, 'branch', 'dev/crosery');
    const result = checkInvariants({ repo: f.cwd });
    expect(result.ok).toBe(true);
    const warnings = result.warnings.join('\n');
    expect(warnings).toContain('dev-crosery');
    expect(warnings).toContain('dev/<github-username>');
    expect(warnings).toContain('task/12-foo');
    expect(warnings).toContain('task/<issue>/<slug>');
    expect(warnings).not.toMatch(/分支 dev\/crosery（/);
    expect(checkInvariants({ repo: f.cwd, strictLongLived: true }).ok).toBe(false);
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
    git(f.cwd, 'branch', 'dev/crosery');
    const fromDev = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/dev/crosery', localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha }],
    });
    expect(fromDev.ok).toBe(false);
    expect(fromDev.violations.join('\n')).toContain('既不是 stage 自身');

    // 旧的 dev-<user> 同样不能进 stage。
    const fromOldDev = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/dev-crosery', localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha }],
    });
    expect(fromOldDev.violations.join('\n')).toContain('既不是 stage 自身');

    const behindMain = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/stage', localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha }],
    });
    expect(behindMain.ok).toBe(false);
    expect(behindMain.violations.join('\n')).toContain(INVARIANTS[0]);

    const fromTask = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/task/7/forum_path', localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha }],
    });
    expect(fromTask.violations.join('\n')).not.toContain('既不是 stage 自身');

    // 旧的 task/<issue>-<slug> 已不是合法 task 分支，不能再作为 stage 的来源。
    for (const oldTask of ['task/7-forum-path', 'task/7/forum-path']) {
      const fromOldTask = checkPushes({
        repo: f.cwd,
        pushes: [{ localRef: `refs/heads/${oldTask}`, localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha }],
      });
      expect(fromOldTask.ok).toBe(false);
      expect(fromOldTask.violations.join('\n')).toContain('既不是 stage 自身');
    }
  });

  it('warns instead of failing for personal/task targets and tag pushes', () => {
    const f = fixture();
    const target = (name: string) => ({ localRef: `refs/heads/${name}`, localSha: f.mainTip, remoteRef: `refs/heads/${name}`, remoteSha: 'b'.repeat(40) });
    const result = checkPushes({
      repo: f.cwd,
      pushes: [
        target('dev/crosery'),
        target('task/7/forum_path'),
        target('scratch'),
        target('dev-crosery'),
        target('task/7-forum-path'),
        { localRef: 'refs/tags/release-1.0.0', localSha: f.mainTip, remoteRef: 'refs/tags/release-1.0.0', remoteSha: 'b'.repeat(40) },
      ],
    });
    expect(result.ok).toBe(true);
    const warnings = result.warnings.join('\n');
    expect(warnings).toContain('refs/heads/scratch');
    expect(warnings).toContain('部署身份只由 commit SHA 决定');
    // 旧的带 - 分支名推到自己的远端分支：不阻断，但要告警。
    expect(warnings).toContain('refs/heads/dev-crosery');
    expect(warnings).toContain('refs/heads/task/7-forum-path');
    expect(warnings).not.toContain('refs/heads/dev/crosery ');
    expect(warnings).not.toContain('refs/heads/task/7/forum_path ');
  });

  it('reads the hook payload from stdin through the CLI', () => {
    const f = fixture({ divergent: true });
    const stdin = `refs/heads/main ${f.mainAhead} refs/heads/main ${'b'.repeat(40)}\n`;
    const result = spawnSync(process.execPath, [script, '--push', '--repo', f.cwd], { encoding: 'utf8', input: stdin });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(INVARIANTS[1]);
    const passing = spawnSync(process.execPath, [script, '--push', '--repo', f.cwd], {
      encoding: 'utf8',
      input: `refs/heads/dev/crosery ${f.stageTip} refs/heads/dev/crosery ${'b'.repeat(40)}\n`,
    });
    expect(passing.status).toBe(0);
  });
});
