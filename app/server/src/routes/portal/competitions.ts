import type { FastifyInstance } from "fastify";
import { toPublicCompetition } from "../../lib/competition-store.js";

/**
 * 公开的比赛列表：官网桌面「比赛」应用读它。不含任何成员信息，也不含内部字段（`offline`/创建时间）。
 * 只返回未下线的；「报名中 / 进行中 / 已结束」由服务端按当前时间算好，前端不各算一份。
 */
export default async function portalCompetitionRoutes(app: FastifyInstance) {
  const { competitions } = app.services;
  app.get("/api/public/competitions", {
    schema: { response: { 200: { type: "object", additionalProperties: true } } },
  }, async () => {
    const now = Date.now();
    return { competitions: competitions.listPublic(now).map(record => toPublicCompetition(record, now)) };
  });
}
