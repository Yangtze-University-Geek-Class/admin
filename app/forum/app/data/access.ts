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
export type ServerStatus = 'idle' | 'loading' | 'ready' | 'error'

/** What a control that needs a forum user does for someone who has none. */
export type LoginPrompt = 'pick-identity' | 'sign-in' | 'offline' | 'not-open'

export interface ForumAccess {
  /** A write can reach storage: the demo's browser store, or a server that answered. */
  writable: boolean
  /** The forum server did not answer: the published posts only, every write off. */
  offline: boolean
  /** Replying without signing in, under a nickname. */
  guestReply: boolean
  loginPrompt: LoginPrompt
}

export function forumAccess(mode: ForumMode, status: ServerStatus, user: User | null): ForumAccess {
  if (mode === 'demo')
    return { writable: true, offline: false, guestReply: false, loginPrompt: 'pick-identity' }
  if (mode === 'read-only')
    return { writable: false, offline: false, guestReply: false, loginPrompt: 'not-open' }
  if (status === 'error')
    return { writable: false, offline: true, guestReply: false, loginPrompt: 'offline' }
  const ready = status === 'ready'
  return { writable: ready, offline: false, guestReply: ready && !user, loginPrompt: 'sign-in' }
}

/** A guest may reply to an open topic; closing a topic shuts guests out as well. */
export function guestMayReply(access: ForumAccess, topic: Topic): boolean {
  return access.guestReply && !topic.closed
}
