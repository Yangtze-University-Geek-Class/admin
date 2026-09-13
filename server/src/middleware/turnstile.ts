import { request as defaultRequest } from "undici";
import type { AppConfig } from "../config.js";
export function createTurnstile(config: AppConfig, undiciRequest = defaultRequest) {
const turnstileEnabled = () => Boolean(config.turnstile.siteKey && config.turnstile.secretKey);
async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (!token) return false;
  const res = await undiciRequest("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: config.turnstile.secretKey, response: token, remoteip: ip }),
  });
  const body = (await res.body.json()) as { success?: boolean };
  return Boolean(body.success);
}

return { verifyTurnstile, turnstileEnabled };
}
