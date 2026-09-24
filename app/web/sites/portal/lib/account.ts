// 全站统一登录（官网、论坛、控制台共用同一个 sid cookie）。登录只走核心服务的 GitHub 登录：
// /auth/github?return_to=… → GitHub → /auth/callback → 回到 return_to。登录后默认进论坛。
// 同域读 /auth/me 就知道是谁；本机开发时 5173 把 /auth 代理给核心后端，127.0.0.1 上各端口共用这个 cookie。
import { useCallback, useEffect, useState } from "react";

export type Account = { login: string; avatarUrl: string | null };

/** 登录后回到的地址：默认论坛首页（同域的 /forum/，本机开发时 5173 再转到论坛的 dev server） */
export function signInHref(returnTo = `${window.location.origin}/forum/`): string {
  return `/auth/github?return_to=${encodeURIComponent(returnTo)}`;
}

export function parseMe(body: unknown): Account | null {
  const me = body as { signed_in?: boolean; login?: unknown; avatar_url?: unknown } | null;
  if (!me?.signed_in || typeof me.login !== "string" || !me.login) return null;
  return { login: me.login, avatarUrl: typeof me.avatar_url === "string" ? me.avatar_url : null };
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
