# Deploy — English overview

> English navigation companion; the Chinese document is the canonical current specification.

Status: current. Updated: 2026-09-23.

See [DEPLOY.md](DEPLOY.md) for the complete current document. This overview does not define a second rule set.

Two isolated Docker stacks run on the same host behind a host nginx that terminates TLS: production at `/opt/yzgc/production` (`main`, `https://yangtzeu.work`, web bound to 127.0.0.1:18100) and preview at `/opt/yzgc/preview` (`stage`, `https://prev.yangtzeu.work`, web bound to 127.0.0.1:18200). Each stack has its own compose project, named data volume, ports, secrets and domains. Images are `yzgc/{server,web,forum}:<sha12>`; the tag is written into `<STACK_ROOT>/.env.<environment>` as `IMAGE_TAG`. CI builds and ships images (`docker save`/`docker load`), then `deploy/remote/deploy-stack.sh` verifies the image digest, installs the env file atomically (mode 600), runs `docker compose up -d` and gates on `/healthz` for both server and web (auto-rollback on failure); `deploy/remote/rollback-stack.sh --to <sha12|previous>` rewrites only `IMAGE_TAG`. `deploy/nginx/{production,preview}.conf` are the host server blocks; `/release.json` is baked into the web image. The former systemd / `/opt/yzgc-admin` / release-bundle layout has been deleted and is historical only. The stack is not yet verified on the real target host: a template is not a completed deployment.
