import { describe, expect, it } from 'vitest'
import {
  emptyForumState,
  parseAssetIndex,
  parseSnapshotDocument,
  parseSnapshotState,
  resolveAsset,
  SnapshotError,
  summarize,
} from '../shared/local-snapshot'

// Fabricated fixture only: the real projection lives outside the repository
// and is never read by tests.
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function state() {
  return {
    version: 1,
    seededAt: 0,
    counters: { topic: 2, post: 3, notification: 0, tag: 1 },
    users: [
      { id: 'u1', username: 'alpha', displayName: '甲', bio: '', location: '', website: '', avatarColor: '#123456', joinedAt: 1, role: 'admin', notifyPrefs: { reply: true, like: true, follow: true } },
      { id: 'u2', username: '乙同学', displayName: '乙', bio: '', location: '', website: '', avatarColor: '#654321', avatarUrl: `/api/local-forum/assets/${HASH_A}`, joinedAt: 2, role: 'member', notifyPrefs: { reply: true, like: true, follow: true } },
    ],
    categories: [{ id: 'c1', slug: 'general', name: '综合', description: '', color: '#000000', icon: 'i-carbon-forum', archived: false }],
    tags: [{ id: 'tag1', slug: 'x', name: 'x', color: '#000000' }],
    topics: [
      { id: 't1', slug: 'topic-1', title: '第一帖', categoryId: 'c1', tagIds: [], authorId: 'u1', createdAt: 10, lastActivityAt: 20, views: 3, pinned: false, closed: false, archived: true },
      { id: 't2', slug: 'topic-2', title: '第二帖', categoryId: 'c1', tagIds: [], authorId: 'u2', createdAt: 11, lastActivityAt: 11, views: 0, pinned: false, closed: false, archived: false },
    ],
    posts: [
      { id: 'body-1', topicId: 't1', authorId: 'u1', content: '正文', createdAt: 10, isTopicBody: true, likeUserIds: [] },
      { id: 'p1', topicId: 't1', authorId: 'u2', content: '回复', createdAt: 20, likeUserIds: [] },
      { id: 'body-2', topicId: 't2', authorId: 'u2', content: '正文二', createdAt: 11, isTopicBody: true, likeUserIds: [] },
    ],
    notifications: [],
    bookmarks: [],
    follows: [],
  }
}

function document(overrides: Record<string, unknown> = {}) {
  return { schemaVersion: 1, mode: 'local-snapshot', capturedAt: '2026-09-12T19:03:18Z', state: state(), ...overrides }
}

function assetIndex(overrides: Record<string, unknown> = {}) {
  return {
    assets: {
      [HASH_A]: { file: `${HASH_A}.webp`, sha256: HASH_A, bytes: 10, mime: 'image/webp', disposition: 'inline' },
      [HASH_B]: { file: `${HASH_B}.md`, sha256: HASH_B, bytes: 5, mime: 'text/plain; charset=utf-8', disposition: 'attachment' },
    },
    aliases: { 'legacy/one.png': HASH_A },
    rejected: [],
    ...overrides,
  }
}

describe('parseSnapshotDocument', () => {
  it('accepts a well-formed snapshot and derives the summary from the state', () => {
    const parsed = parseSnapshotDocument(document())
    expect(parsed.capturedAt).toBe('2026-09-12T19:03:18Z')
    expect(parsed.summary).toEqual({ users: 2, categories: 1, topics: 2, replies: 1, archivedTopics: 1 })
    expect(parsed.state.topics).toHaveLength(2)
  })

  it.each([
    ['schemaVersion', { schemaVersion: 2 }],
    ['mode', { mode: 'upstream-seed' }],
    ['capturedAt', { capturedAt: 'yesterday' }],
    ['state', { state: null }],
  ])('rejects a document with a bad %s', (_label, overrides) => {
    expect(() => parseSnapshotDocument(document(overrides))).toThrow(SnapshotError)
  })

  it('does not accept an arbitrary JSON value', () => {
    expect(() => parseSnapshotDocument('[]')).toThrow(SnapshotError)
    expect(() => parseSnapshotDocument([])).toThrow(SnapshotError)
  })
})

