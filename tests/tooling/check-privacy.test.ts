import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PERSONAL_IDENTIFIER_SHA256, auditRepository, inScope, parseExceptions, scanCommits, scanText, scanUserQuotes } from "../../scripts/check-privacy.mjs";

// scripts/check-privacy.mjs：规范、文档与代码里的身份信息、本机路径与凭据形态（#328）。
// 所有夹具都是合成的：账号名用 octocat 的摘要传入，不在测试里写所有者的名字。
const digest = (word: string) => createHash("sha256").update(word.toLowerCase()).digest("hex");
const owner = { identityDigests: [digest("octocat")] };
const rules = (text: string, options?: { identityDigests?: string[] }) => scanText(text, options).map(item => item.rule);
// 夹具里会触发门禁的片段（路径、手机号、令牌、邮箱、证件号）在测试里拼接，本文件不含这些字面量
const cat = (...parts: string[]) => parts.join("");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("个人标识：名字、域名与本机账号（登记表匹配）", () => {
  it("作为一段字母数字命中，大小写不敏感，连字符与点分开的段也算", () => {
    expect(rules("由 octocat 确认", owner)).toEqual(["个人标识"]);
    expect(rules("由 OctoCat 确认", owner)).toEqual(["个人标识"]);
    expect(rules("@octocat 请看", owner)).toEqual(["个人标识"]);
    expect(rules("octocat-ct cred exec", owner)).toEqual(["个人标识"]);
    expect(rules("https://ai.octocat.com/v1", owner)).toEqual(["个人标识"]);
  });

  it("只是更长单词的一部分不算，noreply 地址不算", () => {
    expect(rules("octocats 不是", owner)).toEqual([]);
    expect(rules("提交者 1234567+octocat@users.noreply.github.com", owner)).toEqual([]);
    expect(rules("12-octocat@noreply.git.example.com", owner)).toEqual([]);
  });

  it("链路 id（用户/task_N）只在 notes/ 与提交说明里不算，文档里的同样写法照样报", () => {
    expect(rules("链路 octocat/task_328_deidentify 的记录", { ...owner, notesLayout: true })).toEqual([]);
    expect(rules("链路 octocat/task_328_deidentify 的记录", owner)).toEqual(["个人标识"]);
  });

  it("登记表只存小写 sha256 摘要，不存明文", () => {
    expect(PERSONAL_IDENTIFIER_SHA256.length).toBeGreaterThan(0);
    for (const digest of PERSONAL_IDENTIFIER_SHA256) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../scripts/check-privacy.mjs"), "utf8")).not.toContain("octocat");
  });

  it("默认摘要只存在于脚本里：普通文本不命中", () => {
    expect(rules("由所有者确认")).toEqual([]);
  });
});

describe("本机家目录路径", () => {
  it("命中 macOS、Linux 与 Windows 的家目录", () => {
    expect(rules(cat("/Users/", "alice/work"))).toEqual(["本机家目录路径"]);
    expect(rules(cat("/home/", "alice/r1/_work"))).toEqual(["本机家目录路径"]);
    expect(rules(cat("C:/Users/", "alice/AppData"))).toEqual(["本机家目录路径"]);
  });

  it("占位写法与仓库相对路径不算", () => {
    expect(rules("/home/<login>/r1")).toEqual([]);
    expect(rules(".tools/node/bin/node")).toEqual([]);
    expect(rules("~/work_file/geek_main")).toEqual([]);
    expect(rules("/home/guest/r1")).toEqual([]);
    expect(rules(cat("/home/", "guests/r1"))).toEqual(["本机家目录路径"]);
  });
});

describe("手机号、令牌形态与证件号", () => {
  it("11 位大陆手机号独立出现时命中", () => {
    expect(rules(cat("联系 ", "138", "00138000"))).toEqual(["手机号"]);
    expect(rules("13800138000x")).toEqual([]);
    expect(rules("1380013800")).toEqual([]);
  });

  it("令牌前缀后跟长随机串时命中，普通单词不命中", () => {
    expect(rules(cat("gk_", "abcdefghijklmnop1234"))).toEqual(["令牌形态"]);
    expect(rules(cat("glpat-", "abcdefghijklmnop1234"))).toEqual(["令牌形态"]);
    expect(rules(cat("github_pat_", "abcdefghijklmnopqrstuvwxyz0123"))).toEqual(["令牌形态"]);
    expect(rules(cat("sk-", "abcdefghijklmnopqrstuvwxyz"))).toEqual(["令牌形态"]);
    expect(rules("task-abcdefghijklmnopqrstuvwxyz")).toEqual([]);
    expect(rules("sk-")).toEqual([]);
  });

  it("18 位居民身份证形态命中", () => {
    expect(rules(cat("证件 ", "110101", "19900307", "1234"))).toEqual(["证件号"]);
    expect(rules("编号 11010119900307123456")).toEqual([]);
  });
});

