// 账号资料窗口的正文（SPEC §4.3；#280 起从头像下面的弹层改成桌面窗口，所有者 2026-10-24 16:38 要求账号资料也做成桌面上的窗口，
// 里面可以改动对应的头像和相关信息）。窗口外框、拖动和关闭在 Windows.tsx，这里只管内容。
// 访客：登录、注册两个按钮和一句说明。已登录：换头像（裁成方形后上传）、昵称、@用户名、简介（失焦或回车保存），
// 身份、年级、部门、称号，实名信息（只读，读 /api/identity/me，不放进全站的登录状态），登录方式（邮箱可以添加和删除、
// Google 可以绑定、GitHub 只显示），注册用户填邀请码成为成员，底部是账号设置和退出。接口见 #274 的接口契约 §2。
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, ApiError } from "@shared/lib/api";
import { registerHref, type Account } from "../../lib/account";
import { links } from "../../lib/links";
import type { LinkNotice } from "../../lib/linkNotice";
import { goTo } from "../../lib/navigate";
import Icon from "../Icon";

type Props = {
  account: Account | null;
  /** 统一登录页地址，登录后回到当前页面（YugcOs 跟着路由重算） */
  signInLink: string;
  onPatch: (change: Partial<Account>) => void;
  onReload: () => void;
  onSignOut: () => void;
  /** 从 Google 绑定回来时地址上带的结果（lib/linkNotice.ts） */
  linkNotice?: LinkNotice | null;
};

/** 接口回的错误说明（契约里都是中文）；连不上服务器时给一句通用的 */
function problem(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "没有连上服务器，稍后再试一次。";
}

export default function ProfileCard({ account, signInLink, onPatch, onReload, onSignOut, linkNotice = null }: Props) {
  if (!account) return <GuestCard signInLink={signInLink} />;
  return <MemberCard account={account} signInLink={signInLink} onPatch={onPatch} onReload={onReload} onSignOut={onSignOut} linkNotice={linkNotice} />;
}

function GuestCard({ signInLink }: { signInLink: string }) {
  return (
    <div className="pt-profile is-guest">
      <span className="pt-avatar is-lg">
        <Icon name="user-3-line" size={30} />
      </span>
      <p className="pt-profile-lead">还没有登录</p>
      <div className="pt-profile-actions">
        <a className="pt-btn is-primary" href={signInLink}>
          登录
        </a>
        <a className="pt-btn" href={registerHref()}>
          注册
        </a>
      </div>
      <p className="pt-profile-hint">注册不需要邀请码，有邀请码可以直接成为成员</p>
    </div>
  );
}

type ProfileBody = { username?: string; display_name?: string; bio?: string; avatar_url?: string | null };

type EmailRow = { id: string | null; label: string; primary: boolean };
type IdentityView = {
  identities?: Array<{ provider?: unknown; id?: unknown; label?: unknown; primary?: unknown }>;
  real_name?: unknown;
  grade_label?: unknown;
};

/**
 * 窗口打开时读一次 /api/identity/me：带 id 的邮箱列表（删的时候要 id）和本人的实名信息。
 * 读不到时邮箱只显示 /auth/me 里打了码的地址、不给删，实名信息不显示。
 */
