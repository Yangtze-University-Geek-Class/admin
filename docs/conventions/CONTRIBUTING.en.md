# Contributing

> The entry point for contributing. Read [AGENTS.md](../../AGENTS.md) §0 before touching code — it requires stopping to consult the relevant document in `docs/`.
> 中文：[CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 0. What this project is

`yzgc-admin` — the online system of the Yangtze University Geek Class (YUGC). **One codebase renders three sites:**

| Site | Live URL | Audience |
|---|---|---|
| Portal | https://yangtzeu.work | Anyone, anonymous |
| Forum | https://yangtzeu.work/forum | Registered users |
| Admin | https://github.yangtzeu.work | Members with GitHub org permissions |

All three share one frontend artefact and one backend process. Site boundaries, directory ownership, and the split plan are in [WEB-SPLIT.md](../plan/WEB-SPLIT.md).

---

## 1. Getting started

```bash
# Requires Node 20+ and pnpm 9
git clone git@github.com:Yangtze-University-Geek-Class/admin.git
cd admin
pnpm install --frozen-lockfile

cp .env.example .env
# Fill OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET etc. — see the comments in .env.example
# SESSION_SECRET=$(openssl rand -base64 32)
# ENCRYPTION_KEY=$(openssl rand -base64 32)

pnpm dev            # server :3000 + vite :5173
```

Frontend only, without a backend:

```bash
pnpm --filter @yzgc/web dev
```

Development mode serves local mock data by default (`web/src/lib/mock-api.ts`) and every page is browsable. Switch data sources via the `DEV CONTROL` panel on the page or the `?__data=live` URL parameter.

**Note**: the mock layer matches by suffix regex (`/overview$`, `/members$`) rather than a path prefix. Changing any API path requires updating the mock in lockstep, or development mode silently returns wrong data.

---

## 2. The full flow for changing code

```
0. Read the docs      AGENTS.md §0's table → open the matching docs/*.md
1. Branch             cut feat/xxx or fix/xxx from main (or next)
2. Code + docs        same commit; the mapping is in AGENTS.md §4.7
3. Verify locally     type check / build / actually exercise the page
4. Commit             type(scope): Chinese subject — see COMMITS.md
5. Open a PR          gh pr create — see PULL-REQUESTS.md
6. Review             against the checklist in PULL-REQUESTS.md §4
7. Merge              performed by a human, never auto-merged by an agent
8. Deploy             see §5
```

Step 0 is not optional. This repo has accumulated defects precisely because it was skipped — a dead link, a missing sanitizer, a mock that never matched its page. All of them are catalogued in [REFACTOR.md](../plan/REFACTOR.md) §8.

---

## 3. The conventions

| Convention | Document | Governs |
|---|---|---|
| Commits | [COMMITS.md](./COMMITS.md) | Commit type / scope / body |
| Issues | [ISSUES.md](./ISSUES.md) | How to file defects and requests, labels, closing |
| Pull requests | [PULL-REQUESTS.md](./PULL-REQUESTS.md) | Branch model, PR description, review checklist, merge |
| Pages | [DESIGN.md](../design/DESIGN.md) | Visual and interaction spec: accessibility, design systems, component conventions |
| Stack | [STACK.md](../design/STACK.md) | Target frameworks and versions for the refactor, plus per-framework usage notes |

---

## 4. Hard constraints (violations get rejected)

These are the invariants from `AGENTS.md` §4, summarised:

1. **Tailwind colors must go through CSS variables** — hardcoded hex anywhere in `web/src/**` is forbidden.
2. **No native `<select>` and no `window.confirm()`** — use `Select` and `useConfirm()` from `shared`.
3. **Backend admin routes** need both `requireAuth` and `requireOrgRole(...)`, and mutations must call `audit(...)`.
4. **GitHub calls always use the signed-in user's own token** (`req.session.accessToken`); service tokens serve only the public invite-link flow.
5. **SQLite schema is additive only**: `ALTER TABLE ADD COLUMN` is allowed, drop and reorder are not.
6. **Code changes must update the docs** (the full mapping is in `AGENTS.md` §4.7).
7. **Cross-site navigation goes through `externalUrl()`** — never write a same-site `Link` in site A pointing at a route that only exists in site B.

---

## 5. Deploy

**Agents must not deploy.** Deployment is performed by a human.

```bash
ssh root@103.117.123.226 -p 22000
cd /opt/yzgc-admin
cp -a web/dist web/dist.bak-$(date +%Y%m%dT%H%M%S)   # back up first
git fetch origin main && git merge --ff-only origin/main
pnpm --filter @yzgc/web build
systemctl restart yzgc-admin
```

Rollback:

```bash
rm -rf web/dist && mv web/dist.bak-<timestamp> web/dist
git reset --hard <previous commit>
systemctl restart yzgc-admin
```

The full runbook (nginx, certbot, troubleshooting table) is in [DEPLOY.md](../ops/DEPLOY.md).

---

## 6. Environment and access

| Resource | Location |
|---|---|
| Production server | `103.117.123.226:22000` (root) |
| Application directory | `/opt/yzgc-admin` |
| Databases | `/opt/yzgc-admin/data/{data,forum}.db` (WAL) |
| Environment file | `/opt/yzgc-admin/.env` (chmod 600) |
| systemd unit | `yzgc-admin.service` |
| Logs | `/var/log/yzgc-admin.log`, `journalctl -u yzgc-admin` |

**Credentials never enter Git.** Only variable names and purposes are recorded (`.env.example`). Keys, tokens, and passwords go into no source file, document, log, or reply.

---

## 7. Communication

- Chinese in chat, conclusion first.
- No "here's what I'm about to do" preambles — act, then report the result.
- No time estimates.
- No emoji (chat, docs, commits, UI copy).
- When reporting: **what changed, what was verified, what was not verified**.

The full preferences are in `AGENTS.md` §8.

---

## 8. When something is ambiguous

- **Discoverable from code, docs, or history**: look it up yourself, do not ask.
- **A decision affecting behaviour, interfaces, dependencies, data, or security**: present the evidence and a recommendation, get sign-off, and meanwhile continue with whatever does not depend on it.
- **Docs disagree with code**: the code wins, but fix the doc in the same change rather than silently working around it.
- **Unsure whether something is a duplicate issue**: file it and note the possible relation (see [ISSUES.md](./ISSUES.md) §0).
