import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

const gitWith = (cwd: string, env: NodeJS.ProcessEnv, args: string[]) =>
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
      'user.name=Branch fixture',
      '-c',
      'user.email=fixture@example.invalid',
      ...args,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env },
  ).trim();
const git = (cwd: string, ...args: string[]) => gitWith(cwd, process.env, args);
/** 固定作者与提交者时间：窗口归属按提交者时间判定，夹具不能依赖运行测试时的真实时钟。 */
const gitAt = (cwd: string, committedAt: string, ...args: string[]) =>
  gitWith(cwd, { ...process.env, GIT_AUTHOR_DATE: committedAt, GIT_COMMITTER_DATE: committedAt }, args);

function fixture({ divergent = false } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'geek-branch-guard-'));
  roots.push(cwd);
  git(cwd, 'init', '--initial-branch=main');
  git(cwd, 'commit', '--allow-empty', '-m', 'main baseline');
  const mainTip = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', '-b', 'stage');
  git(cwd, 'commit', '--allow-empty', '-m', 'stage integration');
  const stageTip = git(cwd, 'rev-parse', 'HEAD');
  // 夹具模拟已经 fetch 过的远端：推 main 的判定只认远端跟踪的 stage（或同一批推送里的 stage），不认本地 stage。
  git(cwd, 'update-ref', 'refs/remotes/origin/stage', stageTip);
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
    expect(classifyBranch('dev/alice')).toBe('personal');
    expect(classifyBranch('dev/joe_smith')).toBe('personal');
    expect(classifyBranch('next')).toBe('unexpected');
    expect(classifyBranch('feature/x')).toBe('unexpected');
    expect(classifyBranch('task/add_login')).toBe('task-malformed');
    expect(classifyBranch('dev/Joe')).toBe('personal-malformed');
  });

  it('rejects "-" anywhere in a branch name: the old dash forms are now malformed', () => {
    // 2026-09-23 的指令：分支名一律不用 -，只用 / 分层。
    for (const name of ['task/123-add-login', 'task/12-foo', 'task/12/add-login', 'task-12/foo', 'task-12-foo']) {
      expect(classifyBranch(name)).toBe('task-malformed');
    }
    for (const name of ['dev-alice', 'dev-Joe', 'dev/joe-smith', 'dev-alice/x']) {
      expect(classifyBranch(name)).toBe('personal-malformed');
    }
  });

  it('pins the exact segment grammar: [a-z0-9]+ words joined by single "_"', () => {
    for (const name of ['task/12/', 'task//x', 'task/12/x/y', 'task/1a/x', 'task/12/_x', 'task/12/x_', 'task/12/x__y', 'task/12/X']) {
      expect(TASK_BRANCH_RE.test(name)).toBe(false);
    }
    for (const name of ['dev/', 'dev/alice/x', 'dev/_x', 'dev/x_', 'dev/a__b', 'dev/Alice']) {
      expect(DEV_BRANCH_RE.test(name)).toBe(false);
    }
    expect(TASK_BRANCH_RE.test('task/7/forum_path')).toBe(true);
    expect(DEV_BRANCH_RE.test('dev/alice')).toBe(true);
  });

  it('keeps the regex table in BRANCHING.md identical to the script', () => {
    const doc = readFileSync(join(repoRoot, 'docs/conventions/BRANCHING.md'), 'utf8');
    expect(doc).toContain(`\`${TASK_BRANCH_RE.source}\``);
    expect(doc).toContain(`\`${DEV_BRANCH_RE.source}\``);
  });

  it('names the new form in the hygiene warning for an old dash branch', () => {
    const f = fixture();
    git(f.cwd, 'branch', 'dev-alice');
    git(f.cwd, 'branch', 'task/12-foo');
    git(f.cwd, 'branch', 'dev/alice');
    const result = checkInvariants({ repo: f.cwd });
    expect(result.ok).toBe(true);
    const warnings = result.warnings.join('\n');
    expect(warnings).toContain('dev-alice');
    expect(warnings).toContain('dev/<github-username>');
    expect(warnings).toContain('task/12-foo');
    expect(warnings).toContain('task/<issue>/<slug>');
    expect(warnings).not.toMatch(/分支 dev\/alice（/);
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
    git(f.cwd, 'branch', 'dev/alice');
    const fromDev = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/dev/alice', localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha }],
    });
    expect(fromDev.ok).toBe(false);
    expect(fromDev.violations.join('\n')).toContain('既不是 stage 自身');

    // 旧的 dev-<user> 同样不能进 stage。
    const fromOldDev = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/dev-alice', localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha }],
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

  it('warns instead of failing for personal/task targets and non-release tag pushes', () => {
    const f = fixture();
    const target = (name: string) => ({ localRef: `refs/heads/${name}`, localSha: f.mainTip, remoteRef: `refs/heads/${name}`, remoteSha: 'b'.repeat(40) });
    const result = checkPushes({
      repo: f.cwd,
      pushes: [
        target('dev/alice'),
        target('task/7/forum_path'),
        target('scratch'),
        target('dev-alice'),
        target('task/7-forum-path'),
        { localRef: 'refs/tags/release-1.0.0', localSha: f.mainTip, remoteRef: 'refs/tags/release-1.0.0', remoteSha: 'b'.repeat(40) },
      ],
    });
    expect(result.ok).toBe(true);
    const warnings = result.warnings.join('\n');
    expect(warnings).toContain('refs/heads/scratch');
    // release-1.0.0 不是 v 开头的发布 tag：只告警，不参与发版。
    expect(warnings).toContain('refs/tags/release-1.0.0 不是发布 tag');
    // 旧的带 - 分支名推到自己的远端分支：不阻断，但要告警。
    expect(warnings).toContain('refs/heads/dev-alice');
    expect(warnings).toContain('refs/heads/task/7-forum-path');
    expect(warnings).not.toContain('refs/heads/dev/alice ');
    expect(warnings).not.toContain('refs/heads/task/7/forum_path ');
  });

  it('still checks a first push whose remote ref does not exist yet (all-zero <remote sha>)', () => {
    // git 的约定：<remote sha> 全 0 = 远端还没有这个 ref（新建分支），不是删除；命名与不变量都必须照常判定。
    const f = fixture({ divergent: true });
    const zero = '0'.repeat(40);
    const fresh = (name: string) => ({ localRef: `refs/heads/${name}`, localSha: f.stageTip, remoteRef: `refs/heads/${name}`, remoteSha: zero });
    const naming = checkPushes({ repo: f.cwd, pushes: [fresh('task/12-foo'), fresh('dev-alice'), fresh('dev/alice'), fresh('task/12/portal_redesign')] });
    expect(naming.ok).toBe(true);
    const warnings = naming.warnings.join('\n');
    expect(warnings).toContain('refs/heads/task/12-foo');
    expect(warnings).toContain('refs/heads/dev-alice');
    expect(warnings).not.toContain('refs/heads/dev/alice ');
    expect(warnings).not.toContain('refs/heads/task/12/portal_redesign ');

    const newMain = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/main', localSha: f.mainAhead, remoteRef: 'refs/heads/main', remoteSha: zero }],
    });
    expect(newMain.ok).toBe(false);
    expect(newMain.violations.join('\n')).toContain(INVARIANTS[1]);

    const newStageFromOldTask = checkPushes({
      repo: f.cwd,
      pushes: [{ localRef: 'refs/heads/task/12-foo', localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha: zero }],
    });
    expect(newStageFromOldTask.ok).toBe(false);
    expect(newStageFromOldTask.violations.join('\n')).toContain('既不是 stage 自身');
  });

  it('treats "(delete)" with an all-zero <local sha> as a deletion: blocks main/stage, stays quiet for others', () => {
    const f = fixture();
    const zero = '0'.repeat(40);
    const del = (name: string) => ({ localRef: '(delete)', localSha: zero, remoteRef: `refs/heads/${name}`, remoteSha: f.stageTip });
    for (const longLived of ['stage', 'main']) {
      const result = checkPushes({ repo: f.cwd, pushes: [del(longLived)] });
      expect(result.ok).toBe(false);
      expect(result.violations.join('\n')).toContain(`拒绝删除远端长期分支 refs/heads/${longLived}`);
    }
    // 合并后删 task 分支、迁移时删旧的 dev-alice：都是规范要求的动作，不阻断也不报命名告警。
    const cleanup = checkPushes({ repo: f.cwd, pushes: [del('task/12/portal_redesign'), del('dev-alice')] });
    expect(cleanup.ok).toBe(true);
    expect(cleanup.warnings).toEqual([]);

    const cli = spawnSync(process.execPath, [script, '--push', '--repo', f.cwd], {
      encoding: 'utf8',
      input: `(delete) ${zero} refs/heads/stage ${f.stageTip}\n`,
    });
    expect(cli.status).toBe(1);
    expect(cli.stdout).toContain('拒绝删除远端长期分支 refs/heads/stage');
    expect(cli.stderr).not.toContain('无法判定祖先关系');
  });

  it('reads the hook payload from stdin through the CLI', () => {
    const f = fixture({ divergent: true });
    const stdin = `refs/heads/main ${f.mainAhead} refs/heads/main ${'b'.repeat(40)}\n`;
    const result = spawnSync(process.execPath, [script, '--push', '--repo', f.cwd], { encoding: 'utf8', input: stdin });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(INVARIANTS[1]);
    const passing = spawnSync(process.execPath, [script, '--push', '--repo', f.cwd], {
      encoding: 'utf8',
      input: `refs/heads/dev/alice ${f.stageTip} refs/heads/dev/alice ${'b'.repeat(40)}\n`,
    });
    expect(passing.status).toBe(0);
  });
});

