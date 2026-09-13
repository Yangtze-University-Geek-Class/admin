import type { Post, Topic, User } from '~/data/types'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { createSeed } from '~/data/seed'
import { AVATAR_PALETTE } from '~/data/seed-content'
import { useForumStore } from '~/stores/forum'
import { useSessionStore } from '~/stores/session'

const NOW = 1_780_000_000_000
const LATER = NOW + 60_000

function setup(): ReturnType<typeof useForumStore> {
  setActivePinia(createPinia())
  const forum = useForumStore()
  forum.reset(NOW)
  return forum
}

/** A member who is not the author of `topic` and (if given) not the author of `post`. */
function someoneElse(forum: ReturnType<typeof useForumStore>, ...excluded: string[]): User {
  const user = forum.state.users.find(candidate => candidate.role === 'member' && !excluded.includes(candidate.id))
  if (!user)
    throw new Error('no other member')
  return user
}

function openTopic(forum: ReturnType<typeof useForumStore>): Topic {
  const topic = forum.state.topics.find(candidate => !candidate.closed && !candidate.pinned)
  if (!topic)
    throw new Error('no open topic')
  return topic
}

describe('useForumStore', () => {
  let forum: ReturnType<typeof useForumStore>

  beforeEach(() => {
    forum = setup()
  })

  describe('seeding and reset', () => {
    it('starts from the seed and resets to it', () => {
      expect(forum.state).toEqual(createSeed(NOW))
      forum.createTopic({ title: '临时话题标题', categoryId: 'c1', tagIds: [], content: '正文内容足够长了吧', authorId: 'u1', at: LATER })
      expect(forum.state.topics).toHaveLength(createSeed(NOW).topics.length + 1)
      forum.reset(NOW)
      expect(forum.state).toEqual(createSeed(NOW))
    })

    it('replaceState swaps the whole state', () => {
      const other = createSeed(NOW + 1)
      forum.replaceState(other)
      expect(forum.state.seededAt).toBe(NOW + 1)
      expect(forum.state).toEqual(other)
      expect(forum.topicById('t1')?.createdAt).toBe(other.topics[0]?.createdAt)
    })
  })

  describe('lookups', () => {
    it('resolves entities by id and slug, case-insensitively for usernames', () => {
      expect(forum.topicById('t1')?.id).toBe('t1')
      expect(forum.topicById('nope')).toBeUndefined()
      expect(forum.userById('u1')?.username).toBe('talex')
      expect(forum.userByUsername('TALEX')?.id).toBe('u1')
      expect(forum.userByUsername('ghost')).toBeUndefined()
      expect(forum.categoryBySlug('help')?.id).toBe(forum.categoryById('c2')?.id)
      expect(forum.tagBySlug('vue')?.id).toBe('tag1')
      expect(forum.tagById('tag1')?.slug).toBe('vue')
    })

    it('orders a topic\'s posts chronologically with the first post first', () => {
      for (const topic of forum.state.topics) {
        const posts = forum.postsOfTopic(topic.id)
        expect(posts[0]).toBe(forum.firstPostOf(topic.id))
        expect(forum.isFirstPost(posts[0]!.id)).toBe(true)
        for (let i = 1; i < posts.length; i++) {
          expect(posts[i]!.createdAt).toBeGreaterThan(posts[i - 1]!.createdAt)
          expect(forum.isFirstPost(posts[i]!.id)).toBe(false)
        }
      }
      expect(forum.postsOfTopic('nope')).toEqual([])
    })

    it('counts replies, likes and participants per topic', () => {
      const topic = openTopic(forum)
      const posts = forum.postsOfTopic(topic.id)
      expect(forum.replyCount(topic.id)).toBe(posts.length - 1)
      expect(forum.likeCountOfTopic(topic.id)).toBe(posts.reduce((sum, post) => sum + post.likeUserIds.length, 0))
      const participants = forum.participants(topic.id)
      expect(participants[0]?.id).toBe(topic.authorId)
      expect(new Set(participants.map(user => user.id)).size).toBe(participants.length)
      expect(participants.map(user => user.id).sort()).toEqual([...new Set(posts.map(post => post.authorId))].sort())
    })

    it('counts topics per category and tag', () => {
      const category = forum.state.categories[0]!
      expect(forum.topicCountOfCategory(category.id)).toBe(forum.state.topics.filter(topic => topic.categoryId === category.id).length)
      const tag = forum.state.tags[0]!
      expect(forum.topicCountOfTag(tag.id)).toBe(forum.state.topics.filter(topic => topic.tagIds.includes(tag.id)).length)
    })

    it('ranks tags busiest first, ties by name, and limits without reordering', () => {
      const ranked = forum.tagsByPopularity()
      expect(ranked).toHaveLength(forum.state.tags.length)
      for (const { tag, count } of ranked)
        expect(count).toBe(forum.topicCountOfTag(tag.id))
      for (let i = 1; i < ranked.length; i++) {
        const previous = ranked[i - 1]!
        const current = ranked[i]!
        expect(previous.count).toBeGreaterThanOrEqual(current.count)
        if (previous.count === current.count)
          expect(previous.tag.name.localeCompare(current.tag.name, 'zh-Hans-CN')).toBeLessThan(0)
      }
      // The sidebar takes the head of this list; it has to be the same head.
      expect(forum.tagsByPopularity(8).map(entry => entry.tag.id)).toEqual(ranked.slice(0, 8).map(entry => entry.tag.id))
      expect(forum.state.tags.map(tag => tag.id)).not.toEqual(ranked.map(entry => entry.tag.id))
    })
  })

  describe('createTopic', () => {
    it('appends a topic with its first post and advances the counters', () => {
      const { topic: topicCounter, post: postCounter } = forum.state.counters
      const topic = forum.createTopic({ title: '  新话题标题  ', categoryId: 'c2', tagIds: ['tag1', 'tag2'], content: '这是正文，包含 @mika 的提及。', authorId: 'u3', at: LATER })

      expect(topic.id).toBe(`t${topicCounter + 1}`)
      expect(topic.slug).toBe(`topic-${topicCounter + 1}`)
      expect(topic.title).toBe('新话题标题')
      expect(topic).toMatchObject({ categoryId: 'c2', tagIds: ['tag1', 'tag2'], authorId: 'u3', createdAt: LATER, lastActivityAt: LATER, views: 0, pinned: false, closed: false })
      expect(forum.state.counters.topic).toBe(topicCounter + 1)
      expect(forum.state.counters.post).toBe(postCounter + 1)
      expect(forum.state.topics.at(-1)).toBe(topic)

      const first = forum.firstPostOf(topic.id)!
      expect(first.id).toBe(`p${postCounter + 1}`)
      expect(first.authorId).toBe('u3')
      expect(forum.replyCount(topic.id)).toBe(0)
      expect(forum.sortedTopics({ mode: 'new' }).filter(candidate => !candidate.pinned)[0]).toBe(topic)
    })

    it('notifies mentioned users in the first post, but not the author', () => {
      const before = forum.state.notifications.length
      forum.createTopic({ title: '提及测试话题', categoryId: 'c2', tagIds: [], content: '@mika @talex @ghost 看一下', authorId: 'u1', at: LATER })
      const added = forum.state.notifications.slice(before)
      expect(added.map(notification => [notification.type, notification.recipientId])).toEqual([['mention', 'u2']])
    })
  })

  describe('createTag', () => {
    it('mints one tag from a name and resumes the counter', () => {
      const before = forum.state.tags.length
      const counter = forum.state.counters.tag
      expect(counter).toBe(before)

      const tag = forum.createTag('Web Components')!
      expect(tag.id).toBe(`tag${counter + 1}`)
      expect(tag.slug).toBe('web-components')
      expect(tag.name).toBe('Web Components')
      expect(forum.state.tags).toHaveLength(before + 1)
      expect(forum.state.counters.tag).toBe(counter + 1)
      expect(forum.tagById(tag.id)).toBe(tag)
      expect(forum.tagBySlug('web-components')).toBe(tag)
    })

    it('picks its colour from the palette by counter position, never at random', () => {
      const first = forum.createTag('alpha')!
      const second = forum.createTag('beta')!
      const counter = createSeed(NOW).counters.tag
      expect(first.color).toBe(AVATAR_PALETTE[counter % AVATAR_PALETTE.length])
      expect(second.color).toBe(AVATAR_PALETTE[(counter + 1) % AVATAR_PALETTE.length])

      // A second forum built from the same seed mints the same colours.
      const other = setup()
      expect(other.createTag('完全不同的名字')!.color).toBe(first.color)
    })

    it('reuses the tag that already owns the slug, whatever the casing', () => {
      const tags = forum.state.tags.length
      const seeded = forum.tagBySlug('vue')!
      expect(forum.createTag('Vue')).toBe(seeded)
      expect(forum.createTag('  vue  ')).toBe(seeded)
      expect(forum.state.tags).toHaveLength(tags)
      expect(forum.state.counters.tag).toBe(tags)
    })

    it('falls back to a counter slug when the name has no ASCII to slug', () => {
      const counter = forum.state.counters.tag
      const tag = forum.createTag('中文标签')!
      expect(tag.slug).toBe(`tag-${counter + 1}`)
      expect(tag.name).toBe('中文标签')
      expect(forum.tagBySlug(tag.slug)).toBe(tag)

      // A different Chinese name gets its own slug rather than colliding.
      const other = forum.createTag('另一个标签')!
      expect(other.slug).toBe(`tag-${counter + 2}`)
      expect(other.id).not.toBe(tag.id)
    })

    it('ignores a blank name', () => {
      const tags = forum.state.tags.length
      expect(forum.createTag('   ')).toBeUndefined()
      expect(forum.state.tags).toHaveLength(tags)
    })
  })

  describe('createTopic with new tag names', () => {
    it('mints exactly one tag for a brand-new name and resolves every id', () => {
      const tags = forum.state.tags.length
      const topic = forum.createTopic({ title: '带新标签的话题', categoryId: 'c2', tagIds: ['tag1', 'Rolldown'], content: '正文内容足够长了吧', authorId: 'u1', at: LATER })

      expect(forum.state.tags).toHaveLength(tags + 1)
      expect(topic.tagIds).toHaveLength(2)
      expect(topic.tagIds.map(id => forum.tagById(id)?.name)).toEqual(['vue', 'Rolldown'])
      expect(topic.tagIds.every(id => forum.tagById(id) !== undefined)).toBe(true)
      expect(forum.topicCountOfTag(topic.tagIds[1]!)).toBe(1)
      expect(forum.sortedTopics({ mode: 'latest', tagId: topic.tagIds[1] })).toEqual([topic])
    })

    it('reuses the tag when a second topic repeats the name', () => {
      const tags = forum.state.tags.length
      const first = forum.createTopic({ title: '第一个新标签话题', categoryId: 'c2', tagIds: ['Rolldown'], content: '正文内容足够长了吧', authorId: 'u1', at: LATER })
      const second = forum.createTopic({ title: '第二个新标签话题', categoryId: 'c2', tagIds: ['rolldown'], content: '正文内容足够长了吧', authorId: 'u3', at: LATER + 1 })

      expect(forum.state.tags).toHaveLength(tags + 1)
      expect(second.tagIds).toEqual(first.tagIds)
      expect(forum.topicCountOfTag(first.tagIds[0]!)).toBe(2)
    })

    it('drops duplicates that resolve to the same tag', () => {
      const tags = forum.state.tags.length
      const topic = forum.createTopic({ title: '重复标签的话题', categoryId: 'c2', tagIds: ['tag1', 'Vue', 'vue'], content: '正文内容足够长了吧', authorId: 'u1', at: LATER })
      expect(forum.state.tags).toHaveLength(tags)
      expect(topic.tagIds).toEqual(['tag1'])
    })
  })

  describe('createPost', () => {
    it('adds a reply, bumps the reply count and the topic activity', () => {
      const topic = openTopic(forum)
      const replier = someoneElse(forum, topic.authorId)
      const replies = forum.replyCount(topic.id)
      const postCounter = forum.state.counters.post

      const post = forum.createPost({ topicId: topic.id, authorId: replier.id, content: '一条回复', at: LATER })

      expect(post.id).toBe(`p${postCounter + 1}`)
      expect(forum.replyCount(topic.id)).toBe(replies + 1)
      expect(forum.topicById(topic.id)?.lastActivityAt).toBe(LATER)
      expect(forum.postsOfTopic(topic.id).at(-1)).toBe(post)
      expect(forum.sortedTopics({ mode: 'latest' }).filter(candidate => !candidate.pinned)[0]?.id).toBe(topic.id)
    })

    it('notifies the topic author, not the replier', () => {
      const topic = openTopic(forum)
      const replier = someoneElse(forum, topic.authorId)
      const before = forum.state.notifications.length

      const post = forum.createPost({ topicId: topic.id, authorId: replier.id, content: '回复', at: LATER })

      const added = forum.state.notifications.slice(before)
      expect(added).toHaveLength(1)
      expect(added[0]).toMatchObject({ type: 'reply', recipientId: topic.authorId, actorId: replier.id, topicId: topic.id, postId: post.id, read: false, createdAt: LATER })
      expect(forum.unreadCount(topic.authorId)).toBeGreaterThan(0)
    })

    it('sends no reply notification when replying to your own topic', () => {
      const topic = openTopic(forum)
      const before = forum.state.notifications.length
      forum.createPost({ topicId: topic.id, authorId: topic.authorId, content: '自己补充一下', at: LATER })
      expect(forum.state.notifications).toHaveLength(before)
    })

    it('notifies the replied-to author too, once each, never self', () => {
      const topic = openTopic(forum)
      const target = someoneElse(forum, topic.authorId)
      const targetPost = forum.createPost({ topicId: topic.id, authorId: target.id, content: '先说一句', at: LATER })
      const replier = someoneElse(forum, topic.authorId, target.id)
      const before = forum.state.notifications.length

      forum.createPost({ topicId: topic.id, authorId: replier.id, content: '回你', replyToPostId: targetPost.id, at: LATER + 1 })

      const recipients = forum.state.notifications.slice(before).map(notification => notification.recipientId).sort()
      expect(recipients).toEqual([topic.authorId, target.id].sort())

      // Replying to your own post inside someone else's topic: only the topic author hears.
      const ownReply = forum.createPost({ topicId: topic.id, authorId: target.id, content: '再补一句', replyToPostId: targetPost.id, at: LATER + 2 })
      const again = forum.state.notifications.filter(notification => notification.postId === ownReply.id)
      expect(again.map(notification => notification.recipientId)).toEqual([topic.authorId])
    })

    it('notifies mentioned users, without duplicating the reply notification', () => {
      const topic = openTopic(forum)
      const author = forum.userById(topic.authorId)!
      const mentioned = someoneElse(forum, topic.authorId)
      const replier = someoneElse(forum, topic.authorId, mentioned.id)
      const before = forum.state.notifications.length

      const post = forum.createPost({ topicId: topic.id, authorId: replier.id, content: `@${author.username} @${mentioned.username} @${replier.username} @${mentioned.username.toUpperCase()}`, at: LATER })

      const added = forum.state.notifications.slice(before)
      expect(added.map(notification => `${notification.type}:${notification.recipientId}`).sort()).toEqual([`mention:${mentioned.id}`, `reply:${author.id}`].sort())
      expect(added.every(notification => notification.postId === post.id)).toBe(true)
    })

    it('respects the recipient\'s notification preferences', () => {
      const topic = openTopic(forum)
      forum.updateProfile(topic.authorId, { notifyPrefs: { reply: false, like: true, follow: true } })
      const before = forum.state.notifications.length
      forum.createPost({ topicId: topic.id, authorId: someoneElse(forum, topic.authorId).id, content: '静音回复', at: LATER })
      expect(forum.state.notifications).toHaveLength(before)
    })

    it('throws for an unknown topic', () => {
      expect(() => forum.createPost({ topicId: 'nope', authorId: 'u1', content: 'x' })).toThrow(/unknown topic/)
    })
  })

  describe('editPost / deletePost', () => {
    it('edits content and stamps editedAt', () => {
      const topic = openTopic(forum)
      const post = forum.firstPostOf(topic.id)!
      expect(forum.editPost(post.id, '改过的正文', LATER)).toBe(true)
      expect(post.content).toBe('改过的正文')
      expect(post.editedAt).toBe(LATER)
      expect(forum.editPost('nope', 'x')).toBe(false)
    })

    it('soft-deletes a reply and refuses the first post', () => {
      const topic = openTopic(forum)
      const replier = someoneElse(forum, topic.authorId)
      const reply = forum.createPost({ topicId: topic.id, authorId: replier.id, content: '将被删除', at: LATER })
      const replies = forum.replyCount(topic.id)
      const total = forum.state.posts.length

      expect(forum.deletePost(reply.id)).toBe(true)
      expect(reply).toMatchObject({ deleted: true, content: '' })
      expect(forum.state.posts).toHaveLength(total)
      expect(forum.replyCount(topic.id)).toBe(replies - 1)
      expect(forum.postsOfTopic(topic.id)).toContain(reply)
      expect(forum.deletePost(reply.id)).toBe(false)
      expect(forum.editPost(reply.id, 'x')).toBe(false)

      const first = forum.firstPostOf(topic.id)!
      expect(forum.deletePost(first.id)).toBe(false)
      expect(first.deleted).toBeUndefined()
      expect(first.content).not.toBe('')
      expect(forum.deletePost('nope')).toBe(false)
    })

    it('excludes deleted posts from search, stats and likes', () => {
      const topic = openTopic(forum)
      const replier = someoneElse(forum, topic.authorId)
      const reply = forum.createPost({ topicId: topic.id, authorId: replier.id, content: 'zzzUniqueNeedle', at: LATER })
      expect(forum.searchAll('zzzuniqueneedle').posts).toEqual([reply])
      const before = forum.statsOfUser(replier.id)
      forum.deletePost(reply.id)
      expect(forum.searchAll('zzzuniqueneedle').posts).toEqual([])
      expect(forum.statsOfUser(replier.id).replies).toBe(before.replies - 1)
      expect(forum.toggleLike(reply.id, topic.authorId)).toBe(false)
    })
  })

  describe('toggleLike', () => {
    it('toggles and returns to the original state after two calls', () => {
      const topic = openTopic(forum)
      const post = forum.firstPostOf(topic.id)!
      const liker = someoneElse(forum, topic.authorId)
      post.likeUserIds = post.likeUserIds.filter(id => id !== liker.id)
      const original = [...post.likeUserIds]

      expect(forum.toggleLike(post.id, liker.id, LATER)).toBe(true)
      expect(post.likeUserIds).toContain(liker.id)
      expect(forum.toggleLike(post.id, liker.id, LATER)).toBe(false)
      expect(post.likeUserIds).toEqual(original)
      expect(forum.toggleLike('nope', liker.id)).toBe(false)
    })

    it('sends exactly one like notification per user and post, ever', () => {
      const topic = openTopic(forum)
      const post = forum.firstPostOf(topic.id)!
      const liker = someoneElse(forum, topic.authorId)
      post.likeUserIds = post.likeUserIds.filter(id => id !== liker.id)
      forum.state.notifications = forum.state.notifications.filter(notification => !(notification.type === 'like' && notification.postId === post.id && notification.actorId === liker.id))

      const count = (): number => forum.state.notifications.filter(notification => notification.type === 'like' && notification.postId === post.id && notification.actorId === liker.id).length
      forum.toggleLike(post.id, liker.id, LATER)
      expect(count()).toBe(1)
      expect(forum.state.notifications.at(-1)).toMatchObject({ type: 'like', recipientId: topic.authorId, actorId: liker.id, topicId: topic.id, postId: post.id, createdAt: LATER })
      forum.toggleLike(post.id, liker.id, LATER)
      forum.toggleLike(post.id, liker.id, LATER)
      expect(count()).toBe(1)
    })

    it('does not notify yourself', () => {
      const topic = openTopic(forum)
      const post = forum.firstPostOf(topic.id)!
      const before = forum.state.notifications.length
      forum.toggleLike(post.id, topic.authorId, LATER)
      expect(forum.state.notifications).toHaveLength(before)
      expect(post.likeUserIds).toContain(topic.authorId)
    })
  })

  describe('toggleBookmark', () => {
    it('round-trips and joins the post and topic in bookmarksOf', () => {
      const topic = openTopic(forum)
      const post = forum.firstPostOf(topic.id)!
      const user = someoneElse(forum, topic.authorId)
      forum.state.bookmarks = forum.state.bookmarks.filter(bookmark => !(bookmark.userId === user.id && bookmark.postId === post.id))
      const before = forum.bookmarksOf(user.id).length

      expect(forum.toggleBookmark(user.id, post.id, LATER)).toBe(true)
      expect(forum.isBookmarked(user.id, post.id)).toBe(true)
      const entries = forum.bookmarksOf(user.id)
      expect(entries).toHaveLength(before + 1)
      expect(entries[0]).toMatchObject({ bookmark: { userId: user.id, postId: post.id, createdAt: LATER }, post, topic })

      expect(forum.toggleBookmark(user.id, post.id, LATER)).toBe(false)
      expect(forum.isBookmarked(user.id, post.id)).toBe(false)
      expect(forum.bookmarksOf(user.id)).toHaveLength(before)
      expect(forum.toggleBookmark(user.id, 'nope')).toBe(false)
    })
  })

  describe('toggleFollow', () => {
    it('round-trips, changes both users\' stats and notifies only on follow', () => {
      const [a, b] = forum.state.users.filter(user => user.role === 'member') as [User, User]
      forum.state.follows = forum.state.follows.filter(follow => !(follow.followerId === a.id && follow.followeeId === b.id))
      const followers = forum.statsOfUser(b.id).followers
      const following = forum.statsOfUser(a.id).following
      const before = forum.state.notifications.length

      expect(forum.toggleFollow(a.id, b.id, LATER)).toBe(true)
      expect(forum.isFollowing(a.id, b.id)).toBe(true)
      expect(forum.statsOfUser(b.id).followers).toBe(followers + 1)
      expect(forum.statsOfUser(a.id).following).toBe(following + 1)
      expect(forum.state.notifications.slice(before)).toEqual([expect.objectContaining({ type: 'follow', recipientId: b.id, actorId: a.id, createdAt: LATER, read: false })])

      expect(forum.toggleFollow(a.id, b.id, LATER)).toBe(false)
      expect(forum.isFollowing(a.id, b.id)).toBe(false)
      expect(forum.statsOfUser(b.id).followers).toBe(followers)
      expect(forum.state.notifications).toHaveLength(before + 1)
    })

    it('refuses self-follow and unknown users', () => {
      expect(forum.toggleFollow('u1', 'u1')).toBe(false)
      expect(forum.toggleFollow('u1', 'nope')).toBe(false)
    })
  })

  describe('topic flags, views, notifications, profile', () => {
    it('pins, closes and counts views', () => {
      const topic = openTopic(forum)
      const views = topic.views
      forum.setPinned(topic.id, true)
      forum.setClosed(topic.id, true)
      forum.incrementViews(topic.id)
      expect(topic).toMatchObject({ pinned: true, closed: true, views: views + 1 })
      forum.setPinned(topic.id, false)
      forum.setClosed(topic.id, false)
      expect(topic).toMatchObject({ pinned: false, closed: false })
      expect(() => forum.incrementViews('nope')).not.toThrow()
    })

    it('marks one and all notifications read, newest first in notificationsOf', () => {
      const userId = 'u1'
      const list = forum.notificationsOf(userId)
      expect(list.length).toBeGreaterThan(1)
      for (let i = 1; i < list.length; i++)
        expect(list[i]!.createdAt).toBeLessThanOrEqual(list[i - 1]!.createdAt)
      const unread = list.find(notification => !notification.read)!
      const unreadBefore = forum.unreadCount(userId)

      forum.markRead(unread.id)
      expect(unread.read).toBe(true)
      expect(forum.unreadCount(userId)).toBe(unreadBefore - 1)

      const otherUnread = forum.unreadCount('u2')
      forum.markAllRead(userId)
      expect(forum.unreadCount(userId)).toBe(0)
      expect(forum.unreadCount('u2')).toBe(otherUnread)
    })

    it('updates the profile fields that are given and merges notifyPrefs', () => {
      const user = forum.userById('u3')!
      const bio = user.bio
      expect(forum.updateProfile('u3', { displayName: '新名字', location: '', avatarColor: '#123456', notifyPrefs: { reply: false, like: true, follow: true } })).toBe(true)
      expect(user).toMatchObject({ displayName: '新名字', location: '', avatarColor: '#123456', bio, notifyPrefs: { reply: false, like: true, follow: true } })
      expect(forum.userByUsername('ryan')?.displayName).toBe('新名字')
      expect(forum.updateProfile('nope', { bio: 'x' })).toBe(false)
    })
  })

  describe('sortedTopics', () => {
    const modes = ['latest', 'new', 'top'] as const

    it('puts pinned topics first in every mode and covers every topic', () => {
      for (const mode of modes) {
        const sorted = forum.sortedTopics({ mode })
        expect(sorted).toHaveLength(forum.state.topics.length)
        const pinnedCount = sorted.filter(topic => topic.pinned).length
        expect(pinnedCount).toBe(2)
        expect(sorted.slice(0, pinnedCount).every(topic => topic.pinned)).toBe(true)
        expect(sorted.slice(pinnedCount).some(topic => topic.pinned)).toBe(false)
      }
    })

    it('orders latest by lastActivityAt and new by createdAt, descending', () => {
      const latest = forum.sortedTopics({ mode: 'latest' }).filter(topic => !topic.pinned)
      for (let i = 1; i < latest.length; i++)
        expect(latest[i]!.lastActivityAt).toBeLessThanOrEqual(latest[i - 1]!.lastActivityAt)
      const fresh = forum.sortedTopics({ mode: 'new' }).filter(topic => !topic.pinned)
      for (let i = 1; i < fresh.length; i++)
        expect(fresh[i]!.createdAt).toBeLessThanOrEqual(fresh[i - 1]!.createdAt)
    })

    it('orders top by likes + replies×2 + views/50', () => {
      const score = (topic: Topic): number => forum.likeCountOfTopic(topic.id) + forum.replyCount(topic.id) * 2 + topic.views / 50
      const top = forum.sortedTopics({ mode: 'top' }).filter(topic => !topic.pinned)
      for (let i = 1; i < top.length; i++)
        expect(score(top[i]!)).toBeLessThanOrEqual(score(top[i - 1]!))
    })

    it('filters by category and tag, keeping pinned first', () => {
      const pinned = forum.state.topics.find(topic => topic.pinned)!
      const byCategory = forum.sortedTopics({ mode: 'latest', categoryId: pinned.categoryId })
      expect(byCategory.every(topic => topic.categoryId === pinned.categoryId)).toBe(true)
      expect(byCategory[0]?.pinned).toBe(true)
      expect(byCategory).toHaveLength(forum.topicCountOfCategory(pinned.categoryId))

      const tagId = forum.state.tags[0]!.id
      const byTag = forum.sortedTopics({ mode: 'new', tagId })
      expect(byTag.every(topic => topic.tagIds.includes(tagId))).toBe(true)
      expect(byTag).toHaveLength(forum.topicCountOfTag(tagId))

      expect(forum.sortedTopics({ mode: 'top', categoryId: 'nope' })).toEqual([])
    })

    it('returns a fresh array and never mutates state order', () => {
      const original = forum.state.topics.map(topic => topic.id)
      forum.sortedTopics({ mode: 'top' })
      expect(forum.state.topics.map(topic => topic.id)).toEqual(original)
    })
  })

  describe('searchAll', () => {
    it('matches titles, live content and users case-insensitively', () => {
      const result = forum.searchAll('COREBOX')
      expect(result.topics.length).toBeGreaterThan(0)
      expect(result.topics.every(topic => topic.title.toLowerCase().includes('corebox'))).toBe(true)
      expect(result.posts.length).toBeGreaterThan(0)
      expect(result.posts.every(post => !post.deleted && post.content.toLowerCase().includes('corebox'))).toBe(true)
      expect(forum.searchAll('corebox')).toEqual(result)

      expect(forum.searchAll('TALEX').users.map(user => user.username)).toEqual(['talex'])
      expect(forum.searchAll('小鱼').users.map(user => user.username)).toEqual(['xiaoyu'])
    })

    it('returns nothing for a blank query and caps each list at 50', () => {
      expect(forum.searchAll('   ')).toEqual({ topics: [], posts: [], users: [] })
      const broad = forum.searchAll('e')
      expect(broad.posts.length).toBeLessThanOrEqual(50)
      expect(broad.topics.length).toBeLessThanOrEqual(50)
    })
  })

  describe('per-user derivations', () => {
    it('statsOfUser matches manual counts', () => {
      for (const user of forum.state.users) {
        const stats = forum.statsOfUser(user.id)
        const firsts = new Set(forum.state.topics.map(topic => forum.firstPostOf(topic.id)!.id))
        const live = forum.state.posts.filter(post => post.authorId === user.id && !post.deleted)
        expect(stats).toEqual({
          topics: forum.state.topics.filter(topic => topic.authorId === user.id).length,
          replies: live.filter(post => !firsts.has(post.id)).length,
          likesReceived: live.reduce((sum, post) => sum + post.likeUserIds.length, 0),
          likesGiven: forum.state.posts.filter(post => !post.deleted && post.likeUserIds.includes(user.id)).length,
          followers: forum.state.follows.filter(follow => follow.followeeId === user.id).length,
          following: forum.state.follows.filter(follow => follow.followerId === user.id).length,
        })
      }
      expect(forum.statsOfUser('u1').topics).toBeGreaterThan(0)
      expect(forum.statsOfUser('u1').likesGiven).toBeGreaterThan(0)
    })

    it('lists topics and replies newest first', () => {
      const topics = forum.topicsOfUser('u1')
      expect(topics.every(topic => topic.authorId === 'u1')).toBe(true)
      for (let i = 1; i < topics.length; i++)
        expect(topics[i]!.createdAt).toBeLessThanOrEqual(topics[i - 1]!.createdAt)
      const replies = forum.repliesOfUser('u1')
      expect(replies.every(post => post.authorId === 'u1' && !forum.isFirstPost(post.id) && !post.deleted)).toBe(true)
      for (let i = 1; i < replies.length; i++)
        expect(replies[i]!.createdAt).toBeLessThanOrEqual(replies[i - 1]!.createdAt)
    })

    it('ranks top replies by likes and top topics by first-post likes then replies', () => {
      const top = forum.topLikedPostsOfUser('u1', 3)
      expect(top.length).toBeLessThanOrEqual(3)
      expect(top.every(post => post.authorId === 'u1' && !forum.isFirstPost(post.id))).toBe(true)
      for (let i = 1; i < top.length; i++)
        expect(top[i]!.likeUserIds.length).toBeLessThanOrEqual(top[i - 1]!.likeUserIds.length)

      const topics = forum.topTopicsOfUser('u1', 3)
      const likes = (topic: Topic): number => forum.firstPostOf(topic.id)!.likeUserIds.length
      expect(topics.every(topic => topic.authorId === 'u1')).toBe(true)
      for (let i = 1; i < topics.length; i++) {
        const [prev, cur] = [topics[i - 1]!, topics[i]!]
        expect(likes(cur) < likes(prev) || (likes(cur) === likes(prev) && forum.replyCount(cur.id) <= forum.replyCount(prev.id))).toBe(true)
      }
    })

    it('mostLikedByUsers excludes the user, is sorted descending and matches manual counts', () => {
      const userId = 'u1'
      const manual = new Map<string, number>()
      for (const post of forum.state.posts) {
        if (post.authorId !== userId || post.deleted)
          continue
        for (const likerId of post.likeUserIds)
          manual.set(likerId, (manual.get(likerId) ?? 0) + 1)
      }
      const summaries = forum.mostLikedByUsers(userId, 4)
      expect(summaries.length).toBe(Math.min(4, manual.size))
      expect(summaries.some(entry => entry.user.id === userId)).toBe(false)
      for (let i = 1; i < summaries.length; i++)
        expect(summaries[i]!.count).toBeLessThanOrEqual(summaries[i - 1]!.count)
      for (const entry of summaries)
        expect(entry.count).toBe(manual.get(entry.user.id))
      expect(summaries[0]!.count).toBe(Math.max(...manual.values()))

      // Self-likes cannot be counted even if they exist in the data.
      const own = forum.state.posts.find(post => post.authorId === userId)!
      own.likeUserIds.push(userId)
      expect(forum.mostLikedByUsers(userId).some(entry => entry.user.id === userId)).toBe(false)
    })

    it('activityOfUser interleaves kinds newest first and caps at n', () => {
      const events = forum.activityOfUser('u1', 10)
      expect(events.length).toBe(10)
      for (let i = 1; i < events.length; i++)
        expect(events[i]!.at).toBeLessThanOrEqual(events[i - 1]!.at)
      const all = forum.activityOfUser('u1', 1000)
      const kinds = new Set(all.map(event => event.kind))
      expect(kinds.has('topic')).toBe(true)
      expect(kinds.has('like')).toBe(true)
      expect(all.filter(event => event.kind === 'topic')).toHaveLength(forum.statsOfUser('u1').topics)
      expect(all.filter(event => event.kind === 'reply')).toHaveLength(forum.statsOfUser('u1').replies)
      expect(all.filter(event => event.kind === 'bookmark')).toHaveLength(forum.bookmarksOf('u1').length)
      for (const event of all)
        expect(forum.topicById(event.topicId)).toBeDefined()
    })
  })

  describe('suggestedTopics / recentTopicsOfCategory', () => {
    it('excludes the topic itself and prefers the same category', () => {
      const topic = openTopic(forum)
      const suggestions = forum.suggestedTopics(topic.id, 5)
      expect(suggestions).toHaveLength(5)
      expect(suggestions.some(candidate => candidate.id === topic.id)).toBe(false)
      const sameCategory = forum.topicCountOfCategory(topic.categoryId) - 1
      const expectedSame = Math.min(5, sameCategory)
      expect(suggestions.slice(0, expectedSame).every(candidate => candidate.categoryId === topic.categoryId)).toBe(true)
      for (let i = 1; i < expectedSame; i++)
        expect(suggestions[i]!.lastActivityAt).toBeLessThanOrEqual(suggestions[i - 1]!.lastActivityAt)
    })

    it('fills from other categories when the category runs short', () => {
      const lonely = forum.createTopic({ title: '孤独分类的话题', categoryId: 'c1', tagIds: [], content: '足够长的正文内容', authorId: 'u1', at: LATER })
      // Move every other announcement elsewhere so c1 has just this topic.
      for (const candidate of forum.state.topics) {
        if (candidate.categoryId === 'c1' && candidate.id !== lonely.id)
          candidate.categoryId = 'c2'
      }
      const suggestions = forum.suggestedTopics(lonely.id, 3)
      expect(suggestions).toHaveLength(3)
      expect(suggestions.every(candidate => candidate.id !== lonely.id && candidate.categoryId !== 'c1')).toBe(true)
      expect(forum.suggestedTopics('nope')).toEqual([])
    })

    it('recentTopicsOfCategory returns the newest activity in that category', () => {
      const category = forum.state.categories[1]!
      const recent = forum.recentTopicsOfCategory(category.id, 2)
      expect(recent).toHaveLength(2)
      expect(recent.every(topic => topic.categoryId === category.id)).toBe(true)
      expect(recent[0]!.lastActivityAt).toBeGreaterThanOrEqual(recent[1]!.lastActivityAt)
    })
  })

  describe('end-to-end interaction chain', () => {
    it('post → reply → like → bookmark → follow all show up in the right getters', () => {
      const author = forum.userById('u3')!
      const replier = forum.userById('u4')!

      const topic = forum.createTopic({ title: '端到端链路话题', categoryId: 'c2', tagIds: ['tag1'], content: '首帖正文，长度足够。', authorId: author.id, at: LATER })
      expect(forum.sortedTopics({ mode: 'latest', categoryId: 'c2' }).filter(candidate => !candidate.pinned)[0]).toBe(topic)

      const reply = forum.createPost({ topicId: topic.id, authorId: replier.id, content: `@${author.username} 收到`, at: LATER + 1 })
      expect(forum.replyCount(topic.id)).toBe(1)
      expect(forum.notificationsOf(author.id)[0]).toMatchObject({ type: 'reply', postId: reply.id })

      forum.toggleLike(reply.id, author.id, LATER + 2)
      expect(forum.likeCountOfTopic(topic.id)).toBe(1)
      expect(forum.notificationsOf(replier.id)[0]).toMatchObject({ type: 'like', postId: reply.id })

      forum.toggleBookmark(author.id, reply.id, LATER + 3)
      expect(forum.bookmarksOf(author.id)[0]?.post).toBe(reply)

      const followers = forum.statsOfUser(author.id).followers
      forum.toggleFollow(replier.id, author.id, LATER + 4)
      expect(forum.statsOfUser(author.id).followers).toBe(followers + 1)

      const post = forum.state.posts.find(candidate => candidate.id === reply.id) as Post
      expect(post.likeUserIds).toEqual([author.id])
    })
  })
})

