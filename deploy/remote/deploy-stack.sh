#!/usr/bin/env bash
# 目标机部署脚本（docker 栈版）：load 镜像 → compose up -d → 健康检查 → 失败自动回滚。
#
# 与旧 systemd/release-bundle 流程的区别：目标机不再安装 Node、不再解包发布目录，
# 只消费 CI 构建好的镜像归档 + 渲染好的 env 文件。
#
# 用法：
#   deploy-stack.sh --environment <production|preview> --images <归档文件或目录> --env-file <env 文件>
#
# 参数：
#   --environment <production|preview>  必填；必须与 env 文件里的 GEEK_DEPLOYMENT_ENVIRONMENT 一致
#   --images <file|dir>                 必填（或用 --incoming-dir 指定所在目录）：
#                                       docker save 出来的 .tar/.tar.gz（单个）或该目录下的全部归档
#   --env-file <path>                   env 文件（模板 + 注入的密钥 + IMAGE_TAG=<sha12>）；
#                                       会原子复制到 <STACK_ROOT>/.env.<environment>，compose 只读这份
#   --incoming-dir <dir>                可选：归档与 env 文件所在目录（缺省用 <incoming-dir>/.env.<env>）
#   --image-tag <sha12>                 可选：与 env 文件里的 IMAGE_TAG 交叉校验（不一致即失败）
#   --stack-root <dir>                  可选：与 env 文件里的 STACK_ROOT 交叉校验
#   --compose-file <path>               可选：显式指定 compose 文件（默认按约定顺序查找，见下）
#   --health-timeout <秒>               可选：健康检查总超时（默认 180）
#
# 事实来源：env 文件。脚本不内联任何密钥、不猜测端口、不写死域名，
# 只读 STACK_ROOT / COMPOSE_PROJECT_NAME / IMAGE_TAG / SERVER_BIND / WEB_BIND / SERVER_PORT。
#
# 镜像按环境分仓库：本环境只用 yzgc-<environment>/<server|web|forum>:<IMAGE_TAG>。
# 两套栈共用同一个 Docker 守护进程，同一提交的预发布与正式镜像构建参数不同；
# 归档里只要出现别的仓库或别的 tag 就拒绝装载，镜像清理与回滚也只动本环境的仓库。
#
# compose 文件查找顺序（取第一个存在的）：
#   --compose-file > <STACK_ROOT>/deploy/compose/<env>.yml > <STACK_ROOT>/compose/<env>.yml
#   > <STACK_ROOT>/compose.yml > <脚本目录>/../compose/<env>.yml
#
# 记录：<STACK_ROOT>/deploy-history.log（追加，制表符分隔）
#   时间(UTC ISO8601)  环境  生效版本  结果  说明
# 「生效版本」= 这条记录之后实际在跑的 IMAGE_TAG；FAILED 行记的是「尝试部署但没起来」的版本，
# 紧随其后的 ROLLED_BACK 行才是真正生效的旧版本 —— 回滚与镜像保留策略都按这个字段判断。
set -euo pipefail

ENVIRONMENT=""
IMAGES=""
ENV_FILE=""
INCOMING_DIR=""
IMAGE_TAG_ARG=""
STACK_ROOT_ARG=""
COMPOSE_FILE_ARG=""
HEALTH_TIMEOUT=180
HEALTH_INTERVAL=3
KEEP_TAGS=5
LOCK_TIMEOUT=900

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

usage() {
  cat >&2 <<'USAGE'
用法：deploy-stack.sh --environment <production|preview> --images <归档文件或目录> --env-file <env 文件>
可选：--incoming-dir <目录> --image-tag <sha12> --stack-root <目录> --compose-file <路径> --health-timeout <秒>
USAGE
}

# 部署根目录解析成功后置 1，history 可追加后置 1；在此之前失败无处记录，不伪造记录。
HISTORY_READY=0
HISTORY_WRITTEN=0

write_history() {
  # $1=结果 $2=该记录对应的生效版本 $3=说明；只记录版本身份，绝不写入密钥或环境变量取值。
  # 换行/制表符会破坏「一行一条」，统一压成空格。
  local note="${3//[$'\n\t']/ }"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ENVIRONMENT" "$2" "$1" "$note" >>"$HISTORY_LOG" 2>/dev/null || true
  HISTORY_WRITTEN=1
}