describe('pre-push: where the stage evidence for a main push comes from', () => {
  const NONE = '0'.repeat(40);
  const mainPush = (localSha: string) => ({ localRef: 'refs/heads/main', localSha, remoteRef: 'refs/heads/main', remoteSha: NONE });

  it('does not let an unpushed local stage commit authorize a main push of that commit (E1)', () => {
    const f = fixture();
    git(f.cwd, 'checkout', 'stage');
    git(f.cwd, 'commit', '--allow-empty', '-m', 'stage unpushed work');
    const unpushed = git(f.cwd, 'rev-parse', 'HEAD');
    git(f.cwd, 'checkout', 'main');
    git(f.cwd, 'merge', '--ff-only', 'stage');
    const result = checkPushes({ repo: f.cwd, pushes: [mainPush(unpushed)] });
    expect(result.ok).toBe(false);
    const joined = result.violations.join('\n');
    expect(joined).toContain(INVARIANTS[1]);
    expect(joined).toContain(`${unpushed.slice(0, 12)}：`);
  });

  it('judges a main push against the stage pushed in the same batch, not against origin/stage', () => {
    const f = fixture({ divergent: true });
    git(f.cwd, 'checkout', 'stage');
    git(f.cwd, 'merge', '--no-ff', '-m', 'merge main into stage', 'main');
    const newStage = git(f.cwd, 'rev-parse', 'HEAD');
    const stagePush = { localRef: 'refs/heads/stage', localSha: newStage, remoteRef: 'refs/heads/stage', remoteSha: f.stageTip };
    expect(checkPushes({ repo: f.cwd, pushes: [mainPush(f.mainAhead)] }).ok).toBe(false);
    const together = checkPushes({ repo: f.cwd, pushes: [stagePush, mainPush(f.mainAhead)] });
    expect(together.violations).toEqual([]);
    expect(together.ok).toBe(true);
  });

  it('uses refs/remotes/<remote>/stage for --remote, and origin/stage without it', () => {
    const f = fixture({ divergent: true });
    git(f.cwd, 'checkout', 'stage');
    git(f.cwd, 'merge', '--no-ff', '-m', 'merge main into stage', 'main');
    git(f.cwd, 'update-ref', 'refs/remotes/gitlab/stage', 'stage');
    // origin/stage 仍停在旧提交上，只有 --remote gitlab 才应当拿 gitlab/stage 作证据。
    expect(checkPushes({ repo: f.cwd, remote: 'gitlab', pushes: [mainPush(f.mainAhead)] }).violations).toEqual([]);
    expect(checkPushes({ repo: f.cwd, pushes: [mainPush(f.mainAhead)] }).ok).toBe(false);
    const line = `refs/heads/main ${f.mainAhead} refs/heads/main ${NONE}\n`;
    const named = spawnSync(process.execPath, [script, '--push', '--repo', f.cwd, '--remote', 'gitlab'], { encoding: 'utf8', input: line });
    expect(named.status).toBe(0);
    const unnamed = spawnSync(process.execPath, [script, '--push', '--repo', f.cwd], { encoding: 'utf8', input: line });
    expect(unnamed.status).toBe(1);
  });

  it('refuses a main push when no remote-tracking stage exists, even though the local stage contains the commit', () => {
    const f = fixture();
    git(f.cwd, 'update-ref', '-d', 'refs/remotes/origin/stage');
    const result = checkPushes({ repo: f.cwd, pushes: [mainPush(f.mainTip)] });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain('本地 stage 不算证据');
    const named = checkPushes({ repo: f.cwd, remote: 'gitlab', pushes: [mainPush(f.mainTip)] });
    expect(named.violations.join('\n')).toContain('refs/remotes/gitlab/stage');
  });
});

