/**
 * A topic page lives at `<base>t/<id>`. The published documents link to each
 * other and to their pictures relatively (`./t9`, `../published/x.webp`), and
 * under `<base>t/<id>/` those resolve one level too deep; so an address typed
 * or shared with the trailing slash is replaced by the one without it.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (/^\/t\/[^/]+\/+$/.test(to.path))
    return navigateTo({ path: to.path.replace(/\/+$/, ''), query: to.query, hash: to.hash }, { replace: true })
})
