# AGENTS.md

Single source of truth for AI coding agents. All CLI-specific files (CLAUDE.md / GEMINI.md / .cursorrules / .github/copilot-instructions.md / .windsurfrules / .clinerules / CONVENTIONS.md) point here.

The project owner uses Chinese in chat. Code, identifiers, commit messages: English. UI strings: Chinese. Human-facing docs are bilingual (see `docs/*.md` and `docs/*.en.md`). This file is agent-only and stays English.

---

## 0. STOP — read the docs before you change anything

**This is the first rule and it overrides eagerness to edit.** `docs/` is this project's accumulated knowledge base. Before writing or modifying code:

1. **Stop.** Do not open an editor, do not plan a refactor, do not write a patch.
2. **Classify the change.** What is actually being asked — which site, which layer, which contract?
3. **Read the matching doc(s)** from the table below. Read the whole relevant section, not just a grep hit.
4. **Only then** design and implement.

Skipping step 3 is how this repo accumulated the defects catalogued in `docs/plan/REFACTOR.md` §8 — a dead cross-site link, a missing sanitizer, a mock fixture that never matched its page. Every one of those was a change made without reading the doc that already described the constraint.

### Change type → required reading

| If the change touches… | Read first |
|---|---|
| Anything UI: pages, components, interaction, states, copy | `docs/design/DESIGN.md` |
| Dependencies, framework versions, build config, bundle output | `docs/design/STACK.md` |
| Frontend directory layout, site boundaries, shared vs site code | `docs/plan/WEB-SPLIT.md` |
| Which pages exist, which APIs each page calls, what is shared between sites | `docs/plan/REFACTOR.md` |
| A backend route, DB schema/column, OAuth flow, at-rest encryption, abuse controls | `docs/architecture/ARCHITECTURE.md` |
| Threat model, rate limits, Turnstile, PoW, what may not be exposed | `docs/architecture/SECURITY.md` |
| Env vars, nginx, systemd, certbot, server-side runbook | `docs/ops/DEPLOY.md` |
| Anything a user can see or do | `docs/ops/USAGE.md` |
| Commit message wording or type/scope choice | `docs/conventions/COMMITS.md` |
| Filing, labelling, or closing an issue | `docs/conventions/ISSUES.md` |
| Opening, describing, or merging a pull request | `docs/conventions/PULL-REQUESTS.md` |
| Onboarding, branch/deploy flow, hard constraints | `docs/conventions/CONTRIBUTING.md` |

Cross-cutting changes require **all** applicable docs. `docs/README.md` is the human entry point ("what to read for what"); `docs/INDEX.md` is the generated catalogue of every document.

### Rules

- **A change that contradicts a doc is a decision, not an implementation detail.** Do not silently diverge. Either the doc is stale (update it in the same commit) or the change is wrong (stop and surface it).
- **Update docs in the same commit** as the code change — see §4.7 for the enforced mapping.
- **If the docs do not cover the area**, say so explicitly rather than inventing a convention, and add the missing doc as part of the work.
- **Do not read `docs/*.en.md` and the Chinese file both** — they are translations. Read the Chinese one unless the task is specifically about the English text.
- **Adding, moving, renaming, or retitling a doc requires regenerating `docs/INDEX.md`**: `node scripts/docs-index.mjs`. Verify with `node scripts/docs-index.mjs --check` (exits 1 when stale). Fix relative links when moving files; cross-folder references use `../<folder>/<file>.md`.
- Docs marked as plans (`docs/plan/WEB-SPLIT.md` execution section) and inventories (`docs/plan/REFACTOR.md`) have a shelf life. If a doc contradicts the code, the code wins — but fix the doc.

---

## 1. 这是什么

`yzgc-admin` — 给 GitHub 组织管理员用的多组织统一后台。

线上：https://github.yangtzeu.work/
仓库：`Yangtze-University-Geek-Class/admin`（私有）

