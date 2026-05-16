# yzgc-admin

| Language | File |
|---|---|
| 中文（默认） | [README.md](./README.md) |
| English | this file |

Yangtze University Geek Class — unified admin dashboard for multiple GitHub organizations.

Live: https://github.yangtzeu.work/

## What it does

- Sign in with GitHub → see all orgs where you're owner / member
- Authorization follows your GitHub org role: org admin sees full features, members get read-only
- Deep repo management: code browsing per branch, commit history with diff, issues, PRs, collaborator CRUD, repo create / delete
- Temporary invite links: admin generates a link (TTL + max uses + optional auto-add to team); recipients hit the link, fill GitHub username, get the invitation
- Org-level settings sync: default repo permission, member can-create / fork / delete-repo / change-visibility toggles, etc.
- Team CRUD
- Member admin: promote / demote / remove
- Activity stream: recent push / PR / issue / release
- Security tab: Dependabot alerts (Pro+), audit log status
- Feedback box: anyone can submit suggestions / bugs to an org; admins triage, reply, set status; floating action button on every page
- Audit log: every admin action + public API event written to SQLite
- 10 themes: GitHub Dark/Dimmed/Light, Gruvbox Dark/Light, Catppuccin Mocha/Latte, Tokyo Night, One Dark Pro, Solarized Dark

## Who uses it

- **Regular users**: visit https://github.yangtzeu.work/ , sign in, see your orgs
- **Org admin**: every admin operation available
- **Org member**: read-only view; admin-only buttons hidden
- **External visitor**: can submit feedback to `<org>` at `/feedback/<org-login>`; can accept invitation at `/join/<token>`

## Quickstart

1. Open https://github.yangtzeu.work/
2. Click "Sign in with GitHub", complete OAuth (first time authorize new scopes)
3. Pick one of your orgs
4. See [docs/USAGE.en.md](./docs/USAGE.en.md) for full usage

## Stack

| Layer | Choice |
|---|---|
| Reverse proxy + HTTPS | nginx + certbot (Let's Encrypt) |
| Backend | Node 20 + Fastify + Octokit + better-sqlite3 |
| Database | SQLite (single file, WAL) |
| Frontend | Vite + React 18 + Tailwind + TanStack Query + React Router |
| Process supervisor | systemd |
| Auth | GitHub OAuth App (admin:org + repo + read:user + read:org + user:email) |
| Anti-abuse | Cloudflare Turnstile (optional) + IP rate limit + client-side PoW + honeypot |

## Local development

```bash
cp .env.example .env
# OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET from a GitHub OAuth App
# SESSION_SECRET=$(openssl rand -base64 32)
# ENCRYPTION_KEY=$(openssl rand -base64 32)
# PUBLIC_ORIGIN=http://localhost:5173
pnpm install
pnpm dev
```

Server runs on `127.0.0.1:3000`, Vite dev server on `5173` (proxies `/api`, `/auth`, `/healthz` to backend).

## Deployment

See [docs/DEPLOY.en.md](./docs/DEPLOY.en.md).

## Docs

- [docs/USAGE.en.md](./docs/USAGE.en.md) — user guide (admin / member / external visitor)
- [docs/DEPLOY.en.md](./docs/DEPLOY.en.md) — install + ops
- [docs/ARCHITECTURE.en.md](./docs/ARCHITECTURE.en.md) — routes / DB / OAuth / encryption / front-end
- [docs/SECURITY.en.md](./docs/SECURITY.en.md) — threat model + protection layers

## License

Private. For internal use of the `Yangtze-University-Geek-Class` GitHub organization.
