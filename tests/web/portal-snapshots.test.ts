import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { snapshotLabel, type ForumSnapshot, type RepoList } from "../../app/web/sites/portal/lib/snapshots";

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../../app/web/public/portal/${name}`, import.meta.url), "utf8")) as T;

describe("官网静态快照", () => {
  it("论坛最新话题快照结构完整，带抓取日期", () => {
    const forum = read<ForumSnapshot>("forum-latest.json");
    expect(forum.summary.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(forum.latest.length).toBeGreaterThan(0);
    for (const topic of forum.latest) {
      expect(topic.slug).toMatch(/^[a-z0-9-]+$/);
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(Number.isFinite(topic.at)).toBe(true);
    }
    for (const category of forum.summary.categories) expect(category.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("公开仓库快照只包含公开信息，链接都在本组织下", () => {
    const list = read<RepoList>("repos.json");
    expect(list.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(list.repos.length).toBeGreaterThan(0);
    for (const repo of list.repos) {
      expect(repo.url.startsWith(`https://github.com/${list.org}/`)).toBe(true);
      expect(repo.pushed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("界面标签只取日期部分", () => {
    expect(snapshotLabel("2026-09-12T19:03:18Z")).toBe("快照 2026-09-12");
    expect(snapshotLabel(undefined)).toBe("快照");
  });
});
