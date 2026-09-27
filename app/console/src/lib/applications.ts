// 投递详情页「处理这份投递」的纯逻辑：改状态时要不要给投递人发通知信、提示怎么写、信里的字段怎么校验、
// PATCH 体怎么拼，以及审核记录里每封信的状态怎么说。不导入 Vue，tests/console/applications.test.ts 直接测。
// 字段名、长度上限和错误码与服务端 PATCH /api/console/applications/:id 一致（#148）。
import { fmtDate } from "./format";
import { ApiError } from "./http";
import { APPLICATION_STATUS, isApplicationStatus } from "./statuses";
import type { ApplicationLetter, ApplicationReviewPatch, ApplicationStatus, MailSettings, MailSummary } from "./types";

/** 改成这三种状态时给投递人发通知信；改回「已收到」、只写备注都不发。 */
export type LetterKind = Exclude<ApplicationStatus, "received">;
export const isLetterKind = (value: string): value is LetterKind => value === "interview" || value === "accepted" || value === "rejected";

export const LETTER_LIMITS = { time: 60, place: 120, notes: 1000, message: 1000 } as const;

/** 表单里三种信各自的草稿，切换状态时互不覆盖。 */
export type LetterDraft = { time: string; place: string; interviewNotes: string; acceptedNotes: string; message: string };
export const emptyLetterDraft = (): LetterDraft => ({ time: "", place: "", interviewNotes: "", acceptedNotes: "", message: "" });

export type NoticePlan =
  | { kind: "none" }
  | { kind: "back_to_received"; hint: string }
  | { kind: "letter"; letter: LetterKind; notify: boolean; sends: boolean; hint: string };

/**
 * 从 current 改到 next 时的通知安排。sends：保存后这封信真的会发出去（勾了发邮件、发信已配置、
 * 这个邮箱不被预发布白名单挡住）；按钮据此写「保存并发邮件」。
 */
export function noticePlan(current: string, next: ApplicationStatus, notify: boolean, mail: MailSettings, email: string): NoticePlan {
  if (next === current) return { kind: "none" };
  if (!isLetterKind(next)) return { kind: "back_to_received", hint: "改回已收到不发邮件。" };
  const base = { kind: "letter" as const, letter: next, notify };
  if (!notify) return { ...base, sends: false, hint: "这次只改状态，不给投递人发邮件。" };
  if (!mail.enabled) return { ...base, sends: false, hint: "发信还没有配置，这封不会发出。" };
  if (!mail.deliverable) {
    const hint = mail.recipients === "allowlist" ? "预发布只给白名单里的邮箱发信，这封不会发出。" : "这封不会发出。";
    return { ...base, sends: false, hint };
  }
  return { ...base, sends: true, hint: `保存后给 ${email} 发「${APPLICATION_STATUS[next].label}」通知信。` };
}

export type LetterField = "time" | "place" | "notes" | "message";
export type LetterErrors = Partial<Record<LetterField, string>>;

/** 发信前在本地先核对一遍；服务端还会再核对（letter_required）。 */
export function letterErrors(kind: LetterKind, draft: LetterDraft): LetterErrors {
  const errors: LetterErrors = {};
  const tooLong = (value: string, max: number) => value.trim().length > max;
  if (kind === "interview") {
    if (!draft.time.trim()) errors.time = "请填面试时间。";
    else if (tooLong(draft.time, LETTER_LIMITS.time)) errors.time = `面试时间最多 ${LETTER_LIMITS.time} 个字。`;
    if (!draft.place.trim()) errors.place = "请填面试地点。";
    else if (tooLong(draft.place, LETTER_LIMITS.place)) errors.place = `面试地点最多 ${LETTER_LIMITS.place} 个字。`;
    if (tooLong(draft.interviewNotes, LETTER_LIMITS.notes)) errors.notes = `面试说明最多 ${LETTER_LIMITS.notes} 个字。`;
  } else if (kind === "accepted") {
    if (tooLong(draft.acceptedNotes, LETTER_LIMITS.notes)) errors.notes = `最多 ${LETTER_LIMITS.notes} 个字。`;
  } else if (tooLong(draft.message, LETTER_LIMITS.message)) {
    errors.message = `最多 ${LETTER_LIMITS.message} 个字。`;
  }
  return errors;
}

/** 这种信用得到的字段；空的选填项不发。 */
export function letterPayload(kind: LetterKind, draft: LetterDraft): ApplicationLetter {
  const optional = (key: "notes" | "message", value: string) => (value.trim() ? { [key]: value.trim() } : {});
  if (kind === "interview") return { time: draft.time.trim(), place: draft.place.trim(), ...optional("notes", draft.interviewNotes) };
  if (kind === "accepted") return optional("notes", draft.acceptedNotes);
  return optional("message", draft.message);
}

/**
 * 审核记录的版本号：最大的 id，没有记录时是 0，和服务端一样。id 自增，只会变大；
 * 列表按时间排，服务器时钟往回拨过时排第一的不一定是最新的一条。
 */
export function newestReviewId(reviews: readonly { id: number }[]): number {
  return reviews.reduce((newest, review) => Math.max(newest, review.id), 0);
}

