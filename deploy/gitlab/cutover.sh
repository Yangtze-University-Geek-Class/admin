#!/usr/bin/env bash
# GitLab 统一登录改接正式的宿主侧步骤（同构清单 P-0006、P-0007，docs/ops/GITLAB.md）。由 .github/workflows/gitlab-cutover.yml
# 经部署用的 SSH 通道调用，开发者不需要登录目标机；缺省全是只读或演算，加 --apply 才写。
#
#   cutover.sh status            --production-origin <URL>                              只读：客户端、签发者、secret 文件是否就位、正式的发现文档
#   cutover.sh register-client   --production-origin <URL> [--apply]                    正式库登记 gitlab 客户端，secret 只写 yzgc-oidc-secret.production（0600）；已有就不动
#   cutover.sh migrate-subjects  --production-origin <URL> [--sector <主机>] [--apply]  把预发布里 GitLab 已在用的 sub 带到正式库（只新增，冲突整批拒绝）
#   cutover.sh repair-duplicates --production-origin <URL> [--sector <主机>] [--apply]  正式同步提前建出的重复号：解绑并封禁重复号，正式库改回原号的 sub 与映射
#   cutover.sh switch-issuer     --production-origin <URL> [--apply]                    签发者与 secret 换成正式的，reconfigure；先备份，前置不满足就拒绝
#   cutover.sh rollback-issuer   --preview-origin <URL> [--apply]                       签发者写回预发布，secret 与 gitlab.rb 用最近一次备份，reconfigure
#
# 不打印任何 secret、sub 的值；对账明细只有计数和 provider_uid。
set -Eeuo pipefail
umask 077

STEP="${1:-}"
[[ $# -gt 0 ]] && shift
APPLY=0
PROD_ORIGIN=""
PREVIEW_ORIGIN=""
SECTOR="git.yangtzeu.work"
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
OIDC_CLI=(node app/server/dist/cli/oidc.js)
CALLBACK="https://${SECTOR}/users/auth/openid_connect/callback"
ISSUER_FILE="${CONFIG}/yzgc-oidc-issuer"
SECRET_FILE="${CONFIG}/yzgc-oidc-secret"
SECRET_PRODUCTION="${CONFIG}/yzgc-oidc-secret.production"
GITLAB_RB="${CONFIG}/gitlab.rb"
ISSUER_LINE_RE="^([[:space:]]*)issuer: '[^']*'"

die() { echo "cutover: $*" >&2; exit 1; }
origin_ok() { [[ "$1" =~ ^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; }
need_production() { origin_ok "${PROD_ORIGIN}" || die "--production-origin 必须是 https://主机名"; }
sector_ok() { [[ "${SECTOR}" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "--sector 必须是主机名"; }
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
    echo "正式库没有 gitlab 客户端：将登记 name=GitLab redirect=${CALLBACK}"
    writes || return 0
    local out
    out="$("${DOCKER}" exec "${PROD_SERVER}" "${OIDC_CLI[@]}" client add --name GitLab --client-id gitlab --redirect-uri "${CALLBACK}")"
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
    local work="${WORK}" flag=() access=ro
    trap 'rm -rf "${WORK}"; "${DOCKER}" exec "${PREVIEW_SERVER}" rm -f /tmp/migrate-oidc-subjects.mjs >/dev/null 2>&1 || true' EXIT
    "${DOCKER}" cp "${HERE}/migrate-oidc-subjects.mjs" "${PREVIEW_SERVER}:/tmp/migrate-oidc-subjects.mjs"
    "${DOCKER}" exec "${PREVIEW_SERVER}" node /tmp/migrate-oidc-subjects.mjs export --sector "${SECTOR}" >"${work}/export.json"
    if [[ "${APPLY}" == 1 ]]; then
        flag=(--apply)
        access=rw
        # 改正式库之前先跑一次已有的一致性备份
        "${SYSTEMCTL}" start "yzgc-backup@production.service"
    else
        echo "（演算，未写入；加 --apply 才执行）"
    fi
    sync_control production "container:${PROD_SERVER}" "${access}" repair-duplicates --source-stdin "${flag[@]}" <"${work}/export.json"
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

case "${STEP}" in
    status) status ;;
    sync-status) sync_status ;;
    stop-preview-sync) stop_preview_sync ;;
    enable-production-sync) enable_production_sync ;;
    verify-accounts) verify_accounts ;;
    register-client) register_client ;;
    migrate-subjects) migrate_subjects ;;
    repair-duplicates) repair_duplicates ;;
    switch-issuer) switch_issuer ;;
    rollback-issuer) rollback_issuer ;;
    *) echo "用法：cutover.sh status|sync-status|stop-preview-sync|enable-production-sync|verify-accounts|register-client|migrate-subjects|repair-duplicates|switch-issuer|rollback-issuer [--apply] ..." >&2; exit 2 ;;
esac
