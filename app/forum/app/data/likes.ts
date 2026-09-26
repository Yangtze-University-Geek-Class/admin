import type { Post, User } from './types'

/**
 * The like control in every post's action row, the topic's first post
 * included (#143). A bare heart with a number next to it went unnoticed, so the
 * button says what it is: a heart, 「赞」 and the count (「赞 3」; just 「赞」
 * while nobody has liked the post), with a border like the row's 回复 button.
 * Once the viewer has liked the post the heart fills in and the button takes
 * the danger tone (red), so the highlight is a shape change as well as a
 * colour; `aria-pressed` says the same to a screen reader.
 *
 * Pure, so the label, the count, the pressed state and what a click does are
 * unit-tested (tests/likes.test.ts) instead of re-derived in PostCard.
 */
export interface LikeControl {
  /** The button's text, and its accessible name: the button carries no aria-label. */
  label: string
  count: number
  /** The viewer is among the likers. */
  liked: boolean
  /** Both classes written out, so UnoCSS keeps both rules (app/data is scanned). */
  icon: 'i-carbon-favorite' | 'i-carbon-favorite-filled'
  variant: 'secondary' | 'danger'
  /**
   * `toggle` for a viewer who may like; `prompt` for anyone else (a guest, or
   * nothing can be written right now). PostCard opens `loginOpen` for a
   * prompt, and LoginModal says why (`loginPromptToast` in data/access.ts):
   * sign in, the service is down, or it is read-only here.
   */
  click: 'toggle' | 'prompt'
}

export function likeControl(post: Pick<Post, 'likeUserIds'>, viewer: Pick<User, 'id'> | null, allowed: boolean): LikeControl {
  const count = post.likeUserIds.length
  const liked = !!viewer && post.likeUserIds.includes(viewer.id)
  return {
    label: count > 0 ? `赞 ${count}` : '赞',
    count,
    liked,
    icon: liked ? 'i-carbon-favorite-filled' : 'i-carbon-favorite',
    variant: liked ? 'danger' : 'secondary',
    click: viewer && allowed ? 'toggle' : 'prompt',
  }
}
