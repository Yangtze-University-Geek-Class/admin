/**
 * 论坛的纯规则（#57）：长度上限、提及、标签 slug、头像底色、文本检查。
 * 与论坛前端 `app/forum/app/data/mentions.ts`、`seed.ts`（tagSlug）、`seed-content.ts`（AVATAR_PALETTE）
 * 逐条对齐；服务端不导入论坛代码（两边是不同的包），改一边要同步另一边。
 */

/** 论坛接口的业务错误。路由直接抛出，http-policy 的错误处理按 statusCode 与 code 输出 `{ error, message }`。 */
export class ForumError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}

export const FORUM_LIMITS = {
  titleMax: 120,
  memberContentMax: 20_000,
  guestContentMax: 2_000,
  guestNameMax: 20,
  tagsMax: 5,
  tagNameMax: 20,
  displayNameMax: 30,
  bioMax: 200,
  locationMax: 60,
  websiteMax: 200,
  avatarBytesMax: 2 * 1024 * 1024,
  /** 解码后的像素上限：2MB 的 PNG 可以声明极大的画布（解压炸弹），超过就拒绝，不去解码。 */
  avatarPixelsMax: 36_000_000,
  avatarSize: 256,
} as const;

/** 限流（按主体计数，记录在 forum_rate_events，重启不清零）。 */
export const FORUM_RATE_LIMITS = {
  guestPost: [{ windowMs: 60_000, max: 5 }, { windowMs: 24 * 60 * 60_000, max: 30 }],
  topic: [{ windowMs: 60_000, max: 10 }],
  reply: [{ windowMs: 60_000, max: 30 }],
  avatar: [{ windowMs: 60 * 60_000, max: 10 }],
} as const;
export type RateBucket = keyof typeof FORUM_RATE_LIMITS;

/** 同一 IP 同一话题一小时只算一次浏览。 */
export const VIEW_WINDOW_MS = 60 * 60_000;

/** 新编号的起点：旧帖编号都小于 1000，新话题从 t1001、新帖子从 p10001 起。 */
export const COUNTER_START = { topic: 1000, post: 10000, notification: 0, tag: 0, guest: 0 } as const;
export type CounterName = keyof typeof COUNTER_START;

export const AVATAR_PALETTE = ["#e5484d", "#f76b15", "#f5a524", "#30a46c", "#0ea5e9", "#3e63dd", "#8e4ec6", "#d6409f"] as const;
export const paletteColor = (n: number) => AVATAR_PALETTE[((n % AVATAR_PALETTE.length) + AVATAR_PALETTE.length) % AVATAR_PALETTE.length];

const MENTION_PATTERN = /(?<![\w@/.-])@([a-z0-9_-]+)(?![\w/@-])/gi;
const FENCED_CODE = /(```|~~~)[\s\S]*?\1/g;
const INLINE_CODE = /`[^`\n]*`/g;

/** 小写的 `@用户名`，按出现顺序去重；代码块、包名作用域、版本号、邮箱域名都不算。 */
export function extractMentions(content: string): string[] {
  const prose = content.replace(FENCED_CODE, " ").replace(INLINE_CODE, " ");
  const handles = new Set<string>();
  for (const match of prose.matchAll(MENTION_PATTERN)) handles.add((match[1] ?? "").toLowerCase());
  return [...handles];
}

/** 标签名 → slug：小写、空白换成 `-`、去掉 `[a-z0-9-]` 以外的字符；纯中文会得到空串。 */
export function tagSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
}

/** 单行文本（标题、昵称、标签名、所在地）：不许控制字符。 */
export const hasControlChars = (value: string) => /[\u0000-\u001f\u007f]/.test(value);
/** 多行文本（签名）：允许换行与制表符，其余控制字符不许。 */
export const hasControlCharsMultiline = (value: string) => /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);

/** 个人网站：空串表示清空，否则必须是不带账号密码的 https 地址。 */
export function isAllowedWebsite(value: string): boolean {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}
