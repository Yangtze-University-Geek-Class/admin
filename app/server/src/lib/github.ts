import { Octokit } from "@octokit/rest";

export type OrgRole = "admin" | "member" | null;
export type OrgMember = { login: string; id: number; avatar_url: string; role: "admin" | "member" };

/** GitHub 调用一律 15 秒超时：卡住时尽快失败（登录回到原页面、接口报错），而不是挂到 undici 默认的 300 秒。 */
export const GITHUB_TIMEOUT_MS = 15_000;

/** Octokit 当前版本不读 request.timeout，超时只能套在它用的 fetch 上；调用方自己的 signal 照样生效。 */
export function withTimeout(base: typeof fetch, ms: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(ms);
    return base(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
}

export function createGithub(factory: (token: string) => Octokit = token => new Octokit({ auth: token, userAgent: "yzgc-admin", request: { fetch: withTimeout(fetch, GITHUB_TIMEOUT_MS) } })) {
const octokitWith = factory;



async function getOrgRole(token: string, org: string, login: string): Promise<OrgRole> {
  const octokit = octokitWith(token);
  try {
    const res = await octokit.request("GET /orgs/{org}/memberships/{username}", { org, username: login });
    return res.data.state === "active" ? res.data.role as OrgRole : null;
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}

/**
 * 登录用：当前用户自己在组织里的成员状态（用刚换到的 token，需要 read:org）。
 * 不是成员（404）返回 null；已受邀未接受是 "pending"。其它错误（含组织限制 OAuth App 时的 403）原样抛出，
 * 不能当成「不是成员」告诉用户。
 */
async function getOwnMembership(token: string, org: string): Promise<"active" | "pending" | null> {
  const octokit = octokitWith(token);
  try {
    const res = await octokit.request("GET /user/memberships/orgs/{org}", { org });
    return res.data.state === "active" || res.data.state === "pending" ? res.data.state : null;
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** 按用户名查 GitHub 账号（用调用者自己的 token）；不存在返回 null，其它错误原样抛出。 */
async function getUser(token: string, login: string): Promise<{ login: string; id: number } | null> {
  const octokit = octokitWith(token);
  try {
    const res = await octokit.request("GET /users/{username}", { username: login });
    return { login: String(res.data.login), id: Number(res.data.id) };
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** 组织的全部正式成员与角色（用调用者自己的 token）。按角色分两次列，省掉逐个查成员身份；错误原样抛出。 */
async function listOrgMembers(token: string, org: string): Promise<OrgMember[]> {
  const octokit = octokitWith(token);
  const result: OrgMember[] = [];
  for (const role of ["admin", "member"] as const) {
    for (let page = 1; ; page += 1) {
      const res = await octokit.request("GET /orgs/{org}/members", { org, role, per_page: 100, page });
      for (const member of res.data) result.push({ login: String(member.login), id: Number(member.id), avatar_url: String(member.avatar_url ?? ""), role });
      if (res.data.length < 100) break;
    }
  }
  return result;
}

return { octokitWith, getOrgRole, getOwnMembership, getUser, listOrgMembers };
}
