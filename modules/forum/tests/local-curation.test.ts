import { describe, expect, it } from 'vitest'
import { applyCuration, parseCuration } from '../shared/local-curation'
import { parseSnapshotState, SnapshotError } from '../shared/local-snapshot'

// Fabricated state: two archived categories (one empty), one live category,
// three topics. Never the real projection.
function state() {
  return {
    version: 1,
    seededAt: 0,
    counters: { topic: 3, post: 3, notification: 0, tag: 1 },
    users: [
      { id: 'u1', username: 'alpha', displayName: '甲', bio: '', location: '', website: '', avatarColor: '#123456', joinedAt: 1, role: 'admin', notifyPrefs: { reply: true, like: true, follow: true } },
    ],
    categories: [
      { id: 'c1', slug: '问答', name: '问答专区', description: '', color: '#4361b5', icon: 'i-carbon-archive', archived: true },
      { id: 'c2', slug: '空组', name: '空小组', description: '', color: '#4361b5', icon: 'i-carbon-archive', archived: true },
      { id: 'c3', slug: 'ai-coding', name: 'AI Coding', description: '', color: '#4361b5', icon: 'i-carbon-forum', archived: false },
    ],
    tags: [{ id: 'tag1', slug: '顶', name: '顶', color: '#4361b5' }],
    topics: [
      { id: 't1', slug: 'topic-1', title: '老帖一', categoryId: 'c1', tagIds: [], authorId: 'u1', createdAt: 10, lastActivityAt: 10, views: 1, pinned: false, closed: false, archived: true },
      { id: 't2', slug: 'topic-2', title: '老帖二', categoryId: 'c1', tagIds: ['tag1'], authorId: 'u1', createdAt: 11, lastActivityAt: 11, views: 1, pinned: false, closed: false, archived: true },
      { id: 't3', slug: 'topic-3', title: '新帖', categoryId: 'c3', tagIds: [], authorId: 'u1', createdAt: 12, lastActivityAt: 12, views: 1, pinned: false, closed: false, archived: false },
    ],
    posts: [
      { id: 'body-1', topicId: 't1', authorId: 'u1', content: '一', createdAt: 10, isTopicBody: true, likeUserIds: [] },
      { id: 'body-2', topicId: 't2', authorId: 'u1', content: '二', createdAt: 11, isTopicBody: true, likeUserIds: [] },
      { id: 'body-3', topicId: 't3', authorId: 'u1', content: '原文', createdAt: 12, isTopicBody: true, likeUserIds: [] },
    ],
    notifications: [],
    bookmarks: [],
    follows: [],
  }
}

function curation(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    archive: { id: 'c-archive', slug: 'archive', name: '老帖归档', description: '旧帖', color: '#8a94a6', icon: 'i-carbon-archive', tagPrefix: 'legacy-', tagColor: '#8a94a6' },
    categories: [
      { id: 'c-school', slug: 'school', name: '课程与作业', description: '校园', color: '#2f6fed', icon: 'i-carbon-education' },
    ],
    categoryOrder: ['c-school', 'c3', 'c-archive'],
    categoryPatches: { c3: { color: '#7c3aed', description: '写代码' } },
    tags: [{ id: 'tag-notes', slug: 'notes', name: '知识整理', color: '#14b8a6' }],
    topics: { t3: { title: '新帖（润色）', categoryId: 'c-school', tagIds: ['tag1', 'tag-notes'] } },
    posts: { 'body-3': { content: '# 润色后的正文' } },
    ...overrides,
  }
}

describe('parseCuration', () => {
  it('accepts the documented shape', () => {
    const parsed = parseCuration(curation())
    expect(parsed.archive.tagPrefix).toBe('legacy-')
    expect(parsed.categories).toHaveLength(1)
  })

  it.each([
    ['schema version', { schemaVersion: 2 }],
    ['archive colour', { archive: { id: 'c-archive', slug: 'archive', name: '老帖归档', description: '', color: 'grey', icon: 'i-carbon-archive', tagPrefix: 'legacy-', tagColor: '#8a94a6' } }],
    ['category icon outside carbon or ri', { categories: [{ id: 'x', slug: 'x', name: 'X', description: '', color: '#000000', icon: 'not-an-icon' }] }],
    ['empty post body', { posts: { 'body-3': { content: '   ' } } }],
  ])('rejects a bad %s', (_label, overrides) => {
    expect(() => parseCuration(curation(overrides))).toThrow(SnapshotError)
  })
})

describe('applyCuration', () => {
  it('collapses archived categories into the archive and keeps origins as tags', () => {
    const result = applyCuration(parseSnapshotState(state()), parseCuration(curation()))
    expect(result.categories.map(category => category.id)).toEqual(['c-school', 'c3', 'c-archive'])
    const archived = result.topics.filter(topic => topic.categoryId === 'c-archive')
    expect(archived.map(topic => topic.id)).toEqual(['t1', 't2'])
    expect(archived.every(topic => topic.tagIds.includes('legacy-c1'))).toBe(true)
    expect(result.topics.find(topic => topic.id === 't2')?.tagIds).toEqual(['tag1', 'legacy-c1'])
    expect(result.tags.find(tag => tag.id === 'legacy-c1')).toMatchObject({ slug: 'legacy-问答', name: '问答专区', color: '#8a94a6' })
    // The empty archived category leaves no tag behind.
    expect(result.tags.some(tag => tag.id === 'legacy-c2')).toBe(false)
  })

  it('applies retitles, moves, new tags, patches and polished bodies', () => {
    const result = applyCuration(parseSnapshotState(state()), parseCuration(curation()))
    expect(result.topics.find(topic => topic.id === 't3')).toMatchObject({ title: '新帖（润色）', categoryId: 'c-school', tagIds: ['tag1', 'tag-notes'] })
    expect(result.tags.find(tag => tag.id === 'tag-notes')).toMatchObject({ slug: 'notes', name: '知识整理' })
    expect(result.categories.find(category => category.id === 'c3')).toMatchObject({ color: '#7c3aed', description: '写代码', name: 'AI Coding' })
    expect(result.posts.find(post => post.id === 'body-3')?.content).toBe('# 润色后的正文')
  })

  it('produces a state that still passes the snapshot validator', () => {
    const result = applyCuration(parseSnapshotState(state()), parseCuration(curation()))
    expect(() => parseSnapshotState(result)).not.toThrow()
  })

  it('does not mutate the input state', () => {
    const input = parseSnapshotState(state())
    const before = JSON.stringify(input)
    applyCuration(input, parseCuration(curation()))
    expect(JSON.stringify(input)).toBe(before)
  })

  it.each([
    ['unknown topic', { topics: { t9: { categoryId: 'c3' } } }],
    ['unknown target category', { topics: { t3: { categoryId: 'c9' } } }],
    ['unknown tag', { topics: { t3: { tagIds: ['tag9'] } } }],
    ['unknown post', { posts: { 'body-9': { content: 'x' } } }],
    ['unknown order entry', { categoryOrder: ['c9'] }],
    ['unknown patch target', { categoryPatches: { c9: { color: '#000000' } } }],
    ['category id collision', { categories: [{ id: 'c3', slug: 'dup', name: 'Dup', description: '', color: '#000000', icon: 'i-carbon-forum' }] }],
    ['tag slug collision', { tags: [{ id: 'tag-dup', slug: '顶', name: 'Dup', color: '#000000' }] }],
  ])('fails closed on %s', (_label, overrides) => {
    expect(() => applyCuration(parseSnapshotState(state()), parseCuration(curation(overrides)))).toThrow(SnapshotError)
  })
})
