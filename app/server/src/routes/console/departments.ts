import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import { CAPTAIN_ONLY, type Capability } from "../../lib/roles.js";
import type { DepartmentInput, DepartmentPatch } from "../../lib/role-store.js";

const includesCaptainOnly = (...bundles: (Capability[] | undefined)[]) =>
  bundles.some(bundle => bundle?.some(capability => CAPTAIN_ONLY.includes(capability)));

/** 部门是数据：班长在控制台新建、编辑、归档，不改代码。 */
export default async function consoleDepartmentRoutes(app: FastifyInstance) {
  const { roles, config } = app.services;
  const { audit } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  const view = () => {
    const counts = roles.crewCounts();
    return roles.listDepartments().map(department => ({
      ...department, heads: counts.get(department.id)?.heads ?? [], crew_count: counts.get(department.id)?.crew ?? 0,
    }));
  };

  app.get("/api/console/departments", { preHandler: requireCapability("console.access") }, async () => ({ departments: view() }));

  app.post<{ Body: DepartmentInput }>("/api/console/departments", { preHandler: requireCapability("roles.manage") }, async (req, reply) => {
    const body = req.body;
    if (includesCaptainOnly(body.head_capabilities, body.member_capabilities)) {
      return reply.code(400).send({ error: "captain_only_capability", message: "「管理称号与部门」只属于舰长，不能放进部门权限包" });
    }
    if (!roles.insertDepartment(body)) return reply.code(409).send({ error: "department_exists", message: "部门 id 已存在" });
    audit(config.consoleOrg, req.session!.login, "department.create", body.id, { name: body.name }, req.ip);
    return reply.code(201).send({ department: view().find(item => item.id === body.id) });
  });

  app.patch<{ Params: { department_id: string }; Body: DepartmentPatch }>(
    "/api/console/departments/:department_id",
    { preHandler: requireCapability("roles.manage") },
    async (req, reply) => {
      const { department_id: id } = req.params;
      if (includesCaptainOnly(req.body.head_capabilities, req.body.member_capabilities)) {
        return reply.code(400).send({ error: "captain_only_capability", message: "「管理称号与部门」只属于舰长，不能放进部门权限包" });
      }
      const changed = roles.updateDepartment(id, req.body);
      if (changed === null) return reply.code(404).send({ error: "not_found", message: "部门不存在" });
      if (changed.length) audit(config.consoleOrg, req.session!.login, "department.update", id, { changed }, req.ip);
      return { department: view().find(item => item.id === id) };
    },
  );
}
