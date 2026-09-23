import type { AppConfig } from "../config.js";

/** Accept only the environment's single public origin; reject protocol-relative and credential-bearing URLs. */
export function safeReturnTo(raw: string | undefined, config: AppConfig, fallback: string): string {
  if (!raw || raw.length > 2048 || /[\\\u0000-\u0020]/.test(raw) || raw.startsWith("//")) return fallback;
  try {
    const url = new URL(raw, config.publicOrigin);
    if (url.origin !== config.publicOrigin || url.username || url.password) return fallback;
    return url.toString();
  } catch { return fallback; }
}
