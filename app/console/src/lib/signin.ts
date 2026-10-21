// 极客班统一登录页（#262）：登录结果的说明、回跳地址的同源校验，以及按 GET /auth/providers 渲染的登录方式。
// 官网、论坛、控制台的「登录」都进 /signin?return_to=<同源路径>；GitHub 只是登录方式之一，身份以极客班账号（account_id）为准。
import { siteUrl } from "./runtime";

export interface OutcomeAction {
  label: string;
  icon: string;
  href: string;
  target?: "_blank" | "_self";
}

export interface OutcomeInfo {
  type: "warning" | "info";
  title: string;
  body?: string;
  action?: OutcomeAction;
}

export const GITHUB_INVITATION_URL = "https://github.com/orgs/Yangtze-University-Geek-Class/invitation";

export function signInOutcomes(): Record<string, OutcomeInfo> {
  return {
    not_member: {
      type: "warning",
      title: "只有极客班成员可以登录",
      body: "这个 GitHub 账号不在极客班的 GitHub 组织里。极客班账号只对组织成员开放，不登录也能浏览官网和论坛。",
      action: {
        label: "申请加入极客班",
        icon: "i-carbon-email",
        href: siteUrl("portal", "/join-us"),
      },
    },
    invite_pending: {
      type: "warning",
      title: "还没接受组织邀请",
      body: "到 GitHub 的通知或邮件里接受极客班组织的邀请，再回来登录。",
      action: {
        label: "前往 GitHub 接受邀请",
        icon: "i-carbon-launch",
        href: GITHUB_INVITATION_URL,
        target: "_blank",
      },
    },
    cancelled: { type: "info", title: "已取消登录" },
    failed: { type: "warning", title: "登录没有完成", body: "请稍后再试一次。" },
    account_disabled: {
      type: "warning",
      title: "这个极客班账号已停用",
      body: "账号停用后不能登录，已有的会话也已失效。如有疑问请联系组织管理员。",
    },
  };
}

export function parseSignInOutcome(raw: unknown): OutcomeInfo | null {
  if (typeof raw !== "string") return null;
  const outcomes = signInOutcomes();
  return Object.prototype.hasOwnProperty.call(outcomes, raw) ? outcomes[raw] : null;
}

export const DEFAULT_RETURN_PATH = "/console";

/**
 * 回跳地址只认本站路径（`/` 开头、不是 `//`、不带反斜杠与控制字符），解析后的 origin 必须等于本站 origin；
 * 完整的本站地址也接受，统一转成「路径 + 查询 + 锚点」。不合格的一律回 `fallback`，绝不跳到别的站点。
 * 服务端 `/auth/*` 还会按 PUBLIC_ORIGIN 再校验一次（app/server/src/lib/safe-return.ts）。
 */
export function safeReturnPath(raw: unknown, origin: string, fallback = DEFAULT_RETURN_PATH): string {
  if (typeof raw !== "string" || !raw || raw.length > 2048) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw) || raw.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== origin || url.username || url.password) return fallback;
  if (!raw.startsWith("/") && !raw.startsWith(`${origin}/`) && raw !== origin) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // 不回到登录页自己，免得登录成功后又停在登录页
  return url.pathname === "/signin" ? fallback : path;
}

/** 一种登录方式，形状与服务端 `GET /auth/providers` 一致（app/server/src/routes/identity/providers.ts）。 */
export type LoginProvider = {
  id: string;
  name: string;
  kind: "redirect" | "email_code";
  start: string;
  can_register: boolean;
};

const PROVIDER_ICONS: Record<string, string> = {
  github: "i-carbon-logo-github",
  google: "i-carbon-logo-google",
  email: "i-carbon-email",
};

export const providerIcon = (provider: Pick<LoginProvider, "id">): string => PROVIDER_ICONS[provider.id] ?? "i-carbon-login";

/** 只留形状正确、起点是本站路径的登录方式；未知字段与异常条目丢掉，不让一条坏数据弄坏整页。 */
export function readProviders(body: unknown): LoginProvider[] {
  const list = (body as { providers?: unknown } | null)?.providers;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item): LoginProvider[] => {
    const p = item as Partial<LoginProvider> | null;
    if (!p || typeof p.id !== "string" || typeof p.name !== "string" || typeof p.start !== "string") return [];
    if (p.kind !== "redirect" && p.kind !== "email_code") return [];
    if (!p.start.startsWith("/") || p.start.startsWith("//")) return [];
    return [{ id: p.id, name: p.name, kind: p.kind, start: p.start, can_register: p.can_register === true }];
  });
}

/** 整页跳转的登录方式：起点加上 `return_to`（完整本站地址，服务端只接受本站）。 */
export function providerHref(provider: Pick<LoginProvider, "start">, returnPath: string, origin: string): string {
  const separator = provider.start.includes("?") ? "&" : "?";
  return `${provider.start}${separator}return_to=${encodeURIComponent(`${origin}${returnPath}`)}`;
}
