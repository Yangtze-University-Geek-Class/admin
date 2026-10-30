import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSeed } from '~/data/seed'
import { TOPIC_SEEDS, USER_SEEDS } from '~/data/seed-content'
import { parseState, serializeState } from '~/data/persist'
import curation from '../content/curation.json'
import manifest from '../content/published/manifest.json'
import published from '../content/published/topics.json'
import { forumLlmsTxt, topicMarkdown } from '../shared/forum-markdown'
import { parseSnapshotState } from '../shared/local-snapshot'
import { publishedForumState, publishedTopicIds } from '../shared/published'
import { SITE_NOTICE, siteMarkdownNotice } from '../shared/site-notice'
import { siteForumState } from '../shared/site-state'
import { STATIC_CDN_PREFIX } from '../shared/sticker-url'

// Source publication stays testable, but the deployed site bootstrap is empty:
// core is the only authority that may project these records to a viewer.
describe('siteForumState', () => {
  const state = publishedForumState()
  const bootstrap = siteForumState()

  it('keeps the complete curated catalogue separate: 使用说明 is third and no legacy category is added', () => {
    expect(curation.categories.map(({ id, name }) => [id, name])).toEqual([
      ['c-exam', '招新与机试'], ['c-announcements', '班级公告'], ['c-guides', '使用说明'],
      ['c-courses', '课程与作业'], ['c-competitions', '竞赛与项目'], ['c-careers', '求职与升学'], ['c-ai', '人工智能'],
    ])
    expect(curation.categoryOrder.filter(id => curation.categories.some(category => category.id === id)))
      .toEqual(['c-exam', 'c-announcements', 'c-guides', 'c-courses', 'c-competitions', 'c-careers', 'c-ai'])
    expect(new Set(curation.categories.map(category => category.id)).size).toBe(7)
    expect(new Set(curation.categories.map(category => category.slug)).size).toBe(7)
  })

  it('boots the site with no categories, topics, bodies or personal references', () => {
    expect(bootstrap).toEqual({
      version: 1,
      seededAt: 0,
      counters: { topic: 0, post: 0, notification: 0, tag: 0 },
      users: [], categories: [], tags: [], topics: [], posts: [], notifications: [], bookmarks: [], follows: [],
    })
  })

  it('copies each category and tag with exactly the fields the store knows', () => {
    for (const category of state.categories)
      expect(Object.keys(category).sort()).toEqual(['color', 'description', 'icon', 'id', 'name', 'slug'])
    expect(state.tags).toEqual(curation.tags.map(({ id, slug, name, color }) => ({ id, slug, name, color })))
  })

  it('publishes the exam documents (#87) and the posts written on the current forum (#108) under the 极客班 account, one opening post each', () => {
    const exam = ['t73', 't72', 't71', 't9', 't35', 't6', 't7', 't8', 't10', 't11', 't12', 't13', 't16', 't25']
    expect(state.topics.map(topic => topic.id)).toEqual([...exam, 't78', 't84', 't89'])
    expect(publishedTopicIds()).toEqual(state.topics.map(topic => topic.id))
    expect(state.users.map(user => [user.id, user.username, user.displayName])).toEqual([['u-geekclass', 'geekclass', '极客班']])
    for (const topic of state.topics) {
      expect(topic.authorId).toBe('u-geekclass')
      expect(topic.categoryId).toBe(exam.includes(topic.id) ? 'c-exam' : 'c-ai')
      expect(topic.closed).toBe(false)
      expect(state.posts.filter(post => post.topicId === topic.id)).toHaveLength(1)
      // By the convention of #57 (PR #116, in effect once merged) the backend seeds these by id
      // and numbers its own topics from t1001.
      expect(Number(topic.id.slice(1))).toBeLessThan(1000)
    }
    expect(state.topics.filter(topic => topic.pinned).map(topic => topic.id)).toEqual(['t73', 't9'])
    const tagged = (tag: string) => state.topics.filter(topic => topic.tagIds.includes(tag)).map(topic => topic.id)
    expect(tagged('tag-grade25')).toEqual(['t73', 't72', 't71'])
    expect(tagged('tag-grade24')).toEqual(['t9', 't35'])
    expect(tagged('tag-starter')).toEqual(['t6', 't7', 't8', 't10', 't11', 't12', 't13', 't16', 't25'])
    expect(tagged('tag-workflow')).toEqual(['t78'])
    expect(tagged('tag-talk')).toEqual(['t78'])
    expect(tagged('tag-coding')).toEqual(['t84', 't89'])
    expect(tagged('tag-notes')).toEqual(['t84'])
    expect(tagged('tag-agents')).toEqual(['t89'])
    // The source export itself has one opening post per topic and no private lists.
    expect(state.posts).toHaveLength(state.topics.length)
    expect(state.notifications).toEqual([])
    expect(state.bookmarks).toEqual([])
    expect(state.follows).toEqual([])
    // Ids and references hold together the way the pages expect.
    expect(() => parseSnapshotState(JSON.parse(JSON.stringify(state)))).not.toThrow()
    expect(state.counters).toEqual({ topic: 89, post: 17, notification: 0, tag: curation.tags.length })
  })

  it('keeps withheld topics, logins and e-mail addresses out of the published text', () => {
    const text = JSON.stringify(published)
    for (const id of manifest.withheld) {
      expect(state.topics.some(topic => topic.id === id)).toBe(false)
      expect(text).not.toMatch(new RegExp(`\\]\\(\\./${id}\\)`))
    }
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/)
    expect(text).not.toMatch(/(?:账户|账号)\s*\**\s*[:：]/)
    // Keys are looked for in the raw strings: in the JSON text a key on its own line follows a
    // literal `\n`, and `\b` sees no boundary between that `n` and `sk-`. Same rule as the image build.
    const bodies = published.topics.map(topic => `${topic.title}\n${topic.content}`).join('\n')
    expect(bodies).not.toMatch(/(?:^|[^\w-])sk-[\w-]{20,}/m)
    expect(text).not.toContain('/api/local-forum/')
    expect(text).not.toContain('yangtzeu.work/forum/archive')
    expect(text).toContain('共享账户找班长要')
    // Review of #87: sharer-tracking parameters, the proxy heading and the screenshots with names are gone.
    expect(text).not.toMatch(/vd_source|sharer_shareinfo|代理配置/)
    expect(text).toContain('这张截图没有公开')
    // Review of #108: the third-party API key in t89 is not published, and the text says whom to ask.
    expect(text).toContain('（公益密钥没有公开，需要的话在帖子下面问，或者找极客班管理员）')
  })

  it('ships the images of t84 instead of linking the image host that refuses other sites (#108)', () => {
    const t84 = state.posts.find(post => post.topicId === 't84')!.content!
    expect(t84.match(/!\[[^\]\n]*\]\(\.\.\/published\/[a-f0-9]{16}\.webp\)/g)).toHaveLength(8)
    expect(t84).not.toContain('gitee.com')
    // The lecture link had raw spaces, which Markdown does not take as a link target.
    expect(t84).toMatch(/\]\(https:\/\/cloud\.tsinghua\.edu\.cn\/d\/[^)\s]+coding\.pdf\)/)
  })


  it('publishes every allowed Ali OSS image from the Garage CDN, never the dropped screenshots (#304)', () => {
    const rules = manifest.images.filter(image => image.cdn)
    expect(rules).toHaveLength(56)
    expect(rules.every(image => image.source.includes('luoxi2334.oss-cn-shanghai.aliyuncs.com') && /^[a-f0-9]{64}$/.test(image.sha256 ?? ''))).toBe(true)
    expect(manifest.images.filter(image => image.drop)).toHaveLength(8)
    const text = JSON.stringify(published)
    expect(text).not.toContain('luoxi2334.oss-cn-shanghai.aliyuncs.com')
    const names = new Set<string>()
    for (const match of text.matchAll(new RegExp(`${STATIC_CDN_PREFIX.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}forum/published/([a-f0-9]{16}\\.webp)`, 'g'))) {
      names.add(match[1]!)
      expect(existsSync(new URL(`../public/published/${match[1]}`, import.meta.url)), match[1]).toBe(true)
    }
    expect(names.size).toBe(56)
  })
  it('links only to published topics and to images that ship with the forum', () => {
    const ids = new Set(publishedTopicIds())
    for (const post of state.posts) {
      for (const [, id] of (post.content ?? '').matchAll(/\]\(\.\/(t\d+)\)/g))
        expect(ids.has(id!), `${post.topicId} → ${id}`).toBe(true)
      for (const [, name] of (post.content ?? '').matchAll(/\]\(\.\.\/published\/([^)]+)\)/g))
        expect(existsSync(new URL(`../public/published/${name}`, import.meta.url)), `${post.topicId} → ${name}`).toBe(true)
      // Links back into the old forum's absolute paths would leave the /forum/ base.
      expect(post.content ?? '').not.toMatch(/\]\(\/(?:t|c|u)\//)
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

  it('leaves the curated snapshot titles and rewritten posts out', () => {
    // t78, t84 and t89 are also curated for the local snapshot mode, where t78 and t84 get a new
    // title and a rewritten body. The site publishes the authors' own text from topics.json.
    const text = JSON.stringify(state)
    const published = new Set(publishedTopicIds())
    for (const [id, topic] of Object.entries(curation.topics)) {
      if (!published.has(id))
        expect(text).not.toContain(`"${id}"`)
      if ('title' in topic)
        expect(text).not.toContain(topic.title)
    }
    for (const [id, patch] of Object.entries(curation.posts)) {
      const rewritten = readFileSync(new URL(`../content/${patch.contentFile}`, import.meta.url), 'utf8')
      // The first paragraph after the heading differs in every rewrite; neither it nor the whole file ships.
      const opening = rewritten.split('\n\n')[1]!
      expect(opening.length).toBeGreaterThan(20)
      expect(text).not.toContain(JSON.stringify(opening).slice(1, -1))
      expect(state.posts.some(post => post.id === id && post.content === rewritten)).toBe(false)
    }
  })

  it('returns a fresh state on every call', () => {
    const a = siteForumState()
    a.counters.topic = 99
    a.categories.push({ id: 'x', slug: 'x', name: 'x', description: '', color: '#000000', icon: 'i-carbon-forum' })
    expect(siteForumState()).toEqual(bootstrap)
  })

  it('is a state the store can persist and read back', () => {
    expect(parseState(serializeState(bootstrap))).toEqual(bootstrap)
  })

  it('keeps the source projection renderable for deterministic export checks without using it as the site response', () => {
    const site = { siteName: '极客班论坛', origin: 'https://prev.example.test', basePath: '/forum/', notice: siteMarkdownNotice() }
    const text = forumLlmsTxt(state, site)
    expect(text.split('\n')[0]).toBe('# 极客班论坛')
    expect(text).toContain('极客班25级机试考核文档')
    expect(text).toContain('https://prev.example.test/forum/t/t73.md')
    expect(text).toContain('- [国内 Agent 工具安装指南](https://prev.example.test/forum/t/t89.md)')
    expect(text).toContain('https://prev.example.test/forum/t/t78.md')
    expect(text).toContain('https://prev.example.test/forum/t/t84.md')
    const twin = topicMarkdown(state, 't73', site)
    expect(twin).toContain('极客班')
    expect(twin).toContain('](./t9)')
    expect(topicMarkdown(state, 't5', site)).toBeNull()
  })

  it('says the same current state in llms.txt as the banner, without naming which posts are out', () => {
    const text = forumLlmsTxt(state, { siteName: '极客班论坛', origin: '', basePath: '/forum/', notice: siteMarkdownNotice() })
    expect(text).toContain(SITE_NOTICE.published)
    expect(text).toContain(SITE_NOTICE.guests)
    for (const sentence of Object.values(SITE_NOTICE)) {
      expect(sentence).not.toMatch(/招新|入门资料|人工智能|AI|暂时不显示|还没开放/)
    }
  })
})
