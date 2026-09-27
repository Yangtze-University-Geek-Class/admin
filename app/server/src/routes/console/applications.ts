import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import { beijingCompactDate, beijingDateTime } from "../../lib/beijing-time.js";
import { APPLICATION_STATUSES, APPLICATION_STATUS_IDS, type ApplicationStatus } from "../../lib/roles.js";
import { MailTemplateError, oneLine, type RenderedMail } from "../../lib/mail/envelope.js";
import type { RecruitmentLetter } from "../../lib/mail/mailer.js";

type ApplicationRow = { id: string; name: string; class_name: string; email: string; strengths: string; status: string; created_at: number };
type ReviewRow = { id: number; application_id: string; from_status: string; to_status: string; note: string | null; reviewer: string; created_at: number };
type ListQuery = { status?: ApplicationStatus; q?: string; limit?: string; offset?: string };
type ReviewBody = { status?: string; expected_status?: ApplicationStatus; expected_review_id?: number; note?: string; notify?: boolean; letter?: RecruitmentLetter };

/** 改成这几个状态时发对应的信（改回「已收到」、只写备注都不发） */
const LETTER_STATUSES = ["interview", "accepted", "rejected"] as const;
type LetterStatus = (typeof LETTER_STATUSES)[number];
const isLetterStatus = (value: string): value is LetterStatus => (LETTER_STATUSES as readonly string[]).includes(value);

/** 信的内容不合规时给改状态的人看的话（MailTemplateError 的 code → 中文） */
const LETTER_ERRORS: Partial<Record<MailTemplateError["code"], string>> = {
  missing_reply_to: "现在没有配置回信地址，信里不能请对方直接回复这封邮件，换个说法",
  missing_field: "信里缺了必填的内容",
};

/** 列表与详情只下发这些列；来源 IP 与 User-Agent 留在服务端。 */
const APPLICATION_COLUMNS = "id, name, class_name, email, strengths, status, created_at";
const EXCERPT_LENGTH = 120;
const excerpt = (value: string) => (value.length > EXCERPT_LENGTH ? `${value.slice(0, EXCERPT_LENGTH)}…` : value);
const escapeLike = (value: string) => value.replace(/[\\%_]/g, match => `\\${match}`);

