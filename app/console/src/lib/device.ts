// 设备授权确认页（/device，#262）的纯逻辑：命令行（`geek login`）按 RFC 8628 拿到一串 user_code，用户在这里登录后确认。
// 字母表、长度与显示形式和服务端 app/server/src/lib/device-store.ts 一致：去掉元音与易混字符，8 位，显示成 XXXX-XXXX。

export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_LENGTH = 8;

/** 输入框里的任意文字 → 显示形式：转大写、只留字母表里的字符、最多 8 位，满 5 位起在第 4 位后插连字符。 */
export function formatUserCode(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const chars = [...raw.toUpperCase()].filter(char => USER_CODE_ALPHABET.includes(char)).slice(0, USER_CODE_LENGTH).join("");
  return chars.length > 4 ? `${chars.slice(0, 4)}-${chars.slice(4)}` : chars;
}

export const isCompleteUserCode = (code: string): boolean => formatUserCode(code) === code && code.length === USER_CODE_LENGTH + 1;

/** 没登录时去统一登录页；登录完带着同一串代码回到确认页（return_to 只是本站路径）。 */
export function deviceSignInPath(userCode: string): string {
  const back = userCode ? `/device?user_code=${encodeURIComponent(userCode)}` : "/device";
  return `/signin?return_to=${encodeURIComponent(back)}`;
}

/** 形状与服务端 `GET /api/identity/device` 一致。 */
export type DeviceStatus = "pending" | "approved" | "denied" | "consumed" | "expired";
export type DeviceView = {
  user_code: string;
  client_id: string;
  client_name: string;
  scope: string;
  status: DeviceStatus;
  expires_at: number;
};

const SCOPE_TEXT: Record<string, string> = {
  openid: "确认你的极客班账号（账号 ID）",
  profile: "读取你的用户名和头像",
};

/** scope 逐项说成人话；不认识的原样列出，不藏起来。 */
export const scopeLines = (scope: string): string[] =>
  scope.split(/\s+/).filter(Boolean).map(item => SCOPE_TEXT[item] ?? item);

/** 代码不能再确认时（不是 pending）给的说明。 */
export function closedNotice(status: Exclude<DeviceStatus, "pending">): { title: string; body: string } {
  if (status === "expired") return { title: "这串代码已经过期", body: "代码只在 10 分钟内有效。回到终端重新运行 geek login，拿一串新代码。" };
  if (status === "denied") return { title: "这串代码已被拒绝", body: "终端那边会提示授权被拒绝。要重新授权，回到终端再运行一次 geek login。" };
  return { title: "这串代码已经用过了", body: "它已经完成了授权，不能再确认一次。终端没有登录成功的话，重新运行 geek login。" };
}

/** 剩余时间显示成 m:ss；到点后是 0:00。 */
export function remainingText(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
