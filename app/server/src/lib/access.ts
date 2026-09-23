import { computeAccess, type Access, type OrgRole } from "./roles.js";
import type { RoleStore } from "./role-store.js";

export type AccessDeps = {
  consoleOrg: string;
  getOrgRole: (token: string, org: string, login: string) => Promise<OrgRole>;
  cached: <T>(key: string, ttlMs: number, fn: () => Promise<T>) => Promise<T>;
  roles: RoleStore;
};
export type ResolveInput = { login: string; userId: number | null; accessToken: string };

/** GitHub 组织角色缓存 60 秒；撤销组织管理员最长 60 秒后生效。错误不缓存（由 cache 保证）。 */
export const ORG_ROLE_TTL_MS = 60_000;

/**
 * 身份解析：只接受普通参数，不接触 Fastify 请求。GitHub 调用失败直接抛出，
 * 由 http-policy 统一映射，绝不把失败当成「不是组织成员」。
 */
export function createAccess({ consoleOrg, getOrgRole, cached, roles }: AccessDeps) {
  async function orgRole(login: string, accessToken: string): Promise<OrgRole> {
    return cached(`console:orgrole:${login.toLowerCase()}`, ORG_ROLE_TTL_MS, () => getOrgRole(accessToken, consoleOrg, login));
  }
  async function resolve({ login, userId, accessToken }: ResolveInput): Promise<Access> {
    const githubRole = await orgRole(login, accessToken);
    return computeAccess({
      login, orgRole: githubRole,
      assignments: roles.assignmentsFor(login, userId),
      departments: roles.listDepartments(),
      captainExists: roles.captainExists(),
    });
  }
  return { consoleOrg, resolve, orgRole };
}
export type AccessService = ReturnType<typeof createAccess>;
