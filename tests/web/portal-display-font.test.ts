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

  it("投递页标题也在子集里", () => {
    const source = readFileSync(new URL("../../app/web/sites/portal/pages/Apply.tsx", import.meta.url), "utf8");
    const title = source.match(/<h1>([^<]+)<\/h1>/)?.[1] ?? "";
    expect(title.length).toBeGreaterThan(0);
    expect([...title].filter((char) => !subset.has(char))).toEqual([]);
  });
});
