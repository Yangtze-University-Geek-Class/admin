import { describe, expect, it } from "vitest";
import { checksVerdict, main, planSync, runSync } from "../../scripts/github-mirror-sync.mjs";

/** 假 git：只记录调用；祖先关系与文件树由用例给定。推送与合并的效果由用例自己更新指向。 */
function fakeGit(init: { refs: Record<string, string>; trees: Record<string, string>; ancestors?: string[] }) {
  const state = { refs: { ...init.refs }, trees: { ...init.trees }, ancestors: new Set(init.ancestors ?? []), fetches: [] as string[], pushes: [] as string[] };
  return {
    state,
    fetch(remote: string, branch: string) { state.fetches.push(`${remote}/${branch}`); },
    revParse(ref: string) { const sha = state.refs[ref]; if (!sha) throw new Error(`没有引用 ${ref}`); return sha; },
    treeOf(sha: string) { return state.trees[sha]; },
    isAncestor(a: string, b: string) { return a === b || state.ancestors.has(`${a}>${b}`); },
    push(remote: string, refspec: string) { state.pushes.push(`${remote} ${refspec}`); },
  };
}

/** 假 gh：checks 按顺序给结论（最后一个重复），merge 时调用 onMerge 模拟 GitHub 合并后的指向 */
function fakeGh(init: { openPr?: number | null; checks?: { name: string; bucket: string }[][]; onMerge?: () => void } = {}) {
  const state = { created: [] as { head: string; base: string }[], merged: [] as { number: number; headSha: string }[], checkCalls: 0 };
  const sequence = [...(init.checks ?? [[{ name: "verify", bucket: "pass" }]])];
  return {
    state,
    findOpenPr: () => init.openPr ?? null,
    createPr: ({ head, base }: { head: string; base: string }) => { state.created.push({ head, base }); return 9; },
    checks: () => { state.checkCalls += 1; return sequence.length > 1 ? sequence.shift()! : sequence[0]; },
    mergePr: ({ number, headSha }: { number: number; headSha: string }) => { state.merged.push({ number, headSha }); init.onMerge?.(); },
  };
}

const noSleep = async () => {};
const base = { primary: "gitlab", mirror: "origin", issue: "330", sleep: noSleep, pollMs: 0 };

