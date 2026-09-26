import { describe, expect, it, vi } from 'vitest'
import { avatarFileProblem, createForumApi, DEFAULT_GUEST_POLICY, ForumApiError, parseServerSnapshot, websiteProblem } from '../shared/forum-api'
import { serverBody, serverState } from './fixtures/server-state'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

describe('parseServerSnapshot', () => {
  it('takes viewer and guestPolicy out of state, and leaves a plain ForumState', () => {
    const { state, viewer, guestPolicy } = parseServerSnapshot(serverBody({ userId: 'm1001', kind: 'member', capabilities: ['forum.topic.pin'] }))
    expect(viewer).toEqual({ userId: 'm1001', kind: 'member', capabilities: ['forum.topic.pin'] })
    expect(guestPolicy).toEqual({ powDifficulty: 2, turnstileSiteKey: null, nameMax: 20, contentMax: 2000 })
    expect(state).not.toHaveProperty('viewer')
    expect(state).not.toHaveProperty('guestPolicy')
    expect(state.users.map(user => user.id)).toEqual(['u-geekclass', 'm1001', 'g1'])
    expect(state.users.find(user => user.id === 'g1')?.kind).toBe('guest')
  })

  it('keeps an uploaded avatar and drops an empty one', () => {
    const body = serverBody()
    body.state.users[1]!.avatarUrl = '/api/forum/avatars/abc.webp'
    body.state.users[2]!.avatarUrl = ''
    const { state } = parseServerSnapshot(body)
    expect(state.users[1]!.avatarUrl).toBe('/api/forum/avatars/abc.webp')
    expect(state.users[2]).not.toHaveProperty('avatarUrl')
  })

  it('refuses a payload that is not a whole state, or a viewer that contradicts itself', () => {
    expect(() => parseServerSnapshot({ state: { ...serverState(), version: 2 } })).toThrow(ForumApiError)
    expect(() => parseServerSnapshot({ state: { ...serverState(), posts: undefined } })).toThrow(ForumApiError)
    expect(() => parseServerSnapshot(serverBody({ userId: null, kind: 'member', capabilities: [] }))).toThrow(ForumApiError)
    expect(() => parseServerSnapshot(serverBody({ userId: 'm1', kind: 'guest', capabilities: [] }))).toThrow(ForumApiError)
    expect(() => parseServerSnapshot('<!doctype html>')).toThrow(ForumApiError)
  })

  it('falls back to the contract defaults when guestPolicy is missing', () => {
    const body = serverBody()
    delete (body.state as { guestPolicy?: unknown }).guestPolicy
    expect(parseServerSnapshot(body).guestPolicy).toEqual(DEFAULT_GUEST_POLICY)
  })
})

