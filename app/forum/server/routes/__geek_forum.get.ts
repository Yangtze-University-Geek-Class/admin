import { snapshotConfigured } from '../utils/local-snapshot'

// Local supervisor identity only; this is not a forum business API or authentication.
export default defineEventHandler((event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404 })
  }
  setHeader(event, 'Cache-Control', 'no-store')
  const snapshot = snapshotConfigured()
  const { contentSource } = useRuntimeConfig().public
  return {
    module: 'tuff-forum',
    instance: process.env.GEEK_FORUM_INSTANCE ?? '',
    // `local-snapshot` means the pages read the 极客班 archive through
    // /api/local-forum. It is a static read-only projection: no database is
    // connected, nothing is written, nobody is authenticated. `site` is
    // 极客班论坛 as the images are built: its own categories and tags and the
    // old-forum documents it publishes (content/published); no forum content
    // or session is kept in the browser (theme and sidebar preferences are).
    mode: snapshot ? 'local-snapshot' : contentSource === 'site' ? 'site' : 'browser-demo',
    contentSource: snapshot ? 'local-snapshot' : contentSource,
    snapshotConfigured: snapshot,
    realAuthentication: false,
    serverPersistence: false,
  }
})
