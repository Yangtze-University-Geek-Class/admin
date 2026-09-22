// 「投递简历」服务页。与首页同一套视觉基线（../theme.css + docs/design/DESIGN.md）。
//
// 提交是真实写操作：走 /api/portal/apply，准入与其它公开表单一致
// （PoW + 蜜罐 + 可选 Turnstile），没有 mock 分支，也不做假成功。
import TurnstileWidget from "@shared/ui/TurnstileWidget";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, requestJson } from "@shared/lib/http";
import { computePow } from "@shared/lib/pow";
import SiteFooter from "../components/SiteFooter";
import SiteHeader from "../components/SiteHeader";
import "../theme.css";

type FormState = { name: string; className: string; email: string; strengths: string; website: string };
type FieldName = "name" | "className" | "email" | "strengths";
type FieldErrors = Partial<Record<FieldName, string>>;
type Receipt = { id: string; submitted_at: number; message: string };
type PublicConfig = { turnstile_site_key: string | null; pow_difficulty: number };

const EMPTY: FormState = { name: "", className: "", email: "", strengths: "", website: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLASS_RE = /^[\u4e00-\u9fa5A-Za-z0-9 ·\-]+$/;

/** 与后端同一套规则，先在前端给出即时反馈；后端仍然是唯一权威。 */
function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  const name = form.name.trim();
  const className = form.className.trim();
  const email = form.email.trim();
  const strengths = form.strengths.trim();

  if (name.length < 2 || name.length > 40) errors.name = "姓名需要 2–40 个字符";
  if (className.length < 2 || className.length > 40) errors.className = "班级需要 2–40 个字符";
  else if (!CLASS_RE.test(className)) errors.className = "班级只能包含中文、字母、数字、空格、· 或 -";
  if (!email) errors.email = "请填写邮箱";
  else if (email.length > 120 || !EMAIL_RE.test(email)) errors.email = "邮箱格式不正确";
  if (strengths.length < 10 || strengths.length > 2000) errors.strengths = "请写 10–2000 个字符，具体一点会更容易被记住";

  return errors;
}

