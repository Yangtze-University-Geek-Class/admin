// 注册邀请码（#262）控制台页面的纯逻辑：状态文案、表单与提交内容。不导入 Vue，tests/console 直接测。
// 规则与服务端一致（app/server/src/lib/invite-codes.ts）：新建的邀请码 8–40 位字母、数字、_、-，存成小写；次数、过期为空表示不限。
import { beijingDate, dateEdge } from "./competitions";
import type { InviteCode } from "./types";

export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;
export const INVITE_MAX_USES = 100_000;

export type InviteState = "usable" | "disabled" | "expired" | "used_up";
export const INVITE_STATE_TEXT: Record<InviteState, string> = { usable: "可用", disabled: "已停用", expired: "已过期", used_up: "次数用完" };

/** 列表里的状态：停用优先，其次过期、用完。 */
export function inviteState(invite: Pick<InviteCode, "disabled" | "expires_at" | "max_uses" | "used_count">, now = Date.now()): InviteState {
  if (invite.disabled) return "disabled";
  if (invite.expires_at !== null && invite.expires_at <= now) return "expired";
  if (invite.max_uses !== null && invite.used_count >= invite.max_uses) return "used_up";
  return "usable";
}

export const usesText = (invite: Pick<InviteCode, "max_uses" | "used_count">) =>
  (invite.max_uses === null ? `${invite.used_count} 次（不限）` : `${invite.used_count} / ${invite.max_uses} 次`);

/** 表单：次数与过期日期是文本框里的字符串，空表示不限。 */
export type InviteForm = { code: string; note: string; maxUses: string; expiresDate: string };

export const emptyInviteForm = (): InviteForm => ({ code: randomInviteCode(), note: "", maxUses: "", expiresDate: "" });
export const inviteFormFrom = (invite: InviteCode): InviteForm => ({
  code: invite.code, note: invite.note, maxUses: invite.max_uses === null ? "" : String(invite.max_uses), expiresDate: beijingDate(invite.expires_at),
});

/** 10 位随机小写字母和数字（去掉容易看错的 0、1、l、o）。 */
export function randomInviteCode(length = 10): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

type Field = "code" | "note" | "maxUses" | "expiresDate";

/** 逐条校验，空对象表示可以提交。`creating` 为 false 时不看邀请码（建好后不能改）。 */
export function inviteErrors(form: InviteForm, creating: boolean, now = Date.now()): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  if (creating && !INVITE_CODE_PATTERN.test(form.code.trim())) errors.code = "邀请码是 8–40 位字母、数字、下划线或短横线";
  if ([...form.note.trim()].length > 100) errors.note = "备注最多 100 个字";
  const uses = form.maxUses.trim();
  if (uses && (!/^\d+$/.test(uses) || Number(uses) < 1 || Number(uses) > INVITE_MAX_USES)) errors.maxUses = `次数是 1 到 ${INVITE_MAX_USES} 的整数，不限就留空`;
  const date = form.expiresDate.trim();
  if (date) {
    const end = dateEdge(date, "end");
    if (end === null) errors.expiresDate = "日期不对";
    else if (end <= now) errors.expiresDate = "过期日期要在今天或以后";
  }
  return errors;
}

/** 提交内容。新建时带上全部字段；修改时只带改动的字段（服务端按字段记审计）。 */
export function invitePayload(form: InviteForm, original?: InviteCode): Record<string, unknown> {
  const maxUses = form.maxUses.trim() ? Number(form.maxUses.trim()) : null;
  const expiresAt = form.expiresDate.trim() ? dateEdge(form.expiresDate, "end") : null;
  const note = form.note.trim();
  if (!original) return { code: form.code.trim(), note, max_uses: maxUses, expires_at: expiresAt };
  const patch: Record<string, unknown> = {};
  if (note !== original.note) patch.note = note;
  if (maxUses !== original.max_uses) patch.max_uses = maxUses;
  if (beijingDate(expiresAt) !== beijingDate(original.expires_at)) patch.expires_at = expiresAt;
  return patch;
}
