import { spawn, spawnSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { waitForHttp } from './lib/cdp.mjs'

/**
 * Runs the whole browser-driven verification suite in order against **one**
 * dev server: the style guard and its self-test first (they need no server),
 * then the four phase acceptance scripts, then the all-routes smoke.
 *
 * The server is started only if port 3456 is free, and stopped only if this
 * script was the one that started it — running `pnpm dev` in another terminal
 * and then `pnpm verify` here is the normal case.
 */

const BASE = process.env.TUFF_FORUM_URL ?? 'http://localhost:3456'
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))

const STEPS = [
  { name: 'check:styles', args: ['scripts/check-styles.mjs'], needsServer: false },
  { name: 'check:styles --self-test', args: ['scripts/check-styles.mjs', '--self-test'], needsServer: false },
  { name: 'verify-shell', args: ['scripts/verify-shell.mjs'], needsServer: true },
  { name: 'verify-topics', args: ['scripts/verify-topics.mjs'], needsServer: true },
  { name: 'verify-topic-page', args: ['scripts/verify-topic-page.mjs'], needsServer: true },
  { name: 'verify-user-pages', args: ['scripts/verify-user-pages.mjs'], needsServer: true },
  { name: 'smoke-routes', args: ['scripts/smoke-routes.mjs'], needsServer: true },
]

async function isUp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return response.status === 200
  }
  catch {
    return false
  }
}

// `--steps verify-shell,smoke-routes` reruns part of the suite against a
// server that is already up. No flag runs everything, which is the gate.
const stepsIndex = process.argv.indexOf('--steps')
const wanted = stepsIndex === -1 ? null : new Set(process.argv[stepsIndex + 1].split(','))
const steps = wanted ? STEPS.filter(step => wanted.has(step.name)) : STEPS
if (!steps.length) {
  console.error(`--steps matched nothing; known steps: ${STEPS.map(step => step.name).join(', ')}`)
  process.exit(2)
}

let devServer = null
const needsServer = steps.some(step => step.needsServer)
if (!needsServer) {
  console.log('[verify] no browser step selected; not touching the dev server\n')
}
else if (await isUp(`${BASE}/`)) {
  console.log('[verify] reusing the dev server already on 3456\n')
}
else {
  console.log('[verify] no dev server on 3456; starting one for the whole suite')
  devServer = spawn('pnpm', ['dev'], { cwd: PROJECT_ROOT, stdio: 'ignore', detached: true })
  await waitForHttp(`${BASE}/`)
  console.log('[verify] dev server up\n')
}

const outcomes = []
try {
  for (const step of steps) {
    console.log(`\n${'─'.repeat(72)}\n▶ ${step.name}\n${'─'.repeat(72)}`)
    const started = Date.now()
    const result = spawnSync(process.execPath, step.args, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      env: { ...process.env, TUFF_FORUM_URL: BASE },
    })
    outcomes.push({
      name: step.name,
      code: result.status ?? (result.error ? `error: ${result.error.message}` : 'signal'),
      seconds: Math.round((Date.now() - started) / 100) / 10,
    })
  }
}
finally {
  if (devServer) {
    try {
      process.kill(-devServer.pid)
    }
    catch {
      // Already gone.
    }
  }
}

const width = Math.max(...outcomes.map(outcome => outcome.name.length))
console.log(`\n${'═'.repeat(72)}\nverify summary\n${'═'.repeat(72)}`)
for (const outcome of outcomes)
  console.log(`  ${outcome.code === 0 ? '✓' : '✗'} ${outcome.name.padEnd(width)}  ${String(outcome.seconds).padStart(6)}s  exit ${outcome.code}`)

const failed = outcomes.filter(outcome => outcome.code !== 0)
if (failed.length) {
  console.error(`\n${failed.length}/${outcomes.length} step(s) failed: ${failed.map(outcome => outcome.name).join(', ')}`)
  process.exit(1)
}
console.log(`\nall ${outcomes.length} steps passed`)
