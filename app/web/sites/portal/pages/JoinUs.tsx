// 「加入我们」：信封场景（../three/join.ts）+ 一封居中的 DOM 信纸（就是表单）。
//
// 提交是真实写操作：POST /api/portal/apply，准入与其它公开表单一致（蜜罐 + PoW + 可选 Turnstile），
// PoW 指纹 `apply:<姓名>:<邮箱>`（trim 后）与后端逐字一致；没有 mock 分支，也不做假成功。
// 画面顺序：信封飞入停在正中 → 封舌打开 → 信纸抽出 → 镜头推近、信纸落到屏幕正中并展平（此时换成 DOM 表单）
// → 提交成功后信纸在原位折两道、塞回信封、封口盖火漆 → 信封飞进一侧的信箱，小旗弹起 → 回执。
import TurnstileWidget from "@shared/ui/TurnstileWidget";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { appConfig } from "@shared/config";
import { ApiError, requestJson } from "@shared/lib/http";
import { computePow, powProof } from "@shared/lib/pow";
import Icon from "../components/Icon";
import SceneBar from "../components/SceneBar";
import { RESUME_DESKTOP } from "../lib/links";
import { useReducedMotion } from "../lib/useReducedMotion";
import type { JoinHandle, JoinPhase } from "../three/join";
import "../styles/portal.css";
import "../styles/scenes.css";

type FormState = { name: string; className: string; email: string; strengths: string; website: string };
type FieldName = "name" | "className" | "email" | "strengths";
type FieldErrors = Partial<Record<FieldName, string>>;
type Receipt = { id: string; submitted_at: number; message: string };
type PublicConfig = { turnstile_site_key: string | null; pow_difficulty: number };

