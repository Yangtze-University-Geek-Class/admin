import TurnstileWidget from "@shared/ui/TurnstileWidget";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api, fmtRelative } from "@shared/lib/api";
import Select from "@shared/ui/Select";
import { computePow, powProof } from "@shared/lib/pow";

export default function Feedback() {
  const { org: orgParam } = useParams();
  const [search] = useSearchParams();
  const initialOrg = orgParam ?? search.get("org") ?? "";

  const [form, setForm] = useState({ org: initialOrg, category: "建议", content: "", contact: "", website: "" });
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "pow" | "submit">("");
  const [powTries, setPowTries] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [powDiff, setPowDiff] = useState(3);
  const [recent, setRecent] = useState<any[]>([]);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [tsToken, setTsToken] = useState("");
  const [captchaEpoch, setCaptchaEpoch] = useState(0);

  useEffect(() => {
    api<{ categories: string[]; pow_difficulty: number }>("/api/feedback/categories").then((d) => {
      setCategories(d.categories);
      setPowDiff(d.pow_difficulty);
    });
    api<{ turnstile_site_key: string | null }>("/api/public/config").then((c) => setSiteKey(c.turnstile_site_key));
  }, []);

  useEffect(() => {
    if (form.org) api<{ items: any[] }>(`/api/feedback/public?org=${encodeURIComponent(form.org)}&limit=10`).then((d) => setRecent(d.items));
  }, [form.org, done]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy("pow");
    setPowTries(0);
    try {
      const bodyForHash = `fb:${form.org}:${form.content.trim()}`;
      const pow = await computePow(bodyForHash, powDiff, (n) => setPowTries(n));
      setBusy("submit");
      const r = await api<{ ok: boolean; message: string }>("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ ...form, turnstile_token: tsToken, pow: powProof(pow) }),
      });
      setDone(r.message);
      setForm({ ...form, content: "", contact: "", website: "" });
      setCaptchaEpoch(value => value + 1);
      setTsToken("");
    } catch (e) {
      setErr((e as Error).message);
      setCaptchaEpoch(value => value + 1); setTsToken("");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <a href="/" className="flex items-center gap-3">
          <img src="/logo.png" alt="logo" className="w-9 h-9 rounded-lg border border-ink-700" />
          <span className="font-semibold text-ink-100 text-lg">YUGC Admin</span>
        </a>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 grid md:grid-cols-5 gap-8">
        <div className="md:col-span-3">
          <h1 className="text-3xl font-bold text-ink-50">意见箱</h1>
          <p className="text-ink-400 mt-2 text-sm">向组织提建议、报 bug、提需求。提交后组织负责人会收到通知，可在管理后台回复。</p>

          {done ? (
            <div className="card p-6 mt-6 border-emerald-500/40 bg-emerald-500/5">
              <h3 className="text-lg font-semibold text-emerald-300">已收到</h3>
              <p className="text-ink-300 text-sm mt-2">{done}</p>
              <button className="btn-ghost mt-4 text-sm" onClick={() => setDone(null)}>再提一条</button>
            </div>
          ) : (
            <form onSubmit={submit} className="card p-6 mt-6 space-y-4">
              <div>
                <label className="label">组织</label>
                <input className="input font-mono" placeholder="例如 Yangtze-University-Geek-Class"
                  value={form.org} onChange={(e) => setForm({ ...form, org: e.target.value })} required />
              </div>

              <div>
                <label className="label">分类</label>
                <Select value={form.category} onChange={(v) => setForm({ ...form, category: v })}
                  options={categories.map((c) => ({ value: c, label: c }))} />
              </div>

              <div>
                <label className="label">意见内容</label>
                <textarea className="input min-h-[160px]" required minLength={5} maxLength={5000}
                  placeholder="尽量具体：发生了什么、你期望什么、复现步骤…"
                  value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
                <div className="text-right text-xs text-ink-600 mt-1">{form.content.length} / 5000</div>
              </div>

              <div>
                <label className="label">联系方式 <span className="text-ink-600">选填，方便回复</span></label>
                <input className="input" placeholder="邮箱 / GitHub 用户名 / 微信"
                  value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
              </div>

              {/* honeypot */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
                <label>请勿填写：<input tabIndex={-1} autoComplete="off"
                  value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></label>
              </div>

              <TurnstileWidget siteKey={siteKey} onToken={setTsToken} resetKey={captchaEpoch} />
              {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm px-4 py-3">{err}</div>}

              <button type="submit" className="btn-primary w-full py-3" disabled={Boolean(busy) || form.content.length < 5 || !form.org || (!!siteKey && !tsToken)}>
                {busy === "pow" ? `防滥用计算中… ${powTries > 0 ? `${(powTries / 1000).toFixed(0)}k 次` : ""}` : busy === "submit" ? "提交中…" : "提交意见"}
              </button>
              {busy === "pow" && <p className="text-xs text-ink-500 text-center">浏览器在做一次哈希计算（约 1-2 秒），用来防机器人。</p>}
            </form>
          )}
        </div>

        <aside className="md:col-span-2">
          <h2 className="text-sm uppercase tracking-wider text-ink-500 font-mono mb-3">最近的反馈</h2>
          {recent.length === 0 ? (
            <p className="text-ink-500 text-sm">还没有公开反馈</p>
          ) : (
            <ul className="space-y-3">
              {recent.map((r) => (
                <li key={r.id} className="card p-4">
                  <div className="flex items-center gap-2 mb-2 text-xs">
                    <span className="tag-blue">{r.category ?? "其他"}</span>
                    <StatusTag s={r.status} />
                    <span className="text-ink-500 ml-auto">{fmtRelative(r.created_at)}</span>
                  </div>
                  <p className="text-ink-200 text-sm leading-relaxed line-clamp-4">{r.content}</p>
                  {r.reply && (
                    <div className="mt-3 pl-3 border-l-2 border-brand-500/40 text-xs text-ink-300">
                      <span className="text-brand-500">官方回复</span>：{r.reply}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  open: "待处理", triaged: "已查看", in_progress: "处理中", done: "已完成", wont_do: "不做", spam: "垃圾",
};
const StatusTag = ({ s }: { s: string }) => {
  const cls = s === "done" ? "tag-green" : s === "wont_do" ? "tag-red" : s === "in_progress" ? "tag-yellow" : "tag-gray";
  return <span className={cls}>{STATUS_LABEL[s] ?? s}</span>;
};
