import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Minimal Chrome DevTools Protocol driver on top of Node's built-in
 * `WebSocket` (Node ≥ 22). No dependencies, one page, flat sessions.
 *
 * Chrome on macOS never exits on its own once a page holds a Vite HMR socket,
 * so every launch carries a watchdog that SIGKILLs the process after
 * `watchdogMs` regardless of what the caller did.
 */

const CHROME = process.env.TUFF_FORUM_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const PROBLEM_PATTERNS = [/\[Vue warn\]/, /Uncaught/, /Failed to resolve/, /\bError\b/, /\[nuxt\]/]

export async function launchChrome({ watchdogMs = 60_000, width = 1280, height = 800, chrome = CHROME } = {}) {
  if (!existsSync(chrome))
    throw new Error('No Chrome executable. Set TUFF_FORUM_CHROME to an installed Chrome/Chromium binary.')
  const port = await freePort()
  const userDataDir = mkdtempSync(join(tmpdir(), 'geek-tuff-forum-chrome-'))

  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', (error) => {
      rmSync(userDataDir, { recursive: true, force: true })
      reject(error)
    })
  })
  child.stderr.on('data', () => {})

  let closed = false
  function kill() {
    if (closed)
      return
    closed = true
    try {
      if (child.pid)
        process.kill(-child.pid, 'SIGKILL')
    }
    catch {
      // Already gone.
    }
    // Only the process group and mkdtemp profile created by this invocation.
    // Never use a process-name/pattern kill against the user's Chrome.
    rmSync(userDataDir, { recursive: true, force: true })
  }
  const watchdog = setTimeout(() => {
    console.error(`[cdp] watchdog: killing Chrome after ${watchdogMs} ms`)
    kill()
    process.exit(124)
  }, watchdogMs)
  watchdog.unref()
  process.on('exit', kill)

  const browserUrl = await waitForDebugger(port)
  const ws = new WebSocket(browserUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let nextId = 1
  const pending = new Map()
  const listeners = new Set()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error)
        reject(new Error(`${message.error.message} (${message.error.code})`))
      else
        resolve(message.result)
      return
    }
    if (message.method) {
      for (const listener of listeners)
        listener(message)
    }
  })

  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  function onEvent(handler) {
    listeners.add(handler)
    return () => listeners.delete(handler)
  }

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params) => send(method, params, sessionId)

  await page('Page.enable')
  await page('Runtime.enable')
  await page('Log.enable')

  /** Console output since the last `open()`/`reload()`. */
  let consoleBuffer = []
  onEvent((message) => {
    if (message.sessionId !== sessionId)
      return
    if (message.method === 'Runtime.consoleAPICalled') {
      const { type, args } = message.params
      const text = args.map(arg => arg.value !== undefined ? String(arg.value) : (arg.description ?? arg.type)).join(' ')
      consoleBuffer.push({ type, text })
    }
    else if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails
      consoleBuffer.push({ type: 'exception', text: details.exception?.description ?? details.text })
    }
    else if (message.method === 'Log.entryAdded') {
      const { level, text, source } = message.params.entry
      consoleBuffer.push({ type: `log:${level}`, text: `[${source}] ${text}` })
    }
  })

  function waitForEvent(method, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error(`timeout waiting for ${method}`))
      }, timeoutMs)
      const off = onEvent((message) => {
        if (message.sessionId === sessionId && message.method === method) {
          clearTimeout(timer)
          off()
          resolve(message.params)
        }
      })
    })
  }

  async function evaluate(expression) {
    const { result, exceptionDetails } = await page('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (exceptionDetails)
      throw new Error(`evaluate failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}\n  ${expression}`)
    return result.value
  }

  /** Polls `expression` until it is truthy. */
  async function waitFor(expression, { timeoutMs = 15_000, intervalMs = 100 } = {}) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = await evaluate(expression)
      if (value)
        return value
      if (Date.now() > deadline)
        throw new Error(`waitFor timed out: ${expression}`)
      await sleep(intervalMs)
    }
  }

  async function open(url, { idleMs = 500 } = {}) {
    consoleBuffer = []
    const loaded = waitForEvent('Page.loadEventFired')
    await page('Page.navigate', { url })
    await loaded
    await sleep(idleMs)
  }

  async function reload({ idleMs = 500 } = {}) {
    consoleBuffer = []
    const loaded = waitForEvent('Page.loadEventFired')
    await page('Page.reload')
    await loaded
    await sleep(idleMs)
  }

  async function emulate({ width: w, height: h, mobile = false, deviceScaleFactor = 1 }) {
    await page('Emulation.setDeviceMetricsOverride', { width: w, height: h, mobile, deviceScaleFactor })
    // Let media queries and resize listeners settle.
    await sleep(150)
  }

  async function screenshot(path) {
    const { data } = await page('Page.captureScreenshot', { format: 'png' })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.from(data, 'base64'))
  }

  async function key(keyName, { code, keyCode, modifiers = 0 } = {}) {
    const base = { key: keyName, code: code ?? `Key${keyName.toUpperCase()}`, windowsVirtualKeyCode: keyCode ?? keyName.toUpperCase().charCodeAt(0), modifiers }
    await page('Input.dispatchKeyEvent', { type: 'keyDown', ...base })
    await page('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  async function type(text) {
    await page('Input.insertText', { text })
  }

  function console_() {
    return consoleBuffer.slice()
  }

  function problems() {
    return consoleBuffer.filter(entry =>
      entry.type === 'exception'
      || entry.type === 'error'
      || entry.type === 'warning'
      || entry.type === 'log:error'
      || PROBLEM_PATTERNS.some(pattern => pattern.test(entry.text)))
  }

  async function close() {
    clearTimeout(watchdog)
    try {
      ws.close()
    }
    catch {
      // Socket already closed by Chrome.
    }
    kill()
  }

  return { port, send: page, evaluate, waitFor, open, reload, emulate, screenshot, key, type, console: console_, problems, close, sleep }
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForDebugger(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        const { webSocketDebuggerUrl } = await response.json()
        if (webSocketDebuggerUrl)
          return webSocketDebuggerUrl
      }
    }
    catch {
      // Not listening yet.
    }
    if (Date.now() > deadline)
      throw new Error('Chrome did not expose a DevTools endpoint in time')
    await sleep(100)
  }
}

/** Waits until `url` answers 200. */
export async function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(url)
      if (response.status === 200)
        return
    }
    catch {
      // Server still starting.
    }
    if (Date.now() > deadline)
      throw new Error(`${url} did not answer 200 within ${timeoutMs} ms`)
    await sleep(250)
  }
}
