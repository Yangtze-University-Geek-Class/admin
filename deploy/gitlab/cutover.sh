#!/usr/bin/env bash
# GitLab 统一登录改接正式的宿主侧步骤（同构清单 P-0006、P-0007，docs/ops/GITLAB.md）。由 .github/workflows/gitlab-cutover.yml
# 经部署用的 SSH 通道调用，开发者不需要登录目标机；缺省全是只读或演算，加 --apply 才写。
#
#   cutover.sh status            --production-origin <URL>                              只读：客户端、签发者、secret 文件是否就位、正式的发现文档
#   cutover.sh register-client   --production-origin <URL> [--apply]                    正式库登记 gitlab 客户端，secret 只写 yzgc-oidc-secret.production（0600）；已有就不动
#   cutover.sh migrate-subjects  --production-origin <URL> [--sector <主机>] [--apply]  把预发布里 GitLab 已在用的 sub 带到正式库（只新增，冲突整批拒绝）
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
while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply) APPLY=1; shift ;;
        --production-origin) PROD_ORIGIN="${2:-}"; shift 2 ;;
        --preview-origin) PREVIEW_ORIGIN="${2:-}"; shift 2 ;;
        --sector) SECTOR="${2:-}"; shift 2 ;;
        *) echo "cutover: 未知参数 $1" >&2; exit 2 ;;
    esac
done

CONFIG="${GITLAB_CONFIG:-/srv/gitlab/config}"
DOCKER="${DOCKER:-docker}"
CURL="${CURL:-curl}"
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
    WORK="$(mktemp -d)"
    local work="${WORK}"
    # EXIT 而不是 RETURN：import 遇到冲突以非 0 退出时，导出文件（sub 与身份的对应）和容器里的脚本也要清掉
    trap 'rm -rf "${WORK}"; "${DOCKER}" exec "${PREVIEW_SERVER}" rm -f /tmp/migrate-oidc-subjects.mjs >/dev/null 2>&1 || true; "${DOCKER}" exec "${PROD_SERVER}" rm -f /tmp/migrate-oidc-subjects.mjs >/dev/null 2>&1 || true' EXIT
    "${DOCKER}" cp "${HERE}/migrate-oidc-subjects.mjs" "${PREVIEW_SERVER}:/tmp/migrate-oidc-subjects.mjs"
    "${DOCKER}" cp "${HERE}/migrate-oidc-subjects.mjs" "${PROD_SERVER}:/tmp/migrate-oidc-subjects.mjs"
    "${DOCKER}" exec "${PREVIEW_SERVER}" node /tmp/migrate-oidc-subjects.mjs export --sector "${SECTOR}" >"${work}/export.json"
    local flag=()
    if [[ "${APPLY}" == 1 ]]; then flag=(--apply); else echo "（演算，未写入；加 --apply 才执行）"; fi
    "${DOCKER}" exec -i "${PROD_SERVER}" node /tmp/migrate-oidc-subjects.mjs import --sector "${SECTOR}" "${flag[@]}" <"${work}/export.json"
}

switch_issuer() {
    need_production
    [[ "$(discovery_issuer "${PROD_ORIGIN}")" == "${PROD_ORIGIN}/oidc" ]] || die "正式的发现文档不可用或 issuer 不是 ${PROD_ORIGIN}/oidc：先部署带 OIDC_JWKS 的正式版本"
    [[ ",$(client_ids "${PROD_SERVER}")," == *,gitlab,* ]] || die "正式库没有 gitlab 客户端：先 register-client"
    [[ -f "${SECRET_PRODUCTION}" ]] || die "缺 ${SECRET_PRODUCTION##*/}"
    [[ "$(grep -Ec "${ISSUER_LINE_RE}" "${GITLAB_RB}" || true)" == 1 ]] || grep -q "File.read('/etc/gitlab/yzgc-oidc-issuer')" "${GITLAB_RB}" || die "gitlab.rb 里找不到唯一的 issuer 行"
    # 已有 GitLab 用户的 sub 没带到正式库就切换，他们首次登录会被建成新账号，rollback 撤销不了：先要求演算结果是「可迁 0，冲突 0」
    local pending
    pending="$(APPLY=0 migrate_subjects 2>&1 || true)"
    grep -q '可迁 0，冲突 0' <<<"${pending}" || die "还有 sub 没迁到正式库（或有冲突），先 migrate-subjects --apply：$(grep -m1 '^演算' <<<"${pending}" || echo 演算失败)"
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
    register-client) register_client ;;
    migrate-subjects) migrate_subjects ;;
    switch-issuer) switch_issuer ;;
    rollback-issuer) rollback_issuer ;;
    *) echo "用法：cutover.sh status|register-client|migrate-subjects|switch-issuer|rollback-issuer [--apply] ..." >&2; exit 2 ;;
esac
