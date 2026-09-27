import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useForumActions } from '~/composables/useForumActions'
import { forumAccess, loginPromptToast } from '~/data/access'
import { likeControl } from '~/data/likes'
import { can } from '~/data/permissions'
import { useForumStore } from '~/stores/forum'
import { useForumServerStore } from '~/stores/forum-server'
import { useSessionStore } from '~/stores/session'
import { MEMBER_VIEWER, serverBody, serverState, writeBody } from './fixtures/server-state'

/**
 * The like control under every post (#143): 「赞」 and the count, highlighted
 * once the viewer has liked, a sign-in prompt for a guest, and against the
 * forum server one request whose answer the page shows at once.
 */

const ADA = { id: 'm1001' }

afterEach(() => vi.unstubAllGlobals())

describe('what the like button says', () => {
  it('reads 「赞」 with nobody yet and 「赞 N」 after that', () => {
    expect(likeControl({ likeUserIds: [] }, ADA, true)).toMatchObject({ label: '赞', count: 0 })
    expect(likeControl({ likeUserIds: ['u1'] }, ADA, true)).toMatchObject({ label: '赞 1', count: 1 })
    expect(likeControl({ likeUserIds: ['u1', 'u2', 'u3'] }, null, false)).toMatchObject({ label: '赞 3', count: 3 })
  })

  it('is pressed, filled and red only for a viewer among the likers', () => {
    expect(likeControl({ likeUserIds: ['u1', 'm1001'] }, ADA, true)).toMatchObject({ liked: true, icon: 'i-carbon-favorite-filled', tone: 'danger' })
    expect(likeControl({ likeUserIds: ['u1'] }, ADA, true)).toMatchObject({ liked: false, icon: 'i-carbon-favorite', tone: undefined })
    // A guest sees the same count, never a pressed button.
    expect(likeControl({ likeUserIds: ['m1001'] }, null, false)).toMatchObject({ label: '赞 1', liked: false, tone: undefined })
  })

  it('toggles for a member who may write and prompts everyone else', () => {
    expect(likeControl({ likeUserIds: [] }, ADA, true).click).toBe('toggle')
    expect(likeControl({ likeUserIds: [] }, null, false).click).toBe('prompt')
    // Signed in, but nothing can be written now (the server did not answer): the prompt says why.
    expect(likeControl({ likeUserIds: [] }, ADA, false).click).toBe('prompt')
  })
})

describe('a guest who clicks 赞', () => {
  it('is asked to sign in, with the 登录 action, in 极客班论坛', () => {
    const access = forumAccess('server', 'ready', null)
    // useCurrentUser's can(): writable, and permitted for this user.
    expect(likeControl({ likeUserIds: ['m1001'] }, null, access.writable && can(null, 'like')).click).toBe('prompt')
    // LoginModal shows this toast for the prompt (its words are tested in access.test.ts).
    expect(loginPromptToast(access.loginPrompt)).toMatchObject({ title: '登录后才能继续', signIn: true })
  })
})

/** The forum toolchain has no DOM to mount a component in; like editor-call-sites.test.ts, this reads the source. */
function source(path: string): string {
  return readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8')
}

