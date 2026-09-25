import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import { titleBundleError, type TitleId } from "../../lib/roles.js";
import type { TitlePatch } from "../../lib/role-store.js";

const BUNDLE_MESSAGES = {
  title_capabilities_fixed: "提督永远拥有全部权限，乘客没有权限，这两个称号的权限不能改",
  captain_only_capability: "「管理称号与部门」只能放进舰长的权限",
} as const;

/** 称号是数据：名字、标签、图标、色调、说明和权限包由提督（与持有 roles.manage 的舰长）在控制台改，不改代码。 */
export default async function consoleTitleRoutes(app: FastifyInstance) {
  const { roles, config } = app.services;
  const { audit } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  app.patch<{ Params: { title_id: TitleId }; Body: TitlePatch }>(
    "/api/console/titles/:title_id",
    { preHandler: requireCapability("roles.manage") },
    async (req, reply) => {
      const id = req.params.title_id;
      if (req.body.capabilities !== undefined) {
        const error = titleBundleError(id, req.body.capabilities);
        if (error) return reply.code(400).send({ error, message: BUNDLE_MESSAGES[error] });
      }
      const changed = roles.updateTitle(id, req.body, req.session!.login);
      if (changed === null) return reply.code(404).send({ error: "not_found", message: "称号不存在" });
      if (changed.length) audit(config.consoleOrg, req.session!.login, "title.update", id, { changed }, req.ip);
      return { title: roles.titleConfigs()[id] };
    },
  );
}
