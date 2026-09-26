import type { Component } from 'vue'
import type { Post, Topic, User } from '~/data/types'
import type { TestNode } from './support/sfc'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import * as likes from '~/data/likes'
import * as forumServer from '~/stores/forum-server'
import * as forumApi from '../shared/forum-api'
import * as postMarkdown from '../shared/post-markdown'
import { find, findAll, loadComponent, mount, textOf } from './support/sfc'
import { loadMarked, TUFFEX_STUBS } from './support/tuffex-stubs'

/**
 * #145 in the components: what a post card and the reply drawer do while a
 * write is out and after the server refused it. The writes are stubbed (the
 * write path itself is tests/forum-optimistic.test.ts); the reply drawer keeps
 * the real server store, which holds the refused replies.
 */
const { quoteDraft } = postMarkdown

const member: User = { id: 'u1', username: 'alpha', displayName: '甲', bio: '', location: '', website: '', avatarColor: '#123456', joinedAt: 0, role: 'member', notifyPrefs: { reply: true, like: true, follow: true } }
const topic: Topic = { id: 't1', slug: 'topic-1', title: '话题', categoryId: 'c1', tagIds: [], authorId: 'u1', createdAt: 0, lastActivityAt: 0, views: 1, pinned: false, closed: false }

let components: Record<string, Component>

beforeAll(async () => {
  await loadMarked()
  const ForumMarkdown = loadComponent('components/ForumMarkdown.vue', { imports: { '../../shared/post-markdown': postMarkdown } })
  const PostEditor = loadComponent('components/PostEditor.vue')
  const stub = defineComponent({ setup: () => () => h('div') })
  components = { ...TUFFEX_STUBS, ForumMarkdown, PostEditor, TurnstileBox: stub, UserAvatar: stub, TitleBadge: stub }
})

beforeEach(() => setActivePinia(createPinia()))

async function settle() {
  await new Promise(resolve => setTimeout(resolve))
  await nextTick()
}

/** The Tuffex buttons (not the editor's mode radios) with this text. */
function buttons(root: TestNode, label: string): TestNode[] {
  return findAll(root, node => node.tag === 'button' && node.props.role !== 'radio' && textOf(node) === label)
}

function button(root: TestNode, label: string): TestNode {
  const found = buttons(root, label)[0]
  if (!found)
    throw new Error(`no button ${label}`)
  return found
}

async function click(node: TestNode) {
  (node.props.onClick as () => void)()
  await settle()
}

/** A write the test answers by hand, to act while it is still out. */
function heldWrites<T>() {
  const calls: Array<{ args: unknown[], answer: (result: T) => void }> = []
  const write = vi.fn((...args: unknown[]) => new Promise<T>((resolve) => {
    calls.push({ args, answer: resolve })
  }))
  return { calls, write }
}

describe('a post card', () => {
  function mountCard(post: Post) {
    const PostCard = loadComponent('components/PostCard.vue', {
      imports: {
        '@talex-touch/tuffex/utils': { toast: vi.fn() },
        '~/data/likes': likes,
        '~/stores/forum-server': forumServer,
      },
      globals: {
        useForumStore: () => ({ userById: () => member, postById: () => undefined, isBookmarked: () => false, isFirstPost: () => false }),
        useForumActions: () => ({}),
        useCurrentUser: () => ({ user: ref(member), can: () => true, guestCanReply: () => false }),
        useShell: () => ({ loginOpen: ref(false) }),
        useRelativeTime: () => ({ fromNow: () => '刚刚', formatAbsolute: () => '' }),
        useAppLink: () => ({ href: (path: string) => path, absoluteUrl: () => `https://forum.example/t/t1#post-${post.id}` }),
      },
    })
    return mount(PostCard, { post, topic, floor: 2 }, components).root
  }

  /** The wrapper that carries the post's anchor. */
  function card(root: TestNode, id: string): TestNode {
    return find(root, node => node.props.id === `post-${id}`)!
  }

  /** What a reader can act on in the card's control row. */
  function controls(root: TestNode) {
    return {
      like: buttons(root, '赞').length,
      link: findAll(root, node => node.props['copy-label'] === '链接').length,
      bookmark: findAll(root, node => node.props.label === '书签').length,
      edit: buttons(root, '编辑').length,
      more: findAll(root, node => node.props.label === '更多操作').length,
      reply: buttons(root, '回复').length,
    }
  }

  const post = (id: string): Post => ({ id, topicId: 't1', authorId: 'u1', content: '刚写的回复', createdAt: 0, likeUserIds: [] })

  it('says 发送中 and offers nothing to like, link, bookmark, edit, delete or answer while the reply is sent', () => {
    const root = mountCard(post('pending:1'))
    expect(card(root, 'pending:1').props['aria-busy']).toBe('true')
    expect(textOf(root)).toContain('发送中')
    expect(controls(root)).toEqual({ like: 0, link: 0, bookmark: 0, edit: 0, more: 0, reply: 0 })
  })

  it('offers them all once it is the server\'s post', () => {
    const root = mountCard(post('p5'))
    expect(card(root, 'p5').props['aria-busy']).toBeUndefined()
    expect(textOf(root)).not.toContain('发送中')
    expect(controls(root)).toEqual({ like: 1, link: 1, bookmark: 1, edit: 1, more: 1, reply: 1 })
  })
})

