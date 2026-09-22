// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { externalUrl } from "../../app/web/shared/lib/site";

afterEach(() => vi.unstubAllEnvs());

it("生产态把论坛指向官网域名下的 /forum 路径", () => {
  vi.stubEnv("DEV", false);
  expect(externalUrl("forum", "/")).toBe(`${location.protocol}//yangtzeu.work/forum/`);
  expect(externalUrl("forum", "/thread/1")).toBe(`${location.protocol}//yangtzeu.work/forum/thread/1`);
});

it("生产态跨端链接仍按各端自身域名拼接，同端保持站内相对路径", () => {
  vi.stubEnv("DEV", false);
  expect(externalUrl("admin", "/admin")).toBe(`${location.protocol}//github.yangtzeu.work/admin`);
  // 当前端就是 portal（默认端），同端跳转不升级成绝对地址
  expect(externalUrl("portal")).toBe("/");
});
