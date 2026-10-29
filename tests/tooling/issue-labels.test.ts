import { describe, expect, it } from "vitest";
import { REQUIRED_SECTIONS, checkPullRequest } from "../../scripts/pr-contract.mjs";
import { TYPE_LABELS, TYPE_LABEL_SINCE, checkIssue, findSimilar, formSection, groupsOf, labelDefinitions, labelsFromForm, typeLabels } from "../../scripts/issue-labels.mjs";

const shot = "![现状](https://github.com/o/r/assets/1/a.png)";

describe("改动类型标签", () => {
  it("三组十一类，组决定证明", () => {
    expect(TYPE_LABELS).toHaveLength(11);
    expect([...groupsOf(["ui:layout", "func:api", "P1", "portal"])].sort()).toEqual(["func", "ui"]);
    expect(typeLabels([{ name: "ui:visual" }, "docs", "infra:ci"])).toEqual(["ui:visual", "infra:ci"]);
  });

  it("仓库标签定义含 needs-evidence，且每个都有说明", () => {
    const defs = labelDefinitions();
    expect(defs.map((d: { name: string }) => d.name)).toContain("needs-evidence");
    for (const def of defs) expect(def.description.length).toBeGreaterThan(4);
  });

  it("表单下拉的选中值转成标签，忽略未知项和未填", () => {
    const body = "### 改动类型\n\nui:layout — 版式, func:api — 路由\n\n### 其它\n\nx";
    expect(labelsFromForm(body)).toEqual(["ui:layout", "func:api"]);
    expect(labelsFromForm("### 改动类型\n\n_No response_")).toEqual([]);
    expect(labelsFromForm("### 改动类型\n\n随便写")).toEqual([]);
    expect(formSection("### 涉及接口\n\nPOST /api/x\n### 下一段\nz", "涉及接口")).toBe("POST /api/x");
  });
});

describe("issue 检查", () => {
  it("规范生效前的旧 issue 一律放行", () => {
    expect(checkIssue({ number: TYPE_LABEL_SINCE - 1, labels: [], body: "" }).ok).toBe(true);
  });

  it("没有「组:类」标签不通过", () => {
    const result = checkIssue({ number: TYPE_LABEL_SINCE, labels: ["portal", "P1"], body: shot });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("缺少改动类型标签");
  });

  it("ui 要截图，写了文字没有图不行；裸文件名与本机路径必须拒绝", () => {
    expect(checkIssue({ number: 300, labels: ["ui:layout"], body: "手机上溢出了" }).ok).toBe(false);
    expect(checkIssue({ number: 300, labels: ["ui:layout"], body: "截图为 portal-phone-sheet.png 未上传" }).ok).toBe(false);
    expect(checkIssue({ number: 300, labels: ["ui:layout"], body: "截图在 /tmp/sheet.png" }).ok).toBe(false);
    expect(checkIssue({ number: 300, labels: ["ui:layout"], body: `手机上溢出了 ${shot}` }).ok).toBe(true);
    expect(checkIssue({ number: 300, labels: ["ui:layout"], body: "<!-- ![x](a.png) -->没有图" }).ok).toBe(false);
  });

  it("func 要写涉及接口，或写无接口变更的理由", () => {
    expect(checkIssue({ number: 300, labels: ["func:api"], body: "改接口" }).ok).toBe(false);
    expect(checkIssue({ number: 300, labels: ["func:api"], body: "### 涉及接口\n\nPOST /api/forum/topics，400 缺标题" }).ok).toBe(true);
    expect(checkIssue({ number: 300, labels: ["func:data"], body: "### 涉及接口\n\n无接口变更：只迁移历史数据" }).ok).toBe(true);
    expect(checkIssue({ number: 300, labels: ["func:data"], body: "### 涉及接口\n\n无接口变更：" }).ok).toBe(false);
  });

  it("基础设施类不要截图也不要接口", () => {
    expect(checkIssue({ number: 300, labels: ["infra:ci"], body: "改工作流" }).ok).toBe(true);
  });

  // #298：needs-evidence 既是这个检查的输入，又是 issue-gate 判定要不要打它的输出。
  // 不区分调用方就会自锁：标签在 → 报错 → 认为还缺证据 → 永远不摘 → 标签一直在。
  it("带 needs-evidence 的 issue：开工门禁拒绝，但 issue-gate 能判定它已补齐（#298）", () => {
    const labels = ["ui:layout", "needs-evidence"];
    const body = `手机上溢出了 ${shot}`;

    // 开工门禁（task.mjs start 用它）：带标签就不得开工，这条不能放宽
    const gate = checkIssue({ number: 300, labels, body });
    expect(gate.ok).toBe(false);
    expect(gate.errors.join()).toContain("needs-evidence");

    // issue-gate（决定要不要摘标签）：忽略标签本身后应当通过，否则摘除条件永远不成立
    const gated = checkIssue({ number: 300, labels, body, ignoreEvidenceLabel: true });
    expect(gated.ok).toBe(true);
    expect(gated.errors).toEqual([]);
    expect(gated.evidenceLabeled).toBe(true);
  });

  it("ignoreEvidenceLabel 不掩盖真正缺的证据（#298）", () => {
    // 没有截图：即使忽略标签本身，也必须仍然不通过，否则会把缺证据的 issue 放行
    const gated = checkIssue({ number: 300, labels: ["ui:layout", "needs-evidence"], body: "手机上溢出了，图还没传", ignoreEvidenceLabel: true });
    expect(gated.ok).toBe(false);
    expect(gated.errors.join()).toContain("截图");
    expect(gated.evidenceLabeled).toBe(true);
  });

  it("没有 needs-evidence 时 evidenceLabeled 为 false，开工门禁照常通过", () => {
    const gate = checkIssue({ number: 300, labels: ["infra:ci"], body: "改工作流" });
    expect(gate.ok).toBe(true);
    expect(gate.evidenceLabeled).toBe(false);
  });

  it("跨类的两边都要满足", () => {
    const result = checkIssue({ number: 300, labels: ["ui:visual", "func:api"], body: "没图没接口" });
    expect(result.errors).toHaveLength(2);
  });
});

