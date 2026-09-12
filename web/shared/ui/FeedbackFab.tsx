// Floating "意见" button with a modal form. Raised above the mascot on the
// forum so the mascot bubble stays visible; auto-detects the org from the URL.
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { computePow } from "../lib/pow";
import { appConfig } from "../config";
import Select from "./Select";

type Cfg = { categories: string[]; pow_difficulty: number };

export default function FeedbackFab({ defaultOrg, raised = false }: { defaultOrg?: string; raised?: boolean }) {
  const loc = useLocation();
  // Auto-detect org from /admin/:org/ URL
  const orgFromPath = (() => {
    const m = loc.pathname.match(/^\/admin\/([A-Za-z0-9][A-Za-z0-9-]*)(?:\/|$)/);
    return m && m[1] !== "signin" ? m[1] : "";
  })();
  const effectiveDefault = defaultOrg ?? orgFromPath;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ org: effectiveDefault, category: "建议", content: "", contact: "", website: "" });
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [busy, setBusy] = useState<"" | "pow" | "submit">("");
  const [powTries, setPowTries] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!cfg) api<Cfg>("/api/feedback/categories").then(setCfg);
  }, [open, cfg]);

  useEffect(() => {
    if (effectiveDefault && !form.org) setForm((f) => ({ ...f, org: effectiveDefault }));
  }, [effectiveDefault]);

  // hide on pages that already have feedback UI
  const hidden = loc.pathname.startsWith("/feedback") || loc.pathname.startsWith("/join");
  if (hidden) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy("pow");
    setPowTries(0);
    try {
      const bodyForHash = `fb:${form.org}:${form.content.trim()}`;
      const pow = await computePow(bodyForHash, cfg?.pow_difficulty ?? 3, (n) => setPowTries(n));
      setBusy("submit");
      const r = await api<{ ok: boolean; message: string }>("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          org: form.org, category: form.category, content: form.content,
          contact: form.contact, website: form.website, pow,
        }),
      });
      setDone(r.message);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const reset = () => {
    setForm({ ...form, content: "", contact: "" });
    setDone(null);
    setErr(null);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`fixed right-6 z-30 group flex items-center gap-2 pl-4 pr-5 py-3 rounded-full bg-brand-600 hover:bg-brand-500 text-white shadow-glow transition ${raised ? "" : "bottom-6"}`}
        style={raised ? { bottom: appConfig.mascot.height + 28 } : undefined}
        aria-label="提交意见"
        title="提交意见"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-5 h-5"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1 15.2-5 8.4 8.4 0 0 1 .9 1.2Z" />
        </svg>
        <span className="text-sm font-medium">意见</span>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]" onClick={() => !busy && setOpen(false)} />
          <div className="relative card w-full max-w-lg p-6 animate-[popIn_140ms_ease-out]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-ink-100">提交意见</h2>
              <button onClick={() => !busy && setOpen(false)} className="text-ink-500 hover:text-ink-200" aria-label="关闭">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {done ? (
              <div className="text-center py-8">
                <div className="inline-flex w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-400 items-center justify-center mb-3">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-6 h-6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12 5 5L20 7" />
                  </svg>
                </div>
                <p className="text-ink-200">{done}</p>
                <div className="flex justify-center gap-2 mt-5">
                  <button className="btn-ghost text-sm" onClick={reset}>再提一条</button>
                  <button className="btn-primary text-sm" onClick={() => setOpen(false)}>关闭</button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label className="label">组织 login</label>
                  <input className="input font-mono text-sm" placeholder="例如 Yangtze-University-Geek-Class"
                    value={form.org} onChange={(e) => setForm({ ...form, org: e.target.value })} required />
                </div>
                <div>
                  <label className="label">分类</label>
                  <Select size="sm" value={form.category} onChange={(v) => setForm({ ...form, category: v })}
                    options={(cfg?.categories ?? ["建议"]).map((c) => ({ value: c, label: c }))} />
                </div>
                <div>
                  <label className="label">意见 <span className="text-ink-600">5-5000 字</span></label>
                  <textarea className="input min-h-[120px]" required minLength={5} maxLength={5000}
                    value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
                    placeholder="尽量具体：发生了什么、你期望什么、复现步骤…" />
                  <div className="text-right text-xs text-ink-600 mt-1">{form.content.length} / 5000</div>
                </div>
                <div>
                  <label className="label">联系方式 <span className="text-ink-600">选填</span></label>
                  <input className="input text-sm" placeholder="邮箱 / GitHub 用户名 / 微信"
                    value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
                </div>

                {/* honeypot — invisible to humans */}
                <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
                  <label>请勿填写：<input tabIndex={-1} autoComplete="off"
                    value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></label>
                </div>

                {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm px-4 py-3">{err}</div>}

                <div className="flex items-center gap-2">
                  <button type="button" className="btn-ghost text-sm" onClick={() => setOpen(false)} disabled={Boolean(busy)}>取消</button>
                  <button type="submit" className="btn-primary text-sm flex-1" disabled={form.content.length < 5 || !form.org || Boolean(busy)}>
                    {busy === "pow" ? `防滥用计算中… ${powTries > 0 ? `${(powTries / 1000).toFixed(0)}k 次` : ""}` : busy === "submit" ? "提交中…" : "提交意见"}
                  </button>
                </div>
                {busy === "pow" && (
                  <p className="text-xs text-ink-500 text-center">浏览器正在做一次哈希计算（约 1-2 秒），用来防止机器人批量提交。</p>
                )}
              </form>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
