import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, fmtDate } from "../lib/api";
import { computePow } from "../lib/pow";

declare global {
  interface Window { turnstile?: { render: (el: string | HTMLElement, opts: any) => string; reset: (id?: string) => void }; }
}

type LinkInfo = {
  org: string;
  note: string | null;
  team_slug: string | null;
  expires_at: number;
  remaining_uses: number;
  valid: boolean;
  reason: string | null;
};

export default function JoinByToken() {
  const { token } = useParams();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [form, setForm] = useState({ github_login: "", email: "", note: "", website: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "pow" | "submit">("");
  const [powTries, setPowTries] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [powDiff, setPowDiff] = useState(3);
  const [tsToken, setTsToken] = useState<string>("");

  useEffect(() => {
    api<LinkInfo>(`/api/join/${token}`).then(setInfo).catch((e) => setLoadErr(e.message));
    api<{ turnstile_site_key: string | null; pow_difficulty: number }>("/api/public/config").then((c) => {
      setSiteKey(c.turnstile_site_key);
      setPowDiff(c.pow_difficulty);
    });
  }, [token]);

  useEffect(() => {
    if (!siteKey) return;
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
    s.onload = () => {
      const t = setInterval(() => {
        if (window.turnstile) {
          clearInterval(t);
          window.turnstile.render("#turnstile-box", {
            sitekey: siteKey,
            callback: (tok: string) => setTsToken(tok),
            theme: "auto",
          });
        }
      }, 100);
    };
    return () => { s.remove(); };
  }, [siteKey]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy("pow");
    setPowTries(0);
    try {
      const bodyForHash = `join:${token}:${form.github_login.trim()}:${form.email.trim()}`;
      const pow = await computePow(bodyForHash, powDiff, (n) => setPowTries(n));
      setBusy("submit");
      const body = { ...form, turnstile_token: tsToken, pow };
      const r = await api<{ ok: boolean; message: string }>(`/api/join/${token}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setDone(r.message);
    } catch (e) {
      setErr((e as Error).message);
      window.turnstile?.reset();
      setTsToken("");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="logo" className="w-9 h-9 rounded-lg border border-ink-700" />
          <span className="font-semibold text-ink-100 text-lg">YUGC Admin</span>
        </div>
      </header>

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-xl">
          {loadErr && <div className="card p-8 text-center text-rose-400">{loadErr}</div>}

          {info && !info.valid && (
            <div className="card p-10 text-center">
              <div className="inline-flex w-14 h-14 rounded-full bg-rose-500/15 text-rose-400 items-center justify-center mb-5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-7 h-7">
                  <path d="M12 8v5M12 16.5h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 className="text-2xl font-semibold text-ink-50 mb-2">链接不可用</h2>
              <p className="text-ink-400">{info.reason}</p>
              <p className="text-xs text-ink-500 mt-4">请联系发出该链接的管理员</p>
            </div>
          )}

          {info && info.valid && done && (
            <div className="card p-10 text-center">
              <div className="inline-flex w-14 h-14 rounded-full bg-emerald-500/15 text-emerald-400 items-center justify-center mb-5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-7 h-7">
                  <path d="m5 12 5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 className="text-2xl font-semibold text-ink-50 mb-2">邀请已发送</h2>
              <p className="text-ink-400">{done}</p>
            </div>
          )}

          {info && info.valid && !done && (
            <>
              <div className="text-center mb-8">
                <h1 className="text-4xl font-bold text-ink-50 tracking-tight">加入 {info.org}</h1>
                <p className="mt-3 text-ink-400 text-sm">
                  {info.note ?? "邀请链接有效"} · 剩余 {info.remaining_uses} 次 · 到期 {fmtDate(info.expires_at)}
                </p>
                {info.team_slug && (
                  <p className="mt-2 text-xs text-brand-500">将自动加入 team: {info.team_slug}</p>
                )}
              </div>

              <form onSubmit={submit} className="card p-6 sm:p-8 space-y-5">
                <div>
                  <label className="label">GitHub 用户名</label>
                  <input
                    className="input font-mono"
                    placeholder="例如 octocat"
                    value={form.github_login}
                    onChange={(e) => setForm({ ...form, github_login: e.target.value })}
                    autoComplete="off" spellCheck={false}
                  />
                </div>

                <div className="text-center text-ink-600 text-xs flex items-center gap-3">
                  <span className="flex-1 h-px bg-ink-800" />或<span className="flex-1 h-px bg-ink-800" />
                </div>

                <div>
                  <label className="label">邮箱（如果你还没注册 GitHub）</label>
                  <input
                    className="input" type="email" placeholder="me@example.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">备注 <span className="text-ink-600">选填，写学号/姓名方便管理员核对</span></label>
                  <textarea
                    className="input min-h-[80px]" maxLength={280}
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                  />
                </div>

                {/* honeypot */}
                <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
                  <label>请勿填写：<input tabIndex={-1} autoComplete="off"
                    value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></label>
                </div>

                {siteKey && <div id="turnstile-box" className="flex justify-center" />}

                {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm px-4 py-3">{err}</div>}

                <button type="submit" className="btn-primary w-full text-base py-3"
                  disabled={Boolean(busy) || (!form.github_login && !form.email) || (!!siteKey && !tsToken)}>
                  {busy === "pow" ? `防滥用计算中… ${powTries > 0 ? `${(powTries / 1000).toFixed(0)}k 次` : ""}` : busy === "submit" ? "提交中…" : "申请加入"}
                </button>
                {busy === "pow" && <p className="text-xs text-ink-500 text-center">浏览器在做一次哈希计算（约 1-2 秒）。</p>}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
