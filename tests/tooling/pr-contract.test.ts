import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REQUIRED_SECTIONS, checkPullRequest, closingIssues, issueFromBranch, sections } from "../../scripts/pr-contract.mjs";

const template = readFileSync(new URL("../../.github/pull_request_template.md", import.meta.url), "utf8");

/** 一份填好的正文：模板的每个段落都写了内容 */
function filled(overrides: Record<string, string> = {}): string {
  const text: Record<string, string> = {
    目的: "所有者反馈开机时先露出桌面。",
    关联: "Closes #32",
    变更范围: "app/web/sites/portal/pages/Home.tsx",
    解决链路: "1. 复现：慢网下点开机。\n2. 定位：开机画面进场渐变透出桌面。\n3. 修复：开机画面不渐变、等壁纸解码。",
    验证命令与结果: "pnpm verify 通过",
    验收证据: "改前 ![before](https://github.com/o/r/assets/1/before.png) 改后 ![after](https://github.com/o/r/assets/1/after.png)",
    人工验收步骤: "1. 打开 https://prev.yangtzeu.work\n2. 点「打开电脑」\n3. 应看到开机画面，桌面不闪",
    审查结论: "审查人：Claude\n\n**结论：通过**",
    风险与回滚: "revert 合并提交",
    ...overrides,
  };
  return REQUIRED_SECTIONS.map((name: string) => `### ${name}\n${text[name] ?? ""}\n`).join("\n");
}

describe("PR 正文契约", () => {
  it("分支号与 issue：只认 task/<n>/<slug>", () => {
    expect(issueFromBranch("task/32/desk_boot_wallpaper")).toBe(32);
    expect(issueFromBranch("task/32-desk")).toBeNull();
    expect(issueFromBranch("dev/crosery")).toBeNull();
    expect(issueFromBranch("stage")).toBeNull();
  });

  it("识别 GitHub 的关闭关键字，Refs 不算", () => {
    expect(closingIssues("Closes #3\nfixes #4, Resolved #5\nRefs #6").sort()).toEqual([3, 4, 5]);
  });

  it("段落按三级标题切分，标题里的括号说明不影响名字", () => {
    const parts = sections("### 验证命令与结果（HEAD abc）\npnpm verify\n### 关联\nCloses #1");
    expect(parts.get("验证命令与结果")).toContain("pnpm verify");
    expect(parts.get("关联")).toContain("Closes #1");
  });

  it("填好的正文 + 开着的 issue：通过", () => {
    const result = checkPullRequest({ branch: "task/32/desk_boot_wallpaper", body: filled(), issue: { number: 32, state: "OPEN" } });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("没写 Closes、关了别的 issue、issue 已关闭：各自报错", () => {
    expect(checkPullRequest({ branch: "task/32/x", body: filled({ 关联: "Refs #32" }) }).errors.join()).toContain("Closes #32");
    expect(checkPullRequest({ branch: "task/32/x", body: filled({ 关联: "Closes #32\nCloses #9" }) }).errors.join()).toContain("#9");
    expect(checkPullRequest({ branch: "task/32/x", body: filled(), issue: { number: 32, state: "CLOSED" } }).errors.join()).toContain("已经关闭");
  });

  it("不是 task 分支的 PR 进不了 stage", () => {
    expect(checkPullRequest({ branch: "dev/crosery", body: filled() }).ok).toBe(false);
  });

  it("缺段落、空段落（只剩模板注释）都报错", () => {
    const missing = filled().replace(/### 人工验收步骤[\s\S]*?(?=### )/, "");
    expect(checkPullRequest({ branch: "task/32/x", body: missing }).errors.join()).toContain("人工验收步骤");
    const empty = filled({ 解决链路: "<!-- 复现 → 定位 → 修复 → 验证 -->" });
    expect(checkPullRequest({ branch: "task/32/x", body: empty }).errors.join()).toContain("是空的");
  });

  it("验收证据要有截图、录屏或附件；没有界面变化时要写明理由", () => {
    expect(checkPullRequest({ branch: "task/32/x", body: filled({ 验收证据: "看过了，没问题" }) }).errors.join()).toContain("截图");
    expect(checkPullRequest({ branch: "task/32/x", body: filled({ 验收证据: "无界面变化：只改了 CI 工作流" }) }).ok).toBe(true);
    expect(checkPullRequest({ branch: "task/32/x", body: filled({ 验收证据: '<img src="https://github.com/o/r/assets/1/a.png" width="600">' }) }).ok).toBe(true);
  });

  it("审查结论要有三种结论之一", () => {
    expect(checkPullRequest({ branch: "task/32/x", body: filled({ 审查结论: "看起来可以" }) }).errors.join()).toContain("结论：通过");
  });

  it("仓库里的 PR 模板本身带齐所有必需段落，且原样提交会因为空段落被拦下", () => {
    const parts = sections(template);
    for (const name of REQUIRED_SECTIONS) expect(parts.has(name), name).toBe(true);
    expect(checkPullRequest({ branch: "task/32/x", body: template }).ok).toBe(false);
  });
});
