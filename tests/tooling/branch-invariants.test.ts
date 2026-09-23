import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      'tag.gpgSign=false',
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

  it('warns instead of failing for personal/task targets and non-release tag pushes', () => {
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
    // release-1.0.0 不是 v 开头的发布 tag：只告警，不参与发版。
    expect(warnings).toContain('refs/tags/release-1.0.0 不是发布 tag');
    // 旧的带 - 分支名推到自己的远端分支：不阻断，但要告警。
    expect(warnings).toContain('refs/heads/dev-crosery');
    expect(warnings).toContain('refs/heads/task/7-forum-path');
    expect(warnings).not.toContain('refs/heads/dev/crosery ');
    expect(warnings).not.toContain('refs/heads/task/7/forum_path ');
  });

  it('still checks a first push whose remote ref does not exist yet (all-zero <remote sha>)', () => {
    // git 的约定：<remote sha> 全 0 = 远端还没有这个 ref（新建分支），不是删除；命名与不变量都必须照常判定。
    const f = fixture({ divergent: true });
    const zero = '0'.repeat(40);
    const fresh = (name: string) => ({ localRef: `refs/heads/${name}`, localSha: f.stageTip, remoteRef: `refs/heads/${name}`, remoteSha: zero });
    const naming = checkPushes({ repo: f.cwd, pushes: [fresh('task/12-foo'), fresh('dev-crosery'), fresh('dev/crosery'), fresh('task/12/portal_redesign')] });
    expect(naming.ok).toBe(true);
    const warnings = naming.warnings.join('\n');
    expect(warnings).toContain('refs/heads/task/12-foo');
    expect(warnings).toContain('refs/heads/dev-crosery');
    expect(warnings).not.toContain('refs/heads/dev/crosery ');
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
    // 合并后删 task 分支、迁移时删旧的 dev-crosery：都是规范要求的动作，不阻断也不报命名告警。
    const cleanup = checkPushes({ repo: f.cwd, pushes: [del('task/12/portal_redesign'), del('dev-crosery')] });
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
      input: `refs/heads/dev/crosery ${f.stageTip} refs/heads/dev/crosery ${'b'.repeat(40)}\n`,
    });
    expect(passing.status).toBe(0);
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
