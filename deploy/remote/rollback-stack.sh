#!/usr/bin/env bash
# 目标机手工回滚脚本（docker 栈版）：只切 IMAGE_TAG，再 compose up -d。
#
# 它绝不碰数据：不动命名卷、不删数据库、不清理镜像、不执行 down -v。
# 数据卷（<project>-data → server 的 /data）在版本切换前后是同一份。
#
# 用法：
#   rollback-stack.sh --environment <production|preview> --to <sha12|previous>
#
# 参数：
#   --environment <production|preview>  必填
#   --to <sha12|previous>               必填；previous = deploy-history.log 里最近一个与当前不同的版本
#   --env-file <path>                   可选：显式指定 env 文件；默认按顺序查找
#   --stack-root <dir>                  可选：显式指定栈根目录（默认从 env 文件读 STACK_ROOT）
#   --compose-file <path>               可选：显式指定 compose 文件
#   --health-timeout <秒>               可选：健康检查总超时（默认 180）
#
# env 文件查找顺序（取第一个存在的）：
#   --env-file > <--stack-root>/.env.<environment> > /opt/yzgc/<environment>/.env.<environment>
#
# 事实来源：env 文件里的 STACK_ROOT / COMPOSE_PROJECT_NAME / IMAGE_TAG / SERVER_BIND / WEB_BIND。
# 脚本不内联密钥，不猜测端口。
#
# 镜像只从本环境的仓库 yzgc-<environment>/<server|web|forum> 里找；另一环境同一 SHA 的镜像
# 构建参数不同，不能拿来回滚。本机没有目标镜像就停下，由维护者重新分发该版本的本环境归档。
#
# 记录：<STACK_ROOT>/deploy-history.log（追加，制表符分隔）
#   时间(UTC ISO8601)  环境  生效版本  结果  说明
set -euo pipefail

ENVIRONMENT=""
TO=""
ENV_FILE=""
STACK_ROOT_ARG=""
COMPOSE_FILE_ARG=""
HEALTH_TIMEOUT=180
HEALTH_INTERVAL=3
LOCK_TIMEOUT=900

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

usage() {
  cat >&2 <<'USAGE'
用法：rollback-stack.sh --environment <production|preview> --to <sha12|previous>
可选：--env-file <路径> --stack-root <目录> --compose-file <路径> --health-timeout <秒>
USAGE
}

write_history() {
  # $1=结果 $2=该记录对应的生效版本 $3=说明；只记录版本身份，不写任何密钥。
  local note="${3//[$'\n\t']/ }"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ENVIRONMENT" "$2" "$1" "$note" >>"$HISTORY_LOG" 2>/dev/null || true
}

die() {
  if [ -n "${HISTORY_LOG:-}" ] && [ -w "$HISTORY_LOG" ]; then write_history MANUAL_ROLLBACK_FAILED "${TARGET_TAG:-unknown}" "$1"; fi
  printf '回滚失败：%s\n' "$1" >&2
  exit 1
}

require_match() {
  if [[ ! "$1" =~ $2 ]]; then die "参数 $3 取值非法"; fi
}

env_value() {
  local key="$1" file="$2" line="" value=""
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$key"=*) value=${line#*=} ;;
    esac
  done <"$file"
  case "$value" in
    \"*\") value=${value#\"}; value=${value%\"} ;;
    \'*\') value=${value#\'}; value=${value%\'} ;;
  esac
  printf '%s' "$value"
}

http_ok() {
  curl -sS -o "$2" -w '%{http_code}' --max-time 5 "$1" 2>/dev/null || printf '000'
}

health_check() {
  # 先探测、再看是否超时：SECONDS 按整秒跳变，先判断超时的话，跳变正好落在算 deadline 之后时一次都不探测就判失败。
  local label="$1" deadline=$((SECONDS + HEALTH_TIMEOUT)) body status
  body=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$body'" RETURN
  while :; do
    status=$(http_ok "$SERVER_HEALTH_URL" "$body")
    if [ "$status" = "200" ] && grep -q '"ok":true' "$body" 2>/dev/null; then
      status=$(http_ok "$WEB_HEALTH_URL" "$body")
      if [ "$status" = "200" ] && grep -q '"ok":true' "$body" 2>/dev/null; then
        printf '健康检查通过（%s）：%s 与 %s 均返回 ok\n' "$label" "$SERVER_HEALTH_URL" "$WEB_HEALTH_URL"
        return 0
      fi
      printf '等待 web 入口健康（%s）：%s 返回 %s\n' "$label" "$WEB_HEALTH_URL" "$status"
    else
      printf '等待 server 健康（%s）：%s 返回 %s\n' "$label" "$SERVER_HEALTH_URL" "$status"
    fi
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep "$HEALTH_INTERVAL"
  done
}

