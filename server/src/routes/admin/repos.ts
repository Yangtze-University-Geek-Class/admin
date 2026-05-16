import type { FastifyInstance } from "fastify";
import { octokitWith } from "../../lib/github.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireOrgRole } from "../../middleware/require-org-role.js";
import { audit } from "../../lib/db.js";

export default async function reposRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get<{ Params: { org: string } }>("/api/admin/:org/repos", {
    preHandler: requireOrgRole("member"),
  }, async (req) => {
    const { org } = req.params;
    const octokit = octokitWith(req.session!.accessToken);
    const repos = await octokit.paginate("GET /orgs/{org}/repos", { org, per_page: 100, type: "all" });
    return {
      repos: repos.map((r) => ({
        name: r.name,
        full_name: r.full_name,
        visibility: r.visibility,
        default_branch: r.default_branch,
        size_kb: r.size,
        pushed_at: r.pushed_at,
        updated_at: r.updated_at,
        stargazers_count: r.stargazers_count,
        forks_count: r.forks_count,
        open_issues_count: r.open_issues_count,
        archived: r.archived,
        language: r.language,
        topics: r.topics ?? [],
        html_url: r.html_url,
        description: r.description,
      })),
    };
  });

  app.get<{ Params: { org: string; repo: string } }>("/api/admin/:org/repos/:repo", {
    preHandler: requireOrgRole("member"),
  }, async (req) => {
    const { org, repo } = req.params;
    const octokit = octokitWith(req.session!.accessToken);
    const [info, branches, collabs, hooks] = await Promise.all([
      octokit.request("GET /repos/{owner}/{repo}", { owner: org, repo }),
      octokit.paginate("GET /repos/{owner}/{repo}/branches", { owner: org, repo, per_page: 100 }).catch(() => []),
      octokit.paginate("GET /repos/{owner}/{repo}/collaborators", { owner: org, repo, per_page: 100 }).catch(() => []),
      octokit.paginate("GET /repos/{owner}/{repo}/hooks", { owner: org, repo, per_page: 100 }).catch(() => []),
    ]);
    return {
      info: info.data,
      branches: branches.map((b: any) => ({ name: b.name, protected: b.protected })),
      collaborators: collabs.map((c: any) => ({ login: c.login, avatar_url: c.avatar_url, role: c.role_name, permissions: c.permissions })),
      hooks: hooks.map((h: any) => ({ id: h.id, name: h.name, active: h.active, events: h.events, url: h.config?.url })),
    };
  });

  app.get<{ Params: { org: string; repo: string }; Querystring: { ref?: string; path?: string } }>(
    "/api/admin/:org/repos/:repo/tree",
    { preHandler: requireOrgRole("member") },
    async (req) => {
      const { org, repo } = req.params;
      const { ref, path = "" } = req.query;
      const octokit = octokitWith(req.session!.accessToken);
      const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", { owner: org, repo, path, ref });
      const entries = Array.isArray(res.data) ? res.data : [res.data];
      return {
        path,
        entries: entries.map((e: any) => ({
          name: e.name, path: e.path, type: e.type, size: e.size, sha: e.sha,
        })).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1)),
      };
    }
  );

  app.get<{ Params: { org: string; repo: string }; Querystring: { ref?: string; path: string } }>(
    "/api/admin/:org/repos/:repo/file",
    { preHandler: requireOrgRole("member") },
    async (req, reply) => {
      const { org, repo } = req.params;
      const { ref, path } = req.query;
      if (!path) return reply.code(400).send({ error: "missing path" });
      const octokit = octokitWith(req.session!.accessToken);
      const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", { owner: org, repo, path, ref });
      const data: any = res.data;
      if (Array.isArray(data)) return reply.code(400).send({ error: "path is a directory" });
      if (data.size > 1024 * 1024) return { path, name: data.name, size: data.size, too_large: true };
      const content = data.encoding === "base64" ? Buffer.from(data.content, "base64").toString("utf8") : data.content;
      return { path, name: data.name, size: data.size, sha: data.sha, content, html_url: data.html_url, download_url: data.download_url };
    }
  );

  app.get<{ Params: { org: string; repo: string }; Querystring: { sha?: string; path?: string; per_page?: string; page?: string } }>(
    "/api/admin/:org/repos/:repo/commits",
    { preHandler: requireOrgRole("member") },
    async (req) => {
      const { org, repo } = req.params;
      const octokit = octokitWith(req.session!.accessToken);
      const res = await octokit.request("GET /repos/{owner}/{repo}/commits", {
        owner: org, repo,
        sha: req.query.sha,
        path: req.query.path,
        per_page: Math.min(Number(req.query.per_page ?? 30), 100),
        page: Number(req.query.page ?? 1),
      });
      return {
        commits: (res.data as any[]).map((c) => ({
          sha: c.sha,
          short_sha: c.sha.slice(0, 7),
          message: c.commit.message.split("\n")[0],
          message_full: c.commit.message,
          author: c.commit.author,
          committer: c.commit.committer,
          actor: c.author ? { login: c.author.login, avatar_url: c.author.avatar_url } : null,
          html_url: c.html_url,
        })),
      };
    }
  );

  app.get<{ Params: { org: string; repo: string; sha: string } }>(
    "/api/admin/:org/repos/:repo/commits/:sha",
    { preHandler: requireOrgRole("member") },
    async (req) => {
      const { org, repo, sha } = req.params;
      const octokit = octokitWith(req.session!.accessToken);
      const res = await octokit.request("GET /repos/{owner}/{repo}/commits/{ref}", { owner: org, repo, ref: sha });
      const c = res.data as any;
      return {
        sha: c.sha,
        message: c.commit.message,
        author: c.commit.author,
        actor: c.author ? { login: c.author.login, avatar_url: c.author.avatar_url } : null,
        stats: c.stats,
        files: (c.files ?? []).map((f: any) => ({
          filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, changes: f.changes,
          patch: f.patch ? (f.patch.length > 30000 ? f.patch.slice(0, 30000) + "\n... (truncated)" : f.patch) : null,
          previous_filename: f.previous_filename,
        })),
        html_url: c.html_url,
      };
    }
  );

  app.get<{ Params: { org: string; repo: string }; Querystring: { state?: "open" | "closed" | "all"; per_page?: string } }>(
    "/api/admin/:org/repos/:repo/issues",
    { preHandler: requireOrgRole("member") },
    async (req) => {
      const { org, repo } = req.params;
      const octokit = octokitWith(req.session!.accessToken);
      const issues = await octokit.paginate("GET /repos/{owner}/{repo}/issues", {
        owner: org, repo, state: req.query.state ?? "open", per_page: 50,
      });
      return {
        issues: issues.filter((i: any) => !i.pull_request).map((i: any) => ({
          number: i.number, title: i.title, state: i.state, comments: i.comments,
          user: { login: i.user?.login, avatar_url: i.user?.avatar_url },
          labels: (i.labels ?? []).map((l: any) => ({ name: l.name, color: l.color })),
          created_at: i.created_at, updated_at: i.updated_at, html_url: i.html_url,
        })),
      };
    }
  );

  app.get<{ Params: { org: string; repo: string }; Querystring: { state?: "open" | "closed" | "all" } }>(
    "/api/admin/:org/repos/:repo/pulls",
    { preHandler: requireOrgRole("member") },
    async (req) => {
      const { org, repo } = req.params;
      const octokit = octokitWith(req.session!.accessToken);
      const pulls = await octokit.paginate("GET /repos/{owner}/{repo}/pulls", {
        owner: org, repo, state: req.query.state ?? "open", per_page: 50, sort: "updated", direction: "desc",
      });
      return {
        pulls: pulls.map((p: any) => ({
          number: p.number, title: p.title, state: p.state, draft: p.draft,
          user: { login: p.user?.login, avatar_url: p.user?.avatar_url },
          head: p.head?.ref, base: p.base?.ref,
          additions: p.additions, deletions: p.deletions, changed_files: p.changed_files,
          merged: p.merged, mergeable: p.mergeable,
          created_at: p.created_at, updated_at: p.updated_at, html_url: p.html_url,
        })),
      };
    }
  );

  app.post<{ Params: { org: string }; Body: { name: string; description?: string; visibility: "public" | "private" | "internal"; auto_init?: boolean; gitignore_template?: string; license_template?: string } }>(
    "/api/admin/:org/create-repo",
    { preHandler: requireOrgRole("admin") },
    async (req, reply) => {
      const { org } = req.params;
      const { name, description, visibility, auto_init, gitignore_template, license_template } = req.body;
      if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) return reply.code(400).send({ error: "仓库名只能含字母数字 . _ -" });
      const octokit = octokitWith(req.session!.accessToken);
      const res = await octokit.request("POST /orgs/{org}/repos", {
        org, name, description,
        visibility: visibility as any,
        auto_init: auto_init ?? true,
        gitignore_template: gitignore_template || undefined,
        license_template: license_template || undefined,
      });
      audit(org, req.session!.login, "repo.create", name, { visibility }, req.ip);
      return { ok: true, repo: { name: res.data.name, full_name: res.data.full_name, html_url: res.data.html_url } };
    }
  );

  app.delete<{ Params: { org: string; repo: string } }>(
    "/api/admin/:org/repos/:repo",
    { preHandler: requireOrgRole("admin") },
    async (req, reply) => {
      const { org, repo } = req.params;
      const octokit = octokitWith(req.session!.accessToken);
      await octokit.request("DELETE /repos/{owner}/{repo}", { owner: org, repo });
      audit(org, req.session!.login, "repo.delete", repo, undefined, req.ip);
      return { ok: true };
    }
  );

  app.put<{ Params: { org: string; repo: string; login: string }; Body: { permission?: "pull" | "triage" | "push" | "maintain" | "admin" } }>(
    "/api/admin/:org/repos/:repo/collaborators/:login",
    { preHandler: requireOrgRole("admin") },
    async (req, reply) => {
      const { org, repo, login } = req.params;
      const permission = req.body?.permission ?? "push";
      const octokit = octokitWith(req.session!.accessToken);
      await octokit.request("PUT /repos/{owner}/{repo}/collaborators/{username}", { owner: org, repo, username: login, permission });
      audit(org, req.session!.login, "repo.collab.add", `${repo}/${login}`, { permission }, req.ip);
      return { ok: true };
    }
  );

  app.delete<{ Params: { org: string; repo: string; login: string } }>(
    "/api/admin/:org/repos/:repo/collaborators/:login",
    { preHandler: requireOrgRole("admin") },
    async (req) => {
      const { org, repo, login } = req.params;
      const octokit = octokitWith(req.session!.accessToken);
      await octokit.request("DELETE /repos/{owner}/{repo}/collaborators/{username}", { owner: org, repo, username: login });
      audit(org, req.session!.login, "repo.collab.remove", `${repo}/${login}`, undefined, req.ip);
      return { ok: true };
    }
  );
}
