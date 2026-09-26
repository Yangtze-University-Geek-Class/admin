import type { FastifyInstance } from "fastify";
import { ForumError, hasControlChars } from "../../lib/forum-rules.js";
import { can, forbidden, forumState, forumViewer, notFound, rateLimited, requireMember } from "./viewer.js";

type TopicParams = { topic_id: string };

/** 看帖、发帖、话题浏览数与版务（置顶、关闭）。 */
export default async function forumTopicRoutes(app: FastifyInstance) {
  const { forum, config } = app.services;
  const { audit } = app.services.storage;

  app.get("/api/forum/state", async req => ({ state: forumState(req, await forumViewer(req)) }));

  /** 只有成员能发帖；游客只能回复。 */
  app.post<{ Body: { title: string; categoryId: string; tags?: string[]; content: string } }>("/api/forum/topics", async (req, reply) => {
    const viewer = await requireMember(req);
    const title = req.body.title.trim();
    if (!title || hasControlChars(title)) throw new ForumError(400, "invalid_title", "标题不能为空，也不能含控制字符");
    if (!forum.hasCategory(req.body.categoryId)) throw new ForumError(400, "unknown_category", "没有这个分类");
    const tags = req.body.tags ?? [];
    if (tags.some(tag => !tag.trim() || hasControlChars(tag))) throw new ForumError(400, "invalid_tag", "标签不能为空，也不能含控制字符");
    if (!req.body.content.trim()) throw new ForumError(400, "empty_content", "正文不能为空");
    if (!forum.rateAllowed("topic", viewer.userId)) throw rateLimited();
    const { topicId, postId } = forum.createTopic({ authorId: viewer.userId, title, categoryId: req.body.categoryId, tags, content: req.body.content });
    forum.rateRecord("topic", viewer.userId);
    return reply.code(201).send({ state: forumState(req, viewer), topicId, postId });
  });

  /** 置顶与关闭：按 forum.topic.pin / forum.topic.close 授权，写审计（只记开关，不记正文）。 */
  for (const [action, field, capability, label] of [
    ["pin", "pinned", "forum.topic.pin", "置顶话题"],
    ["close", "closed", "forum.topic.close", "关闭话题"],
  ] as const) {
    app.post<{ Params: TopicParams; Body: Record<typeof field, boolean> }>(`/api/forum/topics/:topic_id/${action}`, async req => {
      const viewer = await requireMember(req);
      if (!can(viewer, capability)) throw forbidden(`需要「${label}」权限`);
      const topic = forum.topic(req.params.topic_id);
      if (!topic) throw notFound("话题不存在");
      const value = req.body[field];
      if (action === "pin") forum.setPinned(topic.id, value); else forum.setClosed(topic.id, value);
      audit(config.consoleOrg, viewer.login, `forum.topic.${action}`, topic.id, { [field]: value }, req.ip);
      return { state: forumState(req, viewer) };
    });
  }

  /** 浏览数 +1：所有人都能调，同一 IP 同一话题一小时只算一次。 */
  app.post<{ Params: TopicParams }>("/api/forum/topics/:topic_id/view", async (req, reply) => {
    if (!forum.topic(req.params.topic_id)) throw notFound("话题不存在");
    forum.recordView(req.params.topic_id, req.ip);
    return reply.code(204).send();
  });
}
