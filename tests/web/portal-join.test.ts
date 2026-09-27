import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 「加入我们」的邮箱校验必须和后端同一条：前端放过、后端回 400 的话，投递人要点了寄出才看到错（#148）。
// JoinUs.tsx 连着 3D 场景和样式，不在 node 环境里导入，按源码里的正则字面量核对。
const literal = (path: string, name: string) => {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const match = new RegExp(`const ${name} = (/.+/);\\n`).exec(source);
  expect(match, `${path} 里找不到 ${name}`).not.toBeNull();
  return match![1];
};

describe("join-us email check", () => {
  it("uses the same regex as the apply route", () => {
    expect(literal("app/web/sites/portal/pages/JoinUs.tsx", "EMAIL_RE")).toBe(literal("app/server/src/routes/portal/apply.ts", "EMAIL_REGEX"));
  });
});
