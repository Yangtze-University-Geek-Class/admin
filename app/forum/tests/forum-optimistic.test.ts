import type { FixtureViewer } from './fixtures/server-state'
import { clearToasts, toastStore } from '@talex-touch/tuffex/utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useForumStore } from '~/stores/forum'
import { isPending, useForumServerStore } from '~/stores/forum-server'
import { fakeServer, held, json } from './fixtures/fake-server'
import { MEMBER_VIEWER, MODERATOR_VIEWER, serverBody, serverState, writeBody } from './fixtures/server-state'

/**
 * #145: every interaction against the forum server shows on the page before
 * the request resolves, and a refusal puts the page back with a toast. Each
 * case reads one value off the store, calls the action without awaiting it,
 * and looks again while the request is still held.
 */

type Stores = ReturnType<typeof stores>
type State = ReturnType<typeof serverState>

function stores() {
  return { forum: useForumStore(), server: useForumServerStore() }
}

/** The fixture with a bookmark and a follow of the viewer's own, so both can be taken back. */
function withRelations(state: State): State {
  state.bookmarks = [{ userId: 'm1001', postId: 'p10002', createdAt: 35 }]
  state.follows = [{ followerId: 'm1001', followeeId: 'u-geekclass', createdAt: 36 }]
  return state
}

async function loaded(viewer: FixtureViewer, prepare: (state: State) => State = state => state, ...answers: Parameters<typeof fakeServer>) {
  const calls = fakeServer(json({ state: prepare(serverState(viewer)) }), ...answers)
  setActivePinia(createPinia())
  const all = stores()
  await all.server.load()
  return { calls, ...all }
}

const base = serverState(MEMBER_VIEWER)
const post = (id: string) => ({ ...base.posts.find(item => item.id === id)! })
const topic = (id: string) => ({ ...base.topics.find(item => item.id === id)! })
const notification = { ...base.notifications[0]!, read: true }
const REFUSAL = { error: 'server_error', message: '论坛服务出错了' }

interface Case {
  name: string
  viewer?: FixtureViewer
  prepare?: (state: State) => State
  /** Starts the interaction; not awaited. */
  act: (s: Stores) => Promise<unknown>
  /** What the page shows for it. */
  read: (s: Stores) => unknown
  before: unknown
  after: unknown
  request: { url: string, method: string }
  /** The records the server sends back on success. */
  changes: Record<string, unknown>
  /** What the action resolves with once the server has it. */
  returns: unknown
  /** What it resolves with after a refusal: a toggle or a reply has no answer (null), the other writes did not happen (false). */
  refused: null | false
  /** The toast title a refusal brings. */
  failure: string
}

const contents = (s: Stores) => s.forum.postsOfTopic('t73').map(item => [item.content, s.forum.userById(item.authorId)?.displayName])

