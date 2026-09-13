import type { AppConfig } from "../config.js";

/** Accept only configured origins; reject protocol-relative and credential-bearing URLs. */
export function safeReturnTo(raw: string | undefined, config: AppConfig, fallback: string): string {
  if (!raw || raw.length > 2048 || /[\\\u0000-\u0020]/.test(raw) || raw.startsWith("//")) return fallback;
  try {
    const url = new URL(raw, config.publicOrigin);
    const allowed = new Set([config.publicOrigin, config.siteOrigin, `${new URL(config.siteOrigin).protocol}//${config.siteHosts.forum}`]);
    if (!allowed.has(url.origin) || url.username || url.password) return fallback;
    return url.toString();
  } catch { return fallback; }
}
