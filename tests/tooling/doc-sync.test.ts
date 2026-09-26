import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDocSync, headerDate, parseSyncMap, SHALLOW_MESSAGE } from "../../scripts/check-doc-sync.mjs";

// scripts/check-doc-sync.mjs：文档跟着模块改（docs/README.md「文档跟着模块改」，#115）。全部在临时 Git 仓库里跑。
const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "geek-doc-sync-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MAP = [
  "# 文档与规范总入口",
  "",
  "## 文档跟着模块改",
  "",
  "| 模块路径 | 文档路径 | 头部「更新：」 |",
  "|---|---|---|",
  "| `app/svc/` | `docs/services/svc/` | `docs/services/svc/README.md` |",
  "| `deploy/` | `docs/ops/DEPLOY.md`、`docs/ops/CICD.md` | `docs/ops/DEPLOY.md`、`docs/ops/CICD.md` |",
  "",
  "## 阅读地图",
  "",
  "| `app/svc/` | 不在对照表那一节里，不算 | x |",
  "",
].join("\n");

const doc = (date: string, body = "说明") => `# svc\n\n> 摘要\n\n状态：\`current\` · 更新：${date}\n\n${body}\n`;

/** 在 root 里按北京时间 at 提交；提交者时间与作者时间都固定，结果可复现。 */
function commit(root: string, at: string, message: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
  return git(root, ["rev-parse", "HEAD"]).trim();
}

function git(cwd: string, args: string[], env: Record<string, string> = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
}

