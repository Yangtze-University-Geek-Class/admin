# Pre-Refactor Inventory

> 历史阶段记录：旧路径、版本、数量和完成声明仅供追溯。

状态：`historical` · 标注：2026-09-12

当前实施规范见 [当前架构](../architecture/ARCHITECTURE.md) 与 [模块规范](../conventions/MODULAR-DEVELOPMENT.md)，不以本文中的旧完成声明代替验收。

> Branch: `next` · created 2026-09-12 · baseline commit `4959668`
> Purpose: pin down "what the system looks like today" before touching anything. This file describes the current state only — no migration steps.
> Chinese original: [REFACTOR.md](./REFACTOR.md).

> **This document records the directory layout from before the split (`4959668`).** The
> three-end split landed on 2026-09-12: the frontend now lives in `web/sites/<end>/` and
> `web/shared/`, and backend routes in `server/src/routes/<end>/` — so paths like
> `web/src/pages/*` below are historical. The page list, API table, and defect list remain
> valid; for anything directory-related, trust the code and [WEB-SPLIT.md](./WEB-SPLIT.en.md).

---

## 0. The three sites

**Confirmed: one codebase renders three sites.** Site 1 ("portal") is not just the landing page — it carries four public routes.

| # | Site | Code id | Live URL | Pages / layouts | Auth |
|---|---|---|---|---|---|
| 1 | Portal | `portal` | `https://yangtzeu.work` | 4 pages | Fully anonymous |
| 2 | Forum | `forum` | `https://yangtzeu.work/forum` | 13 pages + 1 layout | Own session (`forum_sid`), optional |
| 3 | Admin | `admin` | `https://github.yangtzeu.work` | 15 pages + 1 layout | Mandatory GitHub OAuth (`sid`) |

Three things to settle first:

1. **`forum.yangtzeu.work` does not resolve.** The host is declared in `web/src/config/app.config.json` (`sites.forum.host`), but there is no DNS record, no nginx server block, and no certificate for it. The forum is actually served from the `yangtzeu.work/forum` path prefix — see `portalForumFallback` in `web/src/lib/site.ts:19-31`, which injects `basePath="/forum"` into `BrowserRouter basename`. The refactor must either enable the subdomain or switch the config to a path mount; leaving both in place is not viable.

2. **All three sites ship in one bundle.** `pnpm --filter @yzgc/web build` emits a single `index-*.js` (597 KB / 180 KB gzip) and a single `index-*.css` (78 KB). `App.tsx:1-38` statically imports all 34 pages, and `App.tsx:39-43` merely picks one of three route trees by `site.kind` — **visiting the portal downloads the forum and admin code as well**. There is no `React.lazy` and no `manualChunks`; the build warns about chunks over 500 KB.

3. **The frontend is not split at build time — only at runtime, by host.** `detectSite()` chooses which tree renders; nginx, systemd, and the backend are shared. Splitting into three deployments is therefore free at the build level and only costs new domains and certificates at the deploy level.

---

## 1. Site resolution

Call chain (`web/src/main.tsx:14-44`):

```
detectSite()                     // lib/site.ts — resolves kind / host / title / basePath
  └ resolveRuntimeSite()         // lib/runtime.ts — host wins; dev may override via __site
applyTheme(loadTheme(...))       // lib/themes.ts — the single yzgc-blue light theme
document.documentElement.dataset.site = site.kind   // drives [data-site=...] rules in index.css
new QueryClient({ staleTime: 15s, retry: false })
<BrowserRouter basename={site.basePath || undefined}>
  <App />                        // one of: PortalRoutes | ForumRoutes | AdminRoutes
  {features.feedbackFab && <GlobalFab />}
  <ImageLightbox /> <DevControlCenter />
```

Resolution order (`lib/runtime.ts:105-113`):

1. Dev override: `?__site=` query or `localStorage["yugc:dev-site"]` (disabled in production via `allowSiteOverride: false`)
2. `hostname === "yangtzeu.work"` and `pathname` starts with `/forum` → `forum`
3. `hostname` matches an `appConfig.sites[*].host` → that site
4. Fallback → `environment.defaultSite` (currently `"portal"`)

