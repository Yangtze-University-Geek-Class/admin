import { afterEach, describe, expect, it, vi } from "vitest";
import { EMAILS_MAX, actionText, loginIsFresh, membershipText, passwordProblem, providerText } from "../../app/console/src/lib/account";
import {
  INVITE_CODE_PATTERN as CONSOLE_INVITE_PATTERN, emptyInviteForm, inviteErrors, invitePayload, inviteState, randomInviteCode, usesText,
} from "../../app/console/src/lib/invites";
import { dateEdge } from "../../app/console/src/lib/competitions";
import { mockAccount, MOCK_PERSONAS, routeConsole } from "../../app/console/src/mock/console";
import { mockApi } from "../../app/console/src/mock";
import { INVITE_CODE_CREATE_PATTERN, inviteUsable } from "../../app/server/src/lib/invite-codes";
import { passwordError } from "../../app/server/src/lib/password-policy";
import { EMAILS_MAX as SERVER_EMAILS_MAX } from "../../app/server/src/lib/identity-store";
import type { InviteCode } from "../../app/console/src/lib/types";

const NOW = Date.UTC(2026, 9, 23, 4);
const invite = (patch: Partial<InviteCode> = {}): InviteCode => ({
  id: 1, code: "fall2026", note: "", max_uses: null, used_count: 0, expires_at: null, disabled: false,
  created_by: "x", created_at: NOW, updated_at: NOW, usable: true, ...patch,
});

describe("账号页 (lib/account)", () => {
  it("密码规则与服务端一样：至少 8 位、不超过 72 字节，两次一致", () => {
    for (const candidate of ["short", "abcd123", "abcd1234", "abcdefgh", "a".repeat(15), "汉".repeat(24), "汉".repeat(25), "a".repeat(72), "a".repeat(73)]) {
      const server = passwordError(candidate);
      const local = passwordProblem(candidate, candidate);
      expect(local === null, candidate.slice(0, 8)).toBe(server === null);
    }
    expect(passwordProblem("abcd123", "abcd123")).toBe("密码至少 8 位");
    expect(passwordProblem("abcd1234", "abcd1234")).toBeNull();
    expect(passwordProblem("a".repeat(15), "a".repeat(16))).toBe("两次输入的密码不一样");
  });

  it("成员资格按组织角色或邀请码说一句话", () => {
    expect(membershipText({ state: "active", org_role: "admin", via_invite: false })).toBe("极客班成员 · 站内管理员");
    expect(membershipText({ state: "active", org_role: "member", via_invite: true })).toBe("极客班成员 · 用邀请码注册");
    expect(membershipText({ state: "active", org_role: "member", via_invite: false })).toBe("极客班成员");
    // #274：没填邀请码注册的账号从没当过成员，不说成「已经不是」；曾经用邀请码进来、后来被收回的才这样说。
    expect(membershipText({ state: "not_member", org_role: null, via_invite: false })).toBe("不是极客班成员");
    expect(membershipText({ state: "not_member", org_role: null, via_invite: true })).toBe("已经不是极客班成员");
  });

  it("记录与登录方式的中文名，未知的原样显示", () => {
    expect(actionText("password_set")).toBe("设置密码");
    expect(actionText("password_reset")).toBe("重设密码");
    expect(actionText("unlink")).toBe("解绑登录方式");
    expect(EMAILS_MAX).toBe(SERVER_EMAILS_MAX);
    expect(actionText("something_new")).toBe("something_new");
    expect(providerText("google")).toBe("Google");
    expect(providerText(null)).toBe("-");
  });

  it("这次登录在 step_up_until 之前算刚登录过", () => {
    expect(loginIsFresh({ session: { provider: "email", created_at: NOW, expires_at: NOW, step_up_until: NOW + 1 } }, NOW)).toBe(true);
    expect(loginIsFresh({ session: { provider: "email", created_at: NOW, expires_at: NOW, step_up_until: NOW } }, NOW)).toBe(false);
  });

  it("开发预览的账号样板只给打码后的邮箱", () => {
    const view = mockAccount(MOCK_PERSONAS.owner_email);
    expect(view.session.provider).toBe("email");
    for (const item of view.identities) if (item.provider === "email") expect(item.label).toMatch(/^.\*\*\*@/);
    // 和服务端一样：邮箱带 id，主邮箱在前（#272）
    const emails = view.identities.filter(item => item.provider === "email");
    expect(emails.map(item => item.primary)).toEqual([true, false]);
    expect(new Set(emails.map(item => item.id)).size).toBe(emails.length);
  });

  afterEach(() => { vi.unstubAllGlobals(); });
  it("开发预览：没有登录邮箱的两个样板要先绑邮箱，一个刚登录、一个要先重新登录；其余样板不要求（#273）", async () => {
    const fresh = mockAccount(MOCK_PERSONAS.no_email);
    expect(fresh).toMatchObject({ email_required: true, available: ["email"] });
    expect(fresh.identities.map(item => item.provider)).toEqual(["github"]);
    expect(loginIsFresh(fresh)).toBe(true);
    expect(loginIsFresh(mockAccount(MOCK_PERSONAS.no_email_stale))).toBe(false);
    for (const name of ["owner", "owner_email", "member", "alumni", "registered"]) expect(mockAccount(MOCK_PERSONAS[name]).email_required, name).toBe(false);

    vi.stubGlobal("window", { location: { search: "?__persona=no_email" } });
    expect(routeConsole(new URL("http://mock.local/api/console/me"))).toMatchObject({ email_required: true });
    expect(await mockApi("/auth/me")).toMatchObject({ signed_in: true, email_required: true });
    vi.stubGlobal("window", { location: { search: "?__persona=member" } });
    expect(routeConsole(new URL("http://mock.local/api/console/me"))).toMatchObject({ email_required: false });
  });
});

