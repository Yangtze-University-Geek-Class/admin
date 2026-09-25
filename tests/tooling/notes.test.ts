import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addNote, beijingNow, branchSlug, checkAll, checkChainFile, checkPullRequest, collectChains, checkChainOrder,
  flushPending, mergeEntries, renderIndex, renderSummary,
} from "../../scripts/note.mjs";
import { finishTitle } from "../../scripts/task.mjs";

// scripts/note.mjs：执行记录的写入、索引与核对（docs/conventions/NOTES.md，#91）。全部在临时目录里跑。
const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "geek-notes-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const by = "agent-claude-geek-main-08（Claude Code，claude-opus-5-5）";
const base = { user: "crosery", by, chain: "task/91/agent_notes", issues: ["91"], did: "做了一件事", result: "有结果" };
const at = (iso: string) => new Date(iso);
const writeIndex = (root: string) => writeFileSync(join(root, "notes", "INDEX.md"), renderIndex(root));

describe("北京时间与文件位置", () => {
  it("按 Asia/Shanghai 取日期和时刻，跨过 UTC 零点也对", () => {
    expect(beijingNow(at("2026-09-25T16:11:22Z"))).toEqual({ date: "2026-09-26", time: "00:11:22" });
    expect(beijingNow(at("2026-09-25T15:59:59Z"))).toEqual({ date: "2026-09-25", time: "23:59:59" });
  });

  it("分支名变成链路文件名", () => {
    expect(branchSlug("task/91/agent_notes")).toBe("task_91_agent_notes");
    expect(branchSlug("dev/crosery")).toBe("dev_crosery");
  });
});

describe("addNote", () => {
  it("按 日期/GitHub 用户名/分支 建文件，第一次写标题和负责人，之后往后追加", () => {
    const root = temp();
    const file = addNote(root, { ...base, stage: "开工", title: "建分支", now: at("2026-09-25T16:11:22Z") });
    expect(file).toBe(join(root, "notes/2026-09-26/crosery/task_91_agent_notes.md"));
    addNote(root, { ...base, stage: "提交", issues: ["91", "87"], title: "提交 abc", next: "开 PR", now: at("2026-09-25T16:20:00Z") });
    expect(readFileSync(file, "utf8")).toBe([
      "# task/91/agent_notes · crosery · 2026-09-26",
      "",
      "负责人：crosery",
      "",
      "## 00:11:22 +08:00 · 开工 · #91 · 建分支",
      "",
      `- 执行者：${by}`,
      "- 做了什么：做了一件事",
      "- 结果：有结果",
      "",
      "## 00:20:00 +08:00 · 提交 · #91 #87 · 提交 abc",
      "",
      `- 执行者：${by}`,
      "- 做了什么：做了一件事",
      "- 结果：有结果",
      "- 下一步：开 PR",
      "",
    ].join("\n"));
    writeIndex(root);
    expect(checkAll(root)).toEqual([]);
  });

  it("缺身份、阶段不对、issue 不是数字、必填为空时拒绝写入", () => {
    const root = temp();
    expect(() => addNote(root, { ...base, user: "Crosery Yu", stage: "开工", title: "x" })).toThrow(/GEEK_NOTES_USER/);
    expect(() => addNote(root, { ...base, by: "Claude", stage: "开工", title: "x" })).toThrow(/GEEK_NOTES_BY/);
    expect(() => addNote(root, { ...base, stage: "开发中", title: "x" })).toThrow(/--stage/);
    expect(() => addNote(root, { ...base, issues: ["abc"], stage: "开工", title: "x" })).toThrow(/--issue/);
    expect(() => addNote(root, { ...base, stage: "开工", title: "x", did: " " })).toThrow(/--did/);
  });

  it("过了北京时间零点写进新的日期目录，同一条链路跨两个文件", () => {
    const root = temp();
    addNote(root, { ...base, stage: "开工", title: "a", now: at("2026-09-25T15:50:00Z") });
    addNote(root, { ...base, stage: "提交", title: "b", now: at("2026-09-25T16:10:00Z") });
    const chain = collectChains(root).get("crosery/task_91_agent_notes");
    expect(chain.files.map((file: { date: string }) => file.date)).toEqual(["2026-09-25", "2026-09-26"]);
    expect(checkChainOrder(chain)).toEqual([]);
  });
});

