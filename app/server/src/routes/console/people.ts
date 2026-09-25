import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireCapability } from "../../middleware/require-capability.js";
import { computeAccess, titleRank, type AssignmentRow, type OrgRole, type TitleView } from "../../lib/roles.js";

type Person = { login: string; user_id: number | null; avatar_url: string | null; github_role: OrgRole; titles: TitleView[] };

/** 与 role-store 的 assignmentsFor 同一个匹配规则：有数字 id 按 id（应对改名），没有才按用户名。 */
const belongsTo = (row: AssignmentRow, login: string, userId: number | null) =>
  row.github_user_id !== null ? row.github_user_id === userId : row.github_login === login.toLowerCase();

/**
 * 成员全名单：GitHub 组织里的每个人，加上有称号但已经不在组织里的人（例如退出组织的领航员）。
 * 每个人的称号按 computeAccess 算，和本人登录后看到的一致：组织 owner 是提督，没有指派的成员默认是舰员。
 */
export default async function consolePeopleRoutes(app: FastifyInstance) {
  const { roles, config, github } = app.services;
  app.addHook("preHandler", requireAuth);

  app.get("/api/console/people", { preHandler: requireCapability("roles.manage", "roles.department.manage") }, async (req) => {
    const members = await github.listOrgMembers(req.session!.accessToken, config.consoleOrg);
    const departments = roles.listDepartments();
    const titles = roles.titleConfigs();
    const assignments = roles.listAssignments();
    const claimed = new Set<number>();
    const person = (login: string, userId: number | null, avatarUrl: string | null, orgRole: OrgRole): Person => {
      const rows = assignments.filter(row => belongsTo(row, login, userId));
      for (const row of rows) claimed.add(row.id);
      return { login, user_id: userId, avatar_url: avatarUrl, github_role: orgRole, titles: computeAccess({ login, orgRole, assignments: rows, departments, titles }).titles };
    };

    const people = members.map(member => person(member.login, member.id, member.avatar_url || null, member.role));
    for (const row of assignments) {
      if (claimed.has(row.id)) continue;
      people.push(person(row.github_login, row.github_user_id, null, null));
    }
    people.sort((a, b) => titleRank(a.titles[0]) - titleRank(b.titles[0]) || a.login.localeCompare(b.login));
    return { people };
  });
}
