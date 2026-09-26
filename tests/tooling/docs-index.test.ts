// docs/INDEX.md 的生成与平台无关（#121）：Windows 上 path.relative 给出反斜杠，生成的链接、目录分节和
// 目录说明都要和 Linux 上一样用 /，否则 Windows 上 --check 对未改动的 stage 也不通过、重新生成会写出坏的索引。
import { win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { buildIndex, docRel } from "../../scripts/docs-index.mjs";

const doc = (title: string, summary: string) => `# ${title}\n\n> ${summary}\n\n正文\n`;

describe("docs-index", () => {
  it("把 Windows 的文件路径换成用 / 的相对路径", () => {
    expect(docRel("C:\\repo\\docs", "C:\\repo\\docs\\services\\console\\README.md", win32)).toBe("services/console/README.md");
    expect(docRel("C:\\repo\\docs", "C:\\repo\\docs\\README.md", win32)).toBe("README.md");
  });

  it("从 Windows 路径收集到的文档生成的索引：链接用 /，子目录成节，目录 README 只当说明不进表格", () => {
    const root = "C:\\repo\\docs";
    const files: Record<string, string> = {
      "C:\\repo\\docs\\README.md": doc("文档与规范总入口", "总入口"),
      "C:\\repo\\docs\\conventions\\README.md": doc("规范", "强制遵守的规范"),
      "C:\\repo\\docs\\conventions\\AGENT-START.md": doc("Agent 首步", "先读规范"),
      "C:\\repo\\docs\\conventions\\COMMITS.md": doc("提交", "中文说明"),
      "C:\\repo\\docs\\conventions\\COMMITS.en.md": doc("Commits", "English"),
      "C:\\repo\\docs\\services\\console\\README.md": doc("控制台", "控制台服务合同"),
      "C:\\repo\\docs\\ops\\DEPLOY.md": doc("部署", "两套栈"),
    };
    const index = buildIndex(Object.entries(files).map(([file, text]) => ({ rel: docRel(root, file, win32), text })));

    expect(index).not.toContain("\\");
    expect(index).toContain("| [`AGENT-START.md`](./conventions/AGENT-START.md) | 先读规范 | — |");
    expect(index).toContain("| [`COMMITS.md`](./conventions/COMMITS.md) | 中文说明 | [EN](./conventions/COMMITS.en.md) |");
    expect(index).toContain("## services/console/\n\n控制台服务合同\n");
    expect(index.split("\n").filter((line) => line.startsWith("| [`README.md`]"))).toEqual([]);
    // 顶层目录按固定顺序：conventions、services 在 ops 前面，子目录跟着顶层目录走
    const order = ["## conventions/", "## services/console/", "## ops/"].map((heading) => index.indexOf(heading));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