describe("注册邀请码 (lib/invites)", () => {
  it("邀请码格式与服务端一致，随机生成的总能用", () => {
    expect(CONSOLE_INVITE_PATTERN.source).toBe(INVITE_CODE_CREATE_PATTERN);
    for (let i = 0; i < 20; i += 1) expect(randomInviteCode()).toMatch(CONSOLE_INVITE_PATTERN);
  });

  it("状态和服务端的 usable 对得上：停用优先，其次过期、用完", () => {
    const cases = [
      invite(), invite({ disabled: true }), invite({ expires_at: NOW - 1 }), invite({ max_uses: 3, used_count: 3 }),
      invite({ disabled: true, expires_at: NOW - 1 }), invite({ max_uses: 3, used_count: 2, expires_at: NOW + 1 }),
    ];
    for (const item of cases) expect(inviteState(item, NOW) === "usable").toBe(inviteUsable(item, NOW));
    expect(inviteState(invite({ disabled: true, expires_at: NOW - 1 }), NOW)).toBe("disabled");
    expect(usesText(invite({ used_count: 2 }))).toBe("2 次（不限）");
    expect(usesText(invite({ max_uses: 5, used_count: 2 }))).toBe("2 / 5 次");
  });

  it("新建时校验邀请码、次数和日期；过期日取北京时间当天最后一刻", () => {
    const form = { ...emptyInviteForm(), code: "ab", maxUses: "0", expiresDate: "2026-02-30" };
    expect(Object.keys(inviteErrors(form, true, NOW)).sort()).toEqual(["code", "expiresDate", "maxUses"]);
    const ok = { code: "Fall-2026", note: " 招新群 ", maxUses: "50", expiresDate: "2026-11-30" };
    expect(inviteErrors(ok, true, NOW)).toEqual({});
    expect(invitePayload(ok)).toEqual({ code: "Fall-2026", note: "招新群", max_uses: 50, expires_at: dateEdge("2026-11-30", "end") });
  });

  it("修改时只带改动的字段，清空次数和日期就是不限", () => {
    const original = invite({ note: "旧", max_uses: 10, expires_at: dateEdge("2026-11-30", "end") });
    expect(invitePayload({ code: original.code, note: "旧", maxUses: "10", expiresDate: "2026-11-30" }, original)).toEqual({});
    expect(invitePayload({ code: original.code, note: "新", maxUses: "", expiresDate: "" }, original)).toEqual({ note: "新", max_uses: null, expires_at: null });
  });
});
