import { describe, expect, it } from "vitest";
import { decideCleanup, issueOfBranch, parseWorktrees, taskBranch, worktreePath } from "../../scripts/task.mjs";

describe("task worktree", () => {
  it("分支名与 worktree 路径：一个 issue 一个", () => {
    expect(taskBranch(35, "task_worktree")).toBe("task/35/task_worktree");
    expect(() => taskBranch(35, "task-worktree")).toThrow(/不用 -/);
    expect(() => taskBranch("abc", "x")).toThrow(/数字/);
    expect(worktreePath("/repo", 35)).toBe("/repo/.claude/worktrees/task-35");
    expect(issueOfBranch("task/35/task_worktree")).toBe(35);
    expect(issueOfBranch("dev/crosery")).toBeNull();
  });

  it("解析 git worktree list --porcelain，含 detached 与主工作区", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD 882435e",
      "branch refs/heads/dev/crosery",
      "",
      "worktree /repo/.claude/worktrees/task-35",
      "HEAD 77160aa",
      "branch refs/heads/task/35/task_worktree",
      "",
      "worktree /repo/.claude/worktrees/preview",
      "HEAD b979f9c",
      "detached",
      "",
    ].join("\n");
    const list = parseWorktrees(porcelain);
    expect(list.map((wt: { branch: string | null }) => wt.branch)).toEqual(["dev/crosery", "task/35/task_worktree", null]);
    expect(list[2].detached).toBe(true);
  });

  it("能不能清理：只有 PR 已合并或 issue 已放弃、且工作区干净时才清", () => {
    expect(decideCleanup({ dirty: false, issueState: "CLOSED", prState: "MERGED" }).ok).toBe(true);
    expect(decideCleanup({ dirty: false, issueState: "OPEN", prState: "MERGED" }).ok).toBe(true); // 合并了但 issue 没关：清 worktree，issue 交给巡检
    expect(decideCleanup({ dirty: true, issueState: "CLOSED", prState: "MERGED" })).toMatchObject({ ok: false, reason: expect.stringContaining("未提交") });
    expect(decideCleanup({ dirty: false, issueState: "OPEN", prState: "OPEN" }).ok).toBe(false);
    expect(decideCleanup({ dirty: false, issueState: "OPEN", prState: null }).ok).toBe(false);
    expect(decideCleanup({ dirty: false, issueState: "CLOSED", prState: null })).toMatchObject({ ok: true, reason: expect.stringContaining("放弃") });
    expect(decideCleanup({ dirty: false, issueState: "OPEN", prState: "CLOSED" }).ok).toBe(false);
    expect(decideCleanup({ dirty: false, issueState: null, prState: null }).ok).toBe(false); // 查不到就不删
  });
});