set_env_image_tag() {
  # $1=env 文件 $2=新 tag；原子替换，失败不留下半截文件。
  local file="$1" tag="$2" tmp
  tmp=$(mktemp "${file}.XXXXXX")
  if grep -q '^IMAGE_TAG=' "$file"; then
    awk -v tag="$tag" '/^IMAGE_TAG=/{print "IMAGE_TAG=" tag; next} {print}' "$file" >"$tmp"
  else
    cat "$file" >"$tmp"; printf 'IMAGE_TAG=%s\n' "$tag" >>"$tmp"
  fi
  chmod 600 "$tmp"
  mv -f "$tmp" "$file"
}

resolve_compose_file() {
  local candidate
  for candidate in \
    "$COMPOSE_FILE_ARG" \
    "$STACK_ROOT/deploy/compose/$ENVIRONMENT.yml" \
    "$STACK_ROOT/compose/$ENVIRONMENT.yml" \
    "$STACK_ROOT/compose.yml" \
    "$SCRIPT_DIR/../compose/$ENVIRONMENT.yml"; do
    [ -n "$candidate" ] && [ -f "$candidate" ] && { printf '%s' "$candidate"; return 0; }
  done
  return 1
}

previous_tag() {
  # 历史里最近一个与当前版本不同的 tag（只认 sha12 形态）。
  local current="$1" lines=() i line tag
  [ -f "$HISTORY_LOG" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do lines+=("$line"); done <"$HISTORY_LOG"
  for ((i = ${#lines[@]} - 1; i >= 0; i--)); do
    tag=$(printf '%s' "${lines[$i]}" | cut -f3)
    [[ "$tag" =~ ^[0-9a-f]{12}$ ]] || continue
    [ "$tag" = "$current" ] && continue
    printf '%s' "$tag"
    return 0
  done
  return 1
}

# ── 参数解析 ──────────────────────────────────────────────────
while [ "$#" -gt 0 ]; do
  case "$1" in
    --environment) ENVIRONMENT="${2-}"; shift 2 ;;
    --to) TO="${2-}"; shift 2 ;;
    --env-file) ENV_FILE="${2-}"; shift 2 ;;
    --stack-root) STACK_ROOT_ARG="${2-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE_ARG="${2-}"; shift 2 ;;
    --health-timeout) HEALTH_TIMEOUT="${2-}"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) usage; die "未知参数 $1" ;;
  esac
done

[ -n "$ENVIRONMENT" ] || { usage; die "缺少 --environment"; }
case "$ENVIRONMENT" in production | preview) : ;; *) usage; die "--environment 只能是 production 或 preview" ;; esac
[ -n "$TO" ] || { usage; die "缺少 --to"; }
require_match "$HEALTH_TIMEOUT" '^[1-9][0-9]{0,3}$' --health-timeout
if [ "$TO" != "previous" ]; then require_match "$TO" '^[0-9a-f]{12}$' --to; fi
IMAGE_REPO="yzgc-$ENVIRONMENT"

# ── 定位 env 文件（唯一事实来源）──────────────────────────────
if [ -z "$ENV_FILE" ]; then
  for candidate in \
    "${STACK_ROOT_ARG:+$STACK_ROOT_ARG/.env.$ENVIRONMENT}" \
    "/opt/yzgc/$ENVIRONMENT/.env.$ENVIRONMENT"; do
    [ -n "$candidate" ] && [ -f "$candidate" ] && { ENV_FILE="$candidate"; break; }
  done
fi
[ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ] || die "找不到 env 文件（用 --env-file 指定，或确认 <STACK_ROOT>/.env.$ENVIRONMENT 存在）"

FILE_ENVIRONMENT=$(env_value GEEK_DEPLOYMENT_ENVIRONMENT "$ENV_FILE")
FILE_STACK_ROOT=$(env_value STACK_ROOT "$ENV_FILE")
COMPOSE_PROJECT_NAME=$(env_value COMPOSE_PROJECT_NAME "$ENV_FILE")
CURRENT_TAG=$(env_value IMAGE_TAG "$ENV_FILE")
SERVER_BIND=$(env_value SERVER_BIND "$ENV_FILE")
WEB_BIND=$(env_value WEB_BIND "$ENV_FILE")

[ "$FILE_ENVIRONMENT" = "$ENVIRONMENT" ] || die "env 文件声明的环境（${FILE_ENVIRONMENT:-空}）与 --environment（${ENVIRONMENT}）不一致"
[ -n "$FILE_STACK_ROOT" ] || die "env 文件缺少 STACK_ROOT"
require_match "$FILE_STACK_ROOT" '^/[A-Za-z0-9._/-]{1,200}$' STACK_ROOT
[ -n "$COMPOSE_PROJECT_NAME" ] || die "env 文件缺少 COMPOSE_PROJECT_NAME"
require_match "$COMPOSE_PROJECT_NAME" '^[a-z0-9][a-z0-9_-]{0,62}$' COMPOSE_PROJECT_NAME
require_match "$CURRENT_TAG" '^[0-9a-f]{12}$' IMAGE_TAG
require_match "$SERVER_BIND" '^127\.0\.0\.1:[0-9]{2,5}$' SERVER_BIND
require_match "$WEB_BIND" '^127\.0\.0\.1:[0-9]{2,5}$' WEB_BIND
[ -n "$STACK_ROOT_ARG" ] && [ "$STACK_ROOT_ARG" != "$FILE_STACK_ROOT" ] && die "--stack-root 与 env 文件的 STACK_ROOT 不一致"

