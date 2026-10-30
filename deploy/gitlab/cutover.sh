#!/usr/bin/env bash
# GitLab 统一登录改接正式的宿主侧步骤（同构清单 P-0006、P-0007，docs/ops/GITLAB.md）。由 .github/workflows/gitlab-cutover.yml
# 经部署用的 SSH 通道调用，开发者不需要登录目标机；缺省全是只读或演算，加 --apply 才写。
#
#   cutover.sh status            --production-origin <URL>                              只读：客户端、签发者、secret 文件是否就位、正式的发现文档
#   cutover.sh register-client   --production-origin <URL> [--apply]                    正式库登记 gitlab 客户端，secret 只写 yzgc-oidc-secret.production（0600）；已有就不动
#   cutover.sh migrate-subjects  --production-origin <URL> [--sector <主机>] [--apply]  把预发布里 GitLab 已在用的 sub 带到正式库（只新增，冲突整批拒绝）
#   cutover.sh stop-production-sync --production-origin <URL> [--apply]               正式同步写者排空停写（修重复号之前）；之后用 enable-production-sync 重开
#   cutover.sh repair-duplicates --production-origin <URL> [--sector <主机>] [--apply]  正式同步提前建出的重复号：解绑并封禁重复号，正式库改回原号的 sub 与映射（要求正式同步已停）
#   cutover.sh switch-issuer     --production-origin <URL> [--apply]                    签发者与 secret 换成正式的，reconfigure；先备份，前置不满足就拒绝
#   cutover.sh rollback-issuer   --preview-origin <URL> [--apply]                       签发者写回预发布，secret 与 gitlab.rb 用最近一次备份，reconfigure
#   cutover.sh path-status       --production-origin <URL> --sector <主机>               只读：GitLab 现在的地址、目标地址、正式库 gitlab 客户端的回调与 sector（#335）
#   cutover.sh move-production-path --production-origin <URL> --sector <主机> [--apply]   GitLab 搬到 <正式入口>/gitlab：先备份、记账号基线，加新回调（旧的留着），重建容器并等健康；失败恢复原样
#   cutover.sh check-production-path --production-origin <URL> --sector <主机>           只读：抽样成员的 sub 和搬家前一样，GitLab 没有多出不是成员号的账号
#   cutover.sh finish-production-path --production-origin <URL> --sector <主机> [--apply] 香港入口切好并核对之后：去掉旧回调，再备份一次
#   cutover.sh rollback-production-path --production-origin <URL> --sector <主机> [--apply] 补回旧回调，恢复原 compose 与 gitlab.rb 并重建容器，再去掉新回调
#   cutover.sh preview-sso      --preview-origin <URL> [--apply]                       独立预发布 GitLab 接预发布签发者：预发布库登记 gitlab_preview，只写 /srv/gitlab-preview/config 后 reconfigure（#335）
#   cutover.sh preview-parity   --preview-origin <URL> [--apply]                       独立预发布 GitLab 的界面配置、实例设置、外观和组 geek 与正式对齐：只写 /srv/gitlab-preview/config 与 gitlab-preview 容器（#335）
#   *-production-path 只改正式库的 gitlab 客户端，要求 GitLab 已信任正式签发者、正式 server 认得 sector 钉住（client show 带 sector_id）。
#
# --sector 是 gitlab 客户端钉住的 sector（正式 env 模板的 GITLAB_OIDC_SECTOR），GitLab 换地址时不变，成员的 sub 才不变。
# 正式 GitLab 的目标地址读同一次分发里的正式 env 模板（deploy/env/.env.production 的 GITLAB_URL）。
# 不打印任何 secret、sub 的值；对账明细只有计数和 provider_uid。
set -Eeuo pipefail
umask 077

STEP="${1:-}"
[[ $# -gt 0 ]] && shift
APPLY=0
PROD_ORIGIN=""
PREVIEW_ORIGIN=""
SECTOR=""
PROD_ROOT=""
PREVIEW_ROOT=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply) APPLY=1; shift ;;
        --production-origin) PROD_ORIGIN="${2:-}"; shift 2 ;;
        --preview-origin) PREVIEW_ORIGIN="${2:-}"; shift 2 ;;
        --sector) SECTOR="${2:-}"; shift 2 ;;
        --production-stack-root) PROD_ROOT="${2:-}"; shift 2 ;;
        --preview-stack-root) PREVIEW_ROOT="${2:-}"; shift 2 ;;
        *) echo "cutover: 未知参数 $1" >&2; exit 2 ;;
    esac
done

CONFIG="${GITLAB_CONFIG:-/srv/gitlab/config}"
DOCKER="${DOCKER:-docker}"
CURL="${CURL:-curl}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
FLOCK="${FLOCK:-flock}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_SERVER="${PROD_SERVER:-yzgc-production-server}"
PREVIEW_SERVER="${PREVIEW_SERVER:-yzgc-preview-server}"
GITLAB_CONTAINER="${GITLAB_CONTAINER:-gitlab}"
GITLAB_BACKUP_UNIT="${GITLAB_BACKUP_UNIT:-gitlab-backup.service}"
PYTHON="${PYTHON:-python3}"
# production-path.py 的 --root；测试换成演练目录
GITLAB_ROOT="${GITLAB_ROOT:-/}"
PROD_ENV_FILE="${PROD_ENV_FILE:-${HERE}/../env/.env.production}"
OIDC_CLI=(node app/server/dist/cli/oidc.js)
CALLBACK_PATH="/users/auth/openid_connect/callback"
# 搬家状态目录：production-path.py 只认 /srv/gitlab 这个栈根，收据和备份也在这里；accounts.json 是搬家前的账号基线（#335）
PATH_STATE="${GITLAB_ROOT%/}/srv/gitlab/path-move"
ACCOUNTS_BASELINE="${PATH_STATE}/accounts.json"
SUBJECT_SAMPLE=50
ISSUER_FILE="${CONFIG}/yzgc-oidc-issuer"
SECRET_FILE="${CONFIG}/yzgc-oidc-secret"
SECRET_PRODUCTION="${CONFIG}/yzgc-oidc-secret.production"
GITLAB_RB="${CONFIG}/gitlab.rb"
ISSUER_LINE_RE="^([[:space:]]*)issuer: '[^']*'"
# 独立预发布 GitLab（#308）的配置目录与容器；正式实例和正式库都不碰（#335）
PREVIEW_CONFIG="${PREVIEW_GITLAB_CONFIG:-/srv/gitlab-preview/config}"
PREVIEW_GITLAB_CONTAINER="${PREVIEW_GITLAB_CONTAINER:-gitlab-preview}"
PREVIEW_ENV_FILE="${PREVIEW_ENV_FILE:-${HERE}/../env/.env.preview}"
PREVIEW_CLIENT=gitlab_preview
# preview-compose.yml 加载 yzgc-ui.rb 的那一行；容器 env 里没有它，说明实例还没按新模板重建（#335）
PREVIEW_UI_LOADER="from_file '/etc/gitlab/yzgc-ui.rb' if File.file?('/etc/gitlab/yzgc-ui.rb')"

