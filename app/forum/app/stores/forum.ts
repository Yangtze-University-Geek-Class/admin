import type {
  Bookmark,
  Category,
  ForumState,
  Notification,
  NotificationType,
  Post,
  Tag,
  Topic,
  User,
} from '~/data/types'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { extractMentions } from '~/data/mentions'
import { createSeed, tagSlug, topicSlug } from '~/data/seed'
import { AVATAR_PALETTE } from '~/data/seed-content'

/**
 * The whole forum lives in one Pinia setup store: `state` is the seed (or the
 * localStorage copy of it) and every page reads through the getters below.
 *
 * - Ids come from `state.counters`, never from time or randomness.
 * - Derived numbers (reply / like / follower counts) are computed, not stored.
 * - Actions do not check permissions; the UI asks `can()` before it renders a
 *   control. The one rule the store enforces itself is "the first post of a
 *   topic cannot be deleted", because breaking it corrupts the data model.
 * - Timestamps default to `Date.now()`; every action takes an optional `at`
 *   so tests can pin them.
 */

export type TopicSortMode = 'latest' | 'new' | 'top'

export interface TopicFilter {
  mode: TopicSortMode
  categoryId?: string
  tagId?: string
}

export interface CreateTopicInput {
  title: string
  /**
   * Existing tag ids. An entry that no tag answers to is read as a **name** and
   * minted through `createTag` — that is how the composer's `allow-create`
   * values (which arrive as the typed label) reach the store.
   */
  tagIds: string[]
  categoryId: string
  content: string
  authorId: string
  at?: number
}

export interface CreatePostInput {
  topicId: string
  authorId: string
  content: string
  replyToPostId?: string
  at?: number
}

export type ProfilePatch = Partial<Pick<User, 'displayName' | 'bio' | 'location' | 'website' | 'avatarColor' | 'notifyPrefs'>>

export interface SearchResults {
  topics: Topic[]
  posts: Post[]
  users: User[]
}

export interface BookmarkEntry {
  bookmark: Bookmark
  post: Post
  topic: Topic
}

export interface UserStats {
  topics: number
  replies: number
  likesReceived: number
  likesGiven: number
  followers: number
  following: number
}

export interface LikerSummary {
  user: User
  count: number
}

export interface TagSummary {
  tag: Tag
  count: number
}

export type ActivityKind = 'topic' | 'reply' | 'like' | 'bookmark'

export interface ActivityEvent {
  kind: ActivityKind
  at: number
  topicId: string
  postId?: string
}

const SEARCH_LIMIT = 50

/**
 * Appends and hands back the element as the store will serve it. `state` is a
 * deep `ref`, so what goes in is the raw object and what every getter returns
 * is its reactive proxy; returning the raw one would break `===` for callers.
 */
function pushReactive<T extends object>(list: T[], item: T): T {
  list.push(item)
  return list[list.length - 1] as T
}

