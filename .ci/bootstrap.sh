#!/usr/bin/env bash
# hub 快照没有 .git：先按 SOURCE_SHA 重建最小索引（快照即该提交的忠实拷贝，
# 重建后 git ls-files 与干净检出等价），再装依赖。后续阶段全部依赖这一步。
. "$(dirname "$0")/_node22.sh"
node -v
pnpm --version
if [ ! -d .git ]; then
  git init -q .
  git config user.email "ci-hub@localhost"
  git config user.name "ci-hub-snapshot"
  git add -A
  git commit -q -m "snapshot ${SOURCE_SHA:-unknown}"
fi
pnpm install --frozen-lockfile