describe('parseSnapshotState', () => {
  it('rejects the upstream demo state version mismatch and missing counters', () => {
    expect(() => parseSnapshotState({ ...state(), version: 2 })).toThrow(/version/)
    expect(() => parseSnapshotState({ ...state(), counters: { topic: 1 } })).toThrow(/counters/)
  })

  it('rejects dangling references so pages never render a hole', () => {
    const missingCategory = state()
    missingCategory.topics[0]!.categoryId = 'c404'
    expect(() => parseSnapshotState(missingCategory)).toThrow(/分类/)

    const missingAuthor = state()
    missingAuthor.posts[1]!.authorId = 'u404'
    expect(() => parseSnapshotState(missingAuthor)).toThrow(/作者/)

    const missingTopic = state()
    missingTopic.posts[1]!.topicId = 't404'
    expect(() => parseSnapshotState(missingTopic)).toThrow(/话题/)
  })

  it('rejects a topic without an opening post', () => {
    const orphan = state()
    orphan.posts = orphan.posts.filter(post => post.topicId !== 't2')
    expect(() => parseSnapshotState(orphan)).toThrow(/没有任何帖子/)
  })

  it('rejects duplicate ids, usernames and slugs', () => {
    const duplicateUser = state()
    duplicateUser.users[1]!.username = 'alpha'
    expect(() => parseSnapshotState(duplicateUser)).toThrow(/username/)

    const duplicateSlug = state()
    duplicateSlug.topics[1]!.slug = 'topic-1'
    expect(() => parseSnapshotState(duplicateSlug)).toThrow(/topics.slug/)
  })

  it('rejects an avatar that does not go through the local asset route', () => {
    const remote = state()
    remote.users[1]!.avatarUrl = 'https://example.com/a.png'
    expect(() => parseSnapshotState(remote)).toThrow(/avatarUrl/)
  })

  it('drops an empty or null avatarUrl so the initials fallback applies', () => {
    const blank = state()
    ;(blank.users[0] as { avatarUrl?: string | null }).avatarUrl = ''
    ;(blank.users[1] as { avatarUrl?: string | null }).avatarUrl = null
    const parsed = parseSnapshotState(blank)
    expect(parsed.users[0]).not.toHaveProperty('avatarUrl')
    expect(parsed.users[1]).not.toHaveProperty('avatarUrl')
  })

  it('turns SQL nulls on posts into absent fields', () => {
    const nulls = state()
    ;(nulls.posts[0] as { editedAt?: number | null }).editedAt = null
    ;(nulls.posts[1] as { replyToPostId?: string | null }).replyToPostId = null
    const parsed = parseSnapshotState(nulls)
    expect(parsed.posts[0]).not.toHaveProperty('editedAt')
    expect(parsed.posts[1]).not.toHaveProperty('replyToPostId')
    ;(nulls.posts[0] as { editedAt?: unknown }).editedAt = 'later'
    expect(() => parseSnapshotState(nulls)).toThrow(/editedAt/)
  })

  it('rejects an unknown role instead of mapping it to a permission', () => {
    const teacher = state()
    ;(teacher.users[0] as { role: string }).role = 'teacher'
    expect(() => parseSnapshotState(teacher)).toThrow(/role/)
  })
})

describe('asset index', () => {
  it('parses entries and aliases', () => {
    const index = parseAssetIndex(assetIndex())
    expect(index.assets.size).toBe(2)
    expect(index.aliases.get('legacy/one.png')).toBe(HASH_A)
    expect(resolveAsset(index, HASH_B)).toMatchObject({ mime: 'text/plain; charset=utf-8', disposition: 'attachment', bytes: 5 })
  })

  it('only resolves bare lowercase hashes', () => {
    const index = parseAssetIndex(assetIndex())
    expect(resolveAsset(index, `${HASH_A}.webp`)).toBeNull()
    expect(resolveAsset(index, HASH_A.toUpperCase())).toBeNull()
    expect(resolveAsset(index, 'legacy/one.png')).toBeNull()
    expect(resolveAsset(index, '../../etc/passwd')).toBeNull()
    expect(resolveAsset(index, 'c'.repeat(64))).toBeNull()
  })

  it.each([
    ['sha256 mismatch', { [HASH_A]: { file: `${HASH_A}.webp`, sha256: HASH_B, bytes: 1, mime: 'image/webp', disposition: 'inline' } }],
    ['file outside the hash naming', { [HASH_A]: { file: '../content.json', sha256: HASH_A, bytes: 1, mime: 'image/webp', disposition: 'inline' } }],
    ['file for another hash', { [HASH_A]: { file: `${HASH_B}.webp`, sha256: HASH_A, bytes: 1, mime: 'image/webp', disposition: 'inline' } }],
    ['svg', { [HASH_A]: { file: `${HASH_A}.svg`, sha256: HASH_A, bytes: 1, mime: 'image/svg+xml', disposition: 'inline' } }],
    ['html', { [HASH_A]: { file: `${HASH_A}.html`, sha256: HASH_A, bytes: 1, mime: 'text/html', disposition: 'inline' } }],
    ['negative size', { [HASH_A]: { file: `${HASH_A}.webp`, sha256: HASH_A, bytes: -1, mime: 'image/webp', disposition: 'inline' } }],
    ['unknown disposition', { [HASH_A]: { file: `${HASH_A}.webp`, sha256: HASH_A, bytes: 1, mime: 'image/webp', disposition: 'download' } }],
    ['non-hash key', { abc: { file: 'abc.webp', sha256: 'abc', bytes: 1, mime: 'image/webp', disposition: 'inline' } }],
  ])('fails closed on %s', (_label, assets) => {
    expect(() => parseAssetIndex({ assets })).toThrow(SnapshotError)
  })

  it('rejects an alias pointing at an unknown asset', () => {
    expect(() => parseAssetIndex(assetIndex({ aliases: { 'legacy/x.png': 'c'.repeat(64) } }))).toThrow(/别名/)
  })
})

describe('helpers', () => {
  it('emptyForumState carries the current version and nothing else', () => {
    const empty = emptyForumState()
    expect(empty.version).toBe(1)
    expect(empty.users).toEqual([])
    expect(empty.topics).toEqual([])
    expect(summarize(empty)).toEqual({ users: 0, categories: 0, topics: 0, replies: 0, archivedTopics: 0 })
  })
})
