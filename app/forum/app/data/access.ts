import type { Topic, User } from './types'

/**
 * Who may write, decided once for every page. Pure, so the guest/member rules
 * are unit-tested (tests/access.test.ts) instead of re-derived in templates.
 *
 * - `demo`: the upstream demo (`loginMode=demo`); an identity picked from the
 *   seed writes into this browser's store.
 * - `server`: 极客班论坛 (`contentSource: site`, the deployed images). The
 *   forum server holds the data; a signed-in member writes as their forum
 *   user, a guest may only reply, under a nickname.
 * - `read-only`: the local snapshot and the demo seed under the site-wide
 *   login. Nothing can be written.
 */
export type ForumMode = 'demo' | 'server' | 'read-only'
/**
 * The forum server's answer to `GET /api/forum/state`: `busy` is a 429 (too
 * many requests from this address, not an outage; the store asks again
 * later), `error` is anything else that did not produce a state.
 */
export type ServerStatus = 'idle' | 'loading' | 'ready' | 'busy' | 'error'

/**
 * What a control that needs a forum user does for someone who has none:
 * pick a demo identity, sign in, or explain why nothing can be written now
 * (`not-member`: signed in site-wide, but the server serves this account as a
 * guest because it is no longer in the 极客班 GitHub organization).
 */
export type LoginPrompt = 'pick-identity' | 'sign-in' | 'not-member' | 'busy' | 'offline' | 'not-open'

export interface ForumAccess {
  /** A write can reach storage: the demo's browser store, or a server that answered. */
  writable: boolean
  /** The forum server did not answer: the published posts only, every write off. */
  offline: boolean
  /** Replying without signing in, under a nickname. */
  guestReply: boolean
  loginPrompt: LoginPrompt
}

/**
 * `signedIn` is the site-wide login (`/auth/me`); it only matters when the
 * server answered with a guest viewer, to tell 「去登录」 from 「这个账号不行」.
 */
export function forumAccess(mode: ForumMode, status: ServerStatus, user: User | null, signedIn = false): ForumAccess {
  if (mode === 'demo')
    return { writable: true, offline: false, guestReply: false, loginPrompt: 'pick-identity' }
  if (mode === 'read-only')
    return { writable: false, offline: false, guestReply: false, loginPrompt: 'not-open' }
  if (status === 'error')
    return { writable: false, offline: true, guestReply: false, loginPrompt: 'offline' }
  if (status === 'busy')
    return { writable: false, offline: false, guestReply: false, loginPrompt: 'busy' }
  const ready = status === 'ready'
  return { writable: ready, offline: false, guestReply: ready && !user, loginPrompt: ready && !user && signedIn ? 'not-member' : 'sign-in' }
}

/** The same words wherever a page has to say that nothing can be written right now. */
export const UNAVAILABLE_COPY = {
  'offline': { title: '论坛服务暂时连不上', description: '现在只能看帖子，稍后刷新页面再试。' },
  'busy': { title: '请求太频繁，稍后再试', description: '论坛过一会儿会自动重新加载，现在可以看帖子。' },
  'not-member': { title: '这个账号现在不能在论坛里发帖', description: '论坛只给极客班 GitHub 组织的成员用；这个账号不在组织里，和没登录一样只能看帖、用昵称回复。' },
} as const satisfies Record<Extract<LoginPrompt, 'offline' | 'busy' | 'not-member'>, { title: string, description: string }>

/**
 * The toast a login-required control (赞, 书签, 关注) gets under the site-wide
 * login, where the forum has no sign-in of its own: LoginModal shows it when
 * such a control opens `loginOpen`, so no click goes unanswered. `signIn`
 * asks for the 登录 action (the site-wide GitHub sign-in); the modal adds it,
 * since the link is not data.
 */
export interface PromptToast {
  id: string
  title: string
  description: string
  variant?: 'warning'
  duration?: number
  signIn: boolean
}

export function loginPromptToast(prompt: LoginPrompt): PromptToast {
  if (prompt === 'sign-in') {
    return {
      id: 'forum-sign-in',
      title: '登录后才能继续',
      description: '发新话题、点赞、收藏和关注要先用 GitHub 登录，只有极客班成员能登录。不登录也能看帖和回复。',
      duration: 6000,
      signIn: true,
    }
  }
  if (prompt === 'offline' || prompt === 'busy' || prompt === 'not-member')
    return { id: `forum-${prompt}`, ...UNAVAILABLE_COPY[prompt], variant: 'warning', signIn: false }
  // The snapshot and the demo seed under the site-wide login (`pick-identity` never reaches here: that is the demo's picker).
  return { id: 'forum-read-only', title: '现在还不能操作', description: '发帖、回复、点赞和收藏正在接入，现在可以浏览。', signIn: false }
}

/** A guest may reply to an open topic; closing a topic shuts guests out as well. */
export function guestMayReply(access: ForumAccess, topic: Topic): boolean {
  return access.guestReply && !topic.closed
}
