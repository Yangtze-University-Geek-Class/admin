/**
 * Cloudflare Turnstile，给游客回复用：核心服务配了 Turnstile（`state.guestPolicy.turnstileSiteKey` 非空）时，
 * 游客回复必须带 `turnstileToken`，否则 400 `turnstile_failed`。加载方式与官网
 * `app/web/shared/ui/TurnstileWidget.tsx` 相同：按需插入显式渲染的脚本，站点 CSP 已放行
 * `https://challenges.cloudflare.com`（script-src、frame-src）。没配时整段不加载。
 */

export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** 脚本 15 秒还没好就算失败，让页面给出「重试」，不一直转圈。 */
export const TURNSTILE_LOAD_TIMEOUT_MS = 15_000

export interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id: string) => void
}

export interface TurnstileHost {
  turnstile?: TurnstileApi
  document: Pick<Document, 'createElement' | 'head'>
  setTimeout: (handler: () => void, ms: number) => unknown
  clearTimeout: (id: never) => void
}

const pending = new WeakMap<object, Promise<TurnstileApi>>()

/** 同一个页面只插一次脚本；失败后移除脚本，下次调用重新加载。 */
export function loadTurnstile(host: TurnstileHost = window as unknown as TurnstileHost): Promise<TurnstileApi> {
  if (host.turnstile)
    return Promise.resolve(host.turnstile)
  const existing = pending.get(host)
  if (existing)
    return existing
  const loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = host.document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    const fail = () => {
      script.remove()
      pending.delete(host)
      reject(new Error('人机验证没有加载出来'))
    }
    const timer = host.setTimeout(fail, TURNSTILE_LOAD_TIMEOUT_MS)
    script.onload = () => {
      host.clearTimeout(timer as never)
      if (host.turnstile)
        resolve(host.turnstile)
      else
        fail()
    }
    script.onerror = () => {
      host.clearTimeout(timer as never)
      fail()
    }
    host.document.head.appendChild(script)
  })
  pending.set(host, loading)
  return loading
}
