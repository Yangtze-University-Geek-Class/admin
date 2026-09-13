#!/usr/bin/env bash
# 目标机发布脚本：安装一个已构建好的不可变发布包并切换服务。
#
# 前置条件（由维护者在目标机准备，脚本不自行安装、不猜测路径）：
#   - 以部署用户（非 root）运行；目标机已装 Node 22（>=22.13）与 pnpm 9.15.9，且 PATH 可见。
#   - sudoers 只放行本脚本用到的这一条命令：<部署用户> ALL=(root) NOPASSWD: /usr/bin/systemctl restart <服务名>
#   - "$DEPLOY_ROOT" 由部署用户可写，且与另一环境完全隔离（独立目录、数据库、.env、会话密钥、端口）。
#   - "$DEPLOY_ROOT/shared/.env" 由维护者维护，脚本从不读取、复制或打印其内容。
#
# 本脚本只部署已经过人工验收的产物；它自身不提供、也不代表任何批准。
set -euo pipefail

ENVIRONMENT=""; DEPLOY_ROOT=""; SERVICE=""; TAR=""; EXPECTED_SHA=""; COMMIT=""; RELEASE_ID=""; PUBLIC_ORIGIN=""; LOCAL_HEALTH=""
HEALTH_ATTEMPTS=20
HEALTH_INTERVAL=3
HEALTH_TIMEOUT=10
KEEP_RELEASES=5

usage() {
  cat >&2 <<'USAGE'
用法：deploy-release.sh --environment <preview|production> --deploy-root <目录> --service <systemd 服务名>
                       --tar <发布包 tar.gz> --sha256 <64位小写> --commit <40位小写> --release-id <X.Y.Z-sha12>
                       --public-origin <https://域名> --local-health <http://127.0.0.1:端口/healthz>
所有参数必填，脚本不猜测生产默认路径。
USAGE
}

# 部署根目录解析并且 history 可写之后置 1；在此之前的失败无处可写，不静默伪造记录。
HISTORY_READY=0
HISTORY_WRITTEN=0

die() {
  # 任何失败路径都要在 deploy-history.log 留痕；已经写过结果的路径（FAILED/ROLLED_BACK）不再重复记 REJECTED。
  if [ "$HISTORY_READY" = "1" ] && [ "$HISTORY_WRITTEN" = "0" ]; then log_history REJECTED "$1"; fi
  printf '部署失败：%s\n' "$1" >&2
  exit 1
}

require_match() {
  # $1=值 $2=正则 $3=参数名
  # 用 bash 的 =~ 而不是 grep：^ 与 $ 锚定整个字符串，含换行的取值不会被逐行放行。
  if [[ ! "$1" =~ $2 ]]; then die "参数 $3 取值非法"; fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --environment) ENVIRONMENT="${2-}"; shift 2 ;;
    --deploy-root) DEPLOY_ROOT="${2-}"; shift 2 ;;
    --service) SERVICE="${2-}"; shift 2 ;;
    --tar) TAR="${2-}"; shift 2 ;;
    --sha256) EXPECTED_SHA="${2-}"; shift 2 ;;
    --commit) COMMIT="${2-}"; shift 2 ;;
    --release-id) RELEASE_ID="${2-}"; shift 2 ;;
    --public-origin) PUBLIC_ORIGIN="${2-}"; shift 2 ;;
    --local-health) LOCAL_HEALTH="${2-}"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) usage; die "未知参数 $1" ;;
  esac
done

for name in ENVIRONMENT DEPLOY_ROOT SERVICE TAR EXPECTED_SHA COMMIT RELEASE_ID PUBLIC_ORIGIN LOCAL_HEALTH; do
  # bash 间接展开，不使用 eval。
  [ -n "${!name}" ] || { usage; die "缺少参数 $name"; }
done