die() {
  # 失败路径都要在 deploy-history.log 留痕；已经写过结果的路径不再重复记录。
  if [ "$HISTORY_READY" = "1" ] && [ "$HISTORY_WRITTEN" = "0" ]; then write_history FAILED "${IMAGE_TAG:-unknown}" "$1"; fi
  printf '部署失败：%s\n' "$1" >&2
  exit 1
}

require_match() {
  # $1=值 $2=正则 $3=参数名；用 bash 的 =~ 锚定整串，含换行的取值不会被逐行放行。
  if [[ ! "$1" =~ $2 ]]; then die "参数 $3 取值非法"; fi
}

env_value() {
  # $1=键 $2=env 文件；不 source（env 文件里的取值一律当数据，不执行）。
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

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else die "目标机缺少 sha256sum/shasum，无法校验镜像归档"
  fi
}

checksum_for() {
  # $1=归档路径 → 输出期望的 sha256；找不到校验文件即失败（本脚本不接受「没有校验和」的输入）。
  local archive="$1" dir base candidate line hex
  dir=$(dirname -- "$archive"); base=$(basename -- "$archive")
  for candidate in \
    "$archive.sha256" \
    "${archive%.gz}.sha256" \
    "${archive%.tar.gz}.sha256" \
    "${archive%.tgz}.sha256" \
    "$dir/SHA256SUMS" "$dir/sha256sums.txt" "$dir/checksums.txt"; do
    [ -f "$candidate" ] || continue
    while IFS= read -r line || [ -n "$line" ]; do
      hex=${line%% *}
      if [ "$hex" = "$line" ]; then
        # 裸 hex 形态：文件里只有一个校验和
        case "$hex" in *[!0-9a-f]*) continue ;; esac
        [ "${#hex}" -eq 64 ] && { printf '%s' "$hex"; return 0; }
        continue
      fi
      # "<hex>  <文件名>" 形态：文件名必须指向当前归档，避免张冠李戴
      case "$line" in *"$base"*) : ;; *) continue ;; esac
      case "$hex" in *[!0-9a-f]*) continue ;; esac
      [ "${#hex}" -eq 64 ] && { printf '%s' "$hex"; return 0; }
    done <"$candidate"
  done
  return 1
}

snapshot_tags() {
  # $1=服务名 → 当前本机本环境该服务仓库的全部 tag（每行一个，已排序）
  docker images --filter "reference=$IMAGE_REPO/$1:*" --format '{{.Tag}}' 2>/dev/null | sort -u
}

archive_repo_tags() {
  # $1=docker save 出来的归档（.tar 或 .tar.gz）→ 每行一个 manifest.json 里的 RepoTags 条目。
  # 只读归档，不装载；读不到 manifest.json 或没有条目时返回非 0。
  local manifest
  manifest=$(tar -xOf "$1" manifest.json 2>/dev/null) || return 1
  [ -n "$manifest" ] || return 1
  printf '%s' "$manifest" | tr -d '\n' | grep -o '"RepoTags":[[:space:]]*\[[^]]*\]' \
    | sed -e 's/^"RepoTags":[[:space:]]*\[//' -e 's/\]$//' | tr ',' '\n' \
    | sed -e 's/^[[:space:]]*"//' -e 's/"[[:space:]]*$//' | grep -v '^$'
}

is_expected_ref() {
  local ref="$1" expected
  for expected in "${EXPECTED_REFS[@]}"; do [ "$expected" = "$ref" ] && return 0; done
  return 1
}

