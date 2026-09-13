#!/usr/bin/env bash
# Repository-only preflight. Publishing is an explicitly authorized runbook operation.
set -euo pipefail

if [[ "${1:-}" != "--check" ]]; then
  printf '%s\n' 'Automatic production installation has been retired.' 'Use --check for repository preflight, then follow docs/ops/DEPLOY.md for an authorized release.' >&2
  exit 2
fi

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
node scripts/check-runtime.mjs
node scripts/check-site-hosts.mjs
for file in deploy/yzgc-admin.service deploy/nginx.conf deploy/nginx-yangtzeu.conf deploy/nginx-security-headers.conf; do
  test -s "$file"
done
printf '%s\n' 'Repository templates present. No services, certificates, databases or system configuration were modified.' 'Actual nginx syntax, TLS paths, service-user permissions and rollback require release-environment verification.'
