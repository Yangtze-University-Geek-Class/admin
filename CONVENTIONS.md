# Conventions (for aider --read CONVENTIONS.md)

Full canonical rules: AGENTS.md.

Stack: pnpm workspaces · Node 20 + Fastify + Octokit + better-sqlite3 (server, TS ESM) · Vite + React 18 + Tailwind (web).

Edit constraints:
1. Tailwind colors are CSS-variable-backed. Hardcoded hex in `web/src/**` is forbidden.
2. UI: use `web/src/components/Select.tsx` instead of native `<select>`; use `useConfirm()` from `web/src/components/ConfirmDialog.tsx` instead of `window.confirm()`.
3. Server: every admin route needs `requireAuth` (file-level hook) AND `requireOrgRole("admin"|"member")` (per-route preHandler). Mutating ops call `audit(org, login, action, target, details, ip)`.
4. Each route uses the logged-in user's `req.session.accessToken` to call GitHub. Service tokens are reserved for the public invite-link flow only.
5. SQLite schema: only additive (`ALTER TABLE ADD COLUMN`). Never drop. Never reorder.
6. Update relevant doc(s) in the SAME commit as the code change:
   - new/changed route → docs/ARCHITECTURE.md
   - new env var → .env.example + docs/DEPLOY.md
   - new DB column → docs/ARCHITECTURE.md (+ DEPLOY if migration)
   - user-visible feature → docs/USAGE.md
   - build/dev command → README.md + AGENTS.md §3
