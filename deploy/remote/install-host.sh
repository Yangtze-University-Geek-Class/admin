#!/usr/bin/env bash
# 宿主层物料的安装与核对：systemd 单元、隧道看门狗覆盖项、CDN 镜像脚本。由部署流水线在发布后调用，
# 开发者不需要登录目标机；本机或 CI 里用 --root 指向临时目录就能演练，不碰 systemctl。
#
#   install-host.sh plan   --source <物料目录> [--root /]   只读：逐项比对仓库物料和目标机上的文件，列出 same / changed / missing
#   install-host.sh apply  --source <物料目录> [--root /] [--mirror-env-stdin]
#                          changed / missing 的文件备份后覆盖，daemon-reload，镜像的定时器在有凭据时启用。
#                          只 daemon-reload，不重启任何服务：站点容器和隧道不会因为装物料被停掉。
#   install-host.sh verify --source <物料目录> [--root /]   plan 全部 same，且 systemd 里的状态符合物料的意图，否则退出码 1
#
# --mirror-env-stdin：从 stdin 读两行 CDN_MIRROR_ACCESS_KEY_ID=、CDN_MIRROR_SECRET_ACCESS_KEY=，原子写到 /etc/cdn-mirror/env（0600）。
# 凭据来自流水线的环境 secret，不打印，不进 argv。
set -Eeuo pipefail
umask 077

MODE="${1:-}"
[[ $# -gt 0 ]] && shift
SOURCE=""
ROOT="/"
MIRROR_ENV_STDIN=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --source) SOURCE="${2:-}"; shift 2 ;;
        --root) ROOT="${2:-}"; shift 2 ;;
        --mirror-env-stdin) MIRROR_ENV_STDIN=1; shift ;;
        *) echo "install-host: 未知参数 $1" >&2; exit 2 ;;
    esac
