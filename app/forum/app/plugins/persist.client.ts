import { useDebounceFn } from '@vueuse/core'
import { parseSession, parseState, SESSION_KEY, serializeSession, serializeState, STATE_KEY } from '~/data/persist'
import { useForumStore } from '~/stores/forum'
import { useSessionStore } from '~/stores/session'

/**
 * Hydrates both stores from localStorage, then writes them back on change.
 *
 * Every storage access is wrapped: a full quota, a private-mode browser or a
 * hand-edited entry must never blank the app. Anything unreadable is treated
 * as absent and the store keeps its fresh seed, so `reset()` needs no
 * clearing step of its own — the subscription overwrites the key with the
 * new seed on the next tick.
 *
 * Client-only by filename (`.client.ts`); with `ssr: false` there is no
 * server pass, and the suffix keeps that explicit if SSR is ever turned on.
 */
export default defineNuxtPlugin({
  name: 'tuff-forum-persist',
  // Store definitions call `useForumStore()` inside setup; that needs the active Pinia.
  dependsOn: ['pinia'],
  setup() {
    // The 极客班 snapshot is read-only and belongs to the server, not to this
    // browser: never hydrate from, or write it into, the demo's localStorage.
    // 统一登录下也不恢复示例会话：浏览器里存过的示例身份不能冒充登录。
    const { isSnapshot, siteLogin } = useContentSource()
    if (isSnapshot || siteLogin)
      return

    const forum = useForumStore()
    const session = useSessionStore()

    const savedState = parseState(read(STATE_KEY))
    if (savedState)
      forum.replaceState(savedState)

    const savedSession = parseSession(read(SESSION_KEY))
    if (savedSession)
      session.currentUserId = savedSession.currentUserId

    const saveState = useDebounceFn(() => write(STATE_KEY, serializeState(forum.state)), 150)
    const saveSession = useDebounceFn(() => write(SESSION_KEY, serializeSession({ currentUserId: session.currentUserId })), 150)

    forum.$subscribe(() => { void saveState() }, { detached: true })
    session.$subscribe(() => { void saveSession() }, { detached: true })
  },
})

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  }
  catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  }
  catch {
    // Quota exceeded or storage disabled: the in-memory state is still the app's truth.
  }
}
