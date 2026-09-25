import type { ForumState, Post, Topic, User } from '../app/data/types'
import { TOPIC_SEEDS } from '../app/data/seed-content'
import { postExcerpt } from '../app/utils/excerpt'

/**
 * Markdown views of the forum for AI readers: `/t/<id>.md` is one topic with
 * its replies, `/llms.txt` indexes every topic (https://llmstxt.org/).
 *
 * Pure and Nuxt-free like `local-snapshot.ts`: the server middleware hands in
 * the state its pages show (the demo seed, or the read-only snapshot on the
 * dev server) and the vitest suite hands in fabricated ones. Post bodies are
 * emitted verbatim, because they already are the Markdown `TxMarkdownView`
 * renders; only titles, names and summaries are escaped, since those are
 * plain text.
 */

export interface MarkdownSite {
  /** The llms.txt title. */
  siteName: string
  /** `https://yangtzeu.work` in a release build; `''` locally, which keeps every link site-relative. */
  origin: string
  /** Nuxt `app.baseURL`, always with a trailing slash: `/` locally, `/forum/` in the image. */
  basePath: string
  /** One sentence telling the reader where the content comes from. */
  notice: string
}

const UNKNOWN_USER = '未知用户'
const SUMMARY_LENGTH = 80
export const NO_TOPICS = '还没有话题。'

/** `t/<id>.md`, relative to the app base; the one place that spells the Markdown address. */
export function topicMarkdownPath(topicId: string): string {
  return `t/${encodeURIComponent(topicId)}.md`
}

/**
 * Ids of the topics every static build has Markdown for. `createSeed` numbers
 * topics `t1…tN` in `TOPIC_SEEDS` order (the tests pin the two together); a
 * topic written in the browser continues that counter and exists only in
 * that browser's storage.
 */
export function seedTopicIds(): string[] {
  return TOPIC_SEEDS.map((_, index) => `t${index + 1}`)
}

/** Prerender routes, relative to the app base, for `llms.txt` and every topic's Markdown. */
export function markdownPrerenderRoutes(topicIds: string[]): string[] {
  return ['/llms.txt', ...topicIds.map(id => `/${topicMarkdownPath(id)}`)]
}

/**
 * Titles, names and summaries are plain text; inside a heading or a link
 * label their Markdown punctuation must stay literal. Whitespace collapses so
 * a value can never open a block of its own.
 */
export function escapeInline(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\`*_[\]<~]/g, '\\$&')
    .replace(/&(?=#?\w+;)/g, '\\&')
}

/** Posts of a topic in the order the topic page numbers them (#1 is the first post). */
export function postsInFloorOrder(state: ForumState, topicId: string): Post[] {
  return state.posts
    .filter(post => post.topicId === topicId)
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** The topic as one Markdown document, or `null` when no such topic exists. */
export function topicMarkdown(state: ForumState, topicId: string, site: MarkdownSite): string | null {
  const topic = state.topics.find(candidate => candidate.id === topicId)
  if (!topic)
    return null

  const users = new Map(state.users.map(user => [user.id, user]))
  const posts = postsInFloorOrder(state, topic.id)
  const floors = new Map(posts.map((post, index) => [post.id, index + 1]))
  const [first, ...replies] = posts
  const author = users.get(topic.authorId)
  const category = state.categories.find(candidate => candidate.id === topic.categoryId)
  const tags = topic.tagIds
    .map(id => state.tags.find(tag => tag.id === id)?.name)
    .filter((name): name is string => name !== undefined)

  // YAML front matter. JSON strings and arrays are valid YAML flow scalars,
  // so quotes, backslashes and newlines in a title cannot break the header.
  const lines = [
    '---',
    `title: ${JSON.stringify(topic.title)}`,
    `category: ${JSON.stringify(category?.name ?? '')}`,
    `author: ${JSON.stringify(author?.displayName ?? UNKNOWN_USER)}`,
    `author_username: ${JSON.stringify(author?.username ?? '')}`,
    `created: ${JSON.stringify(isoTime(topic.createdAt))}`,
    ...(tags.length > 0 ? [`tags: ${JSON.stringify(tags)}`] : []),
    `replies: ${replies.filter(post => !post.deleted).length}`,
    `url: ${JSON.stringify(siteUrl(site, `t/${encodeURIComponent(topic.id)}`))}`,
    '---',
    '',
    `# ${escapeInline(topic.title)}`,
    '',
    first ? postBody(first) : '（正文缺失）',
    '',
    '## 回复',
    '',
  ]

  if (replies.length === 0)
    lines.push('暂无回复。', '')

  for (const reply of replies) {
    lines.push(`### #${floors.get(reply.id)} ${byline(users.get(reply.authorId))} · ${isoTime(reply.createdAt)}`, '')
    const target = reply.replyToPostId ? state.posts.find(post => post.id === reply.replyToPostId) : undefined
    if (target && floors.has(target.id))
      lines.push(`回复 #${floors.get(target.id)} ${byline(users.get(target.authorId))}`, '')
    lines.push(postBody(reply), '')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * The llms.txt index: title, a one-paragraph summary, then one H2 section per
 * category holding nothing but its topic links, which is the shape llms.txt
 * readers parse. A forum without topics (极客班论坛 before posting opens)
 * says so in one line instead of leaving the reader with a bare header.
 */
export function forumLlmsTxt(state: ForumState, site: MarkdownSite): string {
  const lines = [
    `# ${escapeInline(site.siteName)}`,
    '',
    `> ${escapeInline(site.siteName)} 的话题索引。每个话题都有一份 Markdown 原文，地址是话题页地址后面加 .md，内容依次是标题、分类、作者、发帖时间、首帖正文和按楼层排列的回复。${site.notice}`,
    '',
  ]

  if (state.topics.length === 0)
    lines.push(NO_TOPICS, '')

  for (const category of state.categories) {
    const topics = state.topics
      .filter(topic => topic.categoryId === category.id)
      .sort(listOrder)
    if (topics.length === 0)
      continue
    lines.push(`## ${escapeInline(category.name)}`, '')
    for (const topic of topics) {
      const first = postsInFloorOrder(state, topic.id)[0]
      const summary = first && !first.deleted ? escapeInline(postExcerpt(first.content, SUMMARY_LENGTH)) : ''
      const link = `[${escapeInline(topic.title)}](${siteUrl(site, topicMarkdownPath(topic.id))})`
      lines.push(summary ? `- ${link}: ${summary}` : `- ${link}`)
    }
    lines.push('')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/** Pinned first, then newest first; the id breaks ties so the file is stable. */
function listOrder(a: Topic, b: Topic): number {
  return Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt || a.id.localeCompare(b.id)
}

function siteUrl(site: MarkdownSite, path: string): string {
  return `${site.origin}${site.basePath}${path}`
}

function byline(user: User | undefined): string {
  return user ? `${escapeInline(user.displayName)} (@${escapeInline(user.username)})` : UNKNOWN_USER
}

/**
 * The source as written. Only blank lines before it and trailing whitespace
 * are dropped: leading spaces on the first line may be an indented code block.
 */
function postBody(post: Post): string {
  if (post.deleted)
    return '（此帖已被删除）'
  return post.content.replace(/^(?:[ \t]*\n)+/, '').trimEnd() || '（空）'
}

function isoTime(at: number): string {
  return new Date(at).toISOString()
}