Cross-site navigation goes through `externalUrl(target, path)` (`lib/runtime.ts:62-77`) with three behaviours: same site returns a relative path; portal→forum returns `/forum/...`; everything else returns `https://<host>/...`. `app.config.json`'s `sites` block is the single source of truth for hostnames.

| Key | portal | forum | admin |
|---|---|---|---|
| `host` | `yangtzeu.work` | `forum.yangtzeu.work` | `github.yangtzeu.work` |
| `title` | 长江大学极客班 · YUGC | YUGC 论坛 · 长江大学极客班 | YUGC Admin · 组织管理 |
| `basePath` | `""` | `""` (injected as `/forum` on path fallback) | `""` |

---

## 2. Page inventory

### 2.1 portal (4 pages)

| Route | File | LOC | Purpose | Backend API |
|---|---|---|---|---|
| `/` | `pages/Landing.tsx` | 209 | Landing: hero → direction cards → field notes → forum activity | **None.** All content comes from in-file constants `DIRECTIONS` / `ARTICLES` / `THREADS` |
| `/docs`, `/docs/:id` | `pages/Docs.tsx` | 102 | Docs site: sidebar + Markdown body + zh/en toggle | `GET /api/docs`, `GET /api/docs/:id` |
| `/feedback`, `/feedback/:org` | `pages/Feedback.tsx` | 177 | Public feedback form + recent submissions | `GET /api/feedback/categories`, `GET /api/public/config`, `GET /api/feedback/public`, `POST /api/feedback` |
| `/join/:token` | `pages/JoinByToken.tsx` | 193 | Invite-link landing: validate → GitHub login/email → auto-join | `GET /api/join/:token`, `GET /api/public/config`, `POST /api/join/:token` |

Supporting components: `components/PortalHeader.tsx` (52, config-driven nav), `components/Mascot.tsx` (112, global mascot), `components/FeedbackFab.tsx` (164, floating feedback button — **not** mounted on portal, see `App.tsx:112-115`).

Technical notes:

- **The only site that does not use React Query.** `Feedback.tsx` / `JoinByToken.tsx` use hand-written `useState` + `useEffect` because they sequence PoW and Turnstile through an async state machine.
- Styling uses the `portal-*` / `mascot-*` classes in `portal.css` (388 lines), which do **not** overlap with the Tailwind utility classes used by forum/admin.
- Hero copy, direction cards, article list, and discussion list are all hardcoded in `Landing.tsx`; changing wording means changing code. This is the part most in need of becoming data-driven.

### 2.2 forum (13 pages + 1 layout)

`ForumLayout.tsx` (174) is the shell: sticky header, nav, search, user menu, GitHub-bind banner, mascot scene mapping, `<Outlet/>`. It also exports `Avatar` (`:166-174`), reused by six pages.

| Route | File | LOC | Purpose | Main API |
|---|---|---|---|---|
| `/` (index) | `ForumHome.tsx` | 135 | Home / search results: `latest`\|`hot` toggle + pagination | `GET /api/forum/categories`, `GET /api/forum/threads` |
| `/categories` | `ForumCategoryList.tsx` | 58 | All categories (root + child grid) | `GET /api/forum/categories` |
| `/c/:slug` | `ForumCategory.tsx` | 88 | Threads in one category + new-thread entry | `GET /api/forum/categories`, `GET /api/forum/threads` |
| `/t/:id` | `ForumThread.tsx` | 232 | Thread detail: body rendering, floors, like/reply/delete/sticky/essence/lock | `GET /api/forum/me`, `GET /api/forum/threads/:id`, `POST /api/forum/posts`, `DELETE /api/forum/posts/:id`, `POST /api/forum/posts/:id/like` |
| `/new` | `ForumNewThread.tsx` | 82 | Create thread | `GET /api/forum/me`, `GET /api/forum/categories`, `POST /api/forum/threads` |
| `/login`, `/register` | `ForumLogin.tsx`, `ForumRegister.tsx` | 69 / 71 | Password login / registration | `POST /api/forum/auth/login`, `POST /api/forum/auth/register` |
| `/u/:username` | `ForumProfile.tsx` | 84 | Public user profile | `GET /api/forum/users/:username` |
| `/me` | `ForumMe.tsx` | 149 | Account: profile, password, GitHub binding | `GET /api/forum/me`, `PATCH /api/forum/me/profile`, `POST /api/forum/auth/set-password`, `GET /api/forum/auth/github` |
| `/me/notifications` | `ForumNotifications.tsx` | 64 | Notifications | `GET /api/forum/me`, `GET /api/forum/me/notifications`, `POST /api/forum/me/notifications/read-all` |
| `/archive` | `ForumArchive.tsx` | 129 | mbbs archive listing (read-only) | `GET /api/forum/archive/categories`, `GET /api/forum/threads?archive=1` |
| `/archive/t/:id` | reuses `ForumThread.tsx` | — | Archived thread; the `inArchive` branch switches to read-only UI | same as above |
| `/admin` | `ForumAdmin.tsx` | 377 | Forum back office: users / roles / groups / permissions / categories / teachers | `GET /api/forum/permissions`, `GET/PUT /api/forum/groups/*`, `GET /api/forum/admin/users`, `PATCH /api/forum/admin/users/:id/role`, `POST /api/forum/admin/teachers`, `GET/POST/DELETE /api/forum/categories*` |
| `/teacher` | `ForumTeacher.tsx` | 170 | Teacher panel | `GET /api/forum/me`, `GET /api/forum/teacher/overview` |

