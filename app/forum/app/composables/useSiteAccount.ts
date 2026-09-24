/**
 * 极客班统一登录的会话（真实数据模式用）。
 *
 * 登录只在官网桌面上发生：核心服务的 `/auth/github` → `/auth/callback` 写下 `sid` cookie。
 * 论坛与官网、控制台同域（线上 `/forum/` 由 web 容器反代），所以直接读同域的 `/auth/me` 就知道是谁；
 * 论坛自己不提供登录。本机独立端口上没有 `/auth/me`（返回 404 或 HTML），当作未登录。
 */
export interface SiteAccount {
  login: string
  avatarUrl: string | null
}

export function useSiteAccount() {
  const account = useState<SiteAccount | null>('site-account', () => null)
  const loaded = useState<boolean>('site-account:loaded', () => false)

  async function refresh(): Promise<void> {
    if (!import.meta.client)
      return
    try {
      const response = await fetch('/auth/me', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      const body = response.ok && response.headers.get('content-type')?.includes('application/json')
        ? await response.json() as { signed_in?: boolean, login?: string, avatar_url?: string | null }
        : null
      account.value = body?.signed_in && body.login ? { login: body.login, avatarUrl: body.avatar_url ?? null } : null
    }
    catch {
      account.value = null
    }
    finally {
      loaded.value = true
    }
  }

  /** 在任一处退出，官网、论坛、控制台一起变成未登录（同一个 `sid`）。 */
  async function signOut(): Promise<void> {
    try {
      await fetch('/auth/signout', { method: 'POST', credentials: 'same-origin' })
    }
    finally {
      account.value = null
    }
  }

  if (import.meta.client && !loaded.value)
    void refresh()

  return { account, loaded, refresh, signOut }
}
