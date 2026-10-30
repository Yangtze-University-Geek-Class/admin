import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { INVARIANTS, checkInvariants, checkPushes } from '../../scripts/check-branch-invariants.mjs';
import { MAX_PROMOTION_DAYS, PROMOTION_FILE, commitsBetween, judgeAhead, promotionOf, registrationOf, trailerShas, validatePromotions } from '../../scripts/promotion-windows.mjs';

// 全部夹具都是临时目录里的合成仓库：测试从不修改 geek_main 的分支、远端或工作区。
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const script = join(repoRoot, 'scripts/promotion-windows.mjs');
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=Promotion fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
const run = (cwd: string, args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
const short = (sha: string) => sha.slice(0, 12);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** 登记里用的北京时间写法（秒精度，+08:00）。 */
const beijing = (ms: number) => `${new Date(ms + 8 * HOUR).toISOString().slice(0, 19)}+08:00`;
// 时间相对运行测试时的时钟取值：pre-push 判定用的是真实当前时间，窗口必须仍然有效。
const T0 = Date.now();
const NOW = new Date(T0);
const LATER = new Date(T0 + 5 * DAY);
// 只用于登记格式的占位 SHA（40 位十六进制）；夹具里的真实 SHA 由 git 生成。
const SHA_P = 'a'.repeat(40);
const SHA_Q = 'b'.repeat(40);

const promotion = (overrides: Record<string, unknown> = {}) => ({
  issue: 70,
  status: 'open',
  approvedBy: '所有者',
  approvedAt: beijing(T0 - HOUR),
  expiresAt: beijing(T0 + 2 * DAY),
  approval: '把这两笔修复先挑到正式环境，其余功能留在预发布',
  reason: '功能开关要改后端配置，前缀快进会把未发布的功能一起带上线',
  stageBase: SHA_Q,
  picks: [SHA_P],
  ...overrides,
});
const registryOf = (...windows: Record<string, unknown>[]) => JSON.stringify({ schemaVersion: 1, windows }, null, 2);

function commitFile(cwd: string, path: string, content: string, message: string) {
  mkdirSync(join(cwd, dirname(path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
  git(cwd, 'add', path);
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

type Shas = { A: string; B: string; X: string; Z: string };

/**
 * 合成仓库：main 与 stage 从同一个基线分叉。stage 上依次有功能 A、B、X（X 是登记时的 stage tip，即 stageBase），
 * side 分支上有 Z（不在 stage 上）。登记提交只在 main 上，是 main 独有的提交，窗口靠它才能放行 picks。
 * origin/stage 指向 stage tip：推送判定只认远端跟踪分支。结束时 HEAD 在 main 上，main 领先 stage 一个登记提交。
 */
function promotionRepo(overrides: (shas: Shas) => Record<string, unknown> = () => ({})) {
  const cwd = mkdtempSync(join(tmpdir(), 'geek-promotion-'));
  roots.push(cwd);
  git(cwd, 'init', '--initial-branch=main');
  const base = commitFile(cwd, 'base.txt', 'base\n', 'baseline');
  git(cwd, 'checkout', '-b', 'stage');
  // A 的内容是一个字符串字面量：空白变化（删一个空格）要能被识别为「内容改过」。
  const A = commitFile(cwd, 'a.txt', "export const label = 'feature a';\n", 'feat: 功能 A');
  const B = commitFile(cwd, 'b.txt', 'feature b\n', 'feat: 功能 B');
  const X = commitFile(cwd, 'x.txt', 'feature x\n', 'feat: 功能 X（不挑）');
  git(cwd, 'update-ref', 'refs/remotes/origin/stage', X);
  git(cwd, 'checkout', '-b', 'side', base);
  const Z = commitFile(cwd, 'z.txt', 'side only\n', 'side: 不在 stage 上');
  git(cwd, 'checkout', 'main');
  const shas = { A, B, X, Z };
  mkdirSync(join(cwd, 'deploy/promotion'), { recursive: true });
  writeFileSync(join(cwd, PROMOTION_FILE), registryOf(promotion({ picks: [A, B], stageBase: X, ...overrides(shas) })));
  git(cwd, 'add', PROMOTION_FILE);
  git(cwd, 'commit', '-m', 'chore: 登记部分晋升窗口 (#70)');
  return { cwd, base, ...shas };
}

const zero = '0'.repeat(40);

describe('promotion registry validation', () => {
  it('the shipped registry is empty and valid, and the limit is 3 days', () => {
    const shipped = JSON.parse(readFileSync(join(repoRoot, PROMOTION_FILE), 'utf8'));
    expect(shipped.windows).toEqual([]);
    expect(validatePromotions(shipped)).toEqual([]);
    expect(MAX_PROMOTION_DAYS).toBe(3);
  });

  it('rejects a window that reaches past 3 days and accepts exactly 3', () => {
    const past = validatePromotions({ schemaVersion: 1, windows: [promotion({ expiresAt: beijing(T0 - HOUR + 4 * DAY) })] });
    expect(past.join('\n')).toContain('最长 3 天');
    expect(validatePromotions({ schemaVersion: 1, windows: [promotion({ expiresAt: beijing(T0 - HOUR + 3 * DAY) })] })).toEqual([]);
  });

  it('requires the owner approval, a reason, 40-hex stageBase and picks, and keeps excludes outside picks', () => {
    const problems = (overrides: Record<string, unknown>) => validatePromotions({ schemaVersion: 1, windows: [promotion(overrides)] }).join('\n');
    expect(problems({})).toBe('');
    expect(problems({ approval: '太短' })).toContain('批准摘要');
    expect(problems({ approvedBy: 'someone' })).toContain('approvedBy');
    expect(problems({ reason: '省事' })).toContain('reason');
    expect(problems({ stageBase: 'xyz' })).toContain('stageBase');
    expect(problems({ picks: [] })).toContain('picks');
    expect(problems({ picks: [SHA_P, SHA_P] })).toContain('picks');
    expect(problems({ excludes: [{ sha: SHA_P, issue: 71 }] })).toContain('excludes 与 picks 不能有同一个提交');
    expect(problems({ excludes: [{ sha: 'nothex', issue: 71 }] })).toContain('excludes 必须是');
    expect(problems({ expiresAt: beijing(T0 - 2 * HOUR) })).toContain('expiresAt 必须晚于 approvedAt');
    expect(problems({ status: 'closed' })).toContain('closedAt');
    expect(validatePromotions({ schemaVersion: 2, windows: [] })).toEqual([expect.stringContaining('schemaVersion: 1')]);
  });
});

describe('promotion attribution: cherry-pick -x with patch-id', () => {
  it('passes a main-only cherry-pick -x of a listed pick', () => {
    const f = promotionRepo();
    git(f.cwd, 'cherry-pick', '-x', f.A);
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.notes.join('\n')).toContain('部分晋升窗口 #70 挑进 main 的提交 1 个');
  });

  it('fails a cherry-pick of a stage commit that is not in picks', () => {
    const f = promotionRepo();
    git(f.cwd, 'cherry-pick', '-x', f.X);
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    const joined = result.violations.join('\n');
    expect(joined).toContain(INVARIANTS[1]);
    expect(joined).toContain(short(git(f.cwd, 'rev-parse', 'main')));
    expect(joined).toContain('不在任何开着的晋升窗口 picks 里');
  });

  it('never covers a cherry-pick whose content differs from its pick, even one that resolved a conflict', () => {
    const f = promotionRepo();
    git(f.cwd, 'cherry-pick', '-x', f.A);
    writeFileSync(join(f.cwd, 'a.txt'), "export const label = 'feature a, edited on main';\n");
    git(f.cwd, 'commit', '-a', '--amend', '--no-edit');
    const changed = checkInvariants({ repo: f.cwd, now: NOW });
    expect(changed.ok).toBe(false);
    expect(changed.violations.join('\n')).toContain('patch-id 不一致');
  });

  it('a window that still carries conflictResolved makes the registry invalid, so its picks attribute to nothing', () => {
    expect(validatePromotions({ schemaVersion: 1, windows: [promotion({ conflictResolved: [] })] }).join('\n')).toContain('不再支持 conflictResolved');
    const f = promotionRepo(({ A }) => ({ conflictResolved: [A] }));
    git(f.cwd, 'cherry-pick', '-x', f.A);
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain(`${PROMOTION_FILE} 格式有误`);
    expect(result.violations.join('\n')).toContain('不再支持 conflictResolved');
  });

  it('does not cover a cherry-pick that only deletes one space inside a string literal (patch-id --verbatim)', () => {
    const f = promotionRepo();
    git(f.cwd, 'cherry-pick', '-x', f.A);
    // 正控：原样挑的提交必须归属，否则下面的「不归属」可能只是 patch-id 算不出来。
    expect(checkInvariants({ repo: f.cwd, now: NOW }).ok).toBe(true);
    writeFileSync(join(f.cwd, 'a.txt'), "export const label = 'featurea';\n");
    git(f.cwd, 'commit', '-a', '--amend', '--no-edit');
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain('patch-id 不一致');
  });

  it('fails an open window that has passed expiresAt, the same way an expired hotfix window does', () => {
    const f = promotionRepo();
    git(f.cwd, 'cherry-pick', '-x', f.A);
    const result = checkInvariants({ repo: f.cwd, now: LATER });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain('晋升窗口 #70 已超过 expiresAt');
  });

  it('a window that breaks the 3-day limit makes the registry invalid, so its picks attribute to nothing', () => {
    const f = promotionRepo(() => ({ expiresAt: beijing(T0 - HOUR + 4 * DAY) }));
    git(f.cwd, 'cherry-pick', '-x', f.A);
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain('格式有误');
    expect(result.violations.join('\n')).toContain('最长 3 天');
  });

  it('never covers a merge commit on main, even with a matching trailer', () => {
    const f = promotionRepo();
    git(f.cwd, 'merge', '--no-ff', '-s', 'ours', '-m', `merge stage with a cherry-pick trailer\n\n(cherry picked from commit ${f.A})`, 'stage');
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain('合并提交不能由晋升窗口放行');

    // 同一份痕迹与 patch-id，只差在合并与否：非合并提交放行，合并提交不放行。
    const window70 = { issue: 70, status: 'open', picks: [f.A], excludes: [] };
    const trailer = { cherryPickedFrom: [{ sha: f.A, patchId: SHA_P }], patchId: SHA_P };
    expect(promotionOf(f.A, trailer, [window70])).toBe(window70);
    expect(promotionOf(f.A, { ...trailer, merge: true }, [window70])).toBeNull();
    // 拿不到 patch-id（来源或本提交找不到）时不放行。
    expect(promotionOf(f.A, { cherryPickedFrom: [{ sha: f.A, patchId: null }], patchId: null }, [window70])).toBeNull();
  });

  it('refuses picks or a stageBase that are not on the stage history at registration', () => {
    const pickOffStage = promotionRepo(({ Z }) => ({ picks: [Z] }));
    git(pickOffStage.cwd, 'commit', '--allow-empty', '-m', 'chore: main 上别的提交');
    const picked = checkInvariants({ repo: pickOffStage.cwd, now: NOW });
    expect(picked.ok).toBe(false);
    expect(picked.violations.join('\n')).toContain(`pick ${short(pickOffStage.Z)} 不在 stageBase`);

    const badBase = promotionRepo(({ Z }) => ({ stageBase: Z }));
    git(badBase.cwd, 'commit', '--allow-empty', '-m', 'chore: main 上别的提交');
    const based = checkInvariants({ repo: badBase.cwd, now: NOW });
    expect(based.ok).toBe(false);
    expect(based.violations.join('\n')).toContain(`stageBase ${short(badBase.Z)} 不在 stage`);
  });

  it('fails when an excluded commit reaches main through a cherry-pick', () => {
    const f = promotionRepo(({ X }) => ({ excludes: [{ sha: X, issue: 71 }] }));
    git(f.cwd, 'cherry-pick', '-x', f.X);
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain(`排除的提交 ${short(f.X)} 已经在 main 上`);
  });

  it('reads the trailer only as a whole line, and refuses to judge more than 500 main-only commits', () => {
    const f = promotionRepo();
    expect(trailerShas(`subject\n\n(cherry picked from commit ${f.A})\n`)).toEqual([f.A]);
    expect(trailerShas(`subject, mentions (cherry picked from commit ${f.A}) inline`)).toEqual([]);
    // 501 个 main 独有提交：超过上限就直接失败，不能只核对前 500 个。
    let tip = f.base;
    for (let index = 0; index < 501; index++) tip = git(f.cwd, 'commit-tree', 'HEAD^{tree}', '-p', tip, '-m', `main only ${index}`);
    git(f.cwd, 'update-ref', 'refs/heads/main', tip);
    expect(() => commitsBetween(f.cwd, 'stage', 'main')).toThrow('超过 500 个');
    expect(() => checkInvariants({ repo: f.cwd, now: NOW })).toThrow('超过 500 个');
    // 逐个 git commit-tree 要约 5 秒，默认 5 秒超时会在并行运行时误失败：只放宽这一条用例的超时。
  }, 30000);

  it('pre-push: a main tip whose main-only commits are listed picks is allowed, a stray cherry-pick is not', () => {
    const f = promotionRepo();
    git(f.cwd, 'cherry-pick', '-x', f.A);
    const tip = git(f.cwd, 'rev-parse', 'main');
    const allowed = checkPushes({ repo: f.cwd, pushes: [{ localRef: 'refs/heads/main', localSha: tip, remoteRef: 'refs/heads/main', remoteSha: zero }] });
    expect(allowed.violations).toEqual([]);
    expect(allowed.notes.join('\n')).toContain('部分晋升窗口 #70 挑进 main 的提交 1 个');

    const stray = promotionRepo();
    git(stray.cwd, 'cherry-pick', '-x', stray.X);
    const refused = checkPushes({ repo: stray.cwd, pushes: [{ localRef: 'refs/heads/main', localSha: git(stray.cwd, 'rev-parse', 'main'), remoteRef: 'refs/heads/main', remoteSha: zero }] });
    expect(refused.violations.join('\n')).toContain(INVARIANTS[1]);
    expect(refused.violations.join('\n')).toContain('只挑个别提交');
  });

  it('a window whose registration came from stage history covers no picks, but its excludes are still checked', () => {
    const f = promotionRepo(({ X }) => ({ excludes: [{ sha: X, issue: 71 }] }));
    // 登记已经合回 stage 并推上去（远端跟踪的 stage 跟着走）：登记提交不再是 main 独有的提交，窗口不能再放行新挑的 pick。
    git(f.cwd, 'checkout', 'stage');
    git(f.cwd, 'merge', '--no-ff', '-m', 'merge main into stage', 'main');
    git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', 'stage');
    git(f.cwd, 'checkout', 'main');
    git(f.cwd, 'cherry-pick', '-x', f.B);
    const pickedB = git(f.cwd, 'rev-parse', 'HEAD');
    git(f.cwd, 'cherry-pick', '-x', f.X);
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    const joined = result.violations.join('\n');
    expect(joined).toContain(`${short(pickedB)}：`);
    expect(joined).toContain(`排除的提交 ${short(f.X)} 已经在 main 上`);
    expect(run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']).stdout).toContain('晋升窗口 #70：开着，但不能用来放行（晋升窗口 #70 的登记提交不在 main 独有的提交里');
  });

  it('excludes are checked even when main does not lead stage: judgeAhead, pre-push, CI mode and check all refuse a fast-forward onto an excluded pick', () => {
    const f = promotionRepo(({ A, B }) => ({ picks: [A], excludes: [{ sha: B, issue: 71 }] }));
    // stage 收进登记，main 快进到 stage：main 不领先 stage，但排除的 B 已经随快进进了 main。
    git(f.cwd, 'checkout', 'stage');
    git(f.cwd, 'merge', '--no-ff', '-m', 'merge main into stage', 'main');
    const stageTip = git(f.cwd, 'rev-parse', 'HEAD');
    git(f.cwd, 'checkout', 'main');
    git(f.cwd, 'merge', '--ff-only', 'stage');
    git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', stageTip);
    const mainTip = git(f.cwd, 'rev-parse', 'main');
    expect(mainTip).toBe(stageTip);

    const judged = judgeAhead({ repo: f.cwd, mainSha: mainTip, stageSha: stageTip, now: NOW });
    expect(judged.ahead).toEqual([]);
    expect(judged.problems.join('\n')).toContain(`排除的提交 ${short(f.B)} 已经在 main 上（main 的祖先）`);

    const pushed = checkPushes({ repo: f.cwd, pushes: [{ localRef: 'refs/heads/main', localSha: mainTip, remoteRef: 'refs/heads/main', remoteSha: zero }] });
    expect(pushed.ok).toBe(false);
    expect(pushed.violations.join('\n')).toContain(`排除的提交 ${short(f.B)} 已经在 main 上`);

    const ci = checkInvariants({ repo: f.cwd, now: NOW });
    expect(ci.ok).toBe(false);
    expect(ci.violations.join('\n')).toContain(`排除的提交 ${short(f.B)} 已经在 main 上`);

    const cli = run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    expect(cli.status).toBe(1);
    expect(cli.stdout).toContain(`排除的提交 ${short(f.B)} 已经在 main 上`);
  });
});

describe('promotion windows cannot be deleted or altered once open', () => {
  /** 登记与 pick A 合回 stage 并推上去；返回合回后的 main tip。excludes 里是 B。 */
  function mergedBack() {
    const f = promotionRepo(({ A, B }) => ({ picks: [A], excludes: [{ sha: B, issue: 71 }] }));
    git(f.cwd, 'cherry-pick', '-x', f.A);
    const mainTip = git(f.cwd, 'rev-parse', 'main');
    git(f.cwd, 'update-ref', 'refs/remotes/origin/main', mainTip);
    git(f.cwd, 'checkout', 'stage');
    git(f.cwd, 'merge', '--no-ff', '-m', 'merge main into stage', 'main');
    git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', 'stage');
    return { ...f, mainTip };
  }
  const stagePush = (cwd: string, localSha: string, remoteSha: string) => checkPushes({ repo: cwd, pushes: [{ localRef: 'refs/heads/stage', localSha, remoteRef: 'refs/heads/stage', remoteSha }] });
  const mainPush = (cwd: string, localSha: string, remoteSha: string) => checkPushes({ repo: cwd, pushes: [{ localRef: 'refs/heads/main', localSha, remoteRef: 'refs/heads/main', remoteSha }] });

  it('attack: stage deletes an open window, then main fast-forwards onto an excluded commit; stage CI, stage pre-push, check and the main pre-push all refuse', () => {
    const f = mergedBack();
    const before = git(f.cwd, 'rev-parse', 'stage');
    const deleted = registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [] }, 'chore: 删掉晋升窗口 (#70)');
    git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', deleted);

    const ci = checkInvariants({ repo: f.cwd, now: NOW });
    expect(ci.ok).toBe(false);
    expect(ci.violations.join('\n')).toContain('stage 的历史上登记过的晋升窗口 #70，到 stage 这一版被删了或改了');
    const pushedStage = stagePush(f.cwd, deleted, before);
    expect(pushedStage.ok).toBe(false);
    expect(pushedStage.violations.join('\n')).toContain('拒绝推送到 refs/heads/stage：');
    expect(pushedStage.violations.join('\n')).toContain('stage 的历史上登记过的晋升窗口 #70');
    const cli = run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    expect(cli.status).toBe(1);
    expect(cli.stdout).toContain('stage 的历史上登记过的晋升窗口 #70，到 stage 这一版被删了或改了');

    // stage 已经带着 B 和删掉窗口的登记；main 快进过去。远端 main 上窗口还开着：删掉不算数，B 照旧算排除。
    git(f.cwd, 'checkout', 'main');
    git(f.cwd, 'merge', '--ff-only', 'stage');
    const pushedMain = mainPush(f.cwd, deleted, f.mainTip);
    expect(pushedMain.ok).toBe(false);
    const joined = pushedMain.violations.join('\n');
    expect(joined).toContain(`推送前的 main（${short(f.mainTip)}）上开着的晋升窗口 #70，这次推送后被删了或改了`);
    expect(joined).toContain(`排除的提交 ${short(f.B)} 已经在 main 上`);

    // 快进已经落到远端（没启用钩子、GitLab 上合 MR）：CI 与 check 没有推送前的 main，按 main 自己的历史照样拦。
    git(f.cwd, 'update-ref', 'refs/remotes/origin/main', deleted);
    const after = checkInvariants({ repo: f.cwd, now: NOW });
    expect(after.ok).toBe(false);
    expect(after.violations.join('\n')).toContain('main 的历史上登记过的晋升窗口 #70，到 main 这一版被删了或改了');
    expect(after.violations.join('\n')).toContain(`排除的提交 ${short(f.B)} 已经在 main 上`);
    const cliAfter = run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    expect(cliAfter.status).toBe(1);
    expect(cliAfter.stdout).toContain('main 的历史上登记过的晋升窗口 #70');
    expect(mainPush(f.cwd, deleted, zero).violations.join('\n')).toContain('main 的历史上登记过的晋升窗口 #70');
  });

  it('attack: a merge into stage that drops the window while resolving is caught, even though history simplification would skip the main side', () => {
    const f = promotionRepo();
    git(f.cwd, 'checkout', 'stage');
    git(f.cwd, 'merge', '--no-ff', '--no-commit', 'main');
    git(f.cwd, 'rm', '-q', '-f', PROMOTION_FILE);
    git(f.cwd, 'commit', '-m', 'merge main into stage');
    const merged = git(f.cwd, 'rev-parse', 'HEAD');
    expect(git(f.cwd, 'rev-list', merged, '--', PROMOTION_FILE)).toBe('');
    const judged = judgeAhead({ repo: f.cwd, mainSha: git(f.cwd, 'rev-parse', 'main'), stageSha: merged, now: NOW });
    expect(judged.tampered.join('\n')).toContain('stage 的历史上登记过的晋升窗口 #70');
  });

  it('attack: a task branch from before the registration writes its own #70 and keeps it when merging stage; the stage push, CI and check all refuse', () => {
    const f = mergedBack();
    git(f.cwd, 'update-ref', 'refs/remotes/origin/main', f.mainTip);
    git(f.cwd, 'checkout', '-q', '-b', 'task/71/fake_window', f.base);
    mkdirSync(join(f.cwd, 'deploy/promotion'), { recursive: true });
    const fake = registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [promotion({ picks: [f.A], stageBase: f.X })] }, 'chore: 自己写一版 #70（没有 excludes）');
    expect(fake).toMatch(/^[0-9a-f]{40}$/);
    // 合进 stage 时登记文件冲突，取自己那一版。
    spawnSync('git', ['-c', 'user.name=Promotion fixture', '-c', 'user.email=fixture@example.invalid', 'merge', '--no-ff', '-m', 'merge stage', 'stage'], { cwd: f.cwd, encoding: 'utf8' });
    git(f.cwd, 'checkout', '--ours', PROMOTION_FILE);
    git(f.cwd, 'add', PROMOTION_FILE);
    git(f.cwd, '-c', 'core.editor=true', 'commit', '--no-edit');
    const resolved = git(f.cwd, 'rev-parse', 'HEAD');
    expect(JSON.parse(git(f.cwd, 'show', `${resolved}:${PROMOTION_FILE}`)).windows[0].excludes).toBeUndefined();

    const before = git(f.cwd, 'rev-parse', 'stage');
    const pushed = checkPushes({ repo: f.cwd, pushes: [{ localRef: 'refs/heads/task/71/fake_window', localSha: resolved, remoteRef: 'refs/heads/stage', remoteSha: before }] });
    expect(pushed.ok).toBe(false);
    expect(pushed.violations.join('\n')).toContain('stage 这一版删了或改了 main 上开着的晋升窗口 #70');

    // 这一版已经落到 stage，main 也快进过去：历史里同一个 #70 有两版登记，CI 与 check 照样拦，excludes 按原来那一版核对。
    git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', resolved);
    git(f.cwd, 'update-ref', 'refs/remotes/origin/main', resolved);
    const ci = checkInvariants({ repo: f.cwd, now: NOW });
    expect(ci.ok).toBe(false);
    expect(ci.violations.join('\n')).toContain('main 的历史上登记过的晋升窗口 #70');
    expect(ci.violations.join('\n')).toContain(`排除的提交 ${short(f.B)} 已经在 main 上`);
    expect(run(f.cwd, ['check', '--main', resolved, '--stage', resolved]).status).toBe(1);
  });

  it('a close without closedAt and evidence does not count as closed: close, reopen, then delete is still a deletion', () => {
    const f = mergedBack();
    const window = { picks: [f.A], stageBase: f.X, excludes: [{ sha: f.B, issue: 71 }] };
    registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [promotion({ ...window, status: 'closed' })] }, 'chore: 关窗（没写 closedAt 与 evidence）(#70)');
    // 随便填的 closedAt 与 evidence 也不算：和登记校验同一个口径（时间写法、至少 8 个字）。
    registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [promotion({ ...window, status: 'closed', closedAt: 'x', evidence: 'y' })] }, 'chore: 关窗（收尾字段随便填）(#70)');
    registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [promotion(window)] }, 'chore: 改回 open (#70)');
    const deleted = registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [] }, 'chore: 删掉 (#70)');
    expect(judgeAhead({ repo: f.cwd, mainSha: f.mainTip, stageSha: deleted, now: NOW }).tampered.join('\n')).toContain('stage 的历史上登记过的晋升窗口 #70');
    git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', deleted);
    git(f.cwd, 'update-ref', 'refs/remotes/origin/main', deleted);
    expect(checkInvariants({ repo: f.cwd, now: NOW }).violations.join('\n')).toContain(`排除的提交 ${short(f.B)} 已经在 main 上`);
  });

  it('a force push whose prior remote main is not in the local repository is refused, not skipped', () => {
    const f = mergedBack();
    git(f.cwd, 'checkout', 'main');
    const pushed = mainPush(f.cwd, f.mainTip, 'c'.repeat(40));
    expect(pushed.ok).toBe(false);
    expect(pushed.violations.join('\n')).toContain(`推送前的远端 main ${'c'.repeat(12)} 不在本地`);
  });

  it('an expired window that is still open cannot be deleted on stage either, and an unreadable stage registry is reported, not thrown', () => {
    const f = mergedBack();
    const deleted = registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [] }, 'chore: 删掉过期的晋升窗口 (#70)');
    expect(judgeAhead({ repo: f.cwd, mainSha: f.mainTip, stageSha: deleted, now: LATER }).tampered.join('\n')).toContain('stage 的历史上登记过的晋升窗口 #70');

    const g = mergedBack();
    const before = git(g.cwd, 'rev-parse', 'stage');
    const broken = registryOnlyCommit(g.cwd, { schemaVersion: 1, windows: {} }, 'chore: 登记写坏了 (#70)');
    const pushed = stagePush(g.cwd, broken, before);
    expect(pushed.ok).toBe(false);
    expect(pushed.violations.join('\n')).toContain('stage 的历史上登记过的晋升窗口 #70');
  });

  it('the stage push takes main from the remote being pushed to: gitlab/main ahead of a stale origin/main still has to be in stage', () => {
    const f = promotionRepo();
    git(f.cwd, 'update-ref', 'refs/remotes/origin/main', f.base);
    commitFile(f.cwd, 'stray.txt', 'not on stage\n', 'feat: 只在 main 上的提交');
    git(f.cwd, 'update-ref', 'refs/remotes/gitlab/main', 'main');
    const stageTip = git(f.cwd, 'rev-parse', 'stage');
    const push = [{ localRef: 'refs/heads/stage', localSha: stageTip, remoteRef: 'refs/heads/stage', remoteSha: stageTip }];
    expect(checkPushes({ repo: f.cwd, pushes: push, remote: 'gitlab' }).violations.join('\n')).toContain(INVARIANTS[0]);
    expect(checkPushes({ repo: f.cwd, pushes: push }).violations).toEqual([]);
  });

  it('attack: stage drops an exclude from an open window; the edit is caught the same way as a deletion', () => {
    const f = mergedBack();
    const before = git(f.cwd, 'rev-parse', 'stage');
    const edited = registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [promotion({ picks: [f.A], stageBase: f.X })] }, 'chore: 去掉排除项 (#70)');
    git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', edited);
    expect(stagePush(f.cwd, edited, before).violations.join('\n')).toContain('stage 的历史上登记过的晋升窗口 #70');
    expect(judgeAhead({ repo: f.cwd, mainSha: f.mainTip, stageSha: edited, now: NOW }).tampered.join('\n')).toContain('stage 这一版删了或改了 main 上开着的晋升窗口 #70');
    git(f.cwd, 'checkout', 'main');
    git(f.cwd, 'merge', '--ff-only', 'stage');
    expect(judgeAhead({ repo: f.cwd, mainSha: edited, stageSha: edited, priorMainSha: f.mainTip, now: NOW }).problems.join('\n')).toContain(`排除的提交 ${short(f.B)} 已经在 main 上`);
  });

  it('closing a window on stage releases its excludes: the fast-forward that carries B is allowed', () => {
    const f = mergedBack();
    const before = git(f.cwd, 'rev-parse', 'stage');
    const closed = registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [promotion({ picks: [f.A], stageBase: f.X, excludes: [{ sha: f.B, issue: 71 }], status: 'closed', closedAt: beijing(T0), evidence: '正式环境核对 pick A 后收尾（测试夹具）' })] }, 'chore: 关闭部分晋升窗口 (#70)');
    git(f.cwd, 'update-ref', 'refs/remotes/origin/stage', closed);
    expect(stagePush(f.cwd, closed, before).violations).toEqual([]);
    expect(checkInvariants({ repo: f.cwd, now: NOW }).violations).toEqual([]);
    git(f.cwd, 'checkout', 'main');
    git(f.cwd, 'merge', '--ff-only', 'stage');
    const pushed = mainPush(f.cwd, closed, f.mainTip);
    expect(pushed.violations).toEqual([]);
    expect(pushed.ok).toBe(true);
  });

  it('no false alarm: a registration that has not reached stage yet, and a normal stage push after it, are not deletions', () => {
    const f = promotionRepo();
    const judged = judgeAhead({ repo: f.cwd, mainSha: git(f.cwd, 'rev-parse', 'main'), stageSha: git(f.cwd, 'rev-parse', 'stage'), now: NOW });
    expect(judged.tampered).toEqual([]);
    expect(judged.problems).toEqual([]);
    git(f.cwd, 'update-ref', 'refs/remotes/origin/main', 'main');
    git(f.cwd, 'checkout', 'stage');
    const before = git(f.cwd, 'rev-parse', 'HEAD');
    const next = commitFile(f.cwd, 'c.txt', 'feature c\n', 'feat: 功能 C');
    expect(stagePush(f.cwd, next, before).violations.join('\n')).not.toContain('晋升窗口');
  });
});

