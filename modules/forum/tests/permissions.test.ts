import type { Post, Topic, User } from '~/data/types'
import { describe, expect, it } from 'vitest'
import { can, isStaff } from '~/data/permissions'
import { createSeed } from '~/data/seed'

const state = createSeed(1_780_000_000_000)

const admin = state.users.find(user => user.role === 'admin') as User
const moderator = state.users.find(user => user.role === 'moderator') as User
const [author, other] = state.users.filter(user => user.role === 'member') as [User, User]

const openTopic: Topic = { ...(state.topics.find(topic => !topic.closed) as Topic), authorId: author.id, closed: false }
const closedTopic: Topic = { ...openTopic, id: 'closed', closed: true }
const post: Post = { id: 'px', topicId: openTopic.id, authorId: author.id, content: 'hi', createdAt: 1, likeUserIds: [] }

describe('isStaff', () => {
  it('is true for admin and moderator only', () => {
    expect(isStaff(admin)).toBe(true)
    expect(isStaff(moderator)).toBe(true)
    expect(isStaff(author)).toBe(false)
    expect(isStaff(null)).toBe(false)
    expect(isStaff(undefined)).toBe(false)
  })
})

describe('can', () => {
  it('denies a guest everything', () => {
    const actions = ['createTopic', 'reply', 'like', 'bookmark', 'follow', 'editPost', 'deletePost', 'pinTopic', 'closeTopic', 'editProfile', 'markNotification'] as const
    for (const action of actions)
      expect(can(null, action, { post, topic: openTopic, targetUser: author })).toBe(false)
  })

  it('lets any member create, like, bookmark and mark notifications', () => {
    for (const user of [author, other, moderator, admin]) {
      expect(can(user, 'createTopic')).toBe(true)
      expect(can(user, 'like', { post })).toBe(true)
      expect(can(user, 'bookmark', { post })).toBe(true)
      expect(can(user, 'markNotification')).toBe(true)
    }
  })

  it('gates replies on the topic being open, unless staff', () => {
    expect(can(author, 'reply', { topic: openTopic })).toBe(true)
    expect(can(other, 'reply', { topic: openTopic })).toBe(true)
    expect(can(author, 'reply', { topic: closedTopic })).toBe(false)
    expect(can(other, 'reply', { topic: closedTopic })).toBe(false)
    expect(can(moderator, 'reply', { topic: closedTopic })).toBe(true)
    expect(can(admin, 'reply', { topic: closedTopic })).toBe(true)
    // No topic context: nothing to be closed.
    expect(can(other, 'reply')).toBe(true)
  })

  it('limits edit and delete to the author or staff, and requires a post', () => {
    for (const action of ['editPost', 'deletePost'] as const) {
      expect(can(author, action, { post })).toBe(true)
      expect(can(other, action, { post })).toBe(false)
      expect(can(moderator, action, { post })).toBe(true)
      expect(can(admin, action, { post })).toBe(true)
      expect(can(admin, action)).toBe(false)
    }
  })

  it('limits pin and close to staff', () => {
    for (const action of ['pinTopic', 'closeTopic'] as const) {
      expect(can(author, action, { topic: openTopic })).toBe(false)
      expect(can(other, action, { topic: openTopic })).toBe(false)
      expect(can(moderator, action, { topic: openTopic })).toBe(true)
      expect(can(admin, action, { topic: openTopic })).toBe(true)
    }
  })

  it('lets only the user themself edit their profile', () => {
    expect(can(author, 'editProfile', { targetUser: author })).toBe(true)
    expect(can(other, 'editProfile', { targetUser: author })).toBe(false)
    expect(can(admin, 'editProfile', { targetUser: author })).toBe(false)
    expect(can(author, 'editProfile')).toBe(false)
  })

  it('forbids following yourself', () => {
    expect(can(author, 'follow', { targetUser: other })).toBe(true)
    expect(can(author, 'follow', { targetUser: author })).toBe(false)
    expect(can(author, 'follow')).toBe(false)
  })
})
