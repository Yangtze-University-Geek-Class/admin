import { ENVELOPE_PIECES, type EnvelopePiece } from "./envelope-pieces.js";

/**
 * 站内邮件的信封模板（#148）：纯函数，输入一封信的内容，输出主题、HTML 和纯文本。
 *
 * 版式照官网「加入我们」的信纸（styles/scenes.css 的 .pt-letter、three/join.ts 的信封配色）：
 * 纸色信纸 + 内缩一道细框，右上角邮票和邮戳，落款旁一枚火漆，下沿一条航空条纹，顶上是极客娘和拆开的信封。
 * 图片只做固定尺寸的部件（envelope-pieces.ts），正文全是 HTML 文字，随内容变长。
 *
 * 邮件客户端的写法：表格布局 + 内联样式，宽 600px；<style> 里只放深色模式和窄屏两组媒体查询，
 * 不支持的客户端照样能读。不用 flex、grid、position、CSS 变量、脚本和网络字体。
 * 所有动态文字都经过 HTML 转义；按钮链接只接受 https 的 yangtzeu.work 与 prev.yangtzeu.work。
 * 信里请对方直接回复时必须带上 replyTo，渲染结果把它交给发信模块写进 Reply-To。
 */

/** 发件人名，发信模块写 From 头时用同一个值。 */
export const MAIL_SENDER_NAME = "长江大学极客班";

/** 邮件里的链接只允许指向这两个站点（正式与预发布）。 */
export const MAIL_LINK_HOSTS = ["yangtzeu.work", "prev.yangtzeu.work"] as const;

export type EnvelopeFact = { label: string; value: string; mono?: boolean };

export type EnvelopeBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "facts"; items: readonly EnvelopeFact[] }
  | { kind: "list"; title?: string; items: readonly string[] };

export type EnvelopeMessage = {
  subject: string;
  /** 收件箱列表里主题后面露出的一行摘要 */
  preheader: string;
  /** 信纸左上角的小字，例如「招新进度 · 已收到」 */
  kicker: string;
  /** 抬头，例如「小明同学，你好：」 */
  greeting: string;
  blocks: readonly EnvelopeBlock[];
  action?: { label: string; url: string };
  /** 落款日期 */
  signedAt: Date | number;
  /** 信纸下面的小字：为什么会收到这封信 */
  footer: readonly string[];
  /** 页脚里的站点链接（正式或预发布首页） */
  siteUrl: string;
  /**
   * 回信地址：有人在看、能收到回信的邮箱。信里写了「直接回复这封邮件」时必须给，
   * 渲染结果原样带出，发信模块写进 Reply-To。
   */
  replyTo?: string;
};

export type EnvelopeOptions = {
  /** 图片部件的地址前缀，以 / 结尾：正式发信用 https://cdn.crosery.com/yzgc/mail/v1/ */
  assetBase: string;
  /** 只给本机预览用：允许 assetBase 是 file:///…；发信时不要打开 */
  allowFileAssets?: boolean;
};

export type RenderedMail = {
  subject: string;
  html: string;
  text: string;
  /** 发信模块写进 Reply-To 的地址；null 表示信里没有请对方回复 */
  replyTo: string | null;
};

export class MailTemplateError extends Error {
  constructor(
    readonly code: "invalid_link" | "invalid_asset_base" | "invalid_reply_to" | "missing_reply_to" | "missing_field",
    message: string,
  ) {
    super(message);
  }
}

const COLOR = {
  page: "#f5f4f0",
  paper: "#fbfaf6",
  sheetLine: "#e9eaf2",
  ink: "#1b2140",
  soft: "#5b6283",
  mute: "#646b8a",
  cobalt: "#3346c8",
  wash: "#eff0f8",
  rule: "#dcdee9",
} as const;