describe('promotion check command (read-only)', () => {
  it('prints the status of every pick and exits 0 when every main-only commit is attributable, without touching refs', () => {
    const f = promotionRepo();
    git(f.cwd, 'cherry-pick', '-x', f.A);
    const refsBefore = git(f.cwd, 'for-each-ref', '--format=%(refname) %(objectname)');
    const result = run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`pick ${short(f.A)} 已在 main（cherry-pick`);
    expect(result.stdout).toContain(`pick ${short(f.B)} 尚未挑进 main`);
    expect(result.stdout).toContain('晋升窗口检查通过');
    expect(git(f.cwd, 'for-each-ref', '--format=%(refname) %(objectname)')).toBe(refsBefore);
  });

  it('exits 1 with the offending commit when a main-only commit is not attributable', () => {
    const f = promotionRepo();
    git(f.cwd, 'cherry-pick', '-x', f.X);
    const result = run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`[违规] main 独有提交 ${short(git(f.cwd, 'rev-parse', 'main'))} 不归属任何开着的窗口`);
  });

  it('fails when an excluded commit is on main, through a cherry-pick trailer or through ancestry', () => {
    const trailer = promotionRepo(({ X }) => ({ excludes: [{ sha: X, issue: 71 }] }));
    git(trailer.cwd, 'cherry-pick', '-x', trailer.X);
    const viaTrailer = run(trailer.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    expect(viaTrailer.status).toBe(1);
    expect(viaTrailer.stdout).toContain(`排除的 ${short(trailer.X)} 已进 main（main 独有提交`);

    const ancestry = promotionRepo(({ X }) => ({ excludes: [{ sha: X, issue: 71 }] }));
    git(ancestry.cwd, 'merge', '--no-ff', '-s', 'ours', '-m', 'merge stage without changes', 'stage');
    const viaAncestry = run(ancestry.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    expect(viaAncestry.status).toBe(1);
    expect(viaAncestry.stdout).toContain(`排除的 ${short(ancestry.X)} 已进 main（main 的祖先）`);
  });

  it('rejects an unknown command or argument with a usage error', () => {
    const f = promotionRepo();
    const unknown = run(f.cwd, ['merge']);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('未知命令');
    expect(run(f.cwd, ['check', '--bogus']).stderr).toContain('未知参数');
  });
});