describe("个人邮箱", () => {
  it("个人邮箱命中", () => {
    expect(rules(cat("填 someone@", "qq.com 投递"))).toEqual(["个人邮箱"]);
  });

  it("角色与系统发信地址、占位域名、systemd 单元与 URL 用户信息不算", () => {
    expect(rules("notify@mail.example.org")).toEqual([]);
    expect(rules("git@github.com:org/repo.git")).toEqual([]);
    expect(rules("owner@example.test")).toEqual([]);
    expect(rules("yzgc-compose@preview.service")).toEqual([]);
    expect(rules("/root/yzgc-compose@.service.bak-20261028")).toEqual([]);
    expect(rules("https://user:pass@example.com/x")).toEqual([]);
  });

  it("紧跟冒号的个人邮箱照样报，只有 :// 形式的 URL 用户信息不算", () => {
    expect(rules(cat("contact", ":", "someone", "@", "qq", ".com"))).toEqual(["个人邮箱"]);
    expect(rules(cat("https://user", ":", "pass", "@", "qq", ".com/x"))).toEqual([]);
    expect(rules(cat("https://user", "@", "qq", ".com/x"))).toEqual([]);
    expect(rules(cat("https://qq", ".com/", "someone", "@", "qq", ".com"))).toEqual(["个人邮箱"]);
  });
});

describe("扫描范围", () => {
  it("规范、文档、脚本、代码与部署模板在范围内", () => {
    for (const file of ["AGENTS.md", "README.md", "docs/conventions/NOTES.md", ".agents/skills/x/SKILL.md", "scripts/note.mjs", ".github/workflows/ci.yml", "app/server/src/cli/account.ts", "deploy/hotfix/windows.json", "deploy/env/.env.preview", "docs/plan/UNIFIED-LOGIN.md", "docs/history/SECURITY.md", "tests/tooling/notes.test.ts", "app/forum/tests/sticker-url.test.ts", "app/server/tests/x.test.ts"]) {
      expect(inScope(file), file).toBe(true);
    }
  });

  it("生成物、第三方快照、交接记录与执行记录不在范围内", () => {
    for (const file of ["docs/INDEX.md", "docs/architecture/catalog/catalog.json", "docs/components/tuffex/snapshot/x.ts.txt", "docs/components/tuffex/reference/icons.md", "docs/handovers/x.md", "notes/2026-10-24/alice/task_1.md"]) {
      expect(inScope(file), file).toBe(false);
    }
  });

  it("app 下的全部文本文件都在范围内：页面、样式、Nuxt 页面、Rust 源码与测试", () => {
    for (const file of ["app/web/sites/portal/styles/os.css", "app/web/sites/portal/index.html", "app/forum/app/pages/index.vue", "app/cli/src/main.rs", "app/cli/tests/device_protocol.rs", "app/console/src/main.ts", "app/web/shared/lib/x.tsx", "app/web/.dockerignore"]) {
      expect(inScope(file), file).toBe(true);
    }
  });

  it("锁文件、二进制资源与构建产物（含 node_modules）不在范围内", () => {
    for (const file of ["app/forum/pnpm-lock.yaml", "app/cli/Cargo.lock", "app/web/package-lock.json", "app/web/sites/portal/assets/mascot/geek-girl.webp", "app/web/public/logo.png", "app/web/public/font/x.woff2", "app/forum/.nuxt/dist/server.js", "app/web/dist/index.html", "app/cli/target/debug/geek", "app/web/node_modules/left-pad/index.js", "app/server/.output/server/index.mjs", "app/web/coverage/index.html"]) {
      expect(inScope(file), file).toBe(false);
    }
  });
});

