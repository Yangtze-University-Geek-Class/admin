import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import {
  competitionError, newCompetitionId, toConsoleCompetition,
  type CompetitionDraft, type CompetitionPatch, type CompetitionRecord,
} from "../../lib/competition-store.js";

/** 时间先后关系的错误码 → 给操作者看的话。 */
const RANGE_MESSAGE: Record<"bad_range" | "deadline_after_end", string> = {
  bad_range: "结束时间不能早于开始时间",
  deadline_after_end: "报名截止不能晚于比赛结束",
};

/** 补丁归一：`url` 与 `kind` 无关（内部比赛也能挂自己的比赛官网），这里只保证空串按「没填」处理。 */
const normalize = (draft: CompetitionDraft): CompetitionDraft => ({ ...draft, url: draft.url?.trim() ? draft.url.trim() : null });

/**
 * 比赛（#238）：控制台里新建、编辑、下线。授权按 `competitions.manage` 判定，只在服务端。
 * 「下线」是 `PATCH { offline: true }`（公开接口不再返回，控制台仍看得到）；`DELETE` 是真删。
 */
export default async function consoleCompetitionRoutes(app: FastifyInstance) {
  const { competitions, competitionSignups, config } = app.services;
  const { audit } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  const manage = [requireCapability("competitions.manage")];

  /** 控制台看全部，含已下线的；公开接口把 `offline` 的滤掉。 */
  app.get("/api/console/competitions", {
    preHandler: requireCapability("console.access"),
    schema: { response: { 200: { type: "object", additionalProperties: true } } },
  }, async () => {
    const now = Date.now();
    return { competitions: competitions.list(now).map(record => toConsoleCompetition(record, now)) };
  });

  app.post<{ Body: CompetitionDraft }>(
    "/api/console/competitions",
    {
      preHandler: manage,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { response: { 201: { type: "object", additionalProperties: true } } },
    },
    async (req, reply) => {
      const draft = normalize(req.body);
      const invalid = competitionError(draft);
      if (invalid) return reply.code(400).send({ error: invalid, message: RANGE_MESSAGE[invalid] });
      const id = newCompetitionId();
      const created = competitions.insert(id, draft, Date.now());
      if (!created) return reply.code(500).send({ error: "not_created", message: "比赛没有建成功，请重试" });
      audit(config.consoleOrg, req.session!.login, "competition.create", id, { name: created.name, kind: created.kind }, req.ip);
      return reply.code(201).send({ competition: toConsoleCompetition(created, Date.now()) });
    },
  );

  app.patch<{ Params: { competition_id: string }; Body: CompetitionPatch }>(
    "/api/console/competitions/:competition_id",
    {
      preHandler: manage,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: { response: { 200: { type: "object", additionalProperties: true } } },
    },
    async (req, reply) => {
      const { competition_id: id } = req.params;
      const current = competitions.get(id);
      if (!current) return reply.code(404).send({ error: "not_found", message: "比赛不存在" });

      if (req.body.kind && req.body.kind !== current.kind) {
        if (competitionSignups.hasActiveSignups(id)) {
          return reply.code(409).send({ error: "competition_has_signups", message: "已有未取消的报名记录，无法修改比赛类型" });
        }
      }

      if (req.body.signup_deadline === null) {
        const settings = competitionSignups.getSettings(id);
        if (settings?.enabled) {
          return reply.code(409).send({ error: "signup_deadline_required", message: "开放报名期间不能清空报名截止时间" });
        }
      }

      // 时间关系要拿「改完之后的样子」判：只改开始时间时，结束时间取库里的，不能只看这一条补丁。
      const invalid = competitionError(normalize({ ...patchBase(current), ...req.body, kind: req.body.kind ?? current.kind }));
      if (invalid) return reply.code(400).send({ error: invalid, message: RANGE_MESSAGE[invalid] });
      const changed = competitions.update(id, req.body, Date.now());
      if (!changed) return reply.code(404).send({ error: "not_found", message: "比赛不存在" });
      audit(config.consoleOrg, req.session!.login, "competition.update", id, { changed: Object.keys(req.body) }, req.ip);
      return { competition: toConsoleCompetition(changed, Date.now()) };
    },
  );

  app.delete<{ Params: { competition_id: string } }>(
    "/api/console/competitions/:competition_id",
    {
      preHandler: manage,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { response: { 200: { type: "object", additionalProperties: true } } },
    },
    async (req, reply) => {
      const { competition_id: id } = req.params;
      const record = competitions.get(id);
      if (!record) return reply.code(404).send({ error: "not_found", message: "比赛不存在" });

      if (competitionSignups.hasAnySignups(id)) {
        return reply.code(409).send({ error: "competition_has_signups", message: "有报名记录的比赛不能删除，只能下线" });
      }

      if (!competitions.remove(id)) return reply.code(404).send({ error: "not_found", message: "比赛不存在" });
      audit(config.consoleOrg, req.session!.login, "competition.delete", id, { name: record.name }, req.ip);
      return { ok: true };
    },
  );
}

/** 库里那一条的字段，用来和补丁合并出「改完之后的样子」。 */
function patchBase(record: CompetitionRecord): CompetitionDraft {
  return {
    name: record.name, kind: record.kind,
    start_at: record.start_at, end_at: record.end_at,
    signup_deadline: record.signup_deadline, url: record.url, description: record.description,
  };
}