/** 把一次提交的提交者时间钉在指定的毫秒时刻（GIT_COMMITTER_DATE），其它参数同 git()。 */
const gitAt = (cwd: string, committedAt: number, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', '-c', 'user.name=Promotion fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_COMMITTER_DATE: `${Math.floor(committedAt / 1000)} +0800` } },
  ).trim();

/**
 * 登记提交的夹具：stage 上有 A、B、X（X 是登记时的 stage tip），main 停在基线上，再在 main 上提交登记：
 * 登记只在 main 上、没有合回 stage，所以它是 main 独有提交，只能靠「登记提交」规则归属。
 */
function registrationRepo(opts: { message?: string; alsoTouch?: boolean; committedAt?: number; approvedAt?: number; expiresAt?: number; issue?: number; picks?: (shas: { A: string; B: string; X: string }) => string[] } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'geek-registration-'));
  roots.push(cwd);
  git(cwd, 'init', '--initial-branch=main');
  const base = commitFile(cwd, 'base.txt', 'base\n', 'baseline');
  git(cwd, 'checkout', '-b', 'stage');
  const A = commitFile(cwd, 'a.txt', 'feature a\n', 'feat: 功能 A');
  const B = commitFile(cwd, 'b.txt', 'feature b\n', 'feat: 功能 B');
  const X = commitFile(cwd, 'x.txt', 'feature x\n', 'feat: 功能 X（不挑）');
  git(cwd, 'update-ref', 'refs/remotes/origin/stage', X);
  git(cwd, 'checkout', 'main');
  mkdirSync(join(cwd, 'deploy/promotion'), { recursive: true });
  writeFileSync(join(cwd, PROMOTION_FILE), registryOf(promotion({
    issue: opts.issue ?? 70,
    picks: opts.picks ? opts.picks({ A, B, X }) : [A, B],
    stageBase: X,
    approvedAt: beijing(opts.approvedAt ?? T0 - HOUR),
    expiresAt: beijing(opts.expiresAt ?? T0 + 2 * DAY),
  })));
  git(cwd, 'add', PROMOTION_FILE);
  if (opts.alsoTouch) {
    writeFileSync(join(cwd, 'README.md'), 'also touched\n');
    git(cwd, 'add', 'README.md');
  }
  const message = opts.message ?? 'chore: 登记部分晋升窗口 (#70)';
  if (opts.committedAt === undefined) git(cwd, 'commit', '-m', message);
  else gitAt(cwd, opts.committedAt, 'commit', '-m', message);
  return { cwd, base, A, B, X, main: git(cwd, 'rev-parse', 'HEAD') };
}

