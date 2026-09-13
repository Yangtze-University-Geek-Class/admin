import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolveAsset } from '../../../../../shared/local-snapshot'
import { assetFilePath, loadLocalSnapshot, requireSnapshotRoute, snapshotHttpError } from '../../../../utils/local-snapshot'

/**
 * Serves one normalised attachment by its SHA-256. Only hashes present in
 * `asset-index.json` resolve, the file must sit inside the snapshot's
 * `assets/` directory, and its size must match the index; the response
 * carries the index's content type and disposition, never the original
 * upload name. GET and HEAD only; single byte ranges are honoured so the
 * archived videos can seek. Body headers are set only on the success path,
 * and the file stream is destroyed if the client goes away early.
 */
export default defineEventHandler(async (event) => {
  requireSnapshotRoute(event)
  setHeader(event, 'Content-Security-Policy', 'default-src \'none\'; sandbox')

  const snapshot = await loadLocalSnapshot().catch((error: unknown) => {
    throw snapshotHttpError(error)
  })
  const entry = resolveAsset(snapshot.assets, getRouterParam(event, 'hash') ?? '')
  const file = entry ? assetFilePath(snapshot, entry) : null
  if (!entry || !file)
    throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { error: 'asset_not_found' } })

  const info = await stat(file).catch(() => null)
  if (!info?.isFile())
    throw createError({ statusCode: 404, statusMessage: 'Not Found', data: { error: 'asset_missing_on_disk' } })
  if (info.size !== entry.bytes)
    throw createError({ statusCode: 500, statusMessage: 'Asset Integrity', data: { error: 'asset_size_mismatch' } })

  const range = parseRange(getHeader(event, 'range'), entry.bytes)
  if (range === 'unsatisfiable') {
    setHeader(event, 'Accept-Ranges', 'bytes')
    setHeader(event, 'Content-Range', `bytes */${entry.bytes}`)
    throw createError({ statusCode: 416, statusMessage: 'Range Not Satisfiable', data: { error: 'range_not_satisfiable' } })
  }

  setHeader(event, 'Content-Type', entry.mime)
  setHeader(event, 'Content-Disposition', entry.disposition)
  setHeader(event, 'Accept-Ranges', 'bytes')
  if (range) {
    setResponseStatus(event, 206)
    setHeader(event, 'Content-Range', `bytes ${range.start}-${range.end}/${entry.bytes}`)
    setHeader(event, 'Content-Length', range.end - range.start + 1)
  }
  else {
    setHeader(event, 'Content-Length', entry.bytes)
  }
  if (event.method === 'HEAD')
    return send(event)

  // The client may already be gone by the time the awaits above settle; a
  // stream created for a dead response would never be piped nor destroyed.
  if (event.node.res.destroyed || event.node.res.writableEnded)
    return
  const stream = createReadStream(file, range ? { start: range.start, end: range.end } : undefined)
  event.node.res.once('close', () => stream.destroy())
  return sendStream(event, stream)
})

/** `bytes=start-end` with either side optional; multi-range requests fall back to the full body. */
function parseRange(header: string | undefined, size: number): { start: number, end: number } | 'unsatisfiable' | null {
  if (!header || size === 0)
    return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match)
    return null
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '')
    return null
  let start: number
  let end: number
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (suffix === 0)
      return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  }
  else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start >= size || start > end)
    return 'unsatisfiable'
  return { start, end }
}