// 放进 style="…" 属性里，字体名只能用单引号
const FONT = `-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC','Source Han Sans SC','Segoe UI',Helvetica,Arial,sans-serif`;
const MONO = `'SF Mono',Menlo,Consolas,'Liberation Mono',monospace`;
// 调用方给的文字（长英文名、长网址）在表格单元格里也能断行，不把信撑宽
const WRAP = "word-break:break-word;overflow-wrap:anywhere;";

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** 转义放进 HTML 文本或属性里的字符串。 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

// 控制字符（保留换行由调用方决定）、双向文字控制符
const CONTROL = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]", "g");

/**
 * 单行文字：去掉控制字符，换行、制表符和 U+2028 / U+2029（有的客户端显示成换行）变成空格。
 * 主题、抬头、事实栏都用它，主题里不会混进换行。
 */
export function oneLine(value: string): string {
  return value.replace(/[\r\n\t\u2028\u2029]+/g, " ").replace(CONTROL, "").replace(/ {2,}/g, " ").trim();
}

/** 多行文字：统一换行符（U+2028 / U+2029 也算换行），去掉其它控制字符。 */
function multiLine(value: string): string {
  return value.replace(/\r\n?|[\u2028\u2029]/g, "\n").replace(/\t/g, " ").replace(CONTROL, "").trim();
}

/** 只放行 https 的 yangtzeu.work / prev.yangtzeu.work，返回规范化后的地址；其它一律拒绝。 */
export function safeMailLink(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new MailTemplateError("invalid_link", "链接不是合法的网址");
  }
  if (url.protocol !== "https:") throw new MailTemplateError("invalid_link", "邮件里的链接只能用 https");
  if (url.username || url.password || url.port) throw new MailTemplateError("invalid_link", "链接里不能带账号或端口");
  if (!(MAIL_LINK_HOSTS as readonly string[]).includes(url.hostname)) {
    throw new MailTemplateError("invalid_link", "邮件里的链接只能指向 yangtzeu.work 或 prev.yangtzeu.work");
  }
  return url.href;
}

function checkAssetBase(raw: string, allowFile: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MailTemplateError("invalid_asset_base", "assetBase 不是合法的网址");
  }
  const fileOk = allowFile && url.protocol === "file:";
  if (url.protocol !== "https:" && !fileOk) {
    throw new MailTemplateError("invalid_asset_base", "assetBase 只能是 https://；本机预览要用 file:// 时传 allowFileAssets: true");
  }
  if (!url.pathname.endsWith("/") || url.search || url.hash || url.username || url.password) {
    throw new MailTemplateError("invalid_asset_base", "assetBase 要以 / 结尾，不能带查询串、锚点或账号");
  }
  return url.href;
}

// 普通的 local@domain 形式；不收引号、尖括号、逗号、分号和任何空白，拼进 Reply-To 头时不会多出一个地址或一行
const REPLY_TO = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** 回信地址只收一个普通的邮箱地址，返回去掉首尾空格的值。 */
export function safeReplyTo(raw: string): string {
  const value = raw.trim();
  if (value.length > 254 || !REPLY_TO.test(value)) throw new MailTemplateError("invalid_reply_to", "回信地址要是一个普通的邮箱地址");
  return value;
}

// 请对方直接回复的写法；信里出现它就必须带 replyTo
const ASKS_FOR_REPLY = /回复这封(邮件|信)|直接回信/;

function asksForReply(message: EnvelopeMessage): boolean {
  const texts = [message.preheader, ...message.blocks.flatMap(block => (block.kind === "paragraph" ? [block.text] : block.kind === "list" ? block.items : []))];
  return texts.some(text => ASKS_FOR_REPLY.test(text));
}

export function required(value: string, field: string): string {
  if (!value) throw new MailTemplateError("missing_field", `信的 ${field} 不能为空`);
  return value;
}

