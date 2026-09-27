import { createHmac, randomUUID } from "node:crypto";
import { MAIL_SENDER_NAME } from "./envelope.js";

/**
 * 发信商适配器（#148）：阿里云邮件推送（SingleSendMail）与 Resend，都只用全局 fetch 和 node:crypto，不加依赖。
 * 测试注入 fetch，不会连真实的发信商。
 *
 * 失败时抛 MailProviderError，message 只有发信商名、HTTP 状态和对方的错误码，
 * 不带密钥、收件地址和正文，发信队列把它原样存进 last_error、写进日志。
 */

export type OutgoingMail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** 回信地址；null 表示不写 Reply-To */
  replyTo: string | null;
  /** 同一封信重试时不变，发信商支持时用来去重 */
  idempotencyKey: string;
};

export type MailProvider = {
  name: "aliyun" | "resend";
  /** 能不能按封写 Reply-To；不能的发信商不发带 reply_to 的信 */
  supportsReplyTo: boolean;
  send(mail: OutgoingMail, signal: AbortSignal): Promise<{ messageId: string | null }>;
};

export class MailProviderError extends Error {}

export type FetchLike = typeof fetch;

/** 对方的错误码只留字母、数字和 . _ -，最多 64 个字符，免得把对方的整段回答写进记录。 */
function code(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64) : "";
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = await response.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function post(name: string, fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    // 超时、断网、被停止：只记错误的类型名
    throw new MailProviderError(`${name} network ${code((error as Error)?.name) || "error"}`);
  }
}

/** 阿里云 RPC 的百分号编码（RFC 3986）：除 A-Z a-z 0-9 - _ . ~ 以外都编码，空格是 %20。 */
export function aliyunPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 阿里云 RPC 签名 v1（HMAC-SHA1）：参数按名字排序、逐个编码后用 & 连起来，
 * StringToSign = 方法 & 编码后的 "/" & 再编码一次的参数串，密钥是 AccessKeySecret 加一个 &。
 * 见 https://help.aliyun.com/zh/direct-mail/signature （测试里用文档的例子核对）。
 */
export function aliyunSignature(params: Record<string, string>, secret: string, method = "POST"): string {
  const canonical = Object.keys(params)
    .sort()
    .map(key => `${aliyunPercentEncode(key)}=${aliyunPercentEncode(params[key])}`)
    .join("&");
  const stringToSign = `${method}&${aliyunPercentEncode("/")}&${aliyunPercentEncode(canonical)}`;
  return createHmac("sha1", `${secret}&`).update(stringToSign).digest("base64");
}

export const ALIYUN_ENDPOINT = "https://dm.aliyuncs.com/";

/**
 * 阿里云邮件推送 SingleSendMail（API 版本 2015-11-23，杭州地域）。发件地址是控制台里配置的发信地址（AddressType=1），
 * 不用控制台里的回信地址（ReplyToAddress=false）。按封的 Reply-To 按 #148 的约定不在这里写：带 reply_to 的信交给 Resend。
 */
export function createAliyunProvider(
  config: { accessKeyId: string; accessKeySecret: string; from: string },
  fetchImpl: FetchLike,
  now: () => number,
): MailProvider {
  return {
    name: "aliyun",
    supportsReplyTo: false,
    async send(mail, signal) {
      const params: Record<string, string> = {
        Action: "SingleSendMail",
        Format: "JSON",
        Version: "2015-11-23",
        RegionId: "cn-hangzhou",
        AccessKeyId: config.accessKeyId,
        SignatureMethod: "HMAC-SHA1",
        SignatureVersion: "1.0",
        SignatureNonce: randomUUID(),
        Timestamp: new Date(now()).toISOString().replace(/\.\d{3}Z$/, "Z"),
        AccountName: config.from,
        AddressType: "1",
        ReplyToAddress: "false",
        FromAlias: MAIL_SENDER_NAME,
        ToAddress: mail.to,
        Subject: mail.subject,
        HtmlBody: mail.html,
        TextBody: mail.text,
      };
      params.Signature = aliyunSignature(params, config.accessKeySecret);
      const body = Object.entries(params).map(([key, value]) => `${aliyunPercentEncode(key)}=${aliyunPercentEncode(value)}`).join("&");
      const response = await post("aliyun", fetchImpl, ALIYUN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        signal,
      });
      const json = await readJson(response);
      if (!response.ok || !json || json.Code) {
        const reason = code(json?.Code);
        throw new MailProviderError(`aliyun http ${response.status}${reason ? ` ${reason}` : ""}`);
      }
      return { messageId: code(json.EnvId) || code(json.RequestId) || null };
    },
  };
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Resend REST（POST /emails）。发件人写成「长江大学极客班 <发件地址>」，有回信地址时写 reply_to。 */
export function createResendProvider(config: { apiKey: string; from: string }, fetchImpl: FetchLike): MailProvider {
  return {
    name: "resend",
    supportsReplyTo: true,
    async send(mail, signal) {
      const payload: Record<string, unknown> = {
        from: `${MAIL_SENDER_NAME} <${config.from}>`,
        to: [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      };
      if (mail.replyTo) payload.reply_to = mail.replyTo;
      const response = await post("resend", fetchImpl, RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          // 同一封信重试时不变：上一次其实发出去了（例如进程在记录结果前退出）时，Resend 在 24 小时内不会再发一次
          "Idempotency-Key": mail.idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal,
      });
      const json = await readJson(response);
      if (!response.ok || !json || typeof json.id !== "string") {
        const reason = code(json?.name);
        throw new MailProviderError(`resend http ${response.status}${reason ? ` ${reason}` : ""}`);
      }
      return { messageId: code(json.id) || null };
    },
  };
}