export const useForumStore = defineStore('forum', () => {
  const state = ref<ForumState>(createSeed())

  // ---------------------------------------------------------------- indexes

  const topicMap = computed(() => new Map(state.value.topics.map(topic => [topic.id, topic])))
  const postMap = computed(() => new Map(state.value.posts.map(post => [post.id, post])))
  const userMap = computed(() => new Map(state.value.users.map(user => [user.id, user])))
  const usernameMap = computed(() => new Map(state.value.users.map(user => [user.username.toLowerCase(), user])))
  const categoryMap = computed(() => new Map(state.value.categories.map(category => [category.id, category])))
  const categorySlugMap = computed(() => new Map(state.value.categories.map(category => [category.slug, category])))
  const tagMap = computed(() => new Map(state.value.tags.map(tag => [tag.id, tag])))
  const tagSlugMap = computed(() => new Map(state.value.tags.map(tag => [tag.slug, tag])))

  /** Posts grouped by topic, oldest first. Reads no per-post fields other than the keys, so a like or an edit does not rebuild it. */
  const postsByTopic = computed(() => {
    const groups = new Map<string, Post[]>()
    for (const post of state.value.posts) {
      const group = groups.get(post.topicId)
      if (group)
        group.push(post)
      else
        groups.set(post.topicId, [post])
    }
    for (const group of groups.values())
      group.sort((a, b) => a.createdAt - b.createdAt)
    return groups
  })

  /** Ids of every topic's first post; the one post that is never deletable. */
  const firstPostIds = computed(() => {
    const ids = new Set<string>()
    for (const group of postsByTopic.value.values()) {
      const first = group[0]
      if (first)
        ids.add(first.id)
    }
    return ids
  })

  // ---------------------------------------------------------------- lookups

  function topicById(id: string): Topic | undefined {
    return topicMap.value.get(id)
  }

  function postById(id: string): Post | undefined {
    return postMap.value.get(id)
  }

  function postsOfTopic(topicId: string): Post[] {
    return postsByTopic.value.get(topicId) ?? []
  }

  function firstPostOf(topicId: string): Post | undefined {
    return postsByTopic.value.get(topicId)?.[0]
  }

  function isFirstPost(postId: string): boolean {
    return firstPostIds.value.has(postId)
  }

  function userById(id: string): User | undefined {
    return userMap.value.get(id)
  }

  function userByUsername(username: string): User | undefined {
    return usernameMap.value.get(username.toLowerCase())
  }

  function categoryById(id: string): Category | undefined {
    return categoryMap.value.get(id)
  }

  function categoryBySlug(slug: string): Category | undefined {
    return categorySlugMap.value.get(slug)
  }

  function tagById(id: string): Tag | undefined {
    return tagMap.value.get(id)
  }

  function tagBySlug(slug: string): Tag | undefined {
    return tagSlugMap.value.get(slug)
  }

  // ---------------------------------------------------------------- topic-level derivations

  function livePostsOf(topicId: string): Post[] {
    return postsOfTopic(topicId).filter(post => !post.deleted)
  }

  function replyCount(topicId: string): number {
    return Math.max(0, livePostsOf(topicId).length - 1)
  }

  function likeCountOfTopic(topicId: string): number {
    return livePostsOf(topicId).reduce((sum, post) => sum + post.likeUserIds.length, 0)
  }

  /** Unique authors in order of first appearance, the topic author first. */
  function participants(topicId: string): User[] {
    const seen = new Set<string>()
    const users: User[] = []
    for (const post of livePostsOf(topicId)) {
      if (seen.has(post.authorId))
        continue
      seen.add(post.authorId)
      const user = userById(post.authorId)
      if (user)
        users.push(user)
    }
    return users
  }

  function topicCountOfCategory(categoryId: string): number {
    return state.value.topics.filter(topic => topic.categoryId === categoryId).length
  }

  function topicCountOfTag(tagId: string): number {
    return state.value.topics.filter(topic => topic.tagIds.includes(tagId)).length
  }

  /**
   * Tags ranked busiest first, ties by name: the one order both the sidebar's
   * "热门标签" section and `/tags` show, so the two cannot drift apart.
   */
  function tagsByPopularity(n?: number): TagSummary[] {
    const ranked = state.value.tags
      .map(tag => ({ tag, count: topicCountOfTag(tag.id) }))
      .sort((a, b) => b.count - a.count || a.tag.name.localeCompare(b.tag.name, 'zh-Hans-CN'))
    return n === undefined ? ranked : ranked.slice(0, n)
  }

  function topicScore(topic: Topic): number {
    return likeCountOfTopic(topic.id) + replyCount(topic.id) * 2 + topic.views / 50
  }

  /** Pinned topics first in every mode; ties fall back to the newer topic. */
  function sortedTopics(filter: TopicFilter): Topic[] {
    const key: (topic: Topic) => number
      = filter.mode === 'new'
        ? topic => topic.createdAt
        : filter.mode === 'top'
          ? topicScore
          : topic => topic.lastActivityAt

    return state.value.topics
      .filter(topic => (!filter.categoryId || topic.categoryId === filter.categoryId)
        && (!filter.tagId || topic.tagIds.includes(filter.tagId)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || key(b) - key(a) || b.createdAt - a.createdAt)
  }

  function recentTopicsOfCategory(categoryId: string, n: number): Topic[] {
    return state.value.topics
      .filter(topic => topic.categoryId === categoryId)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, n)
  }

  /** Same category first, newest activity first; other categories fill the remainder. */
  function suggestedTopics(topicId: string, n = 5): Topic[] {
    const current = topicById(topicId)
    if (!current)
      return []
    const others = state.value.topics
      .filter(topic => topic.id !== topicId)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    const same = others.filter(topic => topic.categoryId === current.categoryId)
    const rest = others.filter(topic => topic.categoryId !== current.categoryId)
    return [...same, ...rest].slice(0, n)
  }

  // ---------------------------------------------------------------- search

  function searchAll(query: string): SearchResults {
    const q = query.trim().toLowerCase()
    if (!q)
      return { topics: [], posts: [], users: [] }
    return {
      topics: state.value.topics
        .filter(topic => topic.title.toLowerCase().includes(q))
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
        .slice(0, SEARCH_LIMIT),
      posts: state.value.posts
        .filter(post => !post.deleted && post.content.toLowerCase().includes(q))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, SEARCH_LIMIT),
      users: state.value.users
        .filter(user => user.username.toLowerCase().includes(q) || user.displayName.toLowerCase().includes(q))
        .slice(0, SEARCH_LIMIT),
    }
  }

  // ---------------------------------------------------------------- notifications / bookmarks / follows

  function notificationsOf(userId: string): Notification[] {
    return state.value.notifications
      .filter(notification => notification.recipientId === userId)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  }

  function unreadCount(userId: string): number {
    return state.value.notifications.filter(notification => notification.recipientId === userId && !notification.read).length
  }

  function bookmarksOf(userId: string): BookmarkEntry[] {
    const entries: BookmarkEntry[] = []
    for (const bookmark of state.value.bookmarks) {
      if (bookmark.userId !== userId)
        continue
      const post = postById(bookmark.postId)
      const topic = post && topicById(post.topicId)
      if (post && topic)
        entries.push({ bookmark, post, topic })
    }
    return entries.sort((a, b) => b.bookmark.createdAt - a.bookmark.createdAt)
  }

  function isBookmarked(userId: string, postId: string): boolean {
    return state.value.bookmarks.some(bookmark => bookmark.userId === userId && bookmark.postId === postId)
  }

  function isFollowing(followerId: string, followeeId: string): boolean {
    return state.value.follows.some(follow => follow.followerId === followerId && follow.followeeId === followeeId)
  }

  // ---------------------------------------------------------------- per-user derivations

  function livePostsOfUser(userId: string): Post[] {
    return state.value.posts.filter(post => post.authorId === userId && !post.deleted)
  }

  function topicsOfUser(userId: string): Topic[] {
    return state.value.topics
      .filter(topic => topic.authorId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  function repliesOfUser(userId: string): Post[] {
    return livePostsOfUser(userId)
      .filter(post => !isFirstPost(post.id))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  function statsOfUser(userId: string): UserStats {
    const posts = livePostsOfUser(userId)
    return {
      topics: state.value.topics.filter(topic => topic.authorId === userId).length,
      replies: posts.filter(post => !isFirstPost(post.id)).length,
      likesReceived: posts.reduce((sum, post) => sum + post.likeUserIds.length, 0),
      likesGiven: state.value.posts.filter(post => !post.deleted && post.likeUserIds.includes(userId)).length,
      followers: state.value.follows.filter(follow => follow.followeeId === userId).length,
      following: state.value.follows.filter(follow => follow.followerId === userId).length,
    }
  }

  /** The user's replies with the most likes (Discourse "top replies"; first posts belong to "top topics"). */
  function topLikedPostsOfUser(userId: string, n = 5): Post[] {
    return repliesOfUser(userId)
      .sort((a, b) => b.likeUserIds.length - a.likeUserIds.length || b.createdAt - a.createdAt)
      .slice(0, n)
  }

  function topTopicsOfUser(userId: string, n = 5): Topic[] {
    const firstPostLikes = (topic: Topic): number => firstPostOf(topic.id)?.likeUserIds.length ?? 0
    return topicsOfUser(userId)
      .sort((a, b) => firstPostLikes(b) - firstPostLikes(a) || replyCount(b.id) - replyCount(a.id) || b.createdAt - a.createdAt)
      .slice(0, n)
  }

  /** Who liked this user's posts the most. */
  function mostLikedByUsers(userId: string, n = 6): LikerSummary[] {
    const counts = new Map<string, number>()
    for (const post of livePostsOfUser(userId)) {
      for (const likerId of post.likeUserIds) {
        if (likerId !== userId)
          counts.set(likerId, (counts.get(likerId) ?? 0) + 1)
      }
    }
    const summaries: LikerSummary[] = []
    for (const [likerId, count] of counts) {
      const user = userById(likerId)
      if (user)
        summaries.push({ user, count })
    }
    return summaries
      .sort((a, b) => b.count - a.count || a.user.id.localeCompare(b.user.id))
      .slice(0, n)
  }

  /**
   * Newest first. Likes carry no timestamp of their own, so a like event is
   * dated by the post it landed on.
   */
  function activityOfUser(userId: string, n = 30): ActivityEvent[] {
    const events: ActivityEvent[] = []
    for (const topic of state.value.topics) {
      if (topic.authorId === userId)
        events.push({ kind: 'topic', at: topic.createdAt, topicId: topic.id, postId: firstPostOf(topic.id)?.id })
    }
    for (const post of state.value.posts) {
      if (post.deleted)
        continue
      if (post.authorId === userId && !isFirstPost(post.id))
        events.push({ kind: 'reply', at: post.createdAt, topicId: post.topicId, postId: post.id })
      if (post.likeUserIds.includes(userId))
        events.push({ kind: 'like', at: post.createdAt, topicId: post.topicId, postId: post.id })
    }
    for (const bookmark of state.value.bookmarks) {
      if (bookmark.userId !== userId)
        continue
      const post = postById(bookmark.postId)
      if (post)
        events.push({ kind: 'bookmark', at: bookmark.createdAt, topicId: post.topicId, postId: post.id })
    }
    return events.sort((a, b) => b.at - a.at).slice(0, n)
  }

  // ---------------------------------------------------------------- mutations

  function nextId(kind: 'topic' | 'post' | 'notification' | 'tag'): string {
    const counters = state.value.counters
    counters[kind] += 1
    const prefix = kind === 'topic' ? 't' : kind === 'post' ? 'p' : kind === 'tag' ? 'tag' : 'n'
    return `${prefix}${counters[kind]}`
  }

  function pushNotification(draft: Omit<Notification, 'id' | 'read'>): Notification {
    return pushReactive(state.value.notifications, { id: nextId('notification'), read: false, ...draft })
  }

  function hasNotification(recipientId: string, type: NotificationType, match: Partial<Pick<Notification, 'actorId' | 'postId'>>): boolean {
    return state.value.notifications.some(notification =>
      notification.recipientId === recipientId
      && notification.type === type
      && (match.actorId === undefined || notification.actorId === match.actorId)
      && (match.postId === undefined || notification.postId === match.postId))
  }

  /** `@username` mentions in a post, for everyone not already told about it. */
  function notifyMentions(post: Post): void {
    for (const handle of extractMentions(post.content)) {
      const mentioned = userByUsername(handle)
      if (!mentioned || mentioned.id === post.authorId || hasNotification(mentioned.id, 'reply', { postId: post.id }) || hasNotification(mentioned.id, 'mention', { postId: post.id }))
        continue
      pushNotification({ recipientId: mentioned.id, type: 'mention', actorId: post.authorId, topicId: post.topicId, postId: post.id, createdAt: post.createdAt })
    }
  }

  /**
   * Mints a tag from a display name, or hands back the one that already owns
   * its slug — so "Vue", "vue " and "vue" are all the seeded `vue` tag.
   *
   * The colour comes from the shared palette by counter position, because
   * nothing in this project may be random: the n-th tag anyone creates is
   * always the same colour.
   */
  function createTag(name: string): Tag | undefined {
    const label = name.trim()
    if (!label)
      return undefined

    // A name with no ASCII left (Chinese, say) has nothing to slug from, so the
    // counter supplies one and `/tag/<slug>` stays addressable.
    const slug = tagSlug(label) || `tag-${state.value.counters.tag + 1}`
    const existing = tagSlugMap.value.get(slug)
    if (existing)
      return existing

    const color = AVATAR_PALETTE[state.value.counters.tag % AVATAR_PALETTE.length] as string
    return pushReactive(state.value.tags, { id: nextId('tag'), slug, name: label, color })
  }

  /** Ids stay ids; anything else is a tag name, minted or reused once. */
  function resolveTagIds(entries: string[]): string[] {
    const ids: string[] = []
    for (const entry of entries) {
      const id = tagMap.value.has(entry) ? entry : createTag(entry)?.id
      if (id && !ids.includes(id))
        ids.push(id)
    }
    return ids
  }

  function createTopic(input: CreateTopicInput): Topic {
    const at = input.at ?? Date.now()
    const tagIds = resolveTagIds(input.tagIds)
    const id = nextId('topic')
    const topic = pushReactive(state.value.topics, {
      id,
      slug: topicSlug(state.value.counters.topic),
      title: input.title.trim(),
      categoryId: input.categoryId,
      tagIds,
      authorId: input.authorId,
      createdAt: at,
      lastActivityAt: at,
      views: 0,
      pinned: false,
      closed: false,
    })

    const post = pushReactive(state.value.posts, { id: nextId('post'), topicId: id, authorId: input.authorId, content: input.content, createdAt: at, likeUserIds: [] })
    notifyMentions(post)
    return topic
  }

  function createPost(input: CreatePostInput): Post {
    const topic = topicById(input.topicId)
    if (!topic)
      throw new Error(`createPost: unknown topic "${input.topicId}"`)

    const at = input.at ?? Date.now()
    const draft: Post = { id: nextId('post'), topicId: topic.id, authorId: input.authorId, content: input.content, createdAt: at, likeUserIds: [] }
    if (input.replyToPostId)
      draft.replyToPostId = input.replyToPostId
    const post = pushReactive(state.value.posts, draft)
    topic.lastActivityAt = Math.max(topic.lastActivityAt, at)

    // The topic author and the replied-to author each hear once, never about their own reply.
    const recipients = new Set<string>([topic.authorId])
    const target = input.replyToPostId ? postById(input.replyToPostId) : undefined
    if (target)
      recipients.add(target.authorId)
    for (const recipientId of recipients) {
      const recipient = userById(recipientId)
      if (recipientId === input.authorId || !recipient?.notifyPrefs.reply)
        continue
      pushNotification({ recipientId, type: 'reply', actorId: input.authorId, topicId: topic.id, postId: post.id, createdAt: at })
    }
    notifyMentions(post)
    return post
  }

  function editPost(postId: string, content: string, at = Date.now()): boolean {
    const post = postById(postId)
    if (!post || post.deleted)
      return false
    post.content = content
    post.editedAt = at
    return true
  }

  /** Soft delete. The first post carries the topic, so it stays. */
  function deletePost(postId: string): boolean {
    const post = postById(postId)
    if (!post || post.deleted || isFirstPost(postId))
      return false
    post.deleted = true
    post.content = ''
    return true
  }

  /** Returns the new liked state. A `like` notification goes out once per user and post, ever. */
  function toggleLike(postId: string, userId: string, at = Date.now()): boolean {
    const post = postById(postId)
    if (!post || post.deleted)
      return false
    const index = post.likeUserIds.indexOf(userId)
    if (index >= 0) {
      post.likeUserIds.splice(index, 1)
      return false
    }
    post.likeUserIds.push(userId)
    const author = userById(post.authorId)
    if (post.authorId !== userId && author?.notifyPrefs.like && !hasNotification(post.authorId, 'like', { actorId: userId, postId }))
      pushNotification({ recipientId: post.authorId, type: 'like', actorId: userId, topicId: post.topicId, postId, createdAt: at })
    return true
  }

  /** Returns the new bookmarked state. */
  function toggleBookmark(userId: string, postId: string, at = Date.now()): boolean {
    const index = state.value.bookmarks.findIndex(bookmark => bookmark.userId === userId && bookmark.postId === postId)
    if (index >= 0) {
      state.value.bookmarks.splice(index, 1)
      return false
    }
    if (!postById(postId))
      return false
    state.value.bookmarks.push({ userId, postId, createdAt: at })
    return true
  }

  /** Returns the new following state. Following notifies; unfollowing is silent. */
  function toggleFollow(followerId: string, followeeId: string, at = Date.now()): boolean {
    if (followerId === followeeId)
      return false
    const index = state.value.follows.findIndex(follow => follow.followerId === followerId && follow.followeeId === followeeId)
    if (index >= 0) {
      state.value.follows.splice(index, 1)
      return false
    }
    const followee = userById(followeeId)
    if (!followee)
      return false
    state.value.follows.push({ followerId, followeeId, createdAt: at })
    if (followee.notifyPrefs.follow)
      pushNotification({ recipientId: followeeId, type: 'follow', actorId: followerId, createdAt: at })
    return true
  }

  function setPinned(topicId: string, pinned: boolean): void {
    const topic = topicById(topicId)
    if (topic)
      topic.pinned = pinned
  }

  function setClosed(topicId: string, closed: boolean): void {
    const topic = topicById(topicId)
    if (topic)
      topic.closed = closed
  }

  function incrementViews(topicId: string): void {
    const topic = topicById(topicId)
    if (topic)
      topic.views += 1
  }

  function markRead(notificationId: string): void {
    const notification = state.value.notifications.find(candidate => candidate.id === notificationId)
    if (notification)
      notification.read = true
  }

  function markAllRead(userId: string): void {
    for (const notification of state.value.notifications) {
      if (notification.recipientId === userId)
        notification.read = true
    }
  }

  function updateProfile(userId: string, patch: ProfilePatch): boolean {
    const user = userById(userId)
    if (!user)
      return false
    if (patch.displayName !== undefined)
      user.displayName = patch.displayName
    if (patch.bio !== undefined)
      user.bio = patch.bio
    if (patch.location !== undefined)
      user.location = patch.location
    if (patch.website !== undefined)
      user.website = patch.website
    if (patch.avatarColor !== undefined)
      user.avatarColor = patch.avatarColor
    if (patch.notifyPrefs !== undefined)
      user.notifyPrefs = { ...user.notifyPrefs, ...patch.notifyPrefs }
    return true
  }

  function replaceState(next: ForumState): void {
    state.value = next
  }

  /** Back to the sample data. Persistence follows through the store subscription. */
  function reset(now?: number): void {
    state.value = createSeed(now)
  }

  return {
    state,
    // lookups
    topicById,
    postById,
    postsOfTopic,
    firstPostOf,
    isFirstPost,
    userById,
    userByUsername,
    categoryById,
    categoryBySlug,
    tagById,
    tagBySlug,
    // topic-level
    replyCount,
    likeCountOfTopic,
    participants,
    topicCountOfCategory,
    topicCountOfTag,
    tagsByPopularity,
    sortedTopics,
    recentTopicsOfCategory,
    suggestedTopics,
    searchAll,
    // notifications / bookmarks / follows
    notificationsOf,
    unreadCount,
    bookmarksOf,
    isBookmarked,
    isFollowing,
    // per-user
    topicsOfUser,
    repliesOfUser,
    statsOfUser,
    topLikedPostsOfUser,
    topTopicsOfUser,
    mostLikedByUsers,
    activityOfUser,
    // mutations
    createTag,
    createTopic,
    createPost,
    editPost,
    deletePost,
    toggleLike,
    toggleBookmark,
    toggleFollow,
    setPinned,
    setClosed,
    incrementViews,
    markRead,
    markAllRead,
    updateProfile,
    replaceState,
    reset,
  }
})
