# Architecture — English overview

> English navigation companion; the Chinese document is the canonical current specification.

Status: current. Updated: 2026-10-18.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the complete current document. This overview does not define a second rule set.

The monorepo has four source applications: `app/web` (React/Vite portal), `app/console` (Vue/Tuffex console), `app/server` (Fastify + SQLite), and `app/forum` (Nuxt/Vue/TuffEx with its independent toolchain). They produce three Docker runtime units: web includes both portal and console assets, server owns the shared business database, and forum serves static frontend assets. Production and preview are isolated stacks; deployment status is verified separately from source capabilities.

The forum frontend uses the core `/api/forum/*` backend for server-side identity, authorization and persistence. Local demo and read-only snapshot modes are separate. Portal, console and forum share GitHub sign-in and a host-only `sid`. SQLite remains the data layer; a Postgres migration has not been done.

Use the [project catalog](catalog/README.md) for generated route, schema, table and capability inventories, linked to their sources. Business ownership is explicitly declared rather than inferred from directory names. The catalog is not production or acceptance evidence.
