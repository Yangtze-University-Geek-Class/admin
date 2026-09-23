// Proof-of-work guard used before public submissions (feedback / invite / join).
// Synchronous SHA-256 via @noble/hashes; yields every batch to keep the UI responsive.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const enc = new TextEncoder();

function hashHex(s: string): string {
  return bytesToHex(sha256(enc.encode(s)));
}

export async function computePow(
  bodyForHash: string,
  difficulty: number,
  onProgress?: (tries: number) => void,
): Promise<{ timestamp: number; nonce: string; tries: number }> {
  const timestamp = Date.now();
  const prefix = "0".repeat(difficulty);
  const base = `${timestamp}:${bodyForHash}:`;

  const BATCH = 20000;
  let n = 0;
  while (true) {
    for (let i = 0; i < BATCH; i++) {
      const candidate = n.toString(36);
      const hex = hashHex(base + candidate);
      if (hex.startsWith(prefix)) {
        return { timestamp, nonce: candidate, tries: n + 1 };
      }
      n++;
    }
    onProgress?.(n);
    await new Promise((r) => setTimeout(r, 0));
  }
}

/**
 * 提交给服务端的 PoW 证明：接口契约只接受 { timestamp, nonce }（additionalProperties: false），
 * computePow 额外返回的 tries 只用于界面进度，不能原样发出去。
 */
export function powProof(pow: { timestamp: number; nonce: string }): { timestamp: number; nonce: string } {
  return { timestamp: pow.timestamp, nonce: pow.nonce };
}
