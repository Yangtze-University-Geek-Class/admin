import { readFileSync } from 'node:fs'
// 源站从环境文件读（三份相同），不在测试里写死。
const CDN_ORIGIN = /^STATIC_CDN_ORIGIN=(.+)$/m.exec(readFileSync(new URL('../../../deploy/env/.env.production', import.meta.url), 'utf8'))?.[1]?.trim() ?? ''
// Test transport only. Requests use buildApp's real routes and in-memory SQLite.
import type { buildApp as BuildApp } from '../../../app/server/src/app'
import type { ServiceOverrides } from '../../../app/server/src/services'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { 'core-root': { type: 'string' }, 'evidence-dir': { type: 'string' } } })
if (!values['core-root'] || !values['evidence-dir']) throw new Error('Use tests/integration/forum-editor/run.mjs.')
const coreRoot = values['core-root']
const evidence = values['evidence-dir']
const deny = () => { throw new Error('External network denied in forum-editor fixture') }
globalThis.fetch = deny as typeof fetch
// The launcher checks source equality before an explicitly prepared checkout
// may provide native dependencies. No copied handler or alternate app exists.
const { buildApp }: { buildApp: typeof BuildApp } = await import(pathToFileURL(join(coreRoot, 'app/server/src/app.ts')).href)
const helpersModule = await import(pathToFileURL(join(coreRoot, 'tests/server/helpers.ts')).href)
const { testConfig, signIn, accountIdOf, grantPermGroup } = (helpersModule.default ?? helpersModule) as typeof import('../../server/helpers')
const requests: object[] = []
let app: Awaited<ReturnType<typeof BuildApp>> | undefined
let topicId: string | undefined
let sid: string
let origin: string

const server = createServer(async (req, res) => {
  try {
    if (!app || !topicId) { res.writeHead(503).end(); return }
    const path = req.url ?? '/'
    if (req.method === 'GET' && path === '/__a4/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ fixture: 'A4', database: ':memory:', externalRequests: false, topicId }))
      return
    }
    if (!(req.method === 'POST' && path === '/api/forum/posts')
      && !(req.method === 'GET' && /^\/api\/forum\/topics\/[a-z0-9]+\/posts$/.test(path))) {
      res.writeHead(404).end(); return
    }
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks)
    // Only this synthetic member is available. Cookies and Set-Cookie never
    // enter IPC, HTTP responses, stdout or evidence.
    const reply = await app.inject({
      method: req.method as 'GET' | 'POST', url: path,
      headers: { origin, cookie: `sid=${sid}`, ...(body.length ? { 'content-type': 'application/json' } : {}) },
      payload: body.length ? body : undefined, remoteAddress: '127.0.0.1',
    })
    requests.push({
      at: new Date().toISOString(), method: req.method, path, status: reply.statusCode,
      ...(body.length ? { request: JSON.parse(body.toString()) } : {}), response: reply.json(),
    })
    await writeFile(join(evidence, 'http.json'), `${JSON.stringify(requests, null, 2)}\n`, { mode: 0o600 })
    res.writeHead(reply.statusCode, { 'Content-Type': 'application/json' })
    res.end(reply.rawPayload)
  }
  catch (error) {
    console.error(error)
    res.writeHead(500).end()
  }
})

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  server.closeIdleConnections()
  await new Promise<void>(done => server.close(() => done()))
  await app?.close()
  if (process.connected) process.disconnect()
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => { void stop().catch(error => { console.error(error); process.exitCode = 1 }) })

try {
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  origin = `http://127.0.0.1:${address.port}`
  app = await buildApp({
    config: testConfig({
      NODE_ENV: 'test', PUBLIC_ORIGIN: origin, STATIC_CDN_ORIGIN: CDN_ORIGIN, DB_PATH: ':memory:',
      SESSION_SECRET: randomBytes(32).toString('hex'),
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      OAUTH_CLIENT_ID: 'forum-editor-fixture', OAUTH_CLIENT_SECRET: randomBytes(32).toString('hex'),
    }),
    staticRoot: false,
    overrides: {
      httpRequest: deny as unknown as ServiceOverrides['httpRequest'],
      octokitFactory: deny, mailFetch: deny as unknown as ServiceOverrides['mailFetch'],
    },
  })
  await app.ready()
  sid = signIn(app, 'a4_fixture', 8274001, null, '')
  grantPermGroup(app, accountIdOf(app, 'a4_fixture'), 'level.member')
  const created = await app.inject({
    method: 'POST', url: '/api/forum/topics', headers: { origin, cookie: `sid=${sid}` },
    payload: { title: '编辑器隔离换行回归', categoryId: 'c-exam', tags: [], content: '仅合成夹具' },
  })
  if (created.statusCode !== 201) throw new Error(`Fixture topic refused: ${created.statusCode}`)
  topicId = created.json().topicId
  const ready = { fixture: 'forum-editor', origin, topicId, pid: process.pid, node: process.version, database: ':memory:', externalRequests: false }
  await writeFile(join(evidence, 'runtime.json'), `${JSON.stringify(ready, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify(ready))
  if (!process.send) throw new Error('Fixture requires its integration launcher IPC channel.')
  process.send(ready)
}
catch (error) {
  console.error(error)
  process.exitCode = 1
  await stop()
}
