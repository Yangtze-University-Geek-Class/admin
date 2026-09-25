# Architecture — English overview

> English navigation companion; the Chinese document is the canonical current specification.

Status: current. Updated: 2026-09-25.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the complete current document. This overview does not define a second rule set.

The strict monorepo has three services: `app/web` (React/Vite portal + admin, Node 22), `app/server` (Fastify + SQLite, Node 22) and `app/forum` (upstream Nuxt/Vue/TuffEx, Node >=26). Each service has its contract under `docs/services/<service>/`. Production and preview are two isolated Docker stacks on the same host (`/opt/yzgc/production`, `/opt/yzgc/preview`) behind a host nginx that terminates TLS. The data layer is still SQLite on a named volume; a Postgres migration has not been done. Portal, console and forum share one GitHub sign-in (one host-only `sid`); only active members of `CONSOLE_ORG` can sign in, and a failed sign-in returns to the starting page with `?signin=<reason>`. Core mocks are read-only; the forum has no backend, and upstream forum interactions remain browser-local demos. Production rollout and operational verification require separate authorization and evidence.