done
[[ "${MODE}" =~ ^(plan|apply|verify)$ ]] || { echo "用法：install-host.sh plan|apply|verify --source <目录> [--root /]" >&2; exit 2; }
[[ -d "${SOURCE}" ]] || { echo "install-host: --source 目录不存在" >&2; exit 2; }
[[ "${ROOT}" == /* ]] || { echo "install-host: --root 必须是绝对路径" >&2; exit 2; }
ROOT="${ROOT%/}"

# 源文件相对路径 → 目标路径 → 权限。新增物料只改这张表。
MANIFEST=(
    "cdn-mirror.sh|/opt/yzgc/tools/cdn-mirror.sh|0755"
    "cdn-mirror.hosts|/etc/cdn-mirror/hosts|0644"
    "systemd/cdn-mirror.service|/etc/systemd/system/cdn-mirror.service|0644"
    "systemd/cdn-mirror.timer|/etc/systemd/system/cdn-mirror.timer|0644"
    "systemd/cdn-mirror-watch.service|/etc/systemd/system/cdn-mirror-watch.service|0644"
    "systemd/cdn-mirror-watch.timer|/etc/systemd/system/cdn-mirror-watch.timer|0644"
    "systemd/yzgc-compose@.service|/etc/systemd/system/yzgc-compose@.service|0644"
    "systemd/hk-tunnel-watchdog.service.d/tolerate-loss.conf|/etc/systemd/system/hk-tunnel-watchdog.service.d/tolerate-loss.conf|0644"
)
MIRROR_ENV="${ROOT}/etc/cdn-mirror/env"
SYSTEMCTL="${INSTALL_HOST_SYSTEMCTL:-systemctl}"
# 只有装在真实根上（或测试显式给了假的 systemctl）才碰 systemd；演练目录里不调用
use_systemd() { [[ -z "${ROOT}" || -n "${INSTALL_HOST_SYSTEMCTL:-}" ]]; }

digest() { sha256sum "$1" | cut -d' ' -f1; }
status_of() { # 源 目标 → same|changed|missing；算不出摘要时直接失败，不能当作 same
    local src="$1" dest="$2" a b
    if [[ ! -e "${dest}" ]]; then echo missing; return; fi
    a="$(digest "${src}")" && [[ -n "${a}" ]] || { echo "install-host: 算不出 ${src} 的摘要" >&2; exit 2; }
    b="$(digest "${dest}")" && [[ -n "${b}" ]] || { echo "install-host: 算不出 ${dest} 的摘要" >&2; exit 2; }
    if [[ "${a}" == "${b}" ]]; then echo same; else echo changed; fi
}

differences=0
plan() {
    local entry rel dest mode src state
    for entry in "${MANIFEST[@]}"; do
        IFS='|' read -r rel dest mode <<<"${entry}"
        src="${SOURCE}/${rel}"
        [[ -f "${src}" ]] || { echo "install-host: 物料缺少 ${rel}" >&2; exit 2; }
        state="$(status_of "${src}" "${ROOT}${dest}")"
        [[ "${state}" == same ]] || differences=$((differences + 1))
        printf '%-8s %s\n' "${state}" "${dest}"
    done
}

# 先读完并校验 stdin，再动任何文件：凭据不合法时不会留下装了一半的单元
MIRROR_ID=""
MIRROR_SECRET=""
read_mirror_credentials() {
    local line
    while IFS= read -r line; do
        case "${line}" in
            CDN_MIRROR_ACCESS_KEY_ID=*) MIRROR_ID="${line#*=}" ;;
            CDN_MIRROR_SECRET_ACCESS_KEY=*) MIRROR_SECRET="${line#*=}" ;;
        esac
    done
    if [[ -z "${MIRROR_ID}" || -z "${MIRROR_SECRET}" ]]; then echo "install-host: stdin 里没有完整的镜像凭据，保持原文件不动" >&2; MIRROR_ID=""; MIRROR_SECRET=""; return 0; fi
    [[ "${MIRROR_ID}" =~ ^[A-Za-z0-9]+$ && "${MIRROR_SECRET}" =~ ^[A-Za-z0-9+/=_-]+$ ]] || { echo "install-host: 镜像凭据含非法字符" >&2; exit 2; }
}

write_mirror_env() {
    local id="${MIRROR_ID}" secret="${MIRROR_SECRET}"
    [[ -n "${id}" && -n "${secret}" ]] || return 0
    install -d -m 0700 "$(dirname "${MIRROR_ENV}")"
    printf 'CDN_MIRROR_ACCESS_KEY_ID=%s\nCDN_MIRROR_SECRET_ACCESS_KEY=%s\n' "${id}" "${secret}" >"${MIRROR_ENV}.new"
    chmod 0600 "${MIRROR_ENV}.new"
    mv "${MIRROR_ENV}.new" "${MIRROR_ENV}"
    echo "镜像凭据已写入 /etc/cdn-mirror/env（0600，值不打印）"
}

apply() {
    local entry rel dest mode src target state stamp
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    if [[ "${MIRROR_ENV_STDIN}" == 1 ]]; then read_mirror_credentials; fi
    for entry in "${MANIFEST[@]}"; do
        IFS='|' read -r rel dest mode <<<"${entry}"
        src="${SOURCE}/${rel}"
        [[ -f "${src}" ]] || { echo "install-host: 物料缺少 ${rel}" >&2; exit 2; }
        target="${ROOT}${dest}"
        state="$(status_of "${src}" "${target}")"
        printf '%-8s %s\n' "${state}" "${dest}"
        [[ "${state}" == same ]] && continue
        install -d -m 0755 "$(dirname "${target}")"
        [[ "${state}" == changed ]] && cp -p "${target}" "${target}.bak-${stamp}"
        install -m "${mode}" "${src}" "${target}.new"
        mv "${target}.new" "${target}"
    done
    if [[ "${MIRROR_ENV_STDIN}" == 1 ]]; then write_mirror_env; fi
    install -d -m 0700 "${ROOT}/srv/cdn-mirror"
    if use_systemd; then
        "${SYSTEMCTL}" daemon-reload
        if [[ -f "${MIRROR_ENV}" ]]; then
            "${SYSTEMCTL}" enable --now cdn-mirror.timer cdn-mirror-watch.timer >/dev/null
        else
            echo "镜像凭据还没有（/etc/cdn-mirror/env 不存在）：镜像定时器未启用" >&2
        fi
    fi
}

verify() {
    plan
    local failed=0
    if [[ "${differences}" -gt 0 ]]; then echo "verify：有 ${differences} 项和仓库物料不一致" >&2; failed=1; fi
    if use_systemd; then
        local unit requires
        for unit in production preview; do
            requires="$("${SYSTEMCTL}" show "yzgc-compose@${unit}.service" -p Requires --value)"
            if [[ "${requires}" == *yzgc-egress.service* ]]; then echo "verify：yzgc-compose@${unit} 仍然 Requires=yzgc-egress（隧道重启会停掉站点容器）" >&2; failed=1; fi
        done
        if ! "${SYSTEMCTL}" cat hk-tunnel-watchdog.service 2>/dev/null | grep -q "tolerate-loss.conf"; then
            echo "verify：hk-tunnel-watchdog 没有加载 tolerate-loss 覆盖项" >&2; failed=1
        fi
        if [[ -f "${MIRROR_ENV}" ]]; then
            for unit in cdn-mirror.timer cdn-mirror-watch.timer; do
                "${SYSTEMCTL}" is-enabled --quiet "${unit}" || { echo "verify：${unit} 没有启用" >&2; failed=1; }
            done
        fi
    fi
    [[ "${failed}" == 0 ]] && echo "verify：宿主层物料与仓库一致"
    return "${failed}"
}

case "${MODE}" in
    plan) plan ;;
    apply) apply ;;
    verify) verify ;;
esac