核心场景：
- 用户用 GitHub OAuth 登录 → 自动列出自己 owner/member 的所有 org → 按角色分权
- admin 可改组织设置 / 邀请成员 / 改成员角色 / 管仓库（含创建、删除、协作者、issues、PRs、commits、代码浏览）
- 任何人可凭 admin 生成的临时邀请链接加入
- 任何人可向某个 org 提意见（意见箱），admin 在后台分类、回复、改状态

---

## 2. 技术栈 + 文件布局

```
yzgc-admin/
├── AGENTS.md              ← THIS FILE (SSOT for agents)
├── README.md              ← human entry point
├── docs/
│   ├── INDEX.md           ← 生成物：全部文档的自动索引（node scripts/docs-index.mjs）
│   ├── README.md          ← 人工入口：改什么 → 看哪篇；含"新文档该放哪"
│   ├── conventions/       ← COMMITS · ISSUES · PULL-REQUESTS · CONTRIBUTING
│   ├── design/            ← DESIGN（页面规范）· STACK（技术栈与版本）
│   ├── architecture/      ← ARCHITECTURE · SECURITY
│   ├── plan/              ← WEB-SPLIT（拆分方案）· REFACTOR（现状盘点）
│   └── ops/               ← DEPLOY · USAGE
│   （各篇均有 .en.md 英文版；§0 说明改代码前该读哪篇）
├── server/                Node 20 + Fastify + Octokit + better-sqlite3 (TS, ESM)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                          ← entry, registers all routes
│       ├── config.ts                         ← env loader, OAuth scope, turnstile
│       ├── lib/
│       │   ├── db.ts                         ← SQLite schema (sessions, invite_links, invitations, feedback, audit_logs, app_state)
│       │   ├── auth.ts                       ← OAuth flow, session crud
│       │   ├── github.ts                     ← Octokit factories + getOrgRole
│       │   └── crypto.ts                     ← AES-256-GCM for token-at-rest
│       ├── middleware/
│       │   ├── require-auth.ts               ← session cookie check, mounts req.session
│       │   ├── require-org-role.ts           ← per-route { preHandler: requireOrgRole("admin"|"member") }
│       │   ├── turnstile.ts                  ← optional captcha verify
│       │   └── pow.ts                        ← proof-of-work guard for public submissions
│       └── routes/
│           ├── auth.ts                       ← /auth/github  /auth/callback  /auth/signout  /auth/me
│           ├── orgs.ts                       ← /api/me/orgs
│           ├── join.ts                       ← public /api/join/:token (GET info + POST accept)
│           ├── feedback.ts                   ← public POST /api/feedback + GET /api/feedback/public
│           ├── docs.ts                       ← /api/docs 文档内容
│           ├── forum/                        ← auth/categories/threads/posts/users/groups/teacher/stats/admin-users/upload
│           └── admin/
│               ├── overview.ts               ← /api/admin/:org/overview
│               ├── members.ts                ← list/remove/role
│               ├── repos.ts                  ← list/detail/tree/file/commits/commit/issues/pulls/create/delete/collaborators
│               ├── invitations.ts            ← pending + history
│               ├── invite-links.ts           ← CRUD links (admin only)
│               ├── teams.ts                  ← CRUD teams
│               ├── activity.ts               ← /orgs/{org}/events
│               ├── security.ts               ← dependabot/secret-scan/audit_log (plan-gated)
│               ├── org.ts                    ← PATCH org settings
│               ├── feedback.ts               ← admin triage of feedback
│               └── logs.ts                   ← audit log read
├── web/                   Vite + React 18 + TanStack Query + Tailwind (CSS vars for theming)
│   │                      NOTE: this tree is one codebase rendering three sites
│   │                      (portal / forum / admin). A physical split into
│   │                      web/sites/{portal,forum,admin} + web/shared/ is planned —
│   │                      read docs/plan/WEB-SPLIT.md before adding or moving files here.
│   ├── package.json
│   ├── vite.config.ts                       ← dev proxy /api /auth /healthz → :3000
│   ├── tailwind.config.js                   ← colors are rgb(var(--brand-X) / <alpha-value>)
│   ├── index.html
│   ├── public/                              ← logo.png + favicon-16/32 + logo-192
│   └── src/
│       ├── main.tsx                         ← ThemeProvider + QueryClient + ConfirmProvider + Router
│       ├── App.tsx                          ← all routes
│       ├── index.css                        ← shared Tailwind components + prose styles + global animations
│       ├── portal.css                       ← portal soft-blue skin + motion effects + mascot styles
│       ├── config/
│       │   ├── app.config.json              ← frontend URLs, per-env policy/feature flags, portal + mascot tuning
│       │   └── index.ts                     ← typed config access
│       ├── lib/
│       │   ├── api.ts                       ← live/mock dispatcher + fetch wrapper, fmtDate, fmtRelative
│       │   ├── mock-api.ts                  ← development-only local fixtures for protected pages
│       │   ├── runtime.ts                   ← dev/prod site + data-source control
│       │   └── themes.ts                    ← single light yzgc-blue theme, applyTheme/loadTheme
│       ├── components/
│       │   ├── DevControlCenter.tsx          ← development site/data/page switcher; hidden in production
│       │   ├── PortalHeader.tsx              ← config-driven portal brand + docs/forum/admin/GitHub nav
│       │   ├── Select.tsx                   ← REPLACES native <select> everywhere (themed dropdown)
│       │   ├── ConfirmDialog.tsx            ← useConfirm() — REPLACES window.confirm() everywhere
│       │   ├── DiffView.tsx                 ← commit diff colorizer (@@/+ /-)
│       │   └── Mascot.tsx                  ← unified 8-pose mascot, portal/forum/preview layouts
│       └── pages/
│           ├── Landing.tsx                  ← / (portal)
│           ├── Docs.tsx                     ← /docs /docs/:id
│           ├── JoinByToken.tsx              ← /join/:token
│           ├── Feedback.tsx                 ← /feedback  /feedback/:org
│           ├── forum/                       ← Home/CategoryList/Category/Thread/NewThread/Login/Register/Profile/Me/Notifications/Archive/Admin/Teacher
│           └── admin/
│               ├── SignIn.tsx               ← /admin/signin
│               ├── MyOrgs.tsx               ← /admin
│               ├── OrgLayout.tsx            ← /admin/:org wrapper (nav + org switcher)
│               ├── Overview.tsx
│               ├── Members.tsx
│               ├── Repos.tsx
│               ├── RepoDetail.tsx           ← tabs Code/Commits/Issues/PRs/Settings (nested routes)
│               ├── CreateRepo.tsx
│               ├── Invitations.tsx
│               ├── InviteLinks.tsx
│               ├── Teams.tsx
│               ├── Activity.tsx
│               ├── Security.tsx
│               ├── OrgSettings.tsx
│               ├── Feedback.tsx             ← admin triage
│               └── Logs.tsx
└── deploy/
    ├── nginx.conf                           ← server block for github.yangtzeu.work
    ├── yzgc-admin.service                   ← systemd unit
    └── setup.sh                             ← one-shot install
```

