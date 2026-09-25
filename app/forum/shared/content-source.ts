/**
 * Which content the forum is built with, and how people sign in. Read once by
 * nuxt.config.ts from the build environment; pure and Nuxt-free so the
 * vitest suite can drive every combination.
 *
 * - `site`: 极客班论坛 itself — the name, the curated categories and tags of
 *   `content/curation.json`, and nothing else. No topics, posts, users or
 *   notifications until the forum has a backend. The deployed images are
 *   built this way (`GEEK_FORUM_SOURCE=site`).
 * - `upstream-seed`: the upstream Tuff Forum demo seed. The upstream CDP
 *   suites and the local demo preview run on it; `GEEK_FORUM_SOURCE=demo`
 *   forces it.
 * - `local-snapshot`: the private read-only 极客班 archive named by
 *   `GEEK_FORUM_CONTENT_DIR`, served by the dev server only.
 */

export type ContentSource = 'upstream-seed' | 'local-snapshot' | 'site'
export type LoginMode = 'demo' | 'site'

export const GEEK_SITE_NAME = '极客班论坛'
export const UPSTREAM_SITE_NAME = 'Tuff Forum'

/** `process.env` or a test double; only the three variables below are read. */
export interface ContentSourceEnv {
  [name: string]: string | undefined
  GEEK_FORUM_SOURCE?: string
  GEEK_FORUM_CONTENT_DIR?: string
  GEEK_FORUM_LOGIN?: string
}

export interface ContentSourceSelection {
  contentSource: ContentSource
  /** Snapshot directory for the dev-only local-forum routes; `''` unless `local-snapshot`. */
  contentDir: string
  siteName: string
  loginMode: LoginMode
}

/**
 * - `GEEK_FORUM_SOURCE=demo` → the upstream seed, whatever else is set (this
 *   is how check/verify stay on the seed even if a stray `.env` names a
 *   snapshot directory);
 * - `GEEK_FORUM_SOURCE=site` → 极客班论坛 without any content directory;
 * - unset or empty → the snapshot when `GEEK_FORUM_CONTENT_DIR` is non-empty,
 *   the upstream seed otherwise;
 * - any other value is a typo and fails the build instead of quietly
 *   shipping the demo.
 *
 * The login mode is independent: the site-wide GitHub login everywhere,
 * except the upstream seed with `GEEK_FORUM_LOGIN=demo`, which keeps the
 * upstream "pick an identity" for the CDP suites and the local demo preview.
 */
export function selectContentSource(env: ContentSourceEnv): ContentSourceSelection {
  const source = env.GEEK_FORUM_SOURCE ?? ''
  let contentSource: ContentSource
  let contentDir = ''
  if (source === 'demo') {
    contentSource = 'upstream-seed'
  }
  else if (source === 'site') {
    contentSource = 'site'
  }
  else if (source === '') {
    contentDir = (env.GEEK_FORUM_CONTENT_DIR ?? '').trim()
    contentSource = contentDir ? 'local-snapshot' : 'upstream-seed'
  }
  else {
    throw new Error(`GEEK_FORUM_SOURCE 只能是 demo、site 或不设置，收到 ${JSON.stringify(source)}`)
  }
  return {
    contentSource,
    contentDir,
    siteName: contentSource === 'upstream-seed' ? UPSTREAM_SITE_NAME : GEEK_SITE_NAME,
    loginMode: contentSource === 'upstream-seed' && env.GEEK_FORUM_LOGIN === 'demo' ? 'demo' : 'site',
  }
}