export default function Apply() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<"" | "pow" | "submit">("");
  const [tries, setTries] = useState(0);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [powDifficulty, setPowDifficulty] = useState(3);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileEpoch, setTurnstileEpoch] = useState(0);

  useEffect(() => {
    requestJson<PublicConfig>("/api/public/config")
      .then((config) => {
        setPowDifficulty(config.pow_difficulty);
        setSiteKey(config.turnstile_site_key);
      })
      .catch(() => setStatus({ kind: "error", text: "无法读取服务配置，请刷新页面重试" }));
  }, []);

  const update = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    if (field !== "website") setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setStatus({ kind: "error", text: "还有字段需要修改，修改后再提交一次" });
      return;
    }
    if (siteKey && !turnstileToken) {
      setStatus({ kind: "error", text: "请先完成人机验证" });
      return;
    }

    const name = form.name.trim();
    const email = form.email.trim();
    setStatus(null);
    setTries(0);
    setBusy("pow");
    try {
      // 与后端约定的载荷指纹：apply:<姓名>:<邮箱>（trim 之后，半角冒号）
      const pow = await computePow(`apply:${name}:${email}`, powDifficulty, setTries);
      setBusy("submit");
      const result = await requestJson<Receipt>("/api/portal/apply", {
        method: "POST",
        body: JSON.stringify({
          name,
          className: form.className.trim(),
          email,
          strengths: form.strengths.trim(),
          website: form.website,
          pow: { timestamp: pow.timestamp, nonce: pow.nonce },
          turnstile_token: turnstileToken,
        }),
      });
      setReceipt(result);
      setStatus(null);
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = (error.payload?.fields ?? {}) as FieldErrors;
        setErrors(fields);
        setStatus({ kind: "error", text: Object.keys(fields).length > 0 ? "提交未通过校验，请看下面的字段提示" : error.message });
      } else {
        setStatus({ kind: "error", text: (error as Error).message || "提交失败，请稍后重试" });
      }
      setTurnstileToken("");
      setTurnstileEpoch((value) => value + 1);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="mimo-page">
      <SiteHeader />

      <main className="mimo-wrap mimo-form-page">
        <div className="mimo-form-head">
          <p className="mimo-eyebrow">JOIN · 投递简历</p>
          <h1>留下联系方式，我们会找你聊聊</h1>
          <p>
            填四项就够：姓名、班级、邮箱，以及你的特长和优点。我们会按学期批次处理，通过邮箱或论坛私信联系你。
          </p>
        </div>

        <div className="mimo-card">
          {receipt ? (
            <div role="status" aria-live="polite" className="mimo-form">
              <p className="mimo-status mimo-status-success">{receipt.message}</p>
              <dl className="mimo-receipt">
                <dt>编号</dt>
                <dd>{receipt.id}</dd>
                <dt>提交时间</dt>
                <dd>{new Date(receipt.submitted_at).toLocaleString("zh-CN", { hour12: false })}</dd>
              </dl>
              <div className="mimo-form-actions">
                <Link className="mimo-btn mimo-btn-outline" to="/">
                  返回首页
                </Link>
                <button
                  type="button"
                  className="mimo-btn mimo-btn-quiet"
                  onClick={() => {
                    setReceipt(null);
                    setForm(EMPTY);
                    setErrors({});
                    setStatus(null);
                    setTurnstileToken("");
                    setTurnstileEpoch((value) => value + 1);
                  }}
                >
                  再投一份
                </button>
              </div>
            </div>
          ) : (
            <form className="mimo-form" onSubmit={submit} noValidate>
              <div className="mimo-grid-2">
                <Field
                  id="apply-name"
                  label="姓名"
                  value={form.name}
                  error={errors.name}
                  autoComplete="name"
                  placeholder="怎么称呼你"
                  onChange={update("name")}
                />
                <Field
                  id="apply-class"
                  label="班级"
                  value={form.className}
                  error={errors.className}
                  autoComplete="organization"
                  placeholder="例如 计科 2301"
                  onChange={update("className")}
                />
              </div>

              <Field
                id="apply-email"
                label="邮箱"
                type="email"
                value={form.email}
                error={errors.email}
                autoComplete="email"
                placeholder="name@example.com"
                hint="用于我们联系你；不会出现在论坛或公开页面"
                onChange={update("email")}
              />

              <div className="mimo-field">
                <label htmlFor="apply-strengths">个人特长和优点</label>
                <textarea
                  id="apply-strengths"
                  className="mimo-textarea"
                  value={form.strengths}
                  onChange={update("strengths")}
                  aria-invalid={errors.strengths ? true : undefined}
                  aria-describedby={errors.strengths ? "apply-strengths-error" : "apply-strengths-hint"}
                  placeholder="做过什么、擅长什么、想做什么。项目、比赛、课程作业、自己折腾的小东西都算。"
                  maxLength={2000}
                />
                {errors.strengths ? (
                  <p className="mimo-field-error" id="apply-strengths-error" role="alert">
                    {errors.strengths}
                  </p>
                ) : (
                  <p className="mimo-field-hint" id="apply-strengths-hint">
                    {form.strengths.trim().length}/2000 · 具体一点比形容词更有用
                  </p>
                )}
              </div>

              {/* 蜜罐字段：真人看不见也不会填，机器人会填。 */}
              <div className="mimo-hide-trap" aria-hidden="true">
                <label htmlFor="apply-website">个人主页（不要填写）</label>
                <input id="apply-website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={update("website")} />
              </div>

              <div className="mimo-form-actions">
                <button type="submit" className="mimo-btn mimo-btn-primary" disabled={busy !== ""}>
                  {busy === "pow" ? `正在校验提交凭据…（${tries}）` : busy === "submit" ? "正在提交…" : "提交简历"}
                </button>
                <span className="mimo-field-hint">提交后会得到编号，可用于后续查询。</span>
              </div>

              <TurnstileWidget siteKey={siteKey} onToken={setTurnstileToken} resetKey={turnstileEpoch} />

              {status && (
                <p className={`mimo-status ${status.kind === "error" ? "mimo-status-error" : "mimo-status-info"}`} role="alert">
                  {status.text}
                </p>
              )}
            </form>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  autoComplete,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <div className="mimo-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="mimo-input"
        type={type}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={120}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
      {error ? (
        <p className="mimo-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mimo-field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
