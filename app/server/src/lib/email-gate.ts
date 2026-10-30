/**
 * 登录后的身份关口：先有登录邮箱（#273），再有真实姓名和年级（#280）。
 * - 邮箱：所有者 2026-10-23 19:22 要求没有登录邮箱的账号先绑定邮箱。
 *   这个环境发不出信时不要求：收不到验证码就绑不上，不能把人关在门外。
 * - 姓名和年级：所有者 2026-10-24 13:45 要求老账号和新账号都要填，缺了先去补资料页。
 * GitHub、Google 登录回调、对外授权（GitLab）的交互和设备授权的确认在服务端拦；控制台、官网、论坛读 `/auth/me` 的
 * `email_required`、`profile_required` 自己跳到对应的页面。两项都缺时先绑邮箱，绑好回来再补资料。
 */
export const BIND_EMAIL_PATH = "/bind-email";
export const COMPLETE_PROFILE_PATH = "/complete-profile";

type GateDeps = {
  identity: { hasEmail(accountId: string): boolean; isMember(accountId: string): boolean };
  mail: { sendingEnabled: boolean };
  profiles: { profileRequired(accountId: string): boolean };
};
export type GateRefusal = "email_required" | "profile_required";

export function emailRequired(deps: Pick<GateDeps, "identity" | "mail">, accountId: string): boolean {
  return deps.mail.sendingEnabled && !deps.identity.hasEmail(accountId);
}

/** 姓名和年级只拦极客班成员（所有者 2026-10-24 22:05）：注册用户不填也能用，填了邀请码成为成员以后再补 */
export function profileRequired(deps: Pick<GateDeps, "identity" | "profiles">, accountId: string): boolean {
  return deps.identity.isMember(accountId) && deps.profiles.profileRequired(accountId);
}

/** 这个账号现在被哪一项拦下；都齐了返回 null */
export function gateRefusal(deps: GateDeps, accountId: string): GateRefusal | null {
  if (emailRequired(deps, accountId)) return "email_required";
  return profileRequired(deps, accountId) ? "profile_required" : null;
}

/** 拦下时给接口回的 403 正文；`what` 是被挡住的那一步，例如「确认命令行的登录」 */
export function gateRefusalBody(refusal: GateRefusal, what: string): { error: GateRefusal; message: string } {
  return { error: refusal, message: refusal === "email_required" ? `先绑定邮箱，再${what}` : `先填好姓名和年级，再${what}` };
}

/** 关口页的完整地址，办好后回到 `back`（本站地址或路径）；`back` 已经是某个关口页时原样返回，不套两层。 */
function gatePageUrl(path: string, publicOrigin: string, back: string): string {
  const target = new URL(back, publicOrigin);
  if (target.pathname === BIND_EMAIL_PATH || target.pathname === COMPLETE_PROFILE_PATH) return target.toString();
  const url = new URL(path, publicOrigin);
  url.searchParams.set("return_to", `${target.pathname}${target.search}${target.hash}`);
  return url.toString();
}

export function bindEmailUrl(publicOrigin: string, back: string): string {
  return gatePageUrl(BIND_EMAIL_PATH, publicOrigin, back);
}

/** 登录成功后该去哪：被拦下时去对应的关口页（办好再回 `back`），否则就是 `back` */
export function gatedReturn(deps: GateDeps, publicOrigin: string, accountId: string, back: string): string {
  const refusal = gateRefusal(deps, accountId);
  if (!refusal) return back;
  return gatePageUrl(refusal === "email_required" ? BIND_EMAIL_PATH : COMPLETE_PROFILE_PATH, publicOrigin, back);
}
