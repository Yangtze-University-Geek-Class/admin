import { useEffect, useRef, useState } from "react";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }
let loading: Promise<Turnstile> | undefined;
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const fail = () => { script.remove(); loading = undefined; reject(new Error("人机验证加载失败，请重试")); };
    const timer = window.setTimeout(fail, 15000);
    script.onload = () => { clearTimeout(timer); window.turnstile ? resolve(window.turnstile) : fail(); };
    script.onerror = () => { clearTimeout(timer); fail(); };
    document.head.appendChild(script);
  });
  return loading;
}
export default function TurnstileWidget({ siteKey, onToken, resetKey = 0 }: { siteKey: string | null; onToken: (token: string) => void; resetKey?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken); callback.current = onToken;
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    let widget: string | undefined;
    let api: Turnstile | undefined;
    setError(""); callback.current("");
    loadTurnstile().then(value => {
      if (cancelled || !ref.current) return;
      api = value;
      widget = value.render(ref.current, {
        sitekey: siteKey, theme: "light",
        callback: (token: string) => callback.current(token),
        "expired-callback": () => callback.current(""),
        "error-callback": () => { callback.current(""); setError("验证失败，请重试"); },
      });
    }).catch(error => { if (!cancelled) setError((error as Error).message); });
    return () => { cancelled = true; if (widget !== undefined) api?.remove(widget); };
  }, [siteKey, resetKey, retry]);
  if (!siteKey) return null;
  return <div><div ref={ref} />{error && <p role="alert" className="text-sm text-rose-500">{error} <button type="button" className="btn-ghost" onClick={() => setRetry(value=>value+1)}>重试验证</button></p>}</div>;
}
