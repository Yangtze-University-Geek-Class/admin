import { Octokit } from "@octokit/rest";

export function octokitWith(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: "yzgc-admin" });
}

export type OrgRole = "admin" | "member" | null;

export async function getOrgRole(token: string, org: string, login: string): Promise<OrgRole> {
  const octokit = octokitWith(token);
  try {
    const res = await octokit.request("GET /orgs/{org}/memberships/{username}", { org, username: login });
    return res.data.role as OrgRole;
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}
