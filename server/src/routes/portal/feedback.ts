import type { FastifyInstance } from "fastify";

type Body = {
  org: string;
  content: string;
  category?: string;
  contact?: string;
  turnstile_token?: string;
  pow?: { timestamp: number; nonce: string };
  website?: string;
};

const CATEGORIES = ["建议", "Bug", "新功能", "投诉", "其他"];
const ORG_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

export default async function feedbackRoutes(app: FastifyInstance) {
  const { audit, db } = app.services.storage;
  const { getSession } = app.services.auth;
  const { verifyTurnstile } = app.services.turnstile;
  const { preflightPublicSubmission, powDifficulty } = app.services.publicSubmission;
  const { config } = app.services;
  const { turnstileEnabled } = app.services.turnstile;
  app.get("/api/feedback/categories", async () => ({ categories: CATEGORIES, pow_difficulty: powDifficulty() }));

  app.post<{ Body: Body }>("/api/feedback", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (req, reply) => {
    const { org, content, category, contact, turnstile_token } = req.body ?? {};
    if (!org || !ORG_REGEX.test(org)) return reply.code(400).send({ error: "组织无效" });
    const text = content?.trim();
    if (!text || text.length < 5) return reply.code(400).send({ error: "意见内容至少 5 个字" });
    if (text.length > 5000) return reply.code(400).send({ error: "意见内容过长（5000 字以内）" });
    if (category && !CATEGORIES.includes(category)) return reply.code(400).send({ error: "分类无效" });

    const bodyForHash = `fb:${org}:${text}`;
    if (!(await preflightPublicSubmission(req, reply, bodyForHash))) return;

    const captchaOk = await verifyTurnstile(turnstile_token, req.ip);
    if (!captchaOk) return reply.code(400).send({ error: "人机验证失败" });

    let submitter_login: string | null = null;
    let submitter_id: number | null = null;
    const sid = req.cookies?.sid;
    if (sid) {
      const s = getSession(sid);
      if (s) { submitter_login = s.login; submitter_id = s.user_id; }
    }

    const now = Date.now();
    const r = db.prepare(
      "INSERT INTO feedback(org, content, category, contact, submitter_login, submitter_id, source_ip, user_agent, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)"
    ).run(org, text, category ?? null, contact?.trim()?.slice(0, 200) ?? null, submitter_login, submitter_id, req.ip, req.headers["user-agent"] ?? null, now, now);

    audit(org, submitter_login ?? "public", "feedback.submit", String(r.lastInsertRowid), { category, content_preview: text.slice(0, 80) }, req.ip);
    return { ok: true, id: r.lastInsertRowid, message: "意见已收到，组织负责人会查看。感谢你的反馈。" };
  });

  app.get<{ Querystring: { org?: string; limit?: string } }>("/api/feedback/public", async (req) => {
    const { org } = req.query;
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    if (!org) return { items: [] };
    const rows = db.prepare(
      "SELECT id, category, content, status, reply, votes, created_at, replied_at FROM feedback WHERE org = ? AND status != 'spam' ORDER BY created_at DESC LIMIT ?"
    ).all(org, limit);
    return { items: rows.map((r: any) => ({ ...r, content: r.content.slice(0, 280) })) };
  });
}
