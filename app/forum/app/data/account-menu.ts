import type { User } from './types'

/**
 * The avatar menu under the site-wide login (ForumHeader → AccountMenu).
 * Every row carries a Carbon icon; the header row names who is signed in.
 *
 * 控制台 appears only when `/auth/me` says `console_link: true` (someone who
 * can manage something there); ordinary members and 领航员 never see it. The
 * rows that need a forum user (主页, 资料, 书签, 通知) are left out while the
 * forum server is unreachable or in the read-only modes, where there is no
 * forum user to open.
 */
export type AccountMenuKey = 'profile' | 'preferences' | 'bookmarks' | 'notifications' | 'console' | 'portal' | 'about' | 'signout'

export interface AccountMenuItem {
  key: AccountMenuKey
  label: string
  /** UnoCSS icon class, `i-carbon-*`: written out here so the scanner keeps each rule. */
  icon: string
  danger?: boolean
}

export interface AccountMenu {
  /** 昵称 when there is a forum user, the login otherwise. */
  title: string
  /** `@login` under the 昵称; empty when the title already is the login. */
  subtitle: string
  items: AccountMenuItem[]
}

export interface AccountMenuInput {
  login: string
  consoleLink: boolean
  user: Pick<User, 'username' | 'displayName'> | null
}

export function accountMenu({ login, consoleLink, user }: AccountMenuInput): AccountMenu {
  const items: AccountMenuItem[] = []
  if (user) {
    items.push(
      { key: 'profile', label: '我的主页', icon: 'i-carbon-user' },
      { key: 'preferences', label: '账号资料', icon: 'i-carbon-user-profile' },
      { key: 'bookmarks', label: '我的书签', icon: 'i-carbon-bookmark' },
      { key: 'notifications', label: '通知', icon: 'i-carbon-notification' },
    )
  }
  if (consoleLink)
    items.push({ key: 'console', label: '控制台', icon: 'i-carbon-dashboard' })
  items.push(
    { key: 'portal', label: '返回宣传主页', icon: 'i-carbon-home' },
    { key: 'about', label: '查看环境与版本', icon: 'i-carbon-information' },
    { key: 'signout', label: '退出', icon: 'i-carbon-logout', danger: true },
  )
  return user
    ? { title: user.displayName, subtitle: `@${login}`, items }
    : { title: `@${login}`, subtitle: '', items }
}
