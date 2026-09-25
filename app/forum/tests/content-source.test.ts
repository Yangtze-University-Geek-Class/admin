import { describe, expect, it } from 'vitest'
import { GEEK_SITE_NAME, selectContentSource, siteNameInText, UPSTREAM_SITE_NAME } from '../shared/content-source'

// Every build reads its content source from these three variables (nuxt.config.ts).
// The directory values are made up; nothing here reads a real snapshot.
const DIR = '/tmp/made-up-snapshot'

describe('selectContentSource', () => {
  it('builds 极客班论坛 for GEEK_FORUM_SOURCE=site and never takes a content directory', () => {
    expect(selectContentSource({ GEEK_FORUM_SOURCE: 'site', GEEK_FORUM_CONTENT_DIR: DIR })).toEqual({
      contentSource: 'site',
      contentDir: '',
      siteName: GEEK_SITE_NAME,
      loginMode: 'site',
    })
  })

  it('keeps the site-wide login for a site build even when the demo login is asked for', () => {
    expect(selectContentSource({ GEEK_FORUM_SOURCE: 'site', GEEK_FORUM_LOGIN: 'demo' }).loginMode).toBe('site')
  })

  it('forces the upstream seed for GEEK_FORUM_SOURCE=demo, whatever directory is set', () => {
    expect(selectContentSource({ GEEK_FORUM_SOURCE: 'demo', GEEK_FORUM_CONTENT_DIR: DIR })).toEqual({
      contentSource: 'upstream-seed',
      contentDir: '',
      siteName: UPSTREAM_SITE_NAME,
      loginMode: 'site',
    })
  })

  it('uses the snapshot when no source is set and a directory is', () => {
    expect(selectContentSource({ GEEK_FORUM_CONTENT_DIR: `  ${DIR}  ` })).toEqual({
      contentSource: 'local-snapshot',
      contentDir: DIR,
      siteName: GEEK_SITE_NAME,
      loginMode: 'site',
    })
    expect(selectContentSource({ GEEK_FORUM_SOURCE: '', GEEK_FORUM_CONTENT_DIR: DIR }).contentSource).toBe('local-snapshot')
  })

  it('falls back to the upstream seed with nothing set, or a blank directory', () => {
    expect(selectContentSource({})).toEqual({ contentSource: 'upstream-seed', contentDir: '', siteName: UPSTREAM_SITE_NAME, loginMode: 'site' })
    expect(selectContentSource({ GEEK_FORUM_CONTENT_DIR: '   ' }).contentSource).toBe('upstream-seed')
  })

  it('offers the demo login only on the upstream seed', () => {
    expect(selectContentSource({ GEEK_FORUM_SOURCE: 'demo', GEEK_FORUM_LOGIN: 'demo' }).loginMode).toBe('demo')
    expect(selectContentSource({ GEEK_FORUM_LOGIN: 'demo' }).loginMode).toBe('demo')
    expect(selectContentSource({ GEEK_FORUM_CONTENT_DIR: DIR, GEEK_FORUM_LOGIN: 'demo' }).loginMode).toBe('site')
    expect(selectContentSource({ GEEK_FORUM_SOURCE: 'demo', GEEK_FORUM_LOGIN: 'yes' }).loginMode).toBe('site')
  })

  it('fails the build on any other source value instead of shipping the demo', () => {
    for (const value of ['Site', 'snapshot', 'production', ' site'])
      expect(() => selectContentSource({ GEEK_FORUM_SOURCE: value })).toThrow(/GEEK_FORUM_SOURCE/)
  })
})

describe('siteNameInText', () => {
  it('spaces a Latin site name inside Chinese text and leaves a Chinese one tight', () => {
    expect(`来自${siteNameInText(UPSTREAM_SITE_NAME)}的系统消息`).toBe('来自 Tuff Forum 的系统消息')
    expect(`来自${siteNameInText(GEEK_SITE_NAME)}的系统消息`).toBe('来自极客班论坛的系统消息')
    expect(`关于${siteNameInText(GEEK_SITE_NAME).trimEnd()}`).toBe('关于极客班论坛')
  })
})
