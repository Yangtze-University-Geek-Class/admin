# Splitting the Three Ends: Target Architecture and Plan

> 历史阶段记录：旧路径、版本、数量和完成声明仅供追溯。

状态：`historical` · 标注：2026-09-12

当前实施规范见 [当前架构](../architecture/ARCHITECTURE.md) 与 [模块规范](../conventions/MODULAR-DEVELOPMENT.md)，不以本文中的旧完成声明代替验收。

> Status: **executed** (2026-09-12, branch `next`). P0 defects, P1 skeleton, P2 build, and P3
> cleanup have all landed; this document is kept as the decision record and the source of the
> boundary rules. Read §3 and §4 before adding an end or moving a boundary.
> Current-state inventory: [REFACTOR.md](./REFACTOR.md).

---

## 0. What an "end" is, and the three-layer mapping

**An end is a product boundary a user can reach independently.** There are **three**: portal, forum, admin. Everything else is a shared layer, not an end.

Each end spans three layers. The mapping below is measured, not inferred from naming:

| End | Frontend pages | Backend endpoints | Database |
|---|---|---|---|
| **portal** | 4 pages: `Landing` / `Docs` / `Feedback` / `JoinByToken` | 8: `docs.ts`(2) + `join.ts`(3) + `feedback.ts` public side (3) | `feedback` table in `data.db` |
| **forum** | 13 pages + `ForumLayout` | 37: `routes/forum/*` (10 files) | `forum.db` (**exclusive**, 11 tables) |
| **admin** | 15 pages + `OrgLayout` | 42: `routes/admin/*`(37) + `auth.ts`(4) + `orgs.ts`(1) | `data.db` (6 tables) |

87 endpoints in total (8 + 37 + 42).

### 0.1 Three genuine cross-end couplings

These **cannot** be cut along end boundaries:

| Coupling | Fact | Handling |
|---|---|---|
| **`/auth/callback`** | One callback path serves **both admin login and forum GitHub login/bind**. `routes/auth.ts:35-41` dispatches to `handleForumGithubCallback` based on the `forum_oauth_state` cookie | Stays in the shared layer. OAuth is cross-end infrastructure, not one end's private implementation |
| **feedback** | The submit side is the portal page **and** `FeedbackFab` (mounted on both forum and admin); the management side is admin (`routes/admin/feedback.ts`) | Public side → portal, management side → admin, the table and validation in between → shared |
| **`lib/` infrastructure** | `db` / `crypto` / `cache` / `github` / `forum-db` / `forum-auth` / `forum-permissions` are imported by routes of every end | Stays shared, not split per end |

### 0.2 Real database ownership

| Database | Owner | Note |
|---|---|---|
| `forum.db` | **forum, exclusively** | Clean end boundary — all 11 tables belong to the forum |
| `data.db` | **portal + admin, shared** | The `feedback` table is written by portal; `sessions` / `invite_links` / `invitations` / `audit_logs` / `app_state` belong to admin |

Conclusion: **two database files are a natural boundary, but `data.db` cannot be owned by a single end.**

---


## 1. Conclusion first: the code is already decoupled

I walked the import graph of all 55 TypeScript files under `web/src`. The key finding:

> **Zero cross-site dependencies.** There is no `portal → forum`, `forum → admin`, or `admin → portal` import anywhere.

The only aggregation point is `App.tsx`, which statically imports all three trees and renders one according to `site.kind`. So the problem is **not coupling — it is the absence of a physical boundary**:

| Current problem | Symptom |
|---|---|
| Directories are interleaved | `pages/` holds 4 portal pages at the top level while forum and admin each get a subfolder — nothing signals "three separate products" |
| One build output | A single `index-*.js` (597 KB / 180 KB gzip); **visiting the portal downloads the forum and admin code** |
| One dependency list | A single `package.json` where `highlight.js` (forum-only) and `@noble/hashes` (portal-only) are both "our dependencies" |
| No enforced boundary | Anyone can import anything; an accidental cross-site import produces no warning |

