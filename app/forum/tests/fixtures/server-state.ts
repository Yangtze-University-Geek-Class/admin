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
    posts: [
      { id: 'body-73', topicId: 't73', authorId: 'u-geekclass', content: '机试说明', createdAt: 10, likeUserIds: ['m1001'] },
      { id: 'p10001', topicId: 't1001', authorId: 'm1001', content: '都可以吗？', createdAt: 20, likeUserIds: [] },
      { id: 'p10002', topicId: 't73', authorId: 'g1', content: '谢谢整理', createdAt: 30, likeUserIds: [] },
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