const CASES: Case[] = [
  {
    name: 'like',
    act: s => s.server.toggleLike('p10001'),
    read: s => s.forum.postById('p10001')?.likeUserIds,
    before: [],
    after: ['m1001'],
    request: { url: '/api/forum/posts/p10001/like', method: 'POST' },
    changes: { posts: [{ ...post('p10001'), likeUserIds: ['m1001'] }] },
    returns: true,
    refused: null,
    failure: '没有赞上',
  },
  {
    name: 'unlike',
    act: s => s.server.toggleLike('body-73'),
    read: s => s.forum.postById('body-73')?.likeUserIds,
    before: ['m1001'],
    after: [],
    request: { url: '/api/forum/posts/body-73/like', method: 'POST' },
    changes: { posts: [{ ...post('body-73'), likeUserIds: [] }] },
    returns: false,
    refused: null,
    failure: '没有取消赞',
  },
  {
    name: 'bookmark',
    act: s => s.server.toggleBookmark('p10001'),
    read: s => s.forum.isBookmarked('m1001', 'p10001'),
    before: false,
    after: true,
    request: { url: '/api/forum/posts/p10001/bookmark', method: 'POST' },
    changes: { bookmarks: [{ userId: 'm1001', postId: 'p10001', createdAt: 50 }] },
    returns: true,
    refused: null,
    failure: '没有加上书签',
  },
  {
    name: 'remove a bookmark',
    prepare: withRelations,
    act: s => s.server.toggleBookmark('p10002'),
    read: s => s.forum.state.bookmarks.map(item => [item.postId, item.createdAt]),
    before: [['p10002', 35]],
    after: [],
    request: { url: '/api/forum/posts/p10002/bookmark', method: 'POST' },
    changes: { removed: { bookmarks: [{ userId: 'm1001', postId: 'p10002' }] } },
    returns: false,
    refused: null,
    failure: '没有移出书签',
  },
  {
    name: 'follow',
    act: s => s.server.toggleFollow('u-geekclass'),
    read: s => s.forum.isFollowing('m1001', 'u-geekclass'),
    before: false,
    after: true,
    request: { url: '/api/forum/users/u-geekclass/follow', method: 'POST' },
    changes: { follows: [{ followerId: 'm1001', followeeId: 'u-geekclass', createdAt: 50 }] },
    returns: true,
    refused: null,
    failure: '没有关注上',
  },
  {
    name: 'unfollow',
    prepare: withRelations,
    act: s => s.server.toggleFollow('u-geekclass'),
    read: s => s.forum.state.follows.map(item => [item.followeeId, item.createdAt]),
    before: [['u-geekclass', 36]],
    after: [],
    request: { url: '/api/forum/users/u-geekclass/follow', method: 'POST' },
    changes: { removed: { follows: [{ followerId: 'm1001', followeeId: 'u-geekclass' }] } },
    returns: false,
    refused: null,
    failure: '没有取消关注',
  },
  {
    name: 'edit',
    act: s => s.server.editPost('p10001', '改成 Python 可以吗？'),
    read: s => s.forum.postById('p10001')?.content,
    before: '都可以吗？',
    after: '改成 Python 可以吗？',
    request: { url: '/api/forum/posts/p10001', method: 'PATCH' },
    changes: { posts: [{ ...post('p10001'), content: '改成 Python 可以吗？', editedAt: 50 }] },
    returns: true,
    refused: false,
    failure: '修改没有保存',
  },
  {
    name: 'delete',
    act: s => s.server.deletePost('p10001'),
    read: s => [s.forum.postById('p10001')?.deleted ?? false, s.forum.postById('p10001')?.content],
    before: [false, '都可以吗？'],
    after: [true, ''],
    request: { url: '/api/forum/posts/p10001', method: 'DELETE' },
    changes: { posts: [{ ...post('p10001'), content: '', deleted: true }] },
    returns: true,
    refused: false,
    failure: '帖子没有删掉',
  },
  {
    name: 'pin',
    viewer: MODERATOR_VIEWER,
    act: s => s.server.setPinned('t1001', true),
    read: s => s.forum.topicById('t1001')?.pinned,
    before: false,
    after: true,
    request: { url: '/api/forum/topics/t1001/pin', method: 'POST' },
    changes: { topics: [{ ...topic('t1001'), pinned: true }] },
    returns: true,
    refused: false,
    failure: '没有置顶',
  },
  {
    name: 'close',
    viewer: MODERATOR_VIEWER,
    act: s => s.server.setClosed('t73', true),
    read: s => s.forum.topicById('t73')?.closed,
    before: false,
    after: true,
    request: { url: '/api/forum/topics/t73/close', method: 'POST' },
    changes: { topics: [{ ...topic('t73'), closed: true }] },
    returns: true,
    refused: false,
    failure: '话题没有关闭',
  },
  {
    name: 'mark one notification read',
    act: s => s.server.markRead('n1'),
    read: s => s.forum.unreadCount('m1001'),
    before: 1,
    after: 0,
    request: { url: '/api/forum/notifications/n1/read', method: 'POST' },
    changes: { notifications: [notification] },
    returns: true,
    refused: false,
    failure: '没有标为已读',
  },
  {
    name: 'mark all read',
    act: s => s.server.markAllRead(),
    read: s => s.forum.unreadCount('m1001'),
    before: 1,
    after: 0,
    request: { url: '/api/forum/notifications/read-all', method: 'POST' },
    changes: { notifications: [notification] },
    returns: true,
    refused: false,
    failure: '没有标为已读',
  },
  {
    name: 'save the profile',
    act: s => s.server.updateProfile({ bio: '在学 Go', notifyPrefs: { reply: true, like: false, follow: true } }),
    read: s => [s.forum.userById('m1001')?.bio, s.forum.userById('m1001')?.notifyPrefs.like],
    before: ['在学前端', true],
    after: ['在学 Go', false],
    request: { url: '/api/forum/me/profile', method: 'PATCH' },
    changes: { users: [{ ...base.users[1], bio: '在学 Go', notifyPrefs: { reply: true, like: false, follow: true } }] },
    returns: true,
    refused: false,
    failure: '资料没有保存',
  },
  {
    name: 'reply',
    act: s => s.server.createPost({ topicId: 't73', content: '收到，谢谢' }),
    read: contents,
    before: [['机试说明', '极客班'], ['谢谢整理', '路过的同学']],
    after: [['机试说明', '极客班'], ['谢谢整理', '路过的同学'], ['收到，谢谢', 'Ada']],
    request: { url: '/api/forum/posts', method: 'POST' },
    changes: { posts: [{ id: 'p10003', topicId: 't73', authorId: 'm1001', content: '收到，谢谢', createdAt: 50, likeUserIds: [] }], topics: [{ ...topic('t73'), lastActivityAt: 50 }] },
    returns: 'p10003',
    refused: null,
    failure: '回复没有发出去',
  },
  {
    name: 'guest reply',
    viewer: { userId: null, kind: 'guest', capabilities: [] },
    act: s => s.server.replyAsGuest({ topicId: 't73', content: '什么时候机试？', name: '新同学' }),
    read: contents,
    before: [['机试说明', '极客班'], ['谢谢整理', '路过的同学']],
    after: [['机试说明', '极客班'], ['谢谢整理', '路过的同学'], ['什么时候机试？', '新同学']],
    request: { url: '/api/forum/posts', method: 'POST' },
    changes: {
      users: [{ ...base.users[2], id: 'g2', username: 'guest-2', displayName: '新同学' }],
      posts: [{ id: 'p10003', topicId: 't73', authorId: 'g2', content: '什么时候机试？', createdAt: 50, likeUserIds: [] }],
      topics: [{ ...topic('t73'), lastActivityAt: 50 }],
    },
    returns: 'p10003',
    refused: null,
    failure: '回复没有发出去',
  },
]

