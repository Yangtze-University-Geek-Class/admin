// 官网「邀请加入」落地页：邀请链接是能力令牌，填 GitHub 用户名或邮箱即可申请加入组织。
// 外壳是 ../components/PageShell.tsx；准入同其它公开表单（PoW + 蜜罐 + 可选 Turnstile）。
import TurnstileWidget from "@shared/ui/TurnstileWidget";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, fmtDate } from "@shared/lib/api";
import { computePow, powProof } from "@shared/lib/pow";
import { appConfig } from "@shared/config";
import Icon from "../components/Icon";
import PageShell, { WindowCard } from "../components/PageShell";

type LinkInfo = {
  org: string;
  note: string | null;
  team_slug: string | null;
  expires_at: number;
  remaining_uses: number;
  valid: boolean;
  reason: string | null;
};

/** 本组织的 GitHub slug（组织地址最后一段）；是本组织时标题显示中文品牌名，否则显示 slug。 */
const DEFAULT_ORG = appConfig.urls.githubOrg.split("/").filter(Boolean).pop() ?? "";

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
  const [captchaEpoch, setCaptchaEpoch] = useState(0);

  useEffect(() => {
    api<LinkInfo>(`/api/join/${token}`).then(setInfo).catch((e) => setLoadErr(e.message));
    api<{ turnstile_site_key: string | null; pow_difficulty: number }>("/api/public/config").then((c) => {
      setSiteKey(c.turnstile_site_key);
      setPowDiff(c.pow_difficulty);
    });
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy("pow");
    setPowTries(0);
    try {
      const bodyForHash = `join:${token}:${form.github_login.trim()}:${form.email.trim()}`;
      const pow = await computePow(bodyForHash, powDiff, (n) => setPowTries(n));
      setBusy("submit");
      const body = { ...form, turnstile_token: tsToken, pow: powProof(pow) };
      const r = await api<{ ok: boolean; message: string }>(`/api/join/${token}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setDone(r.message);
    } catch (e) {
      setErr((e as Error).message);
      setCaptchaEpoch(value => value + 1);
      setTsToken("");
    } finally {
      setBusy("");
    }
  };

  return (
    <PageShell path="~/yugc/join">
      <div className="pt-invite">
        {loadErr && (
          <div role="alert">
            <p className="pt-alert is-error">
              <Icon name="error-warning-line" size={16} /> {loadErr}
            </p>
            <p className="pt-hint pt-invite-next">检查链接有没有复制完整，或者找发链接给你的人重新要一个。</p>
          </div>
        )}

        {!info && !loadErr && <p className="pt-hint">正在读取邀请链接…</p>}

        {info && !info.valid && (
          <WindowCard path="join.request" badge="已失效" className="pt-invite-state">
            <div role="status">
              <h1>这个邀请链接用不了</h1>
              <p>{info.reason}</p>
              <p className="pt-hint">找发链接给你的人要一个新的。</p>
            </div>
          </WindowCard>
        )}

        {info && info.valid && done && (
          <WindowCard path="join.request" badge="已发送" className="pt-invite-state">
            <div role="status" aria-live="polite">
              <h1>邀请发出去了</h1>
              <p>{done}</p>
            </div>
          </WindowCard>
        )}

        {info && info.valid && !done && (
          <>
            <header className="pt-pagehead is-center">
              <div>
                <h1>
                  {info.org === DEFAULT_ORG ? (
                    <>加入 {appConfig.portal.brand.title}</>
                  ) : (
                    <>
                      加入组织
                      <span className="pt-org-slug">{info.org}</span>
                    </>
                  )}
                </h1>
                {info.note && <p>{info.note}</p>}
                <p>
                  填 GitHub 用户名（没有账号就填邮箱），我们会给你发 GitHub 组织的邀请。这个链接还能用 <span className="pt-num">{info.remaining_uses}</span> 次，
                  {fmtDate(info.expires_at)} 到期。
                </p>
                {info.team_slug && <p className="pt-hint">接受邀请后会自动进入团队 {info.team_slug}。</p>}
              </div>
            </header>

            <WindowCard path="join.request" badge={info.org}>
              <form onSubmit={submit} className="pt-form">
                <div className="pt-field">
                  <label htmlFor="join-login">GitHub 用户名</label>
                  <input id="join-login" className="pt-input is-mono" placeholder="例如 octocat" value={form.github_login} onChange={(e) => setForm({ ...form, github_login: e.target.value })} autoComplete="off" spellCheck={false} />
                </div>

                <p className="pt-or" aria-hidden="true">
                  或
                </p>

                <div className="pt-field">
                  <label htmlFor="join-email">还没有 GitHub 账号？填邮箱</label>
                  <input id="join-email" className="pt-input" type="email" placeholder="me@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>

                <div className="pt-field">
                  <label htmlFor="join-note">备注（选填，写姓名或学号，方便我们核对）</label>
                  <textarea id="join-note" className="pt-input pt-textarea is-short" maxLength={280} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
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
                  <button type="submit" className="pt-btn is-primary" disabled={Boolean(busy) || (!form.github_login && !form.email) || (!!siteKey && !tsToken)}>
                    {busy === "pow" ? "正在做防刷验证…" : busy === "submit" ? "正在提交…" : "发邀请给我"}
                  </button>
                  {busy === "pow" && (
                    <span className="pt-hint">
                      浏览器在算一道防刷题，一两秒就好（已试 <span className="pt-num">{Math.round(powTries / 1000)}k</span> 次）
                    </span>
                  )}
                </div>
              </form>
            </WindowCard>
          </>
        )}
      </div>
    </PageShell>
  );
}
