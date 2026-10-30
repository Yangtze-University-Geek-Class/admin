#!/usr/bin/env bash
# 正式 GitLab 搬到 <正式入口>/gitlab 的整条链路（#335），由 .github/workflows/gitlab-cutover.yml 在 runner 上调用：
# Arch 那一半是 cutover.sh 的 *-production-path，香港那一半是受限入口的 production-*，核对走公网。缺省只演算，--apply 才写。
#
#   move-path.sh status   --gitlab-url <URL> --legacy-origin <URL> --issuer-origins "<正式> <预发布>"
#   move-path.sh move     … [--apply]   Arch 搬家 → 香港切入口 → 核对新地址、旧地址 301、统一登录跳转 → 去掉旧回调
#   move-path.sh rollback … [--apply]   香港入口恢复 → Arch 恢复原地址与旧回调
#
# ARCH 与 EDGE 是两个可执行文件：ARCH <cutover 步骤> [--apply] 在 Arch 上跑 cutover.sh，EDGE <动作> 调受限入口。
# 核对失败或任何一步失败都会把已经做了的两半恢复原样再返回失败。输出只有步骤、HTTP 状态和计数，不打印令牌、cookie 或跳转参数。
set -Eeuo pipefail

ACTION="${1:-}"
[[ $# -gt 0 ]] && shift
APPLY=0
GITLAB_URL=""
LEGACY_ORIGIN=""
ISSUER_ORIGINS=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply) APPLY=1; shift ;;
        --gitlab-url) GITLAB_URL="${2:-}"; shift 2 ;;
        --legacy-origin) LEGACY_ORIGIN="${2:-}"; shift 2 ;;
        --issuer-origins) ISSUER_ORIGINS="${2:-}"; shift 2 ;;
        *) echo "move-path: 未知参数 $1" >&2; exit 2 ;;
    esac
done
ARCH="${ARCH:?ARCH 必须指向在 Arch 上执行 cutover.sh 的命令}"
EDGE="${EDGE:?EDGE 必须指向调用香港受限入口的命令}"
CURL="${CURL:-curl}"
CALLBACK_PATH="/users/auth/openid_connect/callback"

die() { echo "move-path: $*" >&2; exit 1; }
origin_ok() { [[ "$1" =~ ^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]]; }
[[ "${GITLAB_URL}" =~ ^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?/gitlab$ ]] || die "--gitlab-url 必须是 https://主机名/gitlab"
origin_ok "${LEGACY_ORIGIN}" || die "--legacy-origin 必须是 https://主机名"
for origin in ${ISSUER_ORIGINS}; do origin_ok "${origin}" || die "--issuer-origins 只收 https://主机名"; done
[[ -n "${ISSUER_ORIGINS}" ]] || die "缺少 --issuer-origins"

http() { "${CURL}" --silent --show-error --max-time 30 "$@"; }

# 三项公网核对：新地址能打开；旧地址 301 到新地址的同一路径（带查询串，git 跟着它走）；统一登录跳到签发者并带新回调，签发者接受这个回调
verify() {
    local code redirect jar token location expected status
    code="$(http -o /dev/null -w '%{http_code}' "${GITLAB_URL}/users/sign_in?auto_sign_in=false")" || code=000
    echo "新地址登录页：HTTP ${code}"
    [[ "${code}" == 200 ]] || return 1
    expected="${GITLAB_URL}/geek/admin.git/info/refs?service=git-upload-pack"
    redirect="$(http -o /dev/null -w '%{http_code} %{redirect_url}' "${LEGACY_ORIGIN}/geek/admin.git/info/refs?service=git-upload-pack")" || redirect=000
    echo "旧地址：HTTP ${redirect%% *}，$([[ "${redirect}" == "301 ${expected}" ]] && echo '跳到新地址的同一路径' || echo '没有跳到新地址的同一路径')"
    [[ "${redirect}" == "301 ${expected}" ]] || return 1
    jar="$(mktemp)"
    token="$(http -c "${jar}" "${GITLAB_URL}/users/sign_in?auto_sign_in=false" | sed -n 's/.*<meta name="csrf-token" content="\([^"]*\)".*/\1/p' | head -1)" || token=""
    location=""
    if [[ -n "${token}" ]]; then
        location="$(http -b "${jar}" -o /dev/null -w '%{redirect_url}' -X POST --data-urlencode "authenticity_token=${token}" "${GITLAB_URL}/users/auth/openid_connect")" || location=""
    fi
    rm -f "${jar}"
    local encoded issuer matched=""
    encoded="$(jq -rn --arg value "${GITLAB_URL}${CALLBACK_PATH}" '$value | @uri')"
    for issuer in ${ISSUER_ORIGINS}; do
        if [[ "${location}" == "${issuer}/oidc/auth?"* && "${location}" == *"redirect_uri=${encoded}"* ]]; then matched="${issuer}"; fi
    done
    echo "统一登录：$([[ -n "${matched}" ]] && echo "跳到 ${matched}/oidc/auth，带新回调" || echo '没有跳到签发者或回调不是新地址')"
    [[ -n "${matched}" ]] || return 1
    status="$(http -o /dev/null -w '%{http_code}' "${location}")" || status=000
    echo "签发者对新回调：HTTP ${status}"
    [[ "${status}" == 302 || "${status}" == 303 ]]
}

restore_arch() {
    "${ARCH}" rollback-production-path --apply || { echo "move-path: Arch 恢复失败，需人工处理" >&2; return 1; }
}

restore() {
    echo "move-path: 恢复香港入口与 Arch 原地址" >&2
    local failed=0
    "${EDGE}" production-rollback || { echo "move-path: 香港入口恢复失败，需人工处理" >&2; failed=1; }
    restore_arch || failed=1
    return "${failed}"
}

case "${ACTION}" in
    status)
        "${ARCH}" path-status
        "${EDGE}" production-plan ;;
    move)
        if [[ "${APPLY}" != 1 ]]; then
            "${ARCH}" move-production-path
            "${EDGE}" production-plan
            echo "（演算，未写入；勾选 apply 才执行）"
            exit 0
        fi
        "${ARCH}" move-production-path --apply || die "Arch 搬家失败（已由 cutover.sh 恢复原样），香港入口未动"
        # 接收器切换失败时自己恢复原配置、不写收据，这里只需恢复 Arch
        if ! "${EDGE}" production-apply; then restore_arch || die "香港入口切换失败，Arch 恢复也没有完成"; die "香港入口切换失败，已恢复"; fi
        if ! verify; then restore || die "公网核对未通过，恢复也没有完成"; die "公网核对未通过，已恢复原地址"; fi
        "${ARCH}" finish-production-path --apply || die "搬家与核对都已完成，但去掉旧回调或搬家后的备份失败：重跑 move 会从这一步接着做"
        echo "GitLab 已在 ${GITLAB_URL}；旧地址只做跳转" ;;
    rollback)
        if [[ "${APPLY}" != 1 ]]; then
            "${ARCH}" rollback-production-path
            echo "（演算，未写入；勾选 apply 才执行）"
            exit 0
        fi
        restore || die "回滚没有完成"
        echo "已回到搬家前的地址" ;;
    *) echo "用法：move-path.sh status|move|rollback --gitlab-url <URL> --legacy-origin <URL> --issuer-origins \"<正式> <预发布>\" [--apply]" >&2; exit 2 ;;
esac
