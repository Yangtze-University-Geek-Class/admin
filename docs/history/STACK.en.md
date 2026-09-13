# Tech Stack and Version Baseline

> 历史材料：旧版本事实、路径和设计，不作为当前实施指令。

状态：`historical` · 标注：2026-09-12

当前版本：[../design/STACK.en.md](../design/STACK.en.md)。

> This document fixes the tech stack and versions adopted after the refactor, plus the **usage notes** for each framework (not a tutorial — "how to use it in this project").
> Version numbers and migration conclusions all come from each project's official docs (verified 2026-09-12); source URLs are listed per section.
> Chinese original: [STACK.md](./STACK.md).

---

## 1. Current State and Goals

### 1.1 Current state (measured from `web/package.json`)

| Package | Current version | Current stable | Gap |
|---|---|---|---|
| React / react-dom | `^18.3.1` | **19.3** (2026-09-09) | Major |
| Vite | `^6.0.7` | **8.3.0** (8.0 = 2026-03-12) | Two majors behind |
| `react-router-dom` | `^7.1.1` | **`react-router` 8.3.1** | Package removed |
| `@tanstack/react-query` | `^5.62.11` | **5.102.8** | Same major |
| Tailwind CSS | `^3.4.17` | **4.3.3** (4.0 = 2025-01-22) | Major |
| TypeScript | `^5.7.2` | **7.0.2** (6.0 = 2026-03-23) | Two majors behind |
| Node (build) | `engines: >=18` | — | See §2 |

### 1.2 Three hard couplings (they force a grouped upgrade)

1. **React Router 8 mandates React ≥ 19.2.7 and Node ≥ 22.22** → React 19 and RR8 must be upgraded as one package.
2. **Vite 8 requires Node ≥ 20.19 / 22.12**.
3. **The Tailwind upgrade tool requires Node ≥ 20**.

The project root's `engines.node: ">=18"` conflicts with all three. **Raising the Node baseline to 22 LTS comes first — it is a prerequisite.**

Note the production server (`103.117.123.226`) currently runs **Node 20.20.2**. Before upgrading, confirm the server's Node version satisfies the new baseline, otherwise the build output and the runtime fall out of sync.

### 1.3 No blockers

`@tanstack/react-query`'s peer range is `react: ^18 || ^19`; it **does not block the React upgrade** — a same-major bump is enough. Do not rewrite the data layer while you are at it.

---

## 2. Target Version Set

| Package | Target | Action |
|---|---|---|
| Node (build + runtime) | **22 LTS** | Prerequisite; includes the server and CI |
| React / react-dom | **19.3** | Major upgrade + ref type fixes |
| `@types/react` / `@types/react-dom` | **19.x** | Follows React |
| `react-router` (drop `-dom`) | **8.3.1** | Remove the package + rewrite every import path, **stay in Declarative mode** |
| Vite | **8.3.0** | Read the v7 guide before the v8 migration guide |
| `@vitejs/plugin-react` | **v6** | Oxc-based React Refresh, no longer depends on Babel |
| Tailwind CSS | **4.3.3** | Rewrite tokens with `@theme inline`; delete postcss / autoprefixer / config |
| `@tanstack/react-query` | **5.102.8** | Rolling upgrade |
| TypeScript | **6.0.x → 7.0.2** | Two steps; do not skip 6.0 |
| Component base | **shadcn/ui (radix base)** | See [DESIGN.md](./DESIGN.md) §4 |

### 2.1 Upgrade order

Dependencies dictate the order; it cannot be reordered:

```
0. Node 22 (local + server)
1. TypeScript 5.7 → 6.0        ← get the new defaults and the hard-error list first
2. Tailwind 3.4 → 4.3          ← independent, can run in parallel with anything else
3. React 18 → 19.3  ⟺  react-router 7 → 8   ← must happen in the same pass
4. Vite 6 → 7 → 8              ← do the multi-HTML entry split together with the three-site split
5. TypeScript 6.0 → 7.0.2
```

Step 1 comes first because TS 6.0 turns a large batch of implicit problems into explicit errors; handling them after the frameworks are upgraded would double the debugging cost.

---

## 3. Framework Usage Notes

### 3.1 React 19

**What this project will actually use:**