describe("仓库审计", () => {
  const tree = (files: Record<string, string>) => {
    const repoRoot = mkdtempSync(join(tmpdir(), "geek-privacy-"));
    dirs.push(repoRoot);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repoRoot, file)), { recursive: true });
      writeFileSync(join(repoRoot, file), text);
    }
    return repoRoot;
  };

  it("插入一处命中就失败并报位置，删掉后通过", () => {
    const files = ["docs/conventions/PROJECT.md"];
    const repoRoot = tree({ [files[0]]: "# 项目\n\n普通的规范正文。\n" });
    expect(auditRepository({ repoRoot, files, identityDigests: owner.identityDigests })).toMatchObject({ ok: true, checked: 1 });

    writeFileSync(join(repoRoot, files[0]), "# 项目\n\n普通的规范正文。\n看这里 " + cat("/Users/", "alice/work") + "\n");
    const failed = auditRepository({ repoRoot, files, identityDigests: owner.identityDigests });
    expect(failed.ok).toBe(false);
    expect(failed.findings).toEqual([expect.stringMatching(/^docs\/conventions\/PROJECT\.md:4: 本机家目录路径/)]);
    expect(failed.findings.join("\n")).not.toContain("alice");

    writeFileSync(join(repoRoot, files[0]), "# 项目\n\n普通的规范正文。\n看这里 ~/work\n");
    expect(auditRepository({ repoRoot, files, identityDigests: owner.identityDigests }).ok).toBe(true);
  });

  it("范围外的文件即使有命中也不扫描", () => {
    const files = ["docs/handovers/x.md", "notes/2026-10-24/alice/task_1.md"];
    const repoRoot = tree({ [files[0]]: cat("/Users/", "alice/x"), [files[1]]: cat("138", "00138000") });
    expect(auditRepository({ repoRoot, files, identityDigests: owner.identityDigests })).toEqual({ ok: true, findings: [], checked: 0 });
  });

  it("审计输出只有位置与类别，不回显命中的地址；扫描结果里也没有明文", () => {
    const address = cat("someone", "@", "qq", ".com");
    const repoRoot = tree({ "docs/conventions/PROJECT.md": `联系 ${address}\n` });
    const report = auditRepository({ repoRoot, files: ["docs/conventions/PROJECT.md"], identityDigests: owner.identityDigests });
    expect(report.ok).toBe(false);
    expect(report.findings).toEqual([expect.stringMatching(/^docs\/conventions\/PROJECT\.md:1: 个人邮箱/)]);
    expect(report.findings.join("\n")).not.toContain(address);
    expect(JSON.stringify(scanText(`联系 ${address}`))).not.toContain(address);
  });

  it("app 下的样式与页面照样扫描，锁文件与二进制资源不读", () => {
    const files = ["app/web/sites/portal/styles/os.css", "app/forum/app/pages/index.vue", "app/cli/Cargo.lock", "app/web/public/logo.png"];
    const repoRoot = tree({
      [files[0]]: `.os { color: red; } /* ${cat("alice", "@", "qq", ".com")} */\n`,
      [files[1]]: `<template>${cat("/Users/", "alice/x")}</template>\n`,
      [files[2]]: `# ${cat("alice", "@", "qq", ".com")}\n`,
      [files[3]]: "\0PNG",
    });
    const report = auditRepository({ repoRoot, files, identityDigests: owner.identityDigests });
    expect(report.checked).toBe(2);
    expect(report.findings).toEqual([
      expect.stringMatching(/^app\/web\/sites\/portal\/styles\/os\.css:1: 个人邮箱/),
      expect.stringMatching(/^app\/forum\/app\/pages\/index\.vue:1: 本机家目录路径/),
    ]);
  });
});

