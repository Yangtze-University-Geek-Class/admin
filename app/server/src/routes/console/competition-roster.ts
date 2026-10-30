import type { FastifyInstance, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requirePermission } from "../../middleware/require-permission.js";
import { requireStepUp } from "../../middleware/require-step-up.js";
import { beijingCompactDate, beijingDateTime } from "../../lib/beijing-time.js";
import { SCORE_ERRORS, type ScoreErrorCode, type ScoreEventInput } from "../../lib/competition-score-store.js";
import type { Core, Importance } from "../../lib/competition-rubric.js";
import { SIGNUP_ERRORS, type SignupErrorCode, type SignupSettings } from "../../lib/competition-signup-store.js";
import { csvCell } from "../../lib/sql-text.js";
import { publicCachePrefix } from "../../lib/competition-public.js";

const ERRORS: Record<SignupErrorCode | ScoreErrorCode, { status: number; message: string }> = { ...SIGNUP_ERRORS, ...SCORE_ERRORS };

function refuse(reply: FastifyReply, error: SignupErrorCode | ScoreErrorCode) {
  return reply.code(ERRORS[error].status).send({ error, message: ERRORS[error].message });
}

/** 审计只记改动的四个开关与人数，不记队名、备注这些原文。 */
const settingsAudit = (settings: SignupSettings) => ({
  enabled: settings.enabled, participation: settings.participation,
  team_min: settings.team_min, team_max: settings.team_max, scoring: settings.scoring,
});

/**
 * 控制台的比赛报名：报名设置、名单、移出与导出（#239、#342，节点 `competition.manage`）、积分登记与撤销
 * （节点 `competition.score.review`，CONTRACT-274 §5）。写操作与审计在同一个事务里；报名设置
 * 与 #238 的比赛写入共用同一张错误码表。
 */
