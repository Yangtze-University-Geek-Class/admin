import type { Prng } from './prng'
import type {
  Bookmark,
  Category,
  Follow,
  ForumState,
  Notification,
  Post,
  SessionState,
  Tag,
  Topic,
  User,
} from './types'
import { extractMentions } from './mentions'
import { mulberry32 } from './prng'
import {
  AVATAR_PALETTE,
  CATEGORY_SEEDS,
  REPLY_SNIPPETS,
  TAG_SEEDS,
  TOPIC_SEEDS,
  USER_SEEDS,
} from './seed-content'
import { FORUM_STATE_VERSION } from './types'

/**
 * Builds the demo forum from `seed-content.ts`.
 *
 * Deterministic: the only inputs are the fixed PRNG seed and `now`. Two calls
 * with the same `now` are deep-equal, and `now` only shifts timestamps — every
 * id, title, author and count is the same for any `now`, because no branch
 * that consumes the PRNG depends on it.
 */

/** Fixed PRNG seed; changing it reshuffles every reply, like and timestamp. */
export const SEED_VALUE = 0x54554646

/** The demo opens signed in as the admin so write actions are visible at once. */
export const DEFAULT_SESSION: SessionState = { currentUserId: 'u1' }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Topic slugs derive from the counter, so the store can mint them the same way. */
export function topicSlug(sequence: number): string {
  return `topic-${sequence}`
}

/**
 * URL slug for a tag name: lowercased, whitespace joined with `-`, everything
 * outside `[a-z0-9-]` dropped. A name with no ASCII left (a Chinese tag, say)
 * slugs to `''`; the store falls back to its counter so `/tag/<slug>` stays
 * addressable.
 */
export function tagSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

/** Notifications, bookmarks and follows pull the newest N candidates; these are the N. */
const NOTIFICATION_QUOTA: Record<'reply' | 'like' | 'mention' | 'follow', number> = { reply: 14, like: 8, mention: 4, follow: 4 }
const BOOKMARK_QUOTA: Record<'admin' | 'others', number> = { admin: 4, others: 9 }

export function createSeed(now: number = Date.now()): ForumState {
  const rng = mulberry32(SEED_VALUE)

  const users = buildUsers(rng, now)
  const categories = buildCategories()
  const tags = buildTags()
  const { topics, posts } = buildTopicsAndPosts(rng, now, users, categories, tags)
  const follows = buildFollows(rng, now, users)
  const bookmarks = buildBookmarks(rng, now, users, posts)
  const notifications = buildNotifications(rng, now, users, topics, posts, follows)

  return {
    version: FORUM_STATE_VERSION,
    seededAt: now,
    counters: {
      topic: topics.length,
      post: posts.length,
      notification: notifications.length,
      tag: tags.length,
    },
    users,
    categories,
    tags,
    topics,
    posts,
    notifications,
    bookmarks,
    follows,
  }
}

// ---------------------------------------------------------------- users / taxonomy

function buildUsers(rng: Prng, now: number): User[] {
  return USER_SEEDS.map((seed, index) => ({
    id: `u${index + 1}`,
    username: seed.username,
    displayName: seed.displayName,
    bio: seed.bio,
    location: seed.location,
    website: seed.website,
    avatarColor: AVATAR_PALETTE[index % AVATAR_PALETTE.length] as string,
    joinedAt: now - seed.joinedDaysAgo * DAY - rng.int(0, 23) * HOUR - rng.int(0, 59) * MINUTE,
    role: seed.role,
    // Copied, not shared: the store mutates users in place.
    ...(seed.title ? { title: { ...seed.title } } : {}),
    notifyPrefs: { reply: true, like: true, follow: true },
  }))
}

function buildCategories(): Category[] {
  return CATEGORY_SEEDS.map((seed, index) => ({ id: `c${index + 1}`, ...seed }))
}

function buildTags(): Tag[] {
  return TAG_SEEDS.map((seed, index) => ({ id: `tag${index + 1}`, ...seed }))
}

// ---------------------------------------------------------------- topics / posts