/** stage 上的起点：模块与文档同一个提交，头部日期对得上。 */
function repo() {
  const root = temp();
  git(root, ["init", "-q", "-b", "stage"]);
  git(root, ["config", "user.email", "ci@example.test"]);
  git(root, ["config", "user.name", "CI"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  commit(root, "2026-09-25T10:00:00+08:00", "base", {
    "docs/README.md": MAP,
    "app/svc/index.ts": "export const a = 1;\n",
    "docs/services/svc/README.md": doc("2026-09-25"),
    "deploy/compose.yml": "services: {}\n",
    "docs/ops/DEPLOY.md": doc("2026-09-25"),
    "docs/ops/CICD.md": doc("2026-09-24"),
  });
  return root;
}

const NOW = new Date("2026-09-27T12:00:00+08:00");
const problems = (root: string, options: { base?: string } = {}) => checkDocSync(root, { now: NOW, ...options }).problems;

describe("对照表与文档头", () => {
  it("只解析「文档跟着模块改」那一节的表格，路径写在反引号里、顿号分隔", () => {
    expect(parseSyncMap(MAP)).toEqual([
      { modules: ["app/svc/"], docs: ["docs/services/svc/"], headers: ["docs/services/svc/README.md"] },
      { modules: ["deploy/"], docs: ["docs/ops/DEPLOY.md", "docs/ops/CICD.md"], headers: ["docs/ops/DEPLOY.md", "docs/ops/CICD.md"] },
    ]);
    expect(() => parseSyncMap("# 没有这一节\n")).toThrow(/文档跟着模块改/);
    expect(() => parseSyncMap("## 文档跟着模块改\n\n| `app/x/` | `docs/x/` |\n")).toThrow(/三列/);
  });

  it("仓库里的 docs/README.md 能解析，并且 app/ 下每个服务都在表里", () => {
    const text = readFileSync(new URL("../../docs/README.md", import.meta.url), "utf8");
    const modules = parseSyncMap(text).flatMap((pair: { modules: string[] }) => pair.modules);
    for (const service of ["server", "web", "console", "forum"]) expect(modules).toContain(`app/${service}/`);
    expect(modules).toEqual(expect.arrayContaining(["deploy/", ".github/workflows/"]));
  });

  it("头部「更新：」只在文件开头找", () => {
    expect(headerDate(doc("2026-09-26"))).toBe("2026-09-26");
    expect(headerDate(`# x\n${"\n".repeat(20)}更新：2026-09-26\n`)).toBeNull();
  });
});

describe("按提交时间比较模块与文档", () => {
  it("模块与文档同一个提交、头部日期不早于模块：通过", () => {
    const root = repo();
    expect(problems(root)).toEqual([]);
    commit(root, "2026-09-26T09:00:00+08:00", "feat: 两边一起改", {
      "app/svc/index.ts": "export const a = 2;\n",
      "docs/services/svc/README.md": doc("2026-09-26", "改了 a"),
    });
    expect(problems(root)).toEqual([]);
  });

  it("模块比文档新：失败，写出是哪一对、哪个提交；之后补上文档就通过", () => {
    const root = repo();
    const sha = commit(root, "2026-09-26T09:25:11+08:00", "build(deploy): 只改了模块", { "app/svc/index.ts": "export const a = 2;\n" });
    const found = problems(root);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("文档没跟上模块：app/svc/ ↔ docs/services/svc/");
    expect(found[0]).toContain(`${sha.slice(0, 7)} 2026-09-26 09:25:11 +08:00「build(deploy): 只改了模块」`);
    expect(found[0]).toContain(`git show ${sha.slice(0, 7)} -- app/svc/`);
    expect(found[1]).toMatch(/docs\/services\/svc\/README\.md 头部的「更新：2026-09-25」早于 app\/svc\/ 最后一次改动的北京日期 2026-09-26/);

    commit(root, "2026-09-26T09:40:00+08:00", "docs(svc): 补上说明", { "docs/services/svc/README.md": doc("2026-09-26", "a 改成 2") });
    expect(problems(root)).toEqual([]);
  });

  it("文档提交了但头部日期没改：只报日期", () => {
    const root = repo();
    commit(root, "2026-09-26T09:00:00+08:00", "feat: 两边一起改但忘了日期", {
      "app/svc/index.ts": "export const a = 2;\n",
      "docs/services/svc/README.md": doc("2026-09-25", "改了 a"),
    });
    expect(problems(root)).toEqual([expect.stringContaining("「更新：2026-09-25」早于")]);
  });

  it("北京日期按 +08:00 算：UTC 前一天晚上的提交落在北京第二天", () => {
    const root = repo();
    commit(root, "2026-09-25T16:30:00Z", "feat: 北京时间 00:30", {
      "app/svc/index.ts": "export const a = 2;\n",
      "docs/services/svc/README.md": doc("2026-09-25", "改了 a"),
    });
    expect(problems(root)).toEqual([expect.stringContaining("北京日期 2026-09-26")]);
  });

  it("一行写了几份文档：改其中任何一份都算跟上，日期看最新的那个", () => {
    const root = repo();
    commit(root, "2026-09-26T10:00:00+08:00", "fix(deploy): 改 compose", { "deploy/compose.yml": "services: { a: {} }\n" });
    expect(problems(root).join("\n")).toContain("deploy/ ↔ docs/ops/DEPLOY.md、docs/ops/CICD.md");
    commit(root, "2026-09-26T10:05:00+08:00", "docs(deploy): 同步 CICD", { "docs/ops/CICD.md": doc("2026-09-26", "compose 多了 a") });
    expect(problems(root)).toEqual([]);
  });

  it("工作区里没提交的改动算作现在：只改模块不通过，文档也改了就通过", () => {
    const root = repo();
    writeFileSync(join(root, "app/svc/index.ts"), "export const a = 3;\n");
    const found = problems(root);
    expect(found[0]).toContain("工作区里改了模块（app/svc/index.ts）");
    expect(found[1]).toContain("北京日期 2026-09-27（工作区里还没提交的改动）");
    writeFileSync(join(root, "docs/services/svc/README.md"), doc("2026-09-27", "a 改成 3"));
    expect(problems(root)).toEqual([]);
  });

  it("浅克隆：直接报错，不当作通过", () => {
    const root = repo();
    commit(root, "2026-09-26T09:00:00+08:00", "feat: 第二个提交", {
      "app/svc/index.ts": "export const a = 2;\n",
      "docs/services/svc/README.md": doc("2026-09-26", "改了 a"),
    });
    const shallow = join(temp(), "shallow");
    git(root, ["clone", "-q", "--depth", "1", `file://${root}`, shallow]);
    expect(() => checkDocSync(shallow, { now: NOW })).toThrow(SHALLOW_MESSAGE);
  });

  it("表里的路径不存在、app/ 下有服务没写进表：报出来", () => {
    const root = repo();
    commit(root, "2026-09-26T09:00:00+08:00", "feat: 新服务没进表", { "app/other/index.ts": "export {};\n" });
    expect(problems(root)).toEqual([expect.stringContaining("app/other/ 没有写进 docs/README.md「文档跟着模块改」的对照表")]);
    rmSync(join(root, "app/other"), { recursive: true });
    rmSync(join(root, "docs/ops/CICD.md"));
    expect(problems(root)).toEqual([expect.stringContaining("`docs/ops/CICD.md` 不存在")]);
  });
});

/** 在 root 里提交，作者时间与提交者时间分开给（模拟 rebase、跨零点合并） */
function commitAt(root: string, authored: string, committed: string, message: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message], { GIT_AUTHOR_DATE: authored, GIT_COMMITTER_DATE: committed });
}

