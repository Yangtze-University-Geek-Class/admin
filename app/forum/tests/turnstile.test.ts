import type { TurnstileApi, TurnstileHost } from '../shared/turnstile'
import { describe, expect, it } from 'vitest'
import { loadTurnstile, TURNSTILE_SCRIPT } from '../shared/turnstile'

interface FakeScript { src: string, async: boolean, removed: boolean, onload: (() => void) | null, onerror: (() => void) | null, remove: () => void }

/** A page without a DOM: records the scripts it is asked to insert and the timers it is asked to start. */
function fakeHost() {
  const scripts: FakeScript[] = []
  const timers: Array<{ handler: () => void, cleared: boolean }> = []
  const host: TurnstileHost = {
    document: {
      createElement: (() => {
        const script: FakeScript = { src: '', async: false, removed: false, onload: null, onerror: null, remove: () => { script.removed = true } }
        return script
      }) as unknown as Document['createElement'],
      head: { appendChild: (node: FakeScript) => scripts.push(node) } as unknown as Document['head'],
    },
    setTimeout: (handler) => {
      timers.push({ handler, cleared: false })
      return timers.length - 1
    },
    clearTimeout: ((id: number) => {
      timers[id]!.cleared = true
    }) as never,
  }
  return { host, scripts, timers }
}

const API: TurnstileApi = { render: () => 'w1', reset: () => {}, remove: () => {} }

describe('loading Turnstile for a guest reply', () => {
  it('inserts the explicit-render script once and resolves with window.turnstile', async () => {
    const { host, scripts, timers } = fakeHost()
    const first = loadTurnstile(host)
    const second = loadTurnstile(host)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toMatchObject({ src: TURNSTILE_SCRIPT, async: true })
    host.turnstile = API
    scripts[0]!.onload?.()
    expect(await first).toBe(API)
    expect(await second).toBe(API)
    expect(timers[0]?.cleared).toBe(true)
    expect(await loadTurnstile(host)).toBe(API)
    expect(scripts).toHaveLength(1)
  })

  it('fails in plain Chinese when the script does not load, and tries again next time', async () => {
    const { host, scripts } = fakeHost()
    const attempt = loadTurnstile(host)
    scripts[0]!.onerror?.()
    await expect(attempt).rejects.toThrow('人机验证没有加载出来')
    expect(scripts[0]?.removed).toBe(true)
    void loadTurnstile(host)
    expect(scripts).toHaveLength(2)
  })

  it('gives up after the timeout instead of waiting forever', async () => {
    const { host, timers } = fakeHost()
    const attempt = loadTurnstile(host)
    timers[0]!.handler()
    await expect(attempt).rejects.toThrow('人机验证没有加载出来')
  })
})