Technical notes:

- Everything uses React Query with `["forum-*", ...]` keys; writes use `useMutation` + `invalidateQueries`.
- **There is no global 401 interceptor.** Auth is expressed as "`GET /api/forum/me` client-side gate + `role` check": an unauthenticated visitor simply renders as a guest after `me` returns 401. Menu items are filtered by `role` — `admin|mod` see `/admin`, `teacher|admin|mod` see `/teacher` (`ForumLayout.tsx:88-93`).
- Archive read-only mode is enforced server-side: for `is_legacy=1` categories, `POST /api/forum/threads` and `POST /api/forum/posts/:id/like` return 403 `legacy_readonly`.
- Markdown rendering goes through `lib/forum-render.ts` (marked + DOMPurify + highlight.js with 17 languages, including `rewriteResources` which rewrites `bbs/…` to `/forum/r/…`).

### 2.3 admin (15 pages + 1 layout)

`OrgLayout.tsx` (157) is the `/admin/:org` shell: sidebar, org switcher, sign-out, and permission broadcast via `<Outlet context={{ role, org, isAdmin }} />`.

| Route | File | LOC | Purpose |
|---|---|---|---|
| `/signin`, `/admin/signin` | `SignIn.tsx` | 36 | GitHub OAuth entry (`return_to` allowlist check) |
| `/admin` | `MyOrgs.tsx` | 84 | Org picker |
| `/admin/:org` (index) | `Overview.tsx` | 64 | Org overview: 4 stat cards + org info |
| `/admin/:org/members` | `Members.tsx` | 92 | Member table: change role / remove (`isAdmin` only) |
| `/admin/:org/repos` | `Repos.tsx` | 61 | Repo card list |
| `/admin/:org/repos/new` | `CreateRepo.tsx` | 112 | Create repo (visibility / auto_init / gitignore / license) |
| `/admin/:org/repos/:repo/*` | `RepoDetail.tsx` | **699** | Repo detail — decomposed below |
| `/admin/:org/invitations` | `Invitations.tsx` | 132 | Pending GitHub invitations + local history |
| `/admin/:org/invite-links` | `InviteLinks.tsx` | 211 | Invite link create / disable / delete, optional team binding |
| `/admin/:org/teams` | `Teams.tsx` | 97 | Team CRUD |
| `/admin/:org/activity` | `Activity.tsx` | 36 | Org event stream (read-only) |
| `/admin/:org/security` | `Security.tsx` | 53 | Dependabot / secret scanning / audit log availability |
| `/admin/:org/org` | `OrgSettings.tsx` | 126 | Org profile and default permissions, draft-diff save |
| `/admin/:org/feedback` | `Feedback.tsx` | 145 | Feedback triage: filter / reply / delete |
| `/admin/:org/logs` | `Logs.tsx` | 48 | Local audit log table |

`RepoDetail.tsx` is the one file that needs real decomposition; it nests 7 sub-routes (`:52-59`):