describe('the edit form on a post, against the server', () => {
  const post: Post = { id: 'p4', topicId: 't1', authorId: 'u1', content: '原来的正文', createdAt: 0, likeUserIds: [] }

  function mountEditable() {
    const saves = heldWrites<boolean>()
    const toast = vi.fn()
    const PostCard = loadComponent('components/PostCard.vue', {
      imports: {
        '@talex-touch/tuffex/utils': { toast },
        '~/data/likes': likes,
        '~/stores/forum-server': forumServer,
      },
      globals: {
        useForumStore: () => ({ userById: () => member, postById: () => undefined, isBookmarked: () => false, isFirstPost: () => false }),
        useForumActions: () => ({ editPost: saves.write }),
        useCurrentUser: () => ({ user: ref(member), can: () => true, guestCanReply: () => false }),
        useShell: () => ({ loginOpen: ref(false) }),
        useRelativeTime: () => ({ fromNow: () => '刚刚', formatAbsolute: () => '' }),
        useAppLink: () => ({ href: (path: string) => path, absoluteUrl: () => 'https://forum.example/t/t1#post-p4' }),
      },
    })
    const { root } = mount(PostCard, { post, topic, floor: 2 }, components)
    const box = () => find(root, node => node.tag === 'textarea')
    return {
      saves,
      toast,
      box: () => box()?.props.value,
      /** 编辑, write `text`, 保存. */
      save: async (text: string) => {
        await click(button(root, '编辑'))
        ;(box()!.props.onInput as (value: string) => void)(text)
        await nextTick()
        await click(button(root, '保存'))
      },
      answer: async (index: number, done: boolean) => {
        saves.calls[index]!.answer(done)
        await settle()
      },
    }
  }

  it('reopens on the text that was saved when the server refuses it', async () => {
    const card = mountEditable()
    await card.save('改过的正文')
    expect(card.saves.calls.map(call => call.args)).toEqual([['p4', '改过的正文']])
    expect(card.box()).toBeUndefined()
    await card.answer(0, false)
    expect(card.box()).toBe('改过的正文')
    expect(card.toast).not.toHaveBeenCalled()
  })

  // The store answers both saves with the lane's one result.
  it('reopens on the second text when a second save, made while the first was out, is refused', async () => {
    const card = mountEditable()
    await card.save('第一版')
    await card.save('第二版')
    expect(card.box()).toBeUndefined()
    await card.answer(0, false)
    await card.answer(1, false)
    expect(card.box()).toBe('第二版')
  })

  it('says 帖子已更新 once for two saves the server took', async () => {
    const card = mountEditable()
    await card.save('第一版')
    await card.save('第二版')
    await card.answer(0, true)
    await card.answer(1, true)
    expect(card.toast.mock.calls).toEqual([[{ title: '帖子已更新', variant: 'success' }]])
    expect(card.box()).toBeUndefined()
  })
})