die() { echo "cutover: $*" >&2; exit 1; }
origin_ok() { [[ "$1" =~ ^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; }
need_production() { origin_ok "${PROD_ORIGIN}" || die "--production-origin 必须是 https://主机名"; }
sector_ok() { [[ "${SECTOR}" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "--sector 必须是主机名（正式 env 模板的 GITLAB_OIDC_SECTOR）"; }
gitlab_url() { # 正式 GitLab 的目标地址：本次分发的正式 env 模板里的 GITLAB_URL
    local url
    url="$(sed -n 's/^GITLAB_URL=//p' "${PROD_ENV_FILE}" 2>/dev/null)"
    [[ "${url}" == "${PROD_ORIGIN}/gitlab" ]] || die "正式 env 模板的 GITLAB_URL 不是 ${PROD_ORIGIN}/gitlab"
    echo "${url}"
}
writes() { if [[ "${APPLY}" == 1 ]]; then return 0; fi; echo "（演算，未写入；加 --apply 才执行）"; return 1; }

client_ids() { "${DOCKER}" exec "$1" "${OIDC_CLI[@]}" client list 2>/dev/null | jq -r '[.[].client_id] | join(",")'; }
discovery_issuer() { "${CURL}" -fsS -m 20 "$1/oidc/.well-known/openid-configuration" 2>/dev/null | jq -r '.issuer // empty'; }
issuer_mode() {
    local count
    count="$(grep -Ec "${ISSUER_LINE_RE}" "${GITLAB_RB}" || true)"
    if [[ "${count}" == 1 ]]; then echo "写死在 gitlab.rb：$(grep -E "${ISSUER_LINE_RE}" "${GITLAB_RB}" | sed -E "s/.*issuer: '([^']*)'.*/\1/")"
    elif grep -q "File.read('/etc/gitlab/yzgc-oidc-issuer')" "${GITLAB_RB}"; then echo "读宿主文件 yzgc-oidc-issuer"
    else echo "无法判断（gitlab.rb 里 issuer 行数 ${count}）"; fi
}

sync_control() {
    local environment="$1" network="$2" access="$3"
    shift 3
    sector_ok
    local root container image
    if [[ "${environment}" == production ]]; then root="${PROD_ROOT}"; container="${PROD_SERVER}"; else root="${PREVIEW_ROOT}"; container="${PREVIEW_SERVER}"; fi
    [[ "${root}" =~ ^/[A-Za-z0-9_./-]+/${environment}$ && "${root}" != *'/../'* ]] || die "缺少有效的 ${environment} stack root"
    [[ -f "${root}/.env.${environment}" ]] || die "缺少 ${environment} canonical env"
    image="$("${DOCKER}" inspect --format '{{.Config.Image}}' "${container}")"
    [[ -n "${image}" ]] || die "读不到 ${environment} server 镜像"
    "${DOCKER}" run --rm --pull=never -i --network "${network}" --volumes-from "${container}:${access}" \
      --env-file "${root}/.env.${environment}" --mount "type=bind,source=${HERE}/../..,target=/ops,readonly" \
      --entrypoint node "${image}" --experimental-transform-types /ops/deploy/gitlab/sync-control.mjs "$@" --sector "${SECTOR}"
}

verify_production_off() {
    local state running_mode
    state="$(sync_control production none ro status)"
    [[ "$(jq -r '.configuration.mode' <<<"${state}")" == off ]] || die "正式持久有效配置仍在同步：先 stop-production-sync"
    running_mode="$("${DOCKER}" exec "${PROD_SERVER}" node -p 'process.env.GITLAB_SYNC')"
    [[ "${running_mode}" == off ]] || die "正式运行容器 env 仍不是 off：先 stop-production-sync 完成停写重启"
}

verify_preview_off() {
    local state running_mode
    state="$(sync_control preview none ro status)"
    [[ "$(jq -r '.configuration.mode' <<<"${state}")" == off ]] || die "预发布持久有效配置仍在同步，拒绝切换"
    running_mode="$("${DOCKER}" exec "${PREVIEW_SERVER}" node -p 'process.env.GITLAB_SYNC')"
    [[ "${running_mode}" == off ]] || die "预发布运行容器 env 仍不是 off：先 stop-preview-sync 完成停写重启"
}

wait_server_health() {
    local container="$1" current
    for ((attempt=0; attempt<60; attempt++)); do
        current="$("${DOCKER}" inspect --format '{{.State.Health.Status}}' "${container}")"
        [[ "${current}" == healthy ]] && return 0
        sleep 3
    done
    return 1
}

restart_with_mode() (
    local environment="$1" mode="$2" root container compose previous next original_mode backup settings_changed=0
    if [[ "${environment}" == production ]]; then root="${PROD_ROOT}"; container="${PROD_SERVER}"; else root="${PREVIEW_ROOT}"; container="${PREVIEW_SERVER}"; fi
    compose="$("${DOCKER}" inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "${container}")"
    [[ "${compose}" == "${root}/"* && "${compose}" != *,* && -f "${compose}" ]] || die "${environment} compose 路径不在本环境栈内"
    [[ "$(grep -c '^GITLAB_SYNC=' "${root}/.env.${environment}")" == 1 ]] || die "${environment} env 的 GITLAB_SYNC 缺失或重复"
    # 沿用已经配置的一致性备份与隔离恢复门，不另外复制或重置业务库。
    "${SYSTEMCTL}" start "yzgc-backup@${environment}.service"
    exec 8>"${PROD_ROOT}/.deploy.lock"
    "${FLOCK}" -w 900 8 || die "正式部署锁等待超时"
    exec 9>"${PREVIEW_ROOT}/.deploy.lock"
    "${FLOCK}" -w 900 9 || die "预发布部署锁等待超时"
    original_mode="$(sync_control "${environment}" none ro status | jq -er '.configuration.mode')"
    [[ "${original_mode}" == on || "${original_mode}" == off ]] || die '只切换已核实的 on/off 写者，不改未知或 dry-run 状态'
    backup="${root}/.env.${environment}.sync-backup-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    cp -p "${root}/.env.${environment}" "${backup}"
    chmod 0600 "${backup}"
    recover_mode() {
        local failed="$1"
        [[ "${failed}" == 0 ]] && return 0
        trap - EXIT
        echo "cutover: ${environment} 切换失败，恢复原有效同步模式 ${original_mode}" >&2
        if [[ "${settings_changed}" == 0 ]]; then
            if ! "${DOCKER}" start "${container}" || ! wait_server_health "${container}"; then
                echo 'cutover: 原实例重启失败，设置未更改，需人工恢复' >&2
            fi
            return "${failed}"
        fi
        if ! "${DOCKER}" stop --time 120 "${container}"; then
            echo 'cutover: 无法停止失败实例，拒绝在运行中改持久设置' >&2
            return "${failed}"
        fi
        if ! sync_control "${environment}" none rw set-mode "${original_mode}" --apply; then
            echo 'cutover: 原有效模式恢复失败，实例保持停止，需人工恢复' >&2
            return "${failed}"
        fi
        cp -p "${backup}" "${root}/.env.${environment}.sync-restore"
        mv "${root}/.env.${environment}.sync-restore" "${root}/.env.${environment}"
        if "${DOCKER}" compose --env-file "${root}/.env.${environment}" -f "${compose}" up -d --no-deps --no-build --pull never server && wait_server_health "${container}"; then
            echo "cutover: ${environment} 已恢复原有效模式与原 env，服务健康；本次操作仍失败" >&2
        else
            echo 'cutover: 恢复后的健康门失败，需人工恢复' >&2
        fi
        return "${failed}"
    }
    trap 'recover_mode $?' EXIT
    previous="$("${DOCKER}" inspect --format '{{.State.StartedAt}}' "${container}")"
    "${DOCKER}" stop --time 120 "${container}"
    [[ "$("${DOCKER}" inspect --format '{{.State.ExitCode}}' "${container}")" == 0 ]] || die "${environment} 未正常排空退出，拒绝继续"
    settings_changed=1
    sync_control "${environment}" none rw set-mode "${mode}" --apply
    next="${root}/.env.${environment}.sync-new"
    sed -E "s/^GITLAB_SYNC=.*/GITLAB_SYNC=${mode}/" "${root}/.env.${environment}" >"${next}"
    chmod 0600 "${next}"
    mv "${next}" "${root}/.env.${environment}"
    "${DOCKER}" compose --env-file "${root}/.env.${environment}" -f "${compose}" up -d --no-deps --no-build --pull never server
    wait_server_health "${container}" || die "${environment} 重启后健康门失败"
    [[ "$("${DOCKER}" inspect --format '{{.State.StartedAt}}' "${container}")" != "${previous}" ]] || die "${environment} 旧进程未被替换"
    [[ "$("${DOCKER}" exec "${container}" node -p 'process.env.GITLAB_SYNC')" == "${mode}" ]] || die "${environment} 运行 env 未生效"
    [[ "$(sync_control "${environment}" none ro status | jq -r '.configuration.mode')" == "${mode}" ]] || die "${environment} 持久设置未生效"
    echo "${environment} 已排空旧进程、持久设置与运行 env=${mode}，新进程健康；未改镜像或业务记录"
    trap - EXIT
    "${FLOCK}" -u 9
    "${FLOCK}" -u 8
)

sync_status() {
    echo '正式同步配置与成员绑定：'
    sync_control production none ro status
    echo '预发布同步配置与成员绑定：'
    sync_control preview none ro status
}

stop_production_sync() {
    need_production
    echo '将排空正式旧进程，持久 mode 与 canonical env 均改 off，重启原镜像并核对健康；修完重复号后用 enable-production-sync 重开'
    writes || return 0
    restart_with_mode production off
    verify_production_off
}

stop_preview_sync() {
    need_production
    # 对不上身份时不先关掉仍在服务成员的旧写者；写入时能最小补建的不算对不上。
    APPLY=0 PROVISION_DRY=1 migrate_subjects
    echo '将排空预发布旧进程，持久 mode 与 canonical env 均改 off，重启原镜像并核对健康'
    writes || return 0
    restart_with_mode preview off
    verify_preview_off
}

enable_production_sync() {
    need_production
    verify_preview_off
    local pending baseline
    pending="$(APPLY=0 migrate_subjects)" || die '主体演算不完整，拒绝开启正式同步'
    grep -Eq '^演算 sector=[a-z0-9.-]+：可迁 0，冲突 0，目标库对不上 0，源账号无可对账身份 0$' <<<"${pending}" || die '主体尚未全部迁移，拒绝开启正式同步'
    baseline="$(sync_control preview none ro status)"
    sync_control production none ro check-baseline --baseline-stdin <<<"${baseline}"
    echo '将以原正式镜像开启唯一同步写者；启动后由现有循环立即对账'
    writes || return 0
    restart_with_mode production on
    verify_preview_off
}

verify_accounts() {
    verify_preview_off
    local baseline
    baseline="$(sync_control preview none ro status)"
    sync_control production "container:${PROD_SERVER}" ro verify --baseline-stdin <<<"${baseline}"
    # GitLab 搬过地址（#335）：再拿搬家前的基线核对抽样成员的 sub，以及搬家后没有多出不是成员号的 GitLab 账号
    if baseline_ok; then check_subjects; check_new_accounts; fi
}

status() {
    need_production
    echo "正式库客户端：$(client_ids "${PROD_SERVER}" || true)"
    echo "预发布库客户端：$(client_ids "${PREVIEW_SERVER}" || true)"
    echo "GitLab 签发者来源：$(issuer_mode)"
    if [[ -f "${ISSUER_FILE}" ]]; then echo "yzgc-oidc-issuer：$(tr -d '\n' <"${ISSUER_FILE}")"; else echo "yzgc-oidc-issuer：不存在"; fi
    echo "yzgc-oidc-secret：$([[ -f "${SECRET_FILE}" ]] && echo 存在 || echo 缺)；yzgc-oidc-secret.production：$([[ -f "${SECRET_PRODUCTION}" ]] && echo 存在 || echo 缺)"
    echo "正式发现文档的 issuer：$(discovery_issuer "${PROD_ORIGIN}" || true)"
}

register_client() {
    need_production
    if [[ ",$(client_ids "${PROD_SERVER}")," == *,gitlab,* ]]; then
        echo "正式库已有 gitlab 客户端：不动。secret 文件：$([[ -f "${SECRET_PRODUCTION}" ]] && echo 存在 || echo 缺)"
        [[ -f "${SECRET_PRODUCTION}" ]] || die "客户端已登记但 ${SECRET_PRODUCTION##*/} 不在：需要轮换 secret（oidc.js client rotate），不自动处理"
        return 0
    fi
    sector_ok
    local callback out
    callback="$(gitlab_url)${CALLBACK_PATH}"
    echo "正式库没有 gitlab 客户端：将登记 name=GitLab redirect=${callback} sector=${SECTOR}"
    writes || return 0
    out="$("${DOCKER}" exec "${PROD_SERVER}" "${OIDC_CLI[@]}" client add --name GitLab --client-id gitlab --redirect-uri "${callback}" --sector "${SECTOR}")"
    jq -ej '.client_secret' <<<"${out}" >"${SECRET_PRODUCTION}.new"
    chmod 0600 "${SECRET_PRODUCTION}.new"
    mv "${SECRET_PRODUCTION}.new" "${SECRET_PRODUCTION}"
    echo "已登记，secret 写入 ${SECRET_PRODUCTION##*/}（0600，值不打印）"
}

migrate_subjects() {
    need_production
    sector_ok
    if [[ "${APPLY}" == 1 ]]; then verify_preview_off; fi
    WORK="$(mktemp -d)"
    local work="${WORK}"
    # EXIT 而不是 RETURN：import 遇到冲突以非 0 退出时，导出文件（sub 与身份的对应）和容器里的脚本也要清掉
    trap 'rm -rf "${WORK}"; "${DOCKER}" exec "${PREVIEW_SERVER}" rm -f /tmp/migrate-oidc-subjects.mjs >/dev/null 2>&1 || true; "${DOCKER}" exec "${PROD_SERVER}" rm -f /tmp/migrate-oidc-subjects.mjs >/dev/null 2>&1 || true' EXIT
    "${DOCKER}" cp "${HERE}/migrate-oidc-subjects.mjs" "${PREVIEW_SERVER}:/tmp/migrate-oidc-subjects.mjs"
    "${DOCKER}" cp "${HERE}/migrate-oidc-subjects.mjs" "${PROD_SERVER}:/tmp/migrate-oidc-subjects.mjs"
    "${DOCKER}" exec "${PREVIEW_SERVER}" node /tmp/migrate-oidc-subjects.mjs export --sector "${SECTOR}" >"${work}/export.json"
    local flag=()
    if [[ "${APPLY}" == 1 ]]; then flag=(--apply --provision-unmatched)
    else
        echo "（演算，未写入；加 --apply 才执行）"
        # 停预发布写者前的演算：写入时能最小补建的不算对不上，否则缺号的成员要等预发布停写才能补建，两步互相卡住
        if [[ "${PROVISION_DRY:-0}" == 1 ]]; then flag=(--provision-unmatched); fi
    fi
    "${DOCKER}" exec -i "${PROD_SERVER}" node /tmp/migrate-oidc-subjects.mjs import --sector "${SECTOR}" "${flag[@]}" <"${work}/export.json"
}

repair_duplicates() {
    need_production
    sector_ok
    WORK="$(mktemp -d)"
    local work="${WORK}"
    trap 'rm -rf "${WORK}"; "${DOCKER}" exec "${PREVIEW_SERVER}" rm -f /tmp/migrate-oidc-subjects.mjs >/dev/null 2>&1 || true' EXIT
    "${DOCKER}" cp "${HERE}/migrate-oidc-subjects.mjs" "${PREVIEW_SERVER}:/tmp/migrate-oidc-subjects.mjs"
    "${DOCKER}" exec "${PREVIEW_SERVER}" node /tmp/migrate-oidc-subjects.mjs export --sector "${SECTOR}" >"${work}/export.json"
    if [[ "${APPLY}" != 1 ]]; then
        echo "（演算，未写入；加 --apply 才执行）"
        sync_control production "container:${PROD_SERVER}" ro repair-duplicates --source-stdin <"${work}/export.json"
        return
    fi
    (
        exec 8>"${PROD_ROOT}/.deploy.lock"
        "${FLOCK}" -w 900 8 || die "正式部署锁等待超时"
        # 正式同步循环开着时，它按 account_id 写回的头像、邮箱、权限缓存会和改映射撞车：拿到锁之后再确认正式写者已停
        verify_production_off
        # 改正式库之前先跑一次已有的一致性备份
        "${SYSTEMCTL}" start "yzgc-backup@production.service"
        sync_control production "container:${PROD_SERVER}" rw repair-duplicates --source-stdin --apply <"${work}/export.json"
    )
}

switch_issuer() {
    need_production
    [[ "$(discovery_issuer "${PROD_ORIGIN}")" == "${PROD_ORIGIN}/oidc" ]] || die "正式的发现文档不可用或 issuer 不是 ${PROD_ORIGIN}/oidc：先部署带 OIDC_JWKS 的正式版本"
    verify_preview_off
    [[ "$(sync_control production none ro status | jq -r '.configuration.mode')" == on ]] || die '正式同步尚未开启，拒绝开放正式 SSO'
    verify_accounts
    [[ ",$(client_ids "${PROD_SERVER}")," == *,gitlab,* ]] || die "正式库没有 gitlab 客户端：先 register-client"
    [[ -f "${SECRET_PRODUCTION}" ]] || die "缺 ${SECRET_PRODUCTION##*/}"
    [[ "$(grep -Ec "${ISSUER_LINE_RE}" "${GITLAB_RB}" || true)" == 1 ]] || grep -q "File.read('/etc/gitlab/yzgc-oidc-issuer')" "${GITLAB_RB}" || die "gitlab.rb 里找不到唯一的 issuer 行"
    # 目标找不到身份也会断联；只有完整演算成功且四项均清零才能切换。
    local pending
    pending="$(APPLY=0 migrate_subjects 2>&1)" || die "主体迁移演算失败，拒绝切换：$(grep -m1 '^演算' <<<"${pending}" || echo 演算失败)"
    grep -Eq '^演算 sector=[a-z0-9.-]+：可迁 0，冲突 0，目标库对不上 0，源账号无可对账身份 0$' <<<"${pending}" || die "还有 sub 没迁到正式库或身份未核清，先完成 migrate-subjects --apply：$(grep -m1 '^演算' <<<"${pending}" || echo 演算失败)"
    echo "前置满足：将备份 gitlab.rb 与 yzgc-oidc-secret，issuer 改为 ${PROD_ORIGIN}/oidc，secret 换成正式的，reconfigure"
    writes || return 0
    local stamp
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    # gitlab.rb 里已经是读文件的写法（上次重跑）时不再备份，原始写法的备份只留第一次的
    if grep -Eq "${ISSUER_LINE_RE}" "${GITLAB_RB}"; then cp -p "${GITLAB_RB}" "${GITLAB_RB}.bak-${stamp}-issuer"; fi
    # secret 已经是正式的（上次 reconfigure 失败后重跑）时不再备份：回滚要找的是预发布的 secret，重复备份会把正式的当成回滚点
    if [[ -f "${SECRET_FILE}" ]] && ! cmp -s "${SECRET_FILE}" "${SECRET_PRODUCTION}"; then cp -p "${SECRET_FILE}" "${SECRET_FILE}.bak-${stamp}"; fi
    [[ -f "${ISSUER_FILE}" ]] && cp -p "${ISSUER_FILE}" "${ISSUER_FILE}.bak-${stamp}"
    printf '%s/oidc\n' "${PROD_ORIGIN}" >"${ISSUER_FILE}.new"
    mv "${ISSUER_FILE}.new" "${ISSUER_FILE}"
    sed -E "s#${ISSUER_LINE_RE}#\\1issuer: File.read('/etc/gitlab/yzgc-oidc-issuer').strip#" "${GITLAB_RB}" >"${GITLAB_RB}.new"
    cat "${GITLAB_RB}.new" >"${GITLAB_RB}"
    rm -f "${GITLAB_RB}.new"
    cp "${SECRET_PRODUCTION}" "${SECRET_FILE}.new"
    chmod 0600 "${SECRET_FILE}.new"
    mv "${SECRET_FILE}.new" "${SECRET_FILE}"
    "${DOCKER}" exec "${GITLAB_CONTAINER}" gitlab-ctl reconfigure
    echo "已改接：issuer=${PROD_ORIGIN}/oidc。回滚用 rollback-issuer，备份后缀 ${stamp}"
}

rollback_issuer() {
    origin_ok "${PREVIEW_ORIGIN}" || die "--preview-origin 必须是 https://主机名"
    local rb secret
    # 备份后缀是 UTC 时间戳，字典序最大的就是最近一次
    rb="$(find "${CONFIG}" -maxdepth 1 -name 'gitlab.rb.bak-*-issuer' | sort | tail -1)"
    secret="$(find "${CONFIG}" -maxdepth 1 -name 'yzgc-oidc-secret.bak-*' | sort | tail -1)"
    [[ -n "${rb}" && -n "${secret}" ]] || die "没有 switch-issuer 留下的备份，无法回滚"
    if [[ -f "${SECRET_PRODUCTION}" ]] && cmp -s "${secret}" "${SECRET_PRODUCTION}"; then die "${secret##*/} 就是正式的 secret，回滚后 GitLab 会用正式 secret 去连预发布，登录失败：人工确认预发布 secret 再处理"; fi
    echo "将用 ${rb##*/} 与 ${secret##*/} 回滚，issuer 写回 ${PREVIEW_ORIGIN}/oidc，reconfigure"
    writes || return 0
    cp -p "${rb}" "${GITLAB_RB}"
    cp -p "${secret}" "${SECRET_FILE}"
    printf '%s/oidc\n' "${PREVIEW_ORIGIN}" >"${ISSUER_FILE}.new"
    mv "${ISSUER_FILE}.new" "${ISSUER_FILE}"
    "${DOCKER}" exec "${GITLAB_CONTAINER}" gitlab-ctl reconfigure
    echo "已回滚到预发布签发者"
}

# ── GitLab 搬到主站路径（#335）────────────────────────────────────────────────

# 独立预发布 GitLab 接预发布签发者（#335，正式与预发布一一对应）：预发布库登记 gitlab_preview（回调按预发布 env 模板的 GITLAB_URL），
# secret、签发者、地址和登录片段只写预发布实例的配置目录，再 reconfigure。登录片段取仓库的 gitlab-oidc.rb，只把客户端换成 gitlab_preview。
preview_sso() {
    origin_ok "${PREVIEW_ORIGIN}" || die "--preview-origin 必须是 https://主机名"
    local url callback state registered=no out
    url="$(sed -n 's/^GITLAB_URL=//p' "${PREVIEW_ENV_FILE}")"
    [[ "${url}" == "${PREVIEW_ORIGIN}/gitlab" ]] || die "预发布 env 模板的 GITLAB_URL（${url:-空}）不是 ${PREVIEW_ORIGIN}/gitlab"
    callback="${url}${CALLBACK_PATH}"
    state="$("${DOCKER}" inspect --format '{{.State.Health.Status}}' "${PREVIEW_GITLAB_CONTAINER}" 2>/dev/null || true)"
    [[ "${state}" == healthy ]] || die "预发布 GitLab 容器不健康（${state:-不存在}）：先 install-preview、verify-preview"
    [[ "$(discovery_issuer "${PREVIEW_ORIGIN}")" == "${PREVIEW_ORIGIN}/oidc" ]] || die "预发布的发现文档不可用或 issuer 不是 ${PREVIEW_ORIGIN}/oidc"
    [[ -d "${PREVIEW_CONFIG}" ]] || die "预发布 GitLab 配置目录 ${PREVIEW_CONFIG} 不在"
    if [[ ",$(client_ids "${PREVIEW_SERVER}")," == *",${PREVIEW_CLIENT},"* ]]; then registered=yes; fi
    if [[ "${registered}" == yes && ! -f "${PREVIEW_CONFIG}/yzgc-oidc-secret" ]]; then
        die "预发布库已有 ${PREVIEW_CLIENT} 客户端但 secret 文件不在：需要轮换 secret（oidc.js client rotate），不自动处理"
    fi
    echo "预发布 GitLab 接预发布签发者：客户端 ${PREVIEW_CLIENT}（$([[ "${registered}" == yes ]] && echo 已登记 || echo "将登记，回调 ${callback}")），签发者 ${PREVIEW_ORIGIN}/oidc，地址 ${url}；只写 ${PREVIEW_CONFIG}，再 reconfigure"
    writes || return 0
    if [[ "${registered}" == no ]]; then
        out="$("${DOCKER}" exec "${PREVIEW_SERVER}" "${OIDC_CLI[@]}" client add --name GitLab --client-id "${PREVIEW_CLIENT}" --redirect-uri "${callback}")"
        jq -ej '.client_secret' <<<"${out}" >"${PREVIEW_CONFIG}/yzgc-oidc-secret.new"
        chmod 0600 "${PREVIEW_CONFIG}/yzgc-oidc-secret.new"
        mv "${PREVIEW_CONFIG}/yzgc-oidc-secret.new" "${PREVIEW_CONFIG}/yzgc-oidc-secret"
    fi
    printf '%s/oidc\n' "${PREVIEW_ORIGIN}" >"${PREVIEW_CONFIG}/yzgc-oidc-issuer.new"
    mv "${PREVIEW_CONFIG}/yzgc-oidc-issuer.new" "${PREVIEW_CONFIG}/yzgc-oidc-issuer"
    printf '%s\n' "${url}" >"${PREVIEW_CONFIG}/yzgc-gitlab-url.new"
    mv "${PREVIEW_CONFIG}/yzgc-gitlab-url.new" "${PREVIEW_CONFIG}/yzgc-gitlab-url"
    sed "s/identifier: 'gitlab',/identifier: '${PREVIEW_CLIENT}',/" "${HERE}/gitlab-oidc.rb" >"${PREVIEW_CONFIG}/yzgc-oidc.rb.new"
    grep -q "identifier: '${PREVIEW_CLIENT}'," "${PREVIEW_CONFIG}/yzgc-oidc.rb.new" || { rm -f "${PREVIEW_CONFIG}/yzgc-oidc.rb.new"; die "登录片段里找不到 identifier: 'gitlab'，没有改写"; }
    mv "${PREVIEW_CONFIG}/yzgc-oidc.rb.new" "${PREVIEW_CONFIG}/yzgc-oidc.rb"
    "${DOCKER}" exec "${PREVIEW_GITLAB_CONTAINER}" gitlab-ctl reconfigure >/dev/null
    echo "已接上：预发布 GitLab 用 ${PREVIEW_CLIENT} 走 ${PREVIEW_ORIGIN}/oidc 统一登录（secret 不打印）"
}

# 预发布 GitLab 与正式对齐（#335，正式与预发布是同一套服务）：仓库的 gitlab-ui.rb 装成预发布配置目录的 yzgc-ui.rb 后 reconfigure，
# 实例设置、外观（标题、说明、PWA、系统消息颜色、徽标与图标）和组 geek（root 所有）由 preview-parity.rb 在 gitlab-preview 里写。
# 只建组，不建项目、不复制正式数据；正式实例和两边的库都不碰。前置：preview-sso 已写 yzgc-gitlab-url，容器已按新模板重建（重跑 install-preview）。
parity_runner() { # 在 gitlab-preview 里跑 preview-parity.rb，取最后一行 JSON；$1=1 才写
    local out
    out="$("${DOCKER}" exec -i -e "YZGC_APPLY=$1" -e "YZGC_LOGO_SHA256=$(sha256sum "${HERE}/ui/logo.png" | cut -d' ' -f1)" \
      -e "YZGC_FAVICON_SHA256=$(sha256sum "${HERE}/ui/favicon-32.png" | cut -d' ' -f1)" -e "YZGC_GROUP_AVATAR_SHA256=$(sha256sum "${HERE}/ui/group-avatar.png" | cut -d' ' -f1)" \
      "${PREVIEW_GITLAB_CONTAINER}" gitlab-rails runner - <"${HERE}/preview-parity.rb" | tail -n 1)" || return 1
    jq -e 'type == "object"' <<<"${out}" >/dev/null 2>&1 || return 1
    printf '%s\n' "${out}"
}

preview_parity() {
    origin_ok "${PREVIEW_ORIGIN}" || die "--preview-origin 必须是 https://主机名"
    local url state image ui_state out had_ui=0
    url="$(sed -n 's/^GITLAB_URL=//p' "${PREVIEW_ENV_FILE}")"
    [[ "${url}" == "${PREVIEW_ORIGIN}/gitlab" ]] || die "预发布 env 模板的 GITLAB_URL（${url:-空}）不是 ${PREVIEW_ORIGIN}/gitlab"
    state="$("${DOCKER}" inspect --format '{{.State.Health.Status}}' "${PREVIEW_GITLAB_CONTAINER}" 2>/dev/null || true)"
    [[ "${state}" == healthy ]] || die "预发布 GitLab 容器不健康（${state:-不存在}）：先 install-preview、verify-preview"
    [[ -d "${PREVIEW_CONFIG}" ]] || die "预发布 GitLab 配置目录 ${PREVIEW_CONFIG} 不在"
    # yzgc-ui.rb 的头像地址读这个文件，没有它 reconfigure 会失败
    [[ "$(cat "${PREVIEW_CONFIG}/yzgc-gitlab-url" 2>/dev/null)" == "${url}" ]] || die "预发布配置目录的 yzgc-gitlab-url 不是 ${url}：先 preview-sso"
    "${DOCKER}" inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "${PREVIEW_GITLAB_CONTAINER}" | grep -qF "${PREVIEW_UI_LOADER}" \
      || die "预发布 GitLab 容器还没按加载 yzgc-ui.rb 的模板重建：先重跑 install-preview（勾 apply）"
    for image in "${HERE}/gitlab-ui.rb" "${HERE}/preview-parity.rb" "${HERE}/ui/logo.png" "${HERE}/ui/favicon-32.png" "${HERE}/ui/group-avatar.png"; do
        [[ -f "${image}" ]] || die "本次分发缺 ${image#"${HERE}/"}"
    done
    if [[ ! -f "${PREVIEW_CONFIG}/yzgc-ui.rb" ]]; then ui_state=将新建; elif cmp -s "${HERE}/gitlab-ui.rb" "${PREVIEW_CONFIG}/yzgc-ui.rb"; then ui_state=已一致; else ui_state=将更新; fi
    echo "预发布 GitLab 与正式对齐：gitlab-ui.rb 装成 ${PREVIEW_CONFIG}/yzgc-ui.rb（${ui_state}）后 reconfigure；实例设置、外观与图片、组 geek（root 所有，只建组）按正式的值写进 ${PREVIEW_GITLAB_CONTAINER}"
    if [[ "${APPLY}" != 1 ]]; then
        out="$(parity_runner 0)" || die "读不出预发布 GitLab 的现状"
        echo "和正式不同的项：$(jq -r 'if (.pending | length) == 0 then "无" else .pending | join("、") end' <<<"${out}")"
    fi
    writes || return 0
    if [[ -f "${PREVIEW_CONFIG}/yzgc-ui.rb" ]]; then had_ui=1; cp -p "${PREVIEW_CONFIG}/yzgc-ui.rb" "${PREVIEW_CONFIG}/yzgc-ui.rb.before"; fi
    cp "${HERE}/gitlab-ui.rb" "${PREVIEW_CONFIG}/yzgc-ui.rb.new"
    mv "${PREVIEW_CONFIG}/yzgc-ui.rb.new" "${PREVIEW_CONFIG}/yzgc-ui.rb"
    if ! "${DOCKER}" exec "${PREVIEW_GITLAB_CONTAINER}" gitlab-ctl reconfigure >/dev/null; then
        if [[ "${had_ui}" == 1 ]]; then mv "${PREVIEW_CONFIG}/yzgc-ui.rb.before" "${PREVIEW_CONFIG}/yzgc-ui.rb"; else rm -f "${PREVIEW_CONFIG}/yzgc-ui.rb"; fi
        "${DOCKER}" exec "${PREVIEW_GITLAB_CONTAINER}" gitlab-ctl reconfigure >/dev/null || echo "cutover: 恢复原 yzgc-ui.rb 后的 reconfigure 也失败，需人工处理" >&2
        die "预发布 GitLab reconfigure 失败，已恢复原 yzgc-ui.rb；实例设置、外观和组都没动"
    fi
    rm -f "${PREVIEW_CONFIG}/yzgc-ui.rb.before"
    # 图片只临时放进容器的 /tmp/yzgc-parity，runner 以 git 用户读，结束就删
    trap '"${DOCKER}" exec "${PREVIEW_GITLAB_CONTAINER}" rm -rf /tmp/yzgc-parity >/dev/null 2>&1 || true' EXIT
    "${DOCKER}" exec "${PREVIEW_GITLAB_CONTAINER}" rm -rf /tmp/yzgc-parity
    "${DOCKER}" exec "${PREVIEW_GITLAB_CONTAINER}" mkdir -m 0755 /tmp/yzgc-parity
    for image in logo.png favicon-32.png group-avatar.png; do
        "${DOCKER}" cp "${HERE}/ui/${image}" "${PREVIEW_GITLAB_CONTAINER}:/tmp/yzgc-parity/${image}"
    done
    "${DOCKER}" exec "${PREVIEW_GITLAB_CONTAINER}" chmod 0644 /tmp/yzgc-parity/logo.png /tmp/yzgc-parity/favicon-32.png /tmp/yzgc-parity/group-avatar.png
    out="$(parity_runner 1)" || die "预发布 GitLab 写实例设置、外观或组 geek 失败（界面配置已生效；重跑本步骤会接着做）"
    echo "对齐结果：$(jq -c . <<<"${out}")"
    jq -e --arg avatar "${url}/nano-avatar/20261025/%{hash}?s=%{size}" '.remaining == [] and .gitlab_rb.packages_enabled == false and .gitlab_rb.dependency_proxy_enabled == false
      and .gitlab_rb.gravatar_plain_url == $avatar and .gitlab_rb.gravatar_ssl_url == $avatar and .group.full_path == "geek" and .group.root_owner == true' <<<"${out}" >/dev/null \
      || die "写完之后预发布 GitLab 仍和正式不同：$(jq -r '[(.remaining // [])[]] | join("、")' <<<"${out}")"
    echo "预发布 GitLab 的界面配置、实例设置、外观和组 geek 已与正式一致（组里不建项目）"
}

path_tool() { "${PYTHON}" "${HERE}/production-path.py" "$@" --env-file "${PROD_ENV_FILE}" --root "${GITLAB_ROOT}" --docker "${DOCKER}" --health-timeout "${GITLAB_HEALTH_TIMEOUT:-900}"; }

issuer_origin() { # GitLab 现在信任的签发者所在环境的 origin
    local issuer
    if [[ "$(grep -Ec "${ISSUER_LINE_RE}" "${GITLAB_RB}" || true)" == 1 ]]; then issuer="$(grep -E "${ISSUER_LINE_RE}" "${GITLAB_RB}" | sed -E "s/.*issuer: '([^']*)'.*/\1/")"
    elif grep -q "File.read('/etc/gitlab/yzgc-oidc-issuer')" "${GITLAB_RB}" && [[ -f "${ISSUER_FILE}" ]]; then issuer="$(tr -d '\n' <"${ISSUER_FILE}")"
    else die "读不出 GitLab 信任的签发者"; fi
    echo "${issuer%/oidc}"
}

# 正式库的 gitlab 客户端（client show，不含 secret）。旧版本的 server 不认得 client show，输出里也没有 sector_id：那时 sector 钉住
# 还没上线，改回调会让成员的 sub 跟着回调的主机变，所以一律拒绝，先用 deploy-hotfix 发带 #335 的版本。
production_client() {
    local out
    out="$("${DOCKER}" exec "${PROD_SERVER}" "${OIDC_CLI[@]}" client show --client-id gitlab 2>/dev/null)" || die "正式 server 读不出 gitlab 客户端（版本还不认得 client show，或库里没有 gitlab 客户端）：先用 deploy-hotfix 发带 #335 的版本"
    jq -e 'has("sector_id") and (.sector | type == "string") and (.redirect_uris | type == "array")' <<<"${out}" >/dev/null 2>&1 || die "正式 server 还不认得 sector 钉住（client show 没有 sector_id）：先用 deploy-hotfix 发带 #335 的版本"
    printf '%s\n' "${out}"
}

# 搬家只改正式库的 gitlab 客户端：GitLab 必须已经信任正式签发者，正式 server 认得 sector 钉住，生效的 sector 是 --sector。
# 预发布库的 gitlab 客户端不动，所以搬家之后 rollback-issuer 退回预发布签发者前要先 rollback-production-path。
checked_client() {
    local issuer client
    issuer="$(issuer_origin)" || exit 1
    [[ "${issuer}" == "${PROD_ORIGIN}" ]] || die "GitLab 信任的签发者是 ${issuer}/oidc，不是正式的：先完成 switch-issuer，再搬家"
    client="$(production_client)" || exit 1
    [[ "$(jq -r '.sector' <<<"${client}")" == "${SECTOR}" ]] || die "正式库 gitlab 客户端的 sector 不是 ${SECTOR}，拒绝改回调"
    printf '%s\n' "${client}"
}

redirect() { # add|remove 回调地址 → 输出 true/false（改了没有）；sector 不是 --sector 就失败
    local out
    out="$("${DOCKER}" exec "${PROD_SERVER}" "${OIDC_CLI[@]}" client "$1-redirect" --client-id gitlab --redirect-uri "$2")" || return 1
    [[ "$(jq -r '.sector' <<<"${out}")" == "${SECTOR}" ]] || { echo "cutover: 正式库 gitlab 客户端的 sector 不是 ${SECTOR}" >&2; return 1; }
    jq -r '.changed' <<<"${out}"
}

has_redirect() { [[ "$(production_client | jq -r --arg uri "$1" '.redirect_uris | index($uri) != null')" == true ]]; }

gitlab_rails() { # 在 GitLab 容器里跑一行 Ruby，取最后一行 JSON（和 restore-drill.sh 数账号的办法一样）
    local out
    out="$("${DOCKER}" exec "${GITLAB_CONTAINER}" gitlab-rails runner "$1" | tail -n 1)" || return 1
    jq -e 'type == "object"' <<<"${out}" >/dev/null 2>&1 || return 1
    printf '%s\n' "${out}"
}

# 搬家前的基线（path-move/accounts.json）：按账号 id 抽样的成员在 gitlab 客户端 sector 下的 sub 摘要，GitLab 的账号数与最大账号 id。
# 只有计数、摘要和本库的账号 id，不含 sub。
record_baseline() {
    local subjects gitlab
    subjects="$("${DOCKER}" exec "${PROD_SERVER}" "${OIDC_CLI[@]}" client subjects --client-id gitlab --limit "${SUBJECT_SAMPLE}")" || return 1
    [[ "$(jq -r '.sector' <<<"${subjects}")" == "${SECTOR}" ]] || return 1
    gitlab="$(gitlab_rails 'puts({users: User.count, max_id: User.maximum(:id).to_i}.to_json)')" || return 1
    mkdir -p "${PATH_STATE}"
    jq -c --argjson gitlab "${gitlab}" '{sector, accounts, count, missing, digest, gitlab_users: $gitlab.users, gitlab_max_id: $gitlab.max_id}' <<<"${subjects}" >"${ACCOUNTS_BASELINE}.new" || return 1
    mv "${ACCOUNTS_BASELINE}.new" "${ACCOUNTS_BASELINE}"
    echo "搬家前基线：抽样 $(jq -r '.accounts | length' "${ACCOUNTS_BASELINE}") 个成员（有 sub 的 $(jq -r '.count' "${ACCOUNTS_BASELINE}") 个），GitLab 账号 $(jq -r '.gitlab_users' "${ACCOUNTS_BASELINE}") 个"
}

baseline_ok() {
    [[ -f "${ACCOUNTS_BASELINE}" ]] && jq -e '(.accounts | type == "array") and (.digest | type == "string") and (.count | type == "number") and (.gitlab_users | type == "number") and (.gitlab_max_id | type == "number" and . == floor and . >= 0)' "${ACCOUNTS_BASELINE}" >/dev/null 2>&1
}

# 同一批成员按 gitlab 客户端现在的 sector 重算 sub 摘要，必须和搬家前一样
check_subjects() {
    local now sampled
    sampled="$(jq -r '.accounts | length' "${ACCOUNTS_BASELINE}")"
    now="$(jq -c '.accounts' "${ACCOUNTS_BASELINE}" | "${DOCKER}" exec -i "${PROD_SERVER}" "${OIDC_CLI[@]}" client subjects --client-id gitlab --accounts-stdin)" || die "重算抽样成员的 sub 摘要失败"
    [[ "$(jq -r '.sector' <<<"${now}")" == "${SECTOR}" ]] || die "gitlab 客户端现在的 sector 不是 ${SECTOR}"
    [[ "$(jq -r '"\(.count) \(.digest)"' <<<"${now}")" == "$(jq -r '"\(.count) \(.digest)"' "${ACCOUNTS_BASELINE}")" ]] || die "抽样的 ${sampled} 个成员里有人的 sub 和搬家前对不上"
    echo "抽样 ${sampled} 个成员的 sub：和搬家前一致"
}

# 搬家以后 GitLab 新增的账号（id 比搬家前最大的大）只能是正式库映射着的成员号（同步给新成员建的）；
# 有一个不是，就是有成员登录时 GitLab 没认出原来的号、另建了一个
check_new_accounts() {
    local after mapped stray
    after="$(gitlab_rails "puts({users: User.count, new_ids: User.where('id > ?', $(jq -r '.gitlab_max_id' "${ACCOUNTS_BASELINE}")).order(:id).pluck(:id)}.to_json)")" || die "读不出 GitLab 的账号"
    mapped="$(sync_control production none ro status | jq -c '[.bindings[].gitlab_id | select(. != null)]')" || die "读不出正式库的 GitLab 映射"
    stray="$(jq -c --argjson mapped "${mapped}" '.new_ids - $mapped' <<<"${after}")"
    echo "GitLab 账号：搬家前 $(jq -r '.gitlab_users' "${ACCOUNTS_BASELINE}") 个，现在 $(jq -r '.users' <<<"${after}") 个；搬家后新增 $(jq -r '.new_ids | length' <<<"${after}") 个，其中不是同步建的成员号 $(jq -r 'length' <<<"${stray}") 个"
    [[ "${stray}" == "[]" ]] || die "搬家后多出不是成员号的 GitLab 账号 ${stray}：有成员登录时没被认出原来的号，整批回滚 rollback-production-path"
}

path_status() {
    need_production
    sector_ok
    local plan current target client
    plan="$(path_tool plan)" || die "GitLab 地址演算失败"
    current="$(jq -r '.current_url' <<<"${plan}")"
    target="$(jq -r '.target_url' <<<"${plan}")"
    echo "GitLab 现在：${current}；目标：${target}；已搬：$(jq -r '.moved' <<<"${plan}")"
    echo "GitLab 容器日志：$(jq -r '.log_config | if type != "object" then "读不出" else "\(.Type)，每份 \(.Config["max-size"] // "不限")，留 \(.Config["max-file"] // "不限") 份" end' <<<"${plan}")"
    echo "GitLab 信任的签发者：$(issuer_origin)/oidc"
    if client="$(production_client 2>/dev/null)"; then
        jq -r --arg old "${current}${CALLBACK_PATH}" --arg new "${target}${CALLBACK_PATH}" \
          '"正式库：认得 sector 钉住，sector=\(.sector)，钉住值=\(.sector_id // "还没钉（第一次改回调时钉住）")，回调 \(.redirect_uris | length) 个，现地址回调\(if (.redirect_uris | index($old)) != null then "在" else "不在" end)，目标地址回调\(if (.redirect_uris | index($new)) != null then "在" else "不在" end)"' <<<"${client}"
    else
        echo "正式库：server 还不认得 sector 钉住（或没有 gitlab 客户端），搬家前先用 deploy-hotfix 发带 #335 的版本"
    fi
    if baseline_ok; then echo "搬家前基线：抽样 $(jq -r '.accounts | length' "${ACCOUNTS_BASELINE}") 个成员，GitLab 账号 $(jq -r '.gitlab_users' "${ACCOUNTS_BASELINE}") 个"; fi
}

move_production_path() {
    need_production
    sector_ok
    local plan current target moved changed added=0
    plan="$(path_tool plan)" || die "GitLab 地址演算失败"
    current="$(jq -r '.current_url' <<<"${plan}")"
    target="$(jq -r '.target_url' <<<"${plan}")"
    moved="$(jq -r '.moved' <<<"${plan}")"
    checked_client >/dev/null || exit 1
    echo "将把 GitLab 从 ${current} 搬到 ${target}：先做 GitLab 与正式库的一致性备份，记下抽样成员的 sub 摘要与 GitLab 账号数，给正式库的 gitlab 客户端加新回调（旧的留着），按模板重建容器（数据卷、镜像、网络不变）并等健康"
    writes || return 0
    "${SYSTEMCTL}" start "${GITLAB_BACKUP_UNIT}" || die "搬家前的 GitLab 备份失败，什么都没改"
    "${SYSTEMCTL}" start "yzgc-backup@production.service" || die "正式库备份失败，什么都没改"
    if [[ "${moved}" != true ]]; then record_baseline || die "记不下搬家前的账号基线，什么都没改"
    else baseline_ok || die "GitLab 已在 ${target}，但没有搬家前的账号基线"; fi
    changed="$(redirect add "${target}${CALLBACK_PATH}")" || die "正式库加新回调失败，GitLab 未动"
    [[ "${changed}" == true ]] && added=1
    if ! path_tool apply --apply; then
        if [[ "${added}" == 1 ]]; then redirect remove "${target}${CALLBACK_PATH}" >/dev/null || echo "cutover: 正式库的新回调没撤掉，需人工处理" >&2; fi
        die "GitLab 重建失败，已恢复原地址；新回调已撤回"
    fi
    echo "GitLab 已在 ${target} 健康运行；正式库新旧回调都在。下一步：香港入口 production-apply，公网核对后 check-production-path，再 finish-production-path"
}

# 只读：搬家之后、去掉旧回调之前的核对（move-path.sh 在公网核对之后调用，失败就整批回滚）
check_production_path() {
    need_production
    sector_ok
    local plan
    plan="$(path_tool plan)" || die "GitLab 地址演算失败"
    [[ "$(jq -r '.moved' <<<"${plan}")" == true ]] || die "GitLab 还没搬到 $(jq -r '.target_url' <<<"${plan}")"
    checked_client >/dev/null || exit 1
    baseline_ok || die "没有搬家前的账号基线（${ACCOUNTS_BASELINE}）"
    check_subjects
    check_new_accounts
}

finish_production_path() {
    need_production
    sector_ok
    local plan target previous
    plan="$(path_tool plan)" || die "GitLab 地址演算失败"
    target="$(jq -r '.target_url' <<<"${plan}")"
    previous="$(jq -r '.previous_url // empty' <<<"${plan}")"
    [[ "$(jq -r '.moved' <<<"${plan}")" == true && -n "${previous}" ]] || die "GitLab 还没搬到 ${target}：先 move-production-path"
    path_tool verify >/dev/null || die "GitLab 在 ${target} 不健康，旧回调留着"
    checked_client >/dev/null || exit 1
    has_redirect "${target}${CALLBACK_PATH}" || die "正式库还没有新回调，旧回调留着"
    echo "将从正式库的 gitlab 客户端去掉旧回调 ${previous}${CALLBACK_PATH}，再做一次 GitLab 备份"
    writes || return 0
    redirect remove "${previous}${CALLBACK_PATH}" >/dev/null || die "正式库去掉旧回调失败"
    "${SYSTEMCTL}" start "${GITLAB_BACKUP_UNIT}" || die "旧回调已去掉，但搬家后的 GitLab 备份失败：重跑 finish-production-path 补备份"
    echo "已去掉旧回调；搬家后的 GitLab 备份完成"
}

# 回滚先补回旧回调再动 GitLab，最后去掉新回调；全程要求正式 server 仍是认得 sector 钉住的版本。
# 回调改完之后不能直接把 server 退回旧镜像：旧版本按第一个回调的主机算 sector，成员的 sub 会变；先跑完这一步再退镜像。
rollback_production_path() {
    need_production
    sector_ok
    local plan target previous
    plan="$(path_tool plan)" || die "GitLab 地址演算失败"
    target="$(jq -r '.target_url' <<<"${plan}")"
    previous="$(jq -r '.previous_url // empty' <<<"${plan}")"
    [[ -n "${previous}" ]] || die "没有搬家留下的记录，无法回滚"
    checked_client >/dev/null || exit 1
    echo "将给正式库补回旧回调，恢复 ${previous} 的 compose 与 gitlab.rb 并重建容器，健康后去掉新回调"
    writes || return 0
    redirect add "${previous}${CALLBACK_PATH}" >/dev/null || die "正式库补回旧回调失败，GitLab 未动"
    path_tool rollback --apply || die "GitLab 恢复原地址失败；新旧回调都留着"
    redirect remove "${target}${CALLBACK_PATH}" >/dev/null || die "GitLab 已回到 ${previous}，但正式库的新回调没去掉"
    echo "已回到 ${previous}，新回调已去掉"
}

case "${STEP}" in
    status) status ;;
    sync-status) sync_status ;;
    stop-production-sync) stop_production_sync ;;
    stop-preview-sync) stop_preview_sync ;;
    enable-production-sync) enable_production_sync ;;
    verify-accounts) verify_accounts ;;
    register-client) register_client ;;
    migrate-subjects) migrate_subjects ;;
    repair-duplicates) repair_duplicates ;;
    switch-issuer) switch_issuer ;;
    rollback-issuer) rollback_issuer ;;
    path-status) path_status ;;
    move-production-path) move_production_path ;;
    check-production-path) check_production_path ;;
    finish-production-path) finish_production_path ;;
    rollback-production-path) rollback_production_path ;;
    preview-sso) preview_sso ;;
    preview-parity) preview_parity ;;
    *) echo "用法：cutover.sh status|sync-status|stop-production-sync|stop-preview-sync|enable-production-sync|verify-accounts|register-client|migrate-subjects|repair-duplicates|switch-issuer|rollback-issuer|path-status|move-production-path|check-production-path|finish-production-path|rollback-production-path|preview-sso|preview-parity [--apply] ..." >&2; exit 2 ;;
esac
