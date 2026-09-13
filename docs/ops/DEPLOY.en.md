# Deploy — English overview

> English navigation companion; the Chinese document is the canonical current specification.

Status: current. Updated: 2026-09-13.

See [DEPLOY.md](DEPLOY.md) for the complete current document. This overview does not define a second rule set.

Core portal/admin and the adopted Nuxt/TuffEx forum have independent builds. The forum is a browser-only demo without real auth/backend and must not be published as an internal production service. Old database data is preserved and not migrated automatically. Production rollout, external authentication and operational verification require separate authorization and evidence.

Summary only, not the full rule set: remote deploy/rollback scripts (`deploy/remote/deploy-release.sh`, `rollback.sh`) exist as templates and lay out a fixed `$DEPLOY_ROOT/{releases/<releaseId>, current, previous, shared/{.env,data}, incoming, deploy-history.log}` structure, driven by the `deploy` jobs described in [CICD.md](CICD.md). Service names `yzgc-admin` (production) and `yzgc-preview` (preview) are template defaults only and must be confirmed by a maintainer against the real target host before installing either systemd unit. See [DEPLOY.md](DEPLOY.md) §流水线部署布局 for the authoritative Chinese text.
