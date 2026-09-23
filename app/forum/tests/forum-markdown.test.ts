import type { ForumState, Post } from '~/data/types'
import type { MarkdownSite } from '../shared/forum-markdown'
import { describe, expect, it } from 'vitest'
import { createSeed } from '~/data/seed'
import {
  escapeInline,
  forumLlmsTxt,
  markdownPrerenderRoutes,
  postsInFloorOrder,
  seedTopicIds,
  topicMarkdown,
  topicMarkdownPath,
} from '../shared/forum-markdown'

// Fabricated fixture; the seed only appears where the build contract is about the seed.
const AT = Date.UTC(2026, 8, 24, 8, 0, 0)
const MINUTE = 60_000

const SITE: MarkdownSite = { siteName: '测试论坛', origin: 'https://example.test', basePath: '/forum/', notice: '这是夹具。' }
const LOCAL: MarkdownSite = { ...SITE, origin: '', basePath: '/' }

const CODE_BODY = [
  '先看配置：',
  '',
  '```ts',
  'const a = `x` * 2 // <b> & [link](y)',
  '# not a heading',
  '```',
  '',
  '    indented code stays indented',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
].join('\n')

function user(id: string, username: string, displayName: string) {
  return { id, username, displayName, bio: '', location: '', website: '', avatarColor: '#123456', joinedAt: 0, role: 'member' as const, notifyPrefs: { reply: true, like: true, follow: true } }
}

function post(id: string, topicId: string, authorId: string, minutes: number, content: string, extra: Partial<Post> = {}): Post {
  return { id, topicId, authorId, content, createdAt: AT + minutes * MINUTE, likeUserIds: [], ...extra }
}

function fixture(): ForumState {
  return {
    version: 1,
    seededAt: AT,
    counters: { topic: 3, post: 6, notification: 0, tag: 2 },
    users: [user('u1', 'alpha', '甲'), user('u2', 'beta_2', 'B*eta [dev]')],
    categories: [
      { id: 'c1', slug: 'help', name: '求助', description: '提问的地方', color: '#000000', icon: 'i-carbon-help' },
      { id: 'c2', slug: 'empty', name: '空分类', description: '', color: '#000000', icon: 'i-carbon-folder' },
      { id: 'c3', slug: 'news', name: '公告 & 动态', description: '', color: '#000000', icon: 'i-carbon-bullhorn' },
    ],
    tags: [{ id: 'tag1', slug: 'macos', name: 'macOS', color: '#000000' }, { id: 'tag2', slug: 'q', name: '提问', color: '#000000' }],
    topics: [
      { id: 't1', slug: 'topic-1', title: 'Cmd+E 在 *全屏* 下 [无效] "引号" \\ 反斜杠', categoryId: 'c1', tagIds: ['tag1', 'tag2'], authorId: 'u1', createdAt: AT, lastActivityAt: AT + 30 * MINUTE, views: 1, pinned: false, closed: false },
      { id: 't2', slug: 'topic-2', title: '没有回复的话题', categoryId: 'c3', tagIds: [], authorId: 'u2', createdAt: AT + 60 * MINUTE, lastActivityAt: AT + 60 * MINUTE, views: 1, pinned: false, closed: false },
      { id: 't3', slug: 'topic-3', title: '置顶公告', categoryId: 'c3', tagIds: [], authorId: 'u1', createdAt: AT - 60 * MINUTE, lastActivityAt: AT - 60 * MINUTE, views: 1, pinned: true, closed: false },
    ],
    // Stored out of order on purpose: the floor order comes from createdAt.
    posts: [
      post('p4', 't1', 'u1', 30, '第三楼，回复二楼'),
      post('p1', 't1', 'u1', 0, CODE_BODY),
      post('p3', 't1', 'u2', 20, '', { deleted: true }),
      post('p2', 't1', 'u2', 10, '二楼：试试 `defaults write`'),
      post('p5', 't2', 'u2', 60, '\n\n正文前面有空行  \n'),
      post('p6', 't3', 'u1', -60, '**维护通知**：周六停机两小时。'),
    ],
    notifications: [],
    bookmarks: [],
    follows: [],
  }
}

function withReplyTo(state: ForumState): ForumState {
  return { ...state, posts: state.posts.map(entry => (entry.id === 'p4' ? { ...entry, replyToPostId: 'p2' } : entry)) }
}

function frontMatter(markdown: string): Record<string, string> {
  const [, header = ''] = /^---\n([\s\S]*?)\n---\n/.exec(markdown) ?? []
  return Object.fromEntries(header.split('\n').map((line) => {
    const at = line.indexOf(': ')
    return [line.slice(0, at), line.slice(at + 2)]
  }))
}

describe('escapeInline', () => {
  it('keeps Markdown punctuation literal and collapses newlines', () => {
    expect(escapeInline('a *b* _c_ `d` [e](f) <g> ~h~ \\')).toBe('a \\*b\\* \\_c\\_ \\`d\\` \\[e\\](f) \\<g> \\~h\\~ \\\\')
    expect(escapeInline('第一行\n# 第二行\n\n- 第三行')).toBe('第一行 # 第二行 - 第三行')
    expect(escapeInline('a &amp; b & c')).toBe('a \\&amp; b & c')
  })
})

