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

describe("合并与 PR", () => {
  it("把 stage 合进 task 分支：stage 上一起改过的模块和文档不会让模块显得更新", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/docs"]);
    commit(root, "2026-09-26T09:00:00+08:00", "docs(svc): task 改文档", { "docs/services/svc/README.md": doc("2026-09-26", "task 的说明") });
    git(root, ["checkout", "-q", "stage"]);
    commit(root, "2026-09-26T10:00:00+08:00", "feat: stage 上模块和部署文档一起改", {
      "app/svc/other.ts": "export const b = 1;\n",
      "docs/services/svc/other.md": "# other\n",
    });
    git(root, ["checkout", "-q", "task/9/docs"]);
    git(root, ["merge", "-q", "--no-ff", "-m", "Merge stage into task/9/docs", "stage"], {
      GIT_AUTHOR_DATE: "2026-09-26T11:00:00+08:00", GIT_COMMITTER_DATE: "2026-09-26T11:00:00+08:00",
    });
    expect(problems(root)).toEqual([]);
    expect(problems(root, { base: "stage" })).toEqual([]);
  });

  it("task 分支只改模块、stage 上别人后来改过同一份文档：时间比较会通过，PR 检查（--base）拦下", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/code"]);
    commit(root, "2026-09-26T09:00:00+08:00", "fix(svc): 只改模块", { "app/svc/index.ts": "export const a = 2;\n" });
    git(root, ["checkout", "-q", "stage"]);
    commit(root, "2026-09-26T10:00:00+08:00", "docs(svc): 别人改文档", { "docs/services/svc/README.md": doc("2026-09-26", "别的说明") });
    git(root, ["checkout", "-q", "task/9/code"]);
    git(root, ["merge", "-q", "--no-ff", "-m", "Merge stage", "stage"], {
      GIT_AUTHOR_DATE: "2026-09-26T11:00:00+08:00", GIT_COMMITTER_DATE: "2026-09-26T11:00:00+08:00",
    });
    expect(problems(root)).toEqual([]);
    const found = problems(root, { base: "stage" });
    expect(found).toEqual([expect.stringContaining("这次的改动动了模块、没动文档：app/svc/ ↔ docs/services/svc/")]);
    expect(found[0]).toContain("stage...HEAD 改了 app/svc/index.ts");

    commit(root, "2026-09-26T11:10:00+08:00", "docs(svc): 补上 task 的说明", { "docs/services/svc/README.md": doc("2026-09-26", "a 改成 2") });
    expect(problems(root, { base: "stage" })).toEqual([]);
  });

  it("合并提交本身不算改动：两边都改了模块时，报出真正改模块的那个提交，而不是合并提交", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/both"]);
    commit(root, "2026-09-26T09:00:00+08:00", "fix(svc): task 改模块和文档", {
      "app/svc/index.ts": "export const a = 2;\n",
      "docs/services/svc/README.md": doc("2026-09-26", "a 改成 2"),
    });
    git(root, ["checkout", "-q", "stage"]);
    const stageOnly = commit(root, "2026-09-26T10:00:00+08:00", "fix(svc): stage 上只改模块", { "app/svc/more.ts": "export const c = 1;\n" });
    git(root, ["checkout", "-q", "task/9/both"]);
    git(root, ["merge", "-q", "--no-ff", "-m", "Merge stage", "stage"], {
      GIT_AUTHOR_DATE: "2026-09-26T11:00:00+08:00", GIT_COMMITTER_DATE: "2026-09-26T11:00:00+08:00",
    });
    const found = problems(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`${stageOnly.slice(0, 7)} 2026-09-26 10:00:00 +08:00「fix(svc): stage 上只改模块」`);
    expect(found[0]).not.toContain("Merge stage");
  });

  it("GitHub 给 PR 做的合并提交（两边都一起改了模块和文档）：合并那一刻的时间不会让模块显得更新", () => {
    const root = repo();
    git(root, ["checkout", "-q", "-b", "task/9/pr"]);
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
    git(root, ["merge", "-q", "--no-ff", "-m", "Merge pull request #9", "task/9/pr"], {
      GIT_AUTHOR_DATE: "2026-09-26T12:00:00+08:00", GIT_COMMITTER_DATE: "2026-09-26T12:00:00+08:00",
    });
    expect(problems(root)).toEqual([]);
    expect(problems(root, { base: "stage~1" })).toEqual([]);
  });
});
