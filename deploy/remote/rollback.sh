#!/usr/bin/env bash
# 目标机回滚脚本：把 current 切回一个已经存在且能通过校验的历史发布包。
#
# 前置条件与 deploy-release.sh 相同（非 root 部署用户、Node 22 >=22.13、pnpm 9.15.9 且 PATH 可见、
# sudoers 只放行 systemctl restart <服务名>）。pnpm 是必需项：切换 current 之前要按锁文件重建目标版本的生产依赖。
# 回滚是「部署一个已确认的历史产物」，不移动 tag、不修改版本、不触碰数据库；数据库不兼容时必须停下来由人处理。
#
# 书写约定：中文消息里紧跟变量的全角标点（，；：）必须写成 ${VAR} 花括号形式。
# bash 3.2 在 UTF-8 locale 下会把多字节字符当成变量名的一部分，set -u 会误报 unbound variable。
set -euo pipefail

ENVIRONMENT=""; DEPLOY_ROOT=""; SERVICE=""; TO=""; PUBLIC_ORIGIN=""; LOCAL_HEALTH=""
HEALTH_ATTEMPTS=20
HEALTH_INTERVAL=3
HEALTH_TIMEOUT=10

usage() {
  cat >&2 <<'USAGE'
用法：rollback.sh --environment <preview|production> --deploy-root <目录> --service <systemd 服务名>
                 --to <releaseId|previous> --public-origin <https://域名>
                 --local-health <http://127.0.0.1:端口/healthz>
所有参数必填。--to previous 表示回到 previous 符号链接指向的版本。
--environment 不是显示用的标签：releaseId 在 preview 与 production 完全相同，必须由它断言目标产物与线上身份。
切换 current 之前会自检目标目录的校验器、重新 verify 产物，并用 pnpm install --prod --frozen-lockfile 重建生产依赖。
目标机需有 Node 22（>=22.13）与 pnpm 9.15.9，且能访问 registry。
USAGE
}

die() { printf '回滚失败：%s\n' "$1" >&2; exit 1; }
require_match() {
  # $1=值 $2=正则 $3=参数名；bash 的 =~ 锚定整个字符串。
  if [[ ! "$1" =~ $2 ]]; then die "参数 $3 取值非法"; fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --environment) ENVIRONMENT="${2-}"; shift 2 ;;
    --deploy-root) DEPLOY_ROOT="${2-}"; shift 2 ;;
    --service) SERVICE="${2-}"; shift 2 ;;
    --to) TO="${2-}"; shift 2 ;;
    --public-origin) PUBLIC_ORIGIN="${2-}"; shift 2 ;;
    --local-health) LOCAL_HEALTH="${2-}"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) usage; die "未知参数 $1" ;;
  esac
done

for name in ENVIRONMENT DEPLOY_ROOT SERVICE TO PUBLIC_ORIGIN LOCAL_HEALTH; do
  # bash 间接展开，不使用 eval。
  [ -n "${!name}" ] || { usage; die "缺少参数 $name"; }
done

require_match "$ENVIRONMENT" '^(preview|production)$' --environment
require_match "$DEPLOY_ROOT" '^/[A-Za-z0-9._/-]{1,200}$' --deploy-root
require_match "$SERVICE" '^[A-Za-z0-9@._-]{1,120}$' --service
require_match "$TO" '^(previous|(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-[a-f0-9]{12})$' --to
require_match "$PUBLIC_ORIGIN" '^https://[a-z0-9.-]{3,120}$' --public-origin
require_match "$LOCAL_HEALTH" '^http://127\.0\.0\.1:[0-9]{2,5}/[A-Za-z0-9._/-]*$' --local-health

[ -d "$DEPLOY_ROOT" ] || die "部署根目录不存在：$DEPLOY_ROOT"
command -v node >/dev/null 2>&1 || die "目标机缺少 node"
command -v pnpm >/dev/null 2>&1 || die "目标机缺少 pnpm，无法按锁文件重建目标版本的生产依赖"
command -v curl >/dev/null 2>&1 || die "目标机缺少 curl"
command -v flock >/dev/null 2>&1 || die "目标机缺少 flock，无法串行化回滚"
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 \
  || die "目标机缺少 sha256sum/shasum，无法自检目标版本的校验器"

RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
PREVIOUS_LINK="$DEPLOY_ROOT/previous"
HISTORY_LOG="$DEPLOY_ROOT/deploy-history.log"
LOCK_FILE="$DEPLOY_ROOT/.deploy.lock"

# 与部署共用同一把锁：回滚期间不允许有部署在切换 current。
exec 9>"$LOCK_FILE"
flock -w 900 9 || die "未能取得部署锁（900 秒超时），可能有部署正在进行"

if [ "$TO" = "previous" ]; then
  [ -L "$PREVIOUS_LINK" ] || die "没有 previous 记录，无法自动回滚"
  TARGET_DIR="$(readlink -f "$PREVIOUS_LINK")"
else
  TARGET_DIR="$(readlink -f "$RELEASES_DIR/$TO" 2>/dev/null || true)"
fi
[ -n "$TARGET_DIR" ] && [ -d "$TARGET_DIR" ] || die "目标版本目录不存在：${TO}"
case "$TARGET_DIR" in
  "$RELEASES_DIR"/*) : ;;
  *) die "目标版本必须位于 $RELEASES_DIR 之内" ;;
esac

sha256_of() {
  # $1=文件路径；只输出 64 位十六进制摘要。
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

json_field() {
  node -e 'const fs=require("node:fs");const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=o[process.argv[2]];if(typeof v!=="string"){process.exit(3);}process.stdout.write(v);' "$1" "$2"
}

json_true() {
  # $1=JSON 文件 $2=字段名；字段必须严格等于布尔 true。不用 grep 'ok'，任意正文出现 ok 都会误判为健康。
  node -e 'const fs=require("node:fs");let o;try{o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}catch{process.exit(3);}if(o[process.argv[2]]!==true){process.exit(3);}' "$1" "$2"
}

RELEASE_JSON="$TARGET_DIR/release.json"
[ -f "$RELEASE_JSON" ] || die "目标版本缺少 release.json：$TARGET_DIR"
TARGET_ENVIRONMENT="$(json_field "$RELEASE_JSON" environment)"
TARGET_COMMIT="$(json_field "$RELEASE_JSON" commit)"
TARGET_RELEASE_ID="$(json_field "$RELEASE_JSON" releaseId)"
TARGET_PUBLIC_ORIGIN="$(json_field "$RELEASE_JSON" publicOrigin)"

# releaseId 只由 baseVersion 与短 SHA 组成，同一提交在两个环境下完全相同；
# 必须用调用方显式声明的 --environment / --public-origin 断言产物身份，不能拿产物自报的值自证。
[ "$TARGET_ENVIRONMENT" = "$ENVIRONMENT" ] || die "目标版本的 environment 是 ${TARGET_ENVIRONMENT}，与 --environment $ENVIRONMENT 不一致"
[ "$TARGET_PUBLIC_ORIGIN" = "$PUBLIC_ORIGIN" ] || die "目标版本的 publicOrigin 是 ${TARGET_PUBLIC_ORIGIN}，与 --public-origin $PUBLIC_ORIGIN 不一致"

# 回滚用的校验器就在目标目录里（scripts/release-bundle.mjs）。node 执行空文件的退出码是 0，
# 所以该文件一旦被清空，下面的 verify 会静默通过，闸门等于不存在。
# 因此先做校验器自检：三个校验器脚本必须非空，且 sha256 等于同目录 MANIFEST.sha256 中登记的值。
# 这只是把信任基点从「校验器文件本身」提升到「校验器 + 清单一致」；MANIFEST 与校验器被同时改写
# 仍然无法发现。最终防线是部署时 CI 端已核对过 tar 的 sha256，本自检不替代它。
MANIFEST_FILE="$TARGET_DIR/MANIFEST.sha256"
[ -s "$MANIFEST_FILE" ] || die "目标版本的校验器与清单不一致：缺少 MANIFEST.sha256，拒绝用它自证"
for checker in scripts/release-bundle.mjs scripts/release-policy.mjs scripts/deployment-environment.mjs; do
  checker_path="$TARGET_DIR/$checker"
  [ -s "$checker_path" ] || die "目标版本的校验器与清单不一致：${checker} 缺失或为空文件，拒绝用它自证"
  # MANIFEST 行格式固定为 <64 位 sha256><两个空格><相对路径>；整行精确匹配后取第一列，避免子串误配。
  checker_pattern="$(printf '%s' "$checker" | sed 's/[].[^$*+?(){}|\\]/\\&/g')"
  declared_sha="$(grep -E -m 1 "^[0-9a-f]{64}  ${checker_pattern}\$" "$MANIFEST_FILE" | cut -d' ' -f1 || true)"
  [ -n "$declared_sha" ] || die "目标版本的校验器与清单不一致：MANIFEST.sha256 里没有 ${checker} 的登记行，拒绝用它自证"
  actual_sha="$(sha256_of "$checker_path")"
  [ "$actual_sha" = "$declared_sha" ] \
    || die "目标版本的校验器与清单不一致：${checker} 的 sha256 与 MANIFEST 登记值不符，拒绝用它自证"
done

# 回滚同样要重新校验历史产物，不信任磁盘上的目录没被改过。
# 期望环境取自 --environment 而非 release.json 自身，否则改了 release.json 的产物会自洽通过。
if ! (cd "$TARGET_DIR" && node scripts/release-bundle.mjs verify --dir "$TARGET_DIR" --expect-environment "$ENVIRONMENT" --expect-commit "$TARGET_COMMIT" >&2); then
  die "目标版本校验失败，拒绝回滚到已被改动的产物"
fi
# 已部署目录必然含 deploy-release.sh 装出的 node_modules；verify 会整棵跳过它，两个条件不再互斥。
[ -d "$TARGET_DIR/node_modules" ] || die "目标版本没有已安装的生产依赖，请用 deploy-release.sh 重新安装该产物"

# verify 整棵跳过 node_modules，所以它只证明源码文件完好，证明不了依赖树没被改过。
# 切换 current 之前按锁文件重装一次生产依赖：pnpm 是内容寻址的，会把被改动的包恢复成锁文件登记的版本。
# 需要目标机可访问 registry；--prefer-offline 让已在 store 里的包不重复下载。
if ! (cd "$TARGET_DIR" && pnpm install --prod --frozen-lockfile --prefer-offline >&2); then
  die "目标版本生产依赖无法按锁文件重建，拒绝回滚"
fi

log_history() {
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TARGET_ENVIRONMENT" "$TARGET_RELEASE_ID" "$TARGET_COMMIT" "$1" "$2" >>"$HISTORY_LOG"
}

http_get() {
  curl -sS -o "$2" -w '%{http_code}' --max-time "$HEALTH_TIMEOUT" "$1" 2>/dev/null || printf '000'
}

health_check() {
  # $1=期望 commit $2=期望 releaseId $3=日志标签
  local want_commit="$1" want_release="$2" label="$3" attempt=1 body status remote_commit remote_release remote_environment remote_origin
  body="$(mktemp)"
  while [ "$attempt" -le "$HEALTH_ATTEMPTS" ]; do
    status="$(http_get "$LOCAL_HEALTH" "$body")"
    if [ "$status" = "200" ] && json_true "$body" ok; then
      status="$(http_get "$PUBLIC_ORIGIN/healthz" "$body")"
      if [ "$status" = "200" ]; then
        status="$(http_get "$PUBLIC_ORIGIN/release.json" "$body")"
        if [ "$status" = "200" ]; then
          remote_commit="$(json_field "$body" commit || true)"
          remote_release="$(json_field "$body" releaseId || true)"
          # commit/releaseId 不区分环境，线上身份必须连同 environment 与 publicOrigin 一起断言。
          remote_environment="$(json_field "$body" environment || true)"
          remote_origin="$(json_field "$body" publicOrigin || true)"
          if [ "$remote_commit" = "$want_commit" ] && [ "$remote_release" = "$want_release" ] \
            && [ "$remote_environment" = "$ENVIRONMENT" ] && [ "$remote_origin" = "$PUBLIC_ORIGIN" ]; then
            rm -f "$body"; printf '健康检查通过（%s）\n' "$label" >&2; return 0
          fi
          printf '线上 release.json 与期望不一致（commit=%s releaseId=%s environment=%s publicOrigin=%s），重试 %s/%s\n' \
            "$remote_commit" "$remote_release" "$remote_environment" "$remote_origin" "$attempt" "$HEALTH_ATTEMPTS" >&2
        fi
      fi
    fi
    attempt=$((attempt + 1))
    sleep "$HEALTH_INTERVAL"
  done
  rm -f "$body"
  printf '健康检查失败（%s）\n' "$label" >&2
  return 1
}

switch_current() {
  # mv -T 依赖 GNU coreutils（目标 Linux 主机）；先建临时链接再原子替换。
  local target="$1" tmp
  tmp="$DEPLOY_ROOT/.current.$$"
  ln -s "$target" "$tmp"
  mv -T "$tmp" "$CURRENT_LINK"
}

ORIGINAL_TARGET=""
if [ -L "$CURRENT_LINK" ]; then ORIGINAL_TARGET="$(readlink -f "$CURRENT_LINK")"; fi
if [ "$ORIGINAL_TARGET" = "$TARGET_DIR" ]; then
  printf 'current 已经指向 %s，无需回滚。\n' "$TARGET_RELEASE_ID"
  exit 0
fi

restore_original() {
  # $1=失败原因
  local reason="$1" original_commit original_release
  if [ -z "$ORIGINAL_TARGET" ] || [ ! -d "$ORIGINAL_TARGET" ]; then
    log_history FAILED "${reason}；无法恢复原版本"
    die "${reason}；且无法恢复回滚前的版本，服务需要人工介入"
  fi
  printf '回滚失败，正在恢复到回滚前版本：%s\n' "$ORIGINAL_TARGET" >&2
  switch_current "$ORIGINAL_TARGET"
  if ! sudo -n systemctl restart "$SERVICE"; then
    log_history FAILED "${reason}；恢复重启失败"
    die "${reason}；恢复重启失败，服务需要人工介入"
  fi
  original_commit="$(json_field "$ORIGINAL_TARGET/release.json" commit || true)"
  original_release="$(json_field "$ORIGINAL_TARGET/release.json" releaseId || true)"
  if health_check "$original_commit" "$original_release" "回滚前版本"; then
    log_history FAILED "${reason}；已恢复回滚前版本"
    die "${reason}；已恢复到回滚前版本"
  fi
  log_history FAILED "${reason}；恢复后健康检查仍失败"
  die "${reason}；恢复后健康检查仍失败，服务需要人工介入"
}

if [ -n "$ORIGINAL_TARGET" ] && [ -d "$ORIGINAL_TARGET" ]; then
  tmp_prev="$DEPLOY_ROOT/.previous.$$"
  ln -s "$ORIGINAL_TARGET" "$tmp_prev"
  mv -T "$tmp_prev" "$PREVIOUS_LINK"
fi
switch_current "$TARGET_DIR"

if ! sudo -n systemctl restart "$SERVICE"; then restore_original "systemctl restart 失败"; fi
if ! health_check "$TARGET_COMMIT" "$TARGET_RELEASE_ID" "回滚目标 $TARGET_RELEASE_ID"; then restore_original "回滚目标健康检查失败"; fi

log_history ROLLBACK "已切换到 $TARGET_RELEASE_ID"
printf '回滚完成：%s（%s）。回滚不改变 tag、版本或数据库。\n' "$TARGET_RELEASE_ID" "$TARGET_ENVIRONMENT"
