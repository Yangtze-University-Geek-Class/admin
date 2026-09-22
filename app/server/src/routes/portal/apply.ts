import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

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
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const SUCCESS_MESSAGE = "投递成功，我们会在 3 个工作日内联系你。";

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

  app.post<{ Body: Body }>(
    "/api/portal/apply",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
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

      const id = randomUUID();
      const submittedAt = Date.now();
      db.prepare(
        "INSERT INTO applications(id, name, class_name, email, strengths, source_ip, user_agent, status, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, 'received', ?)"
      ).run(id, name.value, className.value, email.value, strengths.value, req.ip, req.headers["user-agent"] ?? null, submittedAt);

      audit(null, "public:apply", "application.received", id, {
        email: maskEmail(email.value),
        class_name: className.value,
        name_length: name.value.length,
        strengths_length: strengths.value.length,
      }, req.ip);

      return reply.code(201).send({ id, submitted_at: submittedAt, message: SUCCESS_MESSAGE });
    }
  );
}