STACK_ROOT="$FILE_STACK_ROOT"
HISTORY_LOG="$STACK_ROOT/deploy-history.log"
LOCK_FILE="$STACK_ROOT/.deploy.lock"
SERVER_HEALTH_URL="http://${SERVER_BIND}/healthz"
WEB_HEALTH_URL="http://${WEB_BIND}/healthz"

command -v docker >/dev/null 2>&1 || die "目标机缺少 docker"
docker compose version >/dev/null 2>&1 || die "目标机缺少 docker compose v2 插件"
command -v curl >/dev/null 2>&1 || die "目标机缺少 curl"
command -v flock >/dev/null 2>&1 || die "目标机缺少 flock，无法与部署流程串行化"

COMPOSE_FILE=$(resolve_compose_file) || die "找不到 $ENVIRONMENT 的 compose 文件（试过 --compose-file、<STACK_ROOT>/deploy/compose/$ENVIRONMENT.yml、<STACK_ROOT>/compose/$ENVIRONMENT.yml）"

# 与部署流程共用同一把锁：回滚不会和正在进行的部署互相踩。
exec 9>"$LOCK_FILE"
flock -w "$LOCK_TIMEOUT" 9 || die "未能取得锁（${LOCK_TIMEOUT} 秒超时），可能有部署正在进行"

if [ "$TO" = "previous" ]; then
  TARGET_TAG=$(previous_tag "$CURRENT_TAG") || die "历史记录里找不到与当前版本（${CURRENT_TAG}）不同的版本，无法解析 --to previous"
else
  TARGET_TAG="$TO"
fi
[ "$TARGET_TAG" = "$CURRENT_TAG" ] && die "目标版本与当前版本相同（${TARGET_TAG}），无需回滚"

# compose 文件必须按本环境仓库取镜像：目标机上的旧 compose 文件会让回滚悄悄用上别的镜像。
compose_images=$(docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --images 2>/dev/null | sort -u) \
  || die "无法解析 compose 文件的镜像（${COMPOSE_FILE}）"
expected_images=$(printf '%s\n' "$IMAGE_REPO/server:$CURRENT_TAG" "$IMAGE_REPO/web:$CURRENT_TAG" "$IMAGE_REPO/forum:$CURRENT_TAG" | sort -u)
[ "$compose_images" = "$expected_images" ] || die "compose 文件解析出的镜像不是 ${IMAGE_REPO}/<server|web|forum>:<IMAGE_TAG>（${COMPOSE_FILE} 可能还是按旧镜像名写的）"

# 镜像必须在本机、并且在本环境的仓库里：被清理掉的旧版本（只保留最近 5 个 tag）无法回滚，如实报错而不是拉取；
# 另一环境同一 SHA 的镜像不能代替。
for svc in server web forum; do
  docker image inspect "$IMAGE_REPO/$svc:$TARGET_TAG" >/dev/null 2>&1 || die "本机没有 ${IMAGE_REPO}/$svc:${TARGET_TAG}（镜像可能已被保留策略清理），请先重新分发该版本的 ${ENVIRONMENT} 镜像归档"
done

printf '回滚开始：环境=%s 当前=%s 目标=%s\n' "$ENVIRONMENT" "$CURRENT_TAG" "$TARGET_TAG"

# ── 只改 IMAGE_TAG，然后重建容器；数据卷原样保留 ──────────────
set_env_image_tag "$ENV_FILE" "$TARGET_TAG" || die "无法把 IMAGE_TAG 写回 $TARGET_TAG"
printf '已把 %s 的 IMAGE_TAG 改为 %s\n' "$ENV_FILE" "$TARGET_TAG"

docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans \
  || die "docker compose up -d 失败（${COMPOSE_FILE}）"

if health_check "$TARGET_TAG"; then
  write_history MANUAL_ROLLBACK "$TARGET_TAG" "手工回滚：$CURRENT_TAG → $TARGET_TAG"
  printf '回滚完成：%s 现在是 %s\n' "$ENVIRONMENT" "$TARGET_TAG"
  exit 0
fi

write_history MANUAL_ROLLBACK_FAILED "$TARGET_TAG" "手工回滚到 $TARGET_TAG 后健康检查失败"
printf '回滚后健康检查未通过：%s 需要人工介入（当前 IMAGE_TAG=%s）\n' "$ENVIRONMENT" "$TARGET_TAG" >&2
exit 1
