import type { ForumAction, PermissionContext } from '~/data/permissions'
import type { Topic } from '~/data/types'
import { forumAccess, guestMayReply } from '~/data/access'
import { can, isStaff as isStaffUser } from '~/data/permissions'

/**
 * The session store plus the permission check every write control asks
 * before it renders. `user` is `null` for guests.
 *
 * Against the forum server, moderation rights are the server's
 * `viewer.capabilities` and nothing else; `access` says whether writing is
 * possible at all (the server may be unreachable) and whether a guest may
 * reply under a nickname.
 */
export function useCurrentUser() {
  const session = useSessionStore()
  const server = useForumServerStore()
  const { mode, serverMode } = useContentSource()

  const user = computed(() => session.currentUser)
  const isLoggedIn = computed(() => session.isLoggedIn)
  const granted = computed(() => (serverMode ? server.granted : undefined))
  const isStaff = computed(() => isStaffUser(session.currentUser, granted.value))
  const access = computed(() => forumAccess(mode, server.status, session.currentUser))

  function allowed(action: ForumAction, ctx?: PermissionContext): boolean {
    return access.value.writable && can(session.currentUser, action, ctx, granted.value)
  }

  function guestCanReply(topic: Topic): boolean {
    return guestMayReply(access.value, topic)
  }

  return { session, user, isLoggedIn, isStaff, access, can: allowed, guestCanReply }
}