compose_images_match() {
  # $1=env 文件 → compose 解析出的镜像必须恰好是本环境本版本的三个镜像（目标机上的 compose 文件可能是旧版本）。
  local actual expected
  actual=$(docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$1" -f "$COMPOSE_FILE" config --images 2>/dev/null | sort -u) || return 1
  expected=$(printf '%s\n' "${EXPECTED_REFS[@]}" | sort -u)
  [ -n "$actual" ] && [ "$actual" = "$expected" ]
}

http_ok() {
  # $1=URL $2=落盘的响应体路径 → 输出 HTTP 状态码（失败给 000）
  curl -sS -o "$2" -w '%{http_code}' --max-time 5 "$1" 2>/dev/null || printf '000'
}

health_check() {
  # 返回 0 表示通过。$1=用于日志的标签
  local label="$1" server_url="$2" web_url="$3" deadline=$((SECONDS + HEALTH_TIMEOUT))
  local body status
  body=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$body'" RETURN
  while [ "$SECONDS" -lt "$deadline" ]; do
    status=$(http_ok "$server_url" "$body")
    if [ "$status" = "200" ] && grep -q '"ok":true' "$body" 2>/dev/null; then
      # 再从 web 入口验一次：/healthz 会穿过 web → server，能暴露反代与依赖注入问题
      status=$(http_ok "$web_url" "$body")
      if [ "$status" = "200" ] && grep -q '"ok":true' "$body" 2>/dev/null; then
        printf '健康检查通过（%s）：%s 与 %s 均返回 ok\n' "$label" "$server_url" "$web_url"
        return 0
      fi
      printf '等待 web 入口健康（%s）：%s 返回 %s\n' "$label" "$web_url" "$status"
    else
      printf '等待 server 健康（%s）：%s 返回 %s\n' "$label" "$server_url" "$status"
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

set_env_image_tag() {
  # $1=env 文件 $2=新 tag；原子替换（临时文件 + mv），失败不留下半截文件。
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

compose_up() {
  docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$STACK_ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans
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

prune_tags() {
  # 保留：当前 IMAGE_TAG + previous + 本栈历史里最近的 KEEP_TAGS 个不同 tag；本环境仓库（$IMAGE_REPO/*）的其余 tag 删除。
  # 另一环境的仓库不在清理范围内：它的历史记在另一个 STACK_ROOT 下，这里看不到也不该动。
  # 正在被容器使用的 tag 删不掉（没有 -f），忽略失败并如实记录。
  local keep_file lines=() i line svc tag removed=0 added=0
  keep_file=$(mktemp)
  printf '%s\n' "$IMAGE_TAG" >>"$keep_file"
  [ -n "${PREVIOUS_TAG:-}" ] && printf '%s\n' "$PREVIOUS_TAG" >>"$keep_file"
  if [ -f "$HISTORY_LOG" ]; then
    while IFS= read -r line || [ -n "$line" ]; do lines+=("$line"); done <"$HISTORY_LOG"
  fi
  for ((i = ${#lines[@]} - 1; i >= 0 && added < KEEP_TAGS; i--)); do
    tag=$(printf '%s' "${lines[$i]}" | cut -f3)
    [[ "$tag" =~ ^[0-9a-f]{12}$ ]] || continue
    grep -qxF "$tag" "$keep_file" && continue
    printf '%s\n' "$tag" >>"$keep_file"
    added=$((added + 1))
  done
  for svc in server web forum; do
    while IFS= read -r tag; do
      [ -n "$tag" ] || continue
      grep -qxF "$tag" "$keep_file" && continue
      if docker rmi "$IMAGE_REPO/$svc:$tag" >/dev/null 2>&1; then
        printf '已清理旧镜像：%s/%s:%s\n' "$IMAGE_REPO" "$svc" "$tag"
        removed=$((removed + 1))
      fi
    done < <(snapshot_tags "$svc")
  done
  printf '镜像清理完成（%s）：保留最近 %s 个 tag，本次删除 %s 个未被占用的旧 tag\n' "$IMAGE_REPO" "$KEEP_TAGS" "$removed"
  rm -f "$keep_file"
}

# ── 参数解析 ──────────────────────────────────────────────────
while [ "$#" -gt 0 ]; do
  case "$1" in
    --environment) ENVIRONMENT="${2-}"; shift 2 ;;
    --images) IMAGES="${2-}"; shift 2 ;;
    --env-file) ENV_FILE="${2-}"; shift 2 ;;
    --incoming-dir) INCOMING_DIR="${2-}"; shift 2 ;;
    --image-tag) IMAGE_TAG_ARG="${2-}"; shift 2 ;;
    --stack-root) STACK_ROOT_ARG="${2-}"; shift 2 ;;
    --compose-file) COMPOSE_FILE_ARG="${2-}"; shift 2 ;;
    --health-timeout) HEALTH_TIMEOUT="${2-}"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) usage; die "未知参数 $1" ;;
  esac
done

