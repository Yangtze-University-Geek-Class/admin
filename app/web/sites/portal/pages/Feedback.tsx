// 官网「意见箱」：匿名向组织提建议 / 报 bug，旁边列出该组织公开的近期反馈。
// 外壳是 ../components/PageShell.tsx；准入同其它公开表单（PoW + 蜜罐 + 可选 Turnstile）。
import TurnstileWidget from "@shared/ui/TurnstileWidget";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api, fmtRelative } from "@shared/lib/api";
import { appConfig } from "@shared/config";
import Select from "@shared/ui/Select";
import { computePow, powProof } from "@shared/lib/pow";
import Icon from "../components/Icon";
import PageShell, { WindowCard } from "../components/PageShell";

export default function Feedback() {
  const { org: orgParam } = useParams();
  const [search] = useSearchParams();
  // 没有指定组织时默认本组织（GitHub 组织地址的最后一段），「最近的反馈」一打开就有内容
  const defaultOrg = appConfig.urls.githubOrg.split("/").filter(Boolean).pop() ?? "";
  const initialOrg = orgParam ?? search.get("org") ?? defaultOrg;

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
    <PageShell path="~/yugc/feedback">
      <header className="pt-pagehead">
        <div>
          <p className="pt-kicker">// FEEDBACK · 意见箱</p>
          <h1>意见箱</h1>
          <p>向组织提建议、报 bug、提需求。提交后组织负责人会在控制台看到并回复。</p>
        </div>
      </header>

      <div className="pt-feedback">
        <WindowCard path="feedback.form" badge={done ? "SENT" : "DRAFT"}>
          {done ? (
            <div className="pt-form" role="status" aria-live="polite">
              <p className="pt-alert is-success">
                <Icon name="checkbox-circle-line" size={16} /> 已收到：{done}
              </p>
              <div className="pt-form-actions">
                <button type="button" className="pt-btn" onClick={() => setDone(null)}>
                  再提一条
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="pt-form">
              <div className="pt-field">
                <label htmlFor="fb-org">组织</label>
                <input id="fb-org" className="pt-input is-mono" placeholder="例如 Yangtze-University-Geek-Class" value={form.org} onChange={(e) => setForm({ ...form, org: e.target.value })} required />
              </div>

              <div className="pt-field">
                <label htmlFor="fb-category">分类</label>
                <Select id="fb-category" label="分类" className="pt-input" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={categories.map((c) => ({ value: c, label: c }))} />
              </div>

              <div className="pt-field">
                <label htmlFor="fb-content">意见内容</label>
                <textarea
                  id="fb-content"
                  className="pt-input pt-textarea"
                  required
                  minLength={5}
                  maxLength={5000}
                  placeholder="尽量具体：发生了什么、你期望什么、复现步骤…"
                  aria-describedby="fb-content-count"
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                />
                <p className="pt-hint" id="fb-content-count">
                  {form.content.length} / 5000 · 至少 5 个字
                </p>
              </div>

              <div className="pt-field">
                <label htmlFor="fb-contact">联系方式（选填，方便回复）</label>
                <input id="fb-contact" className="pt-input" placeholder="邮箱 / GitHub 用户名 / 微信" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
              </div>

              {/* 蜜罐字段：真人看不见也不会填，机器人会填。 */}
              <div className="pt-trap" aria-hidden="true">
                <label>
                  请勿填写：
                  <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
                </label>
              </div>

              <TurnstileWidget siteKey={siteKey} onToken={setTsToken} resetKey={captchaEpoch} />
              {err && (
                <p className="pt-alert is-error" role="alert">
                  <Icon name="error-warning-line" size={16} /> {err}
                </p>
              )}

              <div className="pt-form-actions">
                <button type="submit" className="pt-btn is-primary" disabled={Boolean(busy) || form.content.length < 5 || !form.org || (!!siteKey && !tsToken)}>
                  <Icon name="send-plane-2-line" size={16} />
                  {busy === "pow" ? `防滥用计算中… ${powTries > 0 ? `${(powTries / 1000).toFixed(0)}k 次` : ""}` : busy === "submit" ? "提交中…" : "提交意见"}
                </button>
                {busy === "pow" && <span className="pt-hint">浏览器在做一次哈希计算（约 1–2 秒），用来防机器人。</span>}
              </div>
            </form>
          )}
        </WindowCard>

        <aside className="pt-feed-side" aria-labelledby="fb-recent-title">
          <h2 className="pt-kicker" id="fb-recent-title">
            // 最近的反馈
          </h2>
          {recent.length === 0 ? (
            <div className="pt-feed-empty">
              <Icon name="inbox-line" size={28} />
              <p>这里还没有公开反馈。提建议、报 bug、提需求都可以，第一条可以是你的。</p>
            </div>
          ) : (
            <ul>
              {recent.map((r) => (
                <li key={r.id} className="pt-feed-item">
                  <div className="pt-feed-meta">
                    <span className="pt-tag">{r.category ?? "其他"}</span>
                    <StatusTag s={r.status} />
                    <span className="pt-feed-time">{fmtRelative(r.created_at)}</span>
                  </div>
                  <p>{r.content}</p>
                  {r.reply && (
                    <p className="pt-feed-reply">
                      <strong>官方回复</strong>：{r.reply}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </PageShell>
  );
}

const STATUS_LABEL: Record<string, string> = {
  open: "待处理", triaged: "已查看", in_progress: "处理中", done: "已完成", wont_do: "不做", spam: "垃圾",
};
const StatusTag = ({ s }: { s: string }) => {
  const tone = s === "done" ? "is-done" : s === "wont_do" ? "is-no" : s === "in_progress" ? "is-doing" : "";
  return <span className={`pt-tag ${tone}`}>{STATUS_LABEL[s] ?? s}</span>;
};