---

## 3. Build / Run / Test commands

```bash
# install
pnpm install

# dev (server :3000 + vite :5173, vite proxies /api /auth /healthz)
pnpm dev

# build both packages
pnpm -r run build

# server-only build
cd server && pnpm build

# web-only build
cd web && pnpm build

# server prod start
node server/dist/index.js
```

No test framework yet. When adding one, prefer Vitest (matches Vite/web). Don't add Jest.

To verify changes work end-to-end: rebuild, restart systemd, hit `/healthz`, then drive the live page via opencli (or curl `/api/admin/...` with a valid session cookie).

---

## 4. Invariants — agents MUST preserve

### 4.1 OAuth scope coupling

`server/src/config.ts` sets `scope: "read:user user:email admin:org read:org repo"`.
Changing this string requires every existing session to re-login (their stored token doesn't have the new scope). Document a re-login banner if you must change it.

### 4.2 Per-request user-token, not service-token

Every `admin/*` route uses `octokitWith(req.session!.accessToken)` — the **logged-in user's** OAuth token. GitHub-side permission is authoritative.

The ONLY exception: `invite_links.created_by_token_encrypted` stores the admin's token (AES-encrypted) so that public visitors hitting `/join/:token` can send the invitation on the admin's behalf. Do NOT generalize this pattern elsewhere.

### 4.3 Token encryption at rest

`server/src/lib/crypto.ts` uses AES-256-GCM. `ENCRYPTION_KEY` env must decode to exactly 32 bytes. If you ever rotate the key, all existing sessions + invite_links become unreadable (sessions: silently dropped; invite_links: returns 503 "请联系管理员重新生成"). Plan migration before rotating.

### 4.4 SQLite schema

Add a column → write a `db.exec("ALTER TABLE ... ADD COLUMN ...")` in `db.ts` BELOW the original `CREATE TABLE` block, guarded by try/catch (because re-runs throw "duplicate column"). Don't `DROP TABLE`. Don't reorder existing columns. The production DB lives at `/opt/yzgc-admin/data/data.db`.

### 4.5 Theme system

Tailwind colors are `rgb(var(--ink-X) / <alpha-value>)` — driven by `<html>` CSS vars set by `applyTheme()` in `lib/themes.ts`. The product uses one light `yzgc-blue` theme and must not reintroduce dark themes. **Never** hardcode hex colors in components. Add new slots to the single theme and portal palette config.

### 4.6 No native `<select>` or `window.confirm()`

UI consistency rule. Use `<Select>` from `components/Select.tsx` and `useConfirm()` from `components/ConfirmDialog.tsx`. Reviewers will reject PRs that add native widgets.

### 4.7 Bottom-line: changing code without updating docs is BANNED

If you change:
- a route → update `docs/architecture/ARCHITECTURE.md` route table + this file's §2 file map
- a DB column → update `docs/architecture/ARCHITECTURE.md` schema + `docs/ops/DEPLOY.md` if migration is needed
- env var → update `.env.example` AND `docs/ops/DEPLOY.md`
- a user-visible feature → update `docs/ops/USAGE.md`
- a build / dev command → update `README.md` AND this file's §3
- frontend directory layout, site boundary, or shared-vs-site placement → update `docs/plan/REFACTOR.md` AND `docs/plan/WEB-SPLIT.md`, and update this file's §2 file map
- anything about how commits are written → `docs/conventions/COMMITS.md`
- a document's title, path, or summary → regenerate `docs/INDEX.md` (`node scripts/docs-index.mjs`)

When a change makes a doc wrong, fixing the doc is part of the change, not a follow-up. When a change cannot be reconciled with a doc, stop and surface the conflict (§0).

This is enforced by code review.

---

## 5. Common tasks — minimum recipe

### Add a new admin API endpoint

1. Pick the right `server/src/routes/admin/<topic>.ts` or create one
2. Add the route with both preHandlers: `requireAuth` (file-level via `addHook`) and route-level `requireOrgRole("admin" | "member")`
3. Use `octokitWith(req.session!.accessToken)` for GitHub calls
4. Call `audit(org, req.session!.login, "<action.verb>", target, details, req.ip)` for mutating ops
5. If creating a new route module, register it in `server/src/index.ts`
6. Front-end: add a `useQuery` / `useMutation` in the relevant page; invalidate the query on mutation success

### Add a new admin page

1. Create `web/src/pages/admin/<Name>.tsx` (use `useParams` for `:org`)
2. Add `<Route path="<slug>" element={<Name />} />` under `/admin/:org` in `App.tsx`
3. Add a nav entry to `NAV_ALL` in `OrgLayout.tsx` (set `admin: true` if admin-only)
4. Use `useOutletContext<{ isAdmin: boolean; role: string; org: string }>()` to gate admin-only UI in the same page

### Adjust colors (no theming system)

1. Product is intentionally single light theme; edit the one `THEMES[0]` entry in `web/src/lib/themes.ts` (11 `--ink-*` + 3 `--brand-*` + `--bg-grad`)
2. Portal-only accents live in `app.config.json > portal.palette`
3. Do not reintroduce dark themes or a theme switcher

### Add a public-facing endpoint (no login required)

1. Add to `server/src/routes/<topic>.ts` (NOT under `admin/`)
2. Add explicit `config: { rateLimit: { max: N, timeWindow: "1 minute" } }` — there is NO global rate limit
3. If accepting form input: validate length, regex, and call `verifyTurnstile(token, req.ip)`
4. Audit log with actor `'public'` or `'public:<token>'`

---

## 6. Security checklist for changes

- [ ] Don't log `access_token` or `client_secret` (even debug). Only the encrypted form may be persisted.
- [ ] Don't bypass `requireOrgRole` for "convenience" — GitHub-side perms are the source of truth.
- [ ] Don't expose `audit_logs.details` JSON to public endpoints (it may contain emails/IPs).
- [ ] Don't add `eval`, `Function(...)`, or `dangerouslySetInnerHTML`.
- [ ] Don't add new cookies without `httpOnly: true, secure: true, sameSite: "lax"`.
- [ ] Don't commit `.env` (only `.env.example`).
- [ ] Don't change OAuth scope without coordinating session reset.

---

## 7. Deploy / ops touchpoints

- Production host: `103.117.123.226:22000` (root user, Ubuntu 22.04, 2GB RAM + 2GB swap)
- App lives in `/opt/yzgc-admin/`
- DB lives in `/opt/yzgc-admin/data/data.db` (WAL mode)
- `.env` lives in `/opt/yzgc-admin/.env` (chmod 600)
- systemd unit: `yzgc-admin.service`
- Log: `/var/log/yzgc-admin.log` and `journalctl -u yzgc-admin`
- nginx config: `/etc/nginx/sites-available/github.yangtzeu.work`
- Cert: `/etc/letsencrypt/live/github.yangtzeu.work/`

`docs/ops/DEPLOY.md` has the full runbook including troubleshooting table.

---

## 8. Communication style (project owner preference)

The owner is direct and time-conscious. When you (an agent) report on work:

- 中文沟通
- 不写"我接下来要..."这种 prefatory commitments. 直接动手，做完报结果
- 不写时间估算 / step 1-N timeline — describe the change scope (which files, which functions, additive vs replacement)
- 不用 emoji in any artifact (chat, docs, commit messages, UI labels)
- 不用括号修饰强调 like "(轻量版)" "(铁律)"
- When proposing 2+ options: state your recommendation FIRST with one-line reason

---

## 9. Where ambiguity lives — ask, don't guess

- New `--feature` flags or env vars: check with the owner before adding
- Renaming an existing public API surface (URL path / cookie name / DB column): always ask
- Adding a new dependency: ok if it's tiny + has license + actively maintained; ask if >50 KB minified
- Changing the visual brand (logo, color tokens used as brand color): always ask

---

## 10. Tasks the owner is unlikely to want

Don't proactively do these unless asked:
- Add unit tests (no test infra yet — adding it is a separate explicit task)
- Add CI/CD pipelines
- Add internationalization (Chinese-only is fine for now)
- Add dark mode or theme switching (the product is intentionally light-only)
- Add server-side rendering / Next.js migration
- Add Docker / Kubernetes manifests (systemd is the deploy unit)
- Refactor "for cleanliness" without a user-visible benefit