The split is therefore **turning boundaries that already exist into filesystem boundaries** — not a logic refactor. That is what makes it low-risk.

---

## 2. Shared surface (decides what moves where)

Classified by how many sites use each file, all measured from actual imports.

### Site-exclusive → move into that site's directory

| File | Owner |
|---|---|
| `pages/Landing.tsx`, `Docs.tsx`, `Feedback.tsx`, `JoinByToken.tsx` | portal |
| `pages/forum/*.tsx` (14) | forum |
| `pages/admin/*.tsx` (16) | admin |
| `components/PortalHeader.tsx` | portal (the only genuinely site-specific component) |
| `App.tsx` / `main.tsx` | split into three, one per site |

`App.tsx` currently does three jobs at once: choosing a route tree, encoding per-site `GlobalFab` behaviour (not mounted on portal, raised on forum), and mounting global providers. After the split each site's `main.tsx` hardcodes its own behaviour and no longer needs `detectSite()` branches.

### Shared → `shared/`

| File | Used by | Note |
|---|---|---|
| `components/Select.tsx` | portal + forum + admin | Replaces native `<select>` everywhere |
| `components/ConfirmDialog.tsx` | forum + admin | `useConfirm()` |
| `components/Mascot.tsx` | portal + forum | Not used by admin |
| `components/FeedbackFab.tsx` | forum + admin | Not mounted on portal |
| `components/ImageLightbox.tsx` | forum (+ global mount) | |
| `components/BackBar.tsx` | forum | Generic back bar; other sites will want it |
| `components/DiffView.tsx` | admin | Generic diff renderer |
| `components/NumberInput.tsx` | admin | Generic number input |
| `components/DevControlCenter.tsx` | dev only | Shared dev console |
| `lib/api.ts` | all three | Fetch wrapper + mock dispatch |
| `lib/site.ts`, `lib/runtime.ts` | all three | Site resolution (simplifies after the split, see §4) |
| `lib/themes.ts` | all three | The single light theme |
| `lib/pow.ts` | portal + FeedbackFab | Anti-abuse proof-of-work |
| `lib/mock-api.ts` | dev only | |
| `lib/forum-render.ts` | forum | **Rename to `shared/lib/markdown.ts` and promote to shared** — see below |
| `config/app.config.json` + `index.ts` | all three | |

On `forum-render.ts`: the name says "forum" but the content is a generic Markdown renderer (marked + DOMPurify + highlight.js). The portal's `Docs.tsx` has a sanitisation gap (`REFACTOR.md` §8 #4 — `marked.parse` output goes straight to `dangerouslySetInnerHTML`). **Promoting it to shared as `markdown.ts` lets the portal switch to it, closes the gap, and avoids a second duplicate implementation.** This is the natural intersection of the directory split and the defect fix.

### CSS needs splitting too

`portal.css` (388 lines) mixes two concerns:

- Lines 1–235: `portal-*` prefix, portal-only
- Lines 236–386: `mascot-*` prefix, **used by both portal and forum**

Split into `sites/portal/styles.css` + `shared/styles/mascot.css`.

Separately, `index.css` (318 lines) uses `html[data-site="forum"]` selectors for site-conditional styling. After the split each site loads only its own styles, so **those conditional selectors collapse into unconditional rules** — a net simplification.

---

## 3. Target structure

### 3.1 Layering: horizontal, sliced by end inside each layer

There are two ways to slice; this plan chooses **horizontal**:

| | Horizontal (this plan) | Vertical (each end self-contained) |
|---|---|---|
| Shape | `web/sites/<end>/` + `server/src/routes/<end>/` | `app/<end>/{web,server}/` |
| Process | One Fastify process, one Vite build | Still one process (`/auth/callback` spans admin and forum, it cannot be cut) |
| Package boundary | One `package.json` | Requires workspace packages + cross-package exports |
| Boundary enforcement | A `check-boundaries.mjs` script blocks cross-end imports | Structural (a cross-end import fails to resolve) |
| Independent deploy per end | Not supported | Native |
| Migration cost | Low (pure `git mv`) | Medium-high (moving package boundaries drags in the systemd unit, nginx root, and deploy docs) |