| Sub-route | Content |
|---|---|
| index | `CodeTab` — tree browsing + file preview |
| `commits` | `CommitsTab` — branch picker + commit list + diff |
| `commits/:sha` | Commit detail |
| `issues` | `IssuesTab` — state filter |
| `issues/:n` | `IssueDetail` — body + comments + close/comment actions |
| `pulls` | `PullsTab` |
| `pulls/:n` | `PullDetail` — body + comments + file diffs + merge |
| `settings` | `SettingsTab` — collaborators / branches / webhooks / dangerous actions |

Technical notes:

- Data access goes through `api<T>()` (`lib/api.ts`): same-origin fetch with `credentials: "same-origin"`; in dev/mock mode it delegates to `lib/mock-api.ts`.
- Writes use `useMutation` + `invalidateQueries`; there is no form library — controlled `useState` + `onSubmit`.
- Confirmations use `useConfirm()` (`components/ConfirmDialog.tsx`); dropdowns use `components/Select.tsx`; numbers use `NumberInput.tsx`; diffs use `DiffView.tsx`.
- There is exactly one permission pattern: `OrgLayout` publishes `isAdmin` via `useOutletContext`, and `members` / `teams` / `org` hide or disable write actions from it; `create-repo`, `invitations`, `invite-links`, `feedback`, `logs` rely on **nav filtering plus a backend 403**.

---

## 3. Backend API surface (87 endpoints)

A single Fastify process on `127.0.0.1:3000`. Route files and mounts are in `server/src/index.ts:44-58`. **Paths are not namespaced per site** — all three prefixes live in the same process.

### 3.1 Public (used by portal, 13)

| Method | Path |
|---|---|
| GET | `/api/docs`, `/api/docs/:id` |
| GET | `/api/feedback/categories`, `/api/feedback/public` |
| POST | `/api/feedback` |
| GET | `/api/public/config` |
| GET/POST | `/api/join/:token` |
| GET | `/api/me/orgs` |
| GET | `/auth/github`, `/auth/callback`, `/auth/me` |
| POST | `/auth/signout` |

### 3.2 Forum (37)

| File | Endpoints |
|---|---|
| `forum/auth.ts` | `GET /api/forum/me`, `POST /api/forum/auth/login`, `POST /api/forum/auth/register`, `POST /api/forum/auth/logout`, `GET /auth/forum/github`, `POST /api/forum/auth/set-password`, `GET /api/forum/auth/providers`, `DELETE /api/forum/auth/github` |
| `forum/categories.ts` | `GET /api/forum/categories`, `GET /api/forum/archive/categories`, `POST /api/forum/categories`, `DELETE /api/forum/categories/:id` |
| `forum/threads.ts` | `GET /api/forum/threads`, `GET /api/forum/threads/:id`, `POST /api/forum/threads`, `PATCH /api/forum/threads/:id`, `DELETE /api/forum/threads/:id` |
| `forum/posts.ts` | `POST /api/forum/posts`, `DELETE /api/forum/posts/:id`, `POST /api/forum/posts/:id/like` |
| `forum/users.ts` | `GET /api/forum/users/:username`, `PATCH /api/forum/me/profile`, `GET /api/forum/me/notifications`, `POST /api/forum/me/notifications/read-all` |
| `forum/groups.ts` | `GET /api/forum/permissions`, `GET /api/forum/groups`, `GET /api/forum/groups/:id`, `PUT /api/forum/groups/:id/permissions`, `POST /api/forum/groups/:id/members`, `DELETE /api/forum/groups/:id/members/:user_id` |
| `forum/admin-users.ts` | `GET /api/forum/admin/users`, `PATCH /api/forum/admin/users/:id/role`, `POST /api/forum/admin/teachers` |
| `forum/teacher.ts` | `GET /api/forum/teacher/overview` |
| `forum/stats.ts` | `GET /api/forum/stats` |
| `forum/upload.ts` | `POST /api/forum/upload`, `GET /forum/u/:name` |

### 3.3 Admin (37)

All parameterised under `/api/admin/:org/...`; `server/src/routes/admin/repos.ts` alone carries 17 endpoints.