const entryOf = (sha: string, message: string, committedAt: number, parents: string[] = ['p']) => ({ sha, parents, message, committedAt });

describe('promotion registration commits: the commit that opens a window on main', () => {
  it('attributes a main-only commit that only touches the registry, cites the issue, and is inside the window', () => {
    const f = registrationRepo();
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.notes.join('\n')).toContain('部分晋升窗口 #70 登记提交 1 个');
    expect(checkPushes({ repo: f.cwd, pushes: [{ localRef: 'refs/heads/main', localSha: f.main, remoteRef: 'refs/heads/main', remoteSha: zero }] }).violations).toEqual([]);
    const check = run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain('归属 1 个 main 独有提交（含登记提交）');
  });

  it('accepts the task/<issue>/ form of the reference, and never matches a longer issue number', () => {
    const cited = registrationRepo({ message: 'chore: 登记 task/70/promotion_window' });
    expect(registrationOf(cited.cwd, entryOf(cited.main, 'chore: 登记 task/70/promotion_window', T0, [cited.base]))).toEqual({ item: expect.objectContaining({ issue: 70 }), kind: 'registration' });
    const longer = registrationRepo({ message: 'chore: 登记部分晋升窗口 (#700)' });
    expect(registrationOf(longer.cwd, entryOf(longer.main, 'chore: 登记部分晋升窗口 (#700)', T0, [longer.base]))).toBeNull();
  });

  it('negative: a commit that also touches another file is not a registration', () => {
    const f = registrationRepo({ alsoTouch: true });
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain(`${short(f.main)}：`);
    expect(registrationOf(f.cwd, entryOf(f.main, 'chore: 登记部分晋升窗口 (#70)', T0, [f.base]))).toBeNull();
  });

  it('negative: a commit that cites another issue is not attributed to window 70', () => {
    const f = registrationRepo({ message: 'chore: 登记部分晋升窗口 (#71)' });
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain(`${short(f.main)}：`);
  });

  it('negative: committed before approvedAt, or after expiresAt, is outside the window and the reason says so', () => {
    const early = registrationRepo({ committedAt: T0 - 2 * HOUR });
    const earlyResult = checkInvariants({ repo: early.cwd, now: NOW });
    expect(earlyResult.ok).toBe(false);
    expect(earlyResult.violations.join('\n')).toContain('登记提交引用了晋升窗口 #70，但提交者时间不在它的批准与过期之间');

    const late = registrationRepo({ committedAt: T0 + 2 * DAY, expiresAt: T0 + DAY });
    const lateResult = checkInvariants({ repo: late.cwd, now: NOW });
    expect(lateResult.ok).toBe(false);
    expect(lateResult.violations.join('\n')).toContain('登记提交引用了晋升窗口 #70，但提交者时间不在它的批准与过期之间');
    // 窗口本身仍然开着（now 早于 expiresAt）：这里不是「窗口过期」的原因。
    expect(lateResult.violations.join('\n')).not.toContain('已超过 expiresAt');
  });

  it('negative: a merge commit never counts as a registration, even when its diff is only the registry', () => {
    // 同一份登记：side 上提交一次，main 用 --no-ff 合进来。side 的提交是 main 独有的普通提交，可以归属；合并提交不行。
    const f = registrationRepo();
    const registry = readFileSync(join(f.cwd, PROMOTION_FILE), 'utf8');
    git(f.cwd, 'checkout', '-q', '-b', 'side', f.base);
    mkdirSync(join(f.cwd, 'deploy/promotion'), { recursive: true });
    writeFileSync(join(f.cwd, PROMOTION_FILE), registry);
    git(f.cwd, 'add', PROMOTION_FILE);
    // side 上的提交说明与 main 上的不同：内容、父提交、时间全同就会得到同一个 SHA，合并就成了空操作。
    git(f.cwd, 'commit', '-q', '-m', 'chore: 在 side 上登记部分晋升窗口 (#70)');
    git(f.cwd, 'checkout', '-q', 'main');
    git(f.cwd, 'merge', '--no-ff', '-q', '-m', 'Merge branch side (#70)', 'side');
    const merge = git(f.cwd, 'rev-parse', 'HEAD');
    expect(git(f.cwd, 'rev-list', '--parents', '-n', '1', merge).split(' ')).toHaveLength(3);
    expect(registrationOf(f.cwd, entryOf(merge, 'Merge branch side (#70)', T0, [f.main, git(f.cwd, 'rev-parse', 'side')]))).toBeNull();
    const result = checkInvariants({ repo: f.cwd, now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.join('\n')).toContain(`${short(merge)}：`);
  });
});