require_match "$ENVIRONMENT" '^(preview|production)$' --environment
require_match "$DEPLOY_ROOT" '^/[A-Za-z0-9._/-]{1,200}$' --deploy-root
require_match "$SERVICE" '^[A-Za-z0-9@._-]{1,120}$' --service
require_match "$TAR" '^/[A-Za-z0-9._/-]{1,300}$' --tar
require_match "$EXPECTED_SHA" '^[a-f0-9]{64}$' --sha256
require_match "$COMMIT" '^[a-f0-9]{40}$' --commit
require_match "$RELEASE_ID" '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-[a-f0-9]{12}$' --release-id
require_match "$PUBLIC_ORIGIN" '^https://[a-z0-9.-]{3,120}$' --public-origin
require_match "$LOCAL_HEALTH" '^http://127\.0\.0\.1:[0-9]{2,5}/[A-Za-z0-9._/-]*$' --local-health
case "$RELEASE_ID" in *"$(printf '%s' "$COMMIT" | cut -c1-12)") : ;; *) die "release-id 的短 SHA 与 --commit 不一致" ;; esac

[ -d "$DEPLOY_ROOT" ] || die "部署根目录不存在：$DEPLOY_ROOT"
[ -f "$TAR" ] || die "发布包不存在：$TAR"
command -v node >/dev/null 2>&1 || die "目标机缺少 node"
command -v pnpm >/dev/null 2>&1 || die "目标机缺少 pnpm"
command -v curl >/dev/null 2>&1 || die "目标机缺少 curl"
command -v flock >/dev/null 2>&1 || die "目标机缺少 flock，无法串行化部署"

RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
PREVIOUS_LINK="$DEPLOY_ROOT/previous"
HISTORY_LOG="$DEPLOY_ROOT/deploy-history.log"
LOCK_FILE="$DEPLOY_ROOT/.deploy.lock"
mkdir -p "$RELEASES_DIR"

# 同一环境的部署必须串行；另一环境使用自己的 DEPLOY_ROOT 与锁。
exec 9>"$LOCK_FILE"
flock -w 900 9 || die "未能取得部署锁（900 秒超时），可能有另一次部署在进行"

log_history() {
  # $1=结果 $2=说明；只记录版本身份，不写入任何密钥或环境变量。
  # 说明里的换行/制表符会破坏一行一条的格式（归档条目名可能含换行），统一压成空格。
  local note="${2//[$'\n\t']/ }"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ENVIRONMENT" "$RELEASE_ID" "$COMMIT" "$1" "$note" >>"$HISTORY_LOG" 2>/dev/null || true
  HISTORY_WRITTEN=1
}

# log_history 定义完成、日志文件可追加后才允许 die 写记录。
if : >>"$HISTORY_LOG" 2>/dev/null; then HISTORY_READY=1; fi

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

json_field() {
  # $1=JSON 文件 $2=字段名；字段缺失或不是字符串即失败。
  node -e 'const fs=require("node:fs");const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const v=o[process.argv[2]];if(typeof v!=="string"){process.exit(3);}process.stdout.write(v);' "$1" "$2"
}

json_true() {
  # $1=JSON 文件 $2=字段名；字段必须严格等于布尔 true。
  # 不用 grep 'ok'：任意响应体里出现 ok 这两个字母都会被误判为健康。
  node -e 'const fs=require("node:fs");let o;try{o=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}catch{process.exit(3);}if(o[process.argv[2]]!==true){process.exit(3);}' "$1" "$2"
}

http_get() {
  # $1=URL $2=响应体落盘路径；输出 HTTP 状态码。
  curl -sS -o "$2" -w '%{http_code}' --max-time "$HEALTH_TIMEOUT" "$1" 2>/dev/null || printf '000'
}

