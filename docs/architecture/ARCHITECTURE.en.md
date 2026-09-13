# Architecture — English overview

> English navigation companion; the Chinese document is the canonical current specification.

Status: current. Updated: 2026-09-12.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the complete current document. This overview does not define a second rule set.

The core portal/admin remain React/Fastify; modules/forum directly adopts the independent Nuxt/Vue/TuffEx source. Core mocks are read-only, while upstream forum interactions are browser-local demos without real auth/backend. Use separate core and forum checks from the root. Production rollout, external authentication and operational verification require separate authorization and evidence.