| File | Count | Coverage |
|---|---|---|
| `repos.ts` | 17 | list / detail / tree / file / commits / commit / issues / pulls / issue detail / pr detail / merge / issue state / comment / create-repo / delete / collaborator ×2 |
| `invite-links.ts` | 4 | CRUD (admin only) |
| `members.ts` | 3 | list / remove / role |
| `feedback.ts` | 3 | list / patch / delete |
| `teams.ts` | 3 | list / create / delete |
| `invitations.ts` | 2 | list / delete |
| `overview.ts`, `org.ts`, `activity.ts`, `security.ts`, `logs.ts` | 1 each | overview / org settings / events / security / audit |

---

## 4. Data model

Two SQLite files, two independent connections, both WAL, both `foreign_keys=ON`. **No shared tables, no cross-database foreign keys.**

| DB | Handle | Path | Owner |
|---|---|---|---|
| `data.db` | `config.dbPath` | `DB_PATH` from `.env`; live: `/opt/yzgc-admin/data/data.db` | admin |
| `forum.db` | `FORUM_DB_PATH ?? dirname(DB_PATH)/forum.db` | live: `/opt/yzgc-admin/data/forum.db` | forum |

### 4.1 `data.db` (`server/src/lib/db.ts:11-88`)

| Table | Purpose |
|---|---|
| `app_state` | Key/value state |
| `sessions` | Admin sessions; `access_token_encrypted` is AES-256-GCM; 7-day TTL |
| `invite_links` | Invite links; `created_by_token_encrypted` stores the creator's token; `max_uses` / `current_uses` / `expires_at` / `team_slug` / `disabled` |
| `invitations` | Invitation history; `status` = `sent` / `failed` / `pending_admin` |
| `feedback` | Feedback; `status` = `open` / `triaged` / `in_progress` / `done` / `wont_do` / `spam` |
| `audit_logs` | Audit trail; `actor` is a GitHub login or `public:<token>` |

### 4.2 `forum.db` (`server/src/lib/forum-db.ts:13-176`)

| Table | Purpose |
|---|---|
| `forum_users` | Forum accounts; `github_id` and/or `password_bcrypt`; `role` = `admin` / `mod` / `teacher` / `member` / `banned`; `legacy_mbbs_id` for provenance |
| `forum_sessions` | Forum sessions, 14-day TTL; `source` = `password` / `github` / `bind` |
| `forum_categories` | Categories; `is_legacy` marks the archive, `parent_id` allows one nesting level, `thread_count` is a denormalised counter |
| `forum_threads` | Threads; `is_sticky` / `is_essence` / `is_locked` / `is_deleted` (soft delete) |
| `forum_posts` | Posts; `reply_post_id` points at the quoted floor |
| `forum_likes` | Likes, PK `(user_id, post_id)` |
| `forum_notifications` | Notifications |
| `forum_tags` / `forum_thread_tags` | Tags (currently 4 tags, 0 associations) |
| `forum_groups` / `forum_group_permissions` / `forum_user_groups` | RBAC triple |
| `forum_settings` | Key/value |

Schema evolves via `CREATE TABLE IF NOT EXISTS` plus a startup `PRAGMA table_info` check followed by `ALTER TABLE ADD COLUMN` (`forum-db.ts:178-192`). Repo rule (`CONVENTIONS.md` §5): **additive only — never drop, never reorder**.

---

## 5. Authentication

**Three credential systems coexist and do not interoperate.**

| | admin | forum (web) | forum (CLI/API) |
|---|---|---|---|
| Credential | `sid` cookie | `forum_sid` cookie | `Authorization: Bearer <GitHub PAT>` |
| TTL | 7 days | 14 days | token→user map cached 5 minutes |
| Storage | `sessions` table, token encrypted | `forum_sessions` table | in-memory `TOKEN_CACHE` |
| Middleware | `requireAuth` + `requireOrgRole(minRole)` | `requireForumAuth` / `requireForumAdmin` / `requireForumTeacherOrAdmin` | same (via `resolveBearerToForumUser`) |
| Identity source | GitHub OAuth | password or GitHub binding | GitHub PAT → `github_id` |

Key implementation facts:

- **Admin calls GitHub with the signed-in user's own token** (`CONVENTIONS.md` §4). `requireOrgRole` calls `GET /orgs/{org}/memberships/{username}` per request, so GitHub's own permission model applies and no local RBAC exists. The single exception is the public invite link, which signs invitations with the creator's encrypted token.
- **The forum has two identity paths into one `forum_users` table.** For CLI use, `forum-bearer.ts` exchanges the PAT at GitHub `/user` for a `github_id` and auto-provisions via `upsertForumUserFromGithub`; the web path uses a password or OAuth binding.
- **Forum permissions are centralised but incomplete.** `hasPermission()` in `lib/forum-permissions.ts` enforces only `thread.create` and `thread.reply`. `thread.sticky` / `essence` / `lock` / `hideAny` and ten others **remain database records that no code reads** — the actual decisions are `isOwner` / `isMod` checks inside route handlers. The file's own `PERMISSION_CATALOG` marks this honestly via its `enforced` flag. The refactor must either make the permission table authoritative or delete the unenforced rows so the UI stops advertising them.

---

## 6. Stack and build

| Layer | Choice | Version |
|---|---|---|
| Frontend | React + TypeScript | 18.3 / 5.7 |
| Build | Vite | 6.0 |
| Routing | React Router | 7.1 |
| Data | TanStack Query | 5.62 |
| Styling | Tailwind (CSS-variable palette) | 3.4 |
| Markdown | marked + DOMPurify + highlight.js | 15 / 3.4 / 11 |
| Backend | Node + Fastify | 20 / 5.2 |
| GitHub | Octokit | 21 |
| Database | better-sqlite3 (WAL) | 11.6 |
| Packages | pnpm workspace (`server` + `web`) | 9.15.9 |

Build commands:

```bash
pnpm install --frozen-lockfile
pnpm --filter @yzgc/web build      # tsc -b && vite build → web/dist
pnpm --filter @yzgc/server build   # tsc → server/dist
```

Fastify serves `web/dist` directly; the SPA fallback is in `server/src/index.ts:60-70` (anything not under `/api`, `/auth`, or `/healthz` returns `index.html`).

Two CSS namespaces exist; do not mix them during the refactor:

- `web/src/index.css` (318) — Tailwind base/components/utilities plus `card` / `btn-*` / `input` / `tag-*` / `prose-forum` / `prose-doc`, used by forum and admin.
- `web/src/portal.css` (388) — `portal-*` / `mascot-*`, used only by portal and Mascot.
- The palette is singular: `yzgc-blue` in `lib/themes.ts`. `--ink-*` / `--brand-*` are written to `:root` by `applyTheme`, and Tailwind consumes them through `rgb(var(--x) / <alpha-value>)`. Hardcoded hex is banned by `CONVENTIONS.md` §1.

---

## 7. Cross-site coupling (the refactor's real work)

Ordered by coupling strength; these are what break when sites are split.

1. **One bundle, no code splitting.** The cost of sharing an artefact is that every site downloads the other two. Highest-value item to fix.
2. **Hardcoded cross-site links.** `ForumHome.tsx:110-111` uses `<Link to="/docs">` and `<Link to="/feedback">` — routes that only exist in portal's tree. Forum's route table has no such paths, so they hit the catch-all `Navigate to="/"`. **This is broken in production today**: clicking "使用文档" returns you to the forum home. The correct form is `externalUrl("portal", "/docs")`. The same class of bug needs a full sweep of `Link` / `navigate` targets.
3. **`api()` mock dispatch.** In dev, `lib/api.ts` forwards to `lib/mock-api.ts`, which matches with suffix regexes such as `/overview$` and `/members$` rather than an `/api/admin/` prefix. Changing any API path requires updating the mock in lockstep, or dev mode silently returns wrong data.
4. **The `/api/docs` allowlist lives in the backend.** `server/src/routes/docs.ts:10-21` hardcodes 10 entries (README / USAGE / DEPLOY / ARCHITECTURE / SECURITY, each in zh and en). **Adding a `docs/*.md` file does not make it appear on the docs site** — the array must be edited.
5. **`/api/docs` is unauthenticated.** The docs site is public, so any `.md` added to that allowlist becomes publicly readable.
6. **Portal and forum share a path prefix.** `yangtzeu.work/forum` is simultaneously portal's prefix rule and forum's `basename`; `site.ts:19-31` and `runtime.ts:105-113` must stay in agreement.
7. **`GlobalFab` behaves per site** (`App.tsx:112-115`): not mounted on portal, `raised` on forum (lifted above the mascot), default position on admin. One component, three behaviours.