describe("相似 issue", () => {
  const others = [
    { number: 206, title: "portal：竖屏书桌改放手机，移动端 YUGC OS 改为 iPhone 主屏幕形态", state: "CLOSED" },
    { number: 183, title: "portal：官网移动端适配——手机上首屏要等、菜单栏与图标不是手指尺寸", state: "CLOSED" },
    { number: 72, title: "deploy：换服务器要能一条命令备份和恢复，论坛数据跟着走", state: "CLOSED" },
  ];
  it("手机端窗口的新单能找到手机端的旧单，找不到无关的部署单", () => {
    const hits = findSimilar({ number: 233, title: "portal：移动端 YUGC OS 交互与窗口模型重构为 iOS 风格", body: "" }, others);
    expect(hits.map((h: { number: number }) => h.number)).toContain(206);
    expect(hits.map((h: { number: number }) => h.number)).not.toContain(72);
  });
  it("正文里直接提到的 issue 一定入选", () => {
    const hits = findSimilar({ number: 400, title: "forum：别的事", body: "续作，Refs #72" }, others);
    expect(hits.map((h: { number: number }) => h.number)).toContain(72);
  });
  it("不把自己算进去", () => {
    expect(findSimilar({ number: 206, title: others[0].title, body: "" }, others).every((h: { number: number }) => h.number !== 206)).toBe(true);
  });
  it("短标题完全相同一定命中", () => {
    const list = [{ number: 99, title: "portal：分页", state: "CLOSED" }];
    const hits = findSimilar({ number: 100, title: "portal：分页", body: "" }, list);
    expect(hits.map((h: { number: number }) => h.number)).toContain(99);
  });
});

