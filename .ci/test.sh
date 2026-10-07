#!/usr/bin/env bash
# test：vitest 全量单测（不含 e2e）。
. "$(dirname "$0")/_node22.sh"
pnpm test