| Feature | Where it is used |
|---|---|
| `<ViewTransition>` | Page-transition animation for the portal home page and the forum list; zero extra dependencies |
| `<Context>` as the Provider directly | Simplifies `ConfirmProvider` and friends |
| `use(Context)` | Can be called after an early return (`useContext` cannot) |
| ref as a prop | No more `forwardRef` |

**Type fixes that are mandatory:**

- `useRef` **now requires an argument** (`useRef<T>(null)`).
- ref callbacks **must not implicitly return**: `ref={el => (x = el)}` becomes a block body `{ ...; }`.
- Official codemods: `npx codemod@latest react/19/migration-recipe`, `npx types-react-codemod@latest preset-19 ./web/src`.

**Ignore:** RSC / Server Actions are opt-in for a pure SPA; the three sites do not adopt them.

**Overlap warning:** Actions / `useOptimistic` and TanStack Query's optimistic updates would fight over the rollback semantics of the same interaction. **Use exactly one per interaction** — this project stays with Query's `onMutate`.

### 3.2 Vite 8

Vite 8 replaces esbuild + Rollup with **Rolldown + Oxc** — the biggest architectural change since Vite 2. Impact on this project:

**Multiple entries (the key to the three-site split):**

```ts
// vite.config.ts
build: {
  rolldownOptions: {                      // note: no longer rollupOptions
    input: {
      portal: resolve(import.meta.dirname, "sites/portal/index.html"),
      forum:  resolve(import.meta.dirname, "sites/forum/index.html"),
      admin:  resolve(import.meta.dirname, "sites/admin/index.html"),
    },
  },
}
```

**Output paths follow the resolved file id, not the `input` object's keys.** That is, `sites/portal/index.html` reliably emits `dist/sites/portal/index.html` — directly mappable to a per-site nginx root, which is why the three-site split can land cleanly.

**Code splitting:** the object form of `manualChunks` is **removed** and the function form is deprecated; use instead:

```ts
output: { codeSplitting: { groups: [ { test: /node_modules/, name: "vendor" } ] } }
```

**This also settles an existing problem:** the repo's `tsconfig.json` has `paths: { "@/*": ["src/*"] }`, but `vite.config.ts` has **no alias at all** — so `@/` does not actually resolve at runtime today. Vite 8 adds `resolve.tsconfigPaths: true`; just switch it on, with no need for `vite-tsconfig-paths`.

**Other migration points:** `commonjsOptions` becomes a no-op; CJS default-import semantics are unified (this project depends on marked / highlight.js / dompurify and needs regression checks); `plugin-legacy` no longer supports downleveling to ES5; `output.format: 'system'|'amd'` is removed.

**Release note:** handle stale-chunk 404s via `vite:preloadError`, and set `Cache-Control: no-cache` on the HTML (`deploy/nginx` already has precedent).

Browser baseline: Chrome/Edge 111, Firefox 114/128, Safari 16.4. Ample for a university-student audience — **`plugin-legacy` is not needed**.

### 3.3 React Router 8

**Of the three modes introduced in v7, this project stays on Declarative:**

| Mode | Usage | This project |
|---|---|---|
| Declarative | `<BrowserRouter>` + `<Routes>` | ✅ **already is; keep it** |
| Data | `createBrowserRouter` + loader/action | ❌ fights TanStack Query for data responsibility |
| Framework | Vite plugin + `routes.ts` + Route Modules | ❌ benefit does not justify the migration cost |

The official criteria explicitly put "**already has its own data-layer abstraction**" under Declarative. This project runs `BrowserRouter` + TanStack Query for all data/cache/pending + its own `lib/api.ts` abstraction — a perfect match.

**v8 breaking changes (only one touches this project):**

`react-router-dom` **is deleted**. DOM-specific APIs are imported from `react-router/dom`; everything else comes from `react-router`.

The repo currently has **39 files** importing from `react-router-dom` (mostly `pages/admin` and `pages/forum`). Do a one-shot bulk replacement, then immediately verify with `tsc -b`.

**Bonus:** v8's `href()` / `generatePath()` now encode per RFC 3986 path-segment rules, so `$ & + , ; = : @` are no longer wrongly escaped. Worth reusing when the three sites use dynamic path params.

### 3.4 TanStack Query 5

**Defaults that must be written into the coding standards:**

