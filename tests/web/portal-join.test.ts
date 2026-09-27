import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateJoin } from "../../app/web/sites/portal/pages/JoinUs";

// 「加入我们」的邮箱校验必须和后端同一条：前端放过、后端回 400 的话，投递人要点了寄出才看到错（#148）。
// 两边的正则按源码里的字面量核对。
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

  it("says what to fix: a missing @, or a stray dot, comma or space", () => {
    const form = (email: string) => validateJoin({ name: "张三", className: "软件2301", email, strengths: "会写 Python，也做过网页。", website: "" }).email;
    expect(form("zhangsan.qq.com")).toBe("邮箱格式不对，检查一下有没有漏掉 @");
    for (const email of ["2021001234@qq.com.", "zhang..san@163.com", "name@qq,com", "\"me\"@qq.com"]) {
      expect(form(email), email).toBe("邮箱格式不对，检查有没有多打的点、逗号或空格");
    }
    expect(form(`${"a".repeat(120)}@qq.com`)).toBe("邮箱最多 120 个字符");
    expect(form("2021001234@qq.com")).toBeUndefined();
  });
});
