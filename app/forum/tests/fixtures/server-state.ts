/**
 * A made-up `/api/forum/state` answer in the shape the contract fixes: the
 * official account, one member (`m1001`, the viewer when signed in) and one
 * guest who replied. Nothing here is real data.
 */

export interface FixtureViewer {
  userId: string | null
  kind: 'guest' | 'member'
  capabilities: string[]
}

const GUEST_VIEWER: FixtureViewer = { userId: null, kind: 'guest', capabilities: [] }

export function serverState(viewer: FixtureViewer = GUEST_VIEWER) {
  const prefs = { reply: true, like: true, follow: true }
  return {
    version: 1 as const,
    seededAt: 0,
    counters: { topic: 1001, post: 10002, notification: 1, tag: 3 },
    users: [
      { id: 'u-geekclass', username: 'geekclass', displayName: '极客班', bio: '', location: '', website: '', avatarColor: '#3346c8', joinedAt: 1, role: 'admin', kind: 'official', notifyPrefs: prefs } as Record<string, unknown>,
      { id: 'm1001', username: 'ada', displayName: 'Ada', bio: '在学前端', location: '', website: '', avatarColor: '#0e8fc9', avatarUrl: 'https://avatars.example.invalid/u/1001', joinedAt: 2, role: 'member', kind: 'member', notifyPrefs: prefs } as Record<string, unknown>,
      { id: 'g1', username: 'guest-1', displayName: '路过的同学', bio: '', location: '', website: '', avatarColor: '#64748b', joinedAt: 3, role: 'member', kind: 'guest', notifyPrefs: prefs } as Record<string, unknown>,
    ],
    categories: [{ id: 'c-exam', slug: 'exam', name: '招新与机试', description: '', color: '#3346c8', icon: 'i-carbon-education' }],
    tags: [{ id: 'tag-25', slug: '25', name: '25级', color: '#3346c8' }],
    topics: [
      { id: 't73', slug: 't73', title: '25 级机试文档', categoryId: 'c-exam', tagIds: ['tag-25'], authorId: 'u-geekclass', createdAt: 10, lastActivityAt: 30, views: 5, pinned: true, closed: false },
      { id: 't1001', slug: 't1001', title: '机试用什么语言', categoryId: 'c-exam', tagIds: [], authorId: 'm1001', createdAt: 20, lastActivityAt: 20, views: 1, pinned: false, closed: false },
    ],
    // /state carries a one-line excerpt and no body (#156); the fixtures keep
    // `content` only on the records the topic-posts answer would send.
    posts: [
      { id: 'body-73', topicId: 't73', authorId: 'u-geekclass', excerpt: '机试说明', createdAt: 10, likeUserIds: ['m1001'] },
      { id: 'p10001', topicId: 't1001', authorId: 'm1001', excerpt: '都可以吗？', createdAt: 20, likeUserIds: [] },
      { id: 'p10002', topicId: 't73', authorId: 'g1', excerpt: '谢谢整理', createdAt: 30, likeUserIds: [] },
    ],
    notifications: viewer.userId === 'm1001'
      ? [{ id: 'n1', recipientId: 'm1001', type: 'like', actorId: 'u-geekclass', topicId: 't1001', postId: 'p10001', createdAt: 25, read: false }]
      : [],
    bookmarks: [] as Array<Record<string, unknown>>,
    follows: [] as Array<Record<string, unknown>>,
    viewer,
    guestPolicy: { powDifficulty: 2, turnstileSiteKey: null, nameMax: 20, contentMax: 2000 },
  }
}

export function serverBody(viewer: FixtureViewer = GUEST_VIEWER) {
  return { state: serverState(viewer) }
}

export const MEMBER_VIEWER: FixtureViewer = { userId: 'm1001', kind: 'member', capabilities: [] }
export const MODERATOR_VIEWER: FixtureViewer = { userId: 'm1001', kind: 'member', capabilities: ['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate'] }

/**
 * A write's answer in the shape the contract fixes (#145): only the changed
 * records, plus the same `viewer` and `guestPolicy` as `/state`. Like the
 * server's, a member's answer always carries the member's own user record
 * (first, unless `changes.users` has it already); tests/server/forum.test.ts
 * checks that on the real answers.
 */
export function writeBody(changes: Record<string, unknown>, viewer: FixtureViewer = GUEST_VIEWER, extra: Record<string, unknown> = {}) {
  const state = serverState(viewer)
  const users = (changes.users ?? []) as Array<Record<string, unknown>>
  const own = viewer.userId === null || users.some(user => user.id === viewer.userId) ? [] : state.users.filter(user => user.id === viewer.userId)
  return { changes: own.length ? { ...changes, users: [...own, ...users] } : changes, viewer, guestPolicy: state.guestPolicy, ...extra }
}

/** `GET /api/forum/topics/:id/posts` 的回答（#156）：与 `/state` 里同一条相同，只是带正文。 */
export function topicPostsBody(topicId: string) {
  return { posts: serverState().posts.filter(post => post.topicId === topicId).map(({ excerpt, ...post }) => ({ ...post, content: excerpt })) }
}

/** `GET /api/forum/search` 的回答（#156）：与 `/state` 同类记录相同的形状（帖子是摘要）。 */
export function searchBody(query: string) {
  const state = serverState()
  const q = query.toLowerCase()
  const text = (value: unknown) => String(value).toLowerCase()
  const excerpt = (post: Record<string, unknown>) => text(post.excerpt)
  return {
    results: {
      topics: state.topics.filter(topic => text(topic.title).includes(q)),
      posts: state.posts.filter(post => excerpt(post).includes(q)),
      users: state.users.filter(user => text(user.username).includes(q) || text(user.displayName).includes(q)),
    },
  }
}
