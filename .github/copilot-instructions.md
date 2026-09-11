# Copilot instructions

The canonical rules for this project live in [AGENTS.md](../AGENTS.md). **Read it before suggesting changes**, and follow its §0: before touching code, find and read the matching document under `docs/` (index: [docs/README.md](../docs/README.md)).

This is a TypeScript monorepo (pnpm workspaces):
- `server/` — Fastify + Octokit + better-sqlite3, ESM, Node 20
- `web/` — Vite + React 18 + Tailwind + TanStack Query, rendering three sites (portal / forum / admin)

When generating code:
- Use ESM `import` syntax (not CommonJS).
- Tailwind colors are themed via CSS variables — use `text-ink-100`, `bg-brand-500`, etc. Never hardcode hex.
- Replace `<select>` with `<Select>` from `web/src/components/Select.tsx`.
- Replace `window.confirm()` with `useConfirm()` from `web/src/components/ConfirmDialog.tsx`.
- Every new admin API route must have `requireAuth` AND `requireOrgRole("admin"|"member")` preHandlers and must call `audit(...)` on mutations.
- Cross-site navigation must go through `externalUrl()` — never a same-site `Link` pointing at another site's route.
- Don't add tests, CI, Docker, i18n, or SSR unless the user asks for them explicitly.

Which doc governs what:
- UI work → `docs/design/DESIGN.md`
- Dependencies / build / versions → `docs/design/STACK.md`
- Frontend layout and site boundaries → `docs/plan/WEB-SPLIT.md`, `docs/plan/REFACTOR.md`
- Backend routes, DB, OAuth → `docs/architecture/ARCHITECTURE.md`
- Commit messages → `docs/conventions/COMMITS.md`

If your suggestion contradicts AGENTS.md, AGENTS.md wins.
