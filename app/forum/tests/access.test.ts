import type { Topic, User } from '~/data/types'
import { describe, expect, it } from 'vitest'
import { forumAccess, guestMayReply, UNAVAILABLE_COPY } from '~/data/access'
import { accountMenu } from '~/data/account-menu'
import { can } from '~/data/permissions'

const PREFS = { reply: true, like: true, follow: true }

function user(overrides: Partial<User> = {}): User {
  return { id: 'm1001', username: 'ada', displayName: 'Ada', bio: '', location: '', website: '', avatarColor: '#000', joinedAt: 0, role: 'member', kind: 'member', notifyPrefs: PREFS, ...overrides }
}

const OPEN: Topic = { id: 't73', slug: 't73', title: 't', categoryId: 'c', tagIds: [], authorId: 'u-geekclass', createdAt: 0, lastActivityAt: 0, views: 0, pinned: false, closed: false }
const CLOSED: Topic = { ...OPEN, closed: true }

describe('who may write, per mode', () => {
  it('server, answered: a guest replies under a nickname and cannot start a topic', () => {
    const access = forumAccess('server', 'ready', null)
    expect(access).toEqual({ writable: true, offline: false, guestReply: true, loginPrompt: 'sign-in' })
    expect(guestMayReply(access, OPEN)).toBe(true)
    expect(guestMayReply(access, CLOSED)).toBe(false)
    expect(can(null, 'createTopic')).toBe(false)
    expect(can(null, 'like')).toBe(false)
  })

  it('server, answered: a member writes as their forum user, not as a guest', () => {
    const member = user()
    const access = forumAccess('server', 'ready', member)
    expect(access.guestReply).toBe(false)
    const granted = new Set<string>()
    expect(can(member, 'createTopic', {}, granted)).toBe(true)
    expect(can(member, 'reply', { topic: OPEN }, granted)).toBe(true)
    expect(can(member, 'reply', { topic: CLOSED }, granted)).toBe(false)
    expect(can(member, 'like', {}, granted)).toBe(true)
  })

  it('server, unreachable: nobody writes, the prompt says the service is down', () => {
    expect(forumAccess('server', 'error', null)).toEqual({ writable: false, offline: true, guestReply: false, loginPrompt: 'offline' })
    expect(forumAccess('server', 'loading', null).writable).toBe(false)
  })

  it('server, too many requests (429): nothing is written, but it is not called an outage', () => {
    expect(forumAccess('server', 'busy', null)).toEqual({ writable: false, offline: false, guestReply: false, loginPrompt: 'busy' })
    expect(forumAccess('server', 'busy', user(), true).writable).toBe(false)
    expect(UNAVAILABLE_COPY.busy.title).toBe('请求太频繁，稍后再试')
    expect(UNAVAILABLE_COPY.busy.title).not.toContain('连不上')
  })

  it('signed in site-wide but served as a guest (left the organization): no sign-in loop, still a guest reply', () => {
    const access = forumAccess('server', 'ready', null, true)
    expect(access).toEqual({ writable: true, offline: false, guestReply: true, loginPrompt: 'not-member' })
    expect(forumAccess('server', 'ready', null, false).loginPrompt).toBe('sign-in')
    expect(forumAccess('server', 'ready', user(), true).loginPrompt).toBe('sign-in')
  })

  it('demo and read-only modes keep their own behaviour', () => {
    expect(forumAccess('demo', 'idle', null)).toEqual({ writable: true, offline: false, guestReply: false, loginPrompt: 'pick-identity' })
    expect(forumAccess('read-only', 'idle', null)).toEqual({ writable: false, offline: false, guestReply: false, loginPrompt: 'not-open' })
  })

  it('a guest account never gets a write control, even if it were the session user', () => {
    const guest = user({ id: 'g1', username: 'guest-1', kind: 'guest' })
    expect(can(guest, 'reply', { topic: OPEN })).toBe(false)
    expect(can(guest, 'editPost', { post: { id: 'p1', topicId: 't73', authorId: 'g1', content: 'x', createdAt: 0, likeUserIds: [] } })).toBe(false)
    expect(can(guest, 'editProfile', { targetUser: guest })).toBe(false)
  })
})

describe('moderation against the server follows viewer.capabilities', () => {
  const post = { id: 'p1', topicId: 't73', authorId: 'someone-else', content: 'x', createdAt: 0, likeUserIds: [] }

  it('a title or role on the user object grants nothing by itself', () => {
    const admiral = user({ role: 'admin', title: { id: 'admin' } })
    const none = new Set<string>()
    expect(can(admiral, 'pinTopic', { topic: OPEN }, none)).toBe(false)
    expect(can(admiral, 'editPost', { post }, none)).toBe(false)
    expect(can(admiral, 'reply', { topic: CLOSED }, none)).toBe(false)
  })

  it('each capability unlocks exactly its own action', () => {
    const member = user()
    const pinOnly = new Set(['forum.topic.pin'])
    expect(can(member, 'pinTopic', { topic: OPEN }, pinOnly)).toBe(true)
    expect(can(member, 'closeTopic', { topic: OPEN }, pinOnly)).toBe(false)
    const moderate = new Set(['forum.post.moderate'])
    expect(can(member, 'editPost', { post }, moderate)).toBe(true)
    expect(can(member, 'deletePost', { post }, moderate)).toBe(true)
    expect(can(member, 'reply', { topic: CLOSED }, moderate)).toBe(true)
  })

  it('without a server answer the demo keeps reading roles and titles', () => {
    expect(can(user({ role: 'admin' }), 'pinTopic', { topic: OPEN })).toBe(true)
  })
})

describe('the avatar menu', () => {
  const keys = (menu: ReturnType<typeof accountMenu>) => menu.items.map(item => item.key)

  it('shows 控制台 only when /auth/me says console_link', () => {
    const member = { login: 'ada', consoleLink: false, user: { username: 'ada', displayName: '阿达' } }
    expect(keys(accountMenu(member))).toEqual(['profile', 'preferences', 'bookmarks', 'notifications', 'portal', 'about', 'signout'])
    expect(keys(accountMenu({ ...member, consoleLink: true }))).toEqual(['profile', 'preferences', 'bookmarks', 'notifications', 'console', 'portal', 'about', 'signout'])
  })

  it('names who is signed in: 昵称 over @login', () => {
    const menu = accountMenu({ login: 'ada', consoleLink: false, user: { username: 'ada', displayName: '阿达' } })
    expect([menu.title, menu.subtitle]).toEqual(['阿达', '@ada'])
  })

  it('without a forum user (server down) keeps only the rows that still work', () => {
    const menu = accountMenu({ login: 'ada', consoleLink: true, user: null })
    expect([menu.title, menu.subtitle]).toEqual(['@ada', ''])
    expect(keys(menu)).toEqual(['console', 'portal', 'about', 'signout'])
  })

  it('gives every row a label and a Carbon icon, never an empty row', () => {
    for (const consoleLink of [true, false]) {
      for (const item of accountMenu({ login: 'ada', consoleLink, user: { username: 'ada', displayName: 'Ada' } }).items) {
        expect(item.label.trim()).not.toBe('')
        expect(item.icon).toMatch(/^i-carbon-[a-z-]+$/)
      }
    }
    expect(accountMenu({ login: 'ada', consoleLink: false, user: null }).items.at(-1)).toMatchObject({ key: 'signout', label: '退出', danger: true })
  })
})