/** 表格公式注入防护：以 = + - @ 制表符 回车 开头的单元格前加 '。 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const statusLabel = (id: string) => APPLICATION_STATUSES.find(item => item.id === id)?.label ?? id;

export default async function consoleApplicationRoutes(app: FastifyInstance) {
  const { config, mail } = app.services;
  const { audit, db } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  const lastReview = db.prepare("SELECT to_status, reviewer, created_at FROM application_reviews WHERE application_id = ? ORDER BY created_at DESC, id DESC LIMIT 1");
  // 审核记录的版本号取最大的 id：id 自增，只会变大；created_at 跟着服务器时钟，时钟往回拨时最新一条不一定排第一
  const lastReviewId = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM application_reviews WHERE application_id = ?");

  app.get<{ Querystring: ListQuery }>("/api/console/applications", { preHandler: requireCapability("applications.read") }, async (req) => {
    const { status, q } = req.query;
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const where: string[] = [];
    const params: unknown[] = [];
    if (status) { where.push("status = ?"); params.push(status); }
    if (q?.trim()) {
      const like = `%${escapeLike(q.trim())}%`;
      where.push("(name LIKE ? ESCAPE '\\' OR class_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')");
      params.push(like, like, like);
    }
    const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const rows = db.prepare(`SELECT ${APPLICATION_COLUMNS} FROM applications${clause} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as ApplicationRow[];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM applications${clause}`).get(...params) as { n: number }).n;
    const counts: Record<string, number> = Object.fromEntries(APPLICATION_STATUS_IDS.map(id => [id, 0]));
    for (const row of db.prepare("SELECT status, COUNT(*) AS n FROM applications GROUP BY status").all() as { status: string; n: number }[]) counts[row.status] = row.n;
    return {
      items: rows.map(row => ({
        id: row.id, name: row.name, class_name: row.class_name, email: row.email,
        strengths_excerpt: excerpt(row.strengths), status: row.status, created_at: row.created_at,
        last_review: (lastReview.get(row.id) as { to_status: string; reviewer: string; created_at: number } | undefined) ?? null,
      })),
      total, counts,
    };
  });

  // 静态路由优先于 /:application_id，Fastify 不会把 export.csv 当成 id。
  app.get<{ Querystring: { status?: ApplicationStatus } }>(
    "/api/console/applications/export.csv",
    { preHandler: requireCapability("applications.export"), config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { status } = req.query;
      const rows = (status
        ? db.prepare(`SELECT ${APPLICATION_COLUMNS} FROM applications WHERE status = ? ORDER BY created_at DESC`).all(status)
        : db.prepare(`SELECT ${APPLICATION_COLUMNS} FROM applications ORDER BY created_at DESC`).all()) as ApplicationRow[];
      // 投递时间和文件名里的日期按北京时间写（lib/beijing-time.ts），和控制台页面、信里的时间一致；列名写明是北京时间。
      const header = ["name", "class_name", "email", "strengths", "status", "created_at_beijing"];
      const lines = [header.join(","), ...rows.map(row => [row.name, row.class_name, row.email, row.strengths, row.status, beijingDateTime(row.created_at)].map(csvCell).join(","))];
      audit(config.consoleOrg, req.session!.login, "application.export", status ?? "all", { count: rows.length, status: status ?? null }, req.ip);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="applications-${beijingCompactDate(Date.now())}.csv"`)
        .send(`﻿${lines.join("\r\n")}\r\n`);
    },
  );

  const findApplication = (id: string) => db.prepare(`SELECT ${APPLICATION_COLUMNS} FROM applications WHERE id = ?`).get(id) as ApplicationRow | undefined;
  const reviewsOf = (id: string) => db.prepare("SELECT id, from_status, to_status, note, reviewer, created_at FROM application_reviews WHERE application_id = ? ORDER BY created_at DESC, id DESC").all(id) as Omit<ReviewRow, "application_id">[];
  /** 审核记录带上那次改状态发的信（没发信的是 null） */
  const withMail = <T extends { id: number }>(reviews: T[]) => {
    const summaries = mail.reviewSummaries(reviews.map(review => review.id));
    return reviews.map(review => ({ ...review, mail: summaries.get(review.id) ?? null }));
  };

  app.get<{ Params: { application_id: string } }>(
    "/api/console/applications/:application_id",
    { preHandler: requireCapability("applications.read") },
    async (req, reply) => {
      const application = findApplication(req.params.application_id);
      if (!application) return reply.code(404).send({ error: "not_found", message: "投递不存在" });
      audit(config.consoleOrg, req.session!.login, "application.view", application.id, undefined, req.ip);
      return {
        application,
        reviews: withMail(reviewsOf(application.id)),
        received_mail: mail.summary(`application:${application.id}:received`),
        mail: { enabled: mail.enabled, recipients: mail.recipients, deliverable: mail.deliverable(application.email) },
      };
    },
  );

  app.patch<{ Params: { application_id: string }; Body: ReviewBody }>(
    "/api/console/applications/:application_id",
    { preHandler: requireCapability("applications.review") },
    async (req, reply) => {
      const current = findApplication(req.params.application_id);
      if (!current) return reply.code(404).send({ error: "not_found", message: "投递不存在" });
      const { status, notify, letter = {} } = req.body;
      if (status !== undefined && !(APPLICATION_STATUS_IDS as string[]).includes(status)) {
        return reply.code(400).send({ error: "invalid_status", message: "状态只能是已收到、待面试、已录取、未通过" });
      }
      // 控制台带上页面上看到的状态和审核记录的版本号（最大的 id，没有记录时是 0）：别人在这之间处理过，就不按旧画面改，
      // 也不发信（改状态的信发出去撤不回来）。只比状态会漏掉「改走又改回」，所以还比审核记录。
      const changedMeanwhile = (message?: string) => {
        const latest = findApplication(current.id) ?? current;
        return reply.code(409).send({
          error: "status_changed", message: message ?? `这份投递刚被别人处理过，现在是「${statusLabel(latest.status)}」，看过最新的记录再改`, application: latest,
        });
      };
      const { expected_status: expectedStatus, expected_review_id: expectedReviewId } = req.body;
      const seenReviewId = (lastReviewId.get(current.id) as { id: number }).id;
      if (expectedStatus !== undefined && expectedStatus !== current.status) return changedMeanwhile();
      if (expectedReviewId !== undefined && expectedReviewId !== seenReviewId) return changedMeanwhile();
      // 要改状态就必须带这两项：部署前打开、还没刷新的旧页面不带，不能让它按旧画面发信。
      if (status !== undefined && status !== current.status && (expectedStatus === undefined || expectedReviewId === undefined)) {
        return changedMeanwhile("这个页面是旧版本，刷新后再改");
      }
      const next = status ?? current.status;
      const note = req.body.note?.trim() || null;
      if (next === current.status && !note) return reply.code(400).send({ error: "no_change", message: "状态没有变化，也没有填写备注" });

      // 状态真的变成待面试、已录取、未通过，并且没有取消发信，才发信；备注只给审核人看，不进信里。
      // 信在写库之前渲染：内容不合规时直接 400，状态不改。
      const letterKind = next !== current.status && notify !== false && isLetterStatus(next) ? next : null;
      let letterMail: RenderedMail | null = null;
      if (letterKind) {
        if (letterKind === "interview") {
          const fields: { time?: string; place?: string } = {};
          if (!oneLine(letter.time ?? "")) fields.time = "请填面试时间";
          if (!oneLine(letter.place ?? "")) fields.place = "请填面试地点";
          if (fields.time || fields.place) return reply.code(400).send({ error: "letter_required", message: "要发待面试的信，请填面试时间和地点", fields });
        }
        try {
          letterMail = mail.recruitmentLetter(letterKind, current, letter);
        } catch (error) {
          if (!(error instanceof MailTemplateError)) throw error;
          return reply.code(400).send({ error: "letter_invalid", message: LETTER_ERRORS[error.code] ?? "信的内容不合规，改一下再发" });
        }
      }

      const reviewer = req.session!.login;
      const review = db.transaction(() => {
        // 带着读到的状态改：读和写之间状态变了（changes 为 0）就什么也不写，回 409
        if (next !== current.status && db.prepare("UPDATE applications SET status = ? WHERE id = ? AND status = ?").run(next, current.id, current.status).changes !== 1) return null;
        const result = db.prepare("INSERT INTO application_reviews(application_id, from_status, to_status, note, reviewer, created_at) VALUES(?, ?, ?, ?, ?, ?)")
          .run(current.id, current.status, next, note, reviewer, Date.now());
        const reviewId = Number(result.lastInsertRowid);
        // 同一事务写进发信队列：改状态和这封信要么都在、要么都不在
        if (letterKind && letterMail) {
          mail.enqueue({ eventKey: `review:${reviewId}`, kind: `recruitment.${letterKind}`, applicationId: current.id, reviewId, to: current.email, mail: letterMail });
        }
        return db.prepare("SELECT id, from_status, to_status, note, reviewer, created_at FROM application_reviews WHERE id = ?").get(reviewId) as Omit<ReviewRow, "application_id">;
      })();
      if (!review) return changedMeanwhile();
      // 备注属于候选人相关信息，只进 application_reviews，不写进审计；信的内容也不进审计，只记这次有没有发信。
      audit(config.consoleOrg, reviewer, "application.review", current.id, { from: current.status, to: next, has_note: Boolean(note), mail: Boolean(letterKind) }, req.ip);
      return { application: findApplication(current.id), review: withMail([review])[0] };
    },
  );
}
