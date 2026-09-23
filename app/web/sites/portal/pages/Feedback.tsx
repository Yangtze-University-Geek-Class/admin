// 官网「意见箱」：匿名向组织提建议 / 报 bug，旁边列出该组织公开的近期反馈。
// 外壳是 ../components/PageShell.tsx；准入同其它公开表单（PoW + 蜜罐 + 可选 Turnstile）。
// 分类只有几项，用单选按钮组（../components/ChoiceChips.tsx）而不是原生下拉框。
import TurnstileWidget from "@shared/ui/TurnstileWidget";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api, fmtRelative } from "@shared/lib/api";
import { appConfig } from "@shared/config";
import { computePow, powProof } from "@shared/lib/pow";
import ChoiceChips from "../components/ChoiceChips";
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
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const [powDiff, setPowDiff] = useState(3);
  const [recent, setRecent] = useState<any[]>([]);
  const [recentFailed, setRecentFailed] = useState(false);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [tsToken, setTsToken] = useState("");
  const [captchaEpoch, setCaptchaEpoch] = useState(0);

  useEffect(() => {
    api<{ categories: string[]; pow_difficulty: number }>("/api/feedback/categories")
      .then((d) => {
        setCategories(d.categories);
        setPowDiff(d.pow_difficulty);
      })
      .catch(() => setCategoriesFailed(true));
    api<{ turnstile_site_key: string | null }>("/api/public/config")
      .then((c) => setSiteKey(c.turnstile_site_key))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!form.org) return;
    setRecentFailed(false);
    api<{ items: any[] }>(`/api/feedback/public?org=${encodeURIComponent(form.org)}&limit=10`)
      .then((d) => setRecent(d.items))
      .catch(() => {
        setRecent([]);
        setRecentFailed(true);
      });
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
          <h1>意见箱</h1>
          <p>对官网、论坛或极客班有意见，写在这里，不用登录。社区部会在控制台里看到，回复会公开显示在「最近的意见」里。</p>
        </div>
      </header>

      <div className="pt-feedback">
        <WindowCard path="feedback.form" badge={done ? "已提交" : undefined}>
          {done ? (
            <div className="pt-form" role="status" aria-live="polite">
              <p className="pt-alert is-success">
                <Icon name="checkbox-circle-line" size={16} /> {done}
              </p>
              <div className="pt-form-actions">
                <button type="button" className="pt-btn" onClick={() => setDone(null)}>
                  再写一条
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="pt-form">
              <div className="pt-field">
                <label htmlFor="fb-org">发给哪个 GitHub 组织</label>
                <input id="fb-org" className="pt-input is-mono" placeholder="例如 Yangtze-University-Geek-Class" value={form.org} onChange={(e) => setForm({ ...form, org: e.target.value })} required />
              </div>

              <div className="pt-field">
                <span className="pt-field-label" id="fb-category-label">
                  分类
                </span>
                {categoriesFailed ? (
                  <p className="pt-hint">分类没加载出来，这条会按「未分类」提交。</p>
                ) : (
                  <ChoiceChips name="category" labelledBy="fb-category-label" value={form.category} options={categories} onChange={(category) => setForm({ ...form, category })} />
                )}
              </div>

              <div className="pt-field">
                <label htmlFor="fb-content">想说什么</label>
                <textarea
                  id="fb-content"
                  className="pt-input pt-textarea"
                  required
                  minLength={5}
                  maxLength={5000}
                  placeholder="比如：哪个页面、做了什么、看到了什么、你觉得应该怎样。"
                  aria-describedby="fb-content-count"
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                />
                <p className="pt-hint" id="fb-content-count">
                  <span className="pt-num">{form.content.length}</span> / 5000 字，至少 5 字。内容和回复会公开显示，别写隐私信息。
                </p>
              </div>

              <div className="pt-field">
                <label htmlFor="fb-contact">联系方式（选填，不公开）</label>
                <input id="fb-contact" className="pt-input" placeholder="邮箱、GitHub 用户名或微信" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
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
                  {busy === "pow" ? "正在做防刷验证…" : busy === "submit" ? "正在提交…" : "提交意见"}
                </button>
                {busy === "pow" && (
                  <span className="pt-hint">
                    浏览器在算一道防刷题，一两秒就好（已试 <span className="pt-num">{Math.round(powTries / 1000)}k</span> 次）
                  </span>
                )}
              </div>
            </form>
          )}
        </WindowCard>

        <aside className="pt-feed-side" aria-labelledby="fb-recent-title">
          <h2 className="pt-side-title" id="fb-recent-title">
            最近的意见
          </h2>
          {recentFailed ? (
            <div className="pt-feed-empty">
              <Icon name="error-warning-line" size={24} />
              <p>没读到 {form.org} 的公开意见。检查一下组织名，或者稍后刷新。</p>
            </div>
          ) : recent.length === 0 ? (
            <div className="pt-feed-empty">
              <Icon name="inbox-line" size={24} />
              <p>{form.org || "这个组织"} 还没有公开的意见。</p>
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
                      <strong>回复</strong>：{r.reply}
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
