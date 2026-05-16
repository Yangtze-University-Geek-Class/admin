async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computePow(
  bodyForHash: string,
  difficulty: number,
  onProgress?: (tries: number) => void
): Promise<{ timestamp: number; nonce: string; tries: number }> {
  const timestamp = Date.now();
  const prefix = "0".repeat(difficulty);
  let n = 0;
  while (true) {
    const candidate = n.toString(36);
    const hex = await sha256Hex(`${timestamp}:${bodyForHash}:${candidate}`);
    if (hex.startsWith(prefix)) {
      return { timestamp, nonce: candidate, tries: n + 1 };
    }
    n++;
    if (n % 5000 === 0) {
      onProgress?.(n);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}
