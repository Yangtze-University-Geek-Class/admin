# Security — English overview

> English navigation companion; the Chinese document is the canonical current specification.

Status: current. Updated: 2026-09-25.

See [SECURITY.md](SECURITY.md) for the complete current document. This overview does not define a second rule set.

The core portal/admin retain server authentication. Sign-in is one GitHub login shared by portal, forum and console; the callback checks the user's own membership in `CONSOLE_ORG` and creates a session only for active members. Non-members and pending invitees get no session (audited as `auth.signin_denied`, and the app's grant is revoked on a best-effort basis) and return to the starting page with `?signin=not_member|invite_pending`; GitHub errors return `?signin=failed` and are never treated as "not a member". A real GitHub round-trip of this flow has not been verified yet. Feedback summaries and admin replies are readable anonymously through `GET /api/feedback/public`, so feedback text is treated as public; résumé submissions have no read endpoint. The adopted Nuxt/TuffEx forum uses the same site-wide login (the upstream mock identity picker remains only in the upstream verification runs and the local sample preview) and has no backend yet, so it is not a production security boundary. Legacy forum APIs return 410 and the old forum database is not opened. The production and preview stacks must stay fully isolated (directory, compose project, ports, volumes, secrets, domains) with host-only cookies, and runtime `.env` secrets are injected by CI/CD only — repository templates keep secret fields empty. Production rollout and operational verification require separate authorization and evidence.
