import type Database from "better-sqlite3";
import type { ForumContent, ForumTag } from "./forum-content.js";
import type { AccountDepartmentView, AccountTitleView } from "./permissions.js";
import {
  COUNTER_START, FORUM_LIMITS, FORUM_RATE_LIMITS, ForumError, POST_EXCERPT_MAX, SEARCH_EXCERPT_MAX, SEARCH_LIMIT, TOPIC_PAGE_SIZE,
  TOPIC_PAGE_SIZE_MAX, VIEW_WINDOW_MS, allowedVisibilities, decodeTopicCursor, encodeTopicCursor, extractMentions, isStricterOrEqual,
  matchExcerpt, nameKey, paletteColor, postExcerpt, tagSlug,
  VISIBILITY_LEVELS, type CounterName, type RateBucket, type ViewerLevel,
} from "./forum-rules.js";
import { stickerSameOriginUrl } from "./sticker-manifest.js";
import type { AccountProfileStore } from "./account-profiles.js";
import type { IdentityStore, PublicIdentityFallback } from "./identity-store.js";
import { publicProfile, type PublicAccountProfile } from "./public-profile.js";
import type { Avatars } from "./avatars.js";

/**
 * 论坛的持久化与业务规则（#57）：forum_* 表的全部 SQL、编号、通知规则和整份 `ForumState` 的组装。
 * 只接收普通参数，不接触 Fastify；授权（谁能做）在 routes/forum-api，这里只管「做了会怎样」。
 * 输出形状与论坛前端 `app/forum/app/data/types.ts` 的 `ForumState`（version 1）一致。
 *
 * #156：`state()` 与不改正文的写回答只下发帖子摘要（`ForumPostSummary`），正文只在 `state()` 之外
 * ——`topicPosts()`（话题页按话题取）与改正文的写回答（发帖、回复、编辑、删除）——出现；搜索由 `search()` 服务端做。
 */

export type ForumTitle = { id: "admin" | "captain" | "head" | "member" | "alumni"; department?: string };
export type ForumUserKind = "member" | "guest" | "official";
export type NotifyPrefs = { reply: boolean; like: boolean; follow: boolean };
/**
 * `department`/`titles`（#276 CONTRACT §9）：新称号体系，和 `/auth/me`、`/api/public/departments` 同一套
 * 数据（权限引擎的 `groupsOf()`），论坛前端据此渲染部门色与称号，不再读旧的 `role_assignments`/`/api/public/org`。
 * `title`（旧字段，admin/alumni 的徽章提示）仍然保留——那两件事（站长、往届成员）本身没有变，#276 没有要求
 * 把它们挪到新字段里；两套字段并存到论坛前端切换完成。
 */
export type ForumUser = {
  id: string; username: string; displayName: string; bio: string; location: string; website: string;
  avatarColor: string; avatarUrl?: string; joinedAt: number; role: "admin" | "moderator" | "member";
  title?: ForumTitle; department: AccountDepartmentView; titles: AccountTitleView[];
  notifyPrefs: NotifyPrefs; kind: ForumUserKind;
};
/** `visibility`（#276 CONTRACT §1）：生效可见范围，`COALESCE(t.visibility, cs.visibility, 'public')`。 */
export type ForumTopic = {
  id: string; slug: string; title: string; categoryId: string; tagIds: string[]; authorId: string;
  createdAt: number; lastActivityAt: number; views: number; pinned: boolean; closed: boolean; visibility: ViewerLevel;
};
/**
 * 帖子记录的公共部分（#156）：`/state` 与写接口回答里的帖子都至少有这些字段，正文不在里面。
 * 回复数、赞数、参与者、个人页统计这些由客户端从这些字段算出来，不受影响。
 * `visibility`（#276）：帖子所在话题的生效可见范围，和话题上的同名字段同一个值。
 * `reactions`（#276 CONTRACT §4）：只含 count > 0 的表情回应，按首次出现排序。
 */
export type ForumReactionSummary = { stickerId: string; shortcode: string; url: string; count: number; mine: boolean };
export type ForumPostSummary = {
  id: string; topicId: string; authorId: string; createdAt: number;
  editedAt?: number; replyToPostId?: string; likeUserIds: string[]; deleted?: boolean;
  visibility: ViewerLevel; reactions: ForumReactionSummary[];
};
/**
 * `/state` 里的帖子与搜索命中（#156）：公共字段加服务端截好的一行纯文本摘要 `excerpt`，没有正文。
 * 列表、书签页、个人页的摘要都读它；正文只在 `topicPosts()` 与改正文的写回答里。
 */
export type ForumPostExcerpt = ForumPostSummary & { excerpt: string };
/** 整条帖子（话题页 `GET /api/forum/topics/:topic_id/posts`，以及发帖、回复、编辑、删除的回答）。 */
export type ForumPost = ForumPostSummary & { content: string };
/** 搜索的结果（`GET /api/forum/search`）：话题、帖子摘要与用户，可见性与 `/state` 里的同类记录相同。 */
export type ForumSearchResult = {
  topics: ForumTopic[]; posts: ForumPostExcerpt[]; users: ForumUser[];
};
export type ForumNotification = {
  id: string; recipientId: string; type: "reply" | "like" | "follow" | "mention" | "system"; actorId: string;
  topicId?: string; postId?: string; createdAt: number; read: boolean;
};
export type ForumBookmark = { userId: string; postId: string; createdAt: number };
export type ForumFollow = { followerId: string; followeeId: string; createdAt: number };
export type ForumStateBody = {
  version: 1; seededAt: number;
  counters: { topic: number; post: number; notification: number; tag: number };
  users: ForumUser[]; categories: ForumContent["categories"]; tags: ForumTag[];
  topics: ForumTopic[]; posts: ForumPostExcerpt[]; notifications: ForumNotification[];
  bookmarks: ForumBookmark[];
  follows: ForumFollow[];
};
/**
 * 一次写入之后变了的记录（#145）：写接口只回这些，前端按 id 并进手里的状态，不再整份替换。
 * 每条记录与 state() 里同一条完全一样（同一套投影），可见性也一样：通知只有看的人自己的，书签只有自己的，
 * 通知设置只有本人的是真值。书签与关注没有 id，取消了的放在 `removed` 里。
 * 帖子记录默认只有公共字段加 `excerpt`（没有正文，#156）；发帖、回复、编辑、删除这四种改正文的写入
 * 用 `changes(..., { posts: "full" })` 多带正文，前端才能把新正文显示出来。
 * 这里的类型是公共部分：带摘要的与带正文的都算，调用方按发出的选项知道是哪种。
 */
export type ForumChanges = {
  users?: ForumUser[]; tags?: ForumTag[]; topics?: ForumTopic[]; posts?: ForumPostSummary[]; notifications?: ForumNotification[];
  bookmarks?: ForumBookmark[]; follows?: ForumFollow[];
  removed?: { bookmarks?: Omit<ForumBookmark, "createdAt">[]; follows?: Omit<ForumFollow, "createdAt">[] };
};
/** 要回哪些记录：书签按帖子 id（只查看的人自己的），关注按关注者与被关注者。 */
export type ChangeKeys = {
  users?: string[]; tags?: string[]; topics?: string[]; posts?: string[]; notifications?: string[];
  bookmarks?: string[]; follows?: Omit<ForumFollow, "createdAt">[];
};
/** `changes()` 的选项（#156）：帖子记录带不带正文。 */
export type ChangeOptions = {
  /**
   * `excerpt`（默认）：公共字段加服务端截好的 `excerpt`，没有正文。点赞、书签、置顶这些不改正文的写入用它。
   * `full`：再多一个 `content`。发帖、回复、编辑、删除这四种改正文的写入用它，前端才能把新正文显示出来。
   */
  posts?: "excerpt" | "full";
};
/**
 * `accountId`：会话的极客班账号（#262），论坛按它认人；`githubUserId` 只用来给新成员编 `m<id>`，接旧账号
 * 早年按 GitHub id 建的论坛用户行。邮箱、Google 注册的账号没有 GitHub id（#274 SPEC §3.6），传 null，
 * 新成员编 `a<序号>`，不再把这类账号当游客。
 */