[ -n "$ENVIRONMENT" ] || { usage; die "缺少 --environment"; }
case "$ENVIRONMENT" in production | preview) : ;; *) usage; die "--environment 只能是 production 或 preview" ;; esac
require_match "$HEALTH_TIMEOUT" '^[1-9][0-9]{0,3}$' --health-timeout
# 本环境的镜像仓库前缀：只由 --environment 决定，与 deploy/compose/<environment>.yml 里的字面量一致。
IMAGE_REPO="yzgc-$ENVIRONMENT"

if [ -n "$INCOMING_DIR" ]; then
  [ -d "$INCOMING_DIR" ] || die "incoming 目录不存在：$INCOMING_DIR"
  [ -n "$ENV_FILE" ] || ENV_FILE="$INCOMING_DIR/.env.$ENVIRONMENT"
  [ -n "$IMAGES" ] || IMAGES="$INCOMING_DIR"
fi
[ -n "$ENV_FILE" ] || { usage; die "缺少 --env-file（或用 --incoming-dir 指定所在目录）"; }
[ -n "$IMAGES" ] || { usage; die "缺少 --images（或用 --incoming-dir 指定所在目录）"; }
[ -f "$ENV_FILE" ] || die "env 文件不存在：$ENV_FILE"

command -v docker >/dev/null 2>&1 || die "目标机缺少 docker"
docker compose version >/dev/null 2>&1 || die "目标机缺少 docker compose v2 插件"
command -v curl >/dev/null 2>&1 || die "目标机缺少 curl"
command -v flock >/dev/null 2>&1 || die "目标机缺少 flock，无法串行化部署"
command -v tar >/dev/null 2>&1 || die "目标机缺少 tar，无法核对镜像归档内容"

# ── env 文件是唯一事实来源 ────────────────────────────────────
FILE_ENVIRONMENT=$(env_value GEEK_DEPLOYMENT_ENVIRONMENT "$ENV_FILE")
FILE_STACK_ROOT=$(env_value STACK_ROOT "$ENV_FILE")
COMPOSE_PROJECT_NAME=$(env_value COMPOSE_PROJECT_NAME "$ENV_FILE")
IMAGE_TAG=$(env_value IMAGE_TAG "$ENV_FILE")
SERVER_BIND=$(env_value SERVER_BIND "$ENV_FILE")
WEB_BIND=$(env_value WEB_BIND "$ENV_FILE")
SERVER_PORT=$(env_value SERVER_PORT "$ENV_FILE")

[ -n "$FILE_ENVIRONMENT" ] || die "env 文件缺少 GEEK_DEPLOYMENT_ENVIRONMENT：$ENV_FILE"
[ "$FILE_ENVIRONMENT" = "$ENVIRONMENT" ] || die "env 文件声明的环境（${FILE_ENVIRONMENT}）与 --environment（${ENVIRONMENT}）不一致"
[ -n "$FILE_STACK_ROOT" ] || die "env 文件缺少 STACK_ROOT"
require_match "$FILE_STACK_ROOT" '^/[A-Za-z0-9._/-]{1,200}$' STACK_ROOT
[ -n "$COMPOSE_PROJECT_NAME" ] || die "env 文件缺少 COMPOSE_PROJECT_NAME"
require_match "$COMPOSE_PROJECT_NAME" '^[a-z0-9][a-z0-9_-]{0,62}$' COMPOSE_PROJECT_NAME
require_match "$IMAGE_TAG" '^[0-9a-f]{12}$' IMAGE_TAG
[ -n "$STACK_ROOT_ARG" ] && [ "$STACK_ROOT_ARG" != "$FILE_STACK_ROOT" ] && die "--stack-root 与 env 文件的 STACK_ROOT 不一致"
[ -n "$IMAGE_TAG_ARG" ] && [ "$IMAGE_TAG_ARG" != "$IMAGE_TAG" ] && die "--image-tag 与 env 文件的 IMAGE_TAG 不一致"
require_match "$SERVER_BIND" '^127\.0\.0\.1:[0-9]{2,5}$' SERVER_BIND
require_match "$WEB_BIND" '^127\.0\.0\.1:[0-9]{2,5}$' WEB_BIND
require_match "$SERVER_PORT" '^[0-9]{2,5}$' SERVER_PORT
EXPECTED_REFS=("$IMAGE_REPO/server:$IMAGE_TAG" "$IMAGE_REPO/web:$IMAGE_TAG" "$IMAGE_REPO/forum:$IMAGE_TAG")

