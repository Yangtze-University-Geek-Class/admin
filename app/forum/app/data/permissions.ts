import type { ForumCapability } from './titles'
import type { Post, Topic, User } from './types'
import { titleForumCapabilities } from './titles'

/**
 * Who may do what. Both the UI (to hide or explain a control) and the tests
 * consult this; store actions do not, so a page cannot forget to ask and
 * silently succeed — it has to render the control in the first place.
 */

export type ForumAction
  = | 'createTopic'
    | 'reply'
    | 'like'
    | 'bookmark'
    | 'follow'
    | 'editPost'
    | 'deletePost'
    | 'pinTopic'
    | 'closeTopic'
    | 'editProfile'
    | 'markNotification'

export interface PermissionContext {
  post?: Post
  topic?: Topic
  targetUser?: User
}

/**
 * Whether the user holds a forum capability of the 极客班 catalogue. An admin
 * or moderator by forum role holds all of them, as before; anyone else holds
 * what their title carries (`titleForumCapabilities`, the local default packs:
 * the server publishes no permission packs to the forum). The server has no
 * forum endpoint yet (issue #57), so this is the demo's reading of the future
 * contract, not an authorization boundary.
 */
export function hasForumCapability(user: User | null | undefined, capability: ForumCapability): boolean {
  if (!user)
    return false
  if (user.role === 'admin' || user.role === 'moderator')
    return true
  return titleForumCapabilities(user.title).has(capability)
}

/**
 * Forum staff (版务), as the console defines it: whoever may moderate posts —
 * an admin or moderator by role, the 提督 or the 舰长, or a head or crew
 * member whose department pack includes `forum.post.moderate`.
 */
export function isStaff(user: User | null | undefined): boolean {
  return hasForumCapability(user, 'forum.post.moderate')
}

export function can(user: User | null | undefined, action: ForumAction, ctx: PermissionContext = {}): boolean {
  if (!user)
    return false

  switch (action) {
    case 'createTopic':
    case 'like':
    case 'bookmark':
    case 'markNotification':
      return true

    // Capability per action, the contract in docs/services/forum/README.md:
    // forum.post.moderate covers others' posts and closed topics,
    // forum.topic.pin covers pinTopic, forum.topic.close covers closeTopic.
    case 'reply':
      return !ctx.topic?.closed || isStaff(user)

    case 'editPost':
    case 'deletePost':
      return ctx.post !== undefined && (ctx.post.authorId === user.id || isStaff(user))

    case 'pinTopic':
      return hasForumCapability(user, 'forum.topic.pin')

    case 'closeTopic':
      return hasForumCapability(user, 'forum.topic.close')

    case 'editProfile':
      return ctx.targetUser !== undefined && ctx.targetUser.id === user.id

    case 'follow':
      return ctx.targetUser !== undefined && ctx.targetUser.id !== user.id

    default:
      return false
  }
}
