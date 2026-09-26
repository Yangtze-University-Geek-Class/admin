import { describe, expect, it } from 'vitest'
import { accountMenu } from '~/data/account-menu'
import { parseMe } from '../shared/site-account'

describe('parseMe', () => {
  it('reads a signed-in answer', () => {
    expect(parseMe({ signed_in: true, login: 'ada', avatar_url: 'https://avatars.githubusercontent.com/u/1', console_link: true }))
      .toEqual({ login: 'ada', avatarUrl: 'https://avatars.githubusercontent.com/u/1', consoleLink: true })
  })

  it('hides 控制台 unless console_link is exactly true', () => {
    for (const console_link of [undefined, false, 'true', 1, null]) {
      const account = parseMe({ signed_in: true, login: 'ada', ...(console_link === undefined ? {} : { console_link }) })
      expect(account?.consoleLink).toBe(false)
      expect(accountMenu({ login: 'ada', consoleLink: account!.consoleLink, user: null }).items.map(item => item.key)).not.toContain('console')
    }
    const admin = parseMe({ signed_in: true, login: 'ada', console_link: true })
    expect(accountMenu({ login: 'ada', consoleLink: admin!.consoleLink, user: null }).items.map(item => item.key)).toContain('console')
  })

  it('treats anything but a signed-in answer with a login as signed out', () => {
    for (const body of [null, undefined, '<!doctype html>', {}, { signed_in: false, login: 'ada' }, { signed_in: 'yes', login: 'ada' }, { signed_in: true }, { signed_in: true, login: '' }, { signed_in: true, login: 42 }])
      expect(parseMe(body)).toBeNull()
  })

  it('keeps no avatar that is not a string', () => {
    expect(parseMe({ signed_in: true, login: 'ada', avatar_url: null })?.avatarUrl).toBeNull()
    expect(parseMe({ signed_in: true, login: 'ada', avatar_url: 7 })?.avatarUrl).toBeNull()
  })
})