STACK_ROOT="$FILE_STACK_ROOT"
mkdir -p "$STACK_ROOT"
STACK_ENV_FILE="$STACK_ROOT/.env.$ENVIRONMENT"
HISTORY_LOG="$STACK_ROOT/deploy-history.log"
LOCK_FILE="$STACK_ROOT/.deploy.lock"
SERVER_HEALTH_URL="http://${SERVER_BIND}/healthz"
WEB_HEALTH_URL="http://${WEB_BIND}/healthz"

COMPOSE_FILE=$(resolve_compose_file) || die "找不到 $ENVIRONMENT 的 compose 文件（试过 --compose-file、<STACK_ROOT>/deploy/compose/$ENVIRONMENT.yml、<STACK_ROOT>/compose/$ENVIRONMENT.yml）"

# ── 串行锁：同一栈的部署必须排队（不同栈各有自己的 STACK_ROOT 与锁）──
exec 9>"$LOCK_FILE"
flock -w "$LOCK_TIMEOUT" 9 || die "未能取得部署锁（${LOCK_TIMEOUT} 秒超时），可能有另一次部署在进行"

# 锁内再读一次线上 tag：这是「上一个成功部署的版本」，回滚目标就是它。
PREVIOUS_TAG=$(env_value IMAGE_TAG "$STACK_ENV_FILE")
[[ "$PREVIOUS_TAG" =~ ^[0-9a-f]{12}$ ]] || PREVIOUS_TAG=""

if : >>"$HISTORY_LOG" 2>/dev/null; then HISTORY_READY=1; fi

printf '部署开始：环境=%s 版本=%s 上一个版本=%s\n' "$ENVIRONMENT" "$IMAGE_TAG" "${PREVIOUS_TAG:-无}"
printf 'compose 文件：%s\nenv 文件：%s\n镜像：%s\n' "$COMPOSE_FILE" "$STACK_ENV_FILE" "${EXPECTED_REFS[*]}"
compose_images_match "$ENV_FILE" || die "compose 文件解析出的镜像不是 ${IMAGE_REPO}/<server|web|forum>:${IMAGE_TAG}（${COMPOSE_FILE} 可能还是按旧镜像名写的）"