describe('PostCard and LoginModal use these', () => {
  it('the like button shows likeControl and names itself by its text', () => {
    const card = source('components/PostCard.vue')
    const button = card.match(/<TxButton\s+variant="flat"\s+:type="likeState\.tone"[\s\S]*?<\/TxButton>/)?.[0] ?? ''
    expect(button).toMatch(/:icon="likeState\.icon"/)
    expect(button).toMatch(/:aria-pressed="likeState\.liked"/)
    expect(button).toMatch(/@click="like"/)
    expect(button).toMatch(/\{\{ likeState\.label \}\}/)
    // An aria-label would replace 「赞 3」 as the name and drop the count for a screen reader.
    expect(button).not.toMatch(/aria-label/)
    expect(card).toMatch(/const likeState = computed\(\(\) => likeControl\(props\.post, user\.value, can\('like'\)\)\)/)
  })

  it('a prompt opens loginOpen, a toggle goes through useForumActions', () => {
    const card = source('components/PostCard.vue')
    const like = card.match(/function like\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(like).toMatch(/likeState\.value\.click === 'prompt'\) \{\s+loginOpen\.value = true\s+return/)
    expect(like).toMatch(/actions\.toggleLike\(props\.post\.id, current\.id\)/)
  })

  it('LoginModal answers loginOpen with loginPromptToast and the site sign-in', () => {
    const modal = source('components/LoginModal.vue')
    expect(modal).toMatch(/loginPromptToast\(access\.value\.loginPrompt\)/)
    expect(modal).toMatch(/withSignIn \? \{ action: \{ label: '登录', onClick: signIn \} \}/)
  })
})

describe('a like against the forum server', () => {
  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }

  /** useForumActions reads Nuxt auto-imports; outside Nuxt they are handed in as globals. */
  async function serverPage(...answers: Response[]) {
    const calls: Array<{ url: string, method: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET' })
      const next = answers.shift()
      if (!next)
        throw new Error(`unexpected call ${init.method} ${url}`)
      return next
    }))
    setActivePinia(createPinia())
    vi.stubGlobal('useContentSource', () => ({ serverMode: true }))
    vi.stubGlobal('useForumStore', useForumStore)
    vi.stubGlobal('useForumServerStore', useForumServerStore)
    const forum = useForumStore()
    const session = useSessionStore()
    await useForumServerStore().load()
    return { calls, forum, session, actions: useForumActions() }
  }

  it('posts one request and the button reads the server\'s answer without a reload', async () => {
    const liked = serverState(MEMBER_VIEWER)
    liked.posts[1]!.likeUserIds = ['m1001']
    const { calls, forum, session, actions } = await serverPage(json(serverBody(MEMBER_VIEWER)), json(writeBody({ posts: [liked.posts[1]] }, MEMBER_VIEWER)))
    const before = likeControl(forum.postById('p10001')!, session.currentUser, true)
    expect([before.label, before.liked]).toEqual(['赞', false])

    expect(await actions.toggleLike('p10001', 'm1001')).toBe(true)
    expect(calls).toEqual([{ url: '/api/forum/state', method: 'GET' }, { url: '/api/forum/posts/p10001/like', method: 'POST' }])
    const after = likeControl(forum.postById('p10001')!, session.currentUser, true)
    expect(after).toMatchObject({ label: '赞 1', liked: true, icon: 'i-carbon-favorite-filled', tone: 'danger' })
  })

  it('likes the topic\'s first post the same way', async () => {
    const unliked = serverState(MEMBER_VIEWER)
    unliked.posts[0]!.likeUserIds = []
    const { calls, forum, session, actions } = await serverPage(json(serverBody(MEMBER_VIEWER)), json(writeBody({ posts: [unliked.posts[0]] }, MEMBER_VIEWER)))
    expect(forum.isFirstPost('body-73')).toBe(true)
    expect(likeControl(forum.postById('body-73')!, session.currentUser, true)).toMatchObject({ label: '赞 1', liked: true })
    expect(await actions.toggleLike('body-73', 'm1001')).toBe(false)
    expect(calls[1]).toEqual({ url: '/api/forum/posts/body-73/like', method: 'POST' })
    expect(likeControl(forum.postById('body-73')!, session.currentUser, true)).toMatchObject({ label: '赞', liked: false, tone: undefined })
  })

  it('keeps the button as it was when the server refuses', async () => {
    const { forum, session, actions } = await serverPage(json(serverBody(MEMBER_VIEWER)), json({ error: 'post_deleted', message: '这条帖子已被删除' }, 409))
    expect(await actions.toggleLike('p10001', 'm1001')).toBeNull()
    expect(likeControl(forum.postById('p10001')!, session.currentUser, true)).toMatchObject({ label: '赞', liked: false })
  })
})