function buildTopicsAndPosts(
  rng: Prng,
  now: number,
  users: User[],
  categories: Category[],
  tags: Tag[],
): { topics: Topic[], posts: Post[] } {
  const userByUsername = new Map(users.map(user => [user.username, user]))
  const userSeedByUsername = new Map(USER_SEEDS.map(seed => [seed.username, seed]))
  const categoryBySlug = new Map(categories.map(category => [category.slug, category]))
  const tagBySlug = new Map(tags.map(tag => [tag.slug, tag]))

  const topics: Topic[] = []
  const posts: Post[] = []

  TOPIC_SEEDS.forEach((seed, index) => {
    const author = lookup(userByUsername, seed.author, 'user')
    const authorSeed = lookup(userSeedByUsername, seed.author, 'user seed')
    const category = lookup(categoryBySlug, seed.category, 'category')
    const tagIds = seed.tags.map(slug => lookup(tagBySlug, slug, 'tag').id)

    // Skewed toward recent, and never before the author's account existed.
    const wantedAge = seed.ageDays ?? Math.floor(rng.next() ** 2 * 320)
    const ageDays = Math.min(wantedAge, authorSeed.joinedDaysAgo - 1)
    const createdAt = now - ageDays * DAY - rng.int(1, 23) * HOUR - rng.int(0, 59) * MINUTE

    const replyTarget = seed.replies ?? pickReplyCount(rng)
    const sequence = index + 1
    const topicId = `t${sequence}`

    const firstPost: Post = {
      id: `p${posts.length + 1}`,
      topicId,
      authorId: author.id,
      content: seed.body,
      createdAt,
      likeUserIds: pickLikers(rng, users, author.id, createdAt, true),
    }
    posts.push(firstPost)

    const replies: Post[] = []
    let previousAt = createdAt
    for (let k = 0; k < replyTarget; k++) {
      // Clamp each gap so the whole thread still fits before `now`.
      const ceiling = Math.floor((now - MINUTE - previousAt) / (replyTarget - k + 1))
      const at = previousAt + Math.max(1, Math.min(pickGap(rng), ceiling))

      const replyTo = replies.length > 0 && rng.chance(0.35) ? rng.pick(replies) : undefined
      const targetPost = replyTo ?? firstPost
      const targetUser = lookupById(users, targetPost.authorId)

      const snippet = rng.pick(REPLY_SNIPPETS)
      const needsTarget = snippet.includes('{mention}') || snippet.includes('{quote}')
      const candidates = users.filter(user => user.joinedAt < at && (!needsTarget || user.id !== targetUser.id))
      const replyAuthor = rng.pick(candidates)

      const reply: Post = {
        id: `p${posts.length + 1}`,
        topicId,
        authorId: replyAuthor.id,
        content: renderSnippet(snippet, targetUser, targetPost),
        createdAt: at,
        likeUserIds: pickLikers(rng, users, replyAuthor.id, at, false),
      }
      if (replyTo)
        reply.replyToPostId = replyTo.id
      if (rng.chance(0.06))
        reply.editedAt = Math.min(at + rng.int(5, 600) * MINUTE, now - 1)

      posts.push(reply)
      replies.push(reply)
      previousAt = at
    }

    const lastActivityAt = replies.length > 0 ? (replies[replies.length - 1] as Post).createdAt : createdAt
    const pinned = seed.pinned === true
    const baseViews = 20 + replyTarget * rng.int(12, 60) + ageDays * rng.int(1, 6)
    const views = Math.min(4000, baseViews + (pinned ? rng.int(500, 1500) : 0))

    topics.push({
      id: topicId,
      slug: topicSlug(sequence),
      title: seed.title,
      categoryId: category.id,
      tagIds,
      authorId: author.id,
      createdAt,
      lastActivityAt,
      views,
      pinned,
      closed: seed.closed === true,
    })
  })

  return { topics, posts }
}

function pickReplyCount(rng: Prng): number {
  const roll = rng.next()
  if (roll < 0.15)
    return 0
  if (roll < 0.57)
    return rng.int(1, 3)
  if (roll < 0.87)
    return rng.int(4, 6)
  return rng.int(7, 10)
}

