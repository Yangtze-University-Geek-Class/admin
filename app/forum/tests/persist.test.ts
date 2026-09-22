import { describe, expect, it } from 'vitest'
import { parseSession, parseState, SESSION_KEY, serializeSession, serializeState, STATE_KEY } from '~/data/persist'
import { createSeed } from '~/data/seed'
import { FORUM_STATE_VERSION } from '~/data/types'

const NOW = 1_780_000_000_000

describe('persist keys', () => {
  it('embed the state version', () => {
    expect(STATE_KEY).toBe(`tuff-forum:state:v${FORUM_STATE_VERSION}`)
    expect(SESSION_KEY).toBe(`tuff-forum:session:v${FORUM_STATE_VERSION}`)
  })
})

describe('state round-trip', () => {
  it('survives serialize → parse deep-equal', () => {
    const state = createSeed(NOW)
    const parsed = parseState(serializeState(state))
    expect(parsed).toEqual(state)
    expect(parsed).not.toBe(state)
  })

  it('keeps mutations made after seeding', () => {
    const state = createSeed(NOW)
    state.counters.topic += 1
    state.topics.push({ ...(state.topics[0]!), id: 'tX', title: '新话题' })
    const parsed = parseState(serializeState(state))
    expect(parsed?.counters.topic).toBe(state.counters.topic)
    expect(parsed?.topics.at(-1)?.title).toBe('新话题')
  })

  it('returns null for missing, garbage, non-object or wrong-version input', () => {
    expect(parseState(null)).toBeNull()
    expect(parseState('')).toBeNull()
    expect(parseState('garbage')).toBeNull()
    expect(parseState('42')).toBeNull()
    expect(parseState('[]')).toBeNull()
    expect(parseState('null')).toBeNull()
    expect(parseState(JSON.stringify({ ...createSeed(NOW), version: 0 }))).toBeNull()
    expect(parseState(JSON.stringify({ ...createSeed(NOW), version: '1' }))).toBeNull()
  })

  it('returns null when a collection or the counters are missing', () => {
    for (const key of ['users', 'categories', 'tags', 'topics', 'posts', 'notifications', 'bookmarks', 'follows', 'counters', 'seededAt'] as const) {
      const broken = Object.fromEntries(Object.entries(createSeed(NOW)).filter(([field]) => field !== key))
      expect(parseState(JSON.stringify(broken)), key).toBeNull()
    }
    const notArray = { ...createSeed(NOW), posts: {} }
    expect(parseState(JSON.stringify(notArray))).toBeNull()
  })

  it('hydrates a payload written before counters.tag existed', () => {
    const state = createSeed(NOW)
    // Exactly what the first release stored: three counters, no `tag`.
    const legacy = {
      ...state,
      counters: { topic: state.counters.topic, post: state.counters.post, notification: state.counters.notification },
    }
    const parsed = parseState(JSON.stringify(legacy))
    expect(parsed).not.toBeNull()
    // Resumes from the tags that are actually there, so the next minted id is
    // `tag<tags.length + 1>` rather than one that already exists.
    expect(parsed!.counters.tag).toBe(state.tags.length)
    expect(parsed!.topics).toHaveLength(state.topics.length)
    expect(parsed!.counters.topic).toBe(state.counters.topic)
  })

  it('resumes the tag counter past tags a legacy payload had already grown', () => {
    const state = createSeed(NOW)
    state.tags.push({ id: 'tag99', slug: 'legacy', name: 'legacy', color: '#000000' })
    const legacy = {
      ...state,
      counters: { topic: state.counters.topic, post: state.counters.post, notification: state.counters.notification },
    }
    expect(parseState(JSON.stringify(legacy))!.counters.tag).toBe(state.tags.length)
  })

  it('rejects a payload whose original counters are missing or malformed', () => {
    const state = createSeed(NOW)
    for (const key of ['topic', 'post', 'notification'] as const) {
      const broken = { ...state, counters: Object.fromEntries(Object.entries(state.counters).filter(([field]) => field !== key)) }
      expect(parseState(JSON.stringify(broken)), key).toBeNull()
    }
    expect(parseState(JSON.stringify({ ...state, counters: { ...state.counters, post: '221' } }))).toBeNull()
    expect(parseState(JSON.stringify({ ...state, counters: { ...state.counters, topic: -1 } }))).toBeNull()
  })
})

describe('session round-trip', () => {
  it('round-trips a user id and the guest state', () => {
    expect(parseSession(serializeSession({ currentUserId: 'u3' }))).toEqual({ currentUserId: 'u3' })
    expect(parseSession(serializeSession({ currentUserId: null }))).toEqual({ currentUserId: null })
  })

  it('returns null for garbage or a malformed id', () => {
    expect(parseSession(null)).toBeNull()
    expect(parseSession('nope')).toBeNull()
    expect(parseSession('{}')).toBeNull()
    expect(parseSession(JSON.stringify({ currentUserId: 7 }))).toBeNull()
  })

  it('drops unknown fields', () => {
    expect(parseSession(JSON.stringify({ currentUserId: 'u1', token: 'x' }))).toEqual({ currentUserId: 'u1' })
  })
})
