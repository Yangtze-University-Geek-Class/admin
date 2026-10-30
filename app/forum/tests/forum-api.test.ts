import { describe, expect, it, vi } from 'vitest'
import { avatarFileProblem, changedDisplayName, createForumApi, ForumApiError, isStickerUrl, linkableWebsite, NAME_CHARS_HINT, parseReactions, parseServerSnapshot, parseStickerPacks, parseWriteResult, PROFILE_LIMITS, profileBody, profileProblem, STATE_TIMEOUT_MS, uploadFileProblem, websiteProblem } from '../shared/forum-api'
import { MEMBER_VIEWER, serverBody, serverState, writeBody } from './fixtures/server-state'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

describe('parseServerSnapshot', () => {
  it('takes the viewer out of state, and leaves a plain ForumState', () => {
    const { state, viewer } = parseServerSnapshot(serverBody({ userId: 'm1001', kind: 'member', capabilities: ['forum.topic.pin'], level: 'member', nodes: ['forum.reply.create'] }))
    expect(viewer).toEqual({ userId: 'm1001', kind: 'member', capabilities: ['forum.topic.pin'], level: 'member', nodes: ['forum.reply.create'] })
    expect(state).not.toHaveProperty('viewer')
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

  it('reads a viewer without level and nodes (an older server) as signed out of every write (#276)', () => {
    const { viewer } = parseServerSnapshot(serverBody({ userId: 'm1001', kind: 'member', capabilities: [] }))
    expect(viewer).toMatchObject({ level: 'public', nodes: [] })
    const odd = parseServerSnapshot(serverBody({ userId: 'm1001', kind: 'member', capabilities: [], level: 'admin' as never, nodes: ['forum.react', 7 as never] }))
    expect(odd.viewer).toMatchObject({ level: 'public', nodes: ['forum.react'] })
  })

  it('gives every post its reactions, dropping the ones that are not well formed (#276)', () => {
    const body = serverBody()
    const url = `/api/forum/stickers/${'a'.repeat(64)}.webp`
    Object.assign(body.state.posts[0]!, { reactions: [{ stickerId: 'yugc-wave', shortcode: 'yugc-wave', url, count: 2, mine: true }, { stickerId: 'x', shortcode: 'x', url: 'https://evil.example/x.webp', count: 1, mine: false }] })
    const { state } = parseServerSnapshot(body)
    expect(state.posts[0]!.reactions).toEqual([{ stickerId: 'yugc-wave', shortcode: 'yugc-wave', url, count: 2, mine: true }])
    expect(state.posts[1]!.reactions).toEqual([])
  })
})

describe('stickers, reactions and uploads (#276)', () => {
  const hash = 'b'.repeat(64)

  it('takes only on-site, content-addressed sticker pictures', () => {
    expect(isStickerUrl(`/api/forum/stickers/${hash}.webp`)).toBe(true)
    for (const url of ['https://cdn.example/a.webp', `/api/forum/stickers/${hash}.png`, `/api/forum/stickers/${hash}.webp?x=1`, 'javascript:alert(1)', 7])
      expect(isStickerUrl(url)).toBe(false)
  })

  it('takes the controlled CDN address of a content hash too (#286), and no other off-site address', () => {
    const cdn = `https://cdn.crosery.com/yzgc/static/site/forum/stickers/${hash}.webp`
    expect(isStickerUrl(cdn)).toBe(true)
    for (const url of [`https://evil.example/yzgc/static/site/forum/stickers/${hash}.webp`, `http://cdn.crosery.com/yzgc/static/site/forum/stickers/${hash}.webp`, `https://cdn.crosery.com/yzgc/static/site/forum/stickers/../x/${hash}.webp`, `${cdn}?x=1`])
      expect(isStickerUrl(url)).toBe(false)
  })

  it('keeps sticker packs, reactions and snapshot reactions whose picture is on the CDN, and drops the ones whose picture is on another domain', () => {
    const cdn = `https://cdn.crosery.com/yzgc/static/site/forum/stickers/${hash}.webp`
    const evil = `https://evil.example/yzgc/static/site/forum/stickers/${hash}.webp`
    expect(parseStickerPacks({ packs: [{ id: 'yugc', name: '极客娘', stickers: [
      { id: 'yugc-wave', shortcode: 'yugc-wave', label: '打招呼', url: cdn },
      { id: 'yugc-bad', shortcode: 'yugc-bad', label: '坏的', url: evil },
    ] }] })).toEqual([{ id: 'yugc', name: '极客娘', stickers: [{ id: 'yugc-wave', shortcode: 'yugc-wave', label: '打招呼', url: cdn }] }])
    expect(parseReactions({ reactions: [{ stickerId: 'yugc-wave', shortcode: 'yugc-wave', url: cdn, count: 1, mine: false }, { stickerId: 'yugc-bad', shortcode: 'yugc-bad', url: evil, count: 1, mine: false }] }))
      .toEqual([{ stickerId: 'yugc-wave', shortcode: 'yugc-wave', url: cdn, count: 1, mine: false }])
  })

  it('reads the sticker packs and skips a malformed sticker instead of refusing the panel', () => {
    const packs = parseStickerPacks({ packs: [{ id: 'yugc', name: '极客娘', stickers: [
      { id: 'yugc-wave', shortcode: 'yugc-wave', label: '打招呼', url: `/api/forum/stickers/${hash}.webp` },
      { id: 'bad', shortcode: 'bad', label: '坏的', url: 'https://evil.example/x.webp' },
    ] }] })
    expect(packs).toEqual([{ id: 'yugc', name: '极客娘', stickers: [{ id: 'yugc-wave', shortcode: 'yugc-wave', label: '打招呼', url: `/api/forum/stickers/${hash}.webp` }] }])
    expect(() => parseStickerPacks({})).toThrow(ForumApiError)
  })

  it('reads a reaction answer and keeps counts above zero only', () => {
    const url = `/api/forum/stickers/${hash}.webp`
    expect(parseReactions({ reactions: [{ stickerId: 'yugc-wave', shortcode: 'yugc-wave', url, count: 1, mine: true }, { stickerId: 'yugc-cry', shortcode: 'yugc-cry', url, count: 0, mine: false }] }))
      .toEqual([{ stickerId: 'yugc-wave', shortcode: 'yugc-wave', url, count: 1, mine: true }])
    expect(() => parseReactions({ reactions: 'x' })).toThrow(ForumApiError)
  })

  it('says why an image cannot be uploaded before it is sent', () => {
    expect(uploadFileProblem({ size: 10, type: 'image/png' })).toBeNull()
    expect(uploadFileProblem({ size: 10, type: 'image/gif' })).toBeNull()
    expect(uploadFileProblem({ size: 10, type: 'image/svg+xml' })).toBe('只能上传 PNG、JPEG、WebP 或 GIF 图片。')
    expect(uploadFileProblem({ size: 5 * 1024 * 1024 + 1, type: 'image/png' })).toBe('图片不能超过 5MB。')
    expect(uploadFileProblem({ size: 0, type: 'image/png' })).toBe('这个文件是空的。')
  })

  it('sends the reaction to its own path and the upload as the file itself', async () => {
    const url = `/api/forum/stickers/${hash}.webp`
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/reactions/'))
        return jsonResponse({ reactions: [{ stickerId: 'yugc-wave', shortcode: 'yugc-wave', url, count: 1, mine: init?.method === 'PUT' }] })
      return jsonResponse({ url: `/api/forum/uploads/${hash}.webp`, width: 10, height: 10 })
    })
    const api = createForumApi(fetch)
    expect((await api.react('p1', 'yugc-wave', true))[0]!.mine).toBe(true)
    expect(fetch).toHaveBeenLastCalledWith('/api/forum/posts/p1/reactions/yugc-wave', expect.objectContaining({ method: 'PUT' }))
    await api.react('p1', 'yugc-wave', false)
    expect(fetch).toHaveBeenLastCalledWith('/api/forum/posts/p1/reactions/yugc-wave', expect.objectContaining({ method: 'DELETE' }))
    const file = new Blob(['x'], { type: 'image/png' })
    expect(await api.uploadImage(file)).toBe(`/api/forum/uploads/${hash}.webp`)
    expect(fetch).toHaveBeenLastCalledWith('/api/forum/uploads', expect.objectContaining({ method: 'PUT', body: file, headers: expect.objectContaining({ 'content-type': 'image/png' }) }))
  })

  it('refuses an upload answer that points off the site', async () => {
    const api = createForumApi(vi.fn(async () => jsonResponse({ url: 'https://evil.example/x.webp' })))
    await expect(api.uploadImage(new Blob(['x'], { type: 'image/png' }))).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('carries the identity a hidden topic needs, and nothing else from the refusal', async () => {
    const api = createForumApi(vi.fn(async () => jsonResponse({ error: 'forbidden', node: 'forum.read.member', need: 'member', message: '需要「极客班成员」身份才能查看' }, 403)))
    await expect(api.topicPosts('t9')).rejects.toMatchObject({ status: 403, need: 'member' })
  })
})

describe('parseWriteResult', () => {
  const state = serverState(MEMBER_VIEWER)

  it('takes only the records a write changed, and the viewer beside them', () => {
    const result = parseWriteResult(writeBody({
      posts: [state.posts[1]],
      bookmarks: [{ userId: 'm1001', postId: 'p10001', createdAt: 40 }],
      removed: { follows: [{ followerId: 'm1001', followeeId: 'u-geekclass', createdAt: 1 }] },
    }, MEMBER_VIEWER))
    expect(result.viewer).toEqual(MEMBER_VIEWER)
    expect(result.changes).toEqual({
      users: [state.users[1]],
      posts: [{ ...state.posts[1], reactions: [] }],
      bookmarks: [{ userId: 'm1001', postId: 'p10001', createdAt: 40 }],
      removed: { follows: [{ followerId: 'm1001', followeeId: 'u-geekclass' }] },
    })
  })

  it('fills a user in the same way the state read does', () => {
    const { changes } = parseWriteResult(writeBody({ users: [{ id: 'g2', username: 'guest-2', displayName: '新同学', avatarUrl: '', notifyPrefs: { like: false } }] }))
    expect(changes.users).toEqual([{ id: 'g2', username: 'guest-2', displayName: '新同学', bio: '', location: '', website: '', avatarColor: '#64748b', joinedAt: 0, role: 'member', notifyPrefs: { reply: true, like: false, follow: true } }])
  })

  it('refuses the whole answer when any part of it has the wrong shape, so nothing half-read is merged', () => {
    const refused = (body: unknown) => expect(() => parseWriteResult(body)).toThrow(expect.objectContaining({ code: 'invalid_response' }))
    // The answer every write gave before #145: a whole state, no changes.
    refused(serverBody(MEMBER_VIEWER))
    refused({ ...writeBody({}), changes: undefined })
    refused({ ...writeBody({}), changes: [] })
    refused({ ...writeBody({}), viewer: { userId: null, kind: 'member', capabilities: [] } })
    refused(writeBody({ posts: {} }))
    refused(writeBody({ posts: [{ topicId: 't73' }] }))
    refused(writeBody({ users: [{ id: 'm1001' }] }))
    refused(writeBody({ bookmarks: [{ userId: 'm1001' }] }))
    refused(writeBody({ follows: [{ followerId: 'm1001', followeeId: 7 }] }))
    refused(writeBody({ removed: [] }))
    refused(writeBody({ removed: { bookmarks: [{ postId: 'p1' }] } }))
    expect(parseWriteResult(writeBody({})).changes).toEqual({})
  })
})

describe('createForumApi', () => {
  it('reads the state same-origin with the sid cookie, as JSON', async () => {
    const fetch = vi.fn(async () => jsonResponse(serverBody()))
    await createForumApi(fetch).state()
    expect(fetch).toHaveBeenCalledWith('/api/forum/state', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
  })

  it('gives up on the state after 10 seconds and calls that a timeout', async () => {
    const clock = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(clock.signal)
    try {
      const fetch = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }))
      const reading = createForumApi(fetch).state()
      expect(timeout).toHaveBeenCalledWith(STATE_TIMEOUT_MS)
      expect(STATE_TIMEOUT_MS).toBe(10_000)
      expect(fetch.mock.calls[0]![1]?.signal).toBe(clock.signal)
      clock.abort(new DOMException('The operation timed out.', 'TimeoutError'))
      await expect(reading).rejects.toMatchObject({ status: 0, code: 'timeout' })
    }
    finally {
      timeout.mockRestore()
    }
  })

  it('puts no time limit on a write', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(writeBody({})))
    await createForumApi(fetch).toggleLike('p1')
    expect(fetch.mock.calls[0]![1]).not.toHaveProperty('signal')
  })

  it('sends a reply as the topic, the text and the post it answers, nothing else (#276: no guest fields)', async () => {
    const fetch = vi.fn(async () => jsonResponse(writeBody({}, undefined, { postId: 'p10001' }), 201))
    const result = await createForumApi(fetch).createPost({ topicId: 't73', content: '你好', replyToPostId: 'body-73' })
    expect(result.postId).toBe('p10001')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/forum/posts')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({ topicId: 't73', content: '你好', replyToPostId: 'body-73' })
  })

  it('returns the new topic id with what changed', async () => {
    const fetch = vi.fn(async () => jsonResponse(writeBody({ topics: [serverState().topics[1]] }, MEMBER_VIEWER, { topicId: 't1001', postId: 'p10001' }), 201))
    const result = await createForumApi(fetch).createTopic({ title: '标题', categoryId: 'c-exam', tags: ['25级', '新标签'], content: '正文' })
    expect(result.topicId).toBe('t1001')
    expect(result.changes.topics?.map(topic => topic.id)).toEqual(['t1001'])
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ title: '标题', categoryId: 'c-exam', tags: ['25级', '新标签'], content: '正文' })
  })

  it('puts the avatar file itself, typed by its MIME type', async () => {
    const fetch = vi.fn(async () => jsonResponse(writeBody({})))
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
    const fetch = vi.fn(async (url: string, _init?: RequestInit) => url.endsWith('/view') ? new Response(null, { status: 204 }) : jsonResponse(writeBody({})))
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

  it('sends the nickname only when it changed', () => {
    expect(changedDisplayName('阿达', '阿达')).toEqual({})
    expect(changedDisplayName('  阿达 ', '阿达')).toEqual({})
    expect(changedDisplayName('', '阿达')).toEqual({})
    expect(changedDisplayName('Ada', '阿达')).toEqual({ displayName: 'Ada' })
  })

  it('lets a member whose GitHub login is longer than 30 save a signature without touching the nickname', () => {
    const login = 'yangtze-university-geek-class-12345'
    expect(login.length).toBe(35)
    expect(login.length).toBeGreaterThan(PROFILE_LIMITS.displayName)
    const draft = { displayName: login, bio: '计科 2025 级，在学 Go。', location: '', website: '' }
    expect(profileProblem(draft, login)).toBeNull()
    const body = profileBody(draft, login)
    expect(body).not.toHaveProperty('displayName')
    expect(body).toEqual({ bio: '计科 2025 级，在学 Go。', location: '', website: '' })
  })

  it('checks the nickname length once it is changed', () => {
    const login = 'yangtze-university-geek-class-12345'
    expect(profileProblem({ displayName: `${login}6`, bio: '', location: '', website: '' }, login)).toBe(`昵称最多 ${PROFILE_LIMITS.displayName} 个字。`)
    expect(profileProblem({ displayName: '阿达', bio: '', location: '', website: '' }, login)).toBeNull()
    expect(profileBody({ displayName: ' 阿达 ', bio: '', location: '', website: '' }, login)).toMatchObject({ displayName: '阿达' })
  })

  it('names the allowed characters the way the server rule does', () => {
    expect(NAME_CHARS_HINT).toBe('可以用汉字、字母、假名、韩文、数字、空格和 - _ . · ・ \' 这几个符号，空格不能连着用')
  })

  it('links a profile website only when it is https://', () => {
    expect(linkableWebsite('https://github.com/ada')).toBe('https://github.com/ada')
    for (const value of [undefined, '', 'javascript:alert(1)', ' javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://example.com', 'example.com', '//evil.example'])
      expect(linkableWebsite(value)).toBeNull()
  })
})
