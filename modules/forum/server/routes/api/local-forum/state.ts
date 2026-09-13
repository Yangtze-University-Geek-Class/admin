import { SNAPSHOT_MODE, SNAPSHOT_SCHEMA_VERSION } from '../../../../shared/local-snapshot'
import { loadLocalSnapshot, requireSnapshotRoute, snapshotHttpError } from '../../../utils/local-snapshot'

/**
 * The whole read-only forum state in one response. The client validates it
 * with the same parser the server used, so the payload is the snapshot
 * document shape rather than a bare state.
 *
 * Not an authenticated or writable business API: there is no session, no
 * pagination and no mutation here, and the route answers 404 outside the dev
 * server or when no snapshot directory is configured.
 */
export default defineEventHandler(async (event) => {
  requireSnapshotRoute(event)
  try {
    const { document } = await loadLocalSnapshot()
    if (event.method === 'HEAD') {
      setHeader(event, 'Content-Type', 'application/json')
      return send(event)
    }
    return {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      mode: SNAPSHOT_MODE,
      capturedAt: document.capturedAt,
      summary: document.summary,
      state: document.state,
    }
  }
  catch (error) {
    throw snapshotHttpError(error)
  }
})
