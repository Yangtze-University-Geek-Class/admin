import type { Post, Topic, User } from './types'

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

export function isStaff(user: User | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'moderator'
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

    case 'reply':
      return !ctx.topic?.closed || isStaff(user)

    case 'editPost':
    case 'deletePost':
      return ctx.post !== undefined && (ctx.post.authorId === user.id || isStaff(user))

    case 'pinTopic':
    case 'closeTopic':
      return isStaff(user)

    case 'editProfile':
      return ctx.targetUser !== undefined && ctx.targetUser.id === user.id

    case 'follow':
      return ctx.targetUser !== undefined && ctx.targetUser.id !== user.id

    default:
      return false
  }
}
