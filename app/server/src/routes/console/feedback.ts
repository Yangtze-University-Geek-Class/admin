import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";

/** 控制台意见箱：固定为 CONSOLE_ORG，SQL 与管理端共用 lib/feedback-store。 */
export default async function consoleFeedbackRoutes(app: FastifyInstance) {
  const { config } = app.services;
  const { listFeedback, updateFeedback, deleteFeedback } = app.services.feedback;
  const { audit } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  app.get<{ Querystring: { status?: string; limit?: string } }>(
    "/api/console/feedback",
    { preHandler: requireCapability("feedback.read") },
    async (req) => listFeedback(config.consoleOrg, { status: req.query.status, limit: Number(req.query.limit ?? 200) }),
  );

  app.patch<{ Params: { id: string }; Body: { status?: string; reply?: string } }>(
    "/api/console/feedback/:id",
    { preHandler: requireCapability("feedback.manage") },
    async (req, reply) => {
      const { status, reply: replyText } = req.body;
      if (!updateFeedback(config.consoleOrg, Number(req.params.id), { status, reply: replyText }, req.session!.login)) {
        return reply.code(404).send({ error: "not_found", message: "意见不存在" });
      }
      audit(config.consoleOrg, req.session!.login, "feedback.update", req.params.id, { status, has_reply: Boolean(replyText) }, req.ip);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/console/feedback/:id",
    { preHandler: requireCapability("feedback.manage") },
    async (req, reply) => {
      if (!deleteFeedback(config.consoleOrg, Number(req.params.id))) return reply.code(404).send({ error: "not_found", message: "意见不存在" });
      audit(config.consoleOrg, req.session!.login, "feedback.delete", req.params.id, undefined, req.ip);
      return { ok: true };
    },
  );
}
