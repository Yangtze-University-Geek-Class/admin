# Splitting the Three Frontend Sites: Target Architecture and Plan

> Status: **awaiting decision** (not executed). Current-state inventory: [REFACTOR.md](./REFACTOR.md).
> Goal: portal / forum / admin become physically isolated at the directory, build-artifact, and dependency levels — changing one site cannot break another.
> 中文：[WEB-SPLIT.md](./WEB-SPLIT.md)

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

```
web/
  sites/
    portal/
      index.html
      main.tsx                    ← the portal branch of the old main.tsx, no detectSite()
      App.tsx                     ← the old PortalRoutes
      styles.css                  ← the portal-* section of portal.css
      components/
        PortalHeader.tsx
      pages/
        Landing.tsx  Docs.tsx  Feedback.tsx  JoinByToken.tsx
    forum/
      index.html
      main.tsx
      App.tsx
      pages/                      ← the 14 files from pages/forum/
        ForumLayout.tsx  ForumHome.tsx  ...
    admin/
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

| | Option A: `web/sites/*` folders (recommended) | Option B: pnpm workspace packages |
|---|---|---|
| Structure | Directories inside one `web` package | `apps/portal`, `apps/forum`, `apps/admin` + `packages/ui`, `packages/core` |
| Dependency declaration | One `package.json` for all three | Each site declares only what it uses |
| Build | One multi-entry Vite config | Three Vite configs |
| Isolation strength | Enforced by the boundary script | Structural (a cross-site import fails to resolve) |
| Migration cost | Low | Medium (shared packages need exports/build handling) |
| Independent deploy | Requires further work | Native |

**Recommendation: do A first.** It captures ~90% of the benefit (directory isolation, separate artefacts, enforced boundaries) at a third of the cost, and **A upgrades to B mechanically** (move `sites/x` out, add `package.json`, turn `shared/*` into `packages/*`). Upgrade when independent deployment actually becomes a requirement.

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
