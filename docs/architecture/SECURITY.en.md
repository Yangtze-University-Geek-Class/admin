# Security — English overview

> English navigation companion; the Chinese document is the canonical current specification.

Status: current. Updated: 2026-09-12.

See [SECURITY.md](SECURITY.md) for the complete current document. This overview does not define a second rule set.

The core portal/admin retain server authentication. The adopted Nuxt/TuffEx forum currently has mock identity and browser-local storage, not a production security boundary. Legacy forum APIs return 410 and its database is not opened. Production rollout, external authentication and operational verification require separate authorization and evidence.