describe('useSessionStore', () => {
  beforeEach(() => {
    setup()
  })

  it('opens logged in as the admin', () => {
    const session = useSessionStore()
    expect(session.currentUserId).toBe('u1')
    expect(session.currentUser?.username).toBe('talex')
    expect(session.isLoggedIn).toBe(true)
    expect(session.isStaff).toBe(true)
  })

  it('logs in as another user and out to guest', () => {
    const session = useSessionStore()
    expect(session.login('u3')).toBe(true)
    expect(session.currentUser?.username).toBe('ryan')
    expect(session.isStaff).toBe(false)
    expect(session.login('nope')).toBe(false)
    expect(session.currentUserId).toBe('u3')
    session.logout()
    expect(session.currentUserId).toBeNull()
    expect(session.currentUser).toBeNull()
    expect(session.isLoggedIn).toBe(false)
    expect(session.isStaff).toBe(false)
  })

  it('reflects profile edits and treats a dangling id as a guest', () => {
    const session = useSessionStore()
    const forum = useForumStore()
    forum.updateProfile('u1', { displayName: '改名' })
    expect(session.currentUser?.displayName).toBe('改名')
    session.currentUserId = 'ghost'
    expect(session.currentUser).toBeNull()
    expect(session.isLoggedIn).toBe(false)
  })
})