describe('topicMarkdown', () => {
  const state = withReplyTo(fixture())
  const markdown = topicMarkdown(state, 't1', SITE) as string

  it('returns null for an unknown topic', () => {
    expect(topicMarkdown(state, 'nope', SITE)).toBeNull()
  })

  it('opens with a front matter whose values survive quotes and backslashes', () => {
    const header = frontMatter(markdown)
    expect(JSON.parse(header.title as string)).toBe(state.topics[0]?.title)
    expect(JSON.parse(header.category as string)).toBe('求助')
    expect(JSON.parse(header.author as string)).toBe('甲')
    expect(JSON.parse(header.author_username as string)).toBe('alpha')
    expect(JSON.parse(header.created as string)).toBe('2026-09-24T08:00:00.000Z')
    expect(JSON.parse(header.tags as string)).toEqual(['macOS', '提问'])
    expect(header.replies).toBe('2')
    expect(JSON.parse(header.url as string)).toBe('https://example.test/forum/t/t1')
  })

  it('escapes the title heading', () => {
    expect(markdown).toContain('\n# Cmd+E 在 \\*全屏\\* 下 \\[无效\\] "引号" \\\\ 反斜杠\n')
  })

  it('keeps the first post source verbatim, code fences and indentation included', () => {
    expect(markdown).toContain(`\n\n${CODE_BODY}\n\n## 回复\n`)
  })

  it('lists replies in floor order with author, time and reply target', () => {
    const headings = markdown.split('\n').filter(line => line.startsWith('### '))
    expect(headings).toEqual([
      '### #2 B\\*eta \\[dev\\] (@beta\\_2) · 2026-09-24T08:10:00.000Z',
      '### #3 B\\*eta \\[dev\\] (@beta\\_2) · 2026-09-24T08:20:00.000Z',
      '### #4 甲 (@alpha) · 2026-09-24T08:30:00.000Z',
    ])
    expect(markdown).toContain('二楼：试试 `defaults write`')
    expect(markdown).toContain('（此帖已被删除）')
    expect(markdown).toContain('回复 #2 B\\*eta \\[dev\\] (@beta\\_2)\n\n第三楼，回复二楼')
    expect(markdown.endsWith('第三楼，回复二楼\n')).toBe(true)
  })

  it('says so when a topic has no replies, and omits tags it does not have', () => {
    const empty = topicMarkdown(state, 't2', LOCAL) as string
    const header = frontMatter(empty)
    expect(header.tags).toBeUndefined()
    expect(header.replies).toBe('0')
    expect(JSON.parse(header.url as string)).toBe('/t/t2')
    expect(empty).toContain('\n# 没有回复的话题\n\n正文前面有空行\n\n## 回复\n\n暂无回复。\n')
    expect(empty).not.toContain('### ')
  })

  it('agrees with postsInFloorOrder', () => {
    expect(postsInFloorOrder(state, 't1').map(entry => entry.id)).toEqual(['p1', 'p2', 'p3', 'p4'])
  })
})

describe('forumLlmsTxt', () => {
  const state = fixture()
  const text = forumLlmsTxt(state, SITE)
  const lines = text.split('\n')

  it('starts with the title and a one-paragraph summary', () => {
    expect(lines[0]).toBe('# 测试论坛')
    expect(lines[1]).toBe('')
    expect(lines[2]).toMatch(/^> 测试论坛 的话题索引。.*这是夹具。$/)
  })

  it('has one section per non-empty category, holding only topic links', () => {
    expect(lines.filter(line => line.startsWith('## '))).toEqual(['## 求助', '## 公告 & 动态'])
    const body = lines.slice(4).filter(line => line && !line.startsWith('## '))
    expect(body.every(line => line.startsWith('- ['))).toBe(true)
  })

  it('links each topic to its absolute .md address with an escaped title and a plain summary', () => {
    expect(text).toContain('- [Cmd+E 在 \\*全屏\\* 下 \\[无效\\] "引号" \\\\ 反斜杠](https://example.test/forum/t/t1.md): 先看配置： indented code stays indented')
    // Pinned first, then newest first.
    const news = lines.slice(lines.indexOf('## 公告 & 动态'))
    expect(news[2]).toBe('- [置顶公告](https://example.test/forum/t/t3.md): 维护通知：周六停机两小时。')
    expect(news[3]).toBe('- [没有回复的话题](https://example.test/forum/t/t2.md): 正文前面有空行')
  })

  it('stays site-relative without an origin', () => {
    expect(forumLlmsTxt(state, LOCAL)).toContain('](/t/t2.md)')
  })
})

describe('static build contract', () => {
  const seed = createSeed(1_780_000_000_000)

  it('prerenders llms.txt and a .md for exactly the seed topics', () => {
    expect(seedTopicIds()).toEqual(seed.topics.map(topic => topic.id))
    expect(markdownPrerenderRoutes(seedTopicIds())).toEqual(['/llms.txt', ...seed.topics.map(topic => `/t/${topic.id}.md`)])
    expect(topicMarkdownPath('t1')).toBe('t/t1.md')
  })

  it('renders every seed topic and lists each one in llms.txt', () => {
    const site = { ...LOCAL, notice: '' }
    const index = forumLlmsTxt(seed, site)
    for (const topic of seed.topics) {
      expect(topicMarkdown(seed, topic.id, site)).toContain(`url: "/t/${topic.id}"`)
      expect(index).toContain(`](/t/${topic.id}.md)`)
    }
  })
})
