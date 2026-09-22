import type { RouteLocationRaw } from 'vue-router'

/**
 * URLs that leave the router: an `<a href>` a reader can copy or open in a new
 * tab (TxCellLink), and a link put on the clipboard. The deployed image is
 * served under `/forum/` (`app.baseURL` from GEEK_FORUM_BASE_PATH), so a bare
 * `/t/1` there falls through to the portal. The router already knows the
 * base; route paths handed to `router.push`/`navigateTo` stay bare.
 */
export function useAppLink() {
  const router = useRouter()

  /** Same-origin href with the app base, e.g. `/forum/u/alice`. */
  function href(to: RouteLocationRaw): string {
    return router.resolve(to).href
  }

  /** Absolute URL for copying or sharing, e.g. `https://…/forum/t/1#post-2`. */
  function absoluteUrl(to: RouteLocationRaw): string {
    return new URL(href(to), window.location.origin).href
  }

  return { href, absoluteUrl }
}
