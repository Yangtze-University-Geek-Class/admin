import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requirePermission } from "../../middleware/require-permission.js";
import { ACCOUNT_AVATAR_BYTES_MAX, ACCOUNT_AVATAR_TYPES, AccountAvatarError, processAccountAvatar } from "../../lib/account-avatar.js";
import { redeemInvite } from "../../lib/invite-codes.js";
import { setExclusiveGroupMembership } from "../../lib/permissions.js";
import { hashIp, INVITE_LOCK_MAX_ACCOUNT, INVITE_LOCK_MAX_IP, INVITE_LOCK_WINDOW_MS } from "../../lib/identity-store.js";

const byAccount = (req: FastifyRequest) => req.session!.account_id;

/**
 * 账号资料、头像与邀请码兑换（#274 CONTRACT-274 §2）。资料和头像统一存 account_profiles/account_avatars，
 * 论坛、控制台、GitLab 同步、OIDC userinfo、命令行都读这里，不再各自存一份。
 * 猜码锁定（账号、IP 两条线）与 GitHub/Google/邮箱注册时填错邀请码共用同一套常量和同一个 IP 哈希算法
 * （lib/identity-store.ts 的 INVITE_LOCK 系列常量和 hashIp），同一个 invite.redeem.fail.ip bucket 两边都会计数
 * （#274 review round 1，item 4）。
 */

