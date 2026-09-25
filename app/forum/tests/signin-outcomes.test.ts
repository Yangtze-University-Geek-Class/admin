import { describe, expect, it } from 'vitest'
import { signinOutcomes } from '../shared/signin-outcomes'

describe('signinOutcomes', () => {
  it('does not promise readable posts on the 极客班 site build, which has none yet', () => {
    expect(signinOutcomes({ hasPosts: false }).not_member?.description).toBe('这个 GitHub 账号不在极客班的 GitHub 组织里。')
    expect(signinOutcomes({ hasPosts: true }).not_member?.description).toBe('这个 GitHub 账号不在极客班的 GitHub 组织里。不登录也能看帖子。')
  })

  it('keeps the other outcomes identical in both modes', () => {
    const site = signinOutcomes({ hasPosts: false })
    const other = signinOutcomes({ hasPosts: true })
    for (const reason of ['invite_pending', 'cancelled', 'failed'])
      expect(site[reason]).toEqual(other[reason])
  })
})
