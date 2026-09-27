import type Database from "better-sqlite3";
import type { MailConfig } from "../../config.js";
import { MAIL_LINK_HOSTS, renderEnvelope, safeAssetBase, safeReplyTo, type RenderedMail } from "./envelope.js";
import { createAliyunProvider, createResendProvider, type FetchLike, type MailProvider } from "./providers.js";
import { createMailOutbox } from "./outbox.js";
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
  const outbox = createMailOutbox(db, { providers, recipients: config.recipients, allowlist: config.allowlist, now });

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
