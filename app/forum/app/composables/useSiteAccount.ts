import { toast } from '@talex-touch/tuffex/utils'
import { signinOutcomes } from '../../shared/signin-outcomes'

/**
 * 极客班统一登录的会话（真实数据模式用）。
 *
 * 登录只有一个入口：核心服务的 `/auth/github` → `/auth/callback` 写下 `sid` cookie，官网、论坛、控制台共用；
 * 只有极客班 GitHub 组织的成员能登录成功，其他人不登录照样能看论坛。
 * 论坛与官网、控制台同域（线上 `/forum/` 由 web 容器反代），所以直接读同域的 `/auth/me` 就知道是谁；
 * 本机独立端口上没有 `/auth/me`（返回 404 或 HTML），当作未登录。
 */
export interface SiteAccount {
  login: string
  avatarUrl: string | null
}

/** 顶栏调用本组合函数；同一页面只发一次 /auth/me。 */
let inflight: Promise<void> | null = null

export function useSiteAccount() {
  const account = useState<SiteAccount | null>('site-account', () => null)
  const loaded = useState<boolean>('site-account:loaded', () => false)
  const outcomeShown = useState<boolean>('site-account:outcome-shown', () => false)
  const route = useRoute()
  const router = useRouter()

  function refresh(): Promise<void> {
    if (!import.meta.client)
      return Promise.resolve()
    inflight ??= fetchAccount().finally(() => { inflight = null })
    return inflight
  }

  async function fetchAccount(): Promise<void> {
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

  function showSigninOutcome(): void {
    outcomeShown.value = true
    const raw = route.query.signin
    // 登录没成功的原因在这里说明一次，然后把参数从地址里拿掉，刷新页面不会重复提示。
    const outcomes = signinOutcomes({ hasPosts: !useContentSource().isSite })
    const outcome = typeof raw === 'string' ? outcomes[raw] : undefined
    if (raw === undefined)
      return
    if (outcome)
      toast({ ...outcome, duration: 8000 })
    void router.replace({ query: { ...route.query, signin: undefined }, hash: route.hash })
  }

  /**
   * 在任一处退出，官网、论坛、控制台一起变成未登录（同一个 `sid`）。
   * 只有服务端确认清掉了会话才显示已退出；没成功就保持原样并说明，不让界面和实际状态对不上。
   */
  async function signOut(): Promise<void> {
    const ok = await fetch('/auth/signout', { method: 'POST', credentials: 'same-origin' })
      .then(response => response.ok)
      .catch(() => false)
    if (ok) {
      account.value = null
      return
    }
    toast({ title: '没有退出成功', description: '请刷新页面后再试一次。', variant: 'warning' })
  }

  if (import.meta.client && !loaded.value)
    void refresh()
  if (import.meta.client && !outcomeShown.value)
    showSigninOutcome()

  return { account, loaded, refresh, signOut }
}
