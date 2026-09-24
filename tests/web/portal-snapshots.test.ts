import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ForumSnapshot, RepoList } from "../../app/web/sites/portal/lib/snapshots";

const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../../app/web/public/portal/${name}`, import.meta.url), "utf8")) as T;
const curation = JSON.parse(readFileSync(new URL("../../app/forum/content/curation.json", import.meta.url), "utf8")) as {
  topics: Record<string, { title: string }>;
};

const TOPIC_FIELDS = ["at", "category", "categorySlug", "color", "id", "replies", "title", "views"];

describe("官网静态快照", () => {
  it("论坛最新话题快照结构完整，带抓取日期", () => {
    const forum = read<ForumSnapshot>("forum-latest.json");
    expect(forum.summary.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(forum.latest.length).toBeGreaterThan(0);
    for (const topic of forum.latest) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(Number.isFinite(topic.at)).toBe(true);
    }
    for (const category of forum.summary.categories) expect(category.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("论坛快照只收录仓库里已公开编辑的话题，链接用论坛能解析的话题 id，不带作者等个人信息", () => {
    const forum = read<ForumSnapshot>("forum-latest.json");
    for (const topic of forum.latest) {
      // 字段白名单：作者、用户名等任何额外字段都会让它失败
      expect(Object.keys(topic).sort(), topic.id).toEqual(TOPIC_FIELDS);
      // 论坛话题路由是 /t/<id>（id 形如 t84），slug（topic-84）打不开
      expect(topic.id).toMatch(/^t\d+$/);
      expect(curation.topics[topic.id]?.title, topic.id).toBe(topic.title);
    }
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
});
