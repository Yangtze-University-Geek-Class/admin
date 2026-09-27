import type Database from "better-sqlite3";
import type { MailConfig } from "../../config.js";
import { MAIL_LINK_HOSTS, renderEnvelope, safeAssetBase, safeReplyTo, type RenderedMail } from "./envelope.js";
import { createAliyunProvider, createResendProvider, type FetchLike, type MailProvider } from "./providers.js";
import { createMailOutbox, type EnqueueLimits } from "./outbox.js";
import { recruitmentMessage, type RecruitmentKind } from "./recruitment.js";

/**
 * 站内发信的组装（#148）：按配置建发信商、发信队列，并把一份投递拼成招新的信。
 * 路由只调这里：recruitmentLetter 渲染（模板出错就在写库之前抛出），enqueue 放进队列。
 */

/** 招新的信要用到的投递字段（applications 表的列） */
export type ApplicationForMail = { id: string; name: string; class_name: string; email: string; strengths: string; created_at: number };

/** 控制台改状态时填的信的内容；多行的一行一条 */
export type RecruitmentLetter = { time?: string; place?: string; notes?: string; message?: string };

export type MailerDeps = { fetch?: FetchLike; now?: () => number };

/**
 * 投递成功时那封「已收到」的上限（apply.ts）：投递接口不用登录，谁都能填别人的邮箱。
 * 同一个邮箱 24 小时内只发一封，全站一小时最多 200 封（和论坛游客回复的全站上限一样）；超出的投递照样成功，信记成 skipped。
 */
export const RECEIVED_LETTER_LIMITS: EnqueueLimits = { recipientWindowMs: 24 * 3600_000, perHour: 200 };

/** 发件地址、回信地址只收一个普通的邮箱地址；错误信息不带配置的值。 */
function address(value: string, key: string): string {
  try {
    return safeReplyTo(value);
  } catch {
    throw new Error(`${key} must be a plain email address`);
  }
}

/** 信里的链接只能指向正式或预发布站点；本机和测试的 PUBLIC_ORIGIN 不在其中时，链接指向正式站点。 */
export function mailSiteOrigin(publicOrigin: string): string {
  const url = new URL(publicOrigin);
  return url.protocol === "https:" && (MAIL_LINK_HOSTS as readonly string[]).includes(url.hostname) ? url.origin : "https://yangtzeu.work";
}

function lines(value: string | undefined): string[] {
  return (value ?? "").split(/\r\n?|\n/).map(line => line.trim()).filter(Boolean);
}

export function createMailer(db: Database.Database, config: MailConfig, publicOrigin: string, deps: MailerDeps = {}) {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  let assetBase: string;
  try {
    assetBase = safeAssetBase(config.assetBase);
  } catch {
    throw new Error("MAIL_ASSET_BASE must be an https URL ending with /");
  }
  const replyTo = config.replyTo ? address(config.replyTo, "MAIL_REPLY_TO") : undefined;
  const providers: MailProvider[] = [];
  if (config.aliyun) providers.push(createAliyunProvider({ ...config.aliyun, from: address(config.aliyun.from, "MAIL_ALIYUN_FROM") }, fetchImpl, now));
  if (config.resend) providers.push(createResendProvider({ ...config.resend, from: address(config.resend.from, "MAIL_RESEND_FROM") }, fetchImpl));
  const siteOrigin = mailSiteOrigin(publicOrigin);
  // 配了回信地址时每封信都带 Reply-To，只交给能写按封回信地址的发信商（阿里云这边还没写，见 providers.ts）。
  // 一家都没有时按没有配置发信商处理：信记成 mail_disabled，控制台也不会说「保存并发邮件」。
  const usable = replyTo ? providers.filter(provider => provider.supportsReplyTo) : providers;
  const outbox = createMailOutbox(db, { providers: usable, recipients: config.recipients, allowlist: config.allowlist, now });

  /** 按投递和信的内容拼一封招新的信并渲染；内容不合规（例如没配回信地址却请人直接回复）抛 MailTemplateError。 */
  function recruitmentLetter(kind: RecruitmentKind, application: ApplicationForMail, letter: RecruitmentLetter = {}): RenderedMail {
    const common = {
      name: application.name, className: application.class_name, email: application.email, submittedAt: application.created_at,
      applicationId: application.id, siteOrigin, sentAt: now(), replyTo,
    };
    const message = kind === "received" ? recruitmentMessage("received", { ...common, strengths: application.strengths })
      : kind === "interview" ? recruitmentMessage("interview", { ...common, time: letter.time ?? "", place: letter.place ?? "", notes: lines(letter.notes) })
      : kind === "accepted" ? recruitmentMessage("accepted", { ...common, steps: lines(letter.notes) })
      : recruitmentMessage("rejected", { ...common, reason: letter.message?.trim() || undefined });
    return renderEnvelope(message, { assetBase });
  }

  return { ...outbox, replyTo: replyTo ?? null, recruitmentLetter };
}

export type Mailer = ReturnType<typeof createMailer>;
