/**
 * 极客班论坛现在是什么样：顶部提示条（AdoptionNotice.vue）、关于页和 llms.txt 的说明共用这几句，改一处全跟着变。
 * 不写放出了哪几类帖子：公开的旧帖随 `content/published` 增减，写死了迟早和页面对不上。
 */
export const SITE_NOTICE = {
  /** 所有人都看到。 */
  published: '旧论坛的一部分帖子已经公开在这里。',
  /** 没登录的人才看到（提示条等 `/auth/me` 返回后再显示，已登录的人不会先看到再消失）。 */
  guests: '不登录也能看帖和用昵称回复；发新话题、点赞、收藏和关注要先用 GitHub 登录，只有极客班成员能登录。',
} as const

/** llms.txt 开头说明里关于极客班论坛的那几句：同样的现状，再说明这份索引不含之后发的内容。 */
export function siteMarkdownNotice(): string {
  return `${SITE_NOTICE.published}${SITE_NOTICE.guests}这份索引只列构建时公开的帖子，之后在论坛里发的话题和回复要在论坛页面上看。`
}
