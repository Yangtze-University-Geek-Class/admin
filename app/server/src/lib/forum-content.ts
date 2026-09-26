import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 论坛的公开内容文件（#57）：`app/forum/content/curation.json` 里的分类与标签，
 * `app/forum/content/published/topics.json` 里公开的旧帖（#87 导出）。两份都是论坛仓库里入库的公开文件，
 * server 镜像把它们复制到同样的相对位置（app/server/Dockerfile），启动时读一次。
 *
 * 只读、只校验，不碰数据库：播种在 `forum-store.ts` 的 `seed`。文件缺失、形状不对、
 * 引用不存在的分类或标签都直接抛错，让服务启动失败，而不是带着半份内容上线。
 */

export type ForumCategory = { id: string; slug: string; name: string; description: string; color: string; icon: string };
export type ForumTag = { id: string; slug: string; name: string; color: string };
export type ForumAuthor = { id: string; username: string; displayName: string; bio: string; avatarColor: string; role: "admin" | "moderator" | "member" };
export type PublishedTopic = {
  id: string; slug: string; title: string; categoryId: string; tagIds: string[];
  pinned: boolean; createdAt: number; lastActivityAt: number; views: number; content: string;
};
export type ForumContent = { categories: ForumCategory[]; tags: ForumTag[]; author: ForumAuthor; topics: PublishedTopic[] };

/** 旧帖沿用旧编号，都小于 1000；新话题从 t1001 起，不会撞号。 */
export const LEGACY_TOPIC_ID = /^t([1-9][0-9]{0,2})$/;
const CATEGORY_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const TAG_ID = /^tag-[a-z0-9][a-z0-9-]{0,39}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const ICON = /^i-[a-z0-9]+-[a-z0-9-]+$/;

class ForumContentError extends Error {}
const fail = (file: string, message: string): never => { throw new ForumContentError(`forum content ${file}: ${message}`); };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readJson(dir: string, file: string): unknown {
  try {
    return JSON.parse(readFileSync(join(dir, file), "utf8"));
  } catch (cause) {
    return fail(file, `cannot read (${(cause as Error).message})`);
  }
}

function text(file: string, value: unknown, field: string, max: number, pattern?: RegExp, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && value.trim() === "") || (pattern && !pattern.test(value))) {
    return fail(file, `invalid ${field}`);
  }
  return value;
}

function timestamp(file: string, value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return fail(file, `invalid ${field}`);
  return value;
}

/**
 * 分类按 `categoryOrder` 排（和论坛前端 `siteForumState` 一致）：清单里有、但不是本文件分类的 id 跳过，
 * 不在清单里的分类按文件顺序排在后面。
 */
function parseCuration(raw: unknown): { categories: ForumCategory[]; tags: ForumTag[] } {
  const file = "curation.json";
  if (!isRecord(raw) || !Array.isArray(raw.categories) || !Array.isArray(raw.tags)) return fail(file, "needs categories and tags arrays");
  const order = Array.isArray(raw.categoryOrder) ? raw.categoryOrder.filter((id): id is string => typeof id === "string") : [];
  const rank = new Map(order.map((id, index) => [id, index]));
  const categories = raw.categories.map((item, index): ForumCategory & { index: number } => {
    if (!isRecord(item)) return fail(file, `category #${index} is not an object`);
    return {
      id: text(file, item.id, "category id", 40, CATEGORY_ID), slug: text(file, item.slug, "category slug", 64, SLUG),
      name: text(file, item.name, "category name", 40), description: text(file, item.description ?? "", "category description", 300, undefined, true),
      color: text(file, item.color, "category color", 7, COLOR), icon: text(file, item.icon, "category icon", 80, ICON), index,
    };
  });
  const tags = raw.tags.map((item, index): ForumTag => {
    if (!isRecord(item)) return fail(file, `tag #${index} is not an object`);
    return {
      id: text(file, item.id, "tag id", 44, TAG_ID), slug: text(file, item.slug, "tag slug", 64, SLUG),
      name: text(file, item.name, "tag name", 30), color: text(file, item.color, "tag color", 7, COLOR),
    };
  });
  for (const [label, list] of [["category", categories], ["tag", tags]] as const) {
    const ids = new Set<string>(); const slugs = new Set<string>();
    for (const item of list) {
      if (ids.has(item.id) || slugs.has(item.slug)) fail(file, `duplicate ${label} ${item.id}`);
      ids.add(item.id); slugs.add(item.slug);
    }
  }
  if (categories.length === 0) fail(file, "needs at least one category");
  categories.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);
  return { categories: categories.map(({ index: _index, ...category }) => category), tags };
}

function parsePublished(raw: unknown, categories: ForumCategory[], tags: ForumTag[]): { author: ForumAuthor; topics: PublishedTopic[] } {
  const file = "published/topics.json";
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !isRecord(raw.author) || !Array.isArray(raw.topics)) return fail(file, "needs schemaVersion 1, author and topics");
  const a = raw.author;
  const role = a.role === "admin" || a.role === "moderator" || a.role === "member" ? a.role : fail(file, "invalid author role");
  const author: ForumAuthor = {
    id: text(file, a.id, "author id", 40, /^u-[a-z0-9-]{1,32}$/), username: text(file, a.username, "author username", 30, /^[a-z0-9_-]+$/),
    displayName: text(file, a.displayName, "author displayName", 30), bio: text(file, a.bio ?? "", "author bio", 200, undefined, true),
    avatarColor: text(file, a.avatarColor, "author avatarColor", 7, COLOR), role,
  };
  const categoryIds = new Set(categories.map(item => item.id));
  const tagIds = new Set(tags.map(item => item.id));
  const seen = new Set<string>();
  const topics = raw.topics.map((item, index): PublishedTopic => {
    if (!isRecord(item)) return fail(file, `topic #${index} is not an object`);
    const id = text(file, item.id, "topic id", 4, LEGACY_TOPIC_ID);
    if (seen.has(id)) fail(file, `duplicate topic ${id}`);
    seen.add(id);
    const categoryId = text(file, item.categoryId, `${id} categoryId`, 40);
    if (!categoryIds.has(categoryId)) fail(file, `${id} uses unknown category ${categoryId}`);
    if (!Array.isArray(item.tagIds) || item.tagIds.some(tag => typeof tag !== "string" || !tagIds.has(tag))) fail(file, `${id} uses an unknown tag`);
    const createdAt = timestamp(file, item.createdAt, `${id} createdAt`);
    const views = item.views ?? 0;
    if (typeof views !== "number" || !Number.isSafeInteger(views) || views < 0) fail(file, `invalid ${id} views`);
    return {
      id, slug: text(file, item.slug, `${id} slug`, 64, SLUG), title: text(file, item.title, `${id} title`, 120),
      categoryId, tagIds: [...new Set(item.tagIds as string[])], pinned: item.pinned === true,
      createdAt, lastActivityAt: Math.max(createdAt, timestamp(file, item.lastActivityAt ?? createdAt, `${id} lastActivityAt`)),
      views: views as number, content: text(file, item.content, `${id} content`, 200_000),
    };
  });
  return { author, topics };
}

/** 读 `<dir>/curation.json` 与 `<dir>/published/topics.json`。 */
export function loadForumContent(dir: string): ForumContent {
  const { categories, tags } = parseCuration(readJson(dir, "curation.json"));
  const { author, topics } = parsePublished(readJson(dir, "published/topics.json"), categories, tags);
  return { categories, tags, author, topics };
}