beforeEach(() => clearToasts())
afterEach(() => vi.unstubAllGlobals())

describe.each(CASES)('$name against the server', (item) => {
  const viewer = item.viewer ?? MEMBER_VIEWER
  const answer = () => writeBody(item.changes, viewer, item.request.url === '/api/forum/posts' ? { postId: 'p10003' } : {})

  it('shows on the page before the request resolves, then keeps what the server sent', async () => {
    const reply = held()
    const { calls, ...s } = await loaded(viewer, item.prepare, reply.answer)
    expect(item.read(s)).toEqual(item.before)
    const settled = item.act(s)
    expect(item.read(s)).toEqual(item.after)
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toMatchObject(item.request)
    expect(item.read(s)).toEqual(item.after)
    reply.release(json(answer(), item.request.url === '/api/forum/posts' ? 201 : 200))
    expect(await settled).toBe(item.returns)
    expect(item.read(s)).toEqual(item.after)
    expect(s.forum.state.posts.some(record => isPending(record.id))).toBe(false)
    expect(toastStore.items).toEqual([])
  })

  it('puts the page back and says why when the server refuses', async () => {
    const reply = held()
    const { calls, ...s } = await loaded(viewer, item.prepare, reply.answer)
    const settled = item.act(s)
    expect(item.read(s)).toEqual(item.after)
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    reply.release(json(REFUSAL, 500))
    expect(await settled).toBe(item.refused)
    expect(item.read(s)).toEqual(item.before)
    expect(s.forum.state.users.some(record => isPending(record.id))).toBe(false)
    expect(toastStore.items.map(toast => [toast.title, toast.description])).toEqual([[item.failure, '论坛服务出错了']])
  })
})