/**
 * 发布 tag 夹具：带 package.json（version 0.1.0）的 main/stage 仓库。
 * mainTip 是 stageTip 的祖先；taskTip 在一条未合并的任务分支上。
 */
function releaseFixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'geek-tag-guard-'));
  roots.push(cwd);
  writeFileSync(join(cwd, 'package.json'), `${JSON.stringify({ name: 'fixture', version: '0.1.0' }, null, 2)}\n`);
  git(cwd, 'init', '--initial-branch=main');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-m', 'main baseline');
  const mainTip = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', '-b', 'stage');
  git(cwd, 'commit', '--allow-empty', '-m', 'stage integration');
  const stageTip = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', '-b', 'task/7/tag_release');
  git(cwd, 'commit', '--allow-empty', '-m', 'unmerged task work');
  const taskTip = git(cwd, 'rev-parse', 'HEAD');
  git(cwd, 'checkout', 'stage');
  return { cwd, mainTip, stageTip, taskTip };
}

const zero = '0'.repeat(40);
const tagPush = (name: string, localSha: string, remoteSha = zero) => ({
  localRef: `refs/tags/${name}`,
  localSha,
  remoteRef: `refs/tags/${name}`,
  remoteSha,
});

describe('pre-push guard: release tags', () => {
  it('allows an rc tag on a stage commit and a final tag on a main commit that already has an rc', () => {
    const f = releaseFixture();
    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.mainTip);
    const result = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-rc.2', f.stageTip), tagPush('v0.1.0-rc.1', f.mainTip), tagPush('v0.1.0', f.mainTip)] });
    expect(result.violations).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.notes.join('\n')).toContain('同一提交的预发布 tag v0.1.0-rc.1');
  });

  it('rejects malformed v-tags, including an uppercase V', () => {
    const f = releaseFixture();
    for (const name of ['v0.1', 'v0.1.0-rc.0', 'v0.1.0-rc.01', 'v0.1.0-rc1', 'v0.1.0-beta.1', 'v01.1.0', 'V0.1.0', 'v0.1.0.1']) {
      const result = checkPushes({ repo: f.cwd, pushes: [tagPush(name, f.stageTip)] });
      expect(result.ok, name).toBe(false);
      expect(result.violations.join('\n'), name).toContain('格式不对');
    }
  });

  it('rejects an rc tag whose commit is not on stage', () => {
    const f = releaseFixture();
    const result = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-rc.1', f.taskTip)] });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain('预发布 tag v0.1.0-rc.1 必须打在 stage 的提交上');
    // 本地 stage 不含但 origin/stage 含：任一证据包含即可（推送前 fetch 过的情况）。
    git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', f.taskTip);
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-rc.1', f.taskTip)] }).ok).toBe(true);
  });

  it('rejects a final tag whose commit is not on main, and warns when the same commit has no rc locally', () => {
    const f = releaseFixture();
    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.stageTip);
    const offMain = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0', f.stageTip)] });
    expect(offMain.ok).toBe(false);
    expect(offMain.violations.join('\n')).toContain('正式 tag v0.1.0 必须打在 main 的提交上');
    expect(offMain.violations.join('\n')).toContain('git merge --ff-only');

    const withoutRc = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0', f.mainTip)] });
    expect(withoutRc.ok).toBe(true);
    expect(withoutRc.warnings.join('\n')).toContain('本地没有 v0.1.0-rc.N');
  });

  it('rejects a tag whose X.Y.Z differs from package.json, and an rc for an already released version', () => {
    const f = releaseFixture();
    const mismatch = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.2.0-rc.1', f.stageTip)] });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.violations.join('\n')).toContain('package.json 的 version 0.1.0');

    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.mainTip);
    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    const rerun = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-rc.2', f.stageTip)] });
    expect(rerun.ok).toBe(false);
    expect(rerun.violations.join('\n')).toContain('已有正式 tag');
  });

  it('rejects deleting or moving a release tag, but only warns for other tags', () => {
    const f = releaseFixture();
    const del = (name: string) => ({ localRef: '(delete)', localSha: zero, remoteRef: `refs/tags/${name}`, remoteSha: f.stageTip });
    for (const name of ['v0.1.0-rc.1', 'v0.1.0']) {
      const deleted = checkPushes({ repo: f.cwd, pushes: [del(name)] });
      expect(deleted.ok, name).toBe(false);
      expect(deleted.violations.join('\n'), name).toContain(`拒绝删除发布 tag refs/tags/${name}`);
    }
    // 格式不合规的 v 开头 tag 从来不会触发部署：删除它是清理，只告警。
    const cleanup = checkPushes({ repo: f.cwd, pushes: [del('v9.9.9-garbage')] });
    expect(cleanup.ok).toBe(true);
    expect(cleanup.warnings.join('\n')).toContain('格式不合规的 v 开头 tag');
    // 远端已有同名 tag、这次指向别的提交 = force 移动 tag。
    const moved = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-rc.1', f.stageTip, f.mainTip)] });
    expect(moved.ok).toBe(false);
    expect(moved.violations.join('\n')).toContain('拒绝移动发布 tag refs/tags/v0.1.0-rc.1');
    // 远端已有且指向同一提交：重复推送不算移动。
    git(f.cwd, 'tag', 'v0.1.0-rc.1', f.stageTip);
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-rc.1', f.stageTip, f.stageTip)] }).ok).toBe(true);
    // 附注 tag：pre-push 传的是 tag 对象 SHA，同样要剥到提交再判定，改指向同样算移动。
    git(f.cwd, 'tag', '-a', 'v0.1.0-rc.2', '-m', 'annotated rc', f.stageTip);
    const annotated = git(f.cwd, 'rev-parse', 'refs/tags/v0.1.0-rc.2');
    expect(annotated).not.toBe(f.stageTip);
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-rc.2', annotated)] }).ok).toBe(true);
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-rc.2', annotated, f.stageTip)] }).ok).toBe(false);
    git(f.cwd, 'tag', '-a', 'v0.1.0-rc.3', '-m', 'annotated rc off stage', f.taskTip);
    const offStage = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-rc.3', git(f.cwd, 'rev-parse', 'refs/tags/v0.1.0-rc.3'))] });
    expect(offStage.violations.join('\n')).toContain('必须打在 stage 的提交上');

    const others = checkPushes({
      repo: f.cwd,
      pushes: [
        tagPush('backup-2026', f.taskTip),
        tagPush('experiment', f.taskTip, f.stageTip),
        { localRef: '(delete)', localSha: zero, remoteRef: 'refs/tags/old-note', remoteSha: f.stageTip },
      ],
    });
    expect(others.ok).toBe(true);
    const warnings = others.warnings.join('\n');
    expect(warnings).toContain('refs/tags/backup-2026 不是发布 tag');
    expect(warnings).toContain('移动远端已有的同名 tag');
    expect(warnings).toContain('refs/tags/old-note：删除的是非发布 tag');
  });

  it('checks hf and stable tags: released version first, N without gaps, only on the merge that brings main into stage', () => {
    const f = releaseFixture();
    const beijing = (ms: number) => `${new Date(ms + 8 * 3600e3).toISOString().slice(0, 19)}+08:00`;
    const registry = (window: Record<string, unknown>) => `${JSON.stringify({ schemaVersion: 1, windows: [{ issue: 9, tag: 'v0.1.0', approvedBy: '所有者', approvedAt: beijing(Date.now() - 3600e3), approval: '所有者 10-29 在会话中批准：走 hotfix', ...window }] }, null, 2)}\n`;
    const commitRegistry = (text: string, message: string) => {
      mkdirSync(join(f.cwd, 'deploy/hotfix'), { recursive: true });
      writeFileSync(join(f.cwd, 'deploy/hotfix/windows.json'), text);
      git(f.cwd, 'add', 'deploy/hotfix/windows.json');
      git(f.cwd, 'commit', '-q', '-m', message);
    };
    /** main 合进 stage（--no-ff），远端跟踪引用跟上：pre-push 只认远端的 main，不认本地 main。 */
    const mergeMain = () => {
      git(f.cwd, 'checkout', '-q', 'stage');
      git(f.cwd, 'merge', '-q', '--no-ff', '--no-edit', 'main');
      git(f.cwd, 'update-ref', 'refs/remotes/origin/main', 'main');
      git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', 'stage');
      return git(f.cwd, 'rev-parse', 'HEAD');
    };
    git(f.cwd, 'checkout', '-q', 'main');
    commitRegistry(registry({ status: 'open', expiresAt: beijing(Date.now() + 3 * 86400e3) }), 'chore(deploy): 登记 hotfix 窗口 #9');
    git(f.cwd, 'commit', '-q', '--allow-empty', '-m', 'fix(server): 登录回跳修正 #9');
    const hfMerge = mergeMain();

    const unreleased = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-hf.1', hfMerge)] });
    expect(unreleased.ok).toBe(false);
    expect(unreleased.violations.join('\n')).toContain('还没有正式 tag v0.1.0');

    git(f.cwd, 'tag', 'v0.1.0', f.mainTip);
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-hf.1', hfMerge)] }).ok).toBe(true);
    // 不是合并提交（stage 上普通的集成提交）：拒绝。
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-hf.1', f.stageTip)] }).violations.join('\n')).toContain('只打在把 main 合进 stage 的合并提交上');
    const gap = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-hf.2', hfMerge)] });
    expect(gap.ok).toBe(false);
    expect(gap.violations.join('\n')).toContain('N 必须是 1');
    git(f.cwd, 'tag', 'v0.1.0-hf.1', hfMerge);
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-hf.2', hfMerge)] }).ok).toBe(true);
    // 远端已有且指向同一提交：重复推送不再核对 N，也不算移动。
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-hf.1', hfMerge, hfMerge)] }).ok).toBe(true);
    // 远端已有、这次要换到别的提交：移动，拒绝。
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-hf.1', f.mainTip, hfMerge)] }).violations.join('\n')).toContain('拒绝移动发布 tag refs/tags/v0.1.0-hf.1');
    expect(checkPushes({ repo: f.cwd, pushes: [{ localRef: '(delete)', localSha: zero, remoteRef: 'refs/tags/v0.1.0-hf.1', remoteSha: hfMerge }] }).violations.join('\n')).toContain('拒绝删除发布 tag');

    // 窗口还开着的合并：没有新关闭的窗口，不打 stable。
    const noWindow = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-stable.1', hfMerge)] });
    expect(noWindow.ok).toBe(false);
    expect(noWindow.violations.join('\n')).toContain('没有新关闭的 v0.1.0 hotfix 窗口');
    git(f.cwd, 'checkout', '-q', 'main');
    commitRegistry(registry({ status: 'closed', closedAt: beijing(Date.now()), evidence: '合回 stage 的提交与线上核对（测试夹具）' }), 'chore(deploy): 关闭 hotfix 窗口 #9');
    const closedMerge = mergeMain();
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-stable.1', closedMerge)] }).ok).toBe(true);
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-stable.2', closedMerge)] }).ok).toBe(false);

    // 没有远端的 main：确认不了合进来的是 main，拒绝；同一次推送里带着 main 时按它判定。
    git(f.cwd, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-stable.1', closedMerge)] }).violations.join('\n')).toContain('本地没有 main 的引用');
    const main = git(f.cwd, 'rev-parse', 'main');
    expect(checkPushes({ repo: f.cwd, pushes: [{ localRef: 'refs/heads/main', localSha: main, remoteRef: 'refs/heads/main', remoteSha: f.mainTip }, tagPush('v0.1.0-stable.1', closedMerge)] }).violations.join('\n')).not.toContain('本地没有 main 的引用');

    const malformed = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-hf', hfMerge), tagPush('v0.1.0-stable', hfMerge)] });
    expect(malformed.violations.join('\n')).toContain('格式不对');
  });

  it('rejects a release tag when neither the local nor the remote-tracking branch exists', () => {
    const f = releaseFixture();
    git(f.cwd, 'checkout', 'task/7/tag_release');
    git(f.cwd, 'branch', '-D', 'stage');
    const result = checkPushes({ repo: f.cwd, pushes: [tagPush('v0.1.0-rc.1', f.stageTip)] });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain('git fetch origin stage');
  });

  it('reads tag pushes from stdin through the CLI', () => {
    const f = releaseFixture();
    const rejected = spawnSync(process.execPath, [script, '--push', '--repo', f.cwd], {
      encoding: 'utf8',
      input: `refs/tags/v0.1.0-rc.1 ${f.taskTip} refs/tags/v0.1.0-rc.1 ${zero}\n`,
    });
    expect(rejected.status).toBe(1);
    expect(rejected.stdout).toContain('必须打在 stage 的提交上');
    // tag 违规与两条分支不变量无关：不打印不变量原文，免得误导排查方向。
    expect(rejected.stdout).not.toContain('[不变量原文]');
    const accepted = spawnSync(process.execPath, [script, '--push', '--repo', f.cwd], {
      encoding: 'utf8',
      input: `refs/tags/v0.1.0-rc.1 ${f.stageTip} refs/tags/v0.1.0-rc.1 ${zero}\n`,
    });
    expect(accepted.status).toBe(0);
    expect(accepted.stdout).toContain('pre-push 分支与发布 tag 规则通过');
  });
});

