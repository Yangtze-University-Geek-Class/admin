import { vi } from 'vitest'

export interface Call { url: string, method: string, body: unknown }

/** One queued answer; a function may hold its response back until the test lets it go. */
export type Answer = Response | (() => Response | Promise<Response>)

/** A fake core server on the global fetch: records every call and answers from a queue. */
export function fakeServer(...answers: Answer[]) {
  const calls: Call[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body })
    const next = answers.shift()
    if (!next)
      throw new Error(`unexpected call ${init.method} ${url}`)
    return typeof next === 'function' ? next() : next
  })
  vi.stubGlobal('fetch', fetch)
  return calls
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** An answer the test releases by hand, to look at the page while the request is still out. */
export function held() {
  let release!: (response: Response) => void
  const response = new Promise<Response>((resolve) => {
    release = resolve
  })
  return { answer: () => response, release }
}