describe("核对", () => {
  const rel = "notes/2026-09-26/crosery/task_91_agent_notes.md";
  const good = `# task/91/agent_notes · crosery · 2026-09-26\n\n负责人：crosery\n\n## 09:00:00 +08:00 · 开工 · #91 · 建分支\n\n- 执行者：${by}\n- 做了什么：x\n- 结果：y\n`;

  it("格式对的文件没有问题", () => {
    expect(checkChainFile(rel, good)).toEqual([]);
  });

  it("位置、标题、负责人、执行者写错都报出来", () => {
    expect(checkChainFile("notes/2026-09-26/task_91.md", good)[0]).toMatch(/只能放在/);
    expect(checkChainFile("notes/2026-02-30/crosery/task_91_agent_notes.md", good).join()).toMatch(/不是有效日期/);
    expect(checkChainFile("notes/2026-09-26/Crosery/task_91_agent_notes.md", good).join()).toMatch(/GitHub 用户名/);
    expect(checkChainFile(rel, good.replace("task/91/agent_notes ·", "task/87/exam_docs ·")).join()).toMatch(/分支/);
    expect(checkChainFile(rel, good.replace("负责人：crosery\n", "")).join()).toMatch(/负责人/);
    expect(checkChainFile(rel, good.replace(by, "Claude")).join()).toMatch(/执行者要写成/);
  });

  it("记录标题不是北京时间或阶段不认识、缺字段、时间倒退都报出来", () => {
    expect(checkChainFile(rel, good.replace("09:00:00 +08:00", "09:00 UTC")).join()).toMatch(/HH:MM:SS \+08:00/);
    expect(checkChainFile(rel, good.replace("· 开工 ·", "· 写代码 ·")).join()).toMatch(/阶段是/);
    expect(checkChainFile(rel, good.replace("- 结果：y\n", "")).join()).toMatch(/缺少「- 结果：」/);
    expect(checkChainFile(rel, good.replace("- 结果：y", "- 结果：")).join()).toMatch(/不能是空的/);
    expect(checkChainFile(rel, `${good}\n## 08:00:00 +08:00 · 提交 · #91 · 补\n\n- 执行者：${by}\n- 做了什么：x\n- 结果：y\n`).join()).toMatch(/早于上一条/);
  });

  it("链路第一条不是开工、收尾之后还有记录、索引过期都报出来", () => {
    const root = temp();
    addNote(root, { ...base, stage: "开发", title: "没开工就写", now: at("2026-09-25T16:00:00Z") });
    writeIndex(root);
    expect(checkAll(root).join()).toMatch(/第一条必须是「开工」/);

    const closed = temp();
    addNote(closed, { ...base, stage: "开工", title: "a", now: at("2026-09-25T16:00:00Z") });
    addNote(closed, { ...base, stage: "收尾", title: "b", now: at("2026-09-25T16:05:00Z") });
    addNote(closed, { ...base, stage: "开发", title: "c", now: at("2026-09-25T16:06:00Z") });
    writeIndex(closed);
    expect(checkAll(closed).join()).toMatch(/已经收尾/);

    const stale = temp();
    addNote(stale, { ...base, stage: "开工", title: "a", now: at("2026-09-25T16:00:00Z") });
    expect(checkAll(stale).join()).toMatch(/INDEX\.md 不是最新的/);
  });

  it("stage、main 上的发布与验收记录不要求以开工开始", () => {
    const root = temp();
    addNote(root, { ...base, chain: "stage", issues: ["87", "91"], stage: "发布", title: "打 v0.1.0-rc.6", now: at("2026-09-25T17:00:00Z") });
    addNote(root, { ...base, chain: "main", issues: [], stage: "验收", title: "正式环境验收", now: at("2026-09-25T17:30:00Z") });
    writeIndex(root);
    expect(checkAll(root)).toEqual([]);
  });
});