/** 把 branch 以 merge commit 合进当前分支（GitHub「Create a merge commit」的形状） */
function mergeInto(root: string, branch: string, at: string, message = `Merge pull request from ${branch}`) {
  git(root, ["merge", "-q", "--no-ff", "-m", message, branch], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
}

describe("task 分支按 PR 核对", () => {
  it("task 分支上自动对 stage 按 PR 核对：先改文档、后面再返工代码也通过", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/rework"]);
    commit(root, "2026-09-26T09:00:00+08:00", "fix(svc): 改模块和文档", {
      "app/svc/index.ts": "export const a = 2;\n",
      "docs/services/svc/README.md": doc("2026-09-26", "a 改成 2"),
    });
    commit(root, "2026-09-26T10:00:00+08:00", "fix(svc): 按审查返工", { "app/svc/index.ts": "export const a = 3;\n" });
    const result = checkDocSync(root, { now: NOW });
    expect(result.base).toBe("stage");
    expect(result.problems).toEqual([]);
    // 同样的历史在非 task 分支上按时间核对，返工提交就比文档新
    expect(checkDocSync(root, { now: NOW, branch: "dev/someone" }).problems[0]).toContain("fix(svc): 按审查返工");
  });

  it("task 分支只改模块：不通过；stage 后来只改了那份文档也不算（比的是 merge-base，不是 stage 现在的样子）", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/code"]);
    commit(root, "2026-09-26T09:00:00+08:00", "fix(svc): 只改模块", { "app/svc/index.ts": "export const a = 2;\n" });
    git(root, ["checkout", "-q", "stage"]);
    commit(root, "2026-09-26T10:00:00+08:00", "docs(svc): 别人改文档", { "docs/services/svc/README.md": doc("2026-09-26", "别的说明") });
    git(root, ["checkout", "-q", "task/9/code"]);
    const found = problems(root);
    expect(found[0]).toContain("这次的改动动了模块、没动文档：app/svc/ ↔ docs/services/svc/");
    expect(found[0]).toContain("改了 app/svc/index.ts");
    expect(found.slice(1)).toEqual([expect.stringMatching(/^docs\/services\/svc\/README\.md 头部的「更新：2026-09-25」早于/)]);

    // 把 stage 合进来也一样：这条分支自己没动文档
    mergeInto(root, "stage", "2026-09-26T11:00:00+08:00", "Merge stage");
    expect(problems(root, { base: "stage" })).toEqual([expect.stringContaining("这次的改动动了模块、没动文档")]);

    commit(root, "2026-09-26T11:10:00+08:00", "docs(svc): 补上 task 的说明", { "docs/services/svc/README.md": doc("2026-09-26", "a 改成 2") });
    expect(problems(root, { base: "stage" })).toEqual([]);
  });

  it("没提交、没跟踪的新文件也算这次的改动", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/new_file"]);
    writeFileSync(join(root, "app/svc/extra.ts"), "export const extra = 1;\n");
    expect(problems(root)[0]).toContain("改了 app/svc/extra.ts");
    writeFileSync(join(root, "docs/services/svc/extra.md"), "# extra\n");
    writeFileSync(join(root, "docs/services/svc/README.md"), doc("2026-09-27", "多了 extra.ts"));
    expect(problems(root)).toEqual([]);
  });

  it("stage 本来就不同步：报出来并写明不是这条分支造成的；这条分支动了那份文档就算在修", () => {
    const root = repo();
    commit(root, "2026-09-26T08:00:00+08:00", "fix(svc): stage 上只改了模块", { "app/svc/more.ts": "export const c = 1;\n" });
    git(root, ["checkout", "-q", "-b", "task/9/other"]);
    commit(root, "2026-09-26T09:00:00+08:00", "fix(deploy): 改 compose 和文档", {
      "deploy/compose.yml": "services: { a: {} }\n",
      "docs/ops/CICD.md": doc("2026-09-26", "compose 多了 a"),
    });
    const found = problems(root);
    expect(found.some((text) => text.startsWith("stage 上本来就不同步（不是这条分支造成的）：app/svc/ ↔ docs/services/svc/"))).toBe(true);
    expect(found.join("\n")).toContain("fix(svc): stage 上只改了模块");
    expect(found).toContainEqual(expect.stringMatching(/^stage 上本来就过期（不是这条分支造成的）：docs\/services\/svc\/README\.md 头部的「更新：2026-09-25」/));

    commit(root, "2026-09-26T09:30:00+08:00", "docs(svc): 顺手补上 stage 落下的说明", { "docs/services/svc/README.md": doc("2026-09-26", "多了 more.ts") });
    expect(problems(root)).toEqual([]);
  });

  it("task 分支上找不到 stage：退回按时间核对，并说明原因", () => {
    const root = repo();
    git(root, ["branch", "-m", "stage", "task/9/alone"]);
    const result = checkDocSync(root, { now: NOW });
    expect(result.base).toBeNull();
    expect(result.notes).toEqual([expect.stringContaining("既没有 origin/stage 也没有 stage")]);
    expect(result.problems).toEqual([]);
    expect(() => checkDocSync(root, { now: NOW, base: "origin/stage" })).toThrow(/找不到 origin\/stage/);
  });
});