# ── 1) 校验 sha256 ────────────────────────────────────────────
archives=()
if [ -d "$IMAGES" ]; then
  shopt -s nullglob
  for candidate in "$IMAGES"/*.tar "$IMAGES"/*.tar.gz "$IMAGES"/*.tgz; do archives+=("$candidate"); done
  shopt -u nullglob
  [ "${#archives[@]}" -gt 0 ] || die "目录里没有镜像归档（*.tar / *.tar.gz / *.tgz）：$IMAGES"
elif [ -f "$IMAGES" ]; then
  archives=("$IMAGES")
else
  die "--images 既不是文件也不是目录：$IMAGES"
fi

for archive in "${archives[@]}"; do
  [ -s "$archive" ] || die "镜像归档为空：$archive"
  expected=$(checksum_for "$archive") || die "找不到 sha256 校验文件（需要 <归档>.sha256 或同目录 SHA256SUMS）：$archive"
  actual=$(sha256_of "$archive")
  [ "$expected" = "$actual" ] || die "sha256 不匹配：${archive}（期望 ${expected}，实际 ${actual}）"
  printf 'sha256 校验通过：%s\n' "$(basename -- "$archive")"
done

# 装载前先读归档清单：只接受本环境本版本的三个镜像，别的仓库（另一环境、旧的 yzgc/*）或别的 tag 一律拒绝，
# 否则 docker load 会直接改写另一环境同名镜像的指向。
seen_refs=" "
for archive in "${archives[@]}"; do
  refs=$(archive_repo_tags "$archive") || die "读不到镜像归档的 manifest.json（RepoTags）：$archive"
  while IFS= read -r ref; do
    [ -n "$ref" ] || continue
    is_expected_ref "$ref" || die "镜像归档里有不属于本环境本版本的镜像 ${ref}（只接受 ${IMAGE_REPO}/<server|web|forum>:${IMAGE_TAG}）：$archive"
    seen_refs="${seen_refs}${ref} "
  done <<<"$refs"
done
for ref in "${EXPECTED_REFS[@]}"; do
  case "$seen_refs" in *" $ref "*) : ;; *) die "镜像归档里缺少 ${ref}" ;; esac
done

# ── 2) 装载镜像 ───────────────────────────────────────────────
for archive in "${archives[@]}"; do
  docker load -i "$archive" >/dev/null || die "docker load 失败：$archive"
  printf '已装载：%s\n' "$(basename -- "$archive")"
done

# ── 3) 装载后再确认三个镜像都在（不重新打 tag：镜像名只来自归档清单）──
for ref in "${EXPECTED_REFS[@]}"; do
  docker image inspect "$ref" >/dev/null 2>&1 || die "装载后本机仍没有 ${ref}"
done

# ── 4) 安装 env 文件（原子替换，只有目标机上这一份被 compose 读取）──
if [ "$(cd -- "$(dirname -- "$ENV_FILE")" && pwd)/$(basename -- "$ENV_FILE")" != "$STACK_ENV_FILE" ]; then
  tmp_env=$(mktemp "${STACK_ENV_FILE}.XXXXXX")
  cat "$ENV_FILE" >"$tmp_env"
  chmod 600 "$tmp_env"
  mv -f "$tmp_env" "$STACK_ENV_FILE"
  printf '已安装 env 文件：%s（权限 600）\n' "$STACK_ENV_FILE"
fi

# ── 5) 启动栈 + 健康检查 ──────────────────────────────────────
compose_up || die "docker compose up -d 失败（${COMPOSE_FILE}）"

if health_check "$IMAGE_TAG" "$SERVER_HEALTH_URL" "$WEB_HEALTH_URL"; then
  write_history OK "$IMAGE_TAG" "compose up 成功且健康检查通过"
  prune_tags
  printf '部署成功：%s %s\n' "$ENVIRONMENT" "$IMAGE_TAG"
  exit 0
fi

printf '健康检查失败（%s 秒超时），尝试回滚到上一个版本 %s\n' "$HEALTH_TIMEOUT" "${PREVIOUS_TAG:-无}" >&2
write_history FAILED "$IMAGE_TAG" "健康检查超时（${SERVER_HEALTH_URL}）"

# ── 6) 自动回滚到上一个 IMAGE_TAG ─────────────────────────────
if [ -z "$PREVIOUS_TAG" ]; then
  write_history ROLLBACK_SKIPPED "$IMAGE_TAG" "没有可回滚的上一个版本"
  die "健康检查失败且没有上一个版本可回滚，栈处于失败状态，需要人工处理"
fi
[ "$PREVIOUS_TAG" = "$IMAGE_TAG" ] && { write_history ROLLBACK_SKIPPED "$IMAGE_TAG" "上一个版本与当前版本相同"; die "健康检查失败且无可回滚版本"; }
for svc in server web forum; do
  if ! docker image inspect "$IMAGE_REPO/$svc:$PREVIOUS_TAG" >/dev/null 2>&1; then
    write_history ROLLBACK_SKIPPED "$IMAGE_TAG" "本机没有 $IMAGE_REPO/$svc:$PREVIOUS_TAG，无法自动回滚"
    die "健康检查失败，且本机没有上一个版本的 ${IMAGE_REPO}/$svc:${PREVIOUS_TAG}，需要人工处理"
  fi
done

set_env_image_tag "$STACK_ENV_FILE" "$PREVIOUS_TAG" || die "回滚失败：无法把 IMAGE_TAG 写回 $PREVIOUS_TAG"
printf '已把 %s 的 IMAGE_TAG 切回 %s\n' "$STACK_ENV_FILE" "$PREVIOUS_TAG"
if compose_up && health_check "$PREVIOUS_TAG" "$SERVER_HEALTH_URL" "$WEB_HEALTH_URL"; then
  write_history ROLLED_BACK "$PREVIOUS_TAG" "已回滚到 $PREVIOUS_TAG 并通过健康检查（目标版本 $IMAGE_TAG 未上线）"
  printf '已回滚：%s 现在是 %s（目标版本 %s 未上线）\n' "$ENVIRONMENT" "$PREVIOUS_TAG" "$IMAGE_TAG" >&2
  exit 1
fi

write_history ROLLBACK_FAILED "$PREVIOUS_TAG" "回滚到 $PREVIOUS_TAG 后健康检查仍失败"
printf '回滚失败：%s 仍未通过健康检查，需要人工介入\n' "$PREVIOUS_TAG" >&2
exit 1