export type MemberIdentity = {
  accountId: string; githubUserId: number | null; login: string; avatarUrl: string | null; role: "admin" | "member"; title: ForumTitle | null;
  department: AccountDepartmentView; titles: AccountTitleView[];
};
export type NewPost = { topicId: string; authorId: string; content: string; replyToPostId?: string };
export type ProfilePatch = { displayName?: string; bio?: string; location?: string; website?: string; notifyPrefs?: Partial<NotifyPrefs> };

type UserRow = {
  id: string; kind: ForumUserKind; github_user_id: number | null; account_id: string | null; username: string; display_name: string; bio: string;
  location: string; website: string; avatar_color: string; github_avatar_url: string | null; avatar_hash: string | null;
  role: ForumUser["role"]; title: string | null; account_titles: string | null;
  notify_reply: number; notify_like: number; notify_follow: number; joined_at: number;
};
/** `effective_visibility`：由 TOPIC_FROM 的 JOIN 算出来，不是表里的真实列。 */
type TopicRow = {
  id: string; slug: string; title: string; category_id: string; tag_ids: string; author_id: string;
  created_at: number; last_activity_at: number; views: number; pinned: number; closed: number;
  visibility: ViewerLevel | null; effective_visibility: ViewerLevel;
};
type PostRow = {
  id: string; topic_id: string; author_id: string; content: string; created_at: number;
  edited_at: number | null; reply_to_post_id: string | null; deleted: number;
};
/** 一条表情回应的聚合行（#276 CONTRACT §4）：按帖子批量取，和 likesByPost() 同一种模式。 */
type ReactionAggRow = { post_id: string; sticker_id: string; shortcode: string; file_hash: string; count: number; mine: number };
type TagRow = { id: string; slug: string; name: string; color: string };
type NotificationRow = {
  id: string; recipient_id: string; type: ForumNotification["type"]; actor_id: string; topic_id: string | null; post_id: string | null; created_at: number; read: number;
};

export const avatarPath = (hash: string) => `/api/forum/avatars/${hash}.webp`;

/**
 * 通知设置只下发给本人：别人的一律给这一类用户的初始值（成员全开，与新成员相同；游客与官方账号不收通知，全关），
 * 字段照常存在，看不出谁关了哪种通知。
 */
const DEFAULT_NOTIFY_PREFS: Record<ForumUserKind, NotifyPrefs> = {
  member: { reply: true, like: true, follow: true },
  guest: { reply: false, like: false, follow: false },
  official: { reply: false, like: false, follow: false },
};

/** `avatar`：成员的统一头像（#343，ForumStoreOptions.avatars）；没传时按 #274 的旧口径取。 */
function toUser(row: UserRow, ownPrefs = true, profile?: PublicAccountProfile, fallback?: PublicIdentityFallback, avatar?: string): ForumUser {
  const visible = profile ? publicProfile(profile, fallback ?? { login: row.username, avatarUrl: row.github_avatar_url }) : null;
  const avatarUrl = avatar ?? (visible ? visible.avatar_url : row.avatar_hash ? avatarPath(row.avatar_hash) : row.kind === "member" && row.github_avatar_url ? row.github_avatar_url : undefined);
  const title = row.title ? JSON.parse(row.title) as ForumTitle : undefined;
  const accountTitles = row.account_titles ? JSON.parse(row.account_titles) as { department: AccountDepartmentView; titles: AccountTitleView[] } : null;
  return {
    id: row.id, username: visible?.username ?? row.username, displayName: visible?.display_name ?? row.display_name, bio: visible?.bio ?? row.bio, location: row.location, website: row.website,
    avatarColor: row.avatar_color, ...(avatarUrl ? { avatarUrl } : {}), joinedAt: row.joined_at, role: row.role,
    ...(title ? { title } : {}),
    department: accountTitles?.department ?? null, titles: accountTitles?.titles ?? [],
    notifyPrefs: ownPrefs ? { reply: row.notify_reply === 1, like: row.notify_like === 1, follow: row.notify_follow === 1 } : { ...DEFAULT_NOTIFY_PREFS[row.kind] },
    kind: row.kind,
  };
}

/**
 * 列表要的话题（#156）：`/state` 与不改正文的写回答都是普通 `ForumTopic`；首帖摘要落在同一条 `posts[].excerpt` 上，
 * 列表按主题 id 从 `posts` 里找首帖就行。`row.effective_visibility`（#276）来自查询时的 JOIN，不在这里现算。
 */
function toTopic(row: TopicRow): ForumTopic {
  return {
    id: row.id, slug: row.slug, title: row.title, categoryId: row.category_id, tagIds: JSON.parse(row.tag_ids) as string[],
    authorId: row.author_id, createdAt: row.created_at, lastActivityAt: row.last_activity_at, views: row.views,
    pinned: row.pinned === 1, closed: row.closed === 1, visibility: row.effective_visibility,
  };
}

/**
 * 帖子的三种投影（#156）：正文只在话题页与改正文的写回答里出现。
 * `excerpt` 由服务端截好（`forum-rules.ts` 的 `postExcerpt`，与论坛前端同一套规则），与正文一样是 Markdown 的行摘要。
 * `visibility`、`reactions`（#276）按帖子所在话题 / 帖子 id 从调用方一次性取好的 Map 里查，不在这里现查
 * （和 likeUserIds 同一种做法：likesByPost() 已经证明过的「批量取一次」模式）。
 */
function toPost(row: PostRow, likeUserIds: string[], visibility: ViewerLevel, reactions: ForumReactionSummary[]): ForumPostSummary {
  return {
    id: row.id, topicId: row.topic_id, authorId: row.author_id, createdAt: row.created_at,
    ...(row.edited_at === null ? {} : { editedAt: row.edited_at }),
    ...(row.reply_to_post_id === null ? {} : { replyToPostId: row.reply_to_post_id }),
    likeUserIds, visibility, reactions,
    ...(row.deleted ? { deleted: true } : {}),
  };
}

const toPostFull = (row: PostRow, likeUserIds: string[], visibility: ViewerLevel, reactions: ForumReactionSummary[]): ForumPost =>
  ({ ...toPost(row, likeUserIds, visibility, reactions), content: row.content });
/** `/state` 与非空正文写入的摘要投影：服务端截好的一行纯文本，与论坛前端的 `postExcerpt` 同一套规则。 */
const toPostExcerpt = (row: PostRow, likeUserIds: string[], visibility: ViewerLevel, reactions: ForumReactionSummary[]): ForumPostExcerpt =>
  ({ ...toPost(row, likeUserIds, visibility, reactions), excerpt: postExcerpt(row.content, POST_EXCERPT_MAX) });

/** 搜索命中只匹配标题/名字，投影与 `/state` 里的同一条完全一样。 */
const toPostHit = (row: PostRow, likeUserIds: string[], query: string, visibility: ViewerLevel, reactions: ForumReactionSummary[]): ForumPostExcerpt =>
  ({ ...toPost(row, likeUserIds, visibility, reactions), excerpt: matchExcerpt(row.content, query, SEARCH_EXCERPT_MAX) });

/** `LIKE` 里的 `%`、`_`、`\` 都要转义，配 `ESCAPE '\'` 用；与控制台投递搜索同一条规则。 */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, match => `\\${match}`);

function toNotification(row: NotificationRow): ForumNotification {
  return {
    id: row.id, recipientId: row.recipient_id, type: row.type, actorId: row.actor_id,
    ...(row.topic_id === null ? {} : { topicId: row.topic_id }), ...(row.post_id === null ? {} : { postId: row.post_id }),
    createdAt: row.created_at, read: row.read === 1,
  };
}

export type ForumStoreOptions = {
  /**
   * 论坛之外已经知道的组织成员登录名：控制台里有显式称号的人（role_assignments）和登录过的人（auth.signin 审计、
   * 当前会话）。没打开过论坛的人还没有论坛用户，靠它挡住冒名；从没登录过的组织成员不在这里。
   */
  orgLogins?: () => string[];
  /** 表情图片的地址（#286）：按图片内容哈希，开关打开时内置素材是 CDN 地址（lib/sticker-manifest.ts 的 createStickerUrl）；不传都是同源地址。 */
  stickerUrl?: (hash: string) => string;
  profiles?: Pick<AccountProfileStore, "findMany" | "update" | "setAvatar" | "clearAvatar">;
  identity?: Pick<IdentityStore, "publicFallbacks">;
  /**
   * 统一头像（#343）：成员的头像都从这里取，和控制台、比赛、OIDC、GitLab 同一张。对上账号的成员按账号算；还没对上账号的旧成员
   * 按论坛自己上传的头像、记下的 GitHub 头像、按用户名挑的 NANO 默认头像算。游客和官方账号不变（论坛上传的头像，没有就是色块）。
   */
  avatars?: Pick<Avatars, "ofAccounts" | "resolveMany">;
};

