# 公共前导：GitHub ubuntu runner 自带 nvm；快照无 .git，历史类检查在 check.sh 里跳过。
set -euo pipefail
cd "$(dirname "$0")/.."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] || NVM_DIR=/usr/local/share/nvm
. "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || nvm install 22 >/dev/null 2>&1
corepack enable >/dev/null 2>&1 || true
