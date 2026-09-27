import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { MailTemplateError } from "../../lib/mail/envelope.js";
import { RECEIVED_LETTER_LIMITS } from "../../lib/mail/mailer.js";
import { ipSubject } from "../../lib/forum-rules.js";

type Body = {
  name?: string;
  className?: string;
  email?: string;
  strengths?: string;
  website?: string; // honeypot
  turnstile_token?: string;
  pow?: { timestamp: number; nonce: string };
};

type FieldName = "name" | "className" | "email" | "strengths";
type FieldErrors = Partial<Record<FieldName, string>>;
type Checked = { ok: true; value: string } | { ok: false; error: string };

const NAME_MIN = 2;
const NAME_MAX = 40;
const CLASS_NAME_MAX = 40;
const EMAIL_MAX = 120;
const STRENGTHS_MIN = 10;
const STRENGTHS_MAX = 2000;

/** 班级允许中文（Han 全部区段）、字母、数字、空格、间隔号与连字符。 */
const CLASS_NAME_REGEX = /^[\p{Script=Han}a-zA-Z0-9 ·-]+$/u;
// 本地部分和域名都按点分段、每段非空，不收引号、反斜杠、方括号和 RFC 5322 的其它分隔符：不收 a@b..c、a@.b.c、
// 末尾带点的 a@b.c.、带引号的 "a"@b.c 和 IP 字面量 a@[1.2.3.4]。这些写法指向同一个收件箱却能绕开确认信的按收件箱限量。
// 官网表单（app/web/sites/portal/pages/JoinUs.tsx）用同一条，改的时候一起改。
const EMAIL_REGEX = /^[^\s@"\\()<>,;:[\].]+(\.[^\s@"\\()<>,;:[\].]+)*@[^\s@"\\()<>,;:[\].]+(\.[^\s@"\\()<>,;:[\].]+)+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const SUCCESS_MESSAGE = "投递成功，我们会在 3 个工作日内联系你。";

/**
 * 投递次数（#169）：所有者 2026-09-27 14:20「为了防止别人申请时盗刷，可以在申请时限制一个设备或一个IP最多申请5次，
 * 也就是只能申请5个邮件」。同一个来源 IP（IPv6 按 /64，ipSubject）、同一个设备各自在滚动的 24 小时里最多 5 份成功的投递，
 * 第 6 份回 429、不落库、不发信。只数成功的投递：蜜罐、校验不过、人机验证不过、被拦下的都不算。
 * 设备是这个接口自己发的 cookie（APPLY_DEVICE_COOKIE），清掉 cookie 或换浏览器就算新设备，主要靠 IP 这一道。
 * 共用出口（校园网、宿舍、热点）的人算同一个 IP：一天里第 6 个人投不了，第二天可以再投。
 * 计数在 application_limits 表，只存 sha256 和时间。每个 IP 每分钟 5 次的请求限流（下面的 rateLimit）另外算。
 */
export const APPLY_LIMITS = { windowMs: 24 * 3600_000, perSource: 5, perDevice: 5 } as const;
export const APPLY_DEVICE_COOKIE = "yugc_apply_device";
const APPLY_LIMITED_MESSAGE = "同一台设备或同一个网络 24 小时内最多投递 5 次，之前投的都已经收到了。";
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function checkName(input: unknown): Checked {
  if (typeof input !== "string") return { ok: false, error: "姓名格式无效" };
  const value = input.trim();
  if (!value) return { ok: false, error: "请填写姓名" };
  if (CONTROL_CHARS.test(value)) return { ok: false, error: "姓名不能包含控制字符" };
  if (value.length < NAME_MIN || value.length > NAME_MAX) return { ok: false, error: `姓名长度需为 ${NAME_MIN}–${NAME_MAX} 个字符` };
  return { ok: true, value };
}

function checkClassName(input: unknown): Checked {
  if (typeof input !== "string") return { ok: false, error: "班级格式无效" };
  const value = input.trim();
  if (!value) return { ok: false, error: "请填写班级" };
  if (value.length < NAME_MIN || value.length > CLASS_NAME_MAX) return { ok: false, error: `班级长度需为 ${NAME_MIN}–${CLASS_NAME_MAX} 个字符` };
  if (!CLASS_NAME_REGEX.test(value)) return { ok: false, error: "班级包含非法字符，只能使用中文、字母、数字、空格、· 和 -" };
  return { ok: true, value };
}

function checkEmail(input: unknown): Checked {
  if (typeof input !== "string") return { ok: false, error: "邮箱格式无效" };
  const value = input.trim();
  if (!value) return { ok: false, error: "请填写邮箱" };
  if (value.length > EMAIL_MAX) return { ok: false, error: `邮箱长度不能超过 ${EMAIL_MAX} 个字符` };
  if (CONTROL_CHARS.test(value) || !EMAIL_REGEX.test(value)) return { ok: false, error: "邮箱格式无效" };
  return { ok: true, value };
}

function checkStrengths(input: unknown): Checked {
  if (typeof input !== "string") return { ok: false, error: "个人特长与优点格式无效" };
  const value = input.trim();
  if (!value) return { ok: false, error: "请填写个人特长与优点" };
  if (value.length < STRENGTHS_MIN) return { ok: false, error: `个人特长与优点至少 ${STRENGTHS_MIN} 个字符` };
  if (value.length > STRENGTHS_MAX) return { ok: false, error: `个人特长与优点不能超过 ${STRENGTHS_MAX} 个字符` };
  return { ok: true, value };
}

