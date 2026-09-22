# Security — English overview

> English navigation companion; the Chinese document is the canonical current specification.

Status: current. Updated: 2026-09-23.

See [SECURITY.md](SECURITY.md) for the complete current document. This overview does not define a second rule set.

The core portal/admin retain server authentication. Feedback summaries and admin replies are readable anonymously through `GET /api/feedback/public`, so feedback text is treated as public; résumé submissions have no read endpoint. The adopted Nuxt/TuffEx forum currently has mock identity and browser-local storage, not a production security boundary. Legacy forum APIs return 410 and the old forum database is not opened. The production and preview stacks must stay fully isolated (directory, compose project, ports, volumes, secrets, domains) with host-only cookies, and runtime `.env` secrets are injected by CI/CD only — repository templates keep secret fields empty. Production rollout and operational verification require separate authorization and evidence.