describe("用户原话形态", () => {
  // 标签、冒号与引号在测试里拼接，避免本文件自己命中门禁
  const quoteHits = (text: string) => scanUserQuotes(text).map(item => item.rule);

  it("标签后紧跟冒号或引号命中，「所有者 + 时间 + 引号」也命中", () => {
    expect(quoteHits(cat("原话", "：", "「", "这是一句话", "」"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("原话", "「", "这是一句话", "」"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("所有者说", "：", "这是一句话"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("所有者", " 22 11", "「", "底部太淡了", "」"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("所有者原话", "：", "真话"))).toEqual(["用户原话形态"]);
  });

  it("所有者或用户后面是日期、时间、在会话中、原话、要求、说、确认之类的前缀，再接引号或冒号，也命中", () => {
    expect(quoteHits(cat("所有者 2026-10-23 19:22", "：", "「", "这是一句话", "」"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("所有者 2026-10-23 19:22 在会话中", "原话", "：", "「", "这是一句话", "」"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("所有者 2026-10-23 19:22 要", "求", "「", "这是一句话", "」"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("所有者 2026-10-23 19:22 确", "认", "：", "「", "这是一句话", "」"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("用户 10-29 23:59 说", "：", "「", "这是一句话", "」"))).toEqual(["用户原话形态"]);
  });

  it("「用户」后面没有日期、时间或动词时不算，普通的用户引号写法也不算", () => {
    expect(quoteHits(cat("用户", "「", "这是一句话", "」"))).toEqual([]);
    expect(quoteHits(cat("普通用户", "「", "访客", "」", "可以看到公开页"))).toEqual([]);
    expect(quoteHits(cat("所有者 2026-10-23 19:22 在会话中", "批准", "：", "[已脱敏]"))).toEqual([]);
    expect(quoteHits(cat("所有者 2026-10-23 19:22 说明", "：", "「", "[已脱敏]", "」"))).toEqual([]);
  });

  it("占位 [已脱敏]、批准摘要、JSON 里的所有者字段与普通引号不算", () => {
    expect(quoteHits(cat("原话", "：", "「", "[已脱敏]", "」"))).toEqual([]);
    expect(quoteHits(cat("原话", "：", "[已脱敏]", "。"))).toEqual([]);
    expect(quoteHits("所有者 2026-10-30 07:43 在会话中批准：按 hotfix 发布")).toEqual([]);
    expect(quoteHits("原话留档；按原话建 #328，没有原话不写")).toEqual([]);
    expect(quoteHits(cat("字面值", "「", "所有者", "」"))).toEqual([]);
    expect(quoteHits(cat("\"approvedBy\": \"", "所有者", "\","))).toEqual([]);
  });

  it("时间加上要求、指示等动词，再接括号或冒号里的原句也命中；批准摘要与占位不算", () => {
    // 动词与标点在测试里拼接，避免本文件自己命中门禁
    expect(quoteHits(cat("2026-09-27 14:20 要", "求预发布的信都发出去", "（", "官方发出的邮件", "）"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("09-26 10:00 指", "示", "：", "先别动"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("2026-09-27 14:20 要", "求", "：", "[已脱敏]"))).toEqual([]);
    expect(quoteHits(cat("2026-10-24 13:45 要", "求", "：", "不论之前还是之后注册的成员都要填年级"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("2026-10-25 15:28 说", "「", "绑定之后是否新建账号", "」"))).toEqual(["用户原话形态"]);
    expect(quoteHits(cat("2026-10-25 15:28 说", "「", "[已脱敏]", "」。在 rc.25 上做 A 项（自测）"))).toEqual([]);
    expect(quoteHits("## 13:56:55 +08:00 · 方案 · #103 · 定位卡顿：CDN 边缘冷")).toEqual([]);
    expect(quoteHits("所有者 2026-10-24 13:45 的要求概括为：不论之前还是之后注册的成员都要填年级")).toEqual([]);
    // 「决定」「一定」「说法」「说明」不是动词；时间与动词之间隔着冒号或逗号也不算
    expect(quoteHits("2026-10-25 15:28 决定：先别动")).toEqual([]);
    expect(quoteHits("2026-10-25 15:28 一定（先别动）")).toEqual([]);
    expect(quoteHits("23:37 说法（test）与 10:18 说明（x）")).toEqual([]);
    expect(quoteHits("2026-10-24 22:01 要求登录，并按权限判定（88d75bce）")).toEqual([]);
    expect(quoteHits("所有者 2026-10-29 13:03 在会话中批准：GitLab 接入统一登录后可访问")).toEqual([]);
    expect(quoteHits("2026-10-30 10:18 验收通过，说明见下")).toEqual([]);
    expect(quoteHits("10:18 说明：没有原话")).toEqual([]);
  });

  it("全仓审计：插入一处命中就失败并报位置，删掉后通过；上游快照不查", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "geek-quote-"));
    dirs.push(repoRoot);
    const files = ["notes/2026-10-30/alice/task_1.md", "docs/components/tuffex/snapshot/a.md"];
    mkdirSync(join(repoRoot, "notes/2026-10-30/alice"), { recursive: true });
    mkdirSync(join(repoRoot, "docs/components/tuffex/snapshot"), { recursive: true });
    writeFileSync(join(repoRoot, files[0]), "- 做了什么：普通记录\n");
    writeFileSync(join(repoRoot, files[1]), `${cat("原话", "：", "「", "上游样例", "」")}\n`);
    expect(auditRepository({ repoRoot, files, identityDigests: owner.identityDigests })).toMatchObject({ ok: true });

    writeFileSync(join(repoRoot, files[0]), `${cat("- 做了什么：", "原话", "：", "「", "这是一句话", "」")}\n`);
    const failed = auditRepository({ repoRoot, files, identityDigests: owner.identityDigests });
    expect(failed.ok).toBe(false);
    expect(failed.findings).toEqual([expect.stringMatching(/^notes\/2026-10-30\/alice\/task_1\.md:1: 用户原话形态/)]);
    expect(failed.findings.join("\n")).not.toContain("这是一句话");

    writeFileSync(join(repoRoot, files[0]), "- 做了什么：批准摘要\n");
    expect(auditRepository({ repoRoot, files, identityDigests: owner.identityDigests }).ok).toBe(true);
  });
});

describe("提交门禁（--commits）", () => {
  // 提交说明里的用户原话形态在测试里拼接，避免本文件自己命中门禁
  const ci = { GIT_AUTHOR_NAME: "CI", GIT_AUTHOR_EMAIL: "ci@example.test", GIT_COMMITTER_NAME: "CI", GIT_COMMITTER_EMAIL: "ci@example.test" };
  const script = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/check-privacy.mjs");

  /** 临时仓库：先一条基线，再每条说明一个空提交；返回 base..HEAD 的范围。 */
  const repo = (commits: { message: string; env?: Record<string, string> }[]) => {
    const dir = mkdtempSync(join(tmpdir(), "geek-commits-"));
    dirs.push(dir);
    const git = (args: string[], env: Record<string, string> = ci) =>
      execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    git(["init", "-q"]);
    git(["commit", "-q", "--no-verify", "--allow-empty", "-m", "基线"]);
    const base = git(["rev-parse", "HEAD"]).trim();
    for (const { message, env } of commits) git(["commit", "-q", "--no-verify", "--allow-empty", "-m", message], { ...ci, ...env });
    return { dir, range: `${base}..HEAD` };
  };

  it("说明里有用户原话形态就失败：只报提交号与类别，不输出原文", () => {
    const { dir, range } = repo([{ message: `记录 ${cat("原话", "：", "「", "这是一句话", "」")}` }]);
    const result = scanCommits({ repoRoot: dir, range });
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([expect.stringMatching(/^[0-9a-f]{10}: 提交说明含用户原话形态/)]);
    expect(result.findings.join("\n")).not.toContain("这是一句话");
  });

  it("说明干净就通过；账号名、本机路径也在说明里命中", () => {
    const clean = repo([{ message: "fix(tooling): 说明写清楚（#328）" }]);
    expect(scanCommits({ repoRoot: clean.dir, range: clean.range })).toMatchObject({ ok: true, checked: 1 });

    const path = repo([{ message: cat("docs: 记录 /Users/", "alice/work 下的路径") }]);
    expect(scanCommits({ repoRoot: path.dir, range: path.range }).findings.join("\n")).toMatch(/本机家目录路径/);

    const owner = repo([{ message: "docs: octocat 确认" }]);
    expect(scanCommits({ repoRoot: owner.dir, range: owner.range, identityDigests: [digest("octocat")] }).findings.join("\n")).toMatch(/个人标识/);
  });

  it("作者或提交者是个人地址就失败；noreply、角色地址与占位域名放行", () => {
    const author = repo([{ message: "fix: x", env: { GIT_AUTHOR_EMAIL: cat("alice@", "qq.com") } }]);
    expect(scanCommits({ repoRoot: author.dir, range: author.range }).findings.join("\n")).toMatch(/作者邮箱是个人地址/);

    const committer = repo([{ message: "fix: x", env: { GIT_COMMITTER_EMAIL: cat("alice@", "qq.com") } }]);
    expect(scanCommits({ repoRoot: committer.dir, range: committer.range }).findings.join("\n")).toMatch(/提交者邮箱是个人地址/);

    for (const address of ["1234567+octocat@users.noreply.github.com", "12-alice@noreply.git.example.com", "notify@mail.example.org", "ci@example.test"]) {
      const allowed = repo([{ message: "fix: x", env: { GIT_AUTHOR_EMAIL: address, GIT_COMMITTER_EMAIL: address } }]);
      expect(scanCommits({ repoRoot: allowed.dir, range: allowed.range }), address).toMatchObject({ ok: true });
    }
  });

  it("--published：从已公开引用可达的提交不再检查，新提交照查；引用解析不到就失败", () => {
    const { dir, range } = repo([{ message: `记录 ${cat("原话", "：", "「", "早已公开的一句", "」")}` }]);
    const git = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    git(["branch", "public-main"]);
    expect(scanCommits({ repoRoot: dir, range, published: ["public-main"] })).toMatchObject({ ok: true, checked: 0 });
    git(["-c", "commit.gpgsign=false", "-c", "user.name=ci", "-c", "user.email=ci@example.invalid", "commit", "-q", "--no-verify", "--allow-empty", "-m", `记录 ${cat("原话", "：", "「", "新进来的一句", "」")}`]);
    const fresh = spawnSync(process.execPath, [script, "--commits", range, "--published", "public-main"], { cwd: dir, encoding: "utf8" });
    expect(fresh.status).toBe(1);
    expect(fresh.stderr).toMatch(/用户原话形态/);
    const missing = spawnSync(process.execPath, [script, "--commits", range, "--published", "no-such-ref"], { cwd: dir, encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("--published 的引用解析不到");
  });

  it("命令行：命中退出 1 且不回显原文，通过退出 0，范围写错报用法", () => {
    const red = repo([{ message: `记录 ${cat("原话", "：", "「", "这是一句话", "」")}` }]);
    const failed = spawnSync(process.execPath, [script, "--commits", red.range], { cwd: red.dir, encoding: "utf8" });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/用户原话形态/);
    expect(`${failed.stdout}${failed.stderr}`).not.toContain("这是一句话");

    const green = repo([{ message: "fix(tooling): 说明写清楚" }]);
    expect(spawnSync(process.execPath, [script, "--commits", green.range], { cwd: green.dir, encoding: "utf8" }).status).toBe(0);

    const usage = spawnSync(process.execPath, [script, "--commits", "main...HEAD"], { cwd: green.dir, encoding: "utf8" });
    expect(usage.status).toBe(1);
    expect(usage.stderr).toContain("用法");
  });
});

describe("登记放行：文件 + 精确值，或文件 + 该行内容的摘要（scripts/privacy-exceptions.json）", () => {
  // 精确值与整行的摘要：登记表只存摘要，不存明文（明文会被门禁自己命中）
  const exact = (value: string) => createHash("sha256").update(value).digest("hex");
  const repoWith = (files: Record<string, string>) => {
    const repoRoot = mkdtempSync(join(tmpdir(), "geek-exceptions-"));
    dirs.push(repoRoot);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repoRoot, file)), { recursive: true });
      writeFileSync(join(repoRoot, file), text);
    }
    return repoRoot;
  };
  const reason = "服务商域名的规范化用例，地址处理需要这个域名";

  it("登记过的精确值放行；同一文件里没登记的同形值照样报", () => {
    const registered = cat("victim@", "gmail.com");
    const other = cat("victim@", "yahoo.com");
    const files = ["tests/server/x.test.ts"];
    const repoRoot = repoWith({ [files[0]]: `const a = "${registered}";\nconst b = "${other}";\n` });
    const exceptions = parseExceptions({ schemaVersion: 1, exceptions: [{ file: files[0], valueSha256: exact(registered), reason }] });
    const result = auditRepository({ repoRoot, files, identityDigests: owner.identityDigests, exceptions });
    expect(result.findings).toEqual([expect.stringMatching(/^tests\/server\/x\.test\.ts:2: 个人邮箱/)]);
  });

  it("精确值按文件放行：同一个值出现在别的文件里照样报", () => {
    const registered = cat("victim@", "gmail.com");
    const files = ["tests/server/y.test.ts"];
    const repoRoot = repoWith({ [files[0]]: `const a = "${registered}";\n` });
    const exceptions = parseExceptions({ schemaVersion: 1, exceptions: [{ file: "tests/server/x.test.ts", valueSha256: exact(registered), reason }] });
    const result = auditRepository({ repoRoot, files, identityDigests: owner.identityDigests, exceptions });
    expect(result.findings).toEqual([expect.stringMatching(/^tests\/server\/y\.test\.ts:1: 个人邮箱/)]);
  });

  it("整行摘要放行：登记过的引语行不报，同文件别的引语行照样报", () => {
    const kept = cat("做了什么：所有者 15:28 说", "「", "这是一句话", "」");
    const other = cat("做了什么：所有者 16:02 说", "「", "另一句话", "」");
    const files = ["notes/2026-10-02/x/task_1.md"];
    const repoRoot = repoWith({ [files[0]]: `${kept}\n${other}\n` });
    const exceptions = parseExceptions({ schemaVersion: 1, exceptions: [{ file: files[0], lineSha256: exact(kept), reason: "引用的不是所有者输入，NOTES §3 不允许改已有记录" }] });
    const result = auditRepository({ repoRoot, files, identityDigests: owner.identityDigests, exceptions });
    expect(result.findings).toEqual([expect.stringMatching(/^notes\/2026-10-02\/x\/task_1\.md:2: 用户原话形态/)]);
  });

  it("本机家目录路径可以按文件与精确值登记放行：只放行登记的那个用户名，同文件别的用户名照样报", () => {
    const registered = cat("/Users/", "ryan");
    const files = ["app/forum/app/data/seed-content.ts"];
    const repoRoot = repoWith({ [files[0]]: `  "source": "${registered}/code/my-plugin",\n  "other": "${cat("/Users/", "alice")}/code",\n` });
    const exceptions = parseExceptions({ schemaVersion: 1, exceptions: [{ file: files[0], valueSha256: exact(registered), reason }] });
    const result = auditRepository({ repoRoot, files, identityDigests: owner.identityDigests, exceptions });
    expect(result.findings).toEqual([expect.stringMatching(/^app\/forum\/app\/data\/seed-content\.ts:2: 本机家目录路径/)]);
  });

  it("只有本机家目录路径能登记放行：令牌形态登记了也照样报", () => {
    const token = cat("gk_", "abcdefghijklmnop", "qrstuv");
    const files = ["tests/server/token.test.ts"];
    const repoRoot = repoWith({ [files[0]]: `const t = "${token}";\n` });
    const exceptions = parseExceptions({ schemaVersion: 1, exceptions: [{ file: files[0], valueSha256: exact(token), reason }] });
    const result = auditRepository({ repoRoot, files, identityDigests: owner.identityDigests, exceptions });
    // 令牌照样报，登记的那条因为没被用上，还要报成「已经不再命中」，两件事都要看到
    expect(result.findings).toEqual([expect.stringMatching(/^tests\/server\/token\.test\.ts:1: 令牌形态/), expect.stringMatching(/已经不再命中/)]);
  });

  it("登记带 maxCount 的，超过次数的那几处照样报；maxCount 必须是正整数", () => {
    const registered = cat("/Users/", "ryan");
    const files = ["app/forum/app/data/seed-content.ts"];
    const repoRoot = repoWith({ [files[0]]: `  "source": "${registered}/code/a",\n  "source": "${registered}/code/b",\n` });
    const exceptions = parseExceptions({ schemaVersion: 1, exceptions: [{ file: files[0], valueSha256: exact(registered), maxCount: 1, reason }] });
    const result = auditRepository({ repoRoot, files, identityDigests: owner.identityDigests, exceptions });
    expect(result.findings).toEqual([expect.stringMatching(/^app\/forum\/app\/data\/seed-content\.ts:2: 本机家目录路径/)]);
    expect(() => parseExceptions({ schemaVersion: 1, exceptions: [{ file: "a.md", valueSha256: exact(registered), maxCount: 0, reason }] })).toThrow(/maxCount/);
    expect(() => parseExceptions({ schemaVersion: 1, exceptions: [{ file: "a.md", valueSha256: exact(registered), maxCount: 1.5, reason }] })).toThrow(/maxCount/);
  });

  it("登记过但已经不再命中的放行要报出来，让人删掉，不留着沉积", () => {
    const files = ["tests/server/x.test.ts"];
    const repoRoot = repoWith({ [files[0]]: 'const a = "ok";\n' });
    const exceptions = parseExceptions({ schemaVersion: 1, exceptions: [{ file: files[0], valueSha256: exact(cat("victim@", "gmail.com")), reason }] });
    const result = auditRepository({ repoRoot, files, identityDigests: owner.identityDigests, exceptions });
    expect(result.findings).toEqual([expect.stringMatching(/^tests\/server\/x\.test\.ts: 登记表里的放行已经不再命中/)]);
  });

  it("登记格式不对就拒绝：缺理由、两种摘要都有或都没有、摘要不是 64 位小写十六进制、路径不是相对路径", () => {
    const digest = exact("x");
    expect(() => parseExceptions({ schemaVersion: 1, exceptions: [{ file: "a.md", valueSha256: digest, reason: "" }] })).toThrow(/理由/);
    expect(() => parseExceptions({ schemaVersion: 1, exceptions: [{ file: "a.md", valueSha256: digest, lineSha256: digest, reason }] })).toThrow(/只能二选一/);
    expect(() => parseExceptions({ schemaVersion: 1, exceptions: [{ file: "a.md", reason }] })).toThrow(/只能二选一/);
    expect(() => parseExceptions({ schemaVersion: 1, exceptions: [{ file: "a.md", valueSha256: digest.toUpperCase(), reason }] })).toThrow(/64 位小写十六进制/);
    expect(() => parseExceptions({ schemaVersion: 1, exceptions: [{ file: "/etc/a.md", valueSha256: digest, reason }] })).toThrow(/相对路径/);
    expect(() => parseExceptions({ schemaVersion: 2, exceptions: [] })).toThrow(/schemaVersion/);
  });

  it("仓库里的登记表格式正确，且不存明文邮箱", () => {
    const path = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/privacy-exceptions.json");
    expect(() => parseExceptions(JSON.parse(readFileSync(path, "utf8")))).not.toThrow();
    expect(readFileSync(path, "utf8")).not.toMatch(/@/);
  });
});

// 登记的精确主机（#346）：公开静态资源域名的主机名本身只在登记过的文件里放行；它的分段（个人标识的同一段）、
// 别的域名和带后缀的主机照常报。登记只存摘要，测试里的主机与分段按同一个常量推出。
describe("登记的精确主机（#346）", () => {
  const HOST = "cdn.crosery.com";
  const SEGMENT = HOST.split(".")[1];
  const hostDigest = createHash("sha256").update(HOST).digest("hex");
  const hostEntry = (file: string, maxCount?: number) => ({ file, kind: "hostSha256", digest: hostDigest, reason: "测试用登记", ...(maxCount === undefined ? {} : { maxCount }) });
  const tree = (files: Record<string, string>) => {
    const repoRoot = mkdtempSync(join(tmpdir(), "geek-privacy-host-"));
    dirs.push(repoRoot);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repoRoot, file)), { recursive: true });
      writeFileSync(join(repoRoot, file), text);
    }
    return repoRoot;
  };

  it("放行登记文件里不超过次数的精确主机", () => {
    const file = "app/web/sites/portal/lib/promo.ts";
    const repoRoot = tree({ [file]: `export const BASE = "https://${HOST}/yzgc/static/promo/";\n` });
    expect(auditRepository({ repoRoot, files: [file], identityDigests: [digest(SEGMENT)], exceptions: [hostEntry(file, 1)] })).toMatchObject({ ok: true, checked: 1 });
  });

  it("未登记的文件里同样的主机照常报", () => {
    const file = "app/web/sites/portal/lib/other.ts";
    const repoRoot = tree({ [file]: `export const BASE = "https://${HOST}/x";\n` });
    const result = auditRepository({ repoRoot, files: [file], identityDigests: [digest(SEGMENT)], exceptions: [] });
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([expect.stringMatching(/^app\/web\/sites\/portal\/lib\/other\.ts:1: 个人标识/)]);
  });

  it("只放行精确主机：裸分段、别的域名、带后缀或用户信息的同段主机都照常报", () => {
    const file = "app/web/sites/portal/lib/lookalike.ts";
    for (const line of [
      `const a = "https://${SEGMENT}/yzgc/x";`,
      `const b = "https://cdn.${SEGMENT}.cn/x";`,
      `const c = "https://${HOST}.evil.example/x";`,
      `const d = "https://${HOST}@evil.example/x";`,
      `const e = "https://evil.example/${SEGMENT}";`,
    ]) {
      const repoRoot = tree({ [file]: `${line}\n` });
      const result = auditRepository({ repoRoot, files: [file], identityDigests: [digest(SEGMENT)], exceptions: [hostEntry(file, 5)] });
      expect(result.ok, line).toBe(false);
      expect(result.findings.join("\n"), line).toMatch(/个人标识/);
    }
  });

  it("超过登记次数的出现照常报，登记过但已不再命中的条目让门禁失败", () => {
    const file = "app/web/sites/portal/lib/twice.ts";
    const repoRoot = tree({ [file]: `const a = "https://${HOST}/a";\nconst b = "https://${HOST}/b";\n` });
    const over = auditRepository({ repoRoot, files: [file], identityDigests: [digest(SEGMENT)], exceptions: [hostEntry(file, 1)] });
    expect(over.findings).toEqual([expect.stringMatching(/^app\/web\/sites\/portal\/lib\/twice\.ts:2: 个人标识/)]);
    const stale = auditRepository({ repoRoot: tree({ [file]: "const a = 1;\n" }), files: [file], identityDigests: [digest(SEGMENT)], exceptions: [hostEntry(file, 1)] });
    expect(stale.ok).toBe(false);
    expect(stale.findings.join("\n")).toMatch(/已经不再命中/);
  });

  it("登记表只接受摘要，不接受明文主机", () => {
    expect(parseExceptions({ schemaVersion: 1, exceptions: [{ file: "a.ts", hostSha256: hostDigest, maxCount: 1, reason: "合法的登记理由" }] })).toEqual([
      expect.objectContaining({ file: "a.ts", kind: "hostSha256", digest: hostDigest, maxCount: 1 }),
    ]);
    expect(() => parseExceptions({ schemaVersion: 1, exceptions: [{ file: "a.ts", hostSha256: "not-a-digest", reason: "合法的登记理由" }] })).toThrow(/摘要/);
  });
});