/**
 * PATCH 体：只带改了的状态、非空备注；改到要发信的状态时带上 notify，勾了才带信的内容。
 * 总是带上页面上看到的状态和审核记录的版本号（latestReviewId，见 newestReviewId），
 * 别人在这之间处理过时服务端回 409，不按旧画面改、不发信；只比状态会漏掉「改走又改回」。
 */
export function reviewPatch(input: {
  current: string; latestReviewId: number; status: ApplicationStatus; note: string; notify: boolean; draft: LetterDraft;
}): ApplicationReviewPatch {
  const body: ApplicationReviewPatch = isApplicationStatus(input.current) ? { expected_status: input.current, expected_review_id: input.latestReviewId } : {};
  const changed = input.status !== input.current;
  if (changed) body.status = input.status;
  if (input.note.trim()) body.note = input.note.trim();
  if (changed && isLetterKind(input.status)) {
    body.notify = input.notify;
    if (input.notify) body.letter = letterPayload(input.status, input.draft);
  }
  return body;
}

/** 409 status_changed：别人刚改过这份投递的状态。页面刷新后用这句话提示。 */
export function statusChangedMessage(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== "status_changed") return null;
  return error.message || "这份投递刚被别人处理过，看过最新的记录再改。";
}

/**
 * 服务端按字段拒绝的错误，显示在对应的输入框下面：invalid_status 在状态上，letter_required 在面试时间、地点上，
 * letter_invalid（信渲染不出来，例如没配回信地址却写了「直接回复这封邮件」）在「通知投递人」一栏里。
 * 其它错误返回 null，交给 ErrorAlert。
 */
export function serverFieldErrors(error: unknown): { status?: string; notice?: string; letter: LetterErrors } | null {
  if (!(error instanceof ApiError) || error.status !== 400) return null;
  if (error.code === "invalid_status") return { status: error.message || "状态只能是已收到、待面试、已录取、未通过。", letter: {} };
  if (error.code === "letter_invalid") return { notice: error.message || "信的内容不合规，改一下再发。", letter: {} };
  if (error.code !== "letter_required") return null;
  const fields = error.payload?.fields;
  if (!fields || typeof fields !== "object") return null;
  const letter: LetterErrors = {};
  const fallback: Record<"time" | "place", string> = { time: "请填面试时间。", place: "请填面试地点。" };
  for (const key of ["time", "place"] as const) {
    const value = (fields as Record<string, unknown>)[key];
    if (typeof value === "string" && value) letter[key] = value;
    else if (value) letter[key] = fallback[key];
  }
  return Object.keys(letter).length ? { letter } : null;
}

export type MailTone = "success" | "pending" | "warning" | "danger" | "muted";

/** 一封信现在的状态，用一句话说；null 是这次没有发信。 */
export function mailState(summary: MailSummary | null): { text: string; tone: MailTone } {
  if (!summary) return { text: "没有发", tone: "muted" };
  switch (summary.status) {
    case "sent":
      return { text: `已发出（${fmtDate(summary.sent_at ?? summary.updated_at)}）`, tone: "success" };
    case "pending":
      return summary.attempts > 0
        ? { text: `发送失败，等待第 ${summary.attempts} 次重试`, tone: "warning" }
        : { text: "正在发", tone: "pending" };
    case "sending":
      return { text: "正在发", tone: "pending" };
    case "failed":
      return { text: summary.attempts > 0 ? `没有发出：发了 ${summary.attempts} 次都失败了` : "没有发出", tone: "danger" };
    case "skipped":
      if (summary.skip_reason === "not_allowlisted") return { text: "预发布未发送（不在白名单）", tone: "muted" };
      if (summary.skip_reason === "mail_disabled") return { text: "没有发：发信还没有配置", tone: "muted" };
      if (summary.skip_reason === "recipient_limited") return { text: "没有发：24 小时内已经给这个邮箱发过确认信", tone: "muted" };
      if (summary.skip_reason === "source_limited") return { text: "没有发：同一个网络这段时间投递得太多", tone: "muted" };
      if (summary.skip_reason === "rate_limited") return { text: "没有发：这一小时发出的确认信已到上限", tone: "muted" };
      return { text: summary.skip_reason ? `没有发：${summary.skip_reason}` : "没有发", tone: "muted" };
    default:
      return { text: String(summary.status), tone: "muted" };
  }
}

/** 保存成功后的提示，按服务端回来的这封信的状态说。 */
export function savedMessage(mail: MailSummary | null): string {
  if (!mail) return "审核记录已更新。";
  if (mail.status === "pending" || mail.status === "sending") return "通知信正在发，结果记在审核记录里。";
  if (mail.status === "sent") return "通知信已发出。";
  if (mail.status === "failed") return "通知信没有发出，详情见审核记录。";
  if (mail.skip_reason === "not_allowlisted") return "这封信没有发出：预发布只给白名单里的邮箱发信。";
  if (mail.skip_reason === "mail_disabled") return "这封信没有发出：发信还没有配置。";
  return "审核记录已更新。";
}
