import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

// Proof-of-Work: client must find a nonce such that
//   sha256(`${timestamp}:${bodyHash}:${nonce}`) starts with N hex zeros.
// Default N=5 → ~1M expected hashes → ~1-2s on a modern CPU.
// Brute attackers must spend CPU per request — turns mass spam expensive.

const REQUIRED_PREFIX_ZEROS = Number(process.env.POW_DIFFICULTY ?? 5);
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function checkPow(
  bodyForHash: string,
  pow: { timestamp: number; nonce: string } | undefined
): { ok: true } | { ok: false; reason: string } {
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
  return { ok: true };
}

export function powDifficulty(): number {
  return REQUIRED_PREFIX_ZEROS;
}

// Honeypot — invisible form field. Real users leave it blank. Bots auto-fill it.
export function checkHoneypot(body: Record<string, unknown> | undefined): boolean {
  if (!body) return true;
  const trap = (body as any).website ?? (body as any).homepage ?? (body as any).url_ref;
  return trap === undefined || trap === null || trap === "";
}

export async function preflightPublicSubmission(
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
  if (!r.ok) {
    return reply.code(400).send({ error: "防滥用校验失败，请刷新页面重试" }), false;
  }
  return true;
}