function useIdentityView(version: number) {
  const [view, setView] = useState<IdentityView | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api<IdentityView>("/api/identity/me")
      .then((next) => {
        if (!cancelled && next && typeof next === "object") setView(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [version]);
  return view;
}

function MemberCard({ account, signInLink, onPatch, onReload, onSignOut, linkNotice }: Props & { account: Account }) {
  const save = async (body: Record<string, string>) => {
    const next = await api<ProfileBody>("/api/identity/profile", { method: "PATCH", body: JSON.stringify(body) });
    onPatch({
      ...(typeof next?.username === "string" ? { username: next.username } : {}),
      ...(typeof next?.display_name === "string" ? { displayName: next.display_name } : {}),
      ...(typeof next?.bio === "string" ? { bio: next.bio } : {}),
    });
  };
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const view = useIdentityView(version);
  return (
    <div className="pt-profile">
      <section className="pt-profile-head">
        <AvatarPicker account={account} onPatch={onPatch} onError={setAvatarError} />
        <div className="pt-profile-names">
          <ProfileField label="昵称" value={account.displayName} check={(value) => (value.length < 1 || value.length > 32 ? "昵称要 1 到 32 个字" : null)} onSave={(value) => save({ display_name: value })} className="is-name" />
          <ProfileField
            label="用户名"
            prefix="@"
            value={account.username}
            normalize={(value) => value.toLowerCase()}
            check={(value) => (/^[a-z0-9_]{3,24}$/.test(value) ? null : "用户名是 3 到 24 位小写字母、数字或下划线")}
            onSave={(value) => save({ username: value })}
          />
          <IdentityLine account={account} />
        </div>
      </section>
      {avatarError && (
        <small className="pt-profile-msg is-error" role="alert">
          {avatarError}
        </small>
      )}
      <ProfileField label="简介" multiline placeholder="写一句介绍，最多 200 字" value={account.bio} check={(value) => (value.length > 200 ? "简介最多 200 字" : null)} onSave={(value) => save({ bio: value })} />
      <RealInfo view={view} />
      <Bindings
        account={account}
        view={view}
        signInLink={signInLink}
        linkNotice={linkNotice ?? null}
        onChanged={() => {
          setVersion((value) => value + 1);
          onReload();
        }}
      />
      {account.level === "registered" && <InviteRedeem onReload={onReload} />}
      <footer className="pt-profile-foot">
        <a href={links.account()}>
          <Icon name="settings-3-line" size={16} /> 账号设置
        </a>
        {account.consoleLink && <a href={links.console()}>控制台</a>}
        <button type="button" onClick={onSignOut}>
          <Icon name="logout-box-r-line" size={16} /> 退出
        </button>
      </footer>
    </div>
  );
}

/**
 * 实名信息（#280）：真实姓名和年级，只读。本人填过以后只能找管理员改；只在这个窗口里显示，
 * 菜单栏、身份行和终端都不显示真实姓名。
 */
function RealInfo({ view }: { view: IdentityView | null }) {
  const name = typeof view?.real_name === "string" && view.real_name ? view.real_name : null;
  const grade = typeof view?.grade_label === "string" && view.grade_label ? view.grade_label : null;
  if (!name && !grade) return null;
  return (
    <section className="pt-profile-real" aria-labelledby="pt-profile-real-title">
      <h3 id="pt-profile-real-title">实名信息</h3>
      <dl>
        <div>
          <dt>真实姓名</dt>
          <dd>{name ?? "没填"}</dd>
        </div>
        <div>
          <dt>所在年级</dt>
          <dd>{grade ?? "没填"}</dd>
        </div>
      </dl>
      <p className="pt-profile-hint">只有你自己和管理员看得到。年级每年 9 月 1 日自动升一级；填错了请联系管理员在控制台修改。</p>
    </section>
  );
}

/** 身份、年级（#280）、部门（带部门色的圆点）、称号，一行平铺，比如「注册用户 · 大一 · 无部门」；旧服务端没有身份字段时整行不显示 */
function IdentityLine({ account }: { account: Account }) {
  if (!account.levelName) return null;
  const department = account.department ?? { name: "无部门", tone: "ink" as const };
  return (
    <p className="pt-profile-meta">
      <span>{account.levelName}</span>
      {account.gradeLabel && <span>{account.gradeLabel}</span>}
      <span className="pt-profile-dept" data-tone={department.tone}>
        <i aria-hidden="true" />
        {department.name}
      </span>
      {account.titles.map((title) => (
        <span key={title.id}>{title.name}</span>
      ))}
    </p>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  check: (value: string) => string | null;
  normalize?: (value: string) => string;
  prefix?: string;
  multiline?: boolean;
  placeholder?: string;
  className?: string;
};

/** 可以直接改的一项资料：失焦或按回车保存（简介里 Shift+回车换行），保存失败时留着改到一半的值和原因 */
function ProfileField({ label, value, onSave, check, normalize = (text) => text, prefix, multiline = false, placeholder, className }: FieldProps) {
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });
  const saved = useRef(value);
  useEffect(() => {
    saved.current = value;
    setDraft(value);
  }, [value]);

  const commit = async () => {
    const next = normalize(draft.trim());
    if (next === saved.current) {
      setDraft(next);
      return;
    }
    const bad = check(next);
    if (bad) {
      setState({ kind: "error", text: bad });
      return;
    }
    setState({ kind: "saving" });
    try {
      await onSave(next);
      saved.current = next;
      setState({ kind: "saved", text: "已保存" });
    } catch (error) {
      setState({ kind: "error", text: problem(error) });
    }
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || (multiline && event.shiftKey)) return;
    event.preventDefault();
    event.currentTarget.blur();
  };
  const common = {
    value: draft,
    placeholder,
    "aria-label": label,
    "aria-invalid": state.kind === "error" || undefined,
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
      if (state.kind !== "saving") setState({ kind: "idle" });
    },
    onBlur: () => void commit(),
    onKeyDown: onKey,
  };
  return (
    <label className={className ? `pt-profile-field ${className}` : "pt-profile-field"}>
      <span className="pt-profile-label">{label}</span>
      <span className="pt-profile-input">
        {prefix && <em aria-hidden="true">{prefix}</em>}
        {/* data-no-autofocus：窗口打开时焦点先落在「换头像」上，不直接进输入框（这个窗口里的输入框都带这个标记） */}
        {multiline ? <textarea rows={3} maxLength={200} data-no-autofocus {...common} /> : <input type="text" autoComplete="off" spellCheck={false} data-no-autofocus {...common} />}
      </span>
      {state.kind !== "idle" && (
        <small className={state.kind === "error" ? "pt-profile-msg is-error" : "pt-profile-msg"} role={state.kind === "error" ? "alert" : "status"}>
          {state.kind === "saving" ? "正在保存…" : state.text}
        </small>
      )}
    </label>
  );
}

