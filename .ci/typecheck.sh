#!/usr/bin/env bash
# typecheck：全 app TypeScript 编译检查（noEmit）。
. "$(dirname "$0")/_node22.sh"
pnpm typecheck
