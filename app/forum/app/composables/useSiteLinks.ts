/**
 * 离开论坛的几个去处：统一登录、控制台、宣传主页。线上论坛与官网同域（`/forum/` 由 web 容器反代），
 * 用站内路径；本机开发时论坛单独跑在 3456，统一登录、控制台和官网都在 5173 上。
 */
export function useSiteLinks() {
  const route = useRoute()
  const { href } = useAppLink()
  const deployment = useDeploymentInfo()
  const portalOrigin = import.meta.dev ? 'http://127.0.0.1:5173' : ''

  /**
   * 去极客班统一登录页（#262，登录方式由登录页按 GET /auth/providers 列出，GitHub 只是其一），登录后回到当前论坛页面
   * （带着查询和锚点）。`return_to` 只带本站路径（含 `/forum` 前缀），登录页与核心服务都会再按同源校验。
   */
  const signInHref = computed(() => {
    const back = import.meta.dev ? `/forum${route.fullPath}` : href(route.fullPath)
    return `${portalOrigin}/signin?return_to=${encodeURIComponent(back)}`
  })
  const consoleHref = `${portalOrigin}/console`
  const portalHref = computed(() => (import.meta.dev ? `${portalOrigin}/sites/portal/` : deployment.value.origin || '/'))

  /** 这些地址都不归论坛的路由器管，整页跳过去。 */
  function leave(href: string): void {
    window.location.assign(href)
  }

  return { signInHref, consoleHref, portalHref, signIn: () => leave(signInHref.value), leave }
}
