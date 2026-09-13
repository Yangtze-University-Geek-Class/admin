# geek_main

Unified workspace for the Yangtze University Geek Class portal, forum and GitHub organization administration. Package identities remain `@yzgc/web` and `@yzgc/server`.

The core portal/admin remain React/Fastify. The forum directly adopts MIT-licensed Tuff Forum under modules/forum as an independent Nuxt/Vue/TuffEx package. The old forum source and tests are archived and its database is left untouched. Start with the [documentation hub](docs/README.md) or [agent entry](AGENTS.md). The Chinese documents are canonical; this English entry is an overview, not an independent rule set.

Node 22 (at least 22.13), pnpm 9.15.9. From the repository root, use `pnpm install --frozen-lockfile`, `pnpm dev:web`, `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm verify`. Browser checks use `pnpm test:e2e` after installing Playwright browsers. The forum separately requires Node >=26 / pnpm 11.24.0. Root forum:* commands handle its installation, checks, generation and browser verification; pnpm verify orchestrates both packages.

Tests inject real application routes with isolated databases and stubbed external clients. Core mock previews are read-only. Upstream Tuff Forum permits browser-local demo interactions, but has no real authentication or backend. The authenticated internal Hub and production forum integration are not complete. Do not use production credentials/data for testing, and do not treat local validation as deployment authorization.
