import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { FEEDBACK_STATUSES } from "../../lib/feedback-store.js";

const VALID_STATUS: readonly string[] = FEEDBACK_STATUSES;

export default async function adminFeedbackRoutes(app: FastifyInstance) {
  const { audit } = app.services.storage;
  const { listFeedback, updateFeedback, deleteFeedback } = app.services.feedback;
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { org: string }; Querystring: { status?: string; limit?: string } }>(
    "/api/admin/:org/feedback",
    { preHandler: requireOrgRole("admin") },
    async (req) => listFeedback(req.params.org, { status: req.query.status, limit: Number(req.query.limit ?? 200) }),
  );

  app.patch<{ Params: { org: string; id: string }; Body: { status?: string; reply?: string } }>(
    "/api/admin/:org/feedback/:id",
    { preHandler: requireOrgRole("admin") },
    async (req, reply) => {
      const { org, id } = req.params;
      const { status, reply: replyText } = req.body;
      if (status && !VALID_STATUS.includes(status)) return reply.code(400).send({ error: "状态无效" });
      if (!updateFeedback(org, Number(id), { status, reply: replyText }, req.session!.login)) return reply.code(404).send({ error: "意见不存在" });
      audit(org, req.session!.login, "feedback.update", id, { status, has_reply: Boolean(replyText) }, req.ip);
      return { ok: true };
    }
  );

  app.delete<{ Params: { org: string; id: string } }>(
    "/api/admin/:org/feedback/:id",
    { preHandler: requireOrgRole("admin") },
    async (req, reply) => {
      const { org, id } = req.params;
      if (!deleteFeedback(org, Number(id))) return reply.code(404).send({ error: "意见不存在" });
      audit(org, req.session!.login, "feedback.delete", id, undefined, req.ip);
      return { ok: true };
    }
  );
}
