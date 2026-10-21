// 全站统一登录（官网、论坛、控制台共用同一个 sid cookie，#262）。「登录」一律去极客班统一登录页：
// /signin?return_to=<本站路径> → 选登录方式（GET /auth/providers，GitHub 只是其一）→ /auth/callback → 回到 return_to。
// 同域读 /auth/me 就知道是谁；本机开发时 5173 把 /auth 代理给核心后端、把 /signin 转给控制台 dev server，127.0.0.1 上各端口共用这个 cookie。
import { useCallback, useEffect, useState } from "react";

/**
 * consoleLink 是 /auth/me 的 console_link：登录者在控制台里能管点什么（持有 console.access、github.org.read、feedback.read
 * 之外的能力）。头像菜单只在它为 true 时放「控制台」；字段缺失当作 false。控制台自己的准入不变。
 */
export type Account = { login: string; avatarUrl: string | null; consoleLink: boolean; accountId: string | null };

/**
 * 统一登录页地址。`returnTo` 是登录后回到的本站路径（默认当前页面）；只带路径、不带域名，
 * 登录页（app/console/src/lib/signin.ts）与服务端（app/server/src/lib/safe-return.ts）都会再按同源校验。
 */
export function signInHref(returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`): string {
  const path = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `/signin?return_to=${encodeURIComponent(path)}`;
}

export function parseMe(body: unknown): Account | null {
  const me = body as { signed_in?: boolean; login?: unknown; avatar_url?: unknown; console_link?: unknown; account_id?: unknown } | null;
  if (!me?.signed_in || typeof me.login !== "string" || !me.login) return null;
  // accountId 是极客班账号（#262）：比赛窗口用它在天梯、队伍里认出「我」；旧会话没有时是 null。
  const accountId = typeof me.account_id === "string" && me.account_id ? me.account_id : null;
  return { login: me.login, avatarUrl: typeof me.avatar_url === "string" ? me.avatar_url : null, consoleLink: me.console_link === true, accountId };
}

export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/auth/me", { credentials: "same-origin", headers: { accept: "application/json" } })
      .then((response) => (response.ok && response.headers.get("content-type")?.includes("application/json") ? response.json() : null))
      .catch(() => null)
      .then((body) => {
        if (cancelled) return;
        setAccount(parseMe(body));
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 退出是全站的：官网、论坛、控制台一起变成未登录。服务端确认后才显示已退出。 */
  const signOut = useCallback(async () => {
    const ok = await fetch("/auth/signout", { method: "POST", credentials: "same-origin" })
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) setAccount(null);
  }, []);

  return { account, loaded, signOut };
}