**Why horizontal**: all three ends share authentication, share database connections, and share deployment (one systemd service, one port, one machine) — so **independent deployment buys nothing today**. Horizontal already delivers directory isolation, separate build artefacts, and hard cross-end import blocking.

#### 3.1.1 What the field actually does: `apps/` means "deployment unit", not a directory name

I checked the real directory trees of 12 repositories. The finding is sharper than expected.

**The mainstream is indeed `apps/<app>/` + `packages/`** (turborepo / create-t3-turbo / cal.com / supabase / dub / documenso / openstatus), but **the directory name is not the criterion**:

| Repository | Structure | What it shows |
|---|---|---|
| `dubinc/dub` | `apps/web` + `packages/*` | **Only one app, yet still uses `apps/`** — so `apps/` does not mean "multiple applications" |
| `twentyhq/twenty` | `packages/twenty-front` + `packages/twenty-server` | Two applications **inside `packages/`**, not `apps/` |
| `excalidraw/excalidraw` | `excalidraw-app/` at the **root** + `packages/*` | The app sits at the root; `packages/` is entirely publishable libraries |
| `bluesky-social/social-app` | `src/` + `bskyweb/` | **No workspace configuration at all** |
| `documenso/documenso` | `apps/remix` holds the Hono server **and** the React Router UI | **When server and UI ship together, they live in one app** |
| `openstatusHQ/openstatus` | `apps/{checker,private-location}` are **Go services** | `apps/` is a **deployment unit**, not a language unit; 10 apps each with their own `fly.toml`/`vercel.json`/`Dockerfile` |

**The real criterion, induced from the evidence:** `apps/` holds **independently deployable units with their own build artefacts**; `packages/` holds **code reused by several apps or published separately**. The trigger is having ≥2 independent deployment units with differing deployment descriptors.

**This project does not meet that trigger** (measured):

```
nginx:   yangtzeu.work        → proxy_pass 127.0.0.1:3000
         github.yangtzeu.work → proxy_pass 127.0.0.1:3000
systemd: one yzgc-admin.service, ExecStart=node server/dist/index.js
```

All three domains point at **the same process on the same port**; there is exactly one deployment unit. This is not "multiple apps" — it is **one app with three routed surfaces**.

The closest structural analogue is `documenso`, which keeps the Hono server and the UI inside a single `apps/remix` precisely because the two **deploy together**. Same situation here.

**Conclusion**: keep the two packages `web/` + `server/` and slice by end inside each layer. **Do not introduce `apps/`, and do not create `app/`.**

**Upgrade path**: horizontal → vertical is mechanical (move `web/sites/x` and `server/src/routes/x` out, add a `package.json`). Do it when independent deployment actually becomes a requirement.

### 3.2 Frontend

```
web/
  sites/
    portal/
      AGENTS.md  CLAUDE.md  README.md   ← end-specific rules + human-readable notes
      index.html
      main.tsx                    ← the portal branch of the old main.tsx, no detectSite()
      App.tsx                     ← the old PortalRoutes
      styles.css                  ← the portal-* section of portal.css
      components/
        PortalHeader.tsx
      pages/
        Landing.tsx  Docs.tsx  Feedback.tsx  JoinByToken.tsx
    forum/
      AGENTS.md  CLAUDE.md  README.md
      index.html
      main.tsx
      App.tsx
      pages/                      ← the 14 files from pages/forum/
        ForumLayout.tsx  ForumHome.tsx  ...
    admin/
      AGENTS.md  CLAUDE.md  README.md
      index.html
      main.tsx
      App.tsx
      pages/                      ← the 16 files from pages/admin/
        OrgLayout.tsx  MyOrgs.tsx  RepoDetail.tsx  ...
  shared/
    ui/                           ← 9 generic components from components/
      Select.tsx  ConfirmDialog.tsx  NumberInput.tsx  DiffView.tsx
      BackBar.tsx  ImageLightbox.tsx  Mascot.tsx  FeedbackFab.tsx
      DevControlCenter.tsx
    lib/                          ← 7 files from lib/ (forum-render → markdown)
      api.ts  site.ts  runtime.ts  themes.ts  pow.ts  markdown.ts  mock-api.ts
    config/
      app.config.json  index.ts
    styles/
      base.css                    ← the old index.css
      mascot.css                  ← split out of portal.css
  vite.config.ts                  ← multi-entry
  tsconfig.json
```