export default async function identityProfileRoutes(app: FastifyInstance) {
  const { profiles, storage, permissions, limits, forum } = app.services;
  const db = storage.db;

  app.get("/api/identity/profile", { preHandler: requireAuth }, async req => profiles.get(req.session!.account_id));

  app.patch<{ Body: { display_name?: string; bio?: string; username?: string; prefs?: Record<string, unknown> } }>(
    "/api/identity/profile",
    { preHandler: requirePermission("account.profile.edit"), config: { rateLimit: { max: 30, timeWindow: "1 hour", keyGenerator: byAccount, hook: "preHandler" } } },
    async (req, reply) => {
      // 用户名/昵称和论坛共用一个命名空间（PENTEST-20261029 finding 9/11）：官方账号、别人的用户名与历史登录名都算占用。
      const accountId = req.session!.account_id;
      const current = profiles.get(accountId);
      const ownLogin = req.session!.login;
      const changed = (value: string | undefined, now: string) => (value !== undefined && value !== now ? value : undefined);
      const wantedUsername = changed(req.body.username, current.username);
      const wantedDisplayName = changed(req.body.display_name, current.display_name);
      const taken = (name: string) => forum.identityNameTaken(name, { accountId, login: ownLogin });
      if (wantedUsername !== undefined && taken(wantedUsername)) {
        return reply.code(409).send({ error: "username_taken", message: "这个用户名已经被用了" });
      }
      if (wantedDisplayName !== undefined && taken(wantedDisplayName)) {
        return reply.code(409).send({ error: "display_name_taken", message: "这个昵称是官方账号或别人的用户名，换一个吧" });
      }
      const result = profiles.update(accountId, req.body);
      if (!result.ok) return reply.code(409).send({ error: "username_taken", message: "这个用户名已经被用了" });
      app.services.activity.recordActivity(req, { action: "profile.update", surface: "portal", outcome: "ok", meta: { fields: Object.keys(req.body) } });
      return result.profile;
    },
  );

  app.get<{ Params: { file: string } }>("/api/identity/avatar/:file", async (req, reply) => {
    const data = profiles.avatar(req.params.file.slice(0, -".webp".length));
    if (!data) return reply.code(404).send({ error: "not_found", message: "头像不存在" });
    return reply
      .header("Content-Type", "image/webp")
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("Content-Security-Policy", "default-src 'none'")
      .send(data);
  });

  // 头像上传：请求体就是图片本身，不走 JSON；只在这个子作用域里接收任意类型的原始请求体。
  await app.register(async avatarApp => {
    avatarApp.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: ACCOUNT_AVATAR_BYTES_MAX }, (_req, body, done) => done(null, body));
    const tooLarge = (error: { code?: string }, _req: FastifyRequest, reply: FastifyReply) => {
      if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") return reply.code(413).send({ error: "avatar_too_large", message: "头像不能超过 2MB" });
      throw error;
    };
    avatarApp.put(
      "/api/identity/avatar",
      { preHandler: requirePermission("account.profile.edit"), errorHandler: tooLarge, config: { rateLimit: { max: 10, timeWindow: "1 hour", keyGenerator: byAccount, hook: "preHandler" } } },
      async (req, reply) => {
        const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!(ACCOUNT_AVATAR_TYPES as readonly string[]).includes(type) || !Buffer.isBuffer(req.body)) {
          return reply.code(415).send({ error: "unsupported_media_type", message: "头像只支持 PNG、JPEG、WebP、GIF 图片" });
        }
        try {
          const { hash, data } = await processAccountAvatar(req.body as Buffer);
          profiles.setAvatar(req.session!.account_id, hash, data);
          app.services.activity.recordActivity(req, { action: "profile.avatar", surface: "portal", outcome: "ok" });
          return { avatar_url: profiles.avatarUrl(hash) };
        } catch (cause) {
          if (cause instanceof AccountAvatarError) return reply.code(cause.status).send({ error: cause.code, message: cause.message });
          throw cause;
        }
      },
    );
  });

  app.post<{ Body: { code: string } }>(
    "/api/identity/invite/redeem",
    { preHandler: requirePermission("account.invite.redeem"), config: { rateLimit: { max: 10, timeWindow: "1 hour", keyGenerator: byAccount, hook: "preHandler" } } },
    async (req, reply) => {
      const accountId = req.session!.account_id;
      const ip = hashIp(req.ip);
      const now = Date.now();
      // 猜码锁定：按账号、按 IP 各自数「无效邀请码」的次数，到了上限直接拒绝，不再碰兑换逻辑——
      // 和上面 requirePermission 的通用限流（10 次/小时，不分成败）是两条独立的线，这条只认失败次数。
      const accountLocked = limits.count({ bucket: "invite.redeem.fail.account", subject: accountId, window: { ms: INVITE_LOCK_WINDOW_MS }, now }) >= INVITE_LOCK_MAX_ACCOUNT;
      const ipLocked = limits.count({ bucket: "invite.redeem.fail.ip", subject: ip, window: { ms: INVITE_LOCK_WINDOW_MS }, now }) >= INVITE_LOCK_MAX_IP;
      if (accountLocked || ipLocked) {
        // #274 review round 1：和通用错误码约定一致，统一错误码是 rate_limited、带 bucket，不再用专门的 invite_locked。
        return reply.code(429).header("Retry-After", String(INVITE_LOCK_WINDOW_MS / 1000)).send({
          error: "rate_limited", bucket: accountLocked ? "invite.redeem.fail.account" : "invite.redeem.fail.ip",
          message: "无效邀请码次数太多，1 小时后再试", retry_after: INVITE_LOCK_WINDOW_MS / 1000,
        });
      }
      // 核对邀请码、记失败次数（猜错才记）、改权限等级在同一个事务里：失败不白算一次锁定名额，成功不漏记等级变化。
      const outcome = db.transaction((): { ok: true } | { ok: false; reason: "already_member" | "invite_invalid" } => {
        const alreadyMember = db.prepare("SELECT 1 FROM perm_members WHERE account_id = ? AND group_id = 'level.member'").get(accountId);
        if (alreadyMember) return { ok: false, reason: "already_member" };
        const redeemed = redeemInvite(db, req.body.code, now);
        if (!redeemed.ok) {
          limits.hit({ bucket: "invite.redeem.fail.account", subject: accountId, window: { ms: INVITE_LOCK_WINDOW_MS }, max: INVITE_LOCK_MAX_ACCOUNT, now });
          limits.hit({ bucket: "invite.redeem.fail.ip", subject: ip, window: { ms: INVITE_LOCK_WINDOW_MS }, max: INVITE_LOCK_MAX_IP, now });
          return { ok: false, reason: "invite_invalid" };
        }
        setExclusiveGroupMembership(db, accountId, "level.member", now, `invite:${redeemed.id}`);
        return { ok: true };
      })();
      if (!outcome.ok) {
        return outcome.reason === "already_member"
          ? reply.code(409).send({ error: "already_member", message: "你已经是极客班成员了" })
          : reply.code(400).send({ error: "invite_invalid", message: "邀请码无效" });
      }
      permissions.bump();
      app.services.activity.recordActivity(req, { action: "invite.redeem", surface: "portal", outcome: "ok" });
      return { level: "member" };
    },
  );
}
