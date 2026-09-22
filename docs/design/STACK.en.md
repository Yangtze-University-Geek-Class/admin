# Stack — English overview

> English navigation companion; the Chinese document is the canonical current specification.

Status: current. Updated: 2026-09-23.

See [STACK.md](STACK.md) for the complete current document. This overview does not define a second rule set.

The core (`app/web` + `app/server`) uses Node 22/pnpm 9 and React/Fastify. The adopted `app/forum` uses independent Node >=26/pnpm 11.24.0, Nuxt 4, Vue 3, Pinia, UnoCSS and TuffEx 0.6.0. Lockfiles and native module ABIs must not be mixed. Persistence is SQLite (better-sqlite3) on a Docker named volume; Postgres has not been migrated. Delivery is Docker images plus Docker Compose stacks (production and preview) with host nginx terminating TLS, not systemd. Production rollout and operational verification require separate authorization and evidence.
