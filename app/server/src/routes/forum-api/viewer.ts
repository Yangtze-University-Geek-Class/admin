import type { FastifyRequest } from "fastify";
import { loadSession } from "../../middleware/require-auth.js";
import { resolveAccess } from "../../middleware/require-capability.js";
import { orderedCapabilities, type Capability } from "../../lib/roles.js";
import { FORUM_LIMITS, ForumError } from "../../lib/forum-rules.js";
import type { ForumTitle } from "../../lib/forum-store.js";

/**
 * 论坛里「谁在看」：带有效 `sid` 的是成员，其余一律是游客。成员的论坛能力与控制台同一条路径
 * （`resolveAccess` → `computeAccess`），只取 `forum.*`；按钮显隐只是提示，授权在这里。
 */
export type ForumViewer =
  | { kind: "guest"; userId: null; login: null; capabilities: Capability[] }
  | { kind: "member"; userId: string; login: string; capabilities: Capability[] };
export type MemberViewer = Extract<ForumViewer, { kind: "member" }>;

declare module "fastify" {
  interface FastifyRequest {
    forumViewer?: ForumViewer;
  }
}

const GUEST: ForumViewer = Object.freeze({ kind: "guest", userId: null, login: null, capabilities: [] });

/**
 * 解析并缓存到 req.forumViewer。成员第一次来建论坛用户，之后每次请求刷新角色（组织 owner 是 admin）、
 * 称号（排序最高的那个）和 GitHub 头像地址。GitHub 角色查询出错直接抛给 http-policy，不把成员降成游客。
 */
export async function forumViewer(req: FastifyRequest): Promise<ForumViewer> {
  if (req.forumViewer) return req.forumViewer;
  // 没有 GitHub user_id 的会话只出现在旧数据里，建不了 `m<id>`，按游客处理。
  if (!loadSession(req) || req.session!.user_id === null) return (req.forumViewer = GUEST);
  const session = req.session!;
  const access = await resolveAccess(req);
  const top = access.titles[0];
  const title: ForumTitle | null = top && top.id !== "guest" ? { id: top.id, ...(top.department ? { department: top.department.id } : {}) } : null;
  const userId = req.server.services.forum.ensureMember({
    githubUserId: session.user_id!, login: session.login, avatarUrl: session.avatar_url,
    role: access.githubRole === "admin" ? "admin" : "member", title,
  });
  const capabilities = orderedCapabilities(access.capabilities).filter(capability => capability.startsWith("forum."));
  return (req.forumViewer = { kind: "member", userId, login: session.login, capabilities });
}

export async function requireMember(req: FastifyRequest): Promise<MemberViewer> {
  const viewer = await forumViewer(req);
  if (viewer.kind !== "member") throw new ForumError(401, "signin_required", "登录后才能操作");
  return viewer;
}

export const can = (viewer: ForumViewer, capability: Capability) => viewer.capabilities.includes(capability);
export const forbidden = (message: string) => new ForumError(403, "forbidden", message);
export const notFound = (message: string) => new ForumError(404, "not_found", message);
export const rateLimited = () => new ForumError(429, "rate_limited", "操作太频繁，请稍后再试");

/** 接口统一返回的 state：整份论坛数据 + 看的人 + 游客发帖的规则。 */
export function forumState(req: FastifyRequest, viewer: ForumViewer) {
  const { forum, config, publicSubmission, turnstile } = req.server.services;
  return {
    ...forum.state(viewer.userId),
    viewer: { userId: viewer.userId, kind: viewer.kind, capabilities: viewer.capabilities },
    guestPolicy: {
      powDifficulty: publicSubmission.powDifficulty(),
      turnstileSiteKey: turnstile.turnstileEnabled() ? config.turnstile.siteKey : null,
      nameMax: FORUM_LIMITS.guestNameMax,
      contentMax: FORUM_LIMITS.guestContentMax,
    },
  };
}
