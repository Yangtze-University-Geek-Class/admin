#!/usr/bin/env bash
# hub 快照没有 .git：check:doc-sync / check:notes / check:secrets 依赖 git 历史或 ls-files，
# 由项目自身 push CI 负责；这里跑其余的机器验证子集 + 单测。
. "$(dirname "$0")/_node22.sh"
pnpm check:runtime
pnpm check:site-config
pnpm check:environments
pnpm check:boundaries
node scripts/docs-index.mjs --check
node scripts/check-docs.mjs
node scripts/tuffex-docs.mjs check
pnpm typecheck
pnpm test
