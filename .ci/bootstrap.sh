#!/usr/bin/env bash
. "$(dirname "$0")/_node22.sh"
node -v
pnpm --version
pnpm install --frozen-lockfile