describe("索引与一览表", () => {
  it("INDEX.md 按日期倒序列出每个人的目录；一览表列出每条链路的执行者和最后一条", () => {
    const root = temp();
    addNote(root, { ...base, stage: "开工", title: "a", now: at("2026-09-24T02:00:00Z") });
    addNote(root, { ...base, user: "someone", chain: "task/92/other", issues: ["92"], by: "human-someone", stage: "开工", title: "b", now: at("2026-09-25T16:00:00Z") });
    addNote(root, { ...base, stage: "PR", title: "开 PR", now: at("2026-09-25T16:30:00Z") });
    const index = renderIndex(root);
    expect(index).toContain("- 2026-09-26：[crosery](2026-09-26/crosery/)、[someone](2026-09-26/someone/)");
    expect(index.indexOf("2026-09-26")).toBeLessThan(index.indexOf("2026-09-24："));
    const summary = renderSummary(root);
    expect(summary).toContain("| crosery | task/91/agent_notes | #91 | agent-claude-geek-main-08 | 2 | 2026-09-24 10:00:00 | PR（2026-09-26 00:30:00） |");
    expect(summary).toContain("| someone | task/92/other | #92 | human-someone | 1 |");
  });
});

describe("暂存与并入", () => {
  it("task 分支之外写的记录暂存后并进 task worktree，按文件追加，暂存清空", () => {
    const pending = temp();
    const worktree = temp();
    addNote(worktree, { ...base, chain: "task/87/exam_docs", issues: ["87"], stage: "开工", title: "a", now: at("2026-09-25T16:00:00Z") });
    addNote(pending, { ...base, chain: "task/87/exam_docs", issues: ["87"], stage: "合并", title: "PR #89 合并", now: at("2026-09-25T16:10:00Z") });
    addNote(pending, { ...base, chain: "task/87/exam_docs", issues: ["87"], stage: "收尾", title: "清理", now: at("2026-09-25T16:11:00Z") });
    expect(flushPending(pending, worktree)).toEqual(["notes/2026-09-26/crosery/task_87_exam_docs.md"]);
    expect(existsSync(join(pending, "notes"))).toBe(false);
    const chain = collectChains(worktree).get("crosery/task_87_exam_docs");
    expect(chain.files[0].entries.map((entry: { stage: string }) => entry.stage)).toEqual(["开工", "合并", "收尾"]);
    writeIndex(worktree);
    expect(checkAll(worktree)).toEqual([]);
  });
});

