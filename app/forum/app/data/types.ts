import type { UserTitle } from './titles'

/**
 * Forum entities. Everything the app shows derives from `ForumState`; counts
 * (replies, likes, followers…) are computed by the store, never stored twice.
 *
 * Timestamps are epoch milliseconds. Ids come from `ForumState.counters`
 * (`t46`, `p221`, `n31`), never from the clock or a random source, so a seed
 * and every state grown from it stay deterministic.
 */

export const FORUM_STATE_VERSION = 1

export type UserRole = 'admin' | 'moderator' | 'member'

/**
 * Who the account belongs to, set by the forum server (`/api/forum/state`):
 * a signed-in 极客班 member, a guest who replied under a nickname (no login,
 * no editable profile), or the 极客班 account that owns the published old
 * posts. The demo seed and the snapshot leave it out: everyone is a member.
 */
export type UserKind = 'member' | 'guest' | 'official'

export interface NotifyPrefs {
  reply: boolean
  like: boolean
  follow: boolean
}

export interface User {
  id: string
  /** ASCII handle used in `@mentions` and `/u/[username]`. */
  username: string
  displayName: string
  bio: string
  location: string
  website: string
  /** Hex colour behind the initials avatar. */
  avatarColor: string
  /**
   * Optional picture: the uploaded avatar or the GitHub one from the forum
   * server, or the local snapshot's asset route. The seed never sets it and
   * initials remain the fallback.
   */
  avatarUrl?: string
  kind?: UserKind
  joinedAt: number
  role: UserRole
  /**
   * Optional 极客班 title (舰长, 队长, 领航员 …) shown beside the name.
   * `role` is unchanged by it. Forum permissions read both: an admin or
   * moderator holds every forum capability, anyone else what their title
   * carries (`hasForumCapability` in `permissions.ts`).
   */
  title?: UserTitle
  notifyPrefs: NotifyPrefs
}

export interface Category {
  id: string
  slug: string
  name: string
  description: string
  /** Hex colour for the category dot. */
  color: string
  /** UnoCSS icon class, `i-carbon-*`. */
  icon: string
}

export interface Tag {
  id: string
  slug: string
  name: string
  color: string
}

export interface Topic {
  id: string
  slug: string
  title: string
  categoryId: string
  tagIds: string[]
  authorId: string
  createdAt: number
  /** Timestamp of the newest post; the "latest" sort key. */
  lastActivityAt: number
  views: number
  pinned: boolean
  closed: boolean
}

export interface Post {
  id: string
  topicId: string
  authorId: string
  /**
   * Markdown. Empty once the post is soft-deleted, and absent in a list the
   * forum server answered without bodies (#156): `/state` carries `excerpt`
   * instead, and the topic page asks for this topic's posts to get `content`.
   * “Absent” means “this answer did not send a body”, not “the post is
   * empty” — a merge must keep the body the page already holds.
   */
  content?: string
  /**
   * One line of plain text the server cut from the body (#156), for lists and
   * search hits. Present on every post `/state` returns; `content` is not.
   * The demo seed and the snapshot leave it out and use `content`.
   */
  excerpt?: string
  createdAt: number
  editedAt?: number
  /** Set when the reply targets a specific post rather than the topic. */
  replyToPostId?: string
  likeUserIds: string[]
  deleted?: boolean
}

export type NotificationType = 'reply' | 'like' | 'follow' | 'mention' | 'system'

export interface Notification {
  id: string
  recipientId: string
  type: NotificationType
  /** Who caused it. System notifications are attributed to the admin. */
  actorId: string
  topicId?: string
  postId?: string
  createdAt: number
  read: boolean
}

export interface Bookmark {
  userId: string
  postId: string
  createdAt: number
}

export interface Follow {
  followerId: string
  followeeId: string
  createdAt: number
}

export interface Counters {
  topic: number
  post: number
  notification: number
  /**
   * Added with tag creation. A state written before it exists resumes from
   * `tags.length` (see `parseState`), so the version stays at 1 and nobody's
   * local forum is reseeded by the upgrade.
   */
  tag: number
}

export interface ForumState {
  version: typeof FORUM_STATE_VERSION
  seededAt: number
  counters: Counters
  users: User[]
  categories: Category[]
  tags: Tag[]
  topics: Topic[]
  posts: Post[]
  notifications: Notification[]
  bookmarks: Bookmark[]
  follows: Follow[]
}

/**
 * What one write changed, as the forum server sends it back (#145): the
 * records in the same shape as in `ForumState`, merged by id into the state
 * the page already holds (`applyChanges` in stores/forum.ts). Bookmarks and
 * follows have no id; one that no longer exists comes under `removed`.
 *
 * Posts come in two shapes (#156): the answer to a write that did not change
 * a body (a like, a bookmark) carries `excerpt` like `/state` does, and the
 * answer to one that did (发贴、回复、编辑、删除) carries `content`. A post
 * whose `content` is absent is not a deleted post — it means “the server did
 * not send a body”, and `postExcerpt()` reads `excerpt` instead.
 */
export interface ForumChanges {
  users?: User[]
  tags?: Tag[]
  topics?: Topic[]
  posts?: Post[]
  notifications?: Notification[]
  bookmarks?: Bookmark[]
  follows?: Follow[]
  removed?: {
    bookmarks?: Array<Pick<Bookmark, 'userId' | 'postId'>>
    follows?: Array<Pick<Follow, 'followerId' | 'followeeId'>>
  }
}

export interface SessionState {
  currentUserId: string | null
}
