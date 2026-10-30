import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/pr-agent.yml", import.meta.url), "utf8");

// 网关地址没配时审查步骤不运行：空值会让 PR-Agent 回落到默认端点，模型 key 就发了出去（#244）。
it("审查步骤只在仓库变量 PR_AGENT_API_BASE 有值时运行，并且条件写在 uses 之前", () => {
  const start = workflow.indexOf("      - name: PR-Agent 审查\n");
  expect(start).toBeGreaterThan(0);
  const step = workflow.slice(start);
  const condition = step.indexOf("        if: ${{ vars.PR_AGENT_API_BASE != '' }}\n");
  expect(condition).toBeGreaterThan(0);
  expect(condition).toBeLessThan(step.indexOf("        uses: docker://"));
});