describe("checkPullRequest", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
  const repo = () => {
    const root = temp();
    git(root, "init", "-q", "-b", "stage");
    git(root, "config", "user.email", "ci@example.test");
    git(root, "config", "user.name", "CI");
    writeFileSync(join(root, "README.md"), "x\n");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "base");
    git(root, "checkout", "-q", "-b", "task/91/agent_notes");
    return root;
  };
  const record = (root: string, stage: string, minute: number, issues = ["91"]) =>
    addNote(root, { ...base, issues, stage, title: stage, now: at(`2026-09-25T16:${String(minute).padStart(2, "0")}:00Z`) });
  const commit = (root: string) => {
    writeIndex(root);
    git(root, "add", ".");
    git(root, "commit", "-qm", "notes");
  };
  const pr = (root: string) => checkPullRequest(root, { base: "stage", head: "task/91/agent_notes" }).join("\n");

  it("没有链路时失败，并说明开工会写第一条", () => {
    const root = repo();
    expect(pr(root)).toMatch(/没有 task\/91\/agent_notes 的执行链路/);
  });

  it("缺开工、提交、PR、审查中的任何一步都失败，并给出写法；四步都有就通过", () => {
    const root = repo();
    record(root, "开工", 0);
    record(root, "提交", 5);
    commit(root);
    const missing = pr(root);
    expect(missing).toMatch(/「PR」/);
    expect(missing).toMatch(/「审查」/);
    expect(missing).toContain("node scripts/note.mjs add --stage PR --issue 91");
    record(root, "PR", 10);
    record(root, "审查", 20);
    commit(root);
    expect(pr(root)).toBe("");
  });

  it("只引用别的 issue 的记录不算", () => {
    const root = repo();
    for (const [stage, minute] of [["开工", 0], ["提交", 1], ["PR", 2], ["审查", 3]] as const) record(root, stage, minute, ["87"]);
    commit(root);
    expect(pr(root)).toMatch(/「开工」/);
  });

  it("不是 task 分支（例如 stage 进 main）时不要求", () => {
    const root = repo();
    expect(checkPullRequest(root, { base: "stage", head: "stage" })).toEqual([]);
  });

  it("审查模式（forReview: true）允许暂缺「审查」记录", () => {
    const root = repo();
    record(root, "开工", 0);
    record(root, "提交", 5);
    record(root, "PR", 10);
    commit(root);
    expect(checkPullRequest(root, { base: "stage", head: "task/91/agent_notes", forReview: true })).toEqual([]);
  });

  it("修改或删除已有记录时拒绝通过（只能追加）", () => {
    const root = repo();
    record(root, "开工", 0);
    record(root, "提交", 5);
    record(root, "PR", 10);
    record(root, "审查", 20);
    commit(root);
    // 把分支切回 stage，合并这个提交，模拟已有记录进入 base
    git(root, "checkout", "-q", "stage");
    git(root, "merge", "-q", "task/91/agent_notes");
    git(root, "checkout", "-q", "task/91/agent_notes");

    // 尝试篡改已有记录内容
    const chainPath = join(root, "notes/2026-09-26/crosery/task_91_agent_notes.md");
    const original = readFileSync(chainPath, "utf8");
    writeFileSync(chainPath, original.replace("有结果", "篡改的结果"));
    // 追加一条新记录以满足新增记录检查
    record(root, "返工", 30);
    commit(root);

    const problems = checkPullRequest(root, { base: "stage", head: "task/91/agent_notes" });
    expect(problems.join("\n")).toMatch(/发现删除或修改已有记录的行/);
  });
});

describe("mergeEntries 与 finishTitle", () => {
  it("mergeEntries 按时间排序并去重", () => {
    const dir = temp();
    const file = join(dir, "notes/2026-09-26/crosery/test.md");
    const meta = { date: "2026-09-26", user: "crosery", chain: "task/1/test" };
    const b1 = "## 10:00:00 +08:00 · 开工 · #1 · 开工\n\n- 执行者：human-crosery\n- 做了什么：x\n- 结果：y\n";
    const b2 = "## 09:00:00 +08:00 · 方案 · #1 · 早期方案\n\n- 执行者：human-crosery\n- 做了什么：x\n- 结果：y\n";
    mergeEntries(file, meta, [b1, b2, b1]);
    const text = readFileSync(file, "utf8");
    expect(text.indexOf("09:00:00")).toBeLessThan(text.indexOf("10:00:00"));
    expect(text.split("## 10:00:00").length).toBe(2); // 仅出现一次，已去重
  });

  it("finishTitle 准确反映 PR 状态", () => {
    expect(finishTitle({ state: "MERGED", number: 42 }, 1)).toBe("PR #42 已合并，清理 worktree");
    expect(finishTitle({ state: "CLOSED", number: 42 }, 1)).toBe("PR #42 已关闭未合并，放弃，清理 worktree");
    expect(finishTitle(null, 1)).toBe("放弃，清理 worktree");
  });
});
