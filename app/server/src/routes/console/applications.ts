import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import { APPLICATION_STATUS_IDS, type ApplicationStatus } from "../../lib/roles.js";

type ApplicationRow = { id: string; name: string; class_name: string; email: string; strengths: string; status: string; created_at: number };
type ReviewRow = { id: number; application_id: string; from_status: string; to_status: string; note: string | null; reviewer: string; created_at: number };
type ListQuery = { status?: ApplicationStatus; q?: string; limit?: string; offset?: string };

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
const yyyymmdd = (time: number) => new Date(time).toISOString().slice(0, 10).replace(/-/g, "");

export default async function consoleApplicationRoutes(app: FastifyInstance) {
  const { config } = app.services;
  const { audit, db } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  const lastReview = db.prepare("SELECT to_status, reviewer, created_at FROM application_reviews WHERE application_id = ? ORDER BY created_at DESC, id DESC LIMIT 1");

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
      const header = ["name", "class_name", "email", "strengths", "status", "created_at"];
      const lines = [header.join(","), ...rows.map(row => [row.name, row.class_name, row.email, row.strengths, row.status, new Date(row.created_at).toISOString()].map(csvCell).join(","))];
      audit(config.consoleOrg, req.session!.login, "application.export", status ?? "all", { count: rows.length, status: status ?? null }, req.ip);
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="applications-${yyyymmdd(Date.now())}.csv"`)
        .send(`﻿${lines.join("\r\n")}\r\n`);
    },
  );

  const findApplication = (id: string) => db.prepare(`SELECT ${APPLICATION_COLUMNS} FROM applications WHERE id = ?`).get(id) as ApplicationRow | undefined;
  const reviewsOf = (id: string) => db.prepare("SELECT id, from_status, to_status, note, reviewer, created_at FROM application_reviews WHERE application_id = ? ORDER BY created_at DESC, id DESC").all(id) as Omit<ReviewRow, "application_id">[];

  app.get<{ Params: { application_id: string } }>(
    "/api/console/applications/:application_id",
    { preHandler: requireCapability("applications.read") },
    async (req, reply) => {
      const application = findApplication(req.params.application_id);
      if (!application) return reply.code(404).send({ error: "not_found", message: "投递不存在" });
      audit(config.consoleOrg, req.session!.login, "application.view", application.id, undefined, req.ip);
      return { application, reviews: reviewsOf(application.id) };
    },
  );

  app.patch<{ Params: { application_id: string }; Body: { status?: ApplicationStatus; note?: string } }>(
    "/api/console/applications/:application_id",
    { preHandler: requireCapability("applications.review") },
    async (req, reply) => {
      const current = findApplication(req.params.application_id);
      if (!current) return reply.code(404).send({ error: "not_found", message: "投递不存在" });
      const next = req.body.status ?? current.status;
      const note = req.body.note?.trim() || null;
      if (next === current.status && !note) return reply.code(400).send({ error: "no_change", message: "状态没有变化，也没有填写备注" });
      const reviewer = req.session!.login;
      const review = db.transaction(() => {
        if (next !== current.status) db.prepare("UPDATE applications SET status = ? WHERE id = ?").run(next, current.id);
        const result = db.prepare("INSERT INTO application_reviews(application_id, from_status, to_status, note, reviewer, created_at) VALUES(?, ?, ?, ?, ?, ?)")
          .run(current.id, current.status, next, note, reviewer, Date.now());
        return db.prepare("SELECT id, from_status, to_status, note, reviewer, created_at FROM application_reviews WHERE id = ?").get(Number(result.lastInsertRowid));
      })();
      // 备注属于候选人相关信息，只进 application_reviews，不写进审计。
      audit(config.consoleOrg, reviewer, "application.review", current.id, { from: current.status, to: next, has_note: Boolean(note) }, req.ip);
      return { application: findApplication(current.id), review };
    },
  );
}