describe('createForumApi', () => {
  it('reads the state same-origin with the sid cookie, as JSON', async () => {
    const fetch = vi.fn(async () => jsonResponse(serverBody()))
    await createForumApi(fetch).state()
    expect(fetch).toHaveBeenCalledWith('/api/forum/state', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
  })

  it('sends a guest reply with the name, the proof and an empty honeypot', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ...serverBody(), postId: 'p10001' }, 201))
    const result = await createForumApi(fetch).createPost({
      topicId: 't73',
      content: '你好',
      guest: { name: '路过的同学' },
      pow: { timestamp: 1, nonce: 'a' },
      website: '',
    })
    expect(result.postId).toBe('p10001')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/forum/posts')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({ topicId: 't73', content: '你好', guest: { name: '路过的同学' }, pow: { timestamp: 1, nonce: 'a' }, website: '' })
  })

  it('returns the new topic id with the state', async () => {
    const fetch = vi.fn(async () => jsonResponse({ ...serverBody(), topicId: 't1001', postId: 'p10001' }, 201))
    const result = await createForumApi(fetch).createTopic({ title: '标题', categoryId: 'c-exam', tags: ['25级', '新标签'], content: '正文' })
    expect(result.topicId).toBe('t1001')
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ title: '标题', categoryId: 'c-exam', tags: ['25级', '新标签'], content: '正文' })
  })

  it('puts the avatar file itself, typed by its MIME type', async () => {
    const fetch = vi.fn(async () => jsonResponse(serverBody()))
    const file = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })
    await createForumApi(fetch).uploadAvatar(file)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/forum/me/avatar')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(file)
    expect((init.headers as Record<string, string>)['content-type']).toBe('image/webp')
  })

  // Fastify answers 400 to a request that says application/json and carries no body.
  it.each([
    ['toggleLike', (api: ReturnType<typeof createForumApi>) => api.toggleLike('p1'), 'POST', '/api/forum/posts/p1/like'],
    ['deletePost', (api: ReturnType<typeof createForumApi>) => api.deletePost('p1'), 'DELETE', '/api/forum/posts/p1'],
    ['recordView', (api: ReturnType<typeof createForumApi>) => api.recordView('t73'), 'POST', '/api/forum/topics/t73/view'],
    ['toggleBookmark', (api: ReturnType<typeof createForumApi>) => api.toggleBookmark('p1'), 'POST', '/api/forum/posts/p1/bookmark'],
    ['markAllRead', (api: ReturnType<typeof createForumApi>) => api.markAllRead(), 'POST', '/api/forum/notifications/read-all'],
    ['resetAvatar', (api: ReturnType<typeof createForumApi>) => api.resetAvatar(), 'DELETE', '/api/forum/me/avatar'],
  ] as const)('%s sends no body and no Content-Type', async (_name, call, method, path) => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/view') ? new Response(null, { status: 204 }) : jsonResponse(serverBody()))
    await call(createForumApi(fetch))
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect([url, init.method]).toEqual([path, method])
    expect(init.body).toBeUndefined()
    expect(Object.keys(init.headers as Record<string, string>).map(name => name.toLowerCase())).not.toContain('content-type')
  })

  it('escapes ids in the path and treats 204 as done', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }))
    await createForumApi(fetch).recordView('t/../1')
    expect(fetch.mock.calls[0]![0]).toBe('/api/forum/topics/t%2F..%2F1/view')
  })

  it('surfaces the server message and code on failure', async () => {
    const fetch = vi.fn(async () => jsonResponse({ error: 'signin_required', message: '请先登录' }, 401))
    await expect(createForumApi(fetch).toggleLike('p1')).rejects.toMatchObject({ status: 401, code: 'signin_required', message: '请先登录' })
  })

  it('explains a failure without a JSON body, and a network error, in plain Chinese', async () => {
    const html = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }))
    await expect(createForumApi(html).state()).rejects.toMatchObject({ status: 502, code: 'http_502', message: '论坛服务出错了，请稍后再试。' })
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    await expect(createForumApi(offline).state()).rejects.toMatchObject({ status: 0, code: 'network_error', message: '论坛服务暂时连不上，请稍后再试。' })
  })

  it('refuses an HTML page answered with 200 (a static host without the API)', async () => {
    const fetch = vi.fn(async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await expect(createForumApi(fetch).state()).rejects.toBeInstanceOf(ForumApiError)
  })
})

describe('client-side checks', () => {
  it('accepts only png, jpeg and webp avatars up to 2MB', () => {
    expect(avatarFileProblem({ size: 1024, type: 'image/png' })).toBeNull()
    expect(avatarFileProblem({ size: 2 * 1024 * 1024, type: 'image/webp' })).toBeNull()
    expect(avatarFileProblem({ size: 2 * 1024 * 1024 + 1, type: 'image/jpeg' })).toContain('2MB')
    expect(avatarFileProblem({ size: 1024, type: 'image/gif' })).toContain('PNG')
    expect(avatarFileProblem({ size: 1024, type: 'image/svg+xml' })).toContain('PNG')
  })

  it('accepts only https:// websites', () => {
    expect(websiteProblem('')).toBeNull()
    expect(websiteProblem('https://example.com/me')).toBeNull()
    expect(websiteProblem('http://example.com')).toContain('https://')
    expect(websiteProblem('javascript:alert(1)')).toContain('https://')
    expect(websiteProblem('example.com')).not.toBeNull()
    expect(websiteProblem(`https://example.com/${'a'.repeat(200)}`)).toContain('200')
  })
})