The move is pure relocation: `git mv` plus updating import specifiers to `@shared/*`. **No logic changes.**

### 3.3 Backend

`server/src` is grouped by end too, but the **process is not split** (`index.ts` still registers every route):

```
server/src/
  index.ts                  ← the only process entry; registers all three ends + static hosting
  config.ts                 ← shared config
  lib/                      ← shared infrastructure, not split by end
    db.ts  crypto.ts  cache.ts  github.ts
    forum-db.ts  forum-auth.ts  forum-github.ts  forum-permissions.ts
    auth.ts                 ← admin OAuth (including the forum dispatch inside /auth/callback)
  middleware/               ← shared middleware
    require-auth.ts  require-org-role.ts    ← used by admin
    require-forum-auth.ts                   ← used by forum
    pow.ts  turnstile.ts                    ← used by public forms
  routes/
    portal/      AGENTS.md   ← docs.ts(2) + join.ts(3) + feedback.ts(3)
    forum/       AGENTS.md   ← the current routes/forum/* moved as-is (10 files, 37 endpoints)
    admin/       AGENTS.md   ← the current routes/admin/* + auth.ts + orgs.ts (42 endpoints)
```

**`routes/portal/feedback.ts` and `routes/admin/feedback.ts` are two sides of one feature**: the former is the public submit entry (used by all three ends), the latter is back-office triage and replies. Changing one means checking the other — noted in both AGENTS.md files.

### 3.4 Location: no new `app/`

The repo root keeps `server/` / `web/` / `docs/` / `scripts/` as-is, **with no `app/` top-level directory**:

- The systemd `ExecStart=/usr/bin/node server/dist/index.js`, the nginx static root, and every path in the deploy docs point at `server/` and `web/`
- Adding an `app/` level only rewrites existing path prefixes; the organisational benefit is identical to the horizontal layering in §3.1
- If the project later moves to vertical slicing (each end self-contained), `app/` becomes meaningful then — because it will genuinely hold workspace packages

### 3.5 What each end's AGENTS.md covers

#### 3.5.1 Loading semantics (measured, not assumed)

First, one fact the industry gets wrong when guessing: **a subdirectory AGENTS.md is not read automatically**, and tools disagree with each other.

| Tool | Behaviour | Source |
|---|---|---|
| **agents.md spec** | "Closest wins" — `The closest AGENTS.md to the edited file wins` | https://agents.md |
| **OpenAI Codex** | Collects every AGENTS.md **from the project root down to cwd** and concatenates; `We do not walk past the project root` | `openai/codex:codex-rs/core/src/agents_md.rs` |
| **Claude Code** | Loads cwd and its **ancestors**, concatenated; subdirectory files load **on demand** — `included when Claude reads files in those subdirectories` | https://code.claude.com/docs/en/memory |
| **Gemini CLI** | The only one that **scans downward** (JIT: when a file is accessed, its directory and ancestors are scanned), capped by `context.discoveryMaxDirs` (default 200) | `google-gemini/gemini-cli:docs/cli/gemini-md.md` |

Two consequences that matter:

1. **Do not assume an end-level file enters context on its own.** Codex working at the repo root will not read `web/sites/forum/AGENTS.md`; Claude only loads it once a file in that directory is actually opened. **The root file must point the way explicitly.**
2. **Tools *concatenate*, they do not *override*.** Codex: `concatenate their contents in that order`; Claude: `concatenated into context rather than overriding each other`. "Closest wins" rests on ordering plus convention, **not on deduplication**. Therefore **end-level files must be deltas — duplicated content enters context twice.**

#### 3.5.2 The root file carries a delegation table (copied from supabase)

The closest real-world analogue to this project is `supabase/supabase`: its root `AGENTS.md` annotates each directory in a Structure table with whether it has its own AGENTS.md, then adds one explicit instruction at the end.

Its own wording:

```
| `apps/studio` | Supabase Studio/Dashboard — has its own `apps/studio/AGENTS.md` (see below) |
```

```
## Studio
Before working on anything in `apps/studio`, read `apps/studio/AGENTS.md` if it isn't
already in context — it maps Studio tasks to required skills and covers the TanStack
Start migration rules.
```

**This is the only reliable fix for "Codex does not scan downward."** This project follows suit: the root `AGENTS.md` gains a delegation section pointing at the six end-level files, each with a line saying "read X before working here, and open it if it is not already in context."

Other real forms worth comparing:

| Repository | Form |
|---|---|
| `supabase/supabase` | Root delegation table + 3 nested files (`apps/{studio,docs,kb}/AGENTS.md`) |
| `openstatusHQ/openstatus` | Root delegation table + 8 nested files (`apps/*/AGENTS.md`, `packages/*/AGENTS.md`) |
| `vercel/ai` | Root + `apps/docs/AGENTS.md`, `packages/ai/AGENTS.md` |
| `openai/codex` | Root file only, using `##` sections (their own repo skips nesting) |
| `microsoft/vscode` | Root file only, a 3-line pointer |

#### 3.5.3 Division of labour for the end-level files

**One hard rule: any given fact appears in exactly one place.** Cross-end facts go in the root; end-specific facts go in the end file. Duplication is a violation — tools concatenate rather than override, so a repeated fact enters context twice.