/** 北京时间（UTC+8，不用夏令时），不依赖运行环境的时区与 ICU。 */
function beijingParts(at: Date | number) {
  const ms = typeof at === "number" ? at : at.getTime();
  if (!Number.isFinite(ms)) throw new MailTemplateError("missing_field", "日期不合法");
  const d = new Date(ms + 8 * 3600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

/** 2026 年 9 月 27 日 */
export function formatMailDate(at: Date | number): string {
  const p = beijingParts(at);
  return `${p.y} 年 ${p.m} 月 ${p.day} 日`;
}

/** 2026 年 9 月 27 日 01:30（北京时间） */
export function formatMailDateTime(at: Date | number): string {
  const p = beijingParts(at);
  return `${formatMailDate(at)} ${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
}

function img(base: string, piece: EnvelopePiece, alt: string, extra: { cls?: string; style?: string } = {}): string {
  const { file, width, height } = ENVELOPE_PIECES[piece];
  const cls = extra.cls ? ` class="${extra.cls}"` : "";
  return `<img${cls} src="${escapeHtml(base + file)}" width="${width}" height="${height}" alt="${escapeHtml(alt)}" style="display:block;border:0;outline:none;text-decoration:none;${extra.style ?? ""}">`;
}

function paragraphHtml(text: string): string {
  const body = escapeHtml(multiLine(text)).replace(/\n/g, "<br>");
  return `<p class="em-ink" style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.9;color:${COLOR.ink};${WRAP}">${body}</p>`;
}

function factsHtml(items: readonly EnvelopeFact[]): string {
  const rows = items
    .map((item, i) => {
      const border = i === 0 ? "" : `border-top:1px dashed ${COLOR.rule};`;
      const valueFont = item.mono ? `font-family:${MONO};font-size:13px;letter-spacing:0;` : `font-family:${FONT};font-size:15px;`;
      return `<tr>
<td class="em-soft em-fact-label em-rule" valign="top" width="92" style="width:92px;padding:10px 12px 10px 0;${border}font-family:${FONT};font-size:13px;line-height:1.7;font-weight:600;color:${COLOR.soft};">${escapeHtml(oneLine(item.label))}</td>
<td class="em-ink em-rule" valign="top" style="padding:10px 0;${border}${valueFont}line-height:1.7;color:${COLOR.ink};${item.mono ? "word-break:break-all;overflow-wrap:anywhere;" : WRAP}">${escapeHtml(oneLine(item.value))}</td>
</tr>`;
    })
    .join("\n");
  return `<table role="presentation" class="em-facts" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.wash}" style="width:100%;margin:4px 0 20px;background-color:${COLOR.wash};border-radius:10px;border-collapse:separate;">
<tr><td style="padding:6px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
${rows}
</table>
</td></tr>
</table>`;
}

/** 列表里去掉空条目，编号跟着剩下的条目走。 */
function listItems(items: readonly string[]): string[] {
  return items.map(multiLine).filter(Boolean);
}

function listHtml(title: string | undefined, items: readonly string[]): string {
  const head = title
    ? `<p class="em-ink" style="margin:0 0 6px;font-family:${FONT};font-size:14px;line-height:1.7;font-weight:600;color:${COLOR.ink};${WRAP}">${escapeHtml(oneLine(title))}</p>`
    : "";
  const rows = items
    .map(
      (item, i) => `<tr>
<td class="em-kicker" valign="top" width="24" style="width:24px;padding:0 0 8px;font-family:${FONT};font-size:15px;line-height:1.9;font-weight:600;color:${COLOR.cobalt};">${i + 1}.</td>
<td class="em-ink" valign="top" style="padding:0 0 8px;font-family:${FONT};font-size:15px;line-height:1.9;color:${COLOR.ink};${WRAP}">${escapeHtml(item).replace(/\n/g, "<br>")}</td>
</tr>`,
    )
    .join("\n");
  return `${head}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 12px;border-collapse:collapse;">
${rows}
</table>`;
}

function actionHtml(action: { label: string; url: string }): string {
  const href = escapeHtml(safeMailLink(action.url));
  const label = escapeHtml(required(oneLine(action.label), "按钮文字"));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 6px;border-collapse:separate;">
<tr><td class="em-btn" bgcolor="${COLOR.cobalt}" style="background-color:${COLOR.cobalt};border-radius:12px;mso-padding-alt:13px 28px;">
<a class="em-btn-a" href="${href}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;line-height:1.2;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;${WRAP}">${label}</a>
</td></tr>
</table>`;
}

const STYLE = `<style>
@media (prefers-color-scheme: dark) {
  .em-page { background-color: #12162c !important; }
  .em-card { background-color: #1c2140 !important; }
  .em-sheet { border-color: #2f3662 !important; }
  .em-ink { color: #e7e9f6 !important; }
  .em-soft { color: #aab0d2 !important; }
  .em-kicker { color: #a3b1ff !important; }
  .em-facts { background-color: #252b52 !important; }
  .em-rule { border-color: #3a4172 !important; }
  .em-btn { background-color: #4b5de0 !important; }
  .em-link { color: #a3b1ff !important; }
  .em-foot { color: #9aa1c4 !important; }
}
@media only screen and (max-width: 620px) {
  .em-outer { padding: 12px 8px 28px !important; }
  .em-sheet { padding: 22px 18px 24px !important; }
  .em-h1 { font-size: 20px !important; }
  .em-stamp-cell { width: 104px !important; }
  .em-stamp { width: 104px !important; height: auto !important; }
  .em-fact-label { width: 68px !important; }
}
</style>`;

/** 把一封信渲染成邮件：主题、HTML、纯文本。 */
export function renderEnvelope(message: EnvelopeMessage, options: EnvelopeOptions): RenderedMail {
  const base = checkAssetBase(options.assetBase, options.allowFileAssets === true);
  const subject = required(oneLine(message.subject), "主题");
  const preheader = oneLine(message.preheader);
  const kicker = oneLine(message.kicker);
  const greeting = required(oneLine(message.greeting), "抬头");
  const siteUrl = safeMailLink(message.siteUrl);
  const siteLabel = new URL(siteUrl).host;
  const date = formatMailDate(message.signedAt);
  const footer = message.footer.map(oneLine).filter(Boolean);
  const replyTo = message.replyTo === undefined ? null : safeReplyTo(message.replyTo);
  if (!replyTo && asksForReply(message)) {
    throw new MailTemplateError("missing_reply_to", "信里请对方直接回复，要同时给出 replyTo（有人在看的回信地址）");
  }

  const blocks = message.blocks
    .map(block => {
      if (block.kind === "paragraph") return paragraphHtml(block.text);
      if (block.kind === "facts") return block.items.length ? factsHtml(block.items) : "";
      const items = listItems(block.items);
      return items.length ? listHtml(block.title, items) : "";
    })
    .join("\n");

  // 收件箱摘要后面补一串不可见字符，免得客户端把正文开头接在摘要后面
  const preheaderFill = "&#847;&zwnj;&nbsp;".repeat(60);

  const html = `<!DOCTYPE html>
<html lang="zh-CN" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<title>${escapeHtml(subject)}</title>
${STYLE}
</head>
<body class="em-page" bgcolor="${COLOR.page}" style="margin:0;padding:0;background-color:${COLOR.page};-webkit-text-size-adjust:100%;text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${COLOR.page};">${escapeHtml(preheader)}${preheaderFill}</div>
<table role="presentation" class="em-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.page}" style="width:100%;background-color:${COLOR.page};">
<tr><td class="em-outer" align="center" style="padding:24px 12px 36px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td style="padding:0;font-size:0;line-height:0;">${img(base, "header", MAIL_SENDER_NAME, { style: `width:100%;max-width:600px;height:auto;font-family:${FONT};font-size:16px;line-height:1.4;font-weight:600;color:${COLOR.cobalt};` })}</td></tr>
<tr><td class="em-card" bgcolor="${COLOR.paper}" style="padding:10px 10px 12px;background-color:${COLOR.paper};border-radius:4px 4px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;">
<tr><td class="em-sheet" style="padding:26px 32px 30px;border:1px solid ${COLOR.sheetLine};border-radius:4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr>
<td valign="bottom" style="padding:0 12px 0 0;">
<p class="em-kicker" style="margin:0 0 6px;font-family:${FONT};font-size:13px;line-height:1.6;font-weight:600;letter-spacing:0.04em;color:${COLOR.cobalt};${WRAP}">${escapeHtml(kicker)}</p>
<h1 class="em-ink em-h1" style="margin:0;font-family:${FONT};font-size:22px;line-height:1.5;font-weight:700;color:${COLOR.ink};${WRAP}">${escapeHtml(greeting)}</h1>
</td>
<td class="em-stamp-cell" valign="top" align="right" width="29%" style="width:29%;padding:0;">${img(base, "stamp", "", { cls: "em-stamp", style: "width:100%;max-width:150px;height:auto;margin-left:auto;" })}</td>
</tr>
</table>
<div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>
${blocks}
${message.action ? actionHtml(message.action) : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:22px;">
<tr><td class="em-rule" style="border-top:1px dashed ${COLOR.rule};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
<tr><td align="right" style="padding:16px 0 0;">
<table role="presentation" align="right" cellpadding="0" cellspacing="0" border="0" style="margin-left:auto;">
<tr>
<td valign="middle" style="padding:0 14px 0 0;">${img(base, "seal", "")}</td>
<td valign="middle" align="left">
<p class="em-ink" style="margin:0;font-family:${FONT};font-size:15px;line-height:1.7;color:${COLOR.ink};">${escapeHtml(MAIL_SENDER_NAME)}</p>
<p class="em-soft" style="margin:0;font-family:${FONT};font-size:13px;line-height:1.7;color:${COLOR.soft};">${escapeHtml(date)}</p>
</td>
</tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</td></tr>
<tr><td class="em-card" bgcolor="${COLOR.paper}" style="padding:0;font-size:0;line-height:0;background-color:${COLOR.paper};border-radius:0 0 4px 4px;">${img(base, "airmail", "", { style: "width:100%;max-width:600px;height:auto;" })}</td></tr>
<tr><td class="em-foot" align="center" style="padding:18px 16px 0;font-family:${FONT};font-size:12px;line-height:1.8;color:${COLOR.mute};${WRAP}">
${footer.map(line => `${escapeHtml(line)}<br>`).join("\n")}
<a class="em-link" href="${escapeHtml(siteUrl)}" target="_blank" style="color:${COLOR.cobalt};text-decoration:none;">${escapeHtml(MAIL_SENDER_NAME)} · ${escapeHtml(siteLabel)}</a>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;

  return { subject, html, text: renderText(message, { kicker, greeting, date, footer, siteUrl }), replyTo };
}

function renderText(
  message: EnvelopeMessage,
  ctx: { kicker: string; greeting: string; date: string; footer: string[]; siteUrl: string },
): string {
  const out: string[] = [MAIL_SENDER_NAME];
  if (ctx.kicker) out.push(ctx.kicker);
  out.push("", ctx.greeting, "");
  for (const block of message.blocks) {
    if (block.kind === "paragraph") out.push(multiLine(block.text), "");
    else if (block.kind === "facts" && block.items.length) {
      for (const item of block.items) out.push(`${oneLine(item.label)}：${oneLine(item.value)}`);
      out.push("");
    } else if (block.kind === "list") {
      const items = listItems(block.items);
      if (!items.length) continue;
      if (block.title) out.push(oneLine(block.title));
      items.forEach((item, i) => out.push(`${i + 1}. ${item}`));
      out.push("");
    }
  }
  if (message.action) out.push(`${oneLine(message.action.label)}：${safeMailLink(message.action.url)}`, "");
  out.push(MAIL_SENDER_NAME, ctx.date, "", "-- ");
  out.push(...ctx.footer, ctx.siteUrl);
  return out.join("\n") + "\n";
}