describe('one request at a time per thing', () => {
  const liked = (on: boolean) => json(writeBody({ posts: [{ ...post('p10001'), likeUserIds: on ? ['m1001'] : [] }] }, MEMBER_VIEWER))
  const likes = (s: Stores) => s.forum.postById('p10001')?.likeUserIds

  it('a double click on 赞 sends the like, and the take-back only after the first answer', async () => {
    const first = held()
    const second = held()
    const { calls, ...s } = await loaded(MEMBER_VIEWER, undefined, first.answer, second.answer)
    const one = s.server.toggleLike('p10001')
    const two = s.server.toggleLike('p10001')
    expect(likes(s)).toEqual([])
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(calls).toHaveLength(2)
    first.release(liked(true))
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    // The server has the like now; the page still shows the second click.
    expect(likes(s)).toEqual([])
    second.release(liked(false))
    expect(await Promise.all([one, two])).toEqual([false, false])
    expect(calls.slice(1).map(call => call.url)).toEqual(['/api/forum/posts/p10001/like', '/api/forum/posts/p10001/like'])
    expect(likes(s)).toEqual([])
  })

  it('three quick clicks end liked with one request', async () => {
    const reply = held()
    const { calls, ...s } = await loaded(MEMBER_VIEWER, undefined, reply.answer)
    const clicks = [s.server.toggleLike('p10001'), s.server.toggleLike('p10001'), s.server.toggleLike('p10001')]
    expect(likes(s)).toEqual(['m1001'])
    reply.release(liked(true))
    expect(await Promise.all(clicks)).toEqual([true, true, true])
    expect(calls).toHaveLength(2)
  })

  it('two quick clicks send one request when the server was already where the second click wants it', async () => {
    // Liked from another tab: the page still shows 赞 as not given, and the server's toggle takes it back.
    const reply = held()
    const { calls, ...s } = await loaded(MEMBER_VIEWER, undefined, reply.answer)
    const clicks = [s.server.toggleLike('p10001'), s.server.toggleLike('p10001')]
    expect(likes(s)).toEqual([])
    reply.release(liked(false))
    expect(await Promise.all(clicks)).toEqual([false, false])
    expect(calls).toHaveLength(2)
    expect(likes(s)).toEqual([])
  })

  it('an edit saved again while the first is out sends the newer text once the first is answered', async () => {
    const first = held()
    const second = held()
    const { calls, ...s } = await loaded(MEMBER_VIEWER, undefined, first.answer, second.answer)
    const edited = (content: string) => json(writeBody({ posts: [{ ...post('p10001'), content, editedAt: 60 }] }, MEMBER_VIEWER))
    const saves = [s.server.editPost('p10001', '第一版'), s.server.editPost('p10001', '第二版')]
    expect(s.forum.postById('p10001')?.content).toBe('第二版')
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    first.release(edited('第一版'))
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(s.forum.postById('p10001')?.content).toBe('第二版')
    second.release(edited('第二版'))
    expect(await Promise.all(saves)).toEqual([true, true])
    expect(calls.slice(1).map(call => call.body)).toEqual([{ content: '第一版' }, { content: '第二版' }])
  })

  it('标为全部已读 twice sends one request', async () => {
    const reply = held()
    const { calls, ...s } = await loaded(MEMBER_VIEWER, undefined, reply.answer)
    const marks = [s.server.markAllRead(), s.server.markAllRead()]
    reply.release(json(writeBody({ notifications: [notification] }, MEMBER_VIEWER)))
    expect(await Promise.all(marks)).toEqual([true, true])
    expect(calls).toHaveLength(2)
  })

  it('an answer about one thing does not undo another thing still being sent', async () => {
    const like = held()
    const edit = held()
    const { calls, ...s } = await loaded(MEMBER_VIEWER, undefined, like.answer, edit.answer)
    const liking = s.server.toggleLike('p10001')
    const editing = s.server.editPost('p10001', '新的内容')
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    // The like's answer still has the old text: the edit that is out stays on the page.
    like.release(liked(true))
    expect(await liking).toBe(true)
    expect(s.forum.postById('p10001')?.content).toBe('新的内容')
    edit.release(json(writeBody({ posts: [{ ...post('p10001'), content: '新的内容', likeUserIds: ['m1001'], editedAt: 60 }] }, MEMBER_VIEWER)))
    expect(await editing).toBe(true)
    expect(s.forum.postById('p10001')).toMatchObject({ content: '新的内容', likeUserIds: ['m1001'] })
  })
})

