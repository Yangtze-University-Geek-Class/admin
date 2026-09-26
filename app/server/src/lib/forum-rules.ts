import { isIPv4, isIPv6 } from "node:net";

/**
 * 论坛的纯规则（#57）：长度上限、提及、标签 slug、头像底色、文本检查、按 IP 计数的主体。
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
  avatarPixelsMax: 4096 * 4096,
  avatarSize: 256,
  /** 一条帖子里的 @提及最多通知这么多人，再多的不通知（防止一帖刷全体成员的通知）。 */
  mentionNotifyMax: 10,
} as const;

/**
 * 限流（按主体计数，记录在 forum_rate_events，重启不清零）。游客回复按 IP 计（IPv6 按 /64，见 ipSubject），
 * 另有全站的游客回复总量（主体固定为 GUEST_POST_SITE_SUBJECT）：换着 IP 刷也只能刷到这么多，超了之后游客暂时不能回复，成员不受影响。
 */
export const FORUM_RATE_LIMITS = {
  guestPost: [{ windowMs: 60_000, max: 5 }, { windowMs: 24 * 60 * 60_000, max: 30 }],
  guestPostSite: [{ windowMs: 60 * 60_000, max: 200 }],
  topic: [{ windowMs: 60_000, max: 10 }],
  reply: [{ windowMs: 60_000, max: 30 }],
  avatar: [{ windowMs: 60 * 60_000, max: 10 }],
} as const;
export type RateBucket = keyof typeof FORUM_RATE_LIMITS;
export const GUEST_POST_SITE_SUBJECT = "site";

/** 不登录也能调的读接口按 IP 限流（@fastify/rate-limit，进程内计数，重启清零）。 */
export const FORUM_REQUEST_LIMITS = {
  state: { max: 120, timeWindow: 60_000 },
  view: { max: 60, timeWindow: 60_000 },
} as const;

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

/** 单行文本（标题、标签名、所在地）：不许控制字符。昵称另有允许清单 isAllowedName。 */
export const hasControlChars = (value: string) => /[\u0000-\u001f\u007f]/.test(value);
/** 多行文本（签名）：允许换行与制表符，其余控制字符不许。 */
export const hasControlCharsMultiline = (value: string) => /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);

/**
 * 昵称（游客昵称、成员的 displayName）只收允许清单里的字符。先做 NFKC（全角字母和数字变成半角），之后每个字符都得是：
 * - 汉字、平假名、片假名、韩文里的字（\p{L}；韩文不含显示成空白的填充字 U+115F、U+1160、U+3164、U+FFA0）；
 * - 拉丁字母里常用的几段：基本拉丁、拉丁-1、拉丁扩展 A、拼音声调字母 U+01CD–U+01DC、越南文等用的 U+1E00–U+1EFF。
 *   IPA、小型大写（ʙ）、搭嘴音（ǀ 像 l）这些也属于拉丁文字，但都是形近字母，不收；
 * - ASCII 数字，长音符 ー，以及空格和 - _ . · ・ ' 这几个符号。空格不能在首尾、不能连着用，至少要有一个字或数字。
 * 之前用屏蔽清单拦看不见的字符和别的文字的形近字母，拦一种漏一种（未分配的可忽略字符、亚美尼亚、切罗基字母……），
 * 所以改成只收这些。表情、其它文字（西里尔、希腊等）都不收；NFKC 之后 µ 是希腊字母 μ，也不收。
 */
const NAME_PATTERN = /^(?:[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017F\u01CD-\u01DC\u1E00-\u1EFF \-_.\u00B7\u30FB'\u30FC]|(?=\p{L})(?![\u115F\u1160\u3164\uFFA0])[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])+$/u;
const NAME_SEPARATORS = /^[ \-_.\u00B7\u30FB'\u30FC]+$/u;
export const NAME_RULE_MESSAGE = "昵称只能用汉字、字母、假名、韩文、数字、空格和 - _ . · ・ ' 这几个符号，空格不能连着用";

/**
 * 存进库里的昵称：NFKC 之后去掉首尾空白。校验和存的是同一个字符串；不这样的话，不换行空格、全角空格这类
 * NFKC 之后才变成普通空格的字符会原样存下来，显示得像没有空格。
 */
export function normalizeName(value: string): string {
  return value.normalize("NFKC").trim();
}

export function isAllowedName(value: string): boolean {
  const name = value.normalize("NFKC");
  return NAME_PATTERN.test(name) && !NAME_SEPARATORS.test(name) && !/^ | $| {2}/.test(name);
}

/** 允许清单里长得几乎一样的字，比较时折成同一个。写成转义，免得读代码时也分不清。 */
const LOOKALIKES: Record<string, string> = {
  "\u0131": "i", // 无点的 ı
  "\u0138": "k", // ĸ
  "\u30AB": "\u529B", // 片假名カ → 汉字力
  "\u30CB": "\u4E8C", // ニ → 二
  "\u30ED": "\u53E3", // ロ → 口
  "\u30A8": "\u5DE5", // エ → 工
  "\u30CF": "\u516B", // ハ → 八
  "\u30BF": "\u5915", // タ → 夕
  "\u30C8": "\u535C", // ト → 卜
  "\u30FC": "\u4E00", // 长音符ー → 一
  "\u3078": "\u30D8", // 平假名へ → 片假名ヘ
};
const LOOKALIKE = new RegExp(`[${Object.keys(LOOKALIKES).join("")}]`, "gu");

/**
 * 判断两个名字算不算同一个：NFKC（全角、兼容字形变成普通写法）、不分大小写、去掉附加符号（é 和 e、が 和 か 算同一个），
 * 形近字折成同一个（LOOKALIKES：ı 和 i、カ 和 力……），再去掉所有空白和 - _ . · ・ '（「极 客班」「极客班.」和「极客班」、
 * 「阿・凡提」和「阿·凡提」算同一个）。只用来比较。
 */
export function nameKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC")
    .replace(LOOKALIKE, char => LOOKALIKES[char] ?? char)
    .replace(/[\s\-_.\u00B7\u30FB']/gu, "");
}

/**
 * 按 IP 计数（游客限流、浏览去重、读接口限流）用的主体：IPv4 原样；IPv6 取 /64 前缀（家庭宽带和云主机通常拿到整段 /64，
 * 按单个地址计数，换地址就能绕开）；IPv4 映射的 IPv6（::ffff:a.b.c.d）按 IPv4 算。
 */
export function ipSubject(ip: string): string {
  const address = ip.split("%")[0] ?? ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped?.[1] && isIPv4(mapped[1])) return mapped[1];
  if (!isIPv6(address)) return ip;
  // 末尾嵌入的 IPv4 占两组；/64 只看前四组。
  const groups = (part: string) => part ? part.split(":").flatMap(group => group.includes(".") ? ["0", "0"] : [group]) : [];
  const [head = "", tail] = address.split("::");
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const full = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return `${full.slice(0, 4).map(group => parseInt(group, 16).toString(16)).join(":")}::/64`;
}

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