export default async function consoleCompetitionRosterRoutes(app: FastifyInstance) {
  const { competitionSignups: signups, competitionScores: scores, competitionCandidates: candidates, cache, config } = app.services;
  const { db } = app.services.storage;
  app.addHook("preHandler", requireAuth);
  const manage = [requirePermission("competition.manage"), requireStepUp];
  const viewRoster = requirePermission("competition.manage");
  const reviewScore = requirePermission("competition.score.review");
  const reviewScoreWrite = [requirePermission("competition.score.review"), requireStepUp];

  app.put<{ Params: { competition_id: string }; Body: SignupSettings }>(
    "/api/console/competitions/:competition_id/signup-settings",
    { preHandler: manage, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const id = req.params.competition_id;
      const before = signups.settingsOf(id);
      const saved = db.transaction(() => {
        const result = signups.updateSettings(id, req.body, req.session!.account_id, Date.now());
        if (result.ok) {
          app.services.activity.recordActivity(req, {
            action: "competition.signup_settings.update", surface: "console", target_type: "competition", target_id: id, outcome: "ok",
            meta: { before: settingsAudit(before), after: settingsAudit(result.value) },
          });
        }
        return result;
      })();
      if (saved.ok) cache.invalidate(publicCachePrefix(id));
      return saved.ok ? reply.send({ settings: saved.value }) : refuse(reply, saved.error);
    },
  );

  app.get<{ Params: { competition_id: string } }>(
    "/api/console/competitions/:competition_id/roster",
    { preHandler: viewRoster },
    async (req, reply) => {
      const result = signups.roster(req.params.competition_id);
      return result.ok ? result.value : refuse(reply, result.error);
    },
  );

  // 移出（#342）：审计只记被移出的账号与对队伍做了什么，不记留言、队名原文。
  app.delete<{ Params: { competition_id: string; account_id: string } }>(
    "/api/console/competitions/:competition_id/signups/:account_id",
    { preHandler: manage, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { competition_id: id, account_id: accountId } = req.params;
      const removed = db.transaction(() => {
        const result = signups.removeSignup(id, accountId, req.session!.account_id, Date.now());
        if (result.ok) {
          app.services.activity.recordActivity(req, {
            action: "competition.signup.remove", surface: "console", target_type: "competition", target_id: id, outcome: "ok",
            meta: { account_id: accountId, team_action: result.value.team_action, unlocked: result.value.unlocked },
          });
        }
        return result;
      })();
      if (removed.ok) cache.invalidate(publicCachePrefix(id));
      return removed.ok ? reply.send(removed.value) : refuse(reply, removed.error);
    },
  );

  // 静态路径排在 roster 之后不影响匹配：Fastify 按段匹配，`roster.csv` 是字面量段。
  app.get<{ Params: { competition_id: string } }>(
    "/api/console/competitions/:competition_id/roster.csv",
    { preHandler: viewRoster, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const id = req.params.competition_id;
      const result = signups.roster(id);
      if (!result.ok) return refuse(reply, result.error);
      const header = [
        "account_id", "login", "status", "note", "looking_for_team", "team_name", "role",
        "created_at_beijing", "updated_at_beijing", "cancelled_at_beijing",
      ];
      const lines = [header.join(","), ...result.value.signups.map(row => [
        row.account_id, row.login, row.status, row.note, row.looking_for_team ? "1" : "0",
        row.team_name ?? "", row.role ?? "",
        beijingDateTime(row.created_at), beijingDateTime(row.updated_at),
        row.cancelled_at === null ? "" : beijingDateTime(row.cancelled_at),
      ].map(csvCell).join(","))];
      app.services.activity.recordActivity(req, { action: "competition.roster.export", surface: "console", target_type: "competition", target_id: id, outcome: "ok", meta: { rows: result.value.signups.length } });
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="competition-${id}-roster-${beijingCompactDate(Date.now())}.csv"`)
        .send(`\ufeff${lines.join("\r\n")}\r\n`);
    },
  );

  app.get<{ Params: { competition_id: string } }>(
    "/api/console/competitions/:competition_id/score-events",
    { preHandler: reviewScore },
    async (req, reply) => {
      const result = scores.list(req.params.competition_id);
      return result.ok ? { events: result.value } : refuse(reply, result.error);
    },
  );

  // 登记前试算：控制台表单选完两档实时显示会记多少分（基础分 × 年级系数 × 防刷折扣），不写库
  app.get<{ Params: { competition_id: string }; Querystring: { account_id: string; kind: ScoreEventInput["kind"]; importance?: Importance; core?: Core; at?: string } }>(
    "/api/console/competitions/:competition_id/score-preview",
    { preHandler: reviewScore },
    async (req, reply) => {
      const { account_id, kind, importance, core, at } = req.query;
      const result = scores.preview(req.params.competition_id, { account_id, kind, importance, core, contributed_at: at ? Number(at) : undefined }, Date.now());
      return result.ok ? result.value : refuse(reply, result.error);
    },
  );

  app.post<{ Params: { competition_id: string }; Body: Omit<ScoreEventInput, "contributed_at"> }>(
    "/api/console/competitions/:competition_id/score-events",
    { preHandler: reviewScoreWrite, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const id = req.params.competition_id;
      const result = db.transaction(() => {
        // 请求体不收 contributed_at：手工登记的贡献时间就是登记时间
        const { account_id, kind, repo, number, importance, core, reason } = req.body;
        const created = scores.add(id, req.session!.account_id, { account_id, kind, repo, number, importance, core, reason }, Date.now());
        if (created.ok) {
          app.services.activity.recordActivity(req, {
            action: "competition.score.add", surface: "console", target_type: "score_event", target_id: created.value.id, outcome: "ok",
            meta: {
              competition_id: id, account_id: created.value.person.account_id, kind: created.value.kind, points: created.value.points,
              importance: created.value.importance, core: created.value.core,
              grade: created.value.grade, grade_factor: created.value.grade_factor, damp_percent: created.value.damp_percent,
              weighted_points: created.value.weighted_points,
            },
          });
        }
        return created;
      })();
      if (result.ok) cache.invalidate(publicCachePrefix(id));
      return result.ok ? reply.code(201).send({ event: result.value }) : refuse(reply, result.error);
    },
  );

  app.post<{ Params: { competition_id: string; event_id: string }; Body: { reason?: string } }>(
    "/api/console/competitions/:competition_id/score-events/:event_id/revoke",
    { preHandler: reviewScoreWrite, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { competition_id: id, event_id: eventId } = req.params;
      const result = db.transaction(() => {
        const revoked = scores.revoke(id, req.session!.account_id, eventId, req.body.reason ?? "", Date.now());
        if (revoked.ok) {
          // 来自 GitLab 候选的那条积分被撤销：候选跟着变成驳回（#278），两边对得上
          candidates.onEventRevoked(eventId, req.session!.account_id, req.body.reason ?? "", Date.now());
          app.services.activity.recordActivity(req, { action: "competition.score.revoke", surface: "console", target_type: "score_event", target_id: eventId, outcome: "ok", meta: { competition_id: id } });
        }
        return revoked;
      })();
      if (result.ok) cache.invalidate(publicCachePrefix(id));
      return result.ok ? { event: result.value } : refuse(reply, result.error);
    },
  );
}
