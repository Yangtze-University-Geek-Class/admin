import type { Counters, ForumState, SessionState } from './types'
import { FORUM_STATE_VERSION } from './types'

/**
 * localStorage codec. Pure and Nuxt-free so the round-trip is unit-testable;
 * `plugins/persist.client.ts` owns the actual storage access.
 *
 * Keys carry the state version: a future shape change bumps the key and the
 * old entry is simply ignored, not migrated.
 */

export const STATE_KEY = `tuff-forum:state:v${FORUM_STATE_VERSION}`
export const SESSION_KEY = `tuff-forum:session:v${FORUM_STATE_VERSION}`

const STATE_ARRAYS = ['users', 'categories', 'tags', 'topics', 'posts', 'notifications', 'bookmarks', 'follows'] as const

export function serializeState(state: ForumState): string {
  return JSON.stringify(state)
}

/** `null` for anything that is not a complete state of the current version. */
export function parseState(raw: string | null): ForumState | null {
  const value = parseJson(raw)
  if (!isRecord(value) || value.version !== FORUM_STATE_VERSION)
    return null
  if (typeof value.seededAt !== 'number' || !isRecord(value.counters))
    return null
  for (const key of STATE_ARRAYS) {
    if (!Array.isArray(value[key]))
      return null
  }
  const counters = normalizeCounters(value.counters, value.tags as unknown[])
  if (!counters)
    return null
  return { ...value, counters } as unknown as ForumState
}

/**
 * `counters.tag` arrived after the first release; a payload that predates it
 * simply never minted a tag, so the seeded tag count is where the next id
 * resumes. The three original counters stay mandatory — defaulting one of them
 * to 0 would hand out `t1` again and silently overwrite the seed.
 */
function normalizeCounters(raw: Record<string, unknown>, tags: unknown[]): Counters | null {
  const { topic, post, notification, tag } = raw
  if (!isCount(topic) || !isCount(post) || !isCount(notification))
    return null
  return { topic, post, notification, tag: isCount(tag) ? tag : tags.length }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function serializeSession(session: SessionState): string {
  return JSON.stringify(session)
}

export function parseSession(raw: string | null): SessionState | null {
  const value = parseJson(raw)
  if (!isRecord(value) || !('currentUserId' in value))
    return null
  const id = value.currentUserId
  if (id !== null && typeof id !== 'string')
    return null
  return { currentUserId: id }
}

function parseJson(raw: string | null): unknown {
  if (raw === null)
    return null
  try {
    return JSON.parse(raw)
  }
  catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
