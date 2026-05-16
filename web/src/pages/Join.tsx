import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

declare global {
  interface Window { turnstile?: { render: (el: string | HTMLElement, opts: any) => string; reset: (id?: string) => void }; }
}

export default function Join() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ github_login: "", email: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [tsToken, setTsToken] = useState<string>("");

  useEffect(() => {
    api<{ org: string; turnstile_site_key: string | null }>("/api/config").then((c) => setSiteKey(c.turnstile_site_key));
  }, []);

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
            theme: "dark",
          });
        }
      }, 100);
    };
    return () => {
      s.remove();
    };
  }, [siteKey]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const body = { ...form, turnstile_token: tsToken };
      const r = await api<{ ok: boolean; message: string; deferred?: boolean }>("/api/invite", {
        method: "POST",
        body: JSON.stringify(body),
      });
      navigate("/done", { state: { message: r.message, deferred: r.deferred } });
    } catch (e) {
      setErr((e as Error).message);
      window.turnstile?.reset();
      setTsToken("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 text-brand-500 font-mono text-sm tracking-wider mb-3">
            <span className="w-8 h-px bg-brand-500/50" />
            YANGTZE UNIVERSITY GEEK CLASS
            <span className="w-8 h-px bg-brand-500/50" />
          </div>
          <h1 className="text-4xl font-bold text-ink-50 tracking-tight">加入极客班 GitHub 组织</h1>
          <p className="mt-3 text-ink-400 text-sm leading-relaxed">
            填写下方信息提交后，系统会自动向你的 GitHub 账号发送邀请。<br />
            登录 GitHub 后在通知中心接受邀请即可加入。
          </p>
        </div>

        <form onSubmit={submit} className="card p-6 sm:p-8 space-y-5">
          <div>
            <label className="label">GitHub 用户名</label>
            <input
              className="input font-mono"
              placeholder="例如 octocat"
              value={form.github_login}
              onChange={(e) => setForm({ ...form, github_login: e.target.value })}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="mt-1.5 text-xs text-ink-500">你 GitHub 个人主页 URL 里 / 后面的那个字符串。</p>
          </div>

          <div className="text-center text-ink-600 text-xs flex items-center gap-3">
            <span className="flex-1 h-px bg-ink-800" />或<span className="flex-1 h-px bg-ink-800" />
          </div>

          <div>
            <label className="label">邮箱（如果你还没注册 GitHub）</label>
            <input
              className="input"
              type="email"
              placeholder="me@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>

          <div>
            <label className="label">备注 <span className="text-ink-600">（选填，写学号 / 姓名 / 班级方便管理员核对）</span></label>
            <textarea
              className="input min-h-[80px]"
              maxLength={280}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>

          {siteKey && <div id="turnstile-box" className="flex justify-center" />}

          {err && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm px-4 py-3">
              {err}
            </div>
          )}

          <button type="submit" className="btn-primary w-full text-base py-3" disabled={loading || (!form.github_login && !form.email) || (!!siteKey && !tsToken)}>
            {loading ? "提交中…" : "申请加入"}
          </button>
        </form>

        <p className="text-center mt-6 text-xs text-ink-600">
          提交即表示同意将上述信息用于本组织管理用途。
        </p>
      </div>
    </div>
  );
}