| Item | Default | Meaning |
|---|---|---|
| `staleTime` | `0` | Cached data is always considered stale; mount / focus / reconnect all refetch in the background |
| `gcTime` | 5 minutes | Renamed from `cacheTime` in v5 |
| `retry` | 3 times + exponential backoff | Failed queries are retried silently |

This project's `main.tsx` already sets `staleTime: 15_000`, `retry: false`, `refetchOnWindowFocus: false` explicitly — keep them.

**Two special `staleTime` tiers** (the default `0` is in the table above):

- `Infinity` — never refetches automatically, but can still be invalidated by hand via `invalidateQueries`. Good for lookup tables and permissions.
- `'static'` — **not even `invalidateQueries` has any effect**, and `refetchOn*: 'always'` is ignored. Use only for data that never changes at runtime.

**queryKey design rules (usable as a spec as-is):**

- The top level must be an array and must be JSON-serializable.
- **Key order inside an object does not matter** (auto-hashed); **array element order does**: `['todos', status, page]` ≠ `['todos', page, status]`.
- Every variable that can change inside queryFn must go into the key.
- Hierarchical resources: `['todo', 5]` / `['todo', 5, { preview: true }]`; parameterized lists use an object: `['todos', { type: 'done' }]`.

**Project convention**: `['<site>', <org>, '<resource>', { ...params }]`, exported from a single key factory; **no hand-written literals inside pages**.

**The two optimistic-update routes (official criteria):**

- **Displayed in exactly one place → go through the UI**: render a temporary entry from `useMutation`'s `variables` + `isPending`, with no rollback code. Use `useMutationState` across components.
- **Several UIs must stay in sync → go through the cache**: in `onMutate`, `cancelQueries` → snapshot → optimistic write → return the snapshot; roll back in `onError`; `invalidateQueries` unconditionally in `onSettled`.

**Suspense**: `useSuspenseQuery` guarantees `data` is defined, but **cannot enable a query conditionally and has no `placeholderData`**. `throwOnError` only throws when there is no cached data by default, so it must be paired with `QueryErrorResetBoundary`.

**Within-major note**: the repo is on `5.62.11`; before moving to `5.102.x`, **align with the local type definitions first, then rewrite against the official examples** — the mutation callback signatures are now the new shape (`onMutate: async (variables, context)`, `onError(err, variables, onMutateResult, context)`).

### 3.5 Tailwind CSS 4

**v4's core changes: an engine rewrite (3.78× faster builds, 182× incremental), CSS-first config via `@theme`, automatic content detection, built-in `@import` handling and vendor prefixing (you can delete `postcss-import` and `autoprefixer`).**

**The one point that directly conflicts with this project's existing theme system — and the bulk of the upgrade work:**

The `<alpha-value>` placeholder is gone. In the current `tailwind.config.js`:

```js
colors: { ink: { 500: "rgb(var(--ink-500) / <alpha-value>)" } }   // v3
```

It must instead be declared in CSS (**`inline` is mandatory**):

```css
@theme inline {
  --color-ink-500: rgb(var(--ink-500));
}
```

Why `inline` is mandatory: the official docs state plainly that "**when a theme variable references another variable, use inline**; otherwise the utilities reference the theme variable itself and value resolution does not behave as expected". This project is precisely the architecture that mutates `--ink-*` on `<html>` at runtime — `inline` makes the output emit `rgb(var(--ink-500))` directly, which is what keeps `applyTheme()` working.

**Other breaking renames you must audit:**

| v3 | v4 |
|---|---|
| `shadow-sm` → | `shadow-xs` |
| `shadow` → | `shadow-sm` |
| `rounded-sm` → | `rounded-xs` |
| `rounded` → | `rounded-sm` |
| `outline-none` → | `outline-hidden` |
| `ring` → | `ring-3` (default color also changes from `blue-500` to `currentColor`) |
| `blur-sm` → | `blur-xs` |
| `flex-shrink-*` / `flex-grow-*` → | `shrink-*` / `grow-*` |
| `overflow-ellipsis` → | `text-ellipsis` |
| `bg-opacity-*` etc. → | `/50` modifier |

**Four categories that produce visible changes; after upgrading you must do one round of visual checks on each of the three sites:**

1. `border-*` / `divide-*` default color changes from `gray-200` to **`currentColor`** — many cards here use bare `border`/`divide`, and each needs an explicit color.
2. `ring` width 3px → 1px, color → `currentColor`.
3. the shadow / rounded scale renames.
4. the `hover` variant only applies on devices that support hover.