describe("文档核对：模块改了、文档里的事实没变", () => {
  const notesOf = (branch: string) => `notes/2026-09-26/someone/${branch.replaceAll("/", "_")}.md`;
  const waiver = (line: string) => `# 记录\n\n## 10:00:00 +08:00 · 开发 · #9 · 只改测试\n\n- 做了什么：${line}\n`;

  it("按 PR：这个 task 的执行记录里写了文档核对就通过，「更新：」已经是当天的就不用改文档", () => {
    const root = repo();
    commit(root, "2026-09-26T08:00:00+08:00", "docs(svc): 当天早些时候改过", { "docs/services/svc/README.md": doc("2026-09-26", "早上的说明") });
    git(root, ["checkout", "-q", "-b", "task/9/tests_only"]);
    commit(root, "2026-09-26T09:00:00+08:00", "test(svc): 只加测试", { "app/svc/index.test.ts": "// test\n" });
    expect(problems(root)[0]).toContain("这次的改动动了模块、没动文档");
    commit(root, "2026-09-26T09:05:00+08:00", "docs(notes): 文档核对", {
      [notesOf("task/9/tests_only")]: waiver("文档核对：docs/services/svc/ 不用改——只加了测试，接口没变"),
    });
    expect(problems(root)).toEqual([]);
  });

  it("按 PR：别的 task 的执行记录、路径不对、没写理由的文档核对都不算", () => {
    const root = repo();
    commit(root, "2026-09-26T08:00:00+08:00", "docs(svc): 当天改过", { "docs/services/svc/README.md": doc("2026-09-26", "早上的说明") });
    git(root, ["checkout", "-q", "-b", "task/9/tests_only"]);
    commit(root, "2026-09-26T09:00:00+08:00", "test(svc): 只加测试", {
      "app/svc/index.test.ts": "// test\n",
      [notesOf("task/8/other")]: waiver("文档核对：docs/services/svc/ 不用改——别人的记录"),
      [notesOf("task/9/tests_only")]: waiver("文档核对：docs/services/other/ 不用改——路径不对；文档核对：docs/services/svc/ 不用改——"),
    });
    expect(problems(root)[0]).toContain("这次的改动动了模块、没动文档");
    // 不知道是哪个 task 时（CI 检出合并提交又没给 --head），notes/ 下这次新加的都算
    expect(checkDocSync(root, { now: NOW, base: "stage", branch: "" }).problems).toEqual([]);
  });

  it("按 PR：文档只改了「更新：」日期不算改了说明；写了文档核对就通过", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/date_only"]);
    commit(root, "2026-09-26T09:00:00+08:00", "refactor(svc): 重构，只改日期", {
      "app/svc/index.ts": "export const a = 1; // 重构\n",
      "docs/services/svc/README.md": doc("2026-09-26"),
    });
    expect(problems(root)).toEqual([expect.stringContaining("这次的改动动了模块，文档只改了「更新：」日期")]);
    commit(root, "2026-09-26T09:05:00+08:00", "docs(notes): 文档核对", {
      [notesOf("task/9/date_only")]: waiver("文档核对：docs/services/svc/ 不用改——只是重构，行为没变"),
    });
    expect(problems(root)).toEqual([]);
  });

  it("写了文档核对，「更新：」也要跟上模块的日期", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/stale"]);
    commit(root, "2026-09-26T09:00:00+08:00", "test(svc): 只加测试", {
      "app/svc/index.test.ts": "// test\n",
      [notesOf("task/9/stale")]: waiver("文档核对：docs/services/svc/ 不用改——只加了测试"),
    });
    expect(problems(root)).toEqual([expect.stringContaining("头部的「更新：2026-09-25」早于 app/svc/ 最后一次改动的北京日期 2026-09-26")]);
  });

  it("按时间：stage 上合并提交带来模块和文档核对，算同步；文档核对早于模块的改动不算", () => {
    const root = repo();
    commit(root, "2026-09-26T08:00:00+08:00", "docs(svc): 当天改过", { "docs/services/svc/README.md": doc("2026-09-26", "早上的说明") });
    git(root, ["checkout", "-q", "-b", "task/9/tests_only"]);
    commit(root, "2026-09-26T09:00:00+08:00", "test(svc): 只加测试", {
      "app/svc/index.test.ts": "// test\n",
      [notesOf("task/9/tests_only")]: waiver("文档核对：docs/services/svc/ 不用改——只加了测试"),
    });
    git(root, ["checkout", "-q", "stage"]);
    mergeInto(root, "task/9/tests_only", "2026-09-26T10:00:00+08:00");
    expect(problems(root)).toEqual([]);

    commit(root, "2026-09-26T11:00:00+08:00", "fix(svc): 直接在 stage 上改模块", { "app/svc/index.ts": "export const a = 5;\n" });
    expect(problems(root)[0]).toContain("fix(svc): 直接在 stage 上改模块");
    // 工作区里新写的文档核对算作现在
    writeFileSync(join(root, notesOf("stage")), waiver("文档核对：docs/services/svc/ 不用改——常量换了值，文档没写这个值"));
    expect(problems(root)).toEqual([]);
  });
});

