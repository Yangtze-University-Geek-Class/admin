import type { OrgLook } from '~/data/titles'
import { applyPublicOrg, DEFAULT_ORG } from '~/data/titles'

/**
 * 称号与部门的显示信息（名字、标签、图标、色调、说明），给 `TitleBadge` 用。
 *
 * 这些都由提督在控制台改，核心服务在同域的 `/api/public/org` 公开（不登录也能读，不含权限包和人）。
 * 读到之前、请求失败、返回的不是 JSON 或内容不合格时，一直用 `app/data/titles.ts` 里的默认值，不提示。
 * 读到以后整体换掉，已经画出来的称号跟着变。论坛权限包不在这里：公开接口不给，仍用本地默认值。
 * 本机论坛在 3456，`nuxt.config.ts` 的 devProxy 把这个路径转给 127.0.0.1:3000。
 * 示例登录（上游验收与本机示例预览，loginMode=demo）后面没有核心服务，不发这个请求，只用默认值：
 * 否则浏览器会把 404 记成控制台错误。
 */

/** 一个页面里所有称号共用一次请求，失败也不重试。 */
let inflight: Promise<void> | null = null

export function useOrgTitles() {
  const org = useState<OrgLook>('geek:org', () => DEFAULT_ORG)
  const loaded = useState<boolean>('geek:org:loaded', () => false)

  async function fetchOrg(): Promise<void> {
    try {
      const response = await fetch('/api/public/org', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      if (response.ok && response.headers.get('content-type')?.includes('application/json'))
        org.value = applyPublicOrg(await response.json() as unknown, DEFAULT_ORG)
    }
    catch {
      // 读不到就保持默认值。
    }
    finally {
      loaded.value = true
    }
  }

  const { siteLogin } = useContentSource()
  if (import.meta.client && siteLogin && !loaded.value)
    inflight ??= fetchOrg().finally(() => { inflight = null })

  return org
}
