import type { SnapshotSummary } from '../../shared/local-snapshot'
import { parseSnapshotDocument } from '../../shared/local-snapshot'

export type ContentSource = 'upstream-seed' | 'local-snapshot'
export type SnapshotStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SnapshotInfo {
  status: SnapshotStatus
  capturedAt: string
  summary: SnapshotSummary | null
  error: string
}

/**
 * Which data the pages are showing and, for the 极客班 snapshot, whether it
 * has arrived. `load()` replaces the whole store and forces the guest
 * session; it never merges with the demo seed and never falls back to it.
 */
export function useContentSource() {
  const config = useRuntimeConfig()
  const source = config.public.contentSource as ContentSource
  const siteName = config.public.siteName as string
  const isSnapshot = source === 'local-snapshot'
  /**
   * 全站统一 GitHub 登录（见 nuxt.config.ts 的 loginMode）：论坛没有自己的登录，示例身份选择不出现，
   * 本机不保存示例会话。只有 scripts/forum.mjs 的示例预览与上游验收是 false。
   */
  const siteLogin = config.public.loginMode !== 'demo'

  const snapshot = useState<SnapshotInfo>('geek:snapshot', () => ({ status: 'idle', capturedAt: '', summary: null, error: '' }))
  const ready = computed(() => !isSnapshot || snapshot.value.status === 'ready')

  async function load(): Promise<void> {
    const forum = useForumStore()
    const session = useSessionStore()
    snapshot.value = { ...snapshot.value, status: 'loading', error: '' }
    try {
      const payload = await $fetch<unknown>('/api/local-forum/state')
      const document = parseSnapshotDocument(payload)
      session.currentUserId = null
      forum.replaceState(document.state)
      snapshot.value = { status: 'ready', capturedAt: document.capturedAt, summary: document.summary, error: '' }
    }
    catch (error) {
      snapshot.value = { ...snapshot.value, status: 'error', error: describeError(error) }
    }
  }

  return { source, siteName, isSnapshot, siteLogin, snapshot, ready, load }
}

function describeError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { data, statusCode } = error as { data?: { error?: string, message?: string }, statusCode?: number }
    if (data?.message)
      return data.error ? `${data.error}: ${data.message}` : data.message
    if (statusCode)
      return `HTTP ${statusCode}`
  }
  return error instanceof Error ? error.message : String(error)
}
