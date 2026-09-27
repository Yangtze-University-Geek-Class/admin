import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AVATAR_TYPES, processAvatar } from "../../lib/forum-avatar.js";
import { FORUM_LIMITS, ForumError, NAME_RULE_MESSAGE, hasControlChars, hasControlCharsMultiline, isAllowedName, isAllowedWebsite, normalizeName } from "../../lib/forum-rules.js";
import type { ProfilePatch } from "../../lib/forum-store.js";
import { forumChanges, notFound, rateLimited, requireMember } from "./viewer.js";

/** 关注、通知、账号资料与头像。 */
export default async function forumPeopleRoutes(app: FastifyInstance) {
  const { forum } = app.services;

  app.post<{ Params: { forum_user_id: string } }>("/api/forum/users/:forum_user_id/follow", async req => {
    const viewer = await requireMember(req);
    const target = forum.user(req.params.forum_user_id);
    if (!target) throw notFound("用户不存在");
    if (target.id === viewer.userId) throw new ForumError(400, "cannot_follow_self", "不能关注自己");
    forum.toggleFollow(viewer.userId, target.id);
    return forumChanges(req, viewer, { follows: [{ followerId: viewer.userId, followeeId: target.id }] });
  });

  app.post<{ Params: { notification_id: string } }>("/api/forum/notifications/:notification_id/read", async req => {
    const viewer = await requireMember(req);
    if (!forum.markRead(req.params.notification_id, viewer.userId)) throw notFound("通知不存在");
    return forumChanges(req, viewer, { notifications: [req.params.notification_id] });
  });

  app.post("/api/forum/notifications/read-all", async req => {
    const viewer = await requireMember(req);
    return forumChanges(req, viewer, { notifications: forum.markAllRead(viewer.userId) });
  });

  /** 昵称、个人签名、所在地、个人网站（只收 https）、通知设置；只改传了的字段。 */
  app.patch<{ Body: ProfilePatch }>("/api/forum/me/profile", async req => {
    const viewer = await requireMember(req);
    const patch: ProfilePatch = { ...req.body };
    if (patch.displayName !== undefined) {
      // 存的是校验过的写法：NFKC 之后去掉首尾空白。
      patch.displayName = normalizeName(patch.displayName);
      // 昵称没改就不查也不写：早先存下、不合现在规则的昵称不该挡住改签名、网站这些别的字段。
      const current = forum.user(viewer.userId)?.displayName;
      if (current !== undefined && patch.displayName === normalizeName(current)) delete patch.displayName;
    }
    if (patch.displayName !== undefined) {
      if (!patch.displayName || patch.displayName.length > FORUM_LIMITS.displayNameMax) throw new ForumError(400, "invalid_display_name", `昵称要 1 到 ${FORUM_LIMITS.displayNameMax} 个字`);
      if (!isAllowedName(patch.displayName)) throw new ForumError(400, "invalid_display_name", NAME_RULE_MESSAGE);
      if (forum.displayNameTaken(patch.displayName, viewer)) throw new ForumError(400, "display_name_taken", "这个昵称是官方账号或别人的用户名，换一个吧");
    }
    if (patch.bio !== undefined && hasControlCharsMultiline(patch.bio)) throw new ForumError(400, "invalid_bio", "个人签名里有不能显示的字符");
    if (patch.location !== undefined) {
      patch.location = patch.location.trim();
      if (hasControlChars(patch.location)) throw new ForumError(400, "invalid_location", "所在地里有不能显示的字符");
    }
    if (patch.website !== undefined) {
      patch.website = patch.website.trim();
      if (!isAllowedWebsite(patch.website)) throw new ForumError(400, "invalid_website", "个人网站要以 https:// 开头");
    }
    forum.updateProfile(viewer.userId, patch);
    return forumChanges(req, viewer, {});
  });

  /**
   * 头像：请求体就是图片本身（PNG / JPEG / WebP，≤2MB），不走 JSON。只在这个子作用域里接收任意类型的原始请求体，
   * 其它论坛接口仍只收 JSON。
   * 上传在读请求体之前（onRequest）就核对登录并计一次数：游客的请求体不会被读进内存，超了次数也不再读；
   * 每次上传不管后面解码成不成功都占一次额度，拿坏图反复试解码也只有每小时 10 次。
   */
  await app.register(async avatarApp => {
    avatarApp.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: FORUM_LIMITS.avatarBytesMax }, (_req, body, done) => done(null, body));
    const tooLarge = (error: { code?: string }, _req: FastifyRequest, reply: FastifyReply) => {
      if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") return reply.code(413).send({ error: "avatar_too_large", message: "头像不能超过 2MB" });
      throw error;
    };

    const countUpload = async (req: FastifyRequest) => {
      const viewer = await requireMember(req);
      // 查和记之间没有 await：同一个人的并发上传不会一起挤过上限。
      if (!forum.rateAllowed("avatar", viewer.userId)) throw rateLimited();
      forum.rateRecord("avatar", viewer.userId);
    };

    avatarApp.put("/api/forum/me/avatar", { onRequest: countUpload, errorHandler: tooLarge }, async req => {
      const viewer = await requireMember(req);
      const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!(AVATAR_TYPES as readonly string[]).includes(type) || !Buffer.isBuffer(req.body)) {
        throw new ForumError(415, "unsupported_media_type", "头像只支持 PNG、JPEG、WebP 图片");
      }
      const { hash, data } = await processAvatar(req.body);
      forum.setAvatar(viewer.userId, hash, data);
      return forumChanges(req, viewer, {});
    });

    avatarApp.delete("/api/forum/me/avatar", async req => {
      const viewer = await requireMember(req);
      forum.clearAvatar(viewer.userId);
      return forumChanges(req, viewer, {});
    });
  });

  /** 按内容哈希取头像：内容永不改变，所以长期缓存（http-policy 只对这个前缀的 200 不改写 Cache-Control）。 */
  app.get<{ Params: { file: string } }>("/api/forum/avatars/:file", async (req, reply) => {
    const data = forum.avatar(req.params.file.slice(0, -".webp".length));
    if (!data) throw notFound("头像不存在");
    return reply
      .header("Content-Type", "image/webp")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("Content-Security-Policy", "default-src 'none'")
      .send(data);
  });
}