describe("PR 与标签", () => {
  const sections = (over: Record<string, string> = {}) => {
    const text: Record<string, string> = {
      目的: "x", 关联: "Closes #300", 变更范围: "x", 解决链路: "x", 验证命令与结果: "pnpm verify 通过", 验收证据: "无界面变化：只改脚本",
      人工验收步骤: "x", 审查结论: "**结论：通过**", 风险与回滚: "x", ...over,
    };
    return REQUIRED_SECTIONS.map((name: string) => `### ${name}\n${text[name]}\n`).join("\n");
  };
  const issue = (labels: string[]) => ({ number: 300, state: "OPEN", labels });
  const run = (labels: string[], prLabels: string[], over: Record<string, string> = {}) =>
    checkPullRequest({ branch: "task/300/x", body: sections(over), labels: prLabels, issue: issue(labels) });

  it("基础设施类的 issue：写无界面变化照旧通过", () => {
    expect(run(["infra:ci"], ["infra:ci"]).ok).toBe(true);
  });
  it("PR 标签没覆盖 issue 的标签不通过", () => {
    const result = run(["infra:ci", "func:api"], ["infra:ci"], { 验证命令与结果: "无接口变更：只改文档说明" });
    expect(result.errors.join()).toContain("func:api");
  });
  it("ui：不接受无界面变化、裸文件名；必须具备改前改后两组证据", () => {
    expect(run(["ui:layout"], ["ui:layout"]).errors.join()).toContain("不能写「无界面变化」");
    expect(run(["ui:layout"], ["ui:layout"], { 验收证据: "portal-phone-sheet.png" }).errors.join()).toContain("没有有效截图");
    expect(run(["ui:layout"], ["ui:layout"], { 验收证据: "无界面变化：只改脚本 /tmp/before.png" }).errors.join()).toContain("不能写「无界面变化」");
    expect(run(["ui:layout"], ["ui:layout"], { 验收证据: `只有一张改后图片 ${shot}` }).errors.join()).toContain("改前与改后两组证据");
    expect(run(["ui:layout"], ["ui:layout"], { 验收证据: `改前 ${shot} 改后 ${shot}` }).ok).toBe(true);
  });
  it("PR 自身没有类型标签时不通过", () => {
    expect(run(["ui:layout"], []).errors.join()).toContain("PR 缺少改动类型标签");
  });
  it("func：要接口测试命令、方法路径和状态码；或写无接口变更的理由", () => {
    expect(run(["func:api"], ["func:api"]).ok).toBe(false);
    expect(run(["func:api"], ["func:api"], { 验证命令与结果: "pnpm test tests/server/forum.test.ts 通过\nPOST /api/forum/topics -> 201 requestId=abc" }).ok).toBe(true);
    expect(run(["func:api"], ["func:api"], { 验证命令与结果: "pnpm typecheck 通过，构建成功" }).ok).toBe(false);
    expect(run(["func:data"], ["func:data"], { 验证命令与结果: "无接口变更：只补迁移脚本" }).ok).toBe(true);
  });
  it("旧 issue（编号小于生效线）不受影响", () => {
    const result = checkPullRequest({ branch: "task/32/x", body: sections({ 关联: "Closes #32" }), labels: [], issue: { number: 32, state: "OPEN", labels: ["ui:layout"] } });
    expect(result.ok).toBe(true);
  });
  it("没有取到 issue 标签但 PR 声明了自身标签时通过", () => {
    expect(checkPullRequest({ branch: "task/300/x", body: sections(), labels: ["infra:ci"], issue: { number: 300, state: "OPEN" } }).ok).toBe(true);
  });
});

describe("提单检查评论", () => {
  it("未通过时列出缺的和相似的，通过时只留相似", async () => {
    const { buildGateComment, ISSUE_GATE_MARKER } = await import("../../scripts/issue-gate.mjs");
    const bad = buildGateComment({ errors: ["缺截图"], similar: [{ number: 206, title: "portal：手机", state: "CLOSED", linked: true }], added: ["ui:layout"] });
    expect(bad.startsWith(ISSUE_GATE_MARKER)).toBe(true);
    expect(bad).toContain("未通过");
    expect(bad).toContain("- 缺截图");
    expect(bad).toContain("#206 portal：手机（已关闭，正文提到）");
    expect(bad).toContain("`ui:layout`");
    const ok = buildGateComment({ errors: [], similar: [], added: [] });
    expect(ok).toContain("通过");
    expect(ok).not.toContain("需要补的");
    expect(ok).toContain("已搜关键词");
  });
});

describe("按内容推测标签", () => {
  it("手机溢出、触控的描述推测出界面类", async () => {
    const { suggestLabels } = await import("../../scripts/issue-labels.mjs");
    const got = suggestLabels("portal：390×844 竖屏溢出，下拉手势关不掉窗口");
    expect(got).toContain("ui:layout");
    expect(got).toContain("ui:interaction");
  });
  it("接口和登录的描述推测出功能类，没有命中返回空", async () => {
    const { suggestLabels } = await import("../../scripts/issue-labels.mjs");
    expect(suggestLabels("server：POST /api/auth 登录返回 500 状态码")).toEqual(expect.arrayContaining(["func:api", "func:auth"]));
    expect(suggestLabels("随便聊聊")).toEqual([]);
  });
  it("评论里给出推测和添加命令，但标明不自动添加", async () => {
    const { buildGateComment } = await import("../../scripts/issue-gate.mjs");
    const text = buildGateComment({ errors: ["缺少改动类型标签"], similar: [], added: [], suggested: ["ui:layout"], number: 300 });
    expect(text).toContain("不会自动添加");
    expect(text).toContain("gh issue edit 300 --add-label ui:layout");
  });
});
