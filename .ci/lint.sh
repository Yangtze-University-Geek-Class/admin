#!/usr/bin/env bash
# lint：纯静态与文档一致性检查（不跑编译器、不跑用例）。
. "$(dirname "$0")/_node22.sh"
pnpm check:runtime
pnpm check:site-config
pnpm check:environments
pnpm check:boundaries
node scripts/docs-index.mjs --check
node scripts/check-docs.mjs
node scripts/tuffex-docs.mjs check
