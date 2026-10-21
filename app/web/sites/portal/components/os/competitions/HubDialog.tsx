// 比赛窗口里的对话框（#239）：报名、创建队伍、申请加入、邀请队友、转让领队、二次确认。
// 只盖住比赛窗口的内容（不是整个桌面）：Esc 或点遮罩关掉，Tab 在框里循环，关掉后焦点回到打开它的按钮；手机上从底部弹出。
// 提交失败时把服务端给的原因写在框里、不关框，填好的内容还在。字数上限与服务端契约一致（HUB_LIMITS）。
import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import Icon from "../../Icon";
import Avatar from "./Avatar";
import type { SignupSettings } from "../../../lib/competitions";
import { participationText } from "../../../lib/competitionLabels";
import { HUB_LIMITS, type FreeAgent, type Member, type MemberRead, type MySignup, type Team } from "../../../lib/competitionHub";

/** 详情里会弹出的对话框；`confirm` 是二次确认，确认后发 `method path`。 */
export type Dialog =
  | { kind: "signup" }
  | { kind: "create" }
  | { kind: "apply"; team: Team }
  | { kind: "invite" }
  | { kind: "transfer" }
  | { kind: "confirm"; title: string; body: string; submitText: string; danger?: boolean; path: string; method: "POST" | "DELETE"; done: string };

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ShellProps = { title: string; sub?: string; onClose: () => void; children: ReactNode };

