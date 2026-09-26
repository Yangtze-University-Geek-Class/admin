/**
 * 游客回复前在浏览器里算的工作量证明，算法与核心服务 `app/server/src/middleware/pow.ts` 的 `checkPow`
 * 一致：找一个 nonce，使 sha256(`${timestamp}:${bodyForHash}:${nonce}`) 的十六进制以 `difficulty` 个 0 开头。
 * 论坛回复的 bodyForHash 是 `${topicId}:${content}`（接口约定），难度取 `state.guestPolicy.powDifficulty`。
 *
 * 只用浏览器自带的 Web Crypto（Node 26 也有同一个 `crypto.subtle`，单测直接跑），不引入哈希库。
 * nonce 用十进制计数的 36 进制写法，和官网 `app/web/shared/lib/pow.ts` 相同；服务端只要求 1–32 个字符。
 */

export interface PowProof {
  timestamp: number
  nonce: string
}

/** 服务端允许的难度是 0–5（POW_DIFFICULTY）；再高浏览器要算很久，直接拒绝而不是让页面卡住。 */
export const MAX_POW_DIFFICULTY = 6

/** 一批并发算多少个哈希：`subtle.digest` 是异步的，逐个 await 太慢。 */
const BATCH = 64

const encoder = new TextEncoder()

export function replyPowBody(topicId: string, content: string): string {
  return `${topicId}:${content}`
}

export async function sha256Hex(text: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const digest = await subtle.digest('SHA-256', encoder.encode(text))
  let hex = ''
  for (const byte of new Uint8Array(digest))
    hex += byte.toString(16).padStart(2, '0')
  return hex
}

export interface SolveOptions {
  /** 证明里的时间戳；默认现在。服务端只接受与它的时钟相差 5 分钟以内的证明。 */
  now?: number
  subtle?: SubtleCrypto
}

export async function solvePow(bodyForHash: string, difficulty: number, options: SolveOptions = {}): Promise<PowProof> {
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > MAX_POW_DIFFICULTY)
    throw new RangeError(`PoW difficulty must be an integer from 0 to ${MAX_POW_DIFFICULTY}, got ${difficulty}`)
  const timestamp = options.now ?? Date.now()
  const subtle = options.subtle ?? globalThis.crypto.subtle
  const prefix = '0'.repeat(difficulty)
  const base = `${timestamp}:${bodyForHash}:`
  for (let start = 0; ; start += BATCH) {
    const nonces = Array.from({ length: BATCH }, (_, index) => (start + index).toString(36))
    const hashes = await Promise.all(nonces.map(nonce => sha256Hex(base + nonce, subtle)))
    const hit = hashes.findIndex(hash => hash.startsWith(prefix))
    if (hit >= 0)
      return { timestamp, nonce: nonces[hit] as string }
  }
}

/** 与服务端同一条判定，给单测和调试用：时间窗口由服务端另查。 */
export async function checkPow(bodyForHash: string, difficulty: number, proof: PowProof, subtle?: SubtleCrypto): Promise<boolean> {
  if (!proof.nonce || proof.nonce.length > 32)
    return false
  const hash = await sha256Hex(`${proof.timestamp}:${bodyForHash}:${proof.nonce}`, subtle)
  return hash.startsWith('0'.repeat(difficulty))
}
