import type { FastifyInstance } from "fastify";
import { FORUM_LIMITS, ForumError, GUEST_POST_SITE_SUBJECT, NAME_RULE_MESSAGE, ipSubject, isAllowedName, normalizeName } from "../../lib/forum-rules.js";
import { can, forbidden, forumState, forumViewer, guestRepliesPaused, notFound, rateLimited, requireMember, type MemberViewer } from "./viewer.js";

type PostParams = { post_id: string };
type ReplyBody = {
  topicId: string; content: string; replyToPostId?: string;
  guest?: { name: string }; pow?: { timestamp: number; nonce: string }; website?: string; turnstileToken?: string;
};

/** 回复（成员与游客）、编辑、删除、点赞、收藏。 */
export default async function forumPostRoutes(app: FastifyInstance) {
  const { forum, config, publicSubmission, turnstile } = app.services;
  const { audit } = app.services.storage;

  /** 帖子存在（可能已软删除，删掉的帖子不能再编辑或点赞，见 assertNotDeleted）。 */
  function existingPost(postId: string) {
    const post = forum.post(postId);
    if (!post) throw notFound("帖子不存在");
    return post;
  }
  const assertNotDeleted = (post: { deleted: boolean }) => {
    if (post.deleted) throw new ForumError(409, "post_deleted", "这条帖子已被删除");
  };
  /** 作者本人或持有 forum.post.moderate 的人；返回是不是在动别人的帖子（要审计）。 */
  function authorOrModerator(viewer: MemberViewer, post: { authorId: string }, action: string): boolean {
    if (post.authorId === viewer.userId) return false;
    if (!can(viewer, "forum.post.moderate")) throw forbidden(`只能${action}自己的帖子`);
    return true;
  }

  /**
   * 回复。成员直接发；游客（没有有效 sid，或已不是组织成员）另带昵称、PoW 与空的蜜罐字段，正文上限 2000 字，
   * 每个 IP（IPv6 按 /64）每分钟 5 次、每天 30 次，全站游客回复每小时 200 次。话题已关闭时只有持 forum.post.moderate 的人能回。
   */
  app.post<{ Body: ReplyBody }>("/api/forum/posts", async (req, reply) => {
    const viewer = await forumViewer(req);
    const { topicId, content, replyToPostId } = req.body;
    const topic = forum.topic(topicId);
    if (!topic) throw notFound("话题不存在");
    if (topic.closed && !can(viewer, "forum.post.moderate")) throw forbidden("话题已关闭，不能回复");
    if (replyToPostId && forum.post(replyToPostId)?.topicId !== topic.id) throw new ForumError(400, "invalid_reply_target", "被回复的帖子不在这个话题里");
    if (!content.trim()) throw new ForumError(400, "empty_content", "正文不能为空");

    if (viewer.kind === "member") {
      if (!forum.rateAllowed("reply", viewer.userId)) throw rateLimited();
      const postId = forum.createPost({ topicId, authorId: viewer.userId, content, replyToPostId });
      forum.rateRecord("reply", viewer.userId);
      return reply.code(201).send({ state: forumState(req, viewer), postId });
    }

    if (!publicSubmission.checkHoneypot(req.body)) throw new ForumError(400, "request_rejected", "请求被拒绝");
    if (content.length > FORUM_LIMITS.guestContentMax) throw new ForumError(400, "content_too_long", `游客回复最多 ${FORUM_LIMITS.guestContentMax} 个字，登录后可以写更长`);
    const name = normalizeName(req.body.guest?.name ?? "");
    if (!name || name.length > FORUM_LIMITS.guestNameMax) throw new ForumError(400, "invalid_guest_name", `游客要填 1 到 ${FORUM_LIMITS.guestNameMax} 个字的昵称`);
    if (!isAllowedName(name)) throw new ForumError(400, "invalid_guest_name", NAME_RULE_MESSAGE);
    const subject = ipSubject(req.ip);
    const withinLimits = () => {
      if (!forum.rateAllowed("guestPost", subject)) throw rateLimited();
      if (!forum.rateAllowed("guestPostSite", GUEST_POST_SITE_SUBJECT)) throw guestRepliesPaused();
    };
    withinLimits();
    // PoW 的摘要输入是原样的正文（不去首尾空白），与前端计算时用的字符串一致。
    if (!publicSubmission.checkPow(`${topicId}:${content}`, req.body.pow).ok) throw new ForumError(400, "pow_invalid", "防滥用校验失败，请刷新页面重试");
    // 昵称被占的回答会透露某个登录名登录过或有称号，所以放在限流和 PoW 之后，被占也记一次回复额度：
    // 匿名探测和回复共用每个 IP 每分钟 5 次、每天 30 次。
    if (forum.guestNameTaken(name)) {
      forum.rateRecord("guestPost", subject);
      throw new ForumError(400, "guest_name_taken", "这个昵称是成员在用的，换一个吧");
    }
    if (!(await turnstile.verifyTurnstile(req.body.turnstileToken, req.ip))) throw new ForumError(400, "turnstile_failed", "人机验证失败，请刷新重试");
    // 等人机验证的时候可能有同一 IP 或别的游客的并发请求写进来：写入前再查一次，查、写、记之间没有 await。
    withinLimits();
    const { postId } = forum.createGuestPost(name, { topicId, content, replyToPostId });
    forum.rateRecord("guestPost", subject);
    forum.rateRecord("guestPostSite", GUEST_POST_SITE_SUBJECT);
    return reply.code(201).send({ state: forumState(req, viewer), postId });
  });

  app.patch<{ Params: PostParams; Body: { content: string } }>("/api/forum/posts/:post_id", async req => {
    const viewer = await requireMember(req);
    const post = existingPost(req.params.post_id);
    const moderated = authorOrModerator(viewer, post, "编辑");
    assertNotDeleted(post);
    if (!req.body.content.trim()) throw new ForumError(400, "empty_content", "正文不能为空");
    forum.editPost(post.id, req.body.content);
    if (moderated) audit(config.consoleOrg, viewer.login, "forum.post.edit", post.id, { topic_id: post.topicId, author_id: post.authorId }, req.ip);
    return { state: forumState(req, viewer) };
  });

  /** 软删除。话题的第一帖不能删；已经删掉的再删一次直接返回当前状态。 */
  app.delete<{ Params: PostParams }>("/api/forum/posts/:post_id", async req => {
    const viewer = await requireMember(req);
    const post = existingPost(req.params.post_id);
    const moderated = authorOrModerator(viewer, post, "删除");
    if (post.deleted) return { state: forumState(req, viewer) };
    if (forum.isFirstPost(post.id, post.topicId)) throw new ForumError(400, "first_post", "话题的第一帖不能删除");
    forum.deletePost(post.id);
    if (moderated) audit(config.consoleOrg, viewer.login, "forum.post.delete", post.id, { topic_id: post.topicId, author_id: post.authorId }, req.ip);
    return { state: forumState(req, viewer) };
  });

  app.post<{ Params: PostParams }>("/api/forum/posts/:post_id/like", async req => {
    const viewer = await requireMember(req);
    const post = existingPost(req.params.post_id);
    assertNotDeleted(post);
    forum.toggleLike(post.id, viewer.userId);
    return { state: forumState(req, viewer) };
  });

  app.post<{ Params: PostParams }>("/api/forum/posts/:post_id/bookmark", async req => {
    const viewer = await requireMember(req);
    forum.toggleBookmark(viewer.userId, existingPost(req.params.post_id).id);
    return { state: forumState(req, viewer) };
  });
}
