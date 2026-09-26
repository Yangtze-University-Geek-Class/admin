import type Database from "better-sqlite3";
import type { ForumContent, ForumTag } from "./forum-content.js";
import {
  COUNTER_START, FORUM_LIMITS, FORUM_RATE_LIMITS, ForumError, VIEW_WINDOW_MS, extractMentions, paletteColor, tagSlug,
  type CounterName, type RateBucket,
} from "./forum-rules.js";

/**
 * 论坛的持久化与业务规则（#57）：forum_* 表的全部 SQL、编号、通知规则和整份 `ForumState` 的组装。
 * 只接收普通参数，不接触 Fastify；授权（谁能做）在 routes/forum-api，这里只管「做了会怎样」。
 * 输出形状与论坛前端 `app/forum/app/data/types.ts` 的 `ForumState`（version 1）一致。
 */

export type ForumTitle = { id: "admin" | "captain" | "head" | "member" | "alumni"; department?: string };
export type ForumUserKind = "member" | "guest" | "official";
export type NotifyPrefs = { reply: boolean; like: boolean; follow: boolean };
export type ForumUser = {
  id: string; username: string; displayName: string; bio: string; location: string; website: string;
  avatarColor: string; avatarUrl?: string; joinedAt: number; role: "admin" | "moderator" | "member";
  title?: ForumTitle; notifyPrefs: NotifyPrefs; kind: ForumUserKind;
};
export type ForumTopic = {
  id: string; slug: string; title: string; categoryId: string; tagIds: string[]; authorId: string;
  createdAt: number; lastActivityAt: number; views: number; pinned: boolean; closed: boolean;
};
export type ForumPost = {
  id: string; topicId: string; authorId: string; content: string; createdAt: number;
  editedAt?: number; replyToPostId?: string; likeUserIds: string[]; deleted?: boolean;
};
export type ForumNotification = {
  id: string; recipientId: string; type: "reply" | "like" | "follow" | "mention" | "system"; actorId: string;
  topicId?: string; postId?: string; createdAt: number; read: boolean;
};
export type ForumStateBody = {
  version: 1; seededAt: number;
  counters: { topic: number; post: number; notification: number; tag: number };
  users: ForumUser[]; categories: ForumContent["categories"]; tags: ForumTag[];
  topics: ForumTopic[]; posts: ForumPost[]; notifications: ForumNotification[];
  bookmarks: { userId: string; postId: string; createdAt: number }[];
  follows: { followerId: string; followeeId: string; createdAt: number }[];
};
export type MemberIdentity = { githubUserId: number; login: string; avatarUrl: string | null; role: "admin" | "member"; title: ForumTitle | null };
export type NewPost = { topicId: string; authorId: string; content: string; replyToPostId?: string };
export type ProfilePatch = { displayName?: string; bio?: string; location?: string; website?: string; notifyPrefs?: Partial<NotifyPrefs> };

type UserRow = {
  id: string; kind: ForumUserKind; github_user_id: number | null; username: string; display_name: string; bio: string;
  location: string; website: string; avatar_color: string; github_avatar_url: string | null; avatar_hash: string | null;
  role: ForumUser["role"]; title: string | null; notify_reply: number; notify_like: number; notify_follow: number; joined_at: number;
};
type TopicRow = {
  id: string; slug: string; title: string; category_id: string; tag_ids: string; author_id: string;
  created_at: number; last_activity_at: number; views: number; pinned: number; closed: number;
};
type PostRow = {
  id: string; topic_id: string; author_id: string; content: string; created_at: number;
  edited_at: number | null; reply_to_post_id: string | null; deleted: number;
};
type TagRow = { id: string; slug: string; name: string; color: string };

export const avatarPath = (hash: string) => `/api/forum/avatars/${hash}.webp`;

