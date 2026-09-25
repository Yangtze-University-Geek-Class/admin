import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import { titleBundleError, type TitleId } from "../../lib/roles.js";
import type { TitlePatch } from "../../lib/role-store.js";

/**
 * 称号是数据：名字、标签、图标、色调、说明和权限包由提督（与持有 roles.manage 的舰长）在控制台改，不改代码。
 * 最高的两级（admin、captain）只有 admin 本人能改：否则持有 roles.manage 的舰长能把自己的权限包改宽，提督就管不住舰长。
 * 提示里的称号名字取当前库里的名字，改名后跟着变。
 */
export default async function consoleTitleRoutes(app: FastifyInstance) {
  const { roles, config } = app.services;
  const { audit } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  app.patch<{ Params: { title_id: TitleId }; Body: TitlePatch }>(
    "/api/console/titles/:title_id",
    { preHandler: requireCapability("roles.manage") },
    async (req, reply) => {
      const id = req.params.title_id;
      const names = roles.titleConfigs();
      if ((id === "admin" || id === "captain") && !req.access!.titles.some(title => title.id === "admin")) {
        return reply.code(403).send({ error: "admiral_required", message: `只有${names.admin.label}能修改「${names.admin.label}」和「${names.captain.label}」这两个称号` });
      }
      if (req.body.capabilities !== undefined) {
        const error = titleBundleError(id, req.body.capabilities);
        if (error) {
          const message = error === "title_capabilities_fixed"
            ? `${names.admin.label}永远拥有全部权限，${names.guest.label}没有权限，这两个称号的权限不能改`
            : `「管理称号与部门」只能放进${names.captain.label}的权限`;
          return reply.code(400).send({ error, message });
        }
      }
      const changed = roles.updateTitle(id, req.body, req.session!.login);
      if (changed === null) return reply.code(404).send({ error: "not_found", message: "称号不存在" });
      if (changed.length) audit(config.consoleOrg, req.session!.login, "title.update", id, { changed }, req.ip);
      return { title: roles.titleConfigs()[id] };
    },
  );
}
