import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SHIELD_POINTS } from "../lib/shield.js";

/**
 * `consumeNonce`（PENTEST-20261029 finding 8）：同一份 PoW 只认一次。原来只校验前导零、不消费 nonce，
 * 一段 4096 次哈希算出来的证明能被无限重放（改 category/contact 也照样通过），防刷退化成只剩 IP 限速。
 * 由 services.ts 接到 limits 的 `pow.nonce` 桶上，去重窗口见 POW_NONCE_TTL_MS。
 */
export type PublicSubmissionDeps = { consumeNonce?: (digest: string) => boolean };

/** PoW 证明的有效窗口：时间戳允许的正负时钟偏差。 */
export const POW_WINDOW_MS = 5 * 60 * 1000;
/** 时间戳前后各偏 POW_WINDOW_MS 都算有效，一份证明能用的时段是两倍长；去重至少要记这么久，否则过期后能再用一次。 */
export const POW_NONCE_TTL_MS = 2 * POW_WINDOW_MS;

export function createPublicSubmission(REQUIRED_PREFIX_ZEROS: number, deps: PublicSubmissionDeps = {}) {
// Proof-of-Work: client must find a nonce such that
//   sha256(`${timestamp}:${bodyHash}:${nonce}`) starts with N hex zeros.
// Default N=3 → 16^3 = 4096 expected hashes. With @noble/hashes/sha256 sync
// impl on the client this is sub-50ms even on低端 Android. POW is mostly
// kept as a token-of-effort against trivially scripted spam; for real
// abuse defense rely on Turnstile + honeypot + rate-limit (those are
// what actually stop bots). 历史: 5 → 卡几十秒, 4 → 部分低端机仍慢, 3 → 顺滑.


const MAX_CLOCK_SKEW_MS = POW_WINDOW_MS;

function checkPow(
  bodyForHash: string,
  pow: { timestamp: number; nonce: string } | undefined
): { ok: true; digest: string } | { ok: false; reason: string } {
  if (!pow) return { ok: false, reason: "missing pow proof" };
  const { timestamp, nonce } = pow;
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "bad pow timestamp" };
  const drift = Math.abs(Date.now() - timestamp);
  if (drift > MAX_CLOCK_SKEW_MS) return { ok: false, reason: "pow expired or in future" };
  if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 32) {
    return { ok: false, reason: "bad pow nonce" };
  }
  const h = createHash("sha256").update(`${timestamp}:${bodyForHash}:${nonce}`).digest("hex");
  if (!h.startsWith("0".repeat(REQUIRED_PREFIX_ZEROS))) {
    return { ok: false, reason: "pow proof invalid" };
  }
  return { ok: true, digest: h };
}

function powDifficulty(): number {
  return REQUIRED_PREFIX_ZEROS;
}

// Honeypot — invisible form field. Real users leave it blank. Bots auto-fill it.
function checkHoneypot(body: Record<string, unknown> | undefined): boolean {
  if (!body) return true;
  const trap = (body as any).website ?? (body as any).homepage ?? (body as any).url_ref;
  return trap === undefined || trap === null || trap === "";
}

async function preflightPublicSubmission(
  req: FastifyRequest,
  reply: FastifyReply,
  bodyForHash: string
): Promise<boolean> {
  const body = req.body as any;
  if (!checkHoneypot(body)) {
    return reply.code(400).send({ error: "请求被拒绝" }), false;
  }
  const pow = body?.pow as { timestamp: number; nonce: string } | undefined;
  const r = checkPow(bodyForHash, pow);
  // 访问防护（#333）：PoW 校验失败（含重放）记一笔失败信号
  if (!r.ok) {
    req.server.services.shield.signal(req.ip, SHIELD_POINTS.failedPow, "pow");
    return reply.code(400).send({ error: "防滥用校验失败，请刷新页面重试" }), false;
  }
  // 摘要进一次性桶：同一份证明第二次提交（原样或改分类/联系方式）一律当作校验失败
  if (deps.consumeNonce && !deps.consumeNonce(r.digest)) {
    req.server.services.shield.signal(req.ip, SHIELD_POINTS.failedPow, "pow");
    return reply.code(400).send({ error: "防滥用校验失败，请刷新页面重试" }), false;
  }
  return true;
}

return { checkPow, checkHoneypot, preflightPublicSubmission, powDifficulty };
}
