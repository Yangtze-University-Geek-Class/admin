import { siteForumState } from '../../shared/site-state'

/**
 * 极客班论坛 (`contentSource: 'site'`): the pages show the forum's own
 * categories and tags and nothing else. Like the snapshot plugin, this runs
 * before the app mounts, so the upstream demo seed is never on screen, not
 * even for one frame, and the store session is the guest: the site-wide
 * GitHub login identifies a member but maps to no forum user yet.
 *
 * The store already starts from this state in a site build (see
 * `initialState` in stores/forum.ts); replacing it here keeps the guarantee
 * independent of how the bundle was folded.
 */
export default defineNuxtPlugin({
  name: 'geek-site-state',
  dependsOn: ['pinia'],
  setup() {
    const { isSite } = useContentSource()
    if (!isSite)
      return
    const forum = useForumStore()
    const session = useSessionStore()
    forum.replaceState(siteForumState())
    session.currentUserId = null
  },
})
