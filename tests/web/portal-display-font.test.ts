import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appConfig } from "../../app/web/shared/config";

// 标题字体 YG Display 只含子集字形（public/fonts/yg-display.chars.txt）。
// 改了标题文案却没重新生成子集，标题会在词中间回落到系统字体——这里提前拦住。
const subset = new Set(readFileSync(new URL("../../app/web/public/fonts/yg-display.chars.txt", import.meta.url), "utf8"));

function headingCopy(): string[] {
  const { stage, entries } = appConfig.portal;
  return [
    ...stage.chapters.flatMap((chapter) => [chapter.lead, chapter.accent]),
    entries.title,
    ...entries.items.map((item) => item.title),
  ].map((text) => text.replaceAll("`", ""));
}

describe("官网标题子集字体", () => {
  it("首页所有标题用到的字都在子集里", () => {
    const missing = [...new Set(headingCopy().join(""))].filter((char) => !subset.has(char));
    expect(missing).toEqual([]);
  });

  it("子页的固定标题与文档目录名也在子集里", () => {
    const docs = readFileSync(new URL("../../app/server/src/routes/portal/docs.ts", import.meta.url), "utf8");
    const labels = [...docs.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
    expect(labels.length).toBeGreaterThan(0);
    const fixed = ["意见箱", "链接不可用", "邀请已发送", "加入组织", `加入 ${appConfig.portal.brand.title}`, "文档"];
    const missing = [...new Set([...labels, ...fixed].join(""))].filter((char) => !subset.has(char));
    expect(missing).toEqual([]);
  });

  it("投递页标题也在子集里", () => {
    const source = readFileSync(new URL("../../app/web/sites/portal/pages/Apply.tsx", import.meta.url), "utf8");
    const heading = source.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    const title = heading.replace(/<[^>]+>/g, "").replace(/\s+/g, "");
    expect(title.length).toBeGreaterThan(0);
    expect([...title].filter((char) => !subset.has(char))).toEqual([]);
  });
});
