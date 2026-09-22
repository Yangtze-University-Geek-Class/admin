import type { ForumState, Post } from '~/data/types'
import { describe, expect, it } from 'vitest'
import { extractMentions } from '~/data/mentions'
import { CATEGORY_SEEDS, REPLY_SNIPPETS, TOPIC_SEEDS, USER_SEEDS } from '~/data/seed-content'
import { createSeed, DEFAULT_SESSION, excerpt, SEED_VALUE } from '~/data/seed'
import { FORUM_STATE_VERSION } from '~/data/types'

const NOW = 1_780_000_000_000

function firstPostIds(state: ForumState): Set<string> {
  const ids = new Set<string>()
  for (const topic of state.topics) {
    const first = state.posts.find(post => post.topicId === topic.id)
    if (first)
      ids.add(first.id)
  }
  return ids
}

describe('createSeed', () => {
  const state = createSeed(NOW)

  it('is deterministic for the same `now`', () => {
    expect(createSeed(NOW)).toEqual(state)
    expect(createSeed(NOW)).toStrictEqual(createSeed(NOW))
  })

  it('only shifts timestamps when `now` changes', () => {
    const shifted = createSeed(NOW + 12_345_678)
    const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value), (key, inner) =>
      ['createdAt', 'editedAt', 'lastActivityAt', 'joinedAt', 'seededAt'].includes(key) ? undefined : inner)
    expect(strip(shifted)).toEqual(strip(state))
    expect(shifted.seededAt).toBe(NOW + 12_345_678)
  })

  it('does not depend on the wall clock when `now` is given', () => {
    // A seed that read Date.now() anywhere would differ between two calls made later.
    const again = createSeed(NOW)
    expect(again.posts.map(post => post.createdAt)).toEqual(state.posts.map(post => post.createdAt))
  })

  it('carries the current version, `now`, and counters equal to the array lengths', () => {
    expect(state.version).toBe(FORUM_STATE_VERSION)
    expect(state.seededAt).toBe(NOW)
    expect(state.counters).toEqual({
      topic: state.topics.length,
      post: state.posts.length,
      notification: state.notifications.length,
      tag: state.tags.length,
    })
  })

  it('has the required scale', () => {
    expect(state.users).toHaveLength(12)
    expect(state.categories).toHaveLength(8)
    expect(state.tags).toHaveLength(16)
    expect(state.topics.length).toBeGreaterThanOrEqual(45)
    expect(state.posts.length).toBeGreaterThanOrEqual(200)
    expect(state.posts.length).toBeLessThanOrEqual(260)
    expect(state.notifications.length).toBeGreaterThanOrEqual(25)
    expect(state.notifications.length).toBeLessThanOrEqual(40)
    expect(state.bookmarks.length).toBeGreaterThanOrEqual(8)
    expect(state.follows.length).toBeGreaterThanOrEqual(12)
  })

  it('has one admin, one moderator and unique ascii usernames', () => {
    expect(state.users.filter(user => user.role === 'admin').map(user => user.username)).toEqual(['talex'])
    expect(state.users.filter(user => user.role === 'moderator')).toHaveLength(1)
    const usernames = state.users.map(user => user.username)
    expect(new Set(usernames).size).toBe(usernames.length)
    for (const username of usernames)
      expect(username).toMatch(/^[a-z0-9_-]+$/)
    expect(DEFAULT_SESSION.currentUserId).toBe(state.users.find(user => user.role === 'admin')?.id)
  })

  it('uses only real Carbon icons and unique slugs for categories and tags', () => {
    for (const category of CATEGORY_SEEDS)
      expect(category.icon).toMatch(/^i-carbon-[a-z0-9-]+$/)
    expect(new Set(state.categories.map(category => category.slug)).size).toBe(state.categories.length)
    expect(new Set(state.tags.map(tag => tag.slug)).size).toBe(state.tags.length)
  })

  it('gives every topic a valid author, category, tags, distinct title and derived slug', () => {
    const userIds = new Set(state.users.map(user => user.id))
    const categoryIds = new Set(state.categories.map(category => category.id))
    const tagIds = new Set(state.tags.map(tag => tag.id))
    expect(new Set(state.topics.map(topic => topic.title)).size).toBe(state.topics.length)
    for (const topic of state.topics) {
      expect(userIds.has(topic.authorId)).toBe(true)
      expect(categoryIds.has(topic.categoryId)).toBe(true)
      for (const tagId of topic.tagIds)
        expect(tagIds.has(tagId)).toBe(true)
      expect(topic.slug).toBe(`topic-${topic.id.slice(1)}`)
      expect(topic.views).toBeGreaterThanOrEqual(20)
      expect(topic.views).toBeLessThanOrEqual(4000)
    }
    expect(state.topics.filter(topic => topic.pinned)).toHaveLength(2)
    expect(state.topics.filter(topic => topic.closed)).toHaveLength(3)
  })

  it('gives every post an existing topic and author, and the first post the topic author', () => {
    const userIds = new Set(state.users.map(user => user.id))
    const topicById = new Map(state.topics.map(topic => [topic.id, topic]))
    for (const post of state.posts) {
      expect(userIds.has(post.authorId)).toBe(true)
      expect(topicById.has(post.topicId)).toBe(true)
      expect(post.likeUserIds).not.toContain(post.authorId)
      expect(new Set(post.likeUserIds).size).toBe(post.likeUserIds.length)
    }
    for (const topic of state.topics) {
      const first = state.posts.find(post => post.topicId === topic.id) as Post
      expect(first.authorId).toBe(topic.authorId)
      expect(first.createdAt).toBe(topic.createdAt)
      expect(first.content.length).toBeGreaterThan(40)
    }
  })

  it('keeps post times strictly increasing within a topic and before `now`', () => {
    const lastByTopic = new Map<string, number>()
    for (const post of state.posts) {
      const previous = lastByTopic.get(post.topicId)
      if (previous !== undefined)
        expect(post.createdAt).toBeGreaterThan(previous)
      lastByTopic.set(post.topicId, post.createdAt)
      expect(post.createdAt).toBeLessThan(NOW)
      if (post.editedAt !== undefined) {
        expect(post.editedAt).toBeGreaterThan(post.createdAt)
        expect(post.editedAt).toBeLessThan(NOW)
      }
    }
    for (const topic of state.topics)
      expect(topic.lastActivityAt).toBe(lastByTopic.get(topic.id))
  })

  it('never lets anyone post, like or follow before joining', () => {
    const joinedAt = new Map(state.users.map(user => [user.id, user.joinedAt]))
    for (const post of state.posts) {
      expect(post.createdAt).toBeGreaterThan(joinedAt.get(post.authorId) as number)
      for (const likerId of post.likeUserIds)
        expect(post.createdAt).toBeGreaterThan(joinedAt.get(likerId) as number)
    }
    for (const follow of state.follows) {
      expect(follow.createdAt).toBeGreaterThan(joinedAt.get(follow.followerId) as number)
      expect(follow.createdAt).toBeGreaterThan(joinedAt.get(follow.followeeId) as number)
    }
  })

  it('points reply-to links at earlier posts of the same topic', () => {
    const postById = new Map(state.posts.map(post => [post.id, post]))
    const withTarget = state.posts.filter(post => post.replyToPostId)
    expect(withTarget.length).toBeGreaterThan(10)
    for (const post of withTarget) {
      const target = postById.get(post.replyToPostId as string) as Post
      expect(target.topicId).toBe(post.topicId)
      expect(target.createdAt).toBeLessThan(post.createdAt)
    }
  })

  it('renders every snippet placeholder and mentions only real users', () => {
    const usernames = new Set(state.users.map(user => user.username))
    const firsts = firstPostIds(state)
    let mentions = 0
    for (const post of state.posts) {
      expect(post.content).not.toMatch(/\{(?:mention|quote)\}/)
      if (firsts.has(post.id))
        continue
      for (const handle of extractMentions(post.content)) {
        expect(usernames.has(handle), `${post.id}: @${handle}`).toBe(true)
        mentions++
      }
    }
    expect(mentions).toBeGreaterThan(10)
    expect(REPLY_SNIPPETS.length).toBeGreaterThanOrEqual(40)
    expect(TOPIC_SEEDS.length).toBe(state.topics.length)
    expect(USER_SEEDS.length).toBe(state.users.length)
  })

  it('produces consistent notifications, bookmarks and follows', () => {
    const userIds = new Set(state.users.map(user => user.id))
    const postById = new Map(state.posts.map(post => [post.id, post]))
    const topicIds = new Set(state.topics.map(topic => topic.id))

    const types = new Set(state.notifications.map(notification => notification.type))
    expect([...types].sort()).toEqual(['follow', 'like', 'mention', 'reply', 'system'])
    expect(state.notifications.some(notification => notification.read)).toBe(true)
    expect(state.notifications.some(notification => !notification.read)).toBe(true)
    expect(new Set(state.notifications.map(notification => notification.id)).size).toBe(state.notifications.length)
    for (const notification of state.notifications) {
      expect(userIds.has(notification.recipientId)).toBe(true)
      expect(userIds.has(notification.actorId)).toBe(true)
      expect(notification.createdAt).toBeLessThan(NOW)
      if (notification.type !== 'system')
        expect(notification.actorId).not.toBe(notification.recipientId)
      if (notification.postId) {
        const post = postById.get(notification.postId) as Post
        expect(post.topicId).toBe(notification.topicId)
        if (notification.type === 'reply' || notification.type === 'mention')
          expect(post.authorId).toBe(notification.actorId)
        if (notification.type === 'like')
          expect(post.likeUserIds).toContain(notification.actorId)
      }
      if (notification.topicId)
        expect(topicIds.has(notification.topicId)).toBe(true)
    }
    // A mention never duplicates a reply notification for the same person and post.
    const pairs = state.notifications
      .filter(notification => notification.type === 'reply' || notification.type === 'mention')
      .map(notification => `${notification.recipientId}:${notification.postId}`)
    expect(new Set(pairs).size).toBe(pairs.length)

    const bookmarkPairs = state.bookmarks.map(bookmark => `${bookmark.userId}:${bookmark.postId}`)
    expect(new Set(bookmarkPairs).size).toBe(bookmarkPairs.length)
    for (const bookmark of state.bookmarks) {
      const post = postById.get(bookmark.postId) as Post
      expect(post.authorId).not.toBe(bookmark.userId)
      expect(bookmark.createdAt).toBeGreaterThanOrEqual(post.createdAt)
    }

    const followPairs = state.follows.map(follow => `${follow.followerId}:${follow.followeeId}`)
    expect(new Set(followPairs).size).toBe(followPairs.length)
    for (const follow of state.follows)
      expect(follow.followerId).not.toBe(follow.followeeId)
  })

  it('serialises to JSON without loss', () => {
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it('exposes a fixed seed value', () => {
    expect(SEED_VALUE).toBe(0x54554646)
  })
})

describe('excerpt', () => {
  it('skips headings, lists, quotes and fences, and strips inline markup', () => {
    expect(excerpt('## 标题\n\n- 列表\n\n> 引用\n\n这是 **正文** 的 `第一行`。')).toBe('这是 正文 的 第一行。')
  })

  it('truncates long lines with an ellipsis', () => {
    const long = 'x'.repeat(80)
    expect(excerpt(long, 10)).toBe(`${'x'.repeat(10)}…`)
  })

  it('falls back to the raw text when every line is structural', () => {
    expect(excerpt('# only a heading')).toBe('# only a heading')
  })
})
