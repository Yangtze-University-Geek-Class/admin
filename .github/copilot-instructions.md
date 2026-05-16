# Copilot instructions

The canonical rules for this project live in [AGENTS.md](../AGENTS.md). Read it before suggesting changes.

This is a TypeScript monorepo (pnpm workspaces):
- `server/` — Fastify + Octokit + better-sqlite3, ESM, Node 20
- `web/` — Vite + React 18 + Tailwind + TanStack Query

When generating code:
- Use ESM `import` syntax (not CommonJS).
- Tailwind colors are themed via CSS variables — use `text-ink-100`, `bg-brand-500`, etc. Never hardcode hex.
- Replace `<select>` with `<Select>` from `web/src/components/Select.tsx`.
- Replace `window.confirm()` with `useConfirm()` from `web/src/components/ConfirmDialog.tsx`.
- Every new admin API route must have `requireAuth` AND `requireOrgRole("admin"|"member")` preHandlers and must call `audit(...)` on mutations.
- Don't add tests, CI, Docker, i18n, or SSR unless the user asks for them explicitly.

If your suggestion contradicts AGENTS.md, AGENTS.md wins.