export function createForumStore(db: Database.Database, content: ForumContent, options: ForumStoreOptions = {}) {
  const orgLogins = options.orgLogins ?? (() => []);
  const stickerFileUrl = options.stickerUrl ?? stickerSameOriginUrl;
  const categoryIds = new Set(content.categories.map(item => item.id));
  const curatedTags = new Map(content.tags.map(tag => [tag.id, tag]));

  function profilesFor(rows: UserRow[]) {
    const profiles = options.profiles?.findMany(rows.flatMap(row => row.kind === "member" && row.account_id ? [row.account_id] : []));
    const fallbackIds = profiles
      ? [...profiles].flatMap(([accountId, profile]) => !profile.display_name.trim() || !profile.avatar_url ? [accountId] : [])
      : [];
    const fallbacks = fallbackIds.length ? options.identity?.publicFallbacks(fallbackIds) : undefined;
    return { profiles, fallbacks };
  }

  /** 一批论坛用户里成员的统一头像，按论坛用户 id；没传 `avatars` 时为空。 */
  function avatarsFor(rows: UserRow[]): Map<string, string> {
    if (!options.avatars) return new Map();
    const members = rows.filter(row => row.kind === "member");
    const linked = options.avatars.ofAccounts(members.flatMap(row => row.account_id ? [row.account_id] : []));
    const legacy = options.avatars.resolveMany(new Map(members.filter(row => !row.account_id).map(row => [row.id, {
      uploadUrl: row.avatar_hash ? avatarPath(row.avatar_hash) : null, uploadHash: row.avatar_hash, githubUrl: row.github_avatar_url, identifier: row.username,
    }])));
    return new Map(members.flatMap(row => {
      const avatar = row.account_id ? linked.get(row.account_id) : legacy.get(row.id);
      return avatar ? [[row.id, avatar.url] as const] : [];
    }));
  }

  function projectUsers(rows: UserRow[], viewerId?: string | null): ForumUser[] {
    const { profiles, fallbacks } = profilesFor(rows);
    const avatars = avatarsFor(rows);
    return rows.map(row => toUser(
      row,
      viewerId === undefined || row.id === viewerId,
      row.account_id ? profiles?.get(row.account_id) : undefined,
      row.account_id ? fallbacks?.get(row.account_id) : undefined,
      avatars.get(row.id),
    ));
  }

  type UserCandidate = { row: UserRow & { sort_id: number }; profile?: PublicAccountProfile; fallback?: PublicIdentityFallback };
  /**
   * 名字查找按有界批次只读 canonical，不全表生成 DTO，也不逐作者 get()/ensure()。
   * 顺序扫描只走一趟：按 joined_at 分页却没有对应索引，会让每批重新扫表、排序。
   */
  function* userCandidates(activeOnly = false): Generator<UserCandidate> {
    const statement = db.prepare(`SELECT fu.*, fu.rowid AS sort_id FROM forum_users fu
      ${activeOnly ? "JOIN users u ON u.id = fu.account_id WHERE u.status = 'active' AND fu.kind = 'member'" : ""}`);
    const batch: UserCandidate["row"][] = [];
    function* flush() {
      const { profiles, fallbacks } = profilesFor(batch);
      for (const row of batch) yield {
        row,
        profile: row.account_id ? profiles?.get(row.account_id) : undefined,
        fallback: row.account_id ? fallbacks?.get(row.account_id) : undefined,
      };
      batch.length = 0;
    }
    for (const row of statement.iterate() as IterableIterator<UserCandidate["row"]>) {
      batch.push(row);
      if (batch.length === 128) yield* flush();
    }
    if (batch.length) yield* flush();
  }

  const candidateName = ({ row, profile, fallback }: UserCandidate) =>
    profile ? publicProfile(profile, fallback ?? { login: row.username, avatarUrl: row.github_avatar_url }) : { username: row.username, display_name: row.display_name };

  function findUsers(viewerId: string | null, query: string, prefix: boolean, limit: number, activeOnly = false): ForumUser[] {
    const needle = query.toLowerCase();
    const matches = (value: string) => prefix ? value.toLowerCase().startsWith(needle) : value.toLowerCase().includes(needle);
    const selected: UserCandidate[] = [];
    const compare = (a: UserCandidate, b: UserCandidate) => a.row.joined_at - b.row.joined_at || a.row.sort_id - b.row.sort_id;
    const cap = Math.min(SEARCH_LIMIT, Math.max(0, limit));
    if (!cap) return [];
    for (const candidate of userCandidates(activeOnly)) {
      const name = candidateName(candidate);
      if (!matches(name.username) && !matches(name.display_name)) continue;
      if (selected.length === cap && compare(candidate, selected[cap - 1]!) >= 0) continue;
      selected.push(candidate);
      selected.sort(compare);
      if (selected.length > cap) selected.pop();
    }
    const avatars = avatarsFor(selected.map(({ row }) => row));
    return selected.map(({ row, profile, fallback }) => toUser(row, row.id === viewerId, profile, fallback, avatars.get(row.id)));
  }

  /**
   * 分级可见（#276 CONTRACT §1）：生效可见范围的 SQL 表达式与 JOIN，列表、搜索、通知、话题/帖子查询
   * 全部拼这一份，不另写一份顺序或条件——改一处，全部读接口跟着改；过滤只在 SQL 的 WHERE 里做，不先查出来
   * 再在内存里筛（分页、计数都按过滤后的结果算）。
   */
  const EFFECTIVE_VISIBILITY_EXPR = "COALESCE(t.visibility, cs.visibility, 'public')";
  const TOPIC_VISIBILITY_JOIN = "LEFT JOIN forum_category_settings cs ON cs.category_id = t.category_id";
  const TOPIC_SELECT = `SELECT t.*, ${EFFECTIVE_VISIBILITY_EXPR} AS effective_visibility FROM forum_topics t ${TOPIC_VISIBILITY_JOIN}`;
  /** 按身份过滤话题/帖子的 WHERE 片段 + 参数：所有读接口按身份过滤都调它。 */
  const visibilityWhere = (level: ViewerLevel): { sql: string; params: string[] } => {
    const allowed = allowedVisibilities(level);
    return { sql: `${EFFECTIVE_VISIBILITY_EXPR} IN (${allowed.map(() => "?").join(",")})`, params: [...allowed] };
  };
  /** 这个分类的基线可见范围；没有种子行时按 'public' 兜底，和 EFFECTIVE_VISIBILITY_EXPR 的 COALESCE 一致。 */
  const categoryVisibilityOf = (categoryId: string): ViewerLevel =>
    (db.prepare("SELECT visibility FROM forum_category_settings WHERE category_id = ?").get(categoryId) as { visibility: ViewerLevel } | undefined)?.visibility ?? "public";

  const selectUser = db.prepare("SELECT * FROM forum_users WHERE id = ?");
  const selectUserByName = db.prepare("SELECT * FROM forum_users WHERE username = ? COLLATE NOCASE");
  const selectUserByAccount = db.prepare("SELECT * FROM forum_users WHERE account_id = ?");
  const selectTopic = db.prepare(`${TOPIC_SELECT} WHERE t.id = ?`);
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

  /** 帖子里的 @用户名：每人一次，不给自己，已经因为回复收到通知的不重复；一帖最多通知 mentionNotifyMax 人，按出现顺序。 */
  function notifyMentions(postId: string, text: string, authorId: string, topicId: string, at: number) {
    const handles = extractMentions(text);
    if (!handles.length) return;
    const wanted = new Set(handles.map(handle => handle.toLowerCase()));
    const mentionedUsers = new Map<string, UserRow>();
    for (const candidate of userCandidates()) {
      if (candidate.row.kind !== "member") continue;
      const handle = candidateName(candidate).username.toLowerCase();
      if (wanted.has(handle)) mentionedUsers.set(handle, candidate.row);
      if (mentionedUsers.size === wanted.size) break;
    }
    let sent = 0;
    for (const handle of handles) {
      if (sent >= FORUM_LIMITS.mentionNotifyMax) break;
      const mentioned = mentionedUsers.get(handle.toLowerCase());
      if (!mentioned || mentioned.id === authorId || mentioned.kind !== "member") continue;
      if (hasNotification(mentioned.id, "reply", null, postId) || hasNotification(mentioned.id, "mention", null, postId)) continue;
      notify(mentioned.id, "mention", authorId, at, topicId, postId);
      sent += 1;
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

  /** 每条帖子的点赞人，按时间与行号排；`state()`、`changes()` 与话题页共用同一套顺序。 */
  const likesByPost = (): Map<string, string[]> => {
    const likes = new Map<string, string[]>();
    for (const like of db.prepare("SELECT post_id, user_id FROM forum_likes ORDER BY created_at, rowid").all() as { post_id: string; user_id: string }[]) {
      const list = likes.get(like.post_id);
      if (list) list.push(like.user_id); else likes.set(like.post_id, [like.user_id]);
    }
    return likes;
  };

  /** 每个话题生效的可见范围，一次性取出；`state()`、`changes()`、`search()` 都要用它给帖子打上 `visibility`。 */
  const topicVisibilityByTopic = (): Map<string, ViewerLevel> => {
    const map = new Map<string, ViewerLevel>();
    for (const row of db.prepare(`SELECT t.id AS id, ${EFFECTIVE_VISIBILITY_EXPR} AS v FROM forum_topics t ${TOPIC_VISIBILITY_JOIN}`).all() as { id: string; v: ViewerLevel }[]) {
      map.set(row.id, row.v);
    }
    return map;
  };

  /**
   * 每条帖子的表情回应聚合（#276 CONTRACT §4），只含 count > 0，按首次出现排序；`state()`、`changes()`、
   * `search()`、话题页共用这一份，和 likesByPost() 同一种「批量取一次」模式。
   */
  const reactionsByPost = (viewerId: string | null): Map<string, ForumReactionSummary[]> => {
    // forum_reactions.account_id 存的是核心账号 id（db.ts 里 `REFERENCES users(id)`），不是论坛用户 id——
    // 这个函数所有调用点（state()/search()/changes()/topicPosts()、路由层的 reactionsForPost）传的都是论坛
    // 用户 id（和 toUser() 判断「是不是本人」、通知/书签按论坛用户 id 查是统一口径），两种 id 的格式从不相同，
    // 直接拿论坛用户 id 去比 r.account_id 永远比不上，`mine` 原来永远是 false（#276 自查发现，不是所有者报的）。
    // 按论坛用户 id 反查一次它绑定的账号 id 再参与比较。
    const accountId = viewerId ? user(viewerId)?.account_id ?? null : null;
    const rows = db.prepare(`
      SELECT r.post_id AS post_id, r.sticker_id AS sticker_id, s.shortcode AS shortcode, s.file_hash AS file_hash,
        COUNT(*) AS count, SUM(CASE WHEN r.account_id = ? THEN 1 ELSE 0 END) AS mine, MIN(r.created_at) AS first_at
      FROM forum_reactions r JOIN forum_stickers s ON s.id = r.sticker_id
      GROUP BY r.post_id, r.sticker_id
      ORDER BY first_at, r.post_id
    `).all(accountId) as (ReactionAggRow & { first_at: number })[];
    const map = new Map<string, ForumReactionSummary[]>();
    for (const row of rows) {
      const list = map.get(row.post_id) ?? [];
      list.push({ stickerId: row.sticker_id, shortcode: row.shortcode, url: stickerFileUrl(row.file_hash), count: row.count, mine: row.mine > 0 });
      map.set(row.post_id, list);
    }
    return map;
  };

  /**
   * 搜索（#156，#276 分级可见）：正文不在浏览器里了，匹配改在服务端做。
   * 匹配的列与客户端旧的 `searchAll` 一样（话题标题、帖子正文、用户名与昵称），顺序也一样（各自按时间倒序），
   * 每类最多 `SEARCH_LIMIT` 条；可见性与 `/state` 相同（帖子只给摘要，没正文）。按身份过滤话题/帖子在 SQL
   * 的 WHERE 里做（CONTRACT-276 §1），不是查出来再筛。
   */
  function search(viewerId: string | null, query: string, level: ViewerLevel): ForumSearchResult {
    const like = `%${escapeLike(query)}%`;
    const likes = likesByPost();
    const reactions = reactionsByPost(viewerId);
    const visible = visibilityWhere(level);
    const topics = (db.prepare(`${TOPIC_SELECT} WHERE t.title LIKE ? ESCAPE '\\' AND ${visible.sql} ORDER BY t.last_activity_at DESC, t.rowid DESC LIMIT ?`)
      .all(like, ...visible.params, SEARCH_LIMIT) as TopicRow[]).map(toTopic);
    const posts = (db.prepare(`
        SELECT p.*, ${EFFECTIVE_VISIBILITY_EXPR} AS effective_visibility FROM forum_posts p
        JOIN forum_topics t ON t.id = p.topic_id ${TOPIC_VISIBILITY_JOIN}
        WHERE p.content LIKE ? ESCAPE '\\' AND p.deleted = 0 AND ${visible.sql}
        ORDER BY p.created_at DESC, p.rowid DESC LIMIT ?
      `).all(like, ...visible.params, SEARCH_LIMIT) as (PostRow & { effective_visibility: ViewerLevel })[])
      .map(row => toPostHit(row, likes.get(row.id) ?? [], query, row.effective_visibility, reactions.get(row.id) ?? []));
    const users = findUsers(viewerId, query, false, SEARCH_LIMIT);
    return { topics, posts, users };
  }

  /**
   * 话题列表的游标分页（#276 CONTRACT §9「列表与搜索接口改成游标分页」）：按 `last_activity_at DESC, rowid DESC`
   * 翻页，和 search() 的话题排序同一个顺序，续页靠游标接着上一页最后一条排序键继续，不是页码。按身份过滤在
   * SQL 的 WHERE 里做，和其它读接口共用同一份 visibilityWhere()。`q` 给了就按标题筛，和 search() 的话题部分
   * 是同一张表、同一种匹配，只是这里支持翻页、search() 只回第一页（见 forum-api/topics.ts 的路由注释）。
   */
  function topicsPage(level: ViewerLevel, options: { cursor?: string; limit?: number; q?: string } = {}): { topics: ForumTopic[]; nextCursor: string | null } {
    const visible = visibilityWhere(level);
    const limit = Math.min(Math.max(1, options.limit ?? TOPIC_PAGE_SIZE), TOPIC_PAGE_SIZE_MAX);
    const cursor = options.cursor ? decodeTopicCursor(options.cursor) : null;
    const conditions = [visible.sql];
    const params: (string | number)[] = [...visible.params];
    if (options.q) { conditions.push("t.title LIKE ? ESCAPE '\\'"); params.push(`%${escapeLike(options.q)}%`); }
    if (cursor) {
      conditions.push("(t.last_activity_at < ? OR (t.last_activity_at = ? AND t.rowid < ?))");
      params.push(cursor.lastActivityAt, cursor.lastActivityAt, cursor.rowid);
    }
    const rows = db.prepare(`
        SELECT t.*, t.rowid AS rowid, ${EFFECTIVE_VISIBILITY_EXPR} AS effective_visibility FROM forum_topics t ${TOPIC_VISIBILITY_JOIN}
        WHERE ${conditions.join(" AND ")} ORDER BY t.last_activity_at DESC, t.rowid DESC LIMIT ?
      `).all(...params, limit + 1) as (TopicRow & { rowid: number })[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeTopicCursor(last.last_activity_at, last.rowid) : null;
    return { topics: page.map(toTopic), nextCursor };
  }

  return {
    content,
    hasCategory: (id: string) => categoryIds.has(id),
    user: (id: string) => { const row = user(id); return row ? projectUsers([row])[0] : undefined; },
    /**
     * 单条话题查询不按身份过滤（#276 CONTRACT §1）：直接取看不到的话题要能区分「不存在」（404）和「存在但
     * 看不到」（401/403），过滤掉的话两者都会查不到。路由层拿到 `visibility` 字段后自己用 `assertVisible()` 判。
     */
    topic: (id: string) => { const row = topicRow(id); return row ? toTopic(row) : undefined; },
    post: (id: string) => {
      const row = postRow(id);
      return row ? { id: row.id, topicId: row.topic_id, authorId: row.author_id, deleted: row.deleted === 1, replyToPostId: row.reply_to_post_id } : undefined;
    },
    /**
     * 一个话题的全部帖子，按楼层排（#156）：话题页先拿这里，才拿得到正文；可见性在路由层对整个话题判一次，
     * 这里不重复过滤（同一话题下的帖子可见范围都相同）。
     * 投影与 `state().posts` 里同一条完全一样，只是多带 `content`（含已删除帖子清空后的空串）。
     */
    topicPosts(topicId: string, viewerId: string | null = null): ForumPost[] {
      const likes = likesByPost();
      const reactions = reactionsByPost(viewerId);
      const visibility = topicRow(topicId)?.effective_visibility ?? "public";
      return (db.prepare("SELECT * FROM forum_posts WHERE topic_id = ? ORDER BY created_at, rowid").all(topicId) as PostRow[])
        .map(row => toPostFull(row, likes.get(row.id) ?? [], visibility, reactions.get(row.id) ?? []));
    },
    /**
     * 旧帖图片可被多篇正文复用；只要当前数据库里至少一篇引用它的话题可读，图片就可读。
     * 返回这些引用里最宽的有效范围（public < registered < member），与话题 COALESCE 语义完全相同。
     */
    publishedAssetVisibility(file: string): ViewerLevel | null {
      const rows = db.prepare(`
          SELECT ${EFFECTIVE_VISIBILITY_EXPR} AS effective_visibility FROM forum_posts p
          JOIN forum_topics t ON t.id = p.topic_id ${TOPIC_VISIBILITY_JOIN}
          WHERE p.deleted = 0 AND instr(p.content, ?) > 0
        `).all(`published/${file}`) as { effective_visibility: ViewerLevel }[];
      if (!rows.length) return null;
      return rows.map(row => row.effective_visibility)
        .sort((a, b) => VISIBILITY_LEVELS.indexOf(a) - VISIBILITY_LEVELS.indexOf(b))[0] ?? null;
    },
    /** 搜索（#156，#276）：正文不在浏览器里了，匹配改在服务端做；可见性按身份在 SQL 层过滤，与 `/state` 相同。 */
    search,
    /** 话题列表的游标分页（#276 CONTRACT §9）。 */
    topicsPage,
    /** 话题的第一帖承载整个话题，不能删。 */
    isFirstPost(postId: string, topicId: string): boolean {
      const first = db.prepare("SELECT id FROM forum_posts WHERE topic_id = ? ORDER BY created_at, rowid LIMIT 1").get(topicId) as { id: string } | undefined;
      return first?.id === postId;
    },

    /**
     * 按编号「没有才插入」：计数器、官方账号、每个公开旧帖及其首帖 `body-<n>`。已有的行一律不动
     * （线上可能已有回复、置顶变化）。返回这次新插入的话题数。
     *
     * 使用说明（#281）以仓库为准：没有就插入；已有、作者还是官方账号时，标题、slug、分类、标签、可见范围和首帖正文
     * 跟着仓库改（正文变了才写 edited_at）。置顶、关闭、浏览数和回复是线上的，不动。
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
          // 仓库仍管理未人工编辑的旧帖正文；线上改过的帖子 edited_at 非空，不能被发版覆盖（#304）。
          db.prepare("UPDATE forum_posts SET content = ? WHERE id = ? AND author_id = ? AND edited_at IS NULL AND content <> ?")
            .run(topic.content, `body-${topic.id.slice(1)}`, author.id, topic.content);
        }
        for (const guide of content.guides) {
          const postId = `body-${guide.id.slice(1)}`;
          const existing = db.prepare("SELECT author_id FROM forum_topics WHERE id = ?").get(guide.id) as { author_id: string } | undefined;
          if (!existing) {
            db.prepare(
              `INSERT INTO forum_topics(id, slug, title, category_id, tag_ids, author_id, created_at, last_activity_at, views, pinned, closed, visibility)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`,
            ).run(guide.id, guide.slug, guide.title, guide.categoryId, JSON.stringify(guide.tagIds), author.id, guide.createdAt, guide.lastActivityAt, guide.pinned ? 1 : 0, guide.visibility);
            db.prepare("INSERT INTO forum_posts(id, topic_id, author_id, content, created_at) VALUES(?, ?, ?, ?, ?)")
              .run(postId, guide.id, author.id, guide.content, guide.createdAt);
            inserted += 1;
            continue;
          }
          if (existing.author_id !== author.id) continue;
          db.prepare("UPDATE forum_topics SET slug = ?, title = ?, category_id = ?, tag_ids = ?, visibility = ? WHERE id = ?")
            .run(guide.slug, guide.title, guide.categoryId, JSON.stringify(guide.tagIds), guide.visibility, guide.id);
          db.prepare("UPDATE forum_posts SET content = ?, edited_at = ? WHERE id = ? AND author_id = ? AND content <> ?")
            .run(guide.content, now, postId, author.id, guide.content);
        }
        return inserted;
      })();
    },

    /**
     * 成员的论坛用户：先按极客班账号找（#262）；没有就按有没有 GitHub id 分两条路——有的接 `m<GitHub user_id>`
     * （登录事务已经认领过同一个 GitHub id 的旧行），没有的（邮箱、Google 注册，#274 SPEC §3.6）编一个新的
     * `a<序号>`，第一次请求时建并写上账号。之后每次请求刷新角色、称号与头像地址；用户自己改过的昵称、
     * 签名、上传的头像不动。登录名变了（GitHub 改名）时，新名字没人占就跟着改。
     */
    ensureMember(identity: MemberIdentity, now = Date.now()): string {
      const claimed = selectUserByAccount.get(identity.accountId) as UserRow | undefined;
      const id = claimed?.id ?? (identity.githubUserId !== null ? `m${identity.githubUserId}` : `a${next("member")}`);
      const title = identity.title ? JSON.stringify(identity.title) : null;
      // 新称号体系（#276 CONTRACT §9）：部门与称号和 /auth/me、/api/public/departments 同一套数据，不读旧的 role_assignments。
      const accountTitles = JSON.stringify({ department: identity.department, titles: identity.titles });
      const avatarUrl = identity.avatarUrl || null;
      const row = claimed ?? user(id);
      if (!row) {
        // 头像色号：有 GitHub id 用它（和老账号的旧头像色一致），没有就用刚编的序号。
        const seed = identity.githubUserId ?? Number(id.slice(1));
        db.prepare(
          `INSERT INTO forum_users(id, kind, github_user_id, username, display_name, avatar_color, github_avatar_url, role, title, account_titles, joined_at, updated_at, account_id)
           VALUES(?, 'member', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, identity.githubUserId, freeUsername(identity.login, seed), identity.login, paletteColor(seed), avatarUrl, identity.role, title, accountTitles, now, now, identity.accountId);
        return id;
      }
      const username = row.username.toLowerCase() !== identity.login.toLowerCase() && !usernameTaken(identity.login) ? identity.login : row.username;
      const accountId = row.account_id ?? identity.accountId;
      if (
        row.role !== identity.role || row.title !== title || row.github_avatar_url !== avatarUrl || row.username !== username
        || row.account_id !== accountId || row.account_titles !== accountTitles
      ) {
        db.prepare("UPDATE forum_users SET role = ?, title = ?, account_titles = ?, github_avatar_url = ?, username = ?, account_id = ?, updated_at = ? WHERE id = ?")
          .run(identity.role, title, accountTitles, avatarUrl, username, accountId, now, id);
      }
      return id;
    },

    /**
     * 成员的昵称不能冒用官方账号（昵称或用户名），也不能是别人的用户名（@ 提及认的是用户名）或 orgLogins 里别人的登录名；
     * 自己的登录名可以，和别的成员昵称相同也可以。按 nameKey 比较：全角、大小写、附加符号都不算区别。
     * 豁免的只是自己的登录名本身（不分大小写），不按 nameKey：nameKey 去掉了 -，按它豁免的话 da-ve 就能用 dave。
     * 反过来，自己的登录名本身总能用（新成员的昵称默认就是它），哪怕按 nameKey 和别人的登录名撞上。
     */
    displayNameTaken(name: string, self: { userId: string; login: string }): boolean {
      const ownLogin = self.login.toLowerCase();
      if (name.toLowerCase() === ownLogin) return false;
      const key = nameKey(name);
      for (const candidate of userCandidates()) {
        if (candidate.row.id === self.userId || candidate.row.kind === "guest") continue;
        const name = candidateName(candidate);
        if (nameKey(name.username) === key || (candidate.row.kind === "official" && nameKey(name.display_name) === key)) return true;
      }
      return orgLogins().some(login => login.toLowerCase() !== ownLogin && nameKey(login) === key);
    },

    /**
     * 站内用户名/昵称能不能用（PENTEST-20261029 finding 9/11）：`PATCH /api/identity/profile` 原来只在
     * account_profiles 里查重，官方账号、还没建档的成员都住在 forum_users，于是低权账号能把 username 改成
     * geekclass 之类的官方名，匿名 `/api/forum/state` 立刻出现两个同名账号。论坛列表里显示的 username/displayName
     * 就是统一资料这一份（toUser 的 visible），所以占用判定必须和 displayNameTaken 同一套命名空间，只按账号豁免自己。
     * 允许自己的登录名：新成员默认用户名就是它。
     */
    identityNameTaken(name: string, self: { accountId: string; login: string }): boolean {
      // 不能像 displayNameTaken 那样先按登录名直接放行（CodeRabbit 复审）：登录名 `geek-class` 与官方用户名
      // `geekclass` 在 nameKey 下相同，先返回就等于给了一种绕过。这里只豁免「属于自己的记录」，
      // 自己的登录名仍然在 orgLogins 里按账号跳过，不会挡住新成员默认昵称。
      const ownLogin = self.login.toLowerCase();
      const key = nameKey(name);
      for (const candidate of userCandidates()) {
        if (candidate.row.account_id === self.accountId || candidate.row.kind === "guest") continue;
        const other = candidateName(candidate);
        if (nameKey(other.username) === key) return true;
        if (candidate.row.kind === "official" && nameKey(other.display_name) === key) return true;
      }
      return orgLogins().some(login => login.toLowerCase() !== ownLogin && nameKey(login) === key);
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

    /** 浏览数：同一 IP（IPv6 按 /64，由路由换算好传进来）同一话题一小时只算一次。过期的去重记录顺手删掉，IP 最多留一小时。 */
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
    /** 返回这次从未读变成已读的通知 id。 */
    markAllRead: (userId: string): string[] =>
      (db.prepare("UPDATE forum_notifications SET read = 1 WHERE recipient_id = ? AND read = 0 RETURNING id").all(userId) as { id: string }[]).map(row => row.id),

    updateProfile(userId: string, patch: ProfilePatch, now = Date.now()) {
      db.transaction(() => {
        const row = user(userId);
        // 缺 canonical 行的历史作者沿用旧写口；局部修改不能 ensure 出空资料，反而隐藏未修改的旧字段/头像。
        if (row?.account_id && options.profiles?.findMany([row.account_id]).has(row.account_id) && (patch.displayName !== undefined || patch.bio !== undefined)) {
          options.profiles.update(row.account_id, {
            ...(patch.displayName !== undefined ? { display_name: patch.displayName } : {}),
            ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
          });
        }
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
      })();
    },

    /** 头像按内容哈希存一份；换掉或删掉之后，没人再用的旧图一起删。`data` 为 null 表示字节已在对象存储里（#352），库里不再存。 */
    setAvatar(userId: string, hash: string, data: Buffer | null, now = Date.now()) {
      db.transaction(() => {
        const row = user(userId);
        const previous = row?.avatar_hash ?? null;
        if (row?.account_id && options.profiles?.findMany([row.account_id]).has(row.account_id)) options.profiles.setAvatar(row.account_id, hash, data);
        if (data) db.prepare("INSERT OR IGNORE INTO forum_avatars(hash, data, created_at) VALUES(?, ?, ?)").run(hash, data, now);
        db.prepare("UPDATE forum_users SET avatar_hash = ?, updated_at = ? WHERE id = ?").run(hash, now, userId);
        if (previous !== hash) deleteAvatarIfUnused(previous);
      })();
    },
    clearAvatar(userId: string, now = Date.now()) {
      db.transaction(() => {
        const row = user(userId);
        const previous = row?.avatar_hash ?? null;
        if (row?.account_id) options.profiles?.clearAvatar(row.account_id);
        db.prepare("UPDATE forum_users SET avatar_hash = NULL, updated_at = ? WHERE id = ?").run(now, userId);
        deleteAvatarIfUnused(previous);
      })();
    },
    avatar: (hash: string) => (db.prepare("SELECT data FROM forum_avatars WHERE hash = ?").get(hash) as { data: Buffer } | undefined)?.data ?? null,
    /** 这个极客班账号的论坛资料（#270，对外授权与 GitLab 同步读它）；没有论坛用户时为 null。 */
    profileForAccount(accountId: string): { displayName: string; bio: string; location: string; website: string; avatarHash: string | null } | null {
      const row = selectUserByAccount.get(accountId) as UserRow | undefined;
      return row ? { displayName: row.display_name, bio: row.bio, location: row.location, website: row.website, avatarHash: row.avatar_hash } : null;
    },

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
     * 整份论坛状态。通知与书签只含 `viewerId` 自己的（游客两者都是空数组），通知设置只有本人的是真实值；关注全部下发。
     * 分类本身可读，或被合法可读话题引用时给原 public DTO；闭包外的受限分类不下发。
     * 显式话题覆盖不因分类收紧而失效，关联例外保留分类导航，不扩大其他话题的读取范围。
     * 精选标签来自 curation.json；用户新建的标签只下发可见话题引用的项，避免泄漏隐藏话题的元数据。
     * #156：话题带首帖摘要（列表显示它）、帖子只带摘要字段（没有正文）。正文由 `topicPosts()` 进话题页时按话题取。
     * #276 分级可见（CONTRACT §1）：话题、帖子、通知按 `level` 在 SQL 的 WHERE 里过滤，不查出来再筛；
     * 看不到的话题/帖子/相关通知整条不出现。
     */
    state(viewerId: string | null, level: ViewerLevel): ForumStateBody {
      const likes = likesByPost();
      const reactions = reactionsByPost(viewerId);
      const visible = visibilityWhere(level);
      const topics = (db.prepare(`${TOPIC_SELECT} WHERE ${visible.sql} ORDER BY t.created_at, t.rowid`).all(...visible.params) as TopicRow[]).map(toTopic);
      const referencedCategories = new Set(topics.map(topic => topic.categoryId));
      const referencedTags = new Set(topics.flatMap(topic => topic.tagIds));
      const categorySettings = new Map((db.prepare("SELECT category_id, visibility FROM forum_category_settings").all() as { category_id: string; visibility: ViewerLevel }[])
        .map(row => [row.category_id, row.visibility]));
      const allowed = allowedVisibilities(level);
      const counters = Object.fromEntries((db.prepare("SELECT name, value FROM forum_counters").all() as { name: CounterName; value: number }[]).map(row => [row.name, row.value]));
      return {
        version: 1,
        seededAt: 0,
        counters: { topic: counters.topic ?? 0, post: counters.post ?? 0, notification: counters.notification ?? 0, tag: counters.tag ?? 0 },
        users: projectUsers(db.prepare("SELECT * FROM forum_users ORDER BY joined_at, rowid").all() as UserRow[], viewerId),
        categories: content.categories.filter(category =>
          allowed.includes(categorySettings.get(category.id) ?? "public") || referencedCategories.has(category.id)),
        tags: [...content.tags, ...(db.prepare("SELECT id, slug, name, color FROM forum_tags ORDER BY created_at, rowid").all() as TagRow[])
          .filter(tag => referencedTags.has(tag.id))],
        topics,
        posts: (db.prepare(`
            SELECT p.*, ${EFFECTIVE_VISIBILITY_EXPR} AS effective_visibility FROM forum_posts p
            JOIN forum_topics t ON t.id = p.topic_id ${TOPIC_VISIBILITY_JOIN}
            WHERE ${visible.sql}
            ORDER BY p.created_at, p.rowid
          `).all(...visible.params) as (PostRow & { effective_visibility: ViewerLevel })[])
          .map(row => toPostExcerpt(row, likes.get(row.id) ?? [], row.effective_visibility, reactions.get(row.id) ?? [])),
        notifications: viewerId === null ? [] : (db.prepare(`
            SELECT n.* FROM forum_notifications n LEFT JOIN forum_topics t ON t.id = n.topic_id ${TOPIC_VISIBILITY_JOIN}
            WHERE n.recipient_id = ? AND (n.topic_id IS NULL OR ${visible.sql})
            ORDER BY n.created_at DESC, n.rowid DESC
          `).all(viewerId, ...visible.params) as NotificationRow[]).map(toNotification),
        bookmarks: viewerId === null ? [] : (db.prepare(`
            SELECT b.user_id, b.post_id, b.created_at FROM forum_bookmarks b
            JOIN forum_posts p ON p.id = b.post_id
            JOIN forum_topics t ON t.id = p.topic_id ${TOPIC_VISIBILITY_JOIN}
            WHERE b.user_id = ? AND ${visible.sql}
            ORDER BY b.created_at, b.rowid
          `).all(viewerId, ...visible.params) as {
          user_id: string; post_id: string; created_at: number;
        }[]).map(row => ({ userId: row.user_id, postId: row.post_id, createdAt: row.created_at })),
        follows: (db.prepare("SELECT follower_id, followee_id, created_at FROM forum_follows ORDER BY created_at, rowid").all() as {
          follower_id: string; followee_id: string; created_at: number;
        }[]).map(row => ({ followerId: row.follower_id, followeeId: row.followee_id, createdAt: row.created_at })),
      };
    },

    /**
     * 写入之后回给前端的那几条记录（#145），投影与可见性和 state(viewerId) 完全一样：不存在的 id 直接跳过；
     * 通知只取收件人是看的人的，书签只查看的人自己的，游客两者都没有；只有本人的通知设置是真值。
     * 书签、关注查不到就放进 `removed`，前端据此删掉。
     * #156：帖子默认只回字段（`summary`，没正文也没摘要，点赞、书签这些不改正文的写入用它）；
     * 发帖、回复、编辑、删除传 `{ posts: "full" }` 才带 `content`，前端要把新正文显示出来。
     * #276：这里不按身份过滤——只会被叫来回写入者自己刚操作过的 id，看得到才操作得到。
     */
    changes(viewerId: string | null, keys: ChangeKeys, options: ChangeOptions = {}): ForumChanges {
      const unique = (list: string[] | undefined) => [...new Set(list ?? [])];
      const out: ForumChanges = {};
      const users = projectUsers(unique(keys.users).map(user).filter(row => row !== undefined), viewerId);
      if (users.length) out.users = users;
      const tags = unique(keys.tags)
        .map(id => curatedTags.get(id) ?? db.prepare("SELECT id, slug, name, color FROM forum_tags WHERE id = ?").get(id) as TagRow | undefined)
        .filter(tag => tag !== undefined);
      if (tags.length) out.tags = tags;
      const topics = unique(keys.topics).map(topicRow).filter(row => row !== undefined).map(toTopic);
      if (topics.length) out.topics = topics;
      const likes = likesByPost();
      const topicVisibility = topicVisibilityByTopic();
      const reactions = reactionsByPost(viewerId);
      const posts = unique(keys.posts).map(postRow).filter(row => row !== undefined).map(row => {
        const likeUserIds = likes.get(row.id) ?? [];
        const visibility = topicVisibility.get(row.topic_id) ?? "public";
        const reactionList = reactions.get(row.id) ?? [];
        return options.posts === "full" ? toPostFull(row, likeUserIds, visibility, reactionList) : toPostExcerpt(row, likeUserIds, visibility, reactionList);
      });
      if (posts.length) out.posts = posts;
      if (viewerId === null) return out;
      const ownNotification = db.prepare("SELECT * FROM forum_notifications WHERE id = ? AND recipient_id = ?");
      const notifications = unique(keys.notifications).map(id => ownNotification.get(id, viewerId) as NotificationRow | undefined)
        .filter(row => row !== undefined).map(toNotification);
      if (notifications.length) out.notifications = notifications;
      const removed: NonNullable<ForumChanges["removed"]> = {};
      const bookmarkAt = db.prepare("SELECT created_at FROM forum_bookmarks WHERE user_id = ? AND post_id = ?");
      for (const postId of unique(keys.bookmarks)) {
        const row = bookmarkAt.get(viewerId, postId) as { created_at: number } | undefined;
        if (row) (out.bookmarks ??= []).push({ userId: viewerId, postId, createdAt: row.created_at });
        else (removed.bookmarks ??= []).push({ userId: viewerId, postId });
      }
      const followAt = db.prepare("SELECT created_at FROM forum_follows WHERE follower_id = ? AND followee_id = ?");
      for (const { followerId, followeeId } of keys.follows ?? []) {
        const row = followAt.get(followerId, followeeId) as { created_at: number } | undefined;
        if (row) (out.follows ??= []).push({ followerId, followeeId, createdAt: row.created_at });
        else (removed.follows ??= []).push({ followerId, followeeId });
      }
      if (removed.bookmarks || removed.follows) out.removed = removed;
      return out;
    },

    // ---- #276 分级可见：分类设置、话题可见范围 ---------------------------------------------------

    /** 这个分类的基线可见范围；没有种子行时按 'public' 兜底，和 EFFECTIVE_VISIBILITY_EXPR 的 COALESCE 一致。 */
    categoryVisibility: categoryVisibilityOf,
    /** 控制台「论坛管理」分类页签（CONTRACT §8）：按内容里的分类顺序，带生效可见范围与真实话题数（不按身份过滤）。 */
    consoleCategories(): { id: string; name: string; visibility: ViewerLevel; topicCount: number }[] {
      const counts = new Map((db.prepare("SELECT category_id, COUNT(*) AS n FROM forum_topics GROUP BY category_id").all() as { category_id: string; n: number }[])
        .map(row => [row.category_id, row.n]));
      return content.categories.map(category => ({
        id: category.id, name: category.name, visibility: categoryVisibilityOf(category.id), topicCount: counts.get(category.id) ?? 0,
      }));
    },
    /** 控制台改分类可见范围（CONTRACT §8）：按 category_id 更新或插入，未知分类由路由层先用 hasCategory 挡掉。 */
    setCategoryVisibility(categoryId: string, visibility: ViewerLevel, updatedBy: string, now = Date.now()): void {
      db.prepare(`
        INSERT INTO forum_category_settings(category_id, visibility, updated_at, updated_by) VALUES (?, ?, ?, ?)
        ON CONFLICT(category_id) DO UPDATE SET visibility = excluded.visibility, updated_at = excluded.updated_at, updated_by = excluded.updated_by
      `).run(categoryId, visibility, now, updatedBy);
    },
    /**
     * PATCH 话题可见范围（CONTRACT §1）：`null` 回到跟随分类；非 null 只能比分类更严，更松回 `visibility_too_open`。
     * 话题不存在由路由层先用 topic() 挡掉。
     */
    setTopicVisibility(topicId: string, visibility: ViewerLevel | null): { ok: true } | { ok: false; code: "visibility_too_open" } {
      const row = topicRow(topicId)!;
      if (visibility !== null) {
        const base = categoryVisibilityOf(row.category_id);
        if (!isStricterOrEqual(visibility, base)) return { ok: false, code: "visibility_too_open" };
      }
      db.prepare("UPDATE forum_topics SET visibility = ? WHERE id = ?").run(visibility, topicId);
      return { ok: true };
    },

    // ---- #276 表情包 --------------------------------------------------------------------------

    /** `GET /api/forum/stickers`（CONTRACT §3）：只回 enabled 的包与表情。 */
    listStickerPacks(): { id: string; name: string; stickers: { id: string; shortcode: string; label: string; url: string }[] }[] {
      const packs = db.prepare("SELECT id, name FROM forum_sticker_packs WHERE enabled = 1 ORDER BY sort, rowid").all() as { id: string; name: string }[];
      const stickers = db.prepare("SELECT id, pack_id, shortcode, label, file_hash FROM forum_stickers WHERE enabled = 1 ORDER BY sort, rowid").all() as
        { id: string; pack_id: string; shortcode: string; label: string; file_hash: string }[];
      return packs.map(pack => ({
        id: pack.id, name: pack.name,
        stickers: stickers.filter(item => item.pack_id === pack.id).map(item => ({ id: item.id, shortcode: item.shortcode, label: item.label, url: stickerFileUrl(item.file_hash) })),
      }));
    },
    /** `GET /api/forum/stickers/:hash.webp`：按内容哈希取表情图片，公开、永久缓存。 */
    stickerFile: (hash: string) => (db.prepare("SELECT mime, bytes FROM forum_sticker_files WHERE hash = ?").get(hash) as { mime: string; bytes: Buffer } | undefined) ?? null,
    /** 这个短码是不是一个启用中的表情：PUT/DELETE 表情回应之前校验。 */
    stickerByShortcode: (shortcode: string) => (db.prepare("SELECT id FROM forum_stickers WHERE shortcode = ? AND enabled = 1").get(shortcode) as { id: string } | undefined) ?? null,
    stickerById: (id: string) => (db.prepare("SELECT id, enabled FROM forum_stickers WHERE id = ?").get(id) as { id: string; enabled: number } | undefined) ?? null,

    /** 控制台「表情包管理」（CONTRACT §8）：含停用的，带 use_count（= 回应数）。 */
    consoleStickerPacks(): { id: string; name: string; sort: number; enabled: boolean; stickers: { id: string; shortcode: string; label: string; url: string; sort: number; enabled: boolean; useCount: number }[] }[] {
      const packs = db.prepare("SELECT id, name, sort, enabled FROM forum_sticker_packs ORDER BY sort, rowid").all() as { id: string; name: string; sort: number; enabled: number }[];
      const stickers = db.prepare(`
        SELECT s.id AS id, s.pack_id AS pack_id, s.shortcode AS shortcode, s.label AS label, s.file_hash AS file_hash, s.sort AS sort, s.enabled AS enabled,
          (SELECT COUNT(*) FROM forum_reactions r WHERE r.sticker_id = s.id) AS use_count
        FROM forum_stickers s ORDER BY s.sort, s.rowid
      `).all() as { id: string; pack_id: string; shortcode: string; label: string; file_hash: string; sort: number; enabled: number; use_count: number }[];
      return packs.map(pack => ({
        id: pack.id, name: pack.name, sort: pack.sort, enabled: pack.enabled === 1,
        stickers: stickers.filter(item => item.pack_id === pack.id).map(item => ({
          id: item.id, shortcode: item.shortcode, label: item.label, url: stickerFileUrl(item.file_hash), sort: item.sort, enabled: item.enabled === 1, useCount: item.use_count,
        })),
      }));
    },
    /** 新建一个空表情包（排在最后）：id 已存在回 false。 */
    createStickerPack(id: string, name: string, now = Date.now()): boolean {
      const sort = (db.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM forum_sticker_packs").get() as { n: number }).n;
      return db.prepare("INSERT OR IGNORE INTO forum_sticker_packs(id, name, sort, enabled, created_at) VALUES (?, ?, ?, 1, ?)").run(id, name, sort, now).changes > 0;
    },
    updateStickerPack(id: string, patch: { name?: string; sort?: number; enabled?: boolean }): boolean {
      const columns: [string, string | number][] = [];
      if (patch.name !== undefined) columns.push(["name", patch.name]);
      if (patch.sort !== undefined) columns.push(["sort", patch.sort]);
      if (patch.enabled !== undefined) columns.push(["enabled", patch.enabled ? 1 : 0]);
      if (columns.length === 0) return db.prepare("SELECT 1 FROM forum_sticker_packs WHERE id = ?").get(id) !== undefined;
      return db.prepare(`UPDATE forum_sticker_packs SET ${columns.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`)
        .run(...columns.map(([, value]) => value), id).changes > 0;
    },
    updateSticker(id: string, patch: { label?: string; sort?: number; enabled?: boolean }): boolean {
      const columns: [string, string | number][] = [];
      if (patch.label !== undefined) columns.push(["label", patch.label]);
      if (patch.sort !== undefined) columns.push(["sort", patch.sort]);
      if (patch.enabled !== undefined) columns.push(["enabled", patch.enabled ? 1 : 0]);
      if (columns.length === 0) return db.prepare("SELECT 1 FROM forum_stickers WHERE id = ?").get(id) !== undefined;
      return db.prepare(`UPDATE forum_stickers SET ${columns.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`)
        .run(...columns.map(([, value]) => value), id).changes > 0;
    },
    /** 新增一个表情（CONTRACT §8）：图片按内容 sha256 去重，shortcode 唯一，重复回 409（路由层先查 stickerByShortcode 的裸查询）。 */
    createSticker(packId: string, shortcode: string, label: string, hash: string, mime: string, bytes: Buffer, now = Date.now()): string | null {
      if (!db.prepare("SELECT 1 FROM forum_sticker_packs WHERE id = ?").get(packId)) return null;
      return db.transaction(() => {
        db.prepare("INSERT OR IGNORE INTO forum_sticker_files(hash, mime, bytes, created_at) VALUES (?, ?, ?, ?)").run(hash, mime, bytes, now);
        const sort = (db.prepare("SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM forum_stickers WHERE pack_id = ?").get(packId) as { n: number }).n;
        db.prepare("INSERT INTO forum_stickers(id, pack_id, shortcode, label, file_hash, sort, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)").run(shortcode, packId, shortcode, label, hash, sort);
        return shortcode;
      })();
    },

    // ---- #276 表情回应 ------------------------------------------------------------------------

    /** 一条帖子的表情回应聚合（和帖子响应里的 reactions 同形状），给 PUT/DELETE 回应之后的回答用。 */
    reactionsForPost(postId: string, viewerId: string | null): ForumReactionSummary[] {
      return reactionsByPost(viewerId).get(postId) ?? [];
    },
    /** 加一条表情回应：已有同一人同一表情的不重复加（主键去重），返回是不是新加的。 */
    addReaction(postId: string, accountId: string, stickerId: string, now = Date.now()): boolean {
      return db.prepare("INSERT OR IGNORE INTO forum_reactions(post_id, account_id, sticker_id, created_at) VALUES (?, ?, ?, ?)").run(postId, accountId, stickerId, now).changes > 0;
    },
    removeReaction(postId: string, accountId: string, stickerId: string): boolean {
      return db.prepare("DELETE FROM forum_reactions WHERE post_id = ? AND account_id = ? AND sticker_id = ?").run(postId, accountId, stickerId).changes > 0;
    },

    // ---- #276 上传图片 ------------------------------------------------------------------------

    uploadFile: (hash: string) => (db.prepare("SELECT mime, bytes, width, height FROM forum_upload_files WHERE hash = ?").get(hash) as
      { mime: string; bytes: Buffer; width: number; height: number } | undefined) ?? null,
    saveUpload(hash: string, mime: string, bytes: Buffer, width: number, height: number, uploadedBy: string, now = Date.now()): void {
      db.prepare("INSERT OR IGNORE INTO forum_upload_files(hash, mime, bytes, width, height, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(hash, mime, bytes, width, height, uploadedBy, now);
    },

    // ---- #276 @ 自动补全 ----------------------------------------------------------------------

    /** `GET /api/forum/users/suggest`（CONTRACT §6）：按 username、displayName 前缀匹配，不分大小写，只回在用账号。 */
    suggestUsers(query: string, limit: number): { username: string; displayName: string; avatarUrl: string | null }[] {
      return findUsers(null, query, true, limit, true)
        .map(user => ({ username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl ?? null }));
    },
  };
}
export type ForumStore = ReturnType<typeof createForumStore>;