const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** 服务端会再转成 512px；这里先把方形裁到最多 1024px，传得快一点 */
const AVATAR_SIDE = 1024;

/** 从中间裁成正方形，最长边不超过 1024px，转成 webp（浏览器不支持编码 webp 时 toBlob 会给 png） */
async function squareAvatar(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(side, AVATAR_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.92));
  if (!blob) throw new Error("toBlob");
  return blob;
}

type AvatarProps = { account: Account; onPatch: (change: Partial<Account>) => void; onError: (text: string | null) => void };

function AvatarPicker({ account, onPatch, onError }: AvatarProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) {
      onError("头像只能用 PNG、JPG、WebP 或 GIF 图片");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      let square: Blob;
      try {
        square = await squareAvatar(file);
      } catch {
        onError("这张图片读不出来，换一张试试");
        return;
      }
      if (square.size > AVATAR_MAX_BYTES) {
        onError("图片太大了，头像最大 2MB");
        return;
      }
      const result = await api<{ avatar_url?: string }>("/api/identity/avatar", { method: "PUT", body: square, headers: { "content-type": square.type } });
      if (typeof result?.avatar_url === "string") onPatch({ avatarUrl: result.avatar_url });
    } catch (error) {
      onError(problem(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pt-profile-avatar">
      <button type="button" aria-label="换头像" aria-busy={busy || undefined} disabled={busy} onClick={() => input.current?.click()}>
        <span className="pt-avatar is-lg">{account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : <Icon name="user-3-line" size={30} />}</span>
        <i aria-hidden="true">
          <Icon name="camera-line" size={14} />
        </i>
      </button>
      <input
        ref={input}
        type="file"
        accept={AVATAR_TYPES.join(",")}
        hidden
        data-no-autofocus
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

/** 改登录邮箱要 10 分钟内登录过（#262 的 step-up）：超时了就请人重新登录一次再回来 */
function needsFreshLogin(error: unknown): boolean {
  return error instanceof ApiError && error.code === "step_up_required";
}

/** 登录方式：邮箱列表（主邮箱不能删）和添加邮箱、Google（没绑定时可以绑）、GitHub（只显示） */
function Bindings({ account, view, signInLink, linkNotice, onChanged }: { account: Account; view: IdentityView | null; signInLink: string; linkNotice: LinkNotice | null; onChanged: () => void }) {
  const emails: EmailRow[] = Array.isArray(view?.identities)
    ? view.identities
        .filter((item) => item.provider === "email" && typeof item.label === "string")
        .map((item) => ({ id: typeof item.id === "string" ? item.id : null, label: item.label as string, primary: item.primary === true }))
    : account.identities.emails.map((label, index) => ({ id: null, label, primary: index === 0 }));
  const [error, setError] = useState<{ text: string; fresh: boolean } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; confirm: boolean } | null>(null);
  const [linking, setLinking] = useState(false);

  // 绑定 Google 不能直接链到 /auth/google：那是登录入口，Google 账号没绑过任何账号时会注册出一个新账号并换掉当前会话（#291）。
  // 这里先让服务端记下「给当前账号绑定」，拿到授权地址再跳过去；回来时地址上带 link=<结果>&provider=google。
  const linkGoogle = async () => {
    setError(null);
    setLinking(true);
    try {
      const started = await api<{ authorize_url?: unknown }>("/api/identity/link", { method: "POST", body: JSON.stringify({ provider: "google", return_to: "/?open=profile" }) });
      if (typeof started?.authorize_url !== "string") throw new Error("missing authorize url");
      goTo(started.authorize_url);
    } catch (failure) {
      setLinking(false);
      setError({ text: problem(failure), fresh: needsFreshLogin(failure) });
    }
  };

  const remove = async (row: EmailRow) => {
    if (!row.id || row.primary) return;
    if (removing?.id !== row.id || !removing.confirm) {
      setRemoving({ id: row.id, confirm: true });
      return;
    }
    setError(null);
    setRemoving({ id: row.id, confirm: false });
    try {
      await api("/api/identity/email/remove", { method: "POST", body: JSON.stringify({ identity_id: row.id }) });
      onChanged();
    } catch (failure) {
      setError({ text: problem(failure), fresh: needsFreshLogin(failure) });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="pt-profile-bind" aria-labelledby="pt-profile-bind-title">
      <h3 id="pt-profile-bind-title">登录方式</h3>
      <ul>
        {emails.map((row) => (
          <li key={row.id ?? row.label}>
            <Icon name="mail-line" size={16} />
            <span className="pt-profile-bind-name">{row.label}</span>
            {row.primary ? (
              <small>主邮箱</small>
            ) : (
              row.id && (
                <button type="button" className="pt-profile-link is-danger" disabled={removing?.id === row.id && !removing.confirm} onClick={() => void remove(row)}>
                  {removing?.id === row.id && removing.confirm ? "确认删除" : "删除"}
                </button>
              )
            )}
          </li>
        ))}
        <li>
          <Icon name="google-line" size={16} />
          <span className="pt-profile-bind-name">Google</span>
          {account.identities.google ? (
            <small>已绑定</small>
          ) : (
            <button type="button" className="pt-profile-link" disabled={linking} onClick={() => void linkGoogle()}>
              {linking ? "正在跳转…" : "绑定"}
            </button>
          )}
        </li>
        {account.identities.github && (
          <li>
            <Icon name="github-line" size={16} />
            <span className="pt-profile-bind-name">{account.identities.github}</span>
            <small>GitHub</small>
          </li>
        )}
      </ul>
      {linkNotice && (
        <small className={`pt-profile-msg ${linkNotice.tone === "ok" ? "is-ok" : "is-error"}`} role={linkNotice.tone === "ok" ? "status" : "alert"}>
          {linkNotice.text}
        </small>
      )}
      <AddEmail
        onAdded={onChanged}
        onFreshLogin={(text) => setError({ text, fresh: true })}
      />
      {error && (
        <small className="pt-profile-msg is-error" role="alert">
          {error.text}
          {error.fresh && (
            <>
              {" "}
              <a href={signInLink}>重新登录</a>
            </>
          )}
        </small>
      )}
    </section>
  );
}

/** 添加邮箱：填地址发验证码，再填 6 位验证码（POST /api/identity/email/start、/verify，和控制台账号页一样） */
function AddEmail({ onAdded, onFreshLogin }: { onAdded: () => void; onFreshLogin: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const target = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setMessage("邮箱格式不对");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ resend_after?: number }>("/api/identity/email/start", { method: "POST", body: JSON.stringify({ email: target }) });
      setSentTo(target);
      setCode("");
      setWait(typeof result?.resend_after === "number" ? result.resend_after : 60);
    } catch (error) {
      if (needsFreshLogin(error)) onFreshLogin(problem(error));
      else setMessage(problem(error));
    } finally {
      setBusy(false);
    }
  };
  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setMessage("验证码是 6 位数字");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/identity/email/verify", { method: "POST", body: JSON.stringify({ code }) });
      setOpen(false);
      setSentTo(null);
      setEmail("");
      setCode("");
      onAdded();
    } catch (error) {
      setMessage(problem(error));
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button type="button" className="pt-profile-link" onClick={() => setOpen(true)}>
        <Icon name="add-line" size={16} /> 添加邮箱
      </button>
    );
  return (
    <div className="pt-profile-add">
      <form className="pt-profile-row" onSubmit={send}>
        <input type="email" value={email} placeholder="新邮箱地址" aria-label="新邮箱地址" autoComplete="email" data-no-autofocus onChange={(event) => setEmail(event.target.value)} />
        <button type="submit" className="pt-btn" disabled={busy || wait > 0}>
          {wait > 0 ? `${wait} 秒后重发` : sentTo ? "重发" : "发验证码"}
        </button>
      </form>
      {sentTo && (
        <form className="pt-profile-row" onSubmit={verify}>
          <input inputMode="numeric" value={code} placeholder={`发到 ${sentTo} 的验证码`} aria-label="验证码" maxLength={6} autoComplete="one-time-code" data-no-autofocus onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
          <button type="submit" className="pt-btn is-primary" disabled={busy}>
            确认
          </button>
        </form>
      )}
      {message && (
        <small className="pt-profile-msg is-error" role="alert">
          {message}
        </small>
      )}
    </div>
  );
}

/** 注册用户填邀请码成为极客班成员（POST /api/identity/invite/redeem） */
function InviteRedeem({ onReload }: { onReload: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = code.trim();
    if (!value) {
      setMessage({ ok: false, text: "先填邀请码" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/identity/invite/redeem", { method: "POST", body: JSON.stringify({ code: value }) });
      setMessage({ ok: true, text: "已经是极客班成员了" });
      onReload();
    } catch (error) {
      setMessage({ ok: false, text: problem(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="pt-profile-invite" onSubmit={submit}>
      <label htmlFor="pt-profile-invite-code">填邀请码成为极客班成员</label>
      <div className="pt-profile-row">
        <input id="pt-profile-invite-code" value={code} autoComplete="off" spellCheck={false} data-no-autofocus onChange={(event) => setCode(event.target.value)} />
        <button type="submit" className="pt-btn is-primary" disabled={busy}>
          提交
        </button>
      </div>
      {message && (
        <small className={message.ok ? "pt-profile-msg is-ok" : "pt-profile-msg is-error"} role={message.ok ? "status" : "alert"}>
          {message.text}
        </small>
      )}
    </form>
  );
}