health_check() {
  # $1=用于日志的版本标签；全部检查通过返回 0。
  local label="$1" attempt=1 body status remote_commit remote_release remote_environment remote_origin
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
          # 同一 commit 在 preview 与 production 的 releaseId 完全相同，只比 commit/releaseId
          # 无法区分自己打到了哪个环境；environment 与 publicOrigin 必须一起断言。
          remote_environment="$(json_field "$body" environment || true)"
          remote_origin="$(json_field "$body" publicOrigin || true)"
          if [ "$remote_commit" = "$COMMIT" ] && [ "$remote_release" = "$RELEASE_ID" ] \
            && [ "$remote_environment" = "$ENVIRONMENT" ] && [ "$remote_origin" = "$PUBLIC_ORIGIN" ]; then
            rm -f "$body"; printf '健康检查通过（%s）\n' "$label" >&2; return 0
          fi
          printf '公开 release.json 与目标不一致（commit=%s releaseId=%s environment=%s publicOrigin=%s），重试 %s/%s\n' \
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

restart_service() {
  sudo -n systemctl restart "$SERVICE"
}

switch_current() {
  # $1=release 目录绝对路径；先建临时符号链接再原子替换，避免出现短暂的无 current 状态。
  local target="$1" tmp
  tmp="$DEPLOY_ROOT/.current.$$"
  ln -s "$target" "$tmp"
  mv -T "$tmp" "$CURRENT_LINK"
}

PREVIOUS_TARGET=""
if [ -L "$CURRENT_LINK" ]; then PREVIOUS_TARGET="$(readlink -f "$CURRENT_LINK")"; fi

rollback_to_previous() {
  # $1=失败原因
  local reason="$1"
  if [ -z "$PREVIOUS_TARGET" ] || [ ! -d "$PREVIOUS_TARGET" ]; then
    log_history FAILED "${reason}；无可回退版本"
    die "${reason}；且没有可回退的上一版本，服务需要人工介入"
  fi
  printf '正在回退到上一版本：%s\n' "$PREVIOUS_TARGET" >&2
  switch_current "$PREVIOUS_TARGET"
  if ! restart_service; then
    log_history FAILED "${reason}；回退重启失败"
    die "${reason}；回退重启失败，服务需要人工介入"
  fi
  if health_check "回退版本"; then
    log_history ROLLED_BACK "$reason"
    die "${reason}；已回退到上一版本"
  fi
  log_history FAILED "${reason}；回退后健康检查仍失败"
  die "${reason}；回退后健康检查仍失败，服务需要人工介入"
}

# 1. 传输完整性
ACTUAL_SHA="$(sha256_of "$TAR")"
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || { log_history REJECTED "tar sha256 不匹配"; die "发布包 sha256 不匹配：期望 ${EXPECTED_SHA}，实际 $ACTUAL_SHA"; }

# 2. 解包前检查归档条目：只允许相对路径，禁止 .. 与绝对路径
ENTRY_LIST="$(mktemp)"
trap 'rm -f "$ENTRY_LIST"' EXIT
tar -tzf "$TAR" >"$ENTRY_LIST"
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  case "$entry" in
    /*) die "归档含绝对路径条目：$entry" ;;
    *../*|*/..|..) die "归档含向上跳出的条目：$entry" ;;
  esac
done <"$ENTRY_LIST"

INCOMING="$RELEASES_DIR/$RELEASE_ID.incoming"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
[ ! -e "$RELEASE_DIR" ] || die "版本目录已存在：${RELEASE_DIR}；本脚本不覆盖已部署产物。要把 current 切回这个版本，请用 rollback.sh --environment $ENVIRONMENT --to ${RELEASE_ID}（前提：该目录能通过 verify，且已装好生产依赖）。若该目录已损坏，由维护者人工删除后重新部署。"
rm -rf "$INCOMING"
mkdir -p "$INCOMING"
if ! tar -xzf "$TAR" -C "$INCOMING" >&2; then
  rm -rf "$INCOMING"; die "tar 解包失败：$TAR"
fi

# 解包后再确认没有符号链接逃逸
if find "$INCOMING" -type l -print -quit | grep -q .; then
  rm -rf "$INCOMING"; die "解包结果包含符号链接，拒绝部署"