function toUser(row: UserRow): ForumUser {
  const avatarUrl = row.avatar_hash ? avatarPath(row.avatar_hash) : row.kind === "member" && row.github_avatar_url ? row.github_avatar_url : undefined;
  const title = row.title ? JSON.parse(row.title) as ForumTitle : undefined;
  return {
    id: row.id, username: row.username, displayName: row.display_name, bio: row.bio, location: row.location, website: row.website,
    avatarColor: row.avatar_color, ...(avatarUrl ? { avatarUrl } : {}), joinedAt: row.joined_at, role: row.role,
    ...(title ? { title } : {}), notifyPrefs: { reply: row.notify_reply === 1, like: row.notify_like === 1, follow: row.notify_follow === 1 },
    kind: row.kind,
  };
}

function toTopic(row: TopicRow): ForumTopic {
  return {
    id: row.id, slug: row.slug, title: row.title, categoryId: row.category_id, tagIds: JSON.parse(row.tag_ids) as string[],
    authorId: row.author_id, createdAt: row.created_at, lastActivityAt: row.last_activity_at, views: row.views,
    pinned: row.pinned === 1, closed: row.closed === 1,
  };
}

export function createForumStore(db: Database.Database, content: ForumContent) {
  const categoryIds = new Set(content.categories.map(item => item.id));
  const curatedTags = new Map(content.tags.map(tag => [tag.id, tag]));

  const selectUser = db.prepare("SELECT * FROM forum_users WHERE id = ?");
  const selectUserByName = db.prepare("SELECT * FROM forum_users WHERE username = ? COLLATE NOCASE");
  const selectTopic = db.prepare("SELECT * FROM forum_topics WHERE id = ?");
  const selectPost = db.prepare("SELECT * FROM forum_posts WHERE id = ?");
  const bumpCounter = db.prepare("UPDATE forum_counters SET value = value + 1 WHERE name = ? RETURNING value");
  const insertNotification = db.prepare(
    "INSERT INTO forum_notifications(id, recipient_id, type, actor_id, topic_id, post_id, created_at, read) VALUES(?, ?, ?, ?, ?, ?, ?, 0)",
  );

  const user = (id: string) => selectUser.get(id) as UserRow | undefined;
  const topicRow = (id: string) => selectTopic.get(id) as TopicRow | undefined;
  const postRow = (id: string) => selectPost.get(id) as PostRow | undefined;
  const usernameTaken = (username: string) => selectUserByName.get(username) !== undefined;
  /** 用户名撞了（例如有人的 GitHub 登录名正好是 guest-3 或 geekclass）就加上编号：`_` 不会出现在 GitHub 登录名里，不会再撞。 */
  const freeUsername = (base: string, suffix: string | number) => usernameTaken(base) ? `${base}_${suffix}` : base;

  function next(name: CounterName): number {
    const row = bumpCounter.get(name) as { value: number } | undefined;
    if (!row) throw new Error(`forum counter ${name} missing`);
    return row.value;
  }

  function notify(recipientId: string, type: ForumNotification["type"], actorId: string, at: number, topicId?: string, postId?: string) {
    insertNotification.run(`n${next("notification")}`, recipientId, type, actorId, topicId ?? null, postId ?? null, at);
  }

  /** 只有成员能读通知：游客与官方账号不收。 */
  function notifiable(id: string, pref: "notify_reply" | "notify_like" | "notify_follow" | null): boolean {
    const row = user(id);
    return row !== undefined && row.kind === "member" && (pref === null || row[pref] === 1);
  }

  const hasNotification = (recipientId: string, type: ForumNotification["type"], actorId: string | null, postId: string | null) =>
    db.prepare(
      `SELECT 1 FROM forum_notifications WHERE recipient_id = ? AND type = ?${actorId === null ? "" : " AND actor_id = ?"}${postId === null ? "" : " AND post_id = ?"} LIMIT 1`,
    ).get(recipientId, type, ...(actorId === null ? [] : [actorId]), ...(postId === null ? [] : [postId])) !== undefined;

  /** 帖子里的 @用户名：每人一次，不给自己，已经因为回复收到通知的不重复。 */
  function notifyMentions(postId: string, text: string, authorId: string, topicId: string, at: number) {
    for (const handle of extractMentions(text)) {
      const mentioned = selectUserByName.get(handle) as UserRow | undefined;
      if (!mentioned || mentioned.id === authorId || mentioned.kind !== "member") continue;
      if (hasNotification(mentioned.id, "reply", null, postId) || hasNotification(mentioned.id, "mention", null, postId)) continue;
      notify(mentioned.id, "mention", authorId, at, topicId, postId);
    }
  }

  /**
   * 标签：已有的 id（精选或用户建的）原样用；其余当作名字，按 slug 找已有标签，纯中文名（slug 为空）按名字找，
   * 都没有才新建 `tag-<n>`，颜色按计数取调色板（和前端 createTag 一样不用随机数）。
   */
  function resolveTags(entries: string[], authorId: string, at: number): string[] {
    const ids: string[] = [];
    for (const entry of entries) {
      let id: string | undefined;
      if (curatedTags.has(entry) || db.prepare("SELECT 1 FROM forum_tags WHERE id = ?").get(entry)) id = entry;
      else {
        const name = entry.trim();
        if (!name) continue;
        if (name.length > FORUM_LIMITS.tagNameMax) throw new ForumError(400, "invalid_tag", `标签名最多 ${FORUM_LIMITS.tagNameMax} 个字`);
        const slug = tagSlug(name);
        const all = [...content.tags, ...(db.prepare("SELECT id, slug, name, color FROM forum_tags").all() as TagRow[])];
        const existing = slug ? all.find(tag => tag.slug === slug) : all.find(tag => tag.name.toLowerCase() === name.toLowerCase());
        if (existing) id = existing.id;
        else {
          let n = next("tag");
          while (curatedTags.has(`tag-${n}`) || all.some(tag => tag.slug === `tag-${n}`) || db.prepare("SELECT 1 FROM forum_tags WHERE id = ?").get(`tag-${n}`)) n = next("tag");
          id = `tag-${n}`;
          db.prepare("INSERT INTO forum_tags(id, slug, name, color, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?)")
            .run(id, slug || id, name, paletteColor(n - 1), authorId, at);
        }
      }
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  /** 每条游客回复一个论坛用户：`g<n>`、用户名 `guest-<n>`，不收通知。 */
  function createGuest(name: string, now: number): string {
    const n = next("guest");
    const id = `g${n}`;
    db.prepare(
      `INSERT INTO forum_users(id, kind, username, display_name, avatar_color, role, notify_reply, notify_like, notify_follow, joined_at, updated_at)
       VALUES(?, 'guest', ?, ?, ?, 'member', 0, 0, 0, ?, ?)`,
    ).run(id, freeUsername(`guest-${n}`, n), name, paletteColor(n - 1), now, now);
    return id;
  }

  /** 回复：话题作者与被回复的人各收一条（不给自己、看各自的通知设置），再处理 @提及。 */
  const createPost = db.transaction((input: NewPost, now: number): string => {
    const topic = topicRow(input.topicId);
    if (!topic) throw new ForumError(404, "not_found", "话题不存在");
    const postId = `p${next("post")}`;
    db.prepare("INSERT INTO forum_posts(id, topic_id, author_id, content, created_at, reply_to_post_id) VALUES(?, ?, ?, ?, ?, ?)")
      .run(postId, topic.id, input.authorId, input.content, now, input.replyToPostId ?? null);
    db.prepare("UPDATE forum_topics SET last_activity_at = MAX(last_activity_at, ?) WHERE id = ?").run(now, topic.id);
    const recipients = new Set([topic.author_id]);
    const target = input.replyToPostId ? postRow(input.replyToPostId) : undefined;
    if (target) recipients.add(target.author_id);
    for (const recipientId of recipients) {
      if (recipientId !== input.authorId && notifiable(recipientId, "notify_reply")) notify(recipientId, "reply", input.authorId, now, topic.id, postId);
    }
    notifyMentions(postId, input.content, input.authorId, topic.id, now);
    return postId;
  });

  const deleteAvatarIfUnused = (hash: string | null) => {
    if (hash) db.prepare("DELETE FROM forum_avatars WHERE hash = ? AND NOT EXISTS (SELECT 1 FROM forum_users WHERE avatar_hash = ?)").run(hash, hash);
  };

  return {
    content,
    hasCategory: (id: string) => categoryIds.has(id),
    user: (id: string) => { const row = user(id); return row ? toUser(row) : undefined; },
    topic: (id: string) => { const row = topicRow(id); return row ? toTopic(row) : undefined; },
    post: (id: string) => {
      const row = postRow(id);
      return row ? { id: row.id, topicId: row.topic_id, authorId: row.author_id, deleted: row.deleted === 1, replyToPostId: row.reply_to_post_id } : undefined;
    },
    /** 话题的第一帖承载整个话题，不能删。 */
    isFirstPost(postId: string, topicId: string): boolean {
      const first = db.prepare("SELECT id FROM forum_posts WHERE topic_id = ? ORDER BY created_at, rowid LIMIT 1").get(topicId) as { id: string } | undefined;
      return first?.id === postId;
    },

    /**
     * 按编号「没有才插入」：计数器、官方账号、每个公开旧帖及其首帖 `body-<n>`。已有的行一律不动
     * （线上可能已有回复、置顶变化）。返回这次新插入的话题数。
     */
    seed(now = Date.now()): number {
      return db.transaction(() => {
        for (const [name, value] of Object.entries(COUNTER_START)) {
          db.prepare("INSERT OR IGNORE INTO forum_counters(name, value) VALUES(?, ?)").run(name, value);
        }
        const { author, topics } = content;
        if (!user(author.id)) {
          const joinedAt = topics.length ? Math.min(...topics.map(topic => topic.createdAt)) : now;
          db.prepare(
            `INSERT INTO forum_users(id, kind, username, display_name, bio, avatar_color, role, notify_reply, notify_like, notify_follow, joined_at, updated_at)
             VALUES(?, 'official', ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
          ).run(author.id, freeUsername(author.username, author.id.slice(2)), author.displayName, author.bio, author.avatarColor, author.role, joinedAt, now);
        }
        let inserted = 0;
        for (const topic of topics) {
          const result = db.prepare(
            `INSERT OR IGNORE INTO forum_topics(id, slug, title, category_id, tag_ids, author_id, created_at, last_activity_at, views, pinned, closed)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          ).run(topic.id, topic.slug, topic.title, topic.categoryId, JSON.stringify(topic.tagIds), author.id, topic.createdAt, topic.lastActivityAt, topic.views, topic.pinned ? 1 : 0);
          inserted += result.changes;
          db.prepare("INSERT OR IGNORE INTO forum_posts(id, topic_id, author_id, content, created_at) VALUES(?, ?, ?, ?, ?)")
            .run(`body-${topic.id.slice(1)}`, topic.id, author.id, topic.content, topic.createdAt);
        }
        return inserted;
      })();
    },

    /**
     * 成员的论坛用户：`m<GitHub user_id>`。第一次请求时建，之后每次请求刷新角色、称号与 GitHub 头像地址；
     * 用户自己改过的昵称、签名、上传的头像不动。GitHub 改了登录名时，新名字没人占就跟着改。
     */
    ensureMember(identity: MemberIdentity, now = Date.now()): string {
      const id = `m${identity.githubUserId}`;
      const title = identity.title ? JSON.stringify(identity.title) : null;
      const avatarUrl = identity.avatarUrl || null;
      const row = user(id);
      if (!row) {
        db.prepare(
          `INSERT INTO forum_users(id, kind, github_user_id, username, display_name, avatar_color, github_avatar_url, role, title, joined_at, updated_at)
           VALUES(?, 'member', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, identity.githubUserId, freeUsername(identity.login, identity.githubUserId), identity.login, paletteColor(identity.githubUserId), avatarUrl, identity.role, title, now, now);
        return id;
      }
      const username = row.username.toLowerCase() !== identity.login.toLowerCase() && !usernameTaken(identity.login) ? identity.login : row.username;
      if (row.role !== identity.role || row.title !== title || row.github_avatar_url !== avatarUrl || row.username !== username) {
        db.prepare("UPDATE forum_users SET role = ?, title = ?, github_avatar_url = ?, username = ?, updated_at = ? WHERE id = ?")
          .run(identity.role, title, avatarUrl, username, now, id);
      }
      return id;
    },

    /** 游客昵称不能冒用成员或官方账号的昵称、用户名。 */
    guestNameTaken(name: string): boolean {
      return db.prepare("SELECT 1 FROM forum_users WHERE kind <> 'guest' AND (display_name = ? COLLATE NOCASE OR username = ? COLLATE NOCASE) LIMIT 1").get(name, name) !== undefined;
    },

    createTopic(input: { authorId: string; title: string; categoryId: string; tags: string[]; content: string }, now = Date.now()): { topicId: string; postId: string } {
      return db.transaction(() => {
        const tagIds = resolveTags(input.tags, input.authorId, now);
        const n = next("topic");
        const topicId = `t${n}`;
        db.prepare(
          `INSERT INTO forum_topics(id, slug, title, category_id, tag_ids, author_id, created_at, last_activity_at, views, pinned, closed)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
        ).run(topicId, `topic-${n}`, input.title, input.categoryId, JSON.stringify(tagIds), input.authorId, now, now);
        const postId = `p${next("post")}`;
        db.prepare("INSERT INTO forum_posts(id, topic_id, author_id, content, created_at) VALUES(?, ?, ?, ?, ?)").run(postId, topicId, input.authorId, input.content, now);
        notifyMentions(postId, input.content, input.authorId, topicId, now);
        return { topicId, postId };
      })();
    },

    createPost: (input: NewPost, now = Date.now()) => createPost(input, now),

    /** 游客回复：建游客用户和帖子在同一个事务里，帖子写不进去就不留下游客用户。 */
    createGuestPost(name: string, input: Omit<NewPost, "authorId">, now = Date.now()): { guestId: string; postId: string } {
      return db.transaction(() => {
        const guestId = createGuest(name, now);
        return { guestId, postId: createPost({ ...input, authorId: guestId }, now) };
      })();
    },

    editPost(postId: string, text: string, now = Date.now()) {
      db.prepare("UPDATE forum_posts SET content = ?, edited_at = ? WHERE id = ? AND deleted = 0").run(text, now, postId);
    },

    /** 软删除：正文清空、`deleted` 置 1；点赞和书签留着，与前端一致。 */
    deletePost(postId: string) {
      db.prepare("UPDATE forum_posts SET deleted = 1, content = '' WHERE id = ?").run(postId);
    },

    /** 返回切换后的状态。点赞通知每人每帖只发一次。 */
    toggleLike(postId: string, userId: string, now = Date.now()): boolean {
      return db.transaction(() => {
        if (db.prepare("DELETE FROM forum_likes WHERE post_id = ? AND user_id = ?").run(postId, userId).changes) return false;
        db.prepare("INSERT INTO forum_likes(post_id, user_id, created_at) VALUES(?, ?, ?)").run(postId, userId, now);
        const post = postRow(postId)!;
        if (post.author_id !== userId && notifiable(post.author_id, "notify_like") && !hasNotification(post.author_id, "like", userId, postId)) {
          notify(post.author_id, "like", userId, now, post.topic_id, postId);
        }
        return true;
      })();
    },

    toggleBookmark(userId: string, postId: string, now = Date.now()): boolean {
      return db.transaction(() => {
        if (db.prepare("DELETE FROM forum_bookmarks WHERE user_id = ? AND post_id = ?").run(userId, postId).changes) return false;
        db.prepare("INSERT INTO forum_bookmarks(user_id, post_id, created_at) VALUES(?, ?, ?)").run(userId, postId, now);
        return true;
      })();
    },

    /** 关注会通知对方（同一人只通知一次，反复关注不刷屏）；取消关注不通知。 */
    toggleFollow(followerId: string, followeeId: string, now = Date.now()): boolean {
      return db.transaction(() => {
        if (db.prepare("DELETE FROM forum_follows WHERE follower_id = ? AND followee_id = ?").run(followerId, followeeId).changes) return false;
        db.prepare("INSERT INTO forum_follows(follower_id, followee_id, created_at) VALUES(?, ?, ?)").run(followerId, followeeId, now);
        if (notifiable(followeeId, "notify_follow") && !hasNotification(followeeId, "follow", followerId, null)) notify(followeeId, "follow", followerId, now);
        return true;
      })();
    },

    setPinned: (topicId: string, pinned: boolean) => { db.prepare("UPDATE forum_topics SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, topicId); },
    setClosed: (topicId: string, closed: boolean) => { db.prepare("UPDATE forum_topics SET closed = ? WHERE id = ?").run(closed ? 1 : 0, topicId); },

    /** 浏览数：同一 IP 同一话题一小时只算一次。过期的去重记录顺手删掉，IP 最多留一小时。 */
    recordView(topicId: string, ip: string, now = Date.now()): boolean {
      return db.transaction(() => {
        db.prepare("DELETE FROM forum_topic_views WHERE viewed_at <= ?").run(now - VIEW_WINDOW_MS);
        if (!db.prepare("INSERT OR IGNORE INTO forum_topic_views(topic_id, ip, viewed_at) VALUES(?, ?, ?)").run(topicId, ip, now).changes) return false;
        db.prepare("UPDATE forum_topics SET views = views + 1 WHERE id = ?").run(topicId);
        return true;
      })();
    },

    /** 只能标自己的通知；别人的通知当作不存在。 */
    markRead: (notificationId: string, userId: string) =>
      db.prepare("UPDATE forum_notifications SET read = 1 WHERE id = ? AND recipient_id = ?").run(notificationId, userId).changes > 0,
    markAllRead: (userId: string) => { db.prepare("UPDATE forum_notifications SET read = 1 WHERE recipient_id = ?").run(userId); },

    updateProfile(userId: string, patch: ProfilePatch, now = Date.now()) {
      const columns: [string, string | number][] = [];
      if (patch.displayName !== undefined) columns.push(["display_name", patch.displayName]);
      if (patch.bio !== undefined) columns.push(["bio", patch.bio]);
      if (patch.location !== undefined) columns.push(["location", patch.location]);
      if (patch.website !== undefined) columns.push(["website", patch.website]);
      const prefs = patch.notifyPrefs ?? {};
      if (prefs.reply !== undefined) columns.push(["notify_reply", prefs.reply ? 1 : 0]);
      if (prefs.like !== undefined) columns.push(["notify_like", prefs.like ? 1 : 0]);
      if (prefs.follow !== undefined) columns.push(["notify_follow", prefs.follow ? 1 : 0]);
      // 列名只来自上面的固定清单，值一律参数化。
      db.prepare(`UPDATE forum_users SET ${[...columns.map(([column]) => `${column} = ?`), "updated_at = ?"].join(", ")} WHERE id = ?`)
        .run(...columns.map(([, value]) => value), now, userId);
    },

    /** 头像按内容哈希存一份；换掉或删掉之后，没人再用的旧图一起删。 */
    setAvatar(userId: string, hash: string, data: Buffer, now = Date.now()) {
      db.transaction(() => {
        const previous = user(userId)?.avatar_hash ?? null;
        db.prepare("INSERT OR IGNORE INTO forum_avatars(hash, data, created_at) VALUES(?, ?, ?)").run(hash, data, now);
        db.prepare("UPDATE forum_users SET avatar_hash = ?, updated_at = ? WHERE id = ?").run(hash, now, userId);
        if (previous !== hash) deleteAvatarIfUnused(previous);
      })();
    },
    clearAvatar(userId: string, now = Date.now()) {
      db.transaction(() => {
        const previous = user(userId)?.avatar_hash ?? null;
        db.prepare("UPDATE forum_users SET avatar_hash = NULL, updated_at = ? WHERE id = ?").run(now, userId);
        deleteAvatarIfUnused(previous);
      })();
    },
    avatar: (hash: string) => (db.prepare("SELECT data FROM forum_avatars WHERE hash = ?").get(hash) as { data: Buffer } | undefined)?.data ?? null,

    /** 限流：每个窗口内已有的次数到上限就拒绝。只在动作成功后 `rateRecord`，被拒的请求不占额度。 */
    rateAllowed(bucket: RateBucket, subject: string, now = Date.now()): boolean {
      return FORUM_RATE_LIMITS[bucket].every(({ windowMs, max }) =>
        (db.prepare("SELECT COUNT(*) AS n FROM forum_rate_events WHERE bucket = ? AND subject = ? AND created_at > ?").get(bucket, subject, now - windowMs) as { n: number }).n < max);
    },
    rateRecord(bucket: RateBucket, subject: string, now = Date.now()) {
      const longest = Math.max(...Object.values(FORUM_RATE_LIMITS).flat().map(limit => limit.windowMs));
      db.prepare("DELETE FROM forum_rate_events WHERE created_at <= ?").run(now - longest);
      db.prepare("INSERT INTO forum_rate_events(bucket, subject, created_at) VALUES(?, ?, ?)").run(bucket, subject, now);
    },

    /**
     * 整份论坛状态。通知与书签只含 `viewerId` 自己的（游客两者都是空数组）；关注全部下发。
     * 分类与精选标签来自 curation.json，后面接用户新建的标签。
     */
    state(viewerId: string | null): ForumStateBody {
      const likes = new Map<string, string[]>();
      for (const like of db.prepare("SELECT post_id, user_id FROM forum_likes ORDER BY created_at, rowid").all() as { post_id: string; user_id: string }[]) {
        const list = likes.get(like.post_id);
        if (list) list.push(like.user_id); else likes.set(like.post_id, [like.user_id]);
      }
      const counters = Object.fromEntries((db.prepare("SELECT name, value FROM forum_counters").all() as { name: CounterName; value: number }[]).map(row => [row.name, row.value]));
      return {
        version: 1,
        seededAt: 0,
        counters: { topic: counters.topic ?? 0, post: counters.post ?? 0, notification: counters.notification ?? 0, tag: counters.tag ?? 0 },
        users: (db.prepare("SELECT * FROM forum_users ORDER BY joined_at, rowid").all() as UserRow[]).map(toUser),
        categories: content.categories,
        tags: [...content.tags, ...(db.prepare("SELECT id, slug, name, color FROM forum_tags ORDER BY created_at, rowid").all() as TagRow[])],
        topics: (db.prepare("SELECT * FROM forum_topics ORDER BY created_at, rowid").all() as TopicRow[]).map(toTopic),
        posts: (db.prepare("SELECT * FROM forum_posts ORDER BY created_at, rowid").all() as PostRow[]).map(row => ({
          id: row.id, topicId: row.topic_id, authorId: row.author_id, content: row.content, createdAt: row.created_at,
          ...(row.edited_at === null ? {} : { editedAt: row.edited_at }),
          ...(row.reply_to_post_id === null ? {} : { replyToPostId: row.reply_to_post_id }),
          likeUserIds: likes.get(row.id) ?? [],
          ...(row.deleted ? { deleted: true } : {}),
        })),
        notifications: viewerId === null ? [] : (db.prepare("SELECT * FROM forum_notifications WHERE recipient_id = ? ORDER BY created_at DESC, rowid DESC").all(viewerId) as {
          id: string; recipient_id: string; type: ForumNotification["type"]; actor_id: string; topic_id: string | null; post_id: string | null; created_at: number; read: number;
        }[]).map(row => ({
          id: row.id, recipientId: row.recipient_id, type: row.type, actorId: row.actor_id,
          ...(row.topic_id === null ? {} : { topicId: row.topic_id }), ...(row.post_id === null ? {} : { postId: row.post_id }),
          createdAt: row.created_at, read: row.read === 1,
        })),
        bookmarks: viewerId === null ? [] : (db.prepare("SELECT user_id, post_id, created_at FROM forum_bookmarks WHERE user_id = ? ORDER BY created_at, rowid").all(viewerId) as {
          user_id: string; post_id: string; created_at: number;
        }[]).map(row => ({ userId: row.user_id, postId: row.post_id, createdAt: row.created_at })),
        follows: (db.prepare("SELECT follower_id, followee_id, created_at FROM forum_follows ORDER BY created_at, rowid").all() as {
          follower_id: string; followee_id: string; created_at: number;
        }[]).map(row => ({ followerId: row.follower_id, followeeId: row.followee_id, createdAt: row.created_at })),
      };
    },
  };
}
export type ForumStore = ReturnType<typeof createForumStore>;
