import { body, choices, integer, nullableText, text, type RouteContracts } from "../../lib/http-contracts.js";
const bool = { type: "boolean" };
const organization: Record<string, unknown> = Object.fromEntries([
  "name", "description", "company", "email", "location", "blog", "twitter_username", "billing_email",
].map(key => [key, text(1000)]));
organization.default_repository_permission = choices("none", "read", "write", "admin");
for (const name of ["create_repositories", "create_public_repositories", "create_private_repositories", "create_internal_repositories", "fork_private_repositories", "create_pages", "create_public_pages", "create_private_pages", "invite_outside_collaborators", "delete_repositories", "change_repo_visibility", "delete_issues"]) organization[`members_can_${name}`] = bool;
export const adminContracts: RouteContracts = {
  "POST /api/admin/:org/invite-links": body({ hours: { type: "number", minimum: 1, maximum: 8760 }, max_uses: integer(1, 1000), note: text(280), team_slug: nullableText(100) }, ["hours", "max_uses"]),
  "PATCH /api/admin/:org/invite-links/:token": body({ disabled: bool }, ["disabled"]),
  "PATCH /api/admin/:org/members/:login/role": body({ role: choices("admin", "member") }, ["role"]),
  "POST /api/admin/:org/create-repo": body({ name: text(100, 1), description: text(1000), visibility: choices("public", "private", "internal"), auto_init: bool, gitignore_template: text(100), license_template: text(100) }, ["name", "visibility"]),
  "PUT /api/admin/:org/repos/:repo/pulls/:n/merge": body({ merge_method: choices("merge", "squash", "rebase"), commit_title: text(256), commit_message: text(10000), sha: { type: "string", pattern: "^[a-f0-9]{40}$" } }),
  "PATCH /api/admin/:org/repos/:repo/issues/:n": body({ state: choices("open", "closed") }, ["state"]),
  "POST /api/admin/:org/repos/:repo/issues/:n/comments": body({ body: text(65536, 1) }, ["body"]),
  "PUT /api/admin/:org/repos/:repo/collaborators/:login": body({ permission: choices("pull", "triage", "push", "maintain", "admin") }),
  "POST /api/admin/:org/teams": body({ name: text(100, 1), description: text(1000), privacy: choices("secret", "closed") }, ["name"]),
  "PATCH /api/admin/:org/org": body(organization),
  "PATCH /api/admin/:org/feedback/:id": body({ status: choices("open", "triaged", "in_progress", "done", "wont_do", "spam"), reply: text(5000) }),
};
