import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";

/** 校验是否为组织成员 */
export async function requireOrgMember(req: FastifyRequest, reply: FastifyReply) {
  if (!req.session) return reply.code(401).send({ error: "not_signed_in" });
  const { access } = req.server.services;
  const role = await access.orgRole(req.session.login, req.session.accessToken);
  if (!role) {
    return reply.code(403).send({ error: "not_a_member_of_org", message: "只有组织成员可以参与比赛报名与组队" });
  }
}

export default async function portalCompetitionSignupRoutes(app: FastifyInstance) {
  const { competitionSignups } = app.services;

  // 必须登录且是组织成员
  const memberOnly = [requireAuth, requireOrgMember];
  const rateLimit = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

  /** 个人在此比赛的当前报名与组队状态 */
  app.get<{ Params: { id: string } }>(
    "/api/competitions/:id/my-status",
    { preHandler: memberOnly },
    async (req, reply) => {
      const status = competitionSignups.getMyStatus(req.params.id, req.session!.login);
      return { status };
    },
  );

  /** 个人报名 / 登记意向 */
  app.post<{ Params: { id: string }; Body: { note?: string; contact?: string } }>(
    "/api/competitions/:id/signup",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const result = competitionSignups.signup(
        req.params.id,
        { login: req.session!.login, userId: req.session!.user_id },
        req.body ?? {},
        Date.now(),
      );
      if (!result.ok) {
        const code = result.error === "competition_not_found" ? 404 : 400;
        return reply.code(code).send(result);
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
        req.session!.login,
        Date.now(),
      );
      if (!result.ok) {
        return reply.code(400).send(result);
      }
      return reply.send({ ok: true });
    },
  );

  /** 查看某比赛的所有公开队伍列表 */
  app.get<{ Params: { id: string } }>(
    "/api/competitions/:id/teams",
    { preHandler: memberOnly },
    async (req) => {
      const teams = competitionSignups.listTeams(req.params.id);
      return { teams };
    },
  );

  /** 创建参赛队伍 */
  app.post<{ Params: { id: string }; Body: { name: string; slogan?: string; maxMembers?: number } }>(
    "/api/competitions/:id/teams",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const { name, slogan, maxMembers } = req.body ?? {};
      if (!name?.trim()) {
        return reply.code(400).send({ error: "bad_team_name", message: "队伍名称不能为空" });
      }
      const result = competitionSignups.createTeam(
        req.params.id,
        { login: req.session!.login, userId: req.session!.user_id },
        { name, slogan, maxMembers },
        Date.now(),
      );
      if (!result.ok) {
        const code = result.error === "competition_not_found" ? 404 : 400;
        return reply.code(code).send(result);
      }
      return reply.code(201).send(result);
    },
  );

  /** 申请加入队伍 */
  app.post<{ Params: { id: string } }>(
    "/api/teams/:id/apply",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const result = competitionSignups.applyToTeam(
        req.params.id,
        { login: req.session!.login, userId: req.session!.user_id },
        Date.now(),
      );
      if (!result.ok) {
        const code = result.error === "team_not_found" ? 404 : 400;
        return reply.code(code).send(result);
      }
      return reply.code(201).send(result);
    },
  );

  /** 队长邀请队员入队 */
  app.post<{ Params: { id: string }; Body: { login: string; userId?: number } }>(
    "/api/teams/:id/invite",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const { login, userId } = req.body ?? {};
      if (!login?.trim()) {
        return reply.code(400).send({ error: "missing_login", message: "被邀请人登录名不能为空" });
      }
      const result = competitionSignups.inviteToTeam(
        req.params.id,
        req.session!.login,
        { login: login.trim(), userId: userId ?? null },
        Date.now(),
      );
      if (!result.ok) {
        const code = result.error === "team_not_found" ? 404 : result.error === "not_team_leader" ? 403 : 400;
        return reply.code(code).send(result);
      }
      return reply.code(201).send(result);
    },
  );

  /** 响应入队申请或队长邀请（accept / reject） */
  app.post<{ Params: { id: string }; Body: { membership_id: string; action: "accept" | "reject" } }>(
    "/api/teams/:id/respond",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const { membership_id, action } = req.body ?? {};
      if (!membership_id || (action !== "accept" && action !== "reject")) {
        return reply.code(400).send({ error: "bad_request", message: "参数错误" });
      }
      const result = competitionSignups.respondToMembership(
        membership_id,
        req.session!.login,
        action,
        Date.now(),
      );
      if (!result.ok) {
        const code = result.error === "membership_not_found" ? 404 : result.error === "forbidden" ? 403 : 400;
        return reply.code(code).send(result);
      }
      return reply.send(result);
    },
  );

  /** 退出队伍或解散队伍 */
  app.post<{ Params: { id: string } }>(
    "/api/teams/:id/leave",
    { preHandler: memberOnly, ...rateLimit },
    async (req, reply) => {
      const result = competitionSignups.leaveTeam(
        req.params.id,
        req.session!.login,
        Date.now(),
      );
      if (!result.ok) {
        const code = result.error === "team_not_found" ? 404 : 400;
        return reply.code(code).send(result);
      }
      return reply.send(result);
    },
  );
}
