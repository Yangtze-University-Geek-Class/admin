#!/usr/bin/env bash
# CDN 镜像：把 Garage（cdn.yangtzeu.work）的各桶单向拉到 Arch 本机，保留期内可回溯，每次同步后逐桶核验。
# run   同步、核验、清理过期的回收目录，结果写 status.json；失败时退出码非零。
# watch 只读 status.json：超过 CDN_MIRROR_MAX_AGE_HOURS 没有成功、或最近一次失败，写 ALERT 并退出非零。
# 凭据只读自 /etc/cdn-mirror/env（Garage 只读密钥，对每个桶只有读权限），不进仓库、不进日志。
set -Eeuo pipefail
umask 077

ENV_FILE="${CDN_MIRROR_ENV:-/etc/cdn-mirror/env}"
ROOT="${CDN_MIRROR_ROOT:-/srv/cdn-mirror}"
ENDPOINT="${CDN_MIRROR_ENDPOINT:-https://cdn.yangtzeu.work}"
KEEP_DAYS="${CDN_MIRROR_KEEP_DAYS:-14}"
MAX_AGE_HOURS="${CDN_MIRROR_MAX_AGE_HOURS:-36}"
MIN_FREE_GIB="${CDN_MIRROR_MIN_FREE_GIB:-10}"
read -r -a BUCKETS <<<"${CDN_MIRROR_BUCKETS:-geek-public geek-production-private geek-preview-private geek-backup cdn}"

STATUS="${ROOT}/status.json"
ALERT="${ROOT}/ALERT"
LOCK_FILE="${ROOT}/.lock"

