import { describe, expect, it } from 'vitest'
import { createSeed } from '~/data/seed'
import { TOPIC_SEEDS, USER_SEEDS } from '~/data/seed-content'
import { parseState, serializeState } from '~/data/persist'
import curation from '../content/curation.json'
import { forumLlmsTxt, NO_TOPICS } from '../shared/forum-markdown'
import { emptyForumState } from '../shared/local-snapshot'
import { siteForumState } from '../shared/site-state'

// 极客班论坛 as the images build it: the curated categories and tags of
// content/curation.json and nothing else.
describe('siteForumState', () => {
  const state = siteForumState()

  it('lists the five curated categories in the sidebar order', () => {
    expect(state.categories.map(category => category.id)).toEqual(['c-announcements', 'c-courses', 'c-competitions', 'c-careers', 'c-ai'])
    expect(state.categories.map(category => category.name)).toEqual(['班级公告', '课程与作业', '竞赛与项目', '求职与升学', '人工智能'])
    const order = curation.categoryOrder.filter(id => curation.categories.some(category => category.id === id))
    expect(state.categories.map(category => category.id)).toEqual(order)
  })

  it('copies each category and tag with exactly the fields the store knows', () => {
    for (const category of state.categories)
      expect(Object.keys(category).sort()).toEqual(['color', 'description', 'icon', 'id', 'name', 'slug'])
    expect(state.tags).toEqual(curation.tags.map(({ id, slug, name, color }) => ({ id, slug, name, color })))
  })

  it('has no users, topics, posts, notifications, bookmarks or follows', () => {
    expect(state).toEqual({ ...emptyForumState(), counters: { ...emptyForumState().counters, tag: curation.tags.length }, categories: state.categories, tags: state.tags })
    expect(state.users).toEqual([])
    expect(state.topics).toEqual([])
    expect(state.posts).toEqual([])
    expect(state.notifications).toEqual([])
    expect(state.bookmarks).toEqual([])
    expect(state.follows).toEqual([])
  })

  it('carries nothing from the upstream demo seed', () => {
    // The curated 班级公告 happens to share the slug `announcements` with the
    // seed's 公告, so the comparison is by id and by name, not by slug.
    const seed = createSeed(0)
    const text = JSON.stringify(state)
    const ids = new Set([...state.categories, ...state.tags].map(item => item.id))
    const names = new Set([...state.categories, ...state.tags].map(item => item.name))
    for (const item of [...seed.categories, ...seed.tags]) {
      expect(ids.has(item.id)).toBe(false)
      expect(names.has(item.name)).toBe(false)
    }
    for (const topic of TOPIC_SEEDS)
      expect(text).not.toContain(topic.title)
    for (const user of USER_SEEDS)
      expect(text).not.toContain(`"${user.username}"`)
    expect(text).not.toMatch(/Tuff|CoreBox/i)
  })

  it('leaves the curated snapshot topics and posts out', () => {
    const text = JSON.stringify(state)
    for (const [id, topic] of Object.entries(curation.topics)) {
      expect(text).not.toContain(`"${id}"`)
      expect(text).not.toContain(topic.title)
    }
    for (const id of Object.keys(curation.posts))
      expect(text).not.toContain(id)
  })

  it('returns a fresh state on every call', () => {
    const a = siteForumState()
    a.categories[0]!.name = 'changed'
    a.tags.pop()
    expect(siteForumState().categories[0]!.name).toBe('班级公告')
    expect(siteForumState().tags).toHaveLength(curation.tags.length)
  })

  it('is a state the store can persist and read back', () => {
    expect(parseState(serializeState(state))).toEqual(state)
  })

  it('gives an llms.txt that names 极客班论坛 and says there are no topics yet', () => {
    const text = forumLlmsTxt(state, { siteName: '极客班论坛', origin: 'https://prev.example.test', basePath: '/forum/', notice: '发帖和回复还没开放。' })
    expect(text.split('\n')[0]).toBe('# 极客班论坛')
    expect(text).toContain(NO_TOPICS)
    expect(text).not.toContain('](')
    expect(text).not.toContain('## ')
  })
})