/** 对话框外壳：标题、关闭键、焦点管理。打开时把焦点给带 data-autofocus 的元素（没有就给第一个能聚焦的）。 */
export function HubDialog({ title, sub, onClose, children }: ShellProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = box.current;
    (node?.querySelector<HTMLElement>("[data-autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      // 不往上传：只关对话框，不让手机详情退回列表、也不让窗口收起
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !box.current) return;
    const nodes = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="pt-cx-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="pt-cx-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={sub ? `${id}-sub` : undefined} ref={box} onKeyDown={onKeyDown}>
        <header>
          <div>
            <h4 id={`${id}-title`}>{title}</h4>
            {sub && <p id={`${id}-sub`}>{sub}</p>}
          </div>
          <button type="button" className="pt-cx-x" onClick={onClose} aria-label="关闭">
            <Icon name="close-line" size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

type FormProps = {
  title: string;
  sub?: string;
  submitText: string;
  danger?: boolean;
  disabled?: boolean;
  /** 打开时焦点放哪：有输入框时给输入框（字段自己带 data-autofocus）；危险操作的确认给「取消」，免得回车就做了。 */
  focus?: "submit" | "cancel";
  onClose: () => void;
  /** 成功返回 null（关框），失败返回原因（写在框里）。 */
  onSubmit: () => Promise<string | null>;
  children?: ReactNode;
};

export function HubForm({ title, sub, submitText, danger = false, disabled = false, focus, onClose, onSubmit, children }: FormProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    const fail = await onSubmit();
    setBusy(false);
    if (fail === null) onClose();
    else setError(fail);
  };
  return (
    <HubDialog title={title} sub={sub} onClose={onClose}>
      <form className="pt-cx-form" onSubmit={submit} noValidate>
        {children}
        {error && (
          <p className="pt-cx-err" role="alert">
            {error}
          </p>
        )}
        <div className="pt-cx-dialog-act">
          <button type="button" className="pt-btn" onClick={onClose} data-autofocus={focus === "cancel" ? "" : undefined}>
            取消
          </button>
          <button type="submit" className={danger ? "pt-btn is-danger" : "pt-btn is-primary"} disabled={busy || disabled} aria-busy={busy} data-autofocus={focus === "submit" ? "" : undefined}>
            {busy && <Icon name="loader-4-line" size={15} className="pt-cx-spin" />}
            {submitText}
          </button>
        </div>
      </form>
    </HubDialog>
  );
}

type FieldProps = { label: string; value: string; onChange: (value: string) => void; max: number; multiline?: boolean; placeholder?: string; autoFocus?: boolean };

/** 带字数的输入框；上限由浏览器的 maxLength 挡住，服务端再校验一次。 */
function Field({ label, value, onChange, max, multiline = false, placeholder, autoFocus = false }: FieldProps) {
  const props = {
    value,
    maxLength: max,
    placeholder,
    "data-autofocus": autoFocus ? "" : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
  };
  return (
    <label className="pt-cx-field">
      <span>
        {label}
        <small aria-hidden="true">
          {value.length}/{max}
        </small>
      </span>
      {multiline ? <textarea rows={3} {...props} /> : <input type="text" autoComplete="off" {...props} />}
    </label>
  );
}

type Submit<T> = (body: T) => Promise<string | null>;

/** 报名（也用来改报名留言）。团队赛可以选「出现在找队友里」，默认勾上。 */
export function SignupDialog({ settings, initial, onClose, submit }: { settings: SignupSettings; initial: MySignup | null; onClose: () => void; submit: Submit<{ note: string; looking_for_team?: boolean }> }) {
  const team = settings.participation === "team";
  const [note, setNote] = useState(initial?.note ?? "");
  const [looking, setLooking] = useState(initial?.looking_for_team ?? true);
  return (
    <HubForm
      title={initial ? "修改报名信息" : "报名参赛"}
      sub={participationText(settings)}
      submitText={initial ? "保存" : "确认报名"}
      onClose={onClose}
      onSubmit={() => submit(team ? { note: note.trim(), looking_for_team: looking } : { note: note.trim() })}
    >
      <Field
        label="想说的话（选填）"
        value={note}
        onChange={setNote}
        max={HUB_LIMITS.note}
        multiline
        autoFocus
        placeholder={team ? "擅长的方向、想做的项目；领队邀请人时会看到" : "擅长的方向、想做的项目"}
      />
      {team && (
        <label className="pt-cx-check">
          <input type="checkbox" checked={looking} onChange={(event) => setLooking(event.target.checked)} />
          <span>
            出现在「找队友」里
            <small>领队能看到你和你的留言，直接邀请你入队。</small>
          </span>
        </label>
      )}
    </HubForm>
  );
}

export function CreateTeamDialog({ settings, onClose, submit }: { settings: SignupSettings; onClose: () => void; submit: Submit<{ name: string; slogan: string }> }) {
  const [name, setName] = useState("");
  const [slogan, setSlogan] = useState("");
  return (
    <HubForm
      title="创建队伍"
      sub={`你会成为领队。${participationText(settings)}，人齐后由你确认参赛。`}
      submitText="创建队伍"
      disabled={[...name.trim()].length < HUB_LIMITS.teamNameMin}
      onClose={onClose}
      onSubmit={() => submit({ name: name.trim(), slogan: slogan.trim() })}
    >
      <Field label="队名" value={name} onChange={setName} max={HUB_LIMITS.teamName} autoFocus placeholder="比如：长江 Commit 队" />
      <Field label="口号（选填）" value={slogan} onChange={setSlogan} max={HUB_LIMITS.slogan} placeholder="一句话说说你们想做什么" />
    </HubForm>
  );
}

export function ApplyDialog({ team, max, onClose, submit }: { team: Team; max: number; onClose: () => void; submit: Submit<{ message: string }> }) {
  const [message, setMessage] = useState("");
  const leader = team.members.find((member) => member.role === "leader");
  return (
    <HubForm
      title={`申请加入「${team.name}」`}
      sub={`${team.member_count}/${max} 人${leader ? ` · 领队 ${leader.login}` : ""}。领队同意后你就在队里了。`}
      submitText="发送申请"
      onClose={onClose}
      onSubmit={() => submit({ message: message.trim() })}
    >
      <Field label="给领队的话（选填）" value={message} onChange={setMessage} max={HUB_LIMITS.message} multiline autoFocus placeholder="介绍一下自己，能为队伍做什么" />
    </HubForm>
  );
}

/** 邀请队友：列出正在找队伍的同学，每行一个「邀请」；发出一个就关框，在操作条上说一声。 */
export function InviteDialog({ people, invited, onClose, invite }: { people: MemberRead<FreeAgent[]>; invited: ReadonlySet<string>; onClose: () => void; invite: Submit<FreeAgent> }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const all = people.data ?? [];
  const words = query.trim().toLowerCase();
  const shown = words ? all.filter((person) => `${person.login}\n${person.note}`.toLowerCase().includes(words)) : all;
  const searchable = all.length > 5;
  const send = async (person: FreeAgent) => {
    setBusyId(person.account_id);
    setError(null);
    const fail = await invite(person);
    setBusyId(null);
    if (fail === null) onClose();
    else setError(fail);
  };
  return (
    <HubDialog title="邀请队友" sub="这里是已报名、还没有队伍、正在找队伍的同学。对方接受后就会加入你的队伍。" onClose={onClose}>
      <div className="pt-cx-form">
        {searchable && (
          <label className="pt-cx-field">
            <span>搜索</span>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按用户名或留言搜索" data-autofocus="" />
          </label>
        )}
        {!people.data ? (
          people.phase === "loading" ? (
            <p className="pt-cx-none" role="status">正在读取名单…</p>
          ) : (
            <p className="pt-cx-none">
              名单没加载出来。
              <button type="button" className="pt-cx-link" onClick={people.reload}>重试</button>
            </p>
          )
        ) : shown.length === 0 ? (
          <p className="pt-cx-none">{all.length === 0 ? "现在没有正在找队伍的同学。可以请朋友先报名，并勾上「出现在找队友里」。" : "没有符合的同学。"}</p>
        ) : (
          <ul className="pt-cx-pick">
            {shown.map((person, index) => (
              <li key={person.account_id}>
                <Avatar person={person} size={36} />
                <div>
                  <b>{person.login}</b>
                  <span>{person.note || "没有留言"}</span>
                </div>
                {invited.has(person.account_id) ? (
                  <span className="pt-cx-ok">
                    <Icon name="check-line" size={14} />
                    已邀请
                  </span>
                ) : (
                  <button
                    type="button"
                    className="pt-btn is-sm"
                    disabled={busyId !== null}
                    aria-busy={busyId === person.account_id}
                    data-autofocus={!searchable && index === 0 ? "" : undefined}
                    onClick={() => void send(person)}
                  >
                    邀请<span className="pt-sr"> {person.login}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="pt-cx-err" role="alert">
            {error}
          </p>
        )}
        <div className="pt-cx-dialog-act">
          <button type="button" className="pt-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </HubDialog>
  );
}

export function TransferDialog({ team, onClose, submit }: { team: Team; onClose: () => void; submit: Submit<Member> }) {
  const others = team.members.filter((member) => member.role !== "leader");
  const [pick, setPick] = useState(others[0]?.account_id ?? "");
  const target = others.find((member) => member.account_id === pick) ?? null;
  return (
    <HubForm
      title="转让领队"
      sub="转让后你变成队员；新领队负责邀请、处理申请和确认参赛。"
      submitText="确认转让"
      disabled={!target}
      onClose={onClose}
      onSubmit={() => (target ? submit(target) : Promise.resolve("请先选一位队员。"))}
    >
      {others.length === 0 ? (
        <p className="pt-cx-none">队伍里还没有其他队员。</p>
      ) : (
        <fieldset className="pt-cx-pickset">
          <legend className="pt-sr">新领队</legend>
          <ul className="pt-cx-pick">
            {others.map((member, index) => (
              <li key={member.account_id}>
                <label>
                  <input type="radio" name="new-leader" checked={pick === member.account_id} onChange={() => setPick(member.account_id)} data-autofocus={index === 0 ? "" : undefined} />
                  <Avatar person={member} size={32} />
                  <b>{member.login}</b>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </HubForm>
  );
}

export function ConfirmDialog({ title, body, submitText, danger = false, onClose, submit }: { title: string; body: string; submitText: string; danger?: boolean; onClose: () => void; submit: () => Promise<string | null> }) {
  return (
    <HubForm title={title} submitText={submitText} danger={danger} focus={danger ? "cancel" : "submit"} onClose={onClose} onSubmit={submit}>
      <p className="pt-cx-confirm">{body}</p>
    </HubForm>
  );
}