fi

# 3. 用发布包自带的校验器核对内容摘要与身份
if ! (cd "$INCOMING" && node scripts/release-bundle.mjs verify --dir "$INCOMING" --expect-environment "$ENVIRONMENT" --expect-commit "$COMMIT" >&2); then
  rm -rf "$INCOMING"; log_history REJECTED "发布包校验失败"; die "发布包校验失败"
fi

# 4. release.json 的环境/提交/版本必须与调用参数一致
RELEASE_JSON="$INCOMING/release.json"
[ "$(json_field "$RELEASE_JSON" environment)" = "$ENVIRONMENT" ] || { rm -rf "$INCOMING"; die "release.json 的 environment 与参数不一致"; }
[ "$(json_field "$RELEASE_JSON" commit)" = "$COMMIT" ] || { rm -rf "$INCOMING"; die "release.json 的 commit 与参数不一致"; }
[ "$(json_field "$RELEASE_JSON" releaseId)" = "$RELEASE_ID" ] || { rm -rf "$INCOMING"; die "release.json 的 releaseId 与参数不一致"; }
[ "$(json_field "$RELEASE_JSON" publicOrigin)" = "$PUBLIC_ORIGIN" ] || { rm -rf "$INCOMING"; die "release.json 的 publicOrigin 与 --public-origin 不一致"; }

# 5. 按锁文件安装生产依赖（目标机需要可访问 registry）
if ! (cd "$INCOMING" && pnpm install --prod --frozen-lockfile >&2); then
  rm -rf "$INCOMING"; log_history REJECTED "生产依赖安装失败"; die "pnpm install --prod --frozen-lockfile 失败"
fi

mv "$INCOMING" "$RELEASE_DIR"

# 6. 记录上一版本并原子切换
if [ -n "$PREVIOUS_TARGET" ] && [ -d "$PREVIOUS_TARGET" ]; then
  tmp_prev="$DEPLOY_ROOT/.previous.$$"
  ln -s "$PREVIOUS_TARGET" "$tmp_prev"
  mv -T "$tmp_prev" "$PREVIOUS_LINK"
fi
switch_current "$RELEASE_DIR"

# 7. 重启并健康检查，失败即回退
if ! restart_service; then rollback_to_previous "systemctl restart 失败"; fi
if ! health_check "新版本 $RELEASE_ID"; then rollback_to_previous "新版本健康检查失败"; fi

# 8. 只保留最近 5 个版本，且绝不删除 current/previous 指向的目录
CURRENT_TARGET="$(readlink -f "$CURRENT_LINK")"
KEEP_PREVIOUS=""
if [ -L "$PREVIOUS_LINK" ]; then KEEP_PREVIOUS="$(readlink -f "$PREVIOUS_LINK")"; fi
# find -printf 与 mv -T 依赖 GNU coreutils/findutils，即目标 Linux 主机；本脚本不面向 macOS。
PRUNE_LIST="$(mktemp)"
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@\t%p\n' | sort -rn | cut -f2- >"$PRUNE_LIST"
index=0
while IFS= read -r candidate; do
  [ -n "$candidate" ] || continue
  index=$((index + 1))
  [ "$index" -gt "$KEEP_RELEASES" ] || continue
  resolved="$(readlink -f "$candidate")"
  [ "$resolved" != "$CURRENT_TARGET" ] || continue
  [ "$resolved" != "$KEEP_PREVIOUS" ] || continue
  printf '清理旧版本：%s\n' "$resolved" >&2
  rm -rf "$resolved"
done <"$PRUNE_LIST"
rm -f "$PRUNE_LIST"

log_history SUCCESS "已切换到 $RELEASE_ID"
printf '部署完成：%s（%s）。这是已验收产物的上线动作，本脚本不代表验收或批准。\n' "$RELEASE_ID" "$ENVIRONMENT"