/** main 上只改登记文件的一次提交；registry 是改后的整份登记，committedAt 钉住提交者时间。 */
function registryOnlyCommit(cwd: string, registry: unknown, message: string, committedAt?: number) {
  writeFileSync(join(cwd, PROMOTION_FILE), `${JSON.stringify(registry, null, 2)}\n`);
  git(cwd, 'add', PROMOTION_FILE);
  if (committedAt === undefined) git(cwd, 'commit', '-m', message);
  else gitAt(cwd, committedAt, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

describe('promotion registry is immutable after registration', () => {
  it('registrationOf names the registration and the closing commit, and nothing that rewrites a window', () => {
    const f = registrationRepo({ picks: ({ A }) => [A] });
    expect(registrationOf(f.cwd, entryOf(f.main, 'chore: 登记部分晋升窗口 (#70)', T0, [f.base]))).toEqual({ item: expect.objectContaining({ issue: 70, status: 'open' }), kind: 'registration' });

    const closingMessage = 'chore: 关闭部分晋升窗口 (#70)';
    const closing = registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [promotion({ picks: [f.A], stageBase: f.X, status: 'closed', closedAt: beijing(T0), evidence: '合回 stage 并在线上核对（测试夹具）' })] }, closingMessage);
    const closingEntry = entryOf(closing, closingMessage, T0, [f.main]);
    expect(registrationOf(f.cwd, closingEntry)).toEqual({ item: expect.objectContaining({ issue: 70, status: 'closed' }), kind: 'closing' });
    // 收尾不限提交时间：窗口过期后正要靠收尾提交把它关掉。
    expect(registrationOf(f.cwd, { ...closingEntry, committedAt: T0 + 10 * DAY })).toEqual({ item: expect.objectContaining({ status: 'closed' }), kind: 'closing' });

    // 收尾的同时改了 picks：不是收尾，整次提交不归属。
    const g = registrationRepo({ picks: ({ A }) => [A] });
    const sneakyMessage = 'chore: 关闭部分晋升窗口 (#70)';
    const sneaky = registryOnlyCommit(g.cwd, { schemaVersion: 1, windows: [promotion({ picks: [g.A, g.B], stageBase: g.X, status: 'closed', closedAt: beijing(T0), evidence: '合回 stage 并在线上核对（测试夹具）' })] }, sneakyMessage);
    expect(registrationOf(g.cwd, entryOf(sneaky, sneakyMessage, T0, [g.main]))).toBeNull();
  });

  it('a later main-only commit that edits a registered window is not attributed, and check says the registration cannot be changed', () => {
    const cases: [string, (f: { A: string; B: string; X: string }) => Record<string, unknown>][] = [
      ['adds a pick', f => promotion({ picks: [f.A, f.B], stageBase: f.X })],
      ['adds an exclude', f => promotion({ picks: [f.A], stageBase: f.X, excludes: [{ sha: f.B, issue: 71 }] })],
      ['moves expiresAt', f => promotion({ picks: [f.A], stageBase: f.X, expiresAt: beijing(T0 + 2.5 * DAY) })],
      ['rewrites the approval', f => promotion({ picks: [f.A], stageBase: f.X, approval: '这一句不是所有者批准的，是后来改写的' })],
    ];
    for (const [label, edit] of cases) {
      const f = registrationRepo({ picks: ({ A }) => [A] });
      const sha = registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [edit(f)] }, 'chore: 调整晋升窗口 (#70)');
      const result = run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']);
      expect(result.status, label).toBe(1);
      expect(result.stdout, label).toContain(`main 独有提交 ${short(sha)} 不归属任何开着的窗口：`);
      expect(result.stdout, label).toContain('登记后不能改');
    }
  });

  it('attack: a registry-only commit adds a pick to a registered window, and cherry-picking that pick does not pass check', () => {
    const f = registrationRepo({ picks: ({ A }) => [A] });
    registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [promotion({ picks: [f.A, f.B], stageBase: f.X })] }, 'chore: 追加 pick (#70)');
    git(f.cwd, 'cherry-pick', '-x', f.B);
    const result = run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('登记后不能改');
  });

  it('a window altered after registration stops covering every pick, and check names the alteration', () => {
    const f = registrationRepo({ picks: ({ A }) => [A] });
    git(f.cwd, 'cherry-pick', '-x', f.A);
    const cpA = git(f.cwd, 'rev-parse', 'HEAD');
    registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [promotion({ picks: [f.A, f.B], stageBase: f.X })] }, 'chore: 追加 pick (#70)');
    git(f.cwd, 'cherry-pick', '-x', f.B);
    const cpB = git(f.cwd, 'rev-parse', 'HEAD');
    const result = run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    // 登记后改过的窗口整体不可用：登记时就列了的 A 也不再放行，失败一侧收紧。
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`main 独有提交 ${short(cpA)} 不归属任何开着的窗口：cherry-pick 的来源 ${short(f.A)} 在晋升窗口 #70 的 picks 里，但这个窗口现在不放行：晋升窗口 #70 登记之后被改过`);
    expect(result.stdout).toContain(`main 独有提交 ${short(cpB)} 不归属任何开着的窗口`);
    expect(result.stdout).toContain('晋升窗口 #70：开着，但不能用来放行（晋升窗口 #70 登记之后被改过');
  });

  it('a registry edit attributed to an open hotfix window cannot add a pick that a later cherry-pick then uses', () => {
    const f = registrationRepo({ picks: ({ A }) => [A] });
    const hotfix = { issue: 5, tag: 'v1.2.3', status: 'open', approvedBy: '所有者', approvedAt: beijing(T0 - HOUR), expiresAt: beijing(T0 + 2 * DAY), approval: '这是一个必须走 hotfix 的 P0 问题' };
    commitFile(f.cwd, 'deploy/hotfix/windows.json', `${JSON.stringify({ schemaVersion: 1, windows: [hotfix] }, null, 2)}\n`, 'chore: 登记 hotfix 窗口 (#5)');
    git(f.cwd, 'cherry-pick', '-x', f.A);
    const cpA = git(f.cwd, 'rev-parse', 'HEAD');
    // 提交说明引用的是 hotfix #5（在它的窗口内），所以归属 hotfix；但它改的是晋升窗口 #70 的 picks。
    const edit = registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [promotion({ picks: [f.A, f.B], stageBase: f.X })] }, 'chore: 调整晋升窗口的 pick (#5)');
    git(f.cwd, 'cherry-pick', '-x', f.B);
    const cpB = git(f.cwd, 'rev-parse', 'HEAD');
    const result = run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    // hotfix 窗口不放行对晋升登记的改动；改过的窗口整体不可用，A 与 B 都不再放行。
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`main 独有提交 ${short(edit)} 不归属任何开着的窗口：这个提交改了已登记的晋升窗口 #70 的内容`);
    expect(result.stdout).toContain(`main 独有提交 ${short(cpA)} 不归属`);
    expect(result.stdout).toContain(`main 独有提交 ${short(cpB)} 不归属任何开着的窗口`);
  });

  it('a closing commit on main is attributed even though the window is no longer open', () => {
    const f = registrationRepo({ picks: ({ A }) => [A] });
    git(f.cwd, 'cherry-pick', '-x', f.A);
    const closing = registryOnlyCommit(f.cwd, { schemaVersion: 1, windows: [promotion({ picks: [f.A], stageBase: f.X, status: 'closed', closedAt: beijing(T0), evidence: '合回 stage 并在线上核对（测试夹具）' })] }, 'chore: 关闭部分晋升窗口 (#70)');
    const result = run(f.cwd, ['check', '--main', 'main', '--stage', 'stage']);
    // 收尾提交本身放行；窗口关了之后挑来的 A 没有窗口可归属，这是收尾前要先合回 stage 的原因。
    expect(result.stdout).not.toContain(`main 独有提交 ${short(closing)} 不归属`);
    expect(result.stdout).toContain('没有开着的晋升窗口');
  });
});
