import { clearToasts, toastStore } from '@talex-touch/tuffex/utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useForumStore } from '~/stores/forum'
import { stateRetryDelay, useForumServerStore } from '~/stores/forum-server'
import { useSessionStore } from '~/stores/session'
import { checkPow, replyPowBody } from '../shared/pow'
import { MEMBER_VIEWER, MODERATOR_VIEWER, serverBody, serverState } from './fixtures/server-state'

interface Call { url: string, method: string, body: unknown }

/** A fake core server: records every call and answers from a queue. */
function fakeServer(...answers: Array<Response | (() => Response)>) {
  const calls: Call[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body })
    const next = answers.shift()
    if (!next)
      throw new Error(`unexpected call ${init.method} ${url}`)
    return typeof next === 'function' ? next() : next
  })
  vi.stubGlobal('fetch', fetch)
  return calls
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function setup() {
  setActivePinia(createPinia())
  return { forum: useForumStore(), session: useSessionStore(), server: useForumServerStore() }
}

beforeEach(() => clearToasts())
afterEach(() => vi.unstubAllGlobals())

describe('loading the forum from the server', () => {
  it('replaces the store and signs the session in as the viewer', async () => {
    fakeServer(json(serverBody(MEMBER_VIEWER)))
    const { forum, session, server } = setup()
    expect(await server.load()).toBe(true)
    expect(server.status).toBe('ready')
    expect(forum.state.topics.map(topic => topic.id)).toEqual(['t73', 't1001'])
    expect(session.currentUserId).toBe('m1001')
    expect(session.currentUser?.displayName).toBe('Ada')
    expect(server.guestPolicy.powDifficulty).toBe(2)
  })

  it('leaves a guest signed out', async () => {
    fakeServer(json(serverBody()))
    const { session, server } = setup()
    await server.load()
    expect(session.currentUserId).toBeNull()
    expect(server.viewer?.kind).toBe('guest')
  })

  it('keeps what the page already shows when the server does not answer', async () => {
    fakeServer(() => { throw new TypeError('Failed to fetch') })
    const { forum, session, server } = setup()
    const before = forum.state
    session.currentUserId = 'someone'
    expect(await server.load()).toBe(false)
    expect(server.status).toBe('error')
    expect(forum.state).toBe(before)
    expect(session.currentUserId).toBeNull()
  })

  it('treats a 429 as busy, not down: keeps the page, says so once, and asks again later', async () => {
    vi.useFakeTimers()
    try {
      const calls = fakeServer(json({ error: 'rate_limited', message: '操作太频繁，请稍后再试' }, 429), json(serverBody()))
      const { forum, server } = setup()
      const before = forum.state
      expect(await server.load()).toBe(false)
      expect(server.status).toBe('busy')
      expect(forum.state).toBe(before)
      expect(toastStore.items.map(item => item.title)).toEqual(['请求太频繁，稍后再试'])
      await vi.advanceTimersByTimeAsync(stateRetryDelay(0))
      expect(calls).toHaveLength(2)
      expect(server.status).toBe('ready')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('keeps an answered forum as it is when a later read is refused with 429', async () => {
    vi.useFakeTimers()
    try {
      fakeServer(json(serverBody(MEMBER_VIEWER)), json({ error: 'rate_limited', message: '操作太频繁，请稍后再试' }, 429))
      const { forum, session, server } = setup()
      await server.load()
      const before = forum.state
      expect(await server.load()).toBe(false)
      expect(server.status).toBe('ready')
      expect(forum.state).toBe(before)
      expect(session.currentUserId).toBe('m1001')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('says it once for a run of refusals and waits longer after each one', async () => {
    vi.useFakeTimers()
    try {
      const busy = () => json({ error: 'rate_limited', message: '操作太频繁，请稍后再试' }, 429)
      const calls = fakeServer(busy, busy, json(serverBody()))
      const { server } = setup()
      await server.load()
      expect(toastStore.items.map(item => item.title)).toEqual(['请求太频繁，稍后再试'])
      await vi.advanceTimersByTimeAsync(stateRetryDelay(0))
      expect(calls).toHaveLength(2)
      expect(server.status).toBe('busy')
      // The first toast has run its course; the second refusal does not bring it back.
      expect(toastStore.items).toEqual([])
      await vi.advanceTimersByTimeAsync(stateRetryDelay(1) - 1)
      expect(calls).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(calls).toHaveLength(3)
      expect(server.status).toBe('ready')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('backs off between retries and settles at one a minute', () => {
    expect([0, 1, 2, 3, 9].map(stateRetryDelay)).toEqual([10_000, 20_000, 40_000, 60_000, 60_000])
  })

  it('shares one request between callers that load at the same time', async () => {
    const calls = fakeServer(json(serverBody()))
    const { server } = setup()
    await Promise.all([server.load(), server.load()])
    expect(calls).toHaveLength(1)
  })
})

describe('writes against the server', () => {
  async function signedIn(viewer = MEMBER_VIEWER, ...answers: Response[]) {
    const calls = fakeServer(json(serverBody(viewer)), ...answers)
    const store = setup()
    await store.server.load()
    return { calls, ...store }
  }

  it('publishes a topic and takes the new state and id from the answer', async () => {
    const next = serverState(MEMBER_VIEWER)
    next.topics.push({ id: 't1002', slug: 't1002', title: '新话题', categoryId: 'c-exam', tagIds: [], authorId: 'm1001', createdAt: 40, lastActivityAt: 40, views: 0, pinned: false, closed: false })
    const { calls, forum, server } = await signedIn(MEMBER_VIEWER, json({ state: next, topicId: 't1002', postId: 'p10003' }, 201))
    const id = await server.createTopic({ title: '新话题', categoryId: 'c-exam', tags: ['25级'], content: '正文正文正文正文' })
    expect(id).toBe('t1002')
    expect(calls[1]).toEqual({ url: '/api/forum/topics', method: 'POST', body: { title: '新话题', categoryId: 'c-exam', tags: ['25级'], content: '正文正文正文正文' } })
    expect(forum.topicById('t1002')?.title).toBe('新话题')
  })

  it('changes nothing locally and says why when a write is refused', async () => {
    const { forum, server } = await signedIn(MEMBER_VIEWER, json({ error: 'rate_limited', message: '回复太频繁了，一分钟后再试。' }, 429))
    const before = forum.state
    expect(await server.createPost({ topicId: 't73', content: '再来一条' })).toBeNull()
    expect(forum.state).toBe(before)
    expect(forum.postsOfTopic('t73')).toHaveLength(2)
    expect(toastStore.items.map(item => [item.title, item.description])).toEqual([['回复没有发出去', '回复太频繁了，一分钟后再试。']])
  })

  it('reports the viewer\'s side of a like after the server answered', async () => {
    const next = serverState(MEMBER_VIEWER)
    next.posts[1]!.likeUserIds = ['m1001']
    const { calls, server } = await signedIn(MEMBER_VIEWER, json({ state: next }))
    expect(await server.toggleLike('p10001')).toBe(true)
    expect(calls[1]).toMatchObject({ url: '/api/forum/posts/p10001/like', method: 'POST' })
  })

  it('returns null for a failed toggle so the page keeps its button as it was', async () => {
    const { server } = await signedIn(MEMBER_VIEWER, json({ error: 'signin_required', message: '请先登录' }, 401))
    expect(await server.toggleBookmark('body-73')).toBeNull()
    expect(toastStore.items[0]?.description).toBe('请先登录')
  })

  it('reads moderation rights from the viewer\'s capabilities only', async () => {
    const { server } = await signedIn(MODERATOR_VIEWER)
    expect([...server.granted]).toEqual(['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate'])
  })

  it('saves the profile with the fields the contract names', async () => {
    const next = serverState(MEMBER_VIEWER)
    next.users[1]!.bio = '新的签名'
    const { calls, session, server } = await signedIn(MEMBER_VIEWER, json({ state: next }))
    expect(await server.updateProfile({ displayName: 'Ada', bio: '新的签名', location: '', website: '' })).toBe(true)
    expect(calls[1]).toEqual({ url: '/api/forum/me/profile', method: 'PATCH', body: { displayName: 'Ada', bio: '新的签名', location: '', website: '' } })
    expect(session.currentUser?.bio).toBe('新的签名')
  })

  it('uploads the avatar file and restores the GitHub one', async () => {
    const uploaded = serverState(MEMBER_VIEWER)
    uploaded.users[1]!.avatarUrl = '/api/forum/avatars/0123abcd.webp'
    const { calls, session, server } = await signedIn(MEMBER_VIEWER, json({ state: uploaded }), json(serverBody(MEMBER_VIEWER)))
    const file = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })
    expect(await server.uploadAvatar(file)).toBe(true)
    expect(calls[1]).toMatchObject({ url: '/api/forum/me/avatar', method: 'PUT', body: file })
    expect(session.currentUser?.avatarUrl).toBe('/api/forum/avatars/0123abcd.webp')
    expect(await server.resetAvatar()).toBe(true)
    expect(calls[2]).toMatchObject({ url: '/api/forum/me/avatar', method: 'DELETE' })
    expect(session.currentUser?.avatarUrl).toBe('https://avatars.example.invalid/u/1001')
  })

  it('shows the server\'s own words for a refused profile change and a paused guest reply', async () => {
    const { server } = await signedIn(MEMBER_VIEWER, json({ error: 'display_name_taken', message: '这个昵称是官方账号或别人的用户名，换一个吧', request_id: 'r2' }, 400))
    expect(await server.updateProfile({ displayName: '极客班' })).toBe(false)
    expect(toastStore.items.map(item => [item.title, item.description])).toEqual([['资料没有保存', '这个昵称是官方账号或别人的用户名，换一个吧']])
  })

  it('says 请求太频繁 when counting a view is refused with 429', async () => {
    const { server } = await signedIn(MEMBER_VIEWER, json({ error: 'rate_limited', message: '操作太频繁，请稍后再试' }, 429))
    await server.recordView('t73')
    expect(toastStore.items.map(item => item.title)).toEqual(['请求太频繁，稍后再试'])
  })

  it('counts a view without a toast, even when the count fails', async () => {
    const { calls, server } = await signedIn(MEMBER_VIEWER, json({ error: 'x', message: 'y' }, 500))
    await server.recordView('t73')
    expect(calls[1]).toMatchObject({ url: '/api/forum/topics/t73/view', method: 'POST' })
    expect(toastStore.items).toHaveLength(0)
  })
})

describe('a guest reply', () => {
  it('carries the nickname, an empty honeypot and a proof over the exact text sent', async () => {
    const next = serverState()
    const calls = fakeServer(json(serverBody()), json({ state: next, postId: 'p10003' }, 201))
    const { server } = setup()
    await server.load()
    expect(await server.replyAsGuest({ topicId: 't73', content: '请问 25 级什么时候机试？', name: '路过的同学', replyToPostId: 'body-73' })).toBe('p10003')
    const sent = calls[1]!.body as { topicId: string, content: string, replyToPostId: string, guest: { name: string }, pow: { timestamp: number, nonce: string }, website: string }
    expect(sent).toMatchObject({ topicId: 't73', content: '请问 25 级什么时候机试？', replyToPostId: 'body-73', guest: { name: '路过的同学' }, website: '' })
    expect(Object.keys(sent).sort()).toEqual(['content', 'guest', 'pow', 'replyToPostId', 'topicId', 'website'])
    expect(await checkPow(replyPowBody('t73', '请问 25 级什么时候机试？'), 2, sent.pow)).toBe(true)
  })

  it('adds the Turnstile token when the page has one, and nothing else changes', async () => {
    const calls = fakeServer(json(serverBody()), json({ state: serverState(), postId: 'p10003' }, 201))
    const { server } = setup()
    await server.load()
    expect(await server.replyAsGuest({ topicId: 't73', content: '谢谢', name: '路过的同学', turnstileToken: 'cf-token' })).toBe('p10003')
    const sent = calls[1]!.body as Record<string, unknown>
    expect(Object.keys(sent).sort()).toEqual(['content', 'guest', 'pow', 'topicId', 'turnstileToken', 'website'])
    expect(sent.turnstileToken).toBe('cf-token')
  })

  it('shows the server message when guest replies are paused site-wide', async () => {
    fakeServer(json(serverBody()), json({ error: 'guest_replies_paused', message: '游客回复暂时太多，请过一会儿再试，或者登录后回复' }, 429))
    const { forum, server } = setup()
    await server.load()
    const before = forum.state
    expect(await server.replyAsGuest({ topicId: 't73', content: '谢谢', name: '路过的同学' })).toBeNull()
    expect(forum.state).toBe(before)
    expect(server.status).toBe('ready')
    expect(toastStore.items.map(item => [item.title, item.description])).toEqual([['回复没有发出去', '游客回复暂时太多，请过一会儿再试，或者登录后回复']])
  })

  it('says why when the server refuses the nickname, and keeps the page as it was', async () => {
    fakeServer(json(serverBody()), json({ error: 'guest_name_taken', message: '这个昵称是成员在用的，换一个吧', request_id: 'r1' }, 400))
    const { forum, server } = setup()
    await server.load()
    const before = forum.state
    expect(await server.replyAsGuest({ topicId: 't73', content: '谢谢', name: 'Ada' })).toBeNull()
    expect(forum.state).toBe(before)
    expect(toastStore.items.map(item => [item.title, item.description])).toEqual([['回复没有发出去', '这个昵称是成员在用的，换一个吧']])
  })
})
