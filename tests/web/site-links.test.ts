// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { externalUrl, forumPath } from "../../app/web/shared/lib/site";

afterEach(() => vi.unstubAllEnvs());

it("生产态论坛链接是同域名下的 /forum 路径，不带域名", () => {
  vi.stubEnv("DEV", false);
  expect(externalUrl("forum", "/")).toBe("/forum/");
  expect(externalUrl("forum", "/thread/1")).toBe("/forum/thread/1");
  expect(forumPath("/thread/1")).toBe("/forum/thread/1");
});

it("生产态管理端链接是同域名下的 /admin 路径，同端保持站内相对路径", () => {
  vi.stubEnv("DEV", false);
  expect(externalUrl("admin", "/admin")).toBe("/admin");
  expect(externalUrl("admin", "/console")).toBe("/console");
  expect(externalUrl("admin", "admin/demo")).toBe("/admin/demo");
  // 当前端就是 portal（默认端），同端跳转保持原样
  expect(externalUrl("portal")).toBe("/");
  for (const url of [externalUrl("forum", "/"), externalUrl("admin", "/admin")]) expect(url).not.toMatch(/^[a-z]+:|^\/\//i);
});

it("开发态保持 /sites/<端>/ 前缀，论坛仍指向本机 3456", () => {
  vi.stubEnv("DEV", true);
  expect(externalUrl("admin", "/admin")).toBe("/sites/admin/admin");
  expect(externalUrl("forum", "/")).toBe("http://127.0.0.1:3456/");
});
