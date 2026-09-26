import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkPow, replyPowBody, sha256Hex, solvePow } from '../shared/pow'

// The server's check, verbatim from app/server/src/middleware/pow.ts (node:crypto, not Web Crypto),
// so a proof the browser finds is one the server accepts.
function serverAccepts(bodyForHash: string, difficulty: number, proof: { timestamp: number, nonce: string }): boolean {
  const hash = createHash('sha256').update(`${proof.timestamp}:${bodyForHash}:${proof.nonce}`).digest('hex')
  return proof.nonce.length > 0 && proof.nonce.length <= 32 && hash.startsWith('0'.repeat(difficulty))
}

describe('guest reply proof of work', () => {
  it('hashes UTF-8 text the way node:crypto does', async () => {
    const text = '1726000000000:t73:游客的回复 <b>:0'
    expect(await sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'))
  })

  it('binds the proof to the topic and the exact content', () => {
    expect(replyPowBody('t1001', '你好')).toBe('t1001:你好')
  })

  it('finds a nonce the server accepts, at the default difficulty', async () => {
    const body = replyPowBody('t73', '第一次来，请问机试用什么语言？')
    const proof = await solvePow(body, 3, { now: 1_726_000_000_000 })
    expect(proof.timestamp).toBe(1_726_000_000_000)
    expect(serverAccepts(body, 3, proof)).toBe(true)
    expect(await checkPow(body, 3, proof)).toBe(true)
  })

  it('is refused by the server once the content changes', async () => {
    const proof = await solvePow(replyPowBody('t73', '原文'), 3, { now: 1_726_000_000_000 })
    expect(serverAccepts(replyPowBody('t73', '改过的正文'), 3, proof)).toBe(false)
    expect(serverAccepts(replyPowBody('t9', '原文'), 3, proof)).toBe(false)
  })

  it('accepts difficulty 0 at once and refuses difficulties the page cannot finish', async () => {
    expect((await solvePow('x', 0, { now: 1 })).nonce).toBe('0')
    await expect(solvePow('x', 7)).rejects.toThrow(RangeError)
    await expect(solvePow('x', 1.5)).rejects.toThrow(RangeError)
  })
})