| File | Write only this (the end's delta) |
|---|---|
| `web/sites/portal/AGENTS.md` | The `portal-*` style namespace, why it does not use React Query, no auth concept, the `portal.css` boundary |
| `web/sites/forum/AGENTS.md` | Forum session `forum_sid`, `forum.db` ownership, archive read-only (`is_legacy`), the fact that only 2 permission rows are enforced |
| `web/sites/admin/AGENTS.md` | The `requireAuth` + `requireOrgRole` + `audit()` triple, calling GitHub with the signed-in user's token, `data.db` ownership |
| `server/src/routes/portal/AGENTS.md` | Rate limiting and Turnstile for unauthenticated endpoints, the feedback two-sides relation |
| `server/src/routes/forum/AGENTS.md` | `forum.db` is additive-only, current state of permission checks, where archive read-only is enforced |
| `server/src/routes/admin/AGENTS.md` | The middleware triple, `audit()` writes, the single service-token exception (public invite links) |

End-level files **do not** contain: a full map of the end's directories (the root already has the overall layout), cross-end invariants, global commands (`pnpm install` / `pnpm -r run build`), or the deploy procedure.

Follow the actual shape of `supabase/supabase:apps/studio/AGENTS.md`: a one-line self-description (what this end is, which stack, which port) → sections of end-specific rules → no restatement of anything in the root file.

#### 3.5.4 Bridge files and format

- **AGENTS.md has no frontmatter convention.** Per agents.md: `No. AGENTS.md is just standard Markdown. Use any headings you like.` Frontmatter belongs to Cursor `.cursor/rules/*.mdc` and Claude `.claude/rules/*.md` — a different mechanism; do not mix it in.
- **A root `CLAUDE.md` containing `@AGENTS.md` is Anthropic's official recommendation** (`create a CLAUDE.md that imports it so both tools read the same instructions without duplicating them`), which is what this repo already does. The official alternative is `ln -s AGENTS.md CLAUDE.md` — `vercel/ai` does exactly that at its root (git mode `120000`), while the same repo's `apps/docs/CLAUDE.md` uses `@AGENTS.md`. Both are mainstream.
- **Each end directory also gets a `CLAUDE.md`** containing `@AGENTS.md`. Reason: Claude loads subdirectory files **on demand**, so having the bridge makes the behaviour deterministic; `vercel/ai` does this in `apps/docs/`. The cost is six one-line files.
- `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/copilot-instructions.md`, and `CONVENTIONS.md` stay as they are: thin pointers plus a summary, aimed at the root `AGENTS.md`. End directories do not need a copy for every tool.

### 3.6 Docs do not scatter into the ends

End-specific design docs live in **a subfolder of the root `docs/`**, not in `app/<end>/docs/`:

```
docs/
  INDEX.md  README.md
  conventions/  design/  architecture/  plan/  ops/     ← cross-end docs (current state)
  portal/  forum/  admin/                                ← end-specific design docs (create on demand)
```

Rationale: keeping docs in one place is what lets `scripts/docs-index.mjs` scan everything; scattering them into the ends would require multi-root scanning and would break the human entry point ("what to read for what"). End-specific docs are **created only when genuinely needed** and linked from `docs/README.md` — no pre-emptive empty folders.

---

## 4. Boundary rules (must hold after the split)

| Allowed | Forbidden |
|---|---|
| `sites/*` → `shared/*` | `sites/portal` → `sites/forum` (in any form) |
| `shared/*` → `shared/*` | `shared/*` → `sites/*` (the shared layer must not depend on a site) |
| Free references within one `sites/*` | `sites/forum` → `sites/admin` |

Cross-site navigation always goes through `externalUrl(target, path)`. Today this relies on discipline — `REFACTOR.md` §8 #1 is a live violation (a broken link in production). After the split it needs an automatic check.

**Recommended enforcement: a script with no third-party dependency** (the repo currently has no eslint, husky, or CI, and adding a whole lint toolchain is a separate change):

```
scripts/check-boundaries.mjs
  · walks every import under sites/
  · exits 1 with file and line number on a cross-site path
    or a shared → sites reverse dependency
  · wired in as a build prerequisite:
    "build": "node scripts/check-boundaries.mjs && tsc -b && vite build"
```

This adds no dependency tree, introduces no toolchain, and still hard-fails the build on a cross-site import. Revisit eslint only if finer rules are needed later (e.g. banning `marked` in admin).

---

## 5. Build and serving

### 5.1 Multi-entry, single build

```ts
// web/vite.config.ts
build: {
  rollupOptions: {
    input: {
      portal: resolve(__dirname, "sites/portal/index.html"),
      forum:  resolve(__dirname, "sites/forum/index.html"),
      admin:  resolve(__dirname, "sites/admin/index.html"),
    },
  },
}
```

Output: three HTML files, per-site entry chunks, and shared chunks that Rollup extracts automatically (React and react-query appear once). **The portal stops downloading the forum and admin code** — the most direct win of this plan.

Details: `base: "/"`, content-hashed asset filenames, and all three HTML files sharing one `/assets/` directory (hashes do not collide). This way the HTML works whether the forum ends up on a subdomain or stays at `/forum`.

### 5.2 Server dispatch by host/path

Today `setNotFoundHandler` (`server/src/index.ts:60-70`) returns the same `index.html` for every unmatched path. It becomes:

```
github.yangtzeu.work         → admin's index.html
yangtzeu.work under /forum   → forum's index.html
yangtzeu.work otherwise      → portal's index.html
```

`/api`, `/auth`, and `/healthz` keep their current 404 behaviour.

---

## 6. Three decisions needed

### Decision 1: does the forum end up on a subdomain or stay at `/forum`?

| | Subdomain `forum.yangtzeu.work` | Path `yangtzeu.work/forum` |
|---|---|---|
| Today | Declared in config, but no DNS / nginx / certificate exists | Actually running, via the `basename` fallback |
| After the split | All three sites are peers; `portalForumFallback` and `basename` can be deleted | `basename="/forum"` and the path special case in `site.ts` stay forever |
| Cost | DNS A record + certificate + nginx server block (fully documented in `deploy/forum-subdomain-setup.md`) | Zero, but a permanent special case in site resolution |

**Recommendation: enable the subdomain.** Once the three sites are peers, the path special case in `lib/site.ts` can be deleted outright — a direct, visible win for "low coupling". The multi-entry build works either way, so this does not block the split; it can be decided after.

### Decision 2: stop at folders, or go all the way to workspace packages?

**Settled in §3.1: this plan takes horizontal layering (folders) and does not split into workspace packages.** The rationale, the comparison of both slicing styles, and the trigger for upgrading all live in §3.1. The decision is folded into the target structure and is not repeated here.

### Decision 3: should `shared/ui` be subdivided per site?

`Mascot` is used by portal + forum only, `FeedbackFab` by forum + admin only, `DiffView` / `NumberInput` by admin only. Subdividing into `shared/ui/common` (Select, ConfirmDialog) plus site-specific buckets is possible but low-value.

**Recommendation: do not subdivide.** At nine components, an extra directory level costs more in navigation than it saves. Revisit past twenty.

---

## 7. Execution plan (4 phases, each independently verifiable)

| Phase | Work | Verification |
|---|---|---|
| **P0 Fix defects first** | Fix `REFACTOR.md` §8 #1 (forum dead link) and #4 (Docs sanitisation gap). #4 is the same change as promoting `markdown.ts` to shared | In a browser, clicking "使用文档" from the forum reaches the portal; the docs site still renders |
| **P1 Build the skeleton** | Create `sites/` and `shared/`; `git mv` everything; update import specifiers; add `check-boundaries.mjs` and wire it into the build | Boundary script passes; `pnpm --filter @yzgc/web build` succeeds; walk every page in local dev |
| **P2 Split the build** | Three `index.html` files + multi-entry Vite config; split `App.tsx` / `main.tsx` three ways; server dispatches by host | Build emits three entries; all three sites verified live; compare per-site first-load JS before and after |
| **P3 Clean up** | Delete the path special case in `site.ts` (depends on decision 1), delete `data-site` conditional selectors, delete dead `detectSite()` branches | Full regression; confirm no cross-site imports or dead links remain |

**Nothing is deployed between P1 and P2** — the intermediate state (files moved, build not yet split) is fully functional, so it can be validated locally before going out.

Risks:

- During the move, dev and production builds must update path aliases together, or `tsc -b` will fail on alias resolution. Define `@shared/*` in tsconfig `paths` and mirror it in Vite `resolve.alias`, keeping one source of truth.
- Under a multi-entry build, Vite's HTML output paths follow conventions that must be confirmed empirically at the start of P2, before the server dispatch logic is written.

---

## 8. Explicitly out of scope

- **Do not merge the databases.** Two DBs and two connections are a natural boundary; merging only adds coupling.
- **Do not add a site dimension to the backend.** The `/api/forum/*` and `/api/admin/:org/*` prefixes are already clear; a site parameter would be a needless abstraction.
- **Do not unify authentication in this effort.** Merging the three credential systems (`sid` / `forum_sid` / Bearer PAT) is incompatible by design — the forum allows password users with no GitHub account, unlike admin's OAuth-only model. Scope it as its own project; start only with removing the unenforced permission records.
- **Do not introduce eslint / prettier / husky.** Boundaries are guarded by a dependency-free script; formatting follows existing convention. Adding a toolchain should be its own change with its own justification.
- **Do not create an `app/` top-level directory, and do not split into workspace packages.** Rationale in §3.1 and §3.4: all three ends share authentication and deployment, so independent deployment buys nothing today; adding an `app/` level only rewrites path prefixes while dragging in the systemd unit, nginx root, and deploy docs. Upgrade when independent deployment is actually needed.