// P0 hotfix 窗口：main 在已登记的窗口内可以领先 stage，每个领先的提交都要归属于窗口。
describe('hotfix windows', () => {
  const window = (overrides: Record<string, unknown> = {}) => ({
    issue: 5, tag: 'v1.2.3', status: 'open', approvedBy: '所有者', approvedAt: '2026-10-28T19:11:00+08:00',
    expiresAt: '2026-11-04T19:11:00+08:00', approval: '这是一个必须走 hotfix 的 P0 问题', ...overrides,
  });
  const registryOf = (...windows: Record<string, unknown>[]) => JSON.stringify({ schemaVersion: 1, windows });
  const NOW = new Date('2026-10-30T00:00:00+08:00');

  // 默认提交时间落在窗口批准与过期之间；需要「批准前」「过期后」的提交时由用例自己指定。
  const COMMITTED = '2026-10-29T12:00:00+08:00';

  /** stage 有自己的提交；main 上的第一笔提交带登记文件（可为空），其后每条消息一笔提交，提交者时间都是 committedAt。 */
  function hotfixRepo({ registry, messages, committedAt = COMMITTED }: { registry?: string; messages: string[]; committedAt?: string }) {
    const cwd = mkdtempSync(join(tmpdir(), 'geek-hotfix-window-'));
    roots.push(cwd);
    git(cwd, 'init', '--initial-branch=main');
    git(cwd, 'commit', '--allow-empty', '-m', 'baseline');
    git(cwd, 'checkout', '-b', 'stage');
    git(cwd, 'commit', '--allow-empty', '-m', 'stage only work');
    git(cwd, 'update-ref', 'refs/remotes/origin/stage', 'stage');
    git(cwd, 'checkout', 'main');
    const shas: string[] = [];
    messages.forEach((message, index) => {
      if (index === 0 && registry !== undefined) {
        mkdirSync(join(cwd, 'deploy/hotfix'), { recursive: true });
        writeFileSync(join(cwd, 'deploy/hotfix/windows.json'), registry);
        git(cwd, 'add', 'deploy/hotfix/windows.json');
      }
      gitAt(cwd, committedAt, 'commit', '--allow-empty', '-m', message);
      shas.push(git(cwd, 'rev-parse', 'HEAD'));
    });
    return { cwd, shas, stageTip: git(cwd, 'rev-parse', 'stage') };
  }

  it('allows main to lead stage when every ahead commit references the open window issue', () => {
    const f = hotfixRepo({ registry: registryOf(window()), messages: ['fix(deploy): 修复 (#5)', "Merge branch 'task/5/hotfix_x' into 'main'", 'docs(notes): 记录 task/5 的提交'] });
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.notes.join('\n')).toMatch(/hotfix 窗口 #5 内 main 领先 stage 3 个提交/);
  });

  it('fails with both invariant texts when one ahead commit is not attributable to the window', () => {
    const f = hotfixRepo({ registry: registryOf(window()), messages: ['fix: 修复 (#5)', 'chore: 顺手改一点别的', 'fix: 又一笔 (#50)'] });
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    const joined = result.violations.join('\n');
    for (const invariant of INVARIANTS) expect(joined).toContain(invariant);
    expect(joined).toContain(f.shas[1].slice(0, 12));
    expect(joined).toContain(f.shas[2].slice(0, 12));
    expect(joined).not.toContain(f.shas[0].slice(0, 12));
    expect(joined).toContain('#5');
  });

  it('attributes a commit that the window lists by SHA even without an issue reference', () => {
    // 登记提交不能列自己的 SHA：被列的提交在登记之前（批准前的提交，说明里也没写编号）
    const f = hotfixRepo({ messages: ['fix: 窗口建立之前的提交，没写编号'], committedAt: '2026-10-28T10:00:00+08:00' });
    const registry = (commits: string[]) => registryOf(window({ commits }));
    mkdirSync(join(f.cwd, 'deploy/hotfix'), { recursive: true });
    writeFileSync(join(f.cwd, 'deploy/hotfix/windows.json'), registry([f.shas[0]]));
    git(f.cwd, 'add', 'deploy/hotfix/windows.json');
    gitAt(f.cwd, COMMITTED, 'commit', '-m', 'chore: 登记 hotfix 窗口 (#5)');
    expect(checkInvariants({ repo: f.cwd, now: NOW }).ok).toBe(true);
    // 列的不是这个提交，就不归属
    writeFileSync(join(f.cwd, 'deploy/hotfix/windows.json'), registry(['0'.repeat(40)]));
    gitAt(f.cwd, COMMITTED, 'commit', '-am', 'chore: 改登记 (#5)');
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain(f.shas[0].slice(0, 12));
  });

  it('does not attribute a commit that cites the window but was committed before approval, unless the window lists it', () => {
    const f = hotfixRepo({ registry: registryOf(window()), messages: ['fix: 修复 (#5)'], committedAt: '2026-10-28T10:00:00+08:00' });
    const before = checkInvariants({ repo: f.cwd, now: NOW });
    expect(before.ok).toBe(false);
    const joined = before.violations.join('\n');
    expect(joined).toContain(f.shas[0].slice(0, 12));
    expect(joined).toContain('早于 #5 的批准时间');
    expect(joined).toContain(`把 ${f.shas[0]} 写进窗口 commits，或者不要把它推进 main`);
    // 把它列进窗口 commits 之后放行（登记提交本身在窗口之内，按 #5 归属）
    mkdirSync(join(f.cwd, 'deploy/hotfix'), { recursive: true });
    writeFileSync(join(f.cwd, 'deploy/hotfix/windows.json'), registryOf(window({ commits: [f.shas[0]] })));
    git(f.cwd, 'add', 'deploy/hotfix/windows.json');
    gitAt(f.cwd, COMMITTED, 'commit', '-m', 'chore: 登记 hotfix 窗口 (#5)');
    expect(checkInvariants({ repo: f.cwd, now: NOW }).ok).toBe(true);
  });

  it('does not attribute a commit that cites the window but was committed after its expiresAt', () => {
    const f = hotfixRepo({ registry: registryOf(window()), messages: ['fix: 修复 (#5)'], committedAt: '2026-11-06T10:00:00+08:00' });
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain(f.shas[0].slice(0, 12));
    expect(result.violations.join('\n')).toContain('晚于 #5 的 expiresAt');
  });

  it('treats a closed window, an expired window and a missing or broken registry as no window', () => {
    const messages = ['fix: 修复 (#5)'];
    expect(checkInvariants({ repo: hotfixRepo({ registry: registryOf(window({ status: 'closed', closedAt: '2026-10-29', evidence: '已合回 stage，线上核对通过' })), messages }).cwd, now: NOW }).ok).toBe(false);
    const expired = checkInvariants({ repo: hotfixRepo({ registry: registryOf(window()), messages }).cwd, now: new Date('2026-11-05T00:00:00+08:00') });
    expect(expired.ok).toBe(false);
    expect(expired.violations.join('\n')).toContain('已超过 expiresAt');
    expect(checkInvariants({ repo: hotfixRepo({ messages }).cwd, now: NOW }).ok).toBe(false);
    const broken = checkInvariants({ repo: hotfixRepo({ registry: '{ not json', messages }).cwd, now: NOW });
    expect(broken.ok).toBe(false);
    expect(broken.violations.join('\n')).toContain('不是合法 JSON');
  });

  it('rejects a registry without the owner approval and a window longer than 7 days', () => {
    const noApproval = checkInvariants({ repo: hotfixRepo({ registry: registryOf(window({ approval: '' })), messages: ['fix (#5)'] }).cwd, now: NOW });
    expect(noApproval.ok).toBe(false);
    expect(noApproval.violations.join('\n')).toContain('批准摘要');
    const tooLong = checkInvariants({ repo: hotfixRepo({ registry: registryOf(window({ expiresAt: '2026-11-20T00:00:00+08:00' })), messages: ['fix (#5)'] }).cwd, now: NOW });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.violations.join('\n')).toContain('最长 7 天');
    const notOwner = checkInvariants({ repo: hotfixRepo({ registry: registryOf(window({ approvedBy: 'someone' })), messages: ['fix (#5)'] }).cwd, now: NOW });
    expect(notOwner.ok).toBe(false);
  });

  it('keeps the strict behaviour once stage contains main, even if the window is still marked open', () => {
    const f = hotfixRepo({ registry: registryOf(window()), messages: ['fix (#5)'] });
    git(f.cwd, 'checkout', 'stage');
    git(f.cwd, 'merge', '--no-ff', '-m', 'merge main into stage', 'main');
    // stage 推上去之后远端跟踪分支跟着走；证据读的是远端跟踪的 stage。
    git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', 'stage');
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(true);
    expect(result.notes.join('\n')).not.toContain('hotfix 窗口');
  });

  it('pre-push: pushing a main tip that leads stage is allowed only for attributable commits', () => {
    const ok = hotfixRepo({ registry: registryOf(window()), messages: ['fix (#5)', 'docs: task/5 的记录'] });
    const tip = ok.shas[1];
    const allowed = checkPushes({ repo: ok.cwd, pushes: [{ localRef: 'refs/heads/main', localSha: tip, remoteRef: 'refs/heads/main', remoteSha: '0'.repeat(40) }] });
    expect(allowed.violations).toEqual([]);
    expect(allowed.notes.join('\n')).toContain('hotfix 窗口 #5');
    const bad = hotfixRepo({ registry: registryOf(window()), messages: ['fix (#5)', 'chore: 别的'] });
    const refused = checkPushes({ repo: bad.cwd, pushes: [{ localRef: 'refs/heads/main', localSha: bad.shas[1], remoteRef: 'refs/heads/main', remoteSha: '0'.repeat(40) }] });
    expect(refused.violations.join('\n')).toContain(bad.shas[1].slice(0, 12));
    expect(refused.violations.join('\n')).toContain('P0 hotfix：先在 main 上登记窗口');
    const noRegistry = hotfixRepo({ messages: ['fix (#5)'] });
    expect(checkPushes({ repo: noRegistry.cwd, pushes: [{ localRef: 'refs/heads/main', localSha: noRegistry.shas[0], remoteRef: 'refs/heads/main', remoteSha: '0'.repeat(40) }] }).violations).not.toEqual([]);
  });

  it('pre-push: a stage push that lacks only window commits of main is allowed, other main commits still block it', () => {
    const f = hotfixRepo({ registry: registryOf(window()), messages: ['fix (#5)'] });
    const stage = checkPushes({ repo: f.cwd, pushes: [{ localRef: 'refs/heads/stage', localSha: f.stageTip, remoteRef: 'refs/heads/stage', remoteSha: f.stageTip }] });
    expect(stage.violations).toEqual([]);
    const other = hotfixRepo({ registry: registryOf(window()), messages: ['fix (#5)', 'chore: 别的'] });
    const blocked = checkPushes({ repo: other.cwd, pushes: [{ localRef: 'refs/heads/stage', localSha: other.stageTip, remoteRef: 'refs/heads/stage', remoteSha: other.stageTip }] });
    expect(blocked.violations.join('\n')).toContain(INVARIANTS[0]);
  });
});