describe('the reply drawer after the server refused a reply', () => {
  const first: Post = { id: 'p2', topicId: 't1', authorId: 'u1', content: '甲的帖子', createdAt: 0, likeUserIds: [] }
  const second: Post = { id: 'p3', topicId: 't1', authorId: 'u1', content: '乙的帖子', createdAt: 0, likeUserIds: [] }
  const posts = [first, second]

  interface Sent { topicId: string, content: string, replyToPostId?: string }

  function mountComposer() {
    const sends = heldWrites<string | null>()
    const ReplyComposer = loadComponent('components/ReplyComposer.vue', {
      imports: {
        '@talex-touch/tuffex/utils': { toast: vi.fn() },
        '../../shared/forum-api': forumApi,
        '../../shared/post-markdown': postMarkdown,
      },
      globals: {
        useForumStore: () => ({ userById: () => member, postsOfTopic: () => posts, postById: (id: string) => posts.find(post => post.id === id) }),
        useForumServerStore: forumServer.useForumServerStore,
        useForumActions: () => ({ createPost: sends.write }),
        useContentSource: () => ({ serverMode: true }),
        useCurrentUser: () => ({ user: ref(member), can: () => true, guestCanReply: () => false }),
      },
    })
    // The topic page keeps the composer mounted and binds v-model:visible and v-model:reply-to.
    const state = reactive<{ visible: boolean, replyTo: Post | undefined }>({ visible: false, replyTo: undefined })
    const Parent = defineComponent({
      setup: () => () => h(ReplyComposer, {
        'visible': state.visible,
        topic,
        'replyTo': state.replyTo,
        'onUpdate:visible': (visible: boolean) => {
          state.visible = visible
        },
        'onUpdate:replyTo': (post: Post | undefined) => {
          state.replyTo = post
        },
      }),
    })
    const { root, unmount } = mount(Parent, {}, components)
    const box = () => String(find(root, node => node.tag === 'textarea')!.props.value)
    return {
      state,
      unmount,
      box,
      /** What each send asked for, in order. */
      sent: () => sends.calls.map(call => call.args[0] as Sent),
      refuse: async (index: number) => {
        sends.calls[index]!.answer(null)
        await settle()
      },
      /** Opens the drawer on `post` (the topic when absent), as a post's or the topic's 回复 button does. */
      open: async (post?: Post) => {
        state.replyTo = post
        state.visible = true
        await settle()
      },
      type: async (value: string) => {
        (find(root, node => node.tag === 'textarea')!.props.onInput as (value: string) => void)(value)
        await nextTick()
      },
      send: () => click(button(root, '回复')),
      cancel: () => click(button(root, '取消')),
    }
  }

  it('opens again on the text that was sent, and sends it again to the same post', async () => {
    const composer = mountComposer()
    await composer.open(first)
    const draft = `${quoteDraft(first)}我的回复`
    await composer.type(draft)
    await composer.send()
    expect(composer.state.visible).toBe(false)
    expect(composer.box()).toBe('')
    await composer.refuse(0)
    expect(composer.state.visible).toBe(true)
    expect(composer.box()).toBe(draft)
    await composer.send()
    expect(composer.sent()).toEqual([
      { topicId: 't1', authorId: 'u1', content: draft, replyToPostId: 'p2' },
      { topicId: 't1', authorId: 'u1', content: draft, replyToPostId: 'p2' },
    ])
  })

  it('keeps both texts when another reply, quote and all, was started while the first was out', async () => {
    const composer = mountComposer()
    await composer.open(first)
    await composer.type('回复甲')
    await composer.send()
    await composer.open(second)
    expect(composer.box()).toBe(quoteDraft(second))
    await composer.type(`${quoteDraft(second)}第二条`)
    await composer.refuse(0)
    expect(composer.state.visible).toBe(true)
    expect(composer.box()).toBe(`回复甲\n\n${quoteDraft(second)}第二条`)
    // The refused one decides whom the drawer answers: it is the text in front.
    expect(composer.state.replyTo?.id).toBe('p2')
  })

  it('keeps both texts when two replies in a row are refused', async () => {
    const composer = mountComposer()
    await composer.open()
    await composer.type('回复甲')
    await composer.send()
    await composer.open()
    await composer.type('回复乙')
    await composer.send()
    await composer.refuse(0)
    expect(composer.box()).toBe('回复甲')
    await composer.refuse(1)
    expect(composer.state.visible).toBe(true)
    expect(composer.box()).toBe('回复乙\n\n回复甲')
  })

  it('sends a refused reply again to the post it answered, though the drawer was opened on the topic meanwhile', async () => {
    const composer = mountComposer()
    await composer.open(first)
    await composer.type('回复甲')
    await composer.send()
    await composer.open()
    await composer.cancel()
    await composer.refuse(0)
    expect(composer.state.replyTo?.id).toBe('p2')
    await composer.send()
    expect(composer.sent()[1]).toEqual({ topicId: 't1', authorId: 'u1', content: '回复甲', replyToPostId: 'p2' })
  })

  it('gives a reply refused after the page was left back when the topic is open again', async () => {
    const composer = mountComposer()
    await composer.open(first)
    await composer.type('回复甲')
    await composer.send()
    composer.unmount()
    await composer.refuse(0)
    const again = mountComposer()
    await settle()
    expect(again.state.visible).toBe(true)
    expect(again.box()).toBe('回复甲')
    expect(again.state.replyTo?.id).toBe('p2')
  })
})
