import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSeed } from '~/data/seed'
import { TOPIC_SEEDS, USER_SEEDS } from '~/data/seed-content'
import { parseState, serializeState } from '~/data/persist'
import curation from '../content/curation.json'
import manifest from '../content/published/manifest.json'
import published from '../content/published/topics.json'
import { forumLlmsTxt, topicMarkdown } from '../shared/forum-markdown'
import { parseSnapshotState } from '../shared/local-snapshot'
import { publishedTopicIds } from '../shared/published'
import { siteForumState } from '../shared/site-state'

// 极客班论坛 as the images build it: the curated categories and tags of
// content/curation.json, and the old-forum documents of content/published.
describe('siteForumState', () => {
  const state = siteForumState()

  it('lists the six curated categories in the sidebar order, 招新与机试 first', () => {
    expect(state.categories.map(category => category.id)).toEqual(['c-exam', 'c-announcements', 'c-courses', 'c-competitions', 'c-careers', 'c-ai'])
    expect(state.categories.map(category => category.name)).toEqual(['招新与机试', '班级公告', '课程与作业', '竞赛与项目', '求职与升学', '人工智能'])
    const order = curation.categoryOrder.filter(id => curation.categories.some(category => category.id === id))
    expect(state.categories.map(category => category.id)).toEqual(order)
  })

  it('copies each category and tag with exactly the fields the store knows', () => {
    for (const category of state.categories)
      expect(Object.keys(category).sort()).toEqual(['color', 'description', 'icon', 'id', 'name', 'slug'])
    expect(state.tags).toEqual(curation.tags.map(({ id, slug, name, color }) => ({ id, slug, name, color })))
  })

  it('publishes the 14 exam and starter documents under the 极客班 account, one opening post each', () => {
    expect(state.topics.map(topic => topic.id)).toEqual(['t73', 't72', 't71', 't9', 't35', 't6', 't7', 't8', 't10', 't11', 't12', 't13', 't16', 't25'])
    expect(publishedTopicIds()).toEqual(state.topics.map(topic => topic.id))
    expect(state.users.map(user => [user.id, user.username, user.displayName])).toEqual([['u-geekclass', 'geekclass', '极客班']])
    for (const topic of state.topics) {
      expect(topic.authorId).toBe('u-geekclass')
      expect(topic.categoryId).toBe('c-exam')
      expect(topic.closed).toBe(false)
      expect(state.posts.filter(post => post.topicId === topic.id)).toHaveLength(1)
    }
    expect(state.topics.filter(topic => topic.pinned).map(topic => topic.id)).toEqual(['t73', 't9'])
    const tagged = (tag: string) => state.topics.filter(topic => topic.tagIds.includes(tag)).map(topic => topic.id)
    expect(tagged('tag-grade25')).toEqual(['t73', 't72', 't71'])
    expect(tagged('tag-grade24')).toEqual(['t9', 't35'])
    expect(tagged('tag-starter')).toEqual(['t6', 't7', 't8', 't10', 't11', 't12', 't13', 't16', 't25'])
    // No replies, notifications, bookmarks or follows until the forum has a backend.
    expect(state.posts).toHaveLength(state.topics.length)
    expect(state.notifications).toEqual([])
    expect(state.bookmarks).toEqual([])
    expect(state.follows).toEqual([])
    // Ids and references hold together the way the pages expect.
    expect(() => parseSnapshotState(JSON.parse(JSON.stringify(state)))).not.toThrow()
    expect(state.counters).toEqual({ topic: 73, post: 14, notification: 0, tag: curation.tags.length })
  })

  it('keeps withheld topics, logins and e-mail addresses out of the published text', () => {
    const text = JSON.stringify(published)
    for (const id of manifest.withheld) {
      expect(state.topics.some(topic => topic.id === id)).toBe(false)
      expect(text).not.toMatch(new RegExp(`\\]\\(\\./${id}\\)`))
    }
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    expect(text).not.toMatch(/(?:账户|账号)\s*\**\s*[:：]/)
    expect(text).not.toContain('/api/local-forum/')
    expect(text).not.toContain('yangtzeu.work/forum/archive')
    expect(text).toContain('共享账户找班长要')
    // Review of #87: sharer-tracking parameters, the proxy heading and the screenshots with names are gone.
    expect(text).not.toMatch(/vd_source|sharer_shareinfo|代理配置/)
    expect(text).toContain('这张截图没有公开')
  })

  it('links only to published topics and to images that ship with the forum', () => {
    const ids = new Set(publishedTopicIds())
    for (const post of state.posts) {
      for (const [, id] of post.content.matchAll(/\]\(\.\/(t\d+)\)/g))
        expect(ids.has(id!), `${post.topicId} → ${id}`).toBe(true)
      for (const [, name] of post.content.matchAll(/\]\(\.\.\/published\/([^)]+)\)/g))
        expect(existsSync(new URL(`../public/published/${name}`, import.meta.url)), `${post.topicId} → ${name}`).toBe(true)
      // Links back into the old forum's absolute paths would leave the /forum/ base.
      expect(post.content).not.toMatch(/\]\(\/(?:t|c|u)\//)
    }
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
    a.topics[0]!.tagIds.push('changed')
    a.posts[0]!.content = 'changed'
    expect(siteForumState().categories[0]!.name).toBe('招新与机试')
    expect(siteForumState().tags).toHaveLength(curation.tags.length)
    expect(siteForumState().topics[0]!.tagIds).toEqual(['tag-grade25'])
    expect(siteForumState().posts[0]!.content).toBe(published.topics[0]!.content)
  })

  it('is a state the store can persist and read back', () => {
    expect(parseState(serializeState(state))).toEqual(state)
  })

  it('gives an llms.txt and Markdown twins that name 极客班论坛 and its published documents', () => {
    const site = { siteName: '极客班论坛', origin: 'https://prev.example.test', basePath: '/forum/', notice: '发帖和回复还没开放。' }
    const text = forumLlmsTxt(state, site)
    expect(text.split('\n')[0]).toBe('# 极客班论坛')
    expect(text).toContain('极客班25级机试考核文档')
    expect(text).toContain('https://prev.example.test/forum/t/t73.md')
    const twin = topicMarkdown(state, 't73', site)
    expect(twin).toContain('极客班')
    expect(twin).toContain('](./t9)')
    expect(topicMarkdown(state, 't5', site)).toBeNull()
  })
})
