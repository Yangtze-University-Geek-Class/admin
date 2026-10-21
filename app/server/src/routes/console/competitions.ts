import type { FastifyInstance, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import {
  competitionError, newCompetitionId, toConsoleCompetition,
  type CompetitionDraft, type CompetitionPatch, type CompetitionRecord,
} from "../../lib/competition-store.js";
import { SIGNUP_ERRORS, type SignupErrorCode } from "../../lib/competition-signup-store.js";

const VALIDATION_MESSAGE: Record<NonNullable<ReturnType<typeof competitionError>>, string> = {
  bad_name: "比赛名称至少需要 2 个非首尾空白字符",
  bad_range: "结束时间不能早于开始时间",
  deadline_after_end: "报名截止不能晚于比赛结束",
  bad_url: "请填写有效的 https:// 官方链接",
};

/** 补丁归一：`url` 与 `kind` 无关（内部比赛也能挂自己的比赛官网），这里只保证空串按「没填」处理。 */
const normalize = (draft: CompetitionDraft): CompetitionDraft => ({ ...draft, name: draft.name.trim(), url: draft.url?.trim() ? draft.url.trim() : null });

/** #238 的比赛写入要给报名让路的三种冲突（#239）：错误码与报名设置共用一张表。 */
const refuse = (reply: FastifyReply, error: SignupErrorCode) =>
  reply.code(SIGNUP_ERRORS[error].status).send({ error, message: SIGNUP_ERRORS[error].message });

/**
 * 比赛（#238）：控制台里新建、编辑、下线。授权按 `competitions.manage` 判定，只在服务端。
 * 「下线」是 `PATCH { offline: true }`（公开接口不再返回，控制台仍看得到）；`DELETE` 是真删。
 */
export default async function consoleCompetitionRoutes(app: FastifyInstance) {
  const { competitions, competitionSignups, config } = app.services;
  const { audit, db } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  const manage = [requireCapability("competitions.manage")];

  /** 控制台看全部，含已下线的；公开接口把 `offline` 的滤掉。 */
  app.get("/api/console/competitions", { preHandler: requireCapability("console.access") }, async () => {
    const now = Date.now();
    return { competitions: competitions.list(now).map(record => toConsoleCompetition(record, now)) };
  });

  app.post<{ Body: CompetitionDraft }>(
    "/api/console/competitions",
    { preHandler: manage, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const draft = normalize(req.body);
      const invalid = competitionError(draft);
      if (invalid) return reply.code(400).send({ error: invalid, message: VALIDATION_MESSAGE[invalid] });
      const id = newCompetitionId();
      const created = db.transaction(() => {
        const record = competitions.insert(id, draft, Date.now());
        if (!record) throw new Error("Competition insert returned no row");
        audit(config.consoleOrg, req.session!, "competition.create", id, { name: record.name, kind: record.kind }, req.ip);
        return record;
      })();
      return reply.code(201).send({ competition: toConsoleCompetition(created, Date.now()) });
    },
  );

  app.patch<{ Params: { competition_id: string }; Body: CompetitionPatch }>(
    "/api/console/competitions/:competition_id",
    { preHandler: manage, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { competition_id: id } = req.params;
      const current = competitions.get(id);
      if (!current) return reply.code(404).send({ error: "not_found", message: "比赛不存在" });
      // 有未取消的报名（#239）：不能改内外部；开放报名期间不能清空报名截止时间。
      if (req.body.kind !== undefined && req.body.kind !== current.kind && competitionSignups.hasActiveSignups(id)) return refuse(reply, "kind_locked");
      if (req.body.signup_deadline === null && competitionSignups.signupEnabled(id)) return refuse(reply, "deadline_required");
      // 时间关系要拿「改完之后的样子」判：只改开始时间时，结束时间取库里的，不能只看这一条补丁。
      const invalid = competitionError(normalize({ ...patchBase(current), ...req.body, kind: req.body.kind ?? current.kind }));
      if (invalid) return reply.code(400).send({ error: invalid, message: VALIDATION_MESSAGE[invalid] });
      const patch = { ...req.body };
      if (patch.name !== undefined) patch.name = patch.name.trim();
      const changed = db.transaction(() => {
        const record = competitions.update(id, patch, Date.now());
        if (record) audit(config.consoleOrg, req.session!, "competition.update", id, { changed: Object.keys(req.body) }, req.ip);
        return record;
      })();
      if (!changed) return reply.code(404).send({ error: "not_found", message: "比赛不存在" });
      return { competition: toConsoleCompetition(changed, Date.now()) };
    },
  );

  app.delete<{ Params: { competition_id: string } }>(
    "/api/console/competitions/:competition_id",
    { preHandler: manage, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { competition_id: id } = req.params;
      // 有报名记录的队伍与名单靠外键级联删掉，但历史不能悄悄消失：只能下线，不能删除。
      if (competitionSignups.hasSignups(id)) return refuse(reply, "has_signups");
      const removed = db.transaction(() => {
        const record = competitions.get(id);
        if (!record || !competitions.remove(id)) return false;
        audit(config.consoleOrg, req.session!, "competition.delete", id, { name: record.name }, req.ip);
        return true;
      })();
      if (!removed) return reply.code(404).send({ error: "not_found", message: "比赛不存在" });
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