function pickGap(rng: Prng): number {
  const roll = rng.next()
  if (roll < 0.45)
    return rng.int(3, 59) * MINUTE
  if (roll < 0.85)
    return rng.int(1, 23) * HOUR
  return rng.int(1, 4) * DAY
}

function pickLikers(rng: Prng, users: User[], authorId: string, at: number, isFirstPost: boolean): string[] {
  const roll = rng.next()
  let count = roll < 0.4 ? 0 : roll < 0.8 ? rng.int(1, 3) : roll < 0.95 ? rng.int(4, 8) : rng.int(9, 15)
  if (isFirstPost)
    count += rng.int(0, 6)
  // Nobody likes their own post, and nobody liked anything before signing up.
  const eligible = users.filter(user => user.id !== authorId && user.joinedAt < at)
  return rng.shuffle(eligible).slice(0, count).map(user => user.id)
}

function renderSnippet(snippet: string, targetUser: User, targetPost: Post): string {
  return snippet
    .replaceAll('{mention}', `@${targetUser.username}`)
    .replaceAll('{quote}', `> ${excerpt(targetPost.content)}`)
}

/** First prose line of a Markdown body, for quotes and bookmark previews. */
export function excerpt(markdown: string, max = 48): string {
  const line = markdown
    .split('\n')
    .map(part => part.trim())
    .find(part => part.length > 0 && !/^[#>|~`\-*\d]/.test(part))
  const plain = (line ?? markdown.trim()).replace(/[`*_]/g, '')
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}

// ---------------------------------------------------------------- follows / bookmarks

function buildFollows(rng: Prng, now: number, users: User[]): Follow[] {
  const admin = users[0] as User
  const pairs = new Set<string>()
  const follows: Follow[] = []

  const add = (follower: User, followee: User): void => {
    const key = `${follower.id}>${followee.id}`
    if (follower.id === followee.id || pairs.has(key))
      return
    pairs.add(key)
    // Some time after both accounts existed, but not in the last hour.
    const earliest = Math.max(follower.joinedAt, followee.joinedAt) + HOUR
    const span = Math.max(1, now - HOUR - earliest)
    follows.push({ followerId: follower.id, followeeId: followee.id, createdAt: earliest + Math.floor(rng.next() * span) })
  }

  for (const user of users) {
    if (user.id !== admin.id && rng.chance(0.55))
      add(user, admin)
    const others = users.filter(candidate => candidate.id !== user.id && candidate.id !== admin.id)
    for (const target of rng.shuffle(others).slice(0, rng.int(0, 2)))
      add(user, target)
  }

  return follows.sort((a, b) => a.createdAt - b.createdAt || a.followerId.localeCompare(b.followerId))
}

function buildBookmarks(rng: Prng, now: number, users: User[], posts: Post[]): Bookmark[] {
  const pairs = new Set<string>()
  const bookmarks: Bookmark[] = []

  const add = (user: User, post: Post): void => {
    const key = `${user.id}>${post.id}`
    if (post.authorId === user.id || pairs.has(key))
      return
    pairs.add(key)
    const earliest = Math.max(post.createdAt, user.joinedAt)
    bookmarks.push({ userId: user.id, postId: post.id, createdAt: Math.min(earliest + rng.int(1, 72) * HOUR, now - 1) })
  }

  const admin = users[0] as User
  for (const post of rng.shuffle(posts).slice(0, BOOKMARK_QUOTA.admin))
    add(admin, post)

  const members = users.slice(1)
  for (let i = 0; i < BOOKMARK_QUOTA.others; i++)
    add(rng.pick(members), rng.pick(posts))

  return bookmarks.sort((a, b) => a.createdAt - b.createdAt || a.postId.localeCompare(b.postId))
}

// ---------------------------------------------------------------- notifications

type NotificationDraft = Omit<Notification, 'id' | 'read'>

function buildNotifications(
  rng: Prng,
  now: number,
  users: User[],
  topics: Topic[],
  posts: Post[],
  follows: Follow[],
): Notification[] {
  const admin = users[0] as User
  const userByUsername = new Map(users.map(user => [user.username, user]))
  const topicById = new Map(topics.map(topic => [topic.id, topic]))
  const postById = new Map(posts.map(post => [post.id, post]))
  const firstPostIds = new Set(topics.map(topic => (posts.find(post => post.topicId === topic.id) as Post).id))

  const newestFirst = [...posts].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  const replies = newestFirst.filter(post => !firstPostIds.has(post.id))
  const drafts: NotificationDraft[] = []
  /** `${recipient}:${post}` pairs already covered, so a mention never duplicates a reply. */
  const notifiedForPost = new Set<string>()

  // Replies: to the replied-to author, or the topic author.
  let replyBudget = NOTIFICATION_QUOTA.reply
  for (const post of replies) {
    if (replyBudget === 0)
      break
    const target = post.replyToPostId ? postById.get(post.replyToPostId) : undefined
    const recipientId = target?.authorId ?? lookup(topicById, post.topicId, 'topic').authorId
    if (recipientId === post.authorId)
      continue
    drafts.push({ recipientId, type: 'reply', actorId: post.authorId, topicId: post.topicId, postId: post.id, createdAt: post.createdAt })
    notifiedForPost.add(`${recipientId}:${post.id}`)
    replyBudget--
  }

  // Likes: the first liker of the newest liked posts.
  let likeBudget = NOTIFICATION_QUOTA.like
  for (const post of newestFirst) {
    if (likeBudget === 0)
      break
    const actorId = post.likeUserIds[0]
    if (!actorId)
      continue
    drafts.push({
      recipientId: post.authorId,
      type: 'like',
      actorId,
      topicId: post.topicId,
      postId: post.id,
      createdAt: Math.min(post.createdAt + rng.int(10, 600) * MINUTE, now - 1),
    })
    likeBudget--
  }

  // Mentions: `@username` in the newest replies, skipping people already told.
  let mentionBudget = NOTIFICATION_QUOTA.mention
  for (const post of replies) {
    if (mentionBudget === 0)
      break
    for (const handle of extractMentions(post.content)) {
      const mentioned = userByUsername.get(handle)
      if (!mentioned || mentioned.id === post.authorId || notifiedForPost.has(`${mentioned.id}:${post.id}`))
        continue
      drafts.push({ recipientId: mentioned.id, type: 'mention', actorId: post.authorId, topicId: post.topicId, postId: post.id, createdAt: post.createdAt })
      notifiedForPost.add(`${mentioned.id}:${post.id}`)
      if (--mentionBudget === 0)
        break
    }
  }

  // Follows: the newest few.
  const newestFollows = [...follows].sort((a, b) => b.createdAt - a.createdAt).slice(0, NOTIFICATION_QUOTA.follow)
  for (const follow of newestFollows)
    drafts.push({ recipientId: follow.followeeId, type: 'follow', actorId: follow.followerId, createdAt: follow.createdAt })

  // System: a nudge to the admin and a welcome to the newest member.
  const newest = users.reduce((latest, user) => (user.joinedAt > latest.joinedAt ? user : latest), admin)
  drafts.push({ recipientId: admin.id, type: 'system', actorId: admin.id, createdAt: now - 3 * DAY - rng.int(0, 23) * HOUR })
  drafts.push({ recipientId: newest.id, type: 'system', actorId: admin.id, createdAt: newest.joinedAt + HOUR })

  drafts.sort((a, b) => a.createdAt - b.createdAt || a.recipientId.localeCompare(b.recipientId))
  return drafts.map((draft, index) => ({
    id: `n${index + 1}`,
    ...draft,
    // Old ones were mostly seen; recent ones mostly not.
    read: rng.chance(draft.createdAt < now - 2 * DAY ? 0.75 : 0.25),
  }))
}

// ---------------------------------------------------------------- helpers

function lookup<T>(map: Map<string, T>, key: string, kind: string): T {
  const value = map.get(key)
  if (!value)
    throw new Error(`seed: unknown ${kind} "${key}"`)
  return value
}

function lookupById(users: User[], id: string): User {
  const user = users.find(candidate => candidate.id === id)
  if (!user)
    throw new Error(`seed: unknown user id "${id}"`)
  return user
}
