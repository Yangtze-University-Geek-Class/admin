# geek_main

Unified workspace for the Yangtze University Geek Class portal, forum and GitHub organization administration. Package identities remain `@yzgc/web` and `@yzgc/server`.

Strict monorepo: `app/server` (Fastify + SQLite), `app/web` (React/Vite portal + admin) and `app/forum` (MIT-licensed Tuff Forum upstream source on Nuxt/Vue/TuffEx with its own toolchain and lockfile). Service contracts live under [docs/services](docs/services/README.md). Start with the [documentation map](docs/README.md) or the [agent entry](AGENTS.md). The Chinese documents are canonical; this English entry is an overview, not an independent rule set.

Branches: only `main` (production, fed by `stage`) and `stage` (preview) are long-lived. Work happens on `task/<issue>-<slug>` branches created from `stage` and deleted immediately after merge; `dev-<github-username>` branches are personal scratch space and never a credential for entering `stage`. Confirm the current branch before any write (`git branch --show-current`); see [BRANCHING](docs/conventions/BRANCHING.md). Review checklist: [CODE-REVIEW](docs/conventions/CODE-REVIEW.md). Releases are branch-driven — merging `stage` into `main` publishes; no tag flow. See [RELEASES](docs/conventions/RELEASES.md).

Node 22 (at least 22.13), pnpm 9.15.9 for the core. From the repository root, use `pnpm install --frozen-lockfile`, `pnpm dev:web`, `pnpm check`, `pnpm test`, `pnpm build`, and `pnpm verify`. Browser checks use `pnpm test:e2e` after installing Playwright browsers. The forum separately requires Node >=26 / pnpm 11.24.0. Root forum:* commands handle its installation, checks, generation and browser verification; pnpm verify orchestrates both packages.

Delivery is two isolated Docker stacks on one host behind host nginx (TLS termination): production at `/opt/yzgc/production` (`https://yangtzeu.work`) and preview at `/opt/yzgc/preview` (`https://prev.yangtzeu.work`), with images `yzgc/{server,web,forum}:<sha12>`. See [DEPLOY](docs/ops/DEPLOY.md), [ENVIRONMENTS](docs/ops/ENVIRONMENTS.md) and [CICD](docs/ops/CICD.md). Deployment switches default to off.

Tests inject real application routes with isolated databases and stubbed external clients. Core mock previews are read-only. Upstream Tuff Forum permits browser-local demo interactions, but has no real authentication or backend. The authenticated internal Hub and production forum integration are not complete. Do not use production credentials/data for testing, and do not treat local validation as deployment authorization.
