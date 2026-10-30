import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addNote, beijingNow, branchSlug, checkAll, checkChainFile, checkPullRequest, collectChains, checkChainOrder,
  flushPending, isRedactionRevision, mergeEntries, record as recordNote, renderIndex, renderSummary, REDACTED,
  CHAIN_ORDER_EXCEPTIONS,
} from "../../scripts/note.mjs";
import { finishTitle } from "../../scripts/task.mjs";

// 历史例外登记的真实笔记目录（notes/<日期>/<用户名>/），测试从登记表取用户名，不写死账号名
const noteUser = CHAIN_ORDER_EXCEPTIONS.find(item => item.slug === "task_276_forum_image_scan")!.rel.split("/")[2];

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
const base = { user: "alice", by, chain: "task/91/agent_notes", issues: ["91"], did: "做了一件事", result: "有结果" };
const at = (iso: string) => new Date(iso);
const writeIndex = (root: string) => writeFileSync(join(root, "notes", "INDEX.md"), renderIndex(root));

describe("北京时间与文件位置", () => {
  it("按 Asia/Shanghai 取日期和时刻，跨过 UTC 零点也对", () => {
    expect(beijingNow(at("2026-09-25T16:11:22Z"))).toEqual({ date: "2026-09-26", time: "00:11:22" });
    expect(beijingNow(at("2026-09-25T15:59:59Z"))).toEqual({ date: "2026-09-25", time: "23:59:59" });
  });

  it("分支名变成链路文件名", () => {
    expect(branchSlug("task/91/agent_notes")).toBe("task_91_agent_notes");
    expect(branchSlug("dev/alice")).toBe("dev_alice");
  });
});