describe("stage 上按第一父链的时间核对", () => {
  it("PR 以 merge commit 进 stage：合并提交同时带来模块和文档，里面返工提交的先后不影响", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/pr"]);
    commit(root, "2026-09-26T09:00:00+08:00", "docs(svc): 先写文档", { "docs/services/svc/README.md": doc("2026-09-26", "a 改成 2") });
    commit(root, "2026-09-26T10:00:00+08:00", "fix(svc): 后改代码", { "app/svc/index.ts": "export const a = 2;\n" });
    git(root, ["checkout", "-q", "stage"]);
    commit(root, "2026-09-26T10:30:00+08:00", "fix(deploy): 别的 PR", {
      "deploy/compose.yml": "services: { a: {} }\n",
      "docs/ops/DEPLOY.md": doc("2026-09-26", "compose 多了 a"),
    });
    mergeInto(root, "task/9/pr", "2026-09-26T12:00:00+08:00");
    expect(problems(root)).toEqual([]);
  });

  it("rebase 合并那样的直线历史：模块提交落在文档提交后面就不通过", () => {
    const root = repo();
    commit(root, "2026-09-26T09:00:00+08:00", "docs(svc): 先写文档", { "docs/services/svc/README.md": doc("2026-09-26", "a 改成 2") });
    commit(root, "2026-09-26T10:00:00+08:00", "fix(svc): 后改代码", { "app/svc/index.ts": "export const a = 2;\n" });
    expect(problems(root)).toEqual([expect.stringContaining("fix(svc): 后改代码")]);
  });

  it("「更新：」按作者时间比：零点前写的提交、零点后才合进 stage，不算过期", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/late"]);
    commitAt(root, "2026-09-26T23:50:00+08:00", "2026-09-27T00:10:00+08:00", "fix(svc): 零点前写的", {
      "app/svc/index.ts": "export const a = 2;\n",
      "docs/services/svc/README.md": doc("2026-09-26", "a 改成 2"),
    });
    git(root, ["checkout", "-q", "stage"]);
    mergeInto(root, "task/9/late", "2026-09-27T00:20:00+08:00");
    expect(problems(root)).toEqual([]);
  });

  it("未跟踪的新模块文件算作现在的改动；被忽略的目录不算，也不会被当成服务", () => {
    const root = repo();
    writeFileSync(join(root, ".gitignore"), "app/leftover/\n");
    commit(root, "2026-09-26T09:00:00+08:00", "chore: 忽略残留目录", {});
    mkdirSync(join(root, "app/leftover"), { recursive: true });
    writeFileSync(join(root, "app/leftover/x.js"), "x\n");
    expect(problems(root)).toEqual([]);
    writeFileSync(join(root, "app/svc/extra.ts"), "export const extra = 1;\n");
    expect(problems(root)[0]).toContain("工作区里改了模块（app/svc/extra.ts）");
  });

  it("GitHub 给 PR 做的合并提交（两边都一起改了模块和文档）：通过", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/both"]);
    commit(root, "2026-09-26T09:00:00+08:00", "fix(svc): task 改模块和子文档", {
      "app/svc/index.ts": "export const a = 2;\n",
      "docs/services/svc/detail.md": "# detail\n",
      "docs/services/svc/README.md": doc("2026-09-26", "a 改成 2"),
    });
    git(root, ["checkout", "-q", "stage"]);
    commit(root, "2026-09-26T10:00:00+08:00", "feat(svc): stage 上模块和文档一起改", {
      "app/svc/more.ts": "export const c = 1;\n",
      "docs/services/svc/more.md": "# more\n",
    });
    mergeInto(root, "task/9/both", "2026-09-26T12:00:00+08:00");
    expect(problems(root)).toEqual([]);
    expect(problems(root, { base: "stage~1" })).toEqual([]);
  });
});