/** 审计只留脱敏邮箱，不留完整联系方式。 */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email.slice(0, 1)}***@${email.slice(at + 1)}`;
}

export default async function applyRoutes(app: FastifyInstance) {
  const { audit, db } = app.services.storage;
  const { verifyTurnstile } = app.services.turnstile;
  const { preflightPublicSubmission, checkHoneypot } = app.services.publicSubmission;
  const { config, mail } = app.services;
  const countSince = db.prepare("SELECT COUNT(*) AS n FROM application_limits WHERE bucket = ? AND subject_hash = ? AND created_at > ?");
  const recordAttempt = db.prepare("INSERT INTO application_limits(bucket, subject_hash, created_at) VALUES(?, ?, ?)");
  const pruneAttempts = db.prepare("DELETE FROM application_limits WHERE created_at <= ?");
  const insertApplication = db.prepare(
    "INSERT INTO applications(id, name, class_name, email, strengths, source_ip, user_agent, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'received', ?)"
  );
  // 查次数和写入放在同一个同步事务里：中间没有 await，两个请求不会同时通过检查。
  const admit = db.transaction((row: { id: string; name: string; className: string; email: string; strengths: string; ip: string; userAgent: string | null; at: number }, source: string, device: string) => {
    const since = row.at - APPLY_LIMITS.windowMs;
    const used = (bucket: string, subject: string) => (countSince.get(bucket, subject, since) as { n: number }).n;
    if (used("source", source) >= APPLY_LIMITS.perSource || used("device", device) >= APPLY_LIMITS.perDevice) return false;
    pruneAttempts.run(since);
    insertApplication.run(row.id, row.name, row.className, row.email, row.strengths, row.ip, row.userAgent, row.at);
    recordAttempt.run("source", source, row.at);
    recordAttempt.run("device", device, row.at);
    return true;
  });

  app.post<{ Body: Body }>(
    "/api/portal/apply",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
          errorResponseBuilder: () => ({ statusCode: 429, error: "rate_limited", message: "操作太频繁，请稍后再试" }),
        },
      },
    },
    async (req, reply) => {
      const body = req.body ?? {};

      // Honeypot：填了就按机器人处理，回与成功完全一致的形状但不落库，不向脚本暴露陷阱。
      if (!checkHoneypot(body as Record<string, unknown>)) {
        return reply.code(201).send({ id: randomUUID(), submitted_at: Date.now(), message: SUCCESS_MESSAGE });
      }

      const name = checkName(body.name);
      const className = checkClassName(body.className);
      const email = checkEmail(body.email);
      const strengths = checkStrengths(body.strengths);
      if (!name.ok || !className.ok || !email.ok || !strengths.ok) {
        const fields: FieldErrors = {};
        if (!name.ok) fields.name = name.error;
        if (!className.ok) fields.className = className.error;
        if (!email.ok) fields.email = email.error;
        if (!strengths.ok) fields.strengths = strengths.error;
        return reply.code(400).send({ error: Object.values(fields)[0], fields });
      }

      // PoW 的摘要输入与前端逐字一致：apply:<trim 后姓名>:<trim 后邮箱>。
      if (!(await preflightPublicSubmission(req, reply, `apply:${name.value}:${email.value}`))) return;

      const captchaOk = await verifyTurnstile(body.turnstile_token, req.ip);
      if (!captchaOk) return reply.code(400).send({ error: "人机验证失败，请刷新重试" });

      // 设备 id：带来的不像我们发的就换一个新的；每次都续一年，只在这个接口的路径下发送。
      const carried = req.cookies[APPLY_DEVICE_COOKIE];
      const device = carried && DEVICE_ID.test(carried) ? carried : randomUUID();
      reply.setCookie(APPLY_DEVICE_COOKIE, device, {
        httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/api/portal/apply", maxAge: 365 * 24 * 3600,
      });

      const id = randomUUID();
      const submittedAt = Date.now();
      const admitted = admit({
        id, name: name.value, className: className.value, email: email.value, strengths: strengths.value,
        ip: req.ip, userAgent: req.headers["user-agent"] ?? null, at: submittedAt,
      }, sha256(ipSubject(req.ip)), sha256(device));
      if (!admitted) return reply.code(429).send({ error: "apply_limited", message: APPLY_LIMITED_MESSAGE });

      audit(null, "public:apply", "application.received", id, {
        email: maskEmail(email.value),
        class_name: className.value,
        name_length: name.value.length,
        strengths_length: strengths.value.length,
      }, req.ip);

      // 投递已经落库；「已收到」的信拼不出来或写不进队列只记日志（不记地址和正文），不让投递失败。
      // 每份投递都发一封，只有全站每小时的上限（RECEIVED_LETTER_LIMITS）；防盗刷靠上面的投递次数。
      try {
        const application = { id, name: name.value, class_name: className.value, email: email.value, strengths: strengths.value, created_at: submittedAt };
        mail.enqueue({
          eventKey: `application:${id}:received`, kind: "recruitment.received", applicationId: id, to: email.value,
          mail: mail.recruitmentLetter("received", application),
        }, RECEIVED_LETTER_LIMITS);
      } catch (error) {
        req.log.error({ application_id: id, error: error instanceof MailTemplateError ? error.code : (error as Error)?.name ?? "error" }, "received letter not queued");
      }

      return reply.code(201).send({ id, submitted_at: submittedAt, message: SUCCESS_MESSAGE });
    }
  );
}
