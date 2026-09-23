# Deploy — English overview

> English navigation companion; the Chinese document is the canonical current specification.

Status: current. Updated: 2026-09-24.

See [DEPLOY.md](DEPLOY.md) for the complete current document. This overview does not define a second rule set.

Two isolated Docker stacks run on the same host behind a host nginx that terminates TLS: production at `/opt/yzgc/production` (deployed by a `vX.Y.Z` tag on `main`, `https://yangtzeu.work`, web bound to 127.0.0.1:18100) and preview at `/opt/yzgc/preview` (deployed by a `vX.Y.Z-rc.N` tag on `stage`, `https://prev.yangtzeu.work`, web bound to 127.0.0.1:18200). Pushing a branch deploys nothing; see [RELEASES](../conventions/RELEASES.md). Each stack has its own compose project, named data volume, ports, secrets and domains. Images live in per-environment repositories, `yzgc-production/{server,web,forum}:<sha12>` and `yzgc-preview/{server,web,forum}:<sha12>`, because both stacks share one Docker daemon and the two builds of the same commit differ; the tag is written into `<STACK_ROOT>/.env.<environment>` as `IMAGE_TAG`. CI builds and ships images (`docker save`/`docker load`), then `deploy/remote/deploy-stack.sh` verifies the image digest, installs the env file atomically (mode 600), runs `docker compose up -d` and gates on `/healthz` for both server and web (auto-rollback on failure); `deploy/remote/rollback-stack.sh --to <sha12|previous>` rewrites only `IMAGE_TAG`. `deploy/nginx/{production,preview}.conf` are the host server blocks; `/release.json` is baked into the web image. The former systemd / `/opt/yzgc-admin` / release-bundle layout has been deleted and is historical only. The stack is not yet verified on the real target host: a template is not a completed deployment.
