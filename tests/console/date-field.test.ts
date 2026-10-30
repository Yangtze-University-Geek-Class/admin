import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #283：控制台的日期都走 components/DateField.vue（Tuffex 日期选择器，中文、周一开头），弹窗不超过视口。
// 所有者 2026-10-24 22:09 指出这个部分没有用 Tuffex 组件库；22:17 指出管理员弹窗太丑。
const SRC = fileURLToPath(new URL("../../app/console/src/", import.meta.url));

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? vueFiles(path) : entry.name.endsWith(".vue") ? [path] : [];
  });
}

describe("控制台的日期框和弹窗（#283）", () => {
  const files = vueFiles(SRC).map(path => ({ path: path.slice(SRC.length), text: readFileSync(path, "utf8") }));
  const field = readFileSync(join(SRC, "components/DateField.vue"), "utf8");
  const controls = readFileSync(join(SRC, "styles/controls.css"), "utf8");

  it("没有原生日期框，TxDatePicker 只在 DateField 里用", () => {
    for (const { path, text } of files) expect(text, path).not.toMatch(/type="date"/);
    const pickers = files.filter(({ text }) => /<TxDatePicker(?=\s|>)/.test(text)).map(({ path }) => path);
    expect(pickers).toEqual(["components/DateField.vue"]);
    const users = files.filter(({ text }) => /<DateField(?=\s|>)/.test(text)).map(({ path }) => path).sort();
    expect(users).toEqual(["pages/Activity.vue", "pages/Competitions.vue", "pages/Invites.vue", "pages/permissions/EntryDialog.vue", "pages/permissions/GroupDetail.vue"]);
  });

  it("DateField 写了中文文案、周一开头，用下拉日历", () => {
    expect(field).toMatch(/title="选择日期"/);
    expect(field).toMatch(/placeholder: "选择日期"/);
    expect(field).toMatch(/confirm-text="确定"/);
    expect(field).toMatch(/cancel-text="取消"/);
    expect(field).toMatch(/:week-starts-on="1"/);
    expect(field).toMatch(/variant="field"/);
  });

  it("星期表头按周一开头换成中文，七天都有", () => {
    const days = [...controls.matchAll(/__weekdays > :nth-child\((\d)\)::after \{ content: "(.)"; \}/g)].map(match => [Number(match[1]), match[2]]);
    expect(days).toEqual([[1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"], [7, "日"]]);
  });

  it("弹窗最高到视口，正文滚动，底部按钮固定", () => {
    expect(controls).toMatch(/\.tx-modal__content:not\(\.tx-modal__content--fullscreen\) \{\s*max-height: calc\(100dvh - 40px\);/);
    expect(controls).toMatch(/> \.tx-modal__body \{[^}]*overflow-y: auto;/);
    expect(controls).toMatch(/> \.tx-modal__footer \{[^}]*flex: none;/);
  });

  it("日期框触控高度不低于 44px，比赛弹窗里和输入框一样高", () => {
    expect(controls).toMatch(/body \.date-field \.tx-date-picker-field \{\s*min-height: 44px;/);
    const competitions = readFileSync(join(SRC, "pages/Competitions.vue"), "utf8");
    expect(competitions).toMatch(/\.competition-form :deep\(\.tx-date-picker-field\) \{\s*min-height: 46px;/);
  });
});
