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
 * The capabilities the forum server computed for the signed-in viewer
 * (`state.viewer.capabilities`). When the pages run against the server they
 * pass it, and it is the only answer: a title or role on the user object no
 * longer grants anything by itself. The demo and the snapshot pass nothing.
 */
export type GrantedCapabilities = ReadonlySet<string>

/**
 * Whether the user holds a forum capability of the 极客班 catalogue. Against
 * the forum server, exactly what the server granted the viewer. Otherwise, an
 * admin or moderator by forum role holds all of them, as before; anyone else
 * holds what their title carries (`titleForumCapabilities`, the local default
 * packs). That fallback is the demo's reading of the contract, not an
 * authorization boundary; the server re-checks every write.
 */
export function hasForumCapability(user: User | null | undefined, capability: ForumCapability, granted?: GrantedCapabilities): boolean {
  if (!user)
    return false
  if (granted)
    return granted.has(capability)
  if (user.role === 'admin' || user.role === 'moderator')
    return true
  return titleForumCapabilities(user.title).has(capability)
}

/**
 * Forum staff (版务), as the console defines it: whoever may moderate posts —
 * an admin or moderator by role, the 提督 or the 舰长, or a head or crew
 * member whose department pack includes `forum.post.moderate`.
 */
export function isStaff(user: User | null | undefined, granted?: GrantedCapabilities): boolean {
  return hasForumCapability(user, 'forum.post.moderate', granted)
}

/**
 * `granted` is the server's answer for `user` (see `GrantedCapabilities`);
 * leave it out in the demo. A guest account (`kind: 'guest'`) never signs in,
 * so it can do nothing here: guest replies go through their own path.
 */
export function can(user: User | null | undefined, action: ForumAction, ctx: PermissionContext = {}, granted?: GrantedCapabilities): boolean {
  if (!user || user.kind === 'guest')
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
      return !ctx.topic?.closed || isStaff(user, granted)

    case 'editPost':
    case 'deletePost':
      return ctx.post !== undefined && (ctx.post.authorId === user.id || isStaff(user, granted))

    case 'pinTopic':
      return hasForumCapability(user, 'forum.topic.pin', granted)

    case 'closeTopic':
      return hasForumCapability(user, 'forum.topic.close', granted)

    case 'editProfile':
      return ctx.targetUser !== undefined && ctx.targetUser.id === user.id

    case 'follow':
      return ctx.targetUser !== undefined && ctx.targetUser.id !== user.id

    default:
      return false
  }
}
