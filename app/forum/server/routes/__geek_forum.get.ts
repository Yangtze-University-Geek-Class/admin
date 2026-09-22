import { snapshotConfigured } from '../utils/local-snapshot'

// Local supervisor identity only; this is not a forum business API or authentication.
export default defineEventHandler((event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404 })
  }
  setHeader(event, 'Cache-Control', 'no-store')
  const snapshot = snapshotConfigured()
  return {
    module: 'tuff-forum',
    instance: process.env.GEEK_FORUM_INSTANCE ?? '',
    // `local-snapshot` means the pages read the 极客班 archive through
    // /api/local-forum. It is a static read-only projection: no database is
    // connected, nothing is written, nobody is authenticated.
    mode: snapshot ? 'local-snapshot' : 'browser-demo',
    contentSource: snapshot ? 'local-snapshot' : 'upstream-seed',
    snapshotConfigured: snapshot,
    realAuthentication: false,
    serverPersistence: false,
  }
})
