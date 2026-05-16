import { request as undiciRequest } from "undici";
import { forumDb, type ForumUser } from "./forum-db.js";
import { upsertForumUserFromGithub } from "./forum-github.js";

type GhUser = { id: number; login: string; avatar_url?: string; email?: string | null; name?: string | null };

const TOKEN_CACHE = new Map<string, { userId: number; expires: number }>();
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

export async function resolveBearerToForumUser(token: string): Promise<ForumUser | null> {
  if (!token) return null;
  const cached = TOKEN_CACHE.get(token);
  if (cached && cached.expires > Date.now()) {
    const u = forumDb.prepare("SELECT * FROM forum_users WHERE id = ?").get(cached.userId) as ForumUser | undefined;
    if (u && u.role !== "banned") return u;
  }
  const res = await undiciRequest("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "yzgc-forum-cli",
      Accept: "application/vnd.github+json",
    },
  });
  if (res.statusCode !== 200) return null;
  const gh = (await res.body.json()) as GhUser;
  if (!gh.id || !gh.login) return null;
  const userId = upsertForumUserFromGithub({
    id: gh.id,
    login: gh.login,
    avatar_url: gh.avatar_url ?? "",
    email: gh.email ?? null,
    name: gh.name ?? null,
  });
  TOKEN_CACHE.set(token, { userId, expires: Date.now() + TOKEN_CACHE_TTL_MS });
  const u = forumDb.prepare("SELECT * FROM forum_users WHERE id = ?").get(userId) as ForumUser | undefined;
  return u && u.role !== "banned" ? u : null;
}

export function extractBearer(req: { headers?: Record<string, any> }): string | null {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h) return null;
  const s = String(h);
  if (s.toLowerCase().startsWith("bearer ")) return s.slice(7).trim() || null;
  return null;
}
