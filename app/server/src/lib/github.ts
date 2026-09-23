import { Octokit } from "@octokit/rest";

export type OrgRole = "admin" | "member" | null;
export function createGithub(factory: (token: string) => Octokit = token => new Octokit({ auth: token, userAgent: "yzgc-admin", request: { timeout: 15000 } })) {
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

return { octokitWith, getOrgRole, getUser };
}
