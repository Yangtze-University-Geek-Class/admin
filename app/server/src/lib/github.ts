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

return { octokitWith, getOrgRole };
}