describe("GitHub 镜像自动同步：只靠祖先关系与检查结论决定动作", () => {
  it("GitHub 落后：推同步分支、开 PR、检查通过后合并，再把 GitLab 快进到合并后的提交", async () => {
    const git = fakeGit({ refs: { "gitlab/stage": "L", "origin/stage": "G" }, trees: { L: "treeL", G: "treeG", N: "treeL" }, ancestors: ["G>L"] });
    const gh = fakeGh({ onMerge: () => { git.state.refs["origin/stage"] = "N"; git.state.ancestors.add("L>N"); } });
    const result = await runSync({ ...base, branch: "stage", git, gh });
    expect(result).toEqual({ status: "synced", pr: 9, head: "N" });
    expect(gh.state.created).toEqual([{ head: "task/330/github_stage_sync", base: "stage" }]);
    expect(gh.state.merged).toEqual([{ number: 9, headSha: "L" }]);
    expect(git.state.pushes).toEqual(["origin L:refs/heads/task/330/github_stage_sync", "gitlab N:refs/heads/stage"]);
  });

  it("同步 PR 已经开着：复用它，不重复开，合并的仍是同一个 PR", async () => {
    const git = fakeGit({ refs: { "gitlab/stage": "L", "origin/stage": "G" }, trees: { L: "treeL", G: "treeG", N: "treeL" }, ancestors: ["G>L"] });
    const gh = fakeGh({ openPr: 7, onMerge: () => { git.state.refs["origin/stage"] = "L"; } });
    const result = await runSync({ ...base, branch: "stage", git, gh });
    expect(result).toMatchObject({ status: "synced", pr: 7 });
    expect(gh.state.created).toEqual([]);
    expect(gh.state.merged).toEqual([{ number: 7, headSha: "L" }]);
    expect(git.state.pushes).toEqual(["origin L:refs/heads/task/330/github_stage_sync"]);
  });

  it("必需检查失败：不合并，GitLab 一个字都不动", async () => {
    const git = fakeGit({ refs: { "gitlab/stage": "L", "origin/stage": "G" }, trees: { L: "treeL", G: "treeG" }, ancestors: ["G>L"] });
    const gh = fakeGh({ checks: [[{ name: "verify", bucket: "pass" }, { name: "architecture-alignment", bucket: "fail" }]] });
    const result = await runSync({ ...base, branch: "stage", git, gh });
    expect(result).toMatchObject({ status: "ci-failed", pr: 9 });
    expect(gh.state.merged).toEqual([]);
    expect(git.state.pushes).toEqual(["origin L:refs/heads/task/330/github_stage_sync"]);
  });

  it("检查先进行中、之后通过：一直等到结论，再合并", async () => {
    const git = fakeGit({ refs: { "gitlab/stage": "L", "origin/stage": "G" }, trees: { L: "treeL", G: "treeG", N: "treeL" }, ancestors: ["G>L"] });
    const gh = fakeGh({ checks: [[{ name: "verify", bucket: "pending" }], [{ name: "verify", bucket: "pass" }]], onMerge: () => { git.state.refs["origin/stage"] = "N"; git.state.ancestors.add("L>N"); } });
    const result = await runSync({ ...base, branch: "stage", git, gh });
    expect(result.status).toBe("synced");
    expect(gh.state.checkCalls).toBe(2);
  });

  it("检查一直没有结论：超时，不合并", async () => {
    const git = fakeGit({ refs: { "gitlab/stage": "L", "origin/stage": "G" }, trees: { L: "treeL", G: "treeG" }, ancestors: ["G>L"] });
    const gh = fakeGh({ checks: [[{ name: "verify", bucket: "pending" }]] });
    const result = await runSync({ ...base, branch: "stage", git, gh, polls: 3 });
    expect(result).toMatchObject({ status: "timeout", pr: 9 });
    expect(gh.state.checkCalls).toBe(3);
    expect(gh.state.merged).toEqual([]);
  });

  it("分叉：拒绝，不推任何东西，不开 PR", async () => {
    const git = fakeGit({ refs: { "gitlab/stage": "L", "origin/stage": "G" }, trees: { L: "treeL", G: "treeG" } });
    const gh = fakeGh();
    const result = await runSync({ ...base, branch: "stage", git, gh });
    expect(result).toMatchObject({ status: "refused" });
    expect(result.reason).toContain("分叉");
    expect(git.state.pushes).toEqual([]);
    expect(gh.state.created).toEqual([]);
  });

  it("GitHub 已在前面（PR 合并了，GitLab 没追上）：只快进 GitLab，树不一致就拒绝", async () => {
    const git = fakeGit({ refs: { "gitlab/stage": "L", "origin/stage": "N" }, trees: { L: "treeL", N: "treeL" }, ancestors: ["L>N"] });
    const result = await runSync({ ...base, branch: "stage", git, gh: fakeGh() });
    expect(result).toEqual({ status: "primary-fast-forwarded", head: "N" });
    expect(git.state.pushes).toEqual(["gitlab N:refs/heads/stage"]);
    const mismatch = fakeGit({ refs: { "gitlab/stage": "L", "origin/stage": "N" }, trees: { L: "treeL", N: "treeX" }, ancestors: ["L>N"] });
    expect(await runSync({ ...base, branch: "stage", git: mismatch, gh: fakeGh() })).toMatchObject({ status: "refused" });
    expect(mismatch.state.pushes).toEqual([]);
  });

  it("两边同一提交：什么也不做", async () => {
    const git = fakeGit({ refs: { "gitlab/stage": "L", "origin/stage": "L" }, trees: { L: "treeL" } });
    expect(await runSync({ ...base, branch: "stage", git, gh: fakeGh() })).toEqual({ status: "same" });
    expect(git.state.pushes).toEqual([]);
  });

  it("main 只有在 stage 已包含它时才同步；没包含就拒绝，不推任何东西", async () => {
    const refs = { "gitlab/main": "M", "origin/main": "H", "gitlab/stage": "S", "origin/stage": "G" };
    const notYet = fakeGit({ refs, trees: { M: "treeM", H: "treeH", S: "treeS", G: "treeG" }, ancestors: ["H>M"] });
    expect(await runSync({ ...base, branch: "main", git: notYet, gh: fakeGh() })).toMatchObject({ status: "refused" });
    expect(notYet.state.pushes).toEqual([]);
    const included = fakeGit({ refs: { ...refs, "origin/main": "H" }, trees: { M: "treeM", H: "treeH", S: "treeS", G: "treeG", N: "treeM" }, ancestors: ["H>M", "M>S"] });
    const gh = fakeGh({ onMerge: () => { included.state.refs["origin/main"] = "N"; included.state.ancestors.add("M>N"); } });
    expect(await runSync({ ...base, branch: "main", git: included, gh })).toMatchObject({ status: "synced" });
    expect(gh.state.created).toEqual([{ head: "task/330/github_main_sync", base: "main" }]);
  });
});

describe("判定与命令行", () => {
  it("检查结论：没有检查时等待；有失败就失败；全部通过（跳过也算）才通过", () => {
    expect(checksVerdict([])).toBe("pending");
    expect(checksVerdict([{ name: "a", bucket: "pass" }, { name: "b", bucket: "fail" }])).toBe("fail");
    expect(checksVerdict([{ name: "a", bucket: "pass" }, { name: "b", bucket: "skipping" }])).toBe("pass");
    expect(checksVerdict([{ name: "a", bucket: "pending" }])).toBe("pending");
  });
  it("planSync 只看祖先关系：分叉给出 refuse", () => {
    expect(planSync({ primary: "A", mirror: "A", isAncestor: () => false }).action).toBe("none");
    expect(planSync({ primary: "A", mirror: "B", isAncestor: () => false }).action).toBe("refuse");
  });
  it("用法错误返回 2；分支与工单号都要校验", async () => {
    const errors: string[] = [];
    expect(await main(["--branch", "stage"], { err: line => errors.push(line) })).toBe(2);
    expect(await main(["--branch", "release", "--issue", "330"], { err: line => errors.push(line) })).toBe(2);
    expect(await main(["--branch", "stage", "--issue", "x"], { err: line => errors.push(line) })).toBe(2);
    expect(errors.length).toBe(3);
  });
  it("命令行跑一次同步，结论写出来，退出码按结论给", async () => {
    const lines: string[] = [];
    const git = fakeGit({ refs: { "gitlab/stage": "L", "origin/stage": "G" }, trees: { L: "treeL", G: "treeG" } });
    const code = await main(["--branch", "stage", "--issue", "330", "--repo", "owner/repo"], { root: "/nonexistent", git, gh: fakeGh(), out: line => lines.push(line) });
    expect(code).toBe(1);
    expect(lines[0]).toContain("refused");
  });
});
