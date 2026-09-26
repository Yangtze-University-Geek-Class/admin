import type { Component } from 'vue'
import type { Post, Topic, User } from '~/data/types'
import type { TestNode } from './support/sfc'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import * as likes from '~/data/likes'
import * as forumServer from '~/stores/forum-server'
import * as postMarkdown from '../shared/post-markdown'
import { find, findAll, loadComponent, mount, textOf } from './support/sfc'
import { loadMarked, TUFFEX_STUBS } from './support/tuffex-stubs'

/**
 * #145 in the components: what a post card and the reply drawer do while a
 * write is out and after the server refused it. The stores are stubbed; the
 * write path itself is tests/forum-optimistic.test.ts.
 */

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

/** The Tuffex buttons (not the editor's mode radios) with this text. */
function buttons(root: TestNode, label: string): TestNode[] {
  return findAll(root, node => node.tag === 'button' && node.props.role !== 'radio' && textOf(node) === label)
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
