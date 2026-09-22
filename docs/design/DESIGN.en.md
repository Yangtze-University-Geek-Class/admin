# Design — English overview

> English navigation companion; the Chinese document is the canonical current specification.

Status: current. Updated: 2026-09-23.

See [DESIGN.md](DESIGN.md) for the complete current document. This overview does not define a second rule set.

TuffEx is the selected UI foundation. The forum now directly uses its Nuxt/Vue upstream source; existing portal/admin React adapters in app/web remain transitional. Mock forum interactions are browser-local and do not prove real authentication or production readiness. Production rollout, external authentication and operational verification require separate authorization and evidence.
