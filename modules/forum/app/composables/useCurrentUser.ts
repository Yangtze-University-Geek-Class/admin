import type { ForumAction, PermissionContext } from '~/data/permissions'
import { can } from '~/data/permissions'

/**
 * The session store plus the permission check every write control asks
 * before it renders. `user` is `null` for guests.
 */
export function useCurrentUser() {
  const session = useSessionStore()

  const user = computed(() => session.currentUser)
  const isLoggedIn = computed(() => session.isLoggedIn)
  const isStaff = computed(() => session.isStaff)

  function allowed(action: ForumAction, ctx?: PermissionContext): boolean {
    return can(session.currentUser, action, ctx)
  }

  return { session, user, isLoggedIn, isStaff, can: allowed }
}
