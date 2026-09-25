import type { FastifyInstance, FastifyReply } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { missingCapability, requireCapability } from "../../middleware/require-capability.js";
import type { Access, AssignableRole, AssignmentRow } from "../../lib/roles.js";

type AssignBody = { github_login: string; role: AssignableRole; department_id?: string; note?: string };
type ListQuery = { department_id?: string; role?: AssignableRole };

const isEffectiveCaptain = (access: Access) => access.titles.some(title => title.id === "captain");
const outOfScope = (reply: FastifyReply) =>
  reply.code(403).send({ error: "out_of_department_scope", message: "只能任免自己负责部门的舰员" });

/**
 * 称号指派。班长（roles.manage）可以指派任何称号；部门负责人（roles.department.manage）
 * 只能任免自己负责部门的干事。指派班长只能由当前有效的班长发起，已有班长时在事务里移交。
 */
export default async function consoleAssignmentRoutes(app: FastifyInstance) {
  const { roles, config, github } = app.services;
  const { audit } = app.services.storage;
  app.addHook("preHandler", requireAuth);

  /** 负责人能否管这条（或这类）干事指派。 */
  const inScope = (access: Access, row: Pick<AssignmentRow, "role" | "department_id">) =>
    access.capabilities.has("roles.manage") || (row.role === "member" && row.department_id !== "" && access.headOf.includes(row.department_id));

  app.get<{ Querystring: ListQuery }>(
    "/api/console/assignments",
    { preHandler: requireCapability("roles.manage", "roles.department.manage") },
    async (req, reply) => {
      const access = req.access!;
      const { department_id, role } = req.query;
      let assignments: AssignmentRow[];
      if (access.capabilities.has("roles.manage")) {
        assignments = roles.listAssignments({ role, department_id });
      } else {
        if (department_id !== undefined && !access.headOf.includes(department_id)) return outOfScope(reply);
        assignments = roles.listAssignments({ role, departments: department_id ? [department_id] : access.headOf });
      }
      const captain = roles.captain();
      return { assignments, captain: captain ? { github_login: captain.github_login } : null, bootstrap_active: captain === null };
    },
  );

  app.post<{ Body: AssignBody }>(
    "/api/console/assignments",
    { preHandler: requireCapability("roles.manage", "roles.department.manage"), config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const access = req.access!;
      const { role } = req.body;
      const departmentId = req.body.department_id ?? "";
      const note = req.body.note?.trim() || null;
      const login = req.body.github_login.toLowerCase();

      if (role === "head" && !departmentId) return reply.code(400).send({ error: "department_required", message: "队长必须指定部门" });
      if ((role === "captain" || role === "alumni") && departmentId) {
        return reply.code(400).send({ error: "department_not_allowed", message: "舰长和领航员不属于任何部门" });
      }
      if (departmentId) {
        const department = roles.getDepartment(departmentId);
        if (!department || department.archived) return reply.code(400).send({ error: "unknown_department", message: "部门不存在或已归档" });
      }
      if (role === "captain") {
        if (!isEffectiveCaptain(access)) return reply.code(403).send({ error: "captain_required", message: "只有现任舰长可以指定或移交舰长" });
      } else if (!access.capabilities.has("roles.manage")) {
        if (role !== "member") return reply.code(403).send(missingCapability(access, ["roles.manage"]));
        if (!inScope(access, { role, department_id: departmentId })) return outOfScope(reply);
      }
      if (roles.findAssignment(login, role, departmentId)) return reply.code(409).send({ error: "assignment_exists", message: "该用户已有这个称号" });

      // 用调用者自己的 token 查 GitHub 账号，记录数字 id 以应对改名；绝不借用他人 token。
      const user = await github.getUser(req.session!.accessToken, login);
      if (!user) return reply.code(400).send({ error: "github_user_not_found", message: "GitHub 上找不到这个用户名" });
      const input = { github_login: user.login, github_user_id: user.id, note, granted_by: req.session!.login };
      const actor = req.session!.login;

      if (role === "captain") {
        const { previous, assignment } = roles.transferCaptain(input);
        if (previous) audit(config.consoleOrg, actor, "role.captain.transfer", assignment.github_login, { from: previous.github_login, to: assignment.github_login }, req.ip);
        else audit(config.consoleOrg, actor, "role.assign", assignment.github_login, { role, department_id: "", note_length: note?.length ?? 0 }, req.ip);
        return reply.code(201).send({ assignment });
      }
      const assignment = roles.insertAssignment({ ...input, role, department_id: departmentId });
      if (!assignment) return reply.code(409).send({ error: "assignment_exists", message: "该用户已有这个称号" });
      audit(config.consoleOrg, actor, "role.assign", assignment.github_login, { role, department_id: departmentId, note_length: note?.length ?? 0 }, req.ip);
      return reply.code(201).send({ assignment });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/console/assignments/:id",
    { preHandler: requireCapability("roles.manage", "roles.department.manage") },
    async (req, reply) => {
      const access = req.access!;
      const row = roles.getAssignment(Number(req.params.id));
      if (!row) return reply.code(404).send({ error: "not_found", message: "指派不存在" });
      if (row.role === "captain") {
        const isSelf = access.titles.some(title => title.id === "captain" && title.assignment_id === row.id);
        if (!isSelf) return reply.code(409).send({ error: "captain_transfer_required", message: "舰长只能由本人卸任，或由本人移交给下一任" });
      } else if (!inScope(access, row)) {
        return access.capabilities.has("roles.department.manage") && row.role === "member"
          ? outOfScope(reply)
          : reply.code(403).send(missingCapability(access, ["roles.manage"]));
      }
      roles.deleteAssignment(row.id);
      audit(config.consoleOrg, req.session!.login, "role.revoke", row.github_login, { role: row.role, department_id: row.department_id }, req.ip);
      return { ok: true };
    },
  );
}