die() { echo "cdn-mirror: $*" >&2; exit 1; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

[[ "${ROOT}" == /* && "${ROOT}" != "/" ]] || die "CDN_MIRROR_ROOT 必须是非根的绝对路径"
[[ "${KEEP_DAYS}" =~ ^[0-9]+$ && "${KEEP_DAYS}" -ge 1 ]] || die "CDN_MIRROR_KEEP_DAYS 必须是正整数"
[[ "${MAX_AGE_HOURS}" =~ ^[0-9]+$ && "${MAX_AGE_HOURS}" -ge 1 ]] || die "CDN_MIRROR_MAX_AGE_HOURS 必须是正整数"
mkdir -p "${ROOT}/current" "${ROOT}/trash"

last_success() { [[ -f "${STATUS}" ]] && jq -r '.last_success_at // empty' "${STATUS}" 2>/dev/null || true; }

write_status() { # ok error buckets_json started_at last_success_at
    local tmp="${STATUS}.new"
    jq -n --arg ok "$1" --arg error "$2" --argjson buckets "$3" --arg started "$4" --arg finished "$(now)" --arg last "$5" \
        '{ok: ($ok == "true"), error: $error, started_at: $started, finished_at: $finished,
          last_success_at: (if $ok == "true" then $finished else $last end), buckets: $buckets}' >"${tmp}"
    mv "${tmp}" "${STATUS}"
}

watch() {
    local reason=""
    if [[ ! -f "${STATUS}" ]]; then
        reason="没有 status.json，镜像从未运行过"
    elif [[ "$(jq -r '.ok' "${STATUS}")" != "true" ]]; then
        reason="最近一次同步失败：$(jq -r '.error' "${STATUS}")"
    else
        local last age
        last="$(last_success)"
        if [[ -z "${last}" ]]; then
            reason="status.json 里没有 last_success_at"
        else
            age=$(( ( $(date -u +%s) - $(jq -n -r --arg t "${last}" '$t | fromdateiso8601') ) / 3600 ))
            [[ "${age}" -le "${MAX_AGE_HOURS}" ]] || reason="已 ${age} 小时没有成功同步（阈值 ${MAX_AGE_HOURS}）"
        fi
    fi
    if [[ -n "${reason}" ]]; then
        printf '%s %s\n' "$(now)" "${reason}" >"${ALERT}"
        echo "cdn-mirror ALERT: ${reason}" >&2
        exit 1
    fi
    rm -f "${ALERT}"
    echo "cdn-mirror ok: last success $(last_success)"
}

[[ "${1:-run}" != "watch" ]] || { watch; exit 0; }
[[ "${1:-run}" == "run" ]] || die "用法：cdn-mirror.sh run|watch"

exec 200>"${LOCK_FILE}"
flock -n 200 || die "另一个镜像同步还在运行"

if [[ -f "${ENV_FILE}" && -z "${CDN_MIRROR_ACCESS_KEY_ID:-}" ]]; then
    set -a
    # shellcheck source=/dev/null
    . "${ENV_FILE}"
    set +a
fi
for var in CDN_MIRROR_ACCESS_KEY_ID CDN_MIRROR_SECRET_ACCESS_KEY; do
    [[ -n "${!var:-}" ]] || die "缺少 ${var}"
done

export RCLONE_CONFIG_CDN_TYPE=s3 RCLONE_CONFIG_CDN_PROVIDER=Other
export RCLONE_CONFIG_CDN_ACCESS_KEY_ID="${CDN_MIRROR_ACCESS_KEY_ID}"
export RCLONE_CONFIG_CDN_SECRET_ACCESS_KEY="${CDN_MIRROR_SECRET_ACCESS_KEY}"
export RCLONE_CONFIG_CDN_REGION=garage RCLONE_CONFIG_CDN_ENDPOINT="${ENDPOINT}"
export RCLONE_CONFIG_CDN_FORCE_PATH_STYLE=true RCLONE_CONFIG_CDN_NO_CHECK_BUCKET=true
# 下载不带 Accept-Encoding: gzip：网关会把文本响应压成 gzip，rclone 不解压就原样写盘，镜像里的 css/js 变成压缩包
# （首次同步后 rclone check 报 sizes differ 才发现；关掉后下载内容的 MD5 与对象 ETag 一致）
export RCLONE_CONFIG_CDN_USE_ACCEPT_ENCODING_GZIP=false
# 直连香港机在部分网络上会超时：每一步都带重试和超时，慢一点可以，悄悄失败不行
RCLONE_NET=(--retries 5 --low-level-retries 10 --retries-sleep 20s --contimeout 30s --timeout 120s)

STARTED="$(now)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PREVIOUS_SUCCESS="$(last_success)"
BUCKET_STATUS='{}'
FAILURES=()

fail_bucket() { FAILURES+=("$1: $2"); echo "cdn-mirror: $1 $2" >&2; }
size_json() { rclone size --json "$@" "${RCLONE_NET[@]}" 2>/dev/null; }

free_gib=$(df -Pk "${ROOT}" | awk 'NR == 2 { print int($4 / 1048576) }')
if [[ "${free_gib}" -lt "${MIN_FREE_GIB}" ]]; then
    write_status false "磁盘可用 ${free_gib} GiB，低于 ${MIN_FREE_GIB} GiB，停止同步" "${BUCKET_STATUS}" "${STARTED}" "${PREVIOUS_SUCCESS}"
    die "磁盘可用不足"
fi

sync_bucket() {
    local bucket="$1" local_dir="${ROOT}/current/$1" remote_before remote_after local_after
    mkdir -p "${local_dir}"
    remote_before="$(size_json "CDN:${bucket}")" || { fail_bucket "${bucket}" "读不到源桶（网络或密钥）"; return; }
    # 源桶读成空而镜像里有内容，多半是读错了而不是真被清空：拒绝同步
    if [[ "$(jq -r .count <<<"${remote_before}")" == "0" && -n "$(ls -A "${local_dir}" 2>/dev/null)" ]]; then
        fail_bucket "${bucket}" "源桶读成空但镜像非空，拒绝同步"
        return
    fi
    # 被覆盖或在源端删除的对象进 trash/<时间>/<桶>，保留期内可找回；不直接丢
    if ! rclone sync "CDN:${bucket}" "${local_dir}" --backup-dir "${ROOT}/trash/${STAMP}/${bucket}" \
        --transfers 4 --checkers 8 --max-delete 500 "${RCLONE_NET[@]}" >/dev/null 2>"${ROOT}/.last-sync.log"; then
        fail_bucket "${bucket}" "同步失败：$(tail -1 "${ROOT}/.last-sync.log" | cut -c1-200)"
        return
    fi
    if ! remote_after="$(size_json "CDN:${bucket}")" || ! local_after="$(size_json "${local_dir}")"; then
        fail_bucket "${bucket}" "核验时读不到大小"
        return
    fi
    if [[ "$(jq -c '[.count,.bytes]' <<<"${remote_after}")" != "$(jq -c '[.count,.bytes]' <<<"${local_after}")" ]]; then
        # 同步期间源端有新写入时对象数会不一致：再同步一次，仍不一致才算失败
        rclone sync "CDN:${bucket}" "${local_dir}" --backup-dir "${ROOT}/trash/${STAMP}/${bucket}" "${RCLONE_NET[@]}" >/dev/null 2>&1 || true
        if ! remote_after="$(size_json "CDN:${bucket}")" || ! local_after="$(size_json "${local_dir}")"; then
            fail_bucket "${bucket}" "二次核验时读不到大小"
            return
        fi
    fi
    if [[ "$(jq -c '[.count,.bytes]' <<<"${remote_after}")" != "$(jq -c '[.count,.bytes]' <<<"${local_after}")" ]]; then
        fail_bucket "${bucket}" "核验失败：对象数或字节数与源桶不一致"
        return
    fi
    if ! rclone check "CDN:${bucket}" "${local_dir}" "${RCLONE_NET[@]}" >/dev/null 2>"${ROOT}/.last-check.log"; then
        fail_bucket "${bucket}" "逐对象核验失败：$(grep -m1 -E 'ERROR|differences' "${ROOT}/.last-check.log" | cut -c1-200)"
        return
    fi
    BUCKET_STATUS="$(jq -c --arg b "${bucket}" --argjson r "${remote_after}" '.[$b] = {objects: $r.count, bytes: $r.bytes, verified: true}' <<<"${BUCKET_STATUS}")"
}

for bucket in "${BUCKETS[@]}"; do
    [[ "${bucket}" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]] || die "桶名不合法：${bucket}"
    sync_bucket "${bucket}"
done

# 只清理 trash 下早于保留期的整次运行目录；镜像本体不在这里删
find "${ROOT}/trash" -mindepth 1 -maxdepth 1 -type d -mtime "+${KEEP_DAYS}" -exec rm -rf -- {} + 2>/dev/null || true
find "${ROOT}/trash" -mindepth 1 -type d -empty -delete 2>/dev/null || true

if [[ "${#FAILURES[@]}" -gt 0 ]]; then
    write_status false "$(IFS='; '; echo "${FAILURES[*]}")" "${BUCKET_STATUS}" "${STARTED}" "${PREVIOUS_SUCCESS}"
    exit 1
fi
write_status true "" "${BUCKET_STATUS}" "${STARTED}" "${PREVIOUS_SUCCESS}"
rm -f "${ALERT}"
echo "cdn-mirror ok: ${#BUCKETS[@]} buckets verified"
