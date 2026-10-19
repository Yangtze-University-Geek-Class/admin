import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";

/** 校验是否为组织成员 */
export async function requireOrgMember(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session) return reply.code(401).send({ error: "not_signed_in" });
  const { access } = req.server.services;
  const role = await access.orgRole(req.session.login, req.session.accessToken);
  if (!role) {
    return reply.code(403).send({ error: "not_member", message: "只有组织成员可以参与比赛报名与组队" });
  }
}

function mapErrorCode(error: string): number {
  if (error === "not_found" || error === "team_not_found" || error === "target_not_in_team") return 404;
  if (error === "not_team_leader" || error === "forbidden" || error === "not_member") return 403;
  if (
    error.startsWith("bad_") ||
    error.startsWith("missing_")
  ) {
    return 400;
  }
  return 409;
}

export default async function portalCompetitionSignupRoutes(app: FastifyInstance) {
  const { competitions, competitionSignups } = app.services;

  // 必须登录且是组织成员
  const memberOnly = [requireAuth, requireOrgMember];
  const rateLimit = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

  function currentAccountId(req: FastifyRequest): string {
    return (req.session as any)?.account_id ?? req.session!.login;
  }

  /** 获取我的所有报名与待处理事项（用于「我的参赛」与角标） */
  app.get(
    "/api/me/competitions",
    { preHandler: memberOnly },
    async (req) => {
      return competitionSignups.getMyCompetitions(currentAccountId(req), Date.now());
    },
  );

  /** 个人在此比赛的当前报名与组队状态 */
  app.get<{ Params: { id: string } }>(
    "/api/competitions/:id/my-status",
    { preHandler: memberOnly },
    async (req, reply) => {
      const comp = competitions.get(req.params.id);
      if (!comp || comp.offline) {
        return reply.code(404).send({ error: "not_found", message: "比赛不存在或已下线" });
      }
      const status = competitionSignups.getMyStatus(req.params.id, currentAccountId(req), Date.now());
      return { status };
    },
  );

  /** 个人报名 / 登记意向 */
  app.post<{ Params: { id: string }; Body: { note?: string; looking_for_team?: boolean } }>(
    "/api/competitions/:id/signup",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const result = competitionSignups.signup(
        req.params.id,
        currentAccountId(req),
        req.body ?? {},
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(mapErrorCode(result.error)).send(result);
      }
      return reply.code(201).send(result);
    },
  );

  /** 取消报名 / 取消意向 */
  app.delete<{ Params: { id: string } }>(
    "/api/competitions/:id/signup",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const result = competitionSignups.cancelSignup(
        req.params.id,
        currentAccountId(req),
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(mapErrorCode(result.error)).send(result);
      }
      return reply.send({ ok: true });
    },
  );

  /** 查看某比赛的所有公开队伍列表 */
  app.get<{ Params: { id: string } }>(
    "/api/competitions/:id/teams",
    { preHandler: memberOnly },
    async (req, reply) => {
      const comp = competitions.get(req.params.id);
      if (!comp || comp.offline) {
        return reply.code(404).send({ error: "not_found", message: "比赛不存在或已下线" });
      }
      const teams = competitionSignups.listTeams(req.params.id, currentAccountId(req));
      return { teams };
    },
  );

  /** 查看找队友列表 */
  app.get<{ Params: { id: string } }>(
    "/api/competitions/:id/free-agents",
    { preHandler: memberOnly },
    async (req, reply) => {
      const comp = competitions.get(req.params.id);
      if (!comp || comp.offline) {
        return reply.code(404).send({ error: "not_found", message: "比赛不存在或已下线" });
      }
      const free_agents = competitionSignups.getFreeAgents(req.params.id);
      return { free_agents };
    },
  );

  /** 创建参赛队伍 */
  app.post<{ Params: { id: string }; Body: { name: string; slogan?: string } }>(
    "/api/competitions/:id/teams",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const { name, slogan } = req.body ?? {};
      const result = competitionSignups.createTeam(
        req.params.id,
        currentAccountId(req),
        { name, slogan },
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(mapErrorCode(result.error)).send(result);
      }
      return reply.code(201).send(result);
    },
  );

  /** 申请加入队伍 */
  app.post<{ Params: { id: string }; Body?: { message?: string } }>(
    "/api/teams/:id/apply",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const result = competitionSignups.applyToTeam(
        req.params.id,
        currentAccountId(req),
        req.body ?? {},
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(mapErrorCode(result.error)).send(result);
      }
      return reply.code(201).send(result);
    },
  );

  /** 队长邀请队员入队 */
  app.post<{ Params: { id: string }; Body: { account_id: string; message?: string } }>(
    "/api/teams/:id/invite",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const { account_id, message } = req.body ?? {};
      if (!account_id?.trim()) {
        return reply.code(400).send({ error: "missing_account_id", message: "被邀请人账号不能为空" });
      }
      const result = competitionSignups.inviteToTeam(
        req.params.id,
        currentAccountId(req),
        { account_id, message },
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(mapErrorCode(result.error)).send(result);
      }
      return reply.code(201).send(result);
    },
  );

  /** 响应入队申请或队长邀请（accept / decline / withdraw） */
  app.post<{ Params: { id: string }; Body: { membership_id: string; action: "accept" | "decline" | "withdraw" } }>(
    "/api/teams/:id/respond",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const { membership_id, action } = req.body ?? {};
      const result = competitionSignups.respondToMembership(
        req.params.id,
        membership_id,
        currentAccountId(req),
        action,
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(mapErrorCode(result.error)).send(result);
      }
      return reply.send(result);
    },
  );

  /** 退出队伍 */
  app.post<{ Params: { id: string } }>(
    "/api/teams/:id/leave",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const result = competitionSignups.leaveTeam(
        req.params.id,
        currentAccountId(req),
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(mapErrorCode(result.error)).send(result);
      }
      return reply.send(result);
    },
  );

  /** 队长转让队伍 */
  app.post<{ Params: { id: string }; Body: { account_id: string } }>(
    "/api/teams/:id/transfer",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const { account_id } = req.body ?? {};
      const result = competitionSignups.transferTeam(
        req.params.id,
        currentAccountId(req),
        account_id,
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(mapErrorCode(result.error)).send(result);
      }
      return reply.send(result);
    },
  );

  /** 队长解散队伍 */
  app.delete<{ Params: { id: string } }>(
    "/api/teams/:id",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const result = competitionSignups.disbandTeam(
        req.params.id,
        currentAccountId(req),
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(mapErrorCode(result.error)).send(result);
      }
      return reply.send(result);
    },
  );

  /** 队长确认锁定参赛队伍 */
  app.post<{ Params: { id: string } }>(
    "/api/teams/:id/lock",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const result = competitionSignups.lockTeam(
        req.params.id,
        currentAccountId(req),
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(mapErrorCode(result.error)).send(result);
      }
      return reply.send(result);
    },
  );

  /** 队长撤销确认参赛锁定 */
  app.delete<{ Params: { id: string } }>(
    "/api/teams/:id/lock",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const result = competitionSignups.unlockTeam(
        req.params.id,
        currentAccountId(req),
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(mapErrorCode(result.error)).send(result);
      }
      return reply.send(result);
    },
  );
}
