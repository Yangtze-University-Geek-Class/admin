import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(`${process.cwd()}/app/web/sites/portal/${path}`, "utf8");

// 「加入我们」「意见箱」窗口打开时才预取的分包 CSS 取失败（浏览器缓存里坏了一份），整个窗口就打不开；
// pages.css 随应用入口加载，两个窗口不再各自引用它（#310）。
describe("窗口表单样式随入口加载（#310）", () => {
  it("加入我们和意见箱不再各自 import pages.css", () => {
    expect(source("components/os/JoinBox.tsx")).not.toContain("styles/pages.css");
    expect(source("components/os/FeedbackBox.tsx")).not.toContain("styles/pages.css");
  });

  it("应用入口 App 引入 pages.css，窗口和页面共用同一份入口样式", () => {
    expect(source("App.tsx")).toContain('import "./styles/pages.css";');
  });
});