---

## 8. Known defects

Candidates to fix along the way; all located by line.

| # | Location | Problem | Impact |
|---|---|---|---|
| 1 | `pages/forum/ForumHome.tsx:110-111` | `Link to="/docs"` / `to="/feedback"` point at portal routes. Because forum's `BrowserRouter basename="/forum"`, these render as `href="/forum/docs"` | **Verified broken in production**: on `https://yangtzeu.work/forum`, clicking "使用文档" goes to `/forum/docs`, hits the catch-all, and returns to `https://yangtzeu.work/forum`. Correct form: `externalUrl("portal", "/docs")` |
| 2 | `pages/Landing.tsx` hero | `titleLead<br/><span>titleAccent</span>`; the span is `inline-block` and wraps inside the copy column | At ≥1280px the headline breaks into three lines, orphaning "码。" |
| 3 | `pages/Landing.tsx:114,137` | `SectionHeading desc` still holds developer notes ("先放静态样板，不读取任何 API…", "静态看板用于确认信息密度…") | Shipped publicly with the new UI |
| 4 | `pages/Docs.tsx:56-61` | `marked.parse` output goes straight into `dangerouslySetInnerHTML`, **without DOMPurify** | Forum rendering sanitises (`forum-render.ts`); the docs site does not — two inconsistent paths |
| 5 | `lib/mock-api.ts:110` | `/api/docs` returns `{id,title,description}` while `Docs.tsx:8` expects `{id,label,lang}` | In mock mode the docs sidebar and language toggle are dead |
| 6 | `pages/Landing.tsx` | Hero, direction cards, articles, and discussion list are all hardcoded | Copy changes require code changes and a rebuild |
| 7 | `server/src/lib/forum-permissions.ts` | `PERMISSION_CATALOG` has 16 entries; only `thread.create` / `thread.reply` are enforced by `hasPermission()`, the other 14 are never read | The permission switches shown in the UI do not reflect actual behaviour |
| 8 | Build output | Single 597 KB chunk, no `manualChunks` | First load carries all three sites |

---

## 9. Suggested split order

Behaviour-preserving split, following the coupling above:

1. **Fix the dead link and the sanitisation gap** (§8 #1, #4). One-line-scale changes, lowest risk, and both must be clean before splitting.
2. **Sweep cross-site paths.** Replace `Link to="/..."` targets that belong to another site with `externalUrl()`. This is a prerequisite for splitting.
3. **Split the bundle per site.** `app.config.json`'s `sites` already distinguishes them; converting `App.tsx`'s three trees to `React.lazy` plus `manualChunks` makes each site load only its own code. No deploy change — purely a size win.
4. **Split directories.** The `web/src/pages/{portal,forum,admin}` boundary is already clean and can be promoted to workspace packages (`web-portal` / `web-forum` / `web-admin` + shared `web-shared`). The shared surface is already delineated by today's `components/` and `lib/`.
5. **Address the auth split.** Three credential systems is legacy debt, but merging them is high-risk: the forum allows password users with no GitHub account, which is incompatible with admin's OAuth-only model. Start with "remove the unenforced permission records" and scope auth unification as its own project.
6. **Make the portal data-driven.** Turning `Landing.tsx`'s constants into an API lets non-developers edit copy.

Explicitly not recommended: merging the databases (two DBs and two connections are a natural boundary with no payoff), or adding a site dimension to backend route prefixes (`/api/forum` and `/api/admin` are already clear).

---

## Appendix: file sizes

| Scope | Files | LOC |
|---|---|---|
| `web/src/pages/` (the four portal pages) | 4 | 681 |
| `web/src/pages/forum` | 14 | 1,882 |
| `web/src/pages/admin` | 16 | 2,153 |
| `web/src/components` | 10 | 745 |
| `web/src/lib` + `config/index.ts` | 8 | 576 |
| `web/src/index.css` + `portal.css` | 2 | 706 |
| `server/src` | 44 | 3,395 |

Largest three files: `admin/RepoDetail.tsx` 699 · `server/routes/admin/repos.ts` 378 · `forum/ForumAdmin.tsx` 377.