**Also:** the config file is no longer auto-detected (to keep it, add `@config "../../tailwind.config.js"` explicitly); `corePlugins` / `safelist` / `separator` are no longer supported; variant stacking order is now left-to-right (`first:*:pt-0` → `*:first:pt-0`); `!important` moves from `!flex` to `flex!`.

**Upgrade steps:**

```bash
npx @tailwindcss/upgrade          # run it on a new branch and review the diff by hand
pnpm add tailwindcss@latest @tailwindcss/vite@latest
# add the tailwindcss() plugin in vite.config.ts
# replace the three @tailwind lines in index.css with @import "tailwindcss"
# migrate the theme to @theme inline
# delete postcss.config.js / postcss / autoprefixer / tailwind.config.js
```

**Bonus:** 4.3's scrollbar utilities (`scrollbar-thin`, `scrollbar-thumb-*`, `scrollbar-gutter-*`) can replace the existing custom CSS for long forum lists and wide admin tables.

### 3.6 TypeScript 6 → 7

**7.0 is the native Go port** (7.7–11.9× faster builds, −6% to −26% memory). 6.0 is the last JS-based release and is positioned as the bridge.

**Two hard constraints:**

1. **7.0 ships no API** (expected in 7.1). Tools that `import "typescript"` through a peer dependency (typescript-eslint being the classic case) must coexist via an alias:
   ```json
   { "typescript": "npm:@typescript/typescript6@^6.0.2",
     "@typescript/native": "npm:typescript@^7.0.2" }
   ```
2. **7.0 adopts 6.0's new defaults and turns 6.0-deprecated flags into hard errors.** The official line: anything that compiles cleanly under 6.0 should compile to the same result under 7.0. **So upgrade to 6.0 first.**

**Default changes that will hit this project:**

- **`types` defaults to `[]`** — this project's `tsconfig.json` does not declare `types`, so after the upgrade ambient types like `vite/client` will not be injected automatically; verify `src/vite-env.d.ts` or declare them explicitly.
- **`noUncheckedSideEffectImports` defaults to true** — the bare `@import "@fontsource/..."` in `index.css` needs verification.
- `strict` defaults to true (already set explicitly), `module` defaults to `esnext` (already is), `moduleResolution: bundler` no longer forces `module esnext` (this project already matches the recommended combo).

**Upgrade path:** `5.7 → 6.0.x → 7.0.2` — do not jump straight to 7.

---

## 4. Official Documentation Index

| Tool | Official URL |
|---|---|
| React versions | https://react.dev/versions |
| React 19 upgrade guide | https://react.dev/blog/2024/04/25/react-19-upgrade-guide |
| Vite guide | https://vite.dev/guide/ |
| Vite build | https://vite.dev/guide/build.html |
| Vite migration | https://vite.dev/guide/migration |
| Rolldown manual code splitting | https://rolldown.rs/in-depth/manual-code-splitting |
| React Router modes | https://reactrouter.com/start/modes |
| React Router upgrade | https://reactrouter.com/upgrading/v7 |
| TanStack Query | https://tanstack.com/query/latest/docs/framework/react/overview |
| Query Keys | https://tanstack.com/query/latest/docs/framework/react/guides/query-keys |
| Query important defaults | https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults |
| Tailwind v4 upgrade | https://tailwindcss.com/docs/upgrade-guide |
| Tailwind theme | https://tailwindcss.com/docs/theme |
| TypeScript 7.0 | https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ |
| TypeScript 6.0 | https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ |

---

## 5. Open Items and Risks

| Item | Notes |
|---|---|
| Server Node version | The production machine currently runs Node 20.20.2; the new baseline needs ≥ 22.12 (Vite 8) and ≥ 22.22 (RR8). **You must raise the version on the server before upgrading** |
| pnpm version | Currently `pnpm@9.15.9`; compatibility with the new Node / new Vite must be confirmed |
| Dependency regression surface | Vite 8's changed CJS default interop semantics affect marked / highlight.js / dompurify; rendered output must be verified item by item |
| Timing of the component base | shadcn/ui's current docs and CLI **default to Tailwind v4 + Base UI**; Tailwind v3 lives in the legacy docs. **Upgrade Tailwind v4 before pulling in the component base** — see [DESIGN.md](./DESIGN.md) §4 |
