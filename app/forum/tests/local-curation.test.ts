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
    legacy: { mode: 'archive', include: [] },
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
    ['legacy mode', { legacy: { mode: 'delete' } }],
    ['legacy include id', { legacy: { mode: 'hide', include: ['T 1'] } }],
  ])('rejects a bad %s', (_label, overrides) => {
    expect(() => parseCuration(curation(overrides))).toThrow(SnapshotError)
  })
})

describe('applyCuration: legacy.mode = hide（默认）', () => {
  const hide = (include: string[] = []) => curation({ legacy: { mode: 'hide', include }, categoryOrder: ['c-school', 'c3', 'c-archive'] })

  it('没写 legacy 时默认 hide', () => {
    const { legacy: _legacy, ...rest } = curation()
    expect(parseCuration(rest).legacy).toEqual({ mode: 'hide', include: [] })
  })

  it('旧帖、旧回复、老帖归档类别、旧分类标签都不出现，只留新内容', () => {
    const result = applyCuration(parseSnapshotState(state()), parseCuration(hide()))
    expect(result.topics.map(topic => topic.id)).toEqual(['t3'])
    expect(result.posts.map(post => post.id)).toEqual(['body-3'])
    expect(result.categories.map(category => category.id)).toEqual(['c-school', 'c3'])
    expect(result.categories.some(category => category.name === '老帖归档')).toBe(false)
    expect(result.tags.some(tag => tag.id.startsWith('legacy-'))).toBe(false)
    // tag1 只被旧帖 t2 用过，但 t3 的补丁又加上了它，所以保留；没人用的标签会被去掉
    expect(result.tags.map(tag => tag.id).sort()).toEqual(['tag-notes', 'tag1'].sort())
    expect(() => parseSnapshotState(result)).not.toThrow()
  })

  it('只出现在旧帖里的账号不再列出', () => {
    const input = state()
    input.users.push({ id: 'u2', username: 'beta', displayName: '乙', bio: '', location: '', website: '', avatarColor: '#654321', joinedAt: 2, role: 'member', notifyPrefs: { reply: true, like: true, follow: true } } as never)
    input.posts.push({ id: 'p9', topicId: 't1', authorId: 'u2', content: '旧回复', createdAt: 13, isTopicBody: false, likeUserIds: [] } as never)
    const result = applyCuration(parseSnapshotState(input), parseCuration(hide()))
    expect(result.users.map(user => user.id)).toEqual(['u1'])
  })

  it('开启名单里的旧帖按普通话题显示，可以放进新类别，其余仍隐藏', () => {
    const doc = hide(['t2'])
    ;(doc.topics as Record<string, unknown>).t2 = { categoryId: 'c-school' }
    const result = applyCuration(parseSnapshotState(state()), parseCuration(doc))
    expect(result.topics.map(topic => topic.id).sort()).toEqual(['t2', 't3'])
    const opened = result.topics.find(topic => topic.id === 't2') as unknown as Record<string, unknown>
    expect(opened).toMatchObject({ categoryId: 'c-school', pinned: false })
    expect(opened.archived).toBeUndefined()
    expect(result.posts.map(post => post.id).sort()).toEqual(['body-2', 'body-3'])
  })

  it('开启名单写了不存在的话题：加载失败，不静默忽略', () => {
    expect(() => applyCuration(parseSnapshotState(state()), parseCuration(hide(['t99'])))).toThrow(SnapshotError)
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