describe("addNote", () => {
  it("按 日期/GitHub 用户名/分支 建文件，第一次写标题和负责人，之后往后追加", () => {
    const root = temp();
    const file = addNote(root, { ...base, stage: "开工", title: "建分支", now: at("2026-09-25T16:11:22Z") });
    expect(file).toBe(join(root, "notes/2026-09-26/alice/task_91_agent_notes.md"));
    addNote(root, { ...base, stage: "提交", issues: ["91", "87"], title: "提交 abc", next: "开 PR", now: at("2026-09-25T16:20:00Z") });
    expect(readFileSync(file, "utf8")).toBe([
      "# task/91/agent_notes · alice · 2026-09-26",
      "",
      "负责人：alice",
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
    expect(() => addNote(root, { ...base, user: "Alice Yu", stage: "开工", title: "x" })).toThrow(/GEEK_NOTES_USER/);
    expect(() => addNote(root, { ...base, by: "Claude", stage: "开工", title: "x" })).toThrow(/GEEK_NOTES_BY/);
    expect(() => addNote(root, { ...base, stage: "开发中", title: "x" })).toThrow(/--stage/);
    expect(() => addNote(root, { ...base, issues: ["abc"], stage: "开工", title: "x" })).toThrow(/--issue/);
    expect(() => addNote(root, { ...base, stage: "开工", title: "x", did: " " })).toThrow(/--did/);
  });

  it("过了北京时间零点写进新的日期目录，同一条链路跨两个文件", () => {
    const root = temp();
    addNote(root, { ...base, stage: "开工", title: "a", now: at("2026-09-25T15:50:00Z") });
    addNote(root, { ...base, stage: "提交", title: "b", now: at("2026-09-25T16:10:00Z") });
    const chain = collectChains(root).get("alice/task_91_agent_notes");
    expect(chain.files.map((file: { date: string }) => file.date)).toEqual(["2026-09-25", "2026-09-26"]);
    expect(checkChainOrder(chain)).toEqual([]);
  });
});

describe("核对", () => {
  const rel = "notes/2026-09-26/alice/task_91_agent_notes.md";
  const good = `# task/91/agent_notes · alice · 2026-09-26\n\n负责人：alice\n\n## 09:00:00 +08:00 · 开工 · #91 · 建分支\n\n- 执行者：${by}\n- 做了什么：x\n- 结果：y\n`;

  it("格式对的文件没有问题", () => {
    expect(checkChainFile(rel, good)).toEqual([]);
  });

  it("位置、标题、负责人、执行者写错都报出来", () => {
    expect(checkChainFile("notes/2026-09-26/task_91.md", good)[0]).toMatch(/只能放在/);
    expect(checkChainFile("notes/2026-02-30/alice/task_91_agent_notes.md", good).join()).toMatch(/不是有效日期/);
    expect(checkChainFile("notes/2026-09-26/Alice/task_91_agent_notes.md", good).join()).toMatch(/GitHub 用户名/);
    expect(checkChainFile(rel, good.replace("task/91/agent_notes ·", "task/87/exam_docs ·")).join()).toMatch(/分支/);
    expect(checkChainFile(rel, good.replace("负责人：alice\n", "")).join()).toMatch(/负责人/);
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

  describe("收尾之后又记的历史例外（GitLab #298）", () => {
    const history = { ...base, user: noteUser, chain: "task/276/forum_image_scan", issues: ["276"] };
    const seed = (extra?: (root: string) => void) => {
      const root = temp();
      addNote(root, { ...history, stage: "开工", title: "开工", now: at("2026-10-24T13:48:13Z") });
      addNote(root, { ...history, stage: "收尾", title: "收尾", now: at("2026-10-24T13:52:18Z") });
      addNote(root, { ...history, stage: "发布", title: "发布", now: at("2026-10-24T14:03:16Z") });
      extra?.(root);
      return root;
    };

    it("只放过 task_276_forum_image_scan 在 2026-10-24 22:03:16 的那一条发布", () => {
      expect(checkChainOrder(collectChains(seed()).get(`${noteUser}/task_276_forum_image_scan`))).toEqual([]);
    });

    it("同一链上之后再追加任何记录仍然报错", () => {
      const root = seed(r => addNote(r, { ...history, stage: "验收", title: "验收", now: at("2026-10-24T14:10:00Z") }));
      expect(checkChainOrder(collectChains(root).get(`${noteUser}/task_276_forum_image_scan`)).join()).toMatch(/已经收尾/);
    });

    it("同一链上时间或阶段不同的收尾后记录仍然报错", () => {
      const root = temp();
      addNote(root, { ...history, stage: "开工", title: "开工", now: at("2026-10-24T13:48:13Z") });
      addNote(root, { ...history, stage: "收尾", title: "收尾", now: at("2026-10-24T13:52:18Z") });
      addNote(root, { ...history, stage: "发布", title: "发布", now: at("2026-10-24T14:03:17Z") });
      expect(checkChainOrder(collectChains(root).get(`${noteUser}/task_276_forum_image_scan`)).join()).toMatch(/已经收尾/);
      const other = temp();
      addNote(other, { ...history, stage: "开工", title: "开工", now: at("2026-10-24T13:48:13Z") });
      addNote(other, { ...history, stage: "收尾", title: "收尾", now: at("2026-10-24T13:52:18Z") });
      addNote(other, { ...history, stage: "验收", title: "验收", now: at("2026-10-24T14:03:16Z") });
      expect(checkChainOrder(collectChains(other).get(`${noteUser}/task_276_forum_image_scan`)).join()).toMatch(/已经收尾/);
    });

    it("别的链路出现同样的收尾后发布仍然报错", () => {
      const root = temp();
      const other = { ...history, chain: "task/277/other_task", issues: ["277"] };
      addNote(root, { ...other, stage: "开工", title: "开工", now: at("2026-10-24T13:48:13Z") });
      addNote(root, { ...other, stage: "收尾", title: "收尾", now: at("2026-10-24T13:52:18Z") });
      addNote(root, { ...other, stage: "发布", title: "发布", now: at("2026-10-24T14:03:16Z") });
      expect(checkChainOrder(collectChains(root).get(`${noteUser}/task_277_other_task`)).join()).toMatch(/已经收尾/);
    });
  });

  describe("第一条不是开工的历史例外（GitLab #308）", () => {
    const stageClose = { ...base, user: noteUser, chain: "task/308/stage_close", issues: ["308"] };
    const seed = (iso: string, stage: string) => {
      const root = temp();
      addNote(root, { ...stageClose, stage, title: "关闭 #310/#311 hotfix 窗口登记", now: at(iso) });
      return root;
    };
    const chainKey = `${noteUser}/task_308_stage_close`;

    it("只放过 task_308_stage_close 在 2026-10-29 23:51:18 的那一条推送", () => {
      expect(checkChainOrder(collectChains(seed("2026-10-29T15:51:18Z", "推送")).get(chainKey))).toEqual([]);
    });

    it("同一链路时间不同或阶段不同仍然报错", () => {
      expect(checkChainOrder(collectChains(seed("2026-10-29T15:51:19Z", "推送")).get(chainKey)).join()).toMatch(/第一条必须是「开工」/);
      expect(checkChainOrder(collectChains(seed("2026-10-29T15:51:18Z", "发布")).get(chainKey)).join()).toMatch(/第一条必须是「开工」/);
    });

    it("别的链路出现同样时刻和阶段的第一条仍然报错", () => {
      const root = temp();
      addNote(root, { ...stageClose, chain: "task/309/other_task", issues: ["309"], stage: "推送", title: "关闭 #310/#311 hotfix 窗口登记", now: at("2026-10-29T15:51:18Z") });
      expect(checkChainOrder(collectChains(root).get(`${noteUser}/task_309_other_task`)).join()).toMatch(/第一条必须是「开工」/);
    });

    it("规则不同不放过：收尾之后的那条推送不算第一条例外，仍然报错", () => {
      const root = temp();
      addNote(root, { ...stageClose, stage: "开工", title: "开工", now: at("2026-10-29T10:00:00Z") });
      addNote(root, { ...stageClose, stage: "收尾", title: "收尾", now: at("2026-10-29T11:00:00Z") });
      addNote(root, { ...stageClose, stage: "推送", title: "关闭 #310/#311 hotfix 窗口登记", now: at("2026-10-29T15:51:18Z") });
      expect(checkChainOrder(collectChains(root).get(chainKey)).join()).toMatch(/已经收尾/);
    });

    it("第一条例外只按 first_entry 规则放过，不放过 276 那一条的收尾后发布", () => {
      const root = temp();
      addNote(root, { ...stageClose, chain: "task/276/forum_image_scan", issues: ["276"], stage: "发布", title: "发布", now: at("2026-10-24T14:03:16Z") });
      expect(checkChainOrder(collectChains(root).get(`${noteUser}/task_276_forum_image_scan`)).join()).toMatch(/第一条必须是「开工」/);
    });
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
    expect(index).toContain("- 2026-09-26：[alice](2026-09-26/alice/)、[someone](2026-09-26/someone/)");
    expect(index.indexOf("2026-09-26")).toBeLessThan(index.indexOf("2026-09-24："));
    const summary = renderSummary(root);
    expect(summary).toContain("| alice | task/91/agent_notes | #91 | agent-claude-geek-main-08 | 2 | 2026-09-24 10:00:00 | PR（2026-09-26 00:30:00） |");
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
    expect(flushPending(pending, worktree)).toEqual(["notes/2026-09-26/alice/task_87_exam_docs.md"]);
    expect(existsSync(join(pending, "notes"))).toBe(false);
    const chain = collectChains(worktree).get("alice/task_87_exam_docs");
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

  it("detached HEAD 或缺少任务分支名时拒绝空过，显式任务分支仍检查链路", () => {
    const root = repo();
    git(root, "checkout", "--detach", "-q");
    for (const head of ["HEAD", "", git(root, "rev-parse", "HEAD").trim()]) {
      expect(checkPullRequest(root, { base: "stage", head, forReview: true }).join()).toMatch(/--head.*task\//);
    }
    expect(pr(root)).toMatch(/没有 task\/91\/agent_notes 的执行链路/);
  });

  it("零提交 task 的记录直接写入自己的 worktree，并更新索引", () => {
    const root = repo();
    git(root, "update-ref", "refs/remotes/origin/stage", "stage");
    git(root, "checkout", "-q", "stage");
    const worktree = join(root, ".claude/worktrees/task-91");
    git(root, "worktree", "add", "--quiet", worktree, base.chain);
    const result = recordNote(worktree, { ...base, stage: "开工", title: "新任务" });
    expect(result.here).toBe(true);
    expect(result.file).toContain(join(worktree, "notes"));
    expect(checkAll(worktree)).toEqual([]);
    expect(existsSync(join(root, ".claude/notes-pending"))).toBe(false);
  });

  it.each(["合并", "发布", "验收", "收尾"])("%s 记录仍暂存，不修改 task worktree", (stage) => {
    const root = repo();
    const result = recordNote(root, { ...base, stage, title: stage });
    expect(result.here).toBe(false);
    expect(result.file).toContain(join(root, ".claude/notes-pending/notes"));
    expect(existsSync(join(root, "notes"))).toBe(false);
  });

  it("非 task 分支上的记录仍暂存", () => {
    const root = repo();
    git(root, "checkout", "-q", "stage");
    git(root, "update-ref", "refs/remotes/origin/stage", "stage");
    const result = recordNote(root, { ...base, chain: "stage", stage: "方案", title: "运维方案" });
    expect(result.here).toBe(false);
    expect(existsSync(join(root, "notes"))).toBe(false);
  });

  it.each([false, true])("任务合入 stage 后继续暂存（squash=%s）", (squash) => {
    const root = repo();
    record(root, "开工", 0);
    record(root, "提交", 1);
    commit(root);
    git(root, "checkout", "-q", "stage");
    if (squash) {
      git(root, "merge", "--squash", "task/91/agent_notes");
      git(root, "commit", "-qm", "squash task");
    } else {
      git(root, "merge", "--ff-only", "task/91/agent_notes");
    }
    git(root, "update-ref", "refs/remotes/origin/stage", "stage");
    git(root, "checkout", "-q", "task/91/agent_notes");
    const result = recordNote(root, { ...base, stage: "开发", title: "合并后补记" });
    expect(result.here).toBe(false);
    expect(result.file).toContain(join(root, ".claude/notes-pending/notes"));
    expect(git(root, "status", "--porcelain", "--", "notes").trim()).toBe("");
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
    const chainPath = join(root, "notes/2026-09-26/alice/task_91_agent_notes.md");
    const original = readFileSync(chainPath, "utf8");
    writeFileSync(chainPath, original.replace("有结果", "篡改的结果"));
    // 追加一条新记录以满足新增记录检查
    record(root, "返工", 30);
    commit(root);

    const problems = checkPullRequest(root, { base: "stage", head: "task/91/agent_notes" });
    expect(problems.join("\n")).toMatch(/发现删除或修改已有记录的行/);
  });
  it("PR 里只做脱敏修订的已有记录放行；夹带别的改动就拒绝", () => {
    const root = repo();
    record(root, "开工", 0);
    record(root, "提交", 5);
    record(root, "PR", 10);
    record(root, "审查", 20);
    commit(root);
    git(root, "checkout", "-q", "stage");
    git(root, "merge", "-q", "task/91/agent_notes");
    git(root, "checkout", "-q", "task/91/agent_notes");
    const chainPath = join(root, "notes/2026-09-26/alice/task_91_agent_notes.md");
    writeFileSync(chainPath, readFileSync(chainPath, "utf8").replace("有结果", REDACTED));
    record(root, "返工", 30);
    commit(root);
    expect(pr(root)).toBe("");

    writeFileSync(chainPath, readFileSync(chainPath, "utf8").replace("做了一件事", "改了一件事"));
    commit(root);
    expect(pr(root)).toMatch(/发现删除或修改已有记录的行/);
  });

  it("PR 新增的记录里有用户原话形态就拒绝（只报行数，不回显内容）；改写成批准摘要就放行", () => {
    const root = repo();
    record(root, "开工", 0);
    record(root, "提交", 5);
    record(root, "PR", 10);
    record(root, "审查", 20);
    commit(root);
    git(root, "checkout", "-q", "stage");
    git(root, "merge", "-q", "task/91/agent_notes");
    git(root, "checkout", "-q", "task/91/agent_notes");
    const chainPath = join(root, "notes/2026-09-26/alice/task_91_agent_notes.md");
    // 标签与引号、冒号在测试里拼接，避免本文件自己命中门禁
    const quoted = ["- 做了什么：", "原话", "：", "「", "这是一句话", "」"].join("");
    writeFileSync(chainPath, `${readFileSync(chainPath, "utf8")}${quoted}\n`);
    commit(root);
    const problems = pr(root);
    expect(problems).toMatch(/含用户原话形态/);
    expect(problems).not.toContain("这是一句话");

    const summary = "- 做了什么：所有者 2026-10-30 07:43 在会话中批准：按 hotfix 发布";
    writeFileSync(chainPath, readFileSync(chainPath, "utf8").replace(quoted, summary));
    commit(root);
    expect(pr(root)).not.toMatch(/用户原话/);
  });

});

describe("脱敏修订（NOTES §3）", () => {
  const before = "- 做了什么：用 " + ["/Users/", "alice/x"].join("") + " 跑了检查\n- 结果：通过\n";

  it("只把敏感片段换成标记、其余字节不变；末尾追加整行记录也算", () => {
    expect(isRedactionRevision(before, "- 做了什么：用 [已脱敏]/x 跑了检查\n- 结果：通过\n")).toBe(true);
    expect(isRedactionRevision(before, "- 做了什么：用 /Users/[已脱敏] 跑了检查\n- 结果：[已脱敏]\n")).toBe(true);
    expect(isRedactionRevision(before, "- 做了什么：用 [已脱敏]/x 跑了检查\n- 结果：通过\n## 09:00:00 +08:00 · 返工 · #91 · 脱敏\n")).toBe(true);
  });

  it("标记之外有改动、替换的片段为空、跨行替换、追加不从行首开始，都不算", () => {
    expect(isRedactionRevision(before, "- 做了什么：用 [已脱敏]/x 跑了检查\n- 结果：不通过\n")).toBe(false);
    expect(isRedactionRevision("ab", "a[已脱敏][已脱敏]b")).toBe(false);
    expect(isRedactionRevision("a\nb", "a[已脱敏]b")).toBe(false);
    expect(isRedactionRevision("x\n", "x[已脱敏] 追加")).toBe(false);
    expect(isRedactionRevision(before, before)).toBe(false);
  });

  it("整行替换不算：标题行与普通段落整行换成标记都拒绝", () => {
    expect(isRedactionRevision("## 10:00:00 +08:00 · 收尾 · #328 · 标题\n", "[已脱敏]\n")).toBe(false);
    expect(isRedactionRevision("普通段落\n", "[已脱敏]\n")).toBe(false);
  });

  it("标题行的时间与记录类型不能换，标题可以换", () => {
    const header = "## 10:00:00 +08:00 · 收尾 · #328 · 标题\n";
    expect(isRedactionRevision(header, "## [已脱敏] · 收尾 · #328 · 标题\n")).toBe(false);
    expect(isRedactionRevision(header, "## 10:00:00 +08:00 · [已脱敏] · #328 · 标题\n")).toBe(false);
    expect(isRedactionRevision(header, "## 10:00:00 +08:00 · 收尾 · #328 · [已脱敏]\n")).toBe(true);
  });

  it("标签行的标签不能换，标签后的值可以换，「」里的内容可以换", () => {
    expect(isRedactionRevision("- 结果：通过\n", "[已脱敏]：通过\n")).toBe(false);
    expect(isRedactionRevision("- 结果：通过\n", "- 结果：[已脱敏]\n")).toBe(true);
    expect(isRedactionRevision("- 做了什么：说了「这是一句话」\n", "- 做了什么：说了「[已脱敏]」\n")).toBe(true);
  });

  it("没有标记的修订不是脱敏修订", () => {
    expect(REDACTED).toBe("[已脱敏]");
    expect(isRedactionRevision(before, before.replace("通过", "未通过"))).toBe(false);
  });
});

describe("mergeEntries 与 finishTitle", () => {
  it("mergeEntries 按时间排序并去重", () => {
    const dir = temp();
    const file = join(dir, "notes/2026-09-26/alice/test.md");
    const meta = { date: "2026-09-26", user: "alice", chain: "task/1/test" };
    const b1 = "## 10:00:00 +08:00 · 开工 · #1 · 开工\n\n- 执行者：human-alice\n- 做了什么：x\n- 结果：y\n";
    const b2 = "## 09:00:00 +08:00 · 方案 · #1 · 早期方案\n\n- 执行者：human-alice\n- 做了什么：x\n- 结果：y\n";
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
