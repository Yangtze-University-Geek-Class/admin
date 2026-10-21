import type { FastifyInstance } from "fastify";
import { toPublicCompetition } from "../../lib/competition-store.js";
import { DEFAULT_SIGNUP_SETTINGS } from "../../lib/competition-signup-store.js";

/**
 * 公开的比赛接口：官网桌面「比赛」应用与比赛官网 SDK 读它。不含任何成员信息，也不含内部字段（`offline`/创建时间）。
 * 每场带报名摘要（是否开放、个人或团队、人数、积分），不含报名人数；只返回未下线的比赛。
 * 单场接口只在成功响应上放开跨域（只读、不带 cookie），比赛官网在别的域名上据此显示状态卡片。
 */
export default async function portalCompetitionRoutes(app: FastifyInstance) {
  const { competitions, competitionSignups } = app.services;

  app.get("/api/public/competitions", async () => {
    const now = Date.now();
    const summaries = competitionSignups.signupSummaries();
    return {
      competitions: competitions.listPublic(now).map(record => ({
        ...toPublicCompetition(record, now),
        signup: summaries.get(record.id) ?? DEFAULT_SIGNUP_SETTINGS,
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/public/competitions/:id", async (req, reply) => {
    const now = Date.now();
    const record = competitions.get(req.params.id);
    // 下线与不存在同一副面孔：记录保留，官网整场隐藏。
    if (!record || record.offline) return reply.code(404).send({ error: "not_found", message: "比赛不存在或已下线" });
    return reply
      .header("Access-Control-Allow-Origin", "*")
      .send({ ...toPublicCompetition(record, now), signup: competitionSignups.settingsOf(record.id) });
  });
}
