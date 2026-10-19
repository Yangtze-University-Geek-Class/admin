import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import { beijingCompactDate } from "../../lib/beijing-time.js";
import type { ParticipationType } from "../../lib/competition-signup-store.js";

export default async function consoleCompetitionRosterRoutes(app: FastifyInstance) {
  const { competitions, competitionSignups, config } = app.services;
  const { audit } = app.services.storage;

  const manage = [requireAuth, requireCapability("competitions.manage")];

  /** 获取比赛名单花名册与去重统计 */
  app.get<{ Params: { competition_id: string } }>(
    "/api/console/competitions/:competition_id/roster",
    { preHandler: manage },
    async (req, reply) => {
      const comp = competitions.get(req.params.competition_id);
      if (!comp) return reply.code(404).send({ error: "not_found", message: "比赛不存在" });

      const roster = competitionSignups.getRoster(req.params.competition_id);
      return { roster };
    },
  );

  /** 更新比赛报名设置 */
  app.put<{
    Params: { competition_id: string };
    Body: {
      enabled: boolean;
      participation: ParticipationType;
      team_min?: number | null;
      team_max?: number | null;
    };
  }>(
    "/api/console/competitions/:competition_id/signup-settings",
    { preHandler: manage },
    async (req, reply) => {
      const comp = competitions.get(req.params.competition_id);
      if (!comp) return reply.code(404).send({ error: "not_found", message: "比赛不存在" });

      const result = competitionSignups.updateSettings(
        req.params.competition_id,
        req.body,
        req.session!.login,
        Date.now(),
      );

      if (!result.ok) {
        const code =
          result.error === "not_found" ? 404 : result.error === "bad_team_size" ? 400 : 409;
        return reply.code(code).send(result);
      }

      audit(
        config.consoleOrg,
        req.session!.login,
        "competition.signup_settings.update",
        comp.id,
        { enabled: result.settings.enabled, participation: result.settings.participation },
        req.ip,
      );

      return { settings: result.settings };
    },
  );

  /** 导出比赛花名册为 CSV 文件 */
  app.get<{ Params: { competition_id: string } }>(
    "/api/console/competitions/:competition_id/roster.csv",
    { preHandler: manage },
    async (req, reply) => {
      const comp = competitions.get(req.params.competition_id);
      if (!comp) return reply.code(404).send({ error: "not_found", message: "比赛不存在" });

      const csv = competitionSignups.exportRosterCsv(comp.id, comp.name);
      if (csv === null) return reply.code(404).send({ error: "not_found", message: "比赛不存在" });

      audit(
        config.consoleOrg,
        req.session!.login,
        "competition.roster.export",
        comp.id,
        { competition_name: comp.name },
        req.ip,
      );

      const filename = `competition-${comp.id.slice(0, 8)}-roster-${beijingCompactDate(Date.now())}.csv`;
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(csv);
    },
  );
}