describe('two things on one record, both refused', () => {
  /** A second unread notification, so 全部已读 changes more than the one read mark. */
  function twoUnread(state: State): State {
    state.notifications = [...state.notifications, { ...state.notifications[0]!, id: 'n2', createdAt: 26 }]
    return state
  }

  // Each failure puts back only its own fields as the server has them, whichever is refused first.
  it.each([['the edit', [0, 1]], ['the deletion', [1, 0]]] as const)('an edit and then a deletion of one post: the server\'s text comes back, not deleted, when %s is refused first', async (_first, order) => {
    const answers = [held(), held()]
    const { calls, ...s } = await loaded(MEMBER_VIEWER, undefined, answers[0]!.answer, answers[1]!.answer)
    const editing = s.server.editPost('p10001', '没保存的新文字')
    const deleting = s.server.deletePost('p10001')
    expect(s.forum.postById('p10001')).toMatchObject({ deleted: true, content: '' })
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    for (const index of order) {
      answers[index]!.release(json(REFUSAL, 500))
      await (index === 0 ? editing : deleting)
    }
    expect(await Promise.all([editing, deleting])).toEqual([false, false])
    const shown = s.forum.postById('p10001')!
    expect([shown.content, shown.deleted ?? false, shown.editedAt]).toEqual(['都可以吗？', false, undefined])
  })

  it.each([['the read mark', [0, 1]], ['全部已读', [1, 0]]] as const)('one read mark and then 全部已读: both notifications are unread again when %s is refused first', async (_first, order) => {
    const answers = [held(), held()]
    const { calls, ...s } = await loaded(MEMBER_VIEWER, twoUnread, answers[0]!.answer, answers[1]!.answer)
    expect(s.forum.unreadCount('m1001')).toBe(2)
    const marking = s.server.markRead('n1')
    const markingAll = s.server.markAllRead()
    expect(s.forum.unreadCount('m1001')).toBe(0)
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    for (const index of order) {
      answers[index]!.release(json(REFUSAL, 500))
      await (index === 0 ? marking : markingAll)
    }
    expect(await Promise.all([marking, markingAll])).toEqual([false, false])
    expect(s.forum.state.notifications.map(item => [item.id, item.read])).toEqual([['n1', false], ['n2', false]])
    expect(s.forum.unreadCount('m1001')).toBe(2)
  })
})

describe('merging an answer', () => {
  it('keeps the state and every record the answer did not change, so nothing else redraws', async () => {
    const { forum, server } = await loaded(MEMBER_VIEWER, undefined, json(writeBody({ users: [base.users[1]], posts: [{ ...post('p10001'), likeUserIds: ['m1001'] }] }, MEMBER_VIEWER)))
    const whole = forum.state
    const records = () => [forum.postById('p10001'), forum.postById('body-73'), forum.topicById('t73'), forum.userById('m1001'), forum.state.posts, forum.state.users]
    const kept = records()
    const likes = forum.postById('body-73')!.likeUserIds
    await server.toggleLike('p10001')
    expect(forum.state).toBe(whole)
    records().forEach((record, index) => expect(record).toBe(kept[index]))
    expect(forum.postById('body-73')!.likeUserIds).toBe(likes)
  })
})

describe('a reply while it is sent', () => {
  it('is on the page under a pending id, and the page hears both that id and the server\'s', async () => {
    const reply = held()
    const { forum, server } = await loaded(MEMBER_VIEWER, undefined, reply.answer)
    const shown: string[] = []
    const sending = server.createPost({ topicId: 't73', content: '收到', replyToPostId: 'body-73' }, id => shown.push(id))
    expect(shown).toHaveLength(1)
    expect(isPending(shown[0]!)).toBe(true)
    expect(forum.postById(shown[0]!)).toMatchObject({ topicId: 't73', authorId: 'm1001', content: '收到', replyToPostId: 'body-73' })
    reply.release(json(writeBody({ posts: [{ id: 'p10003', topicId: 't73', authorId: 'm1001', content: '收到', replyToPostId: 'body-73', createdAt: 50, likeUserIds: [] }] }, MEMBER_VIEWER, { postId: 'p10003' }), 201))
    expect(await sending).toBe('p10003')
    expect(forum.postById(shown[0]!)).toBeUndefined()
    expect(forum.postsOfTopic('t73').map(item => item.id)).toEqual(['body-73', 'p10002', 'p10003'])
  })

  it('cannot be liked, edited or answered until the server has it', async () => {
    const reply = held()
    const { calls, forum, server } = await loaded(MEMBER_VIEWER, undefined, reply.answer)
    let pending = ''
    void server.createPost({ topicId: 't73', content: '收到' }, (id) => {
      pending = id
    })
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(await server.toggleLike(pending)).toBeNull()
    expect(await server.editPost(pending, '改')).toBe(false)
    expect(await server.createPost({ topicId: 't73', content: '回它', replyToPostId: pending })).toBeNull()
    expect(calls).toHaveLength(2)
    expect(forum.postById(pending)?.likeUserIds).toEqual([])
    expect(toastStore.items.map(toast => toast.title)).toContain('这条回复还没发出去')
  })
})

describe('the state read', () => {
  it('still replaces the whole state: it is the one answer that is not a change', async () => {
    fakeServer(json(serverBody(MEMBER_VIEWER)), json(serverBody(MEMBER_VIEWER)))
    setActivePinia(createPinia())
    const { forum, server } = stores()
    await server.load()
    const first = forum.state
    await server.load()
    expect(forum.state).not.toBe(first)
  })
})