const EMPTY: FormState = { name: "", className: "", email: "", strengths: "", website: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLASS_RE = /^[\u4e00-\u9fa5A-Za-z0-9 ·\-]+$/;

/** 与后端同一套规则，先在前端给出即时反馈；后端仍然是唯一权威。 */
export function validateJoin(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  const name = form.name.trim();
  const className = form.className.trim();
  const email = form.email.trim();
  const strengths = form.strengths.trim();
  if (name.length < 2 || name.length > 40) errors.name = "姓名写 2 到 40 个字";
  if (className.length < 2 || className.length > 40) errors.className = "班级写 2 到 40 个字";
  else if (!CLASS_RE.test(className)) errors.className = "班级只能用中文、字母、数字、空格、· 和 -";
  if (!email) errors.email = "请填写邮箱，我们靠它联系你";
  else if (email.length > 120 || !EMAIL_RE.test(email)) errors.email = "邮箱格式不对，检查一下有没有漏掉 @";
  if (strengths.length < 10) errors.strengths = "至少写 10 个字";
  else if (strengths.length > 2000) errors.strengths = "最多 2000 字，请删减一些";
  return errors;
}

export default function JoinUs() {
  const reducedMotion = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const letter = useRef<HTMLFormElement>(null);
  const scene = useRef<JoinHandle | null>(null);
  const [phase, setPhase] = useState<JoinPhase>("arrive");
  const [sceneFailed, setSceneFailed] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<"" | "pow" | "submit">("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [powDifficulty, setPowDifficulty] = useState(3);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileEpoch, setTurnstileEpoch] = useState(0);
  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestJson<PublicConfig>("/api/public/config")
      .then((config) => {
        setPowDifficulty(config.pow_difficulty);
        setSiteKey(config.turnstile_site_key);
      })
      .catch(() => setStatus({ kind: "error", text: "连不上服务器，暂时寄不出去。请刷新页面再试。" }));
  }, []);

  const onPhase = useCallback((next: JoinPhase) => setPhase(next), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const module = await import("../three/join");
        if (cancelled || !canvas.current) return;
        const handle = await module.createJoinScene(canvas.current, {
          reducedMotion,
          logoUrl: appConfig.portal.brand.logo,
          letterRect: () => letter.current?.getBoundingClientRect() ?? null,
          onPhase,
        });
        if (cancelled) {
          handle.dispose();
          return;
        }
        scene.current = handle;
      } catch {
        // 没有 WebGL：不放动画，直接给信纸
        if (!cancelled) {
          setSceneFailed(true);
          setPhase("writing");
        }
      }
    })();
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时建一次场景
  }, []);

  const writing = phase === "writing";
  useEffect(() => {
    if (writing && !receipt) letter.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [writing, receipt]);
  useEffect(() => {
    if (phase === "done" && receipt) receiptRef.current?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
  }, [phase, receipt]);

  const update = (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    if (field !== "website") setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!writing || busy) return;
    const found = validateJoin(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setStatus({ kind: "error", text: "有几项没填好，按红字改完再寄" });
      letter.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    if (siteKey && !turnstileToken) {
      setStatus({ kind: "error", text: "先完成上面的人机验证，再寄出" });
      return;
    }
    const name = form.name.trim();
    const email = form.email.trim();
    setStatus(null);
    setBusy("pow");
    try {
      // 与后端约定的载荷指纹：apply:<姓名>:<邮箱>（trim 之后，半角冒号）
      const pow = await computePow(`apply:${name}:${email}`, powDifficulty);
      setBusy("submit");
      const result = await requestJson<Receipt>("/api/portal/apply", {
        method: "POST",
        body: JSON.stringify({
          name,
          className: form.className.trim(),
          email,
          strengths: form.strengths.trim(),
          website: form.website,
          pow: powProof(pow),
          turnstile_token: turnstileToken,
        }),
      });
      setReceipt(result);
      const lines = [`${name} · ${form.className.trim()}`, email, ...form.strengths.trim().split(/\n+/).slice(0, 4)];
      if (scene.current && !sceneFailed) scene.current.seal(lines);
      else setPhase("done");
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = (error.payload?.fields ?? {}) as FieldErrors;
        setErrors(fields);
        setStatus({ kind: "error", text: Object.keys(fields).length > 0 ? "服务器没收下这封信，按红字改完再寄" : error.message });
      } else {
        setStatus({ kind: "error", text: (error as Error).message || "没寄出去，可能是网络断了。内容还在，稍后再点一次。" });
      }
      setTurnstileToken("");
      setTurnstileEpoch((value) => value + 1);
    } finally {
      setBusy("");
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  const count = form.strengths.trim().length;
  const letterOn = writing && !receipt;
  return (
    <div className="pt-root pt-scene pt-join" data-phase={phase}>
      <canvas ref={canvas} className="pt-scene-canvas" aria-hidden="true" />
      <SceneBar crumb="join" />

      <section className={phase === "arrive" || phase === "open" ? "pt-intro" : "pt-intro is-away"} aria-labelledby="pt-join-title">
        <h1 id="pt-join-title">加入我们</h1>
        <p>给极客班写一封信，写上姓名、班级、邮箱，再说说你会什么、想做什么。寄出之后，我们用邮件联系你。</p>
      </section>

      <form ref={letter} className={letterOn ? "pt-letter is-on" : "pt-letter"} noValidate aria-labelledby="pt-letter-title" onSubmit={submit} onKeyDown={onKeyDown} aria-hidden={!letterOn}>
        <header className="pt-letter-head">
          <h2 id="pt-letter-title">致 长江大学极客班：</h2>
          <img src={appConfig.portal.brand.logo} alt="" width={44} height={44} />
        </header>
        <div className="pt-letter-row">
          <label className="pt-lf">
            <span>姓名</span>
            <input name="name" value={form.name} onChange={update("name")} autoComplete="name" placeholder="怎么称呼你" maxLength={40} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "lf-name-err" : undefined} />
            {errors.name && (
              <em id="lf-name-err" role="alert">
                {errors.name}
              </em>
            )}
          </label>
          <label className="pt-lf">
            <span>班级</span>
            <input name="className" value={form.className} onChange={update("className")} autoComplete="organization" placeholder="例如 计科 2301 班" maxLength={40} aria-invalid={errors.className ? true : undefined} aria-describedby={errors.className ? "lf-class-err" : undefined} />
            {errors.className && (
              <em id="lf-class-err" role="alert">
                {errors.className}
              </em>
            )}
          </label>
        </div>
        <label className="pt-lf">
          <span>邮箱</span>
          <input name="email" type="email" value={form.email} onChange={update("email")} autoComplete="email" placeholder="name@example.com" maxLength={120} aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? "lf-email-err" : "lf-email-hint"} />
          {errors.email ? (
            <em id="lf-email-err" role="alert">
              {errors.email}
            </em>
          ) : (
            <small id="lf-email-hint">只用来联系你，不会公开</small>
          )}
        </label>
        <label className="pt-lf">
          <span>你会什么，想做什么</span>
          <textarea
            name="strengths"
            rows={5}
            value={form.strengths}
            onChange={update("strengths")}
            maxLength={2000}
            placeholder="做过的项目、参加过的比赛、课程作业、自己写的小工具都可以写。"
            aria-invalid={errors.strengths ? true : undefined}
            aria-describedby={errors.strengths ? "lf-str-err" : "lf-str-count"}
          />
          {errors.strengths ? (
            <em id="lf-str-err" role="alert">
              {errors.strengths}
            </em>
          ) : (
            <small id="lf-str-count">
              <span className="pt-num">{count}</span> / 2000 字，至少 10 字
            </small>
          )}
        </label>
        {/* 蜜罐字段：真人看不见也不会填，机器人会填。 */}
        <div className="pt-trap" aria-hidden="true">
          <label>
            个人主页（不要填写）
            <input name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={update("website")} />
          </label>
        </div>
        <TurnstileWidget siteKey={siteKey} onToken={setTurnstileToken} resetKey={turnstileEpoch} />
        <footer className="pt-letter-foot">
          <button type="submit" className="pt-btn is-primary is-lg" disabled={busy !== ""}>
            <Icon name="send-plane-2-line" size={17} />
            {busy === "pow" ? "正在做防刷验证…" : busy === "submit" ? "正在寄出…" : "寄出这封信"}
            <kbd>⌘ Enter</kbd>
          </button>
          {status && (
            <p className={status.kind === "error" ? "pt-letter-status is-error" : "pt-letter-status"} role="alert">
              {status.kind === "error" && <Icon name="error-warning-line" size={15} />}
              {status.text}
            </p>
          )}
        </footer>
      </form>

      <div ref={receiptRef} className={phase === "done" && receipt ? "pt-receipt is-on" : "pt-receipt"} role="status" aria-live="polite">
        {receipt && (
          <>
            <h2>
              <Icon name="mail-check-line" size={20} /> 信收到了
            </h2>
            <p>{receipt.message}</p>
            <dl className="pt-receipt-meta">
              <div>
                <dt>编号</dt>
                <dd>
                  <code>{receipt.id}</code>
                </dd>
              </div>
              <div>
                <dt>提交时间</dt>
                <dd>{new Date(receipt.submitted_at).toLocaleString("zh-CN", { hour12: false })}</dd>
              </div>
            </dl>
            <p className="pt-receipt-note">记下编号，之后联系我们时报上它。网站上查不到进度，请留意邮箱。</p>
            <div className="pt-row-btns">
              <Link className="pt-btn is-primary" to="/" state={RESUME_DESKTOP}>
                回到桌面
              </Link>
              <Link className="pt-btn" to="/forum-3d">
                去论坛看看
              </Link>
              <button type="button" className="pt-btn is-quiet" onClick={() => window.location.reload()}>
                再写一封
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
