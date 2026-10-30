#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ENVIRONMENT=production
if [[ "${1:-}" == --environment && $# == 2 ]]; then ENVIRONMENT="$2"; elif [[ $# != 0 ]]; then echo 'Usage: backup.sh [--environment production|preview]' >&2; exit 2; fi
case "${ENVIRONMENT}" in
    production) INSTANCE=gitlab; ROLE=gitlab-backup ;;
    preview) INSTANCE=gitlab-preview; ROLE=gitlab-preview-backup ;;
    *) echo 'Invalid GitLab backup environment' >&2; exit 2 ;;
esac
# 备份目标（端点、区域、桶、前缀、凭据）全部来自 /etc/<实例>-backup/env；前缀按环境区分，必须非空，否则会写到桶根下
REQUIRED_VARS=(BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_BUCKET BACKUP_S3_PREFIX BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY)
BASE="/srv/${INSTANCE}"
BACKUP_ENV="/etc/${INSTANCE}-backup/env"
LOCK_FILE="/run/${INSTANCE}-backup.lock"
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
    echo "Error: Another backup instance is already running (${LOCK_FILE} is locked)" >&2
    exit 1
fi

if [[ -f "${BACKUP_ENV}" && -z "${!REQUIRED_VARS[4]:-}" ]]; then
    set -a
    # shellcheck source=/dev/null
    . "${BACKUP_ENV}"
    set +a
fi

for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        echo "Error: Required environment variable ${var} is not set" >&2
        exit 1
    fi
done

ARCHIVE_TOOL="${BASE}/garage-archive.mjs"
if [[ ! -f "${ARCHIVE_TOOL}" || -L "${ARCHIVE_TOOL}" ]]; then
    echo "Error: ${ARCHIVE_TOOL} is missing or unsafe" >&2
    exit 1
fi
export HOME="${HOME:-/root}"
# 收件人二选一：BACKUP_GPG_PUBLIC_KEY（base64 的 ASCII 公钥，用 --recipient-file，不需要钥匙环）优先，否则用 GPG_RECIPIENT 查钥匙环
if [[ -z "${BACKUP_GPG_PUBLIC_KEY:-}" && -z "${GPG_RECIPIENT:-}" ]]; then
    echo "Error: BACKUP_GPG_PUBLIC_KEY or GPG_RECIPIENT is required" >&2
    exit 1
fi
RECIPIENT_ARGS=(--recipient "${GPG_RECIPIENT:-}")
GPG_KEY_FILE=""
if [[ -n "${BACKUP_GPG_PUBLIC_KEY:-}" ]]; then
    GPG_KEY_FILE=$(mktemp "${TMPDIR:-/tmp}/gitlab-backup-recipient.XXXXXX")
    if ! { printf '%s' "${BACKUP_GPG_PUBLIC_KEY}" | base64 -d > "${GPG_KEY_FILE}"; } 2>/dev/null || ! grep -q -- '-----BEGIN PGP PUBLIC KEY BLOCK-----' "${GPG_KEY_FILE}"; then
        echo "Error: BACKUP_GPG_PUBLIC_KEY is not a base64 ASCII public key" >&2
        exit 1
    fi
    RECIPIENT_ARGS=(--recipient-file "${GPG_KEY_FILE}")
elif ! gpg --batch --list-keys "${GPG_RECIPIENT}" >/dev/null 2>&1; then
    echo "Error: GPG public key ${GPG_RECIPIENT} not found in keyring" >&2
    exit 1
fi
if [[ "$(docker inspect -f '{{.State.Running}}' "${INSTANCE}" 2>/dev/null || true)" != "true" ]]; then
    echo "Error: Container '${INSTANCE}' is not running" >&2
    exit 1
fi

DAY=$(TZ=Asia/Shanghai date +%F)
STAMP=$(TZ=Asia/Shanghai date +%Y%m%dT%H%M%S)
DAY_DIR="${BASE}/backups-enc/${DAY}"
STAGE_DIR="${DAY_DIR}/${STAMP}"
CONFIG_TAR="${STAGE_DIR}/gitlab_config_${STAMP}.tar"
MARKER_FILE="${BASE}/data/backups/.backup_marker_${STAMP}"

cleanup() {
    [[ -n "${GPG_KEY_FILE:-}" && -f "${GPG_KEY_FILE}" ]] && rm -f "${GPG_KEY_FILE}"
    [[ -n "${CONFIG_TAR:-}" && -f "${CONFIG_TAR}" ]] && rm -f "${CONFIG_TAR}"
    [[ -n "${MARKER_FILE:-}" && -f "${MARKER_FILE}" ]] && rm -f "${MARKER_FILE}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "${BASE}/data/backups" "${DAY_DIR}"
mkdir -m 0700 "${STAGE_DIR}"
touch "${MARKER_FILE}"
docker exec "${INSTANCE}" gitlab-backup create SKIP=registry STRATEGY=copy CRON=1

BACKUP_TAR=""
if [[ -d "${BASE}/data/backups" ]]; then
    BACKUP_TAR="$(find "${BASE}/data/backups" -maxdepth 1 -type f -name '*_gitlab_backup.tar' -newer "${MARKER_FILE}" -printf '%T@\t%p\n' 2>/dev/null | sort -n | tail -n 1 | cut -f2-)"
fi
rm -f "${MARKER_FILE}"
if [[ -z "${BACKUP_TAR}" || ! -f "${BACKUP_TAR}" || -L "${BACKUP_TAR}" ]]; then
    echo "Error: No newly created regular GitLab backup tar found" >&2
    exit 1
fi

CONFIG_CANDIDATE_PATHS=(
    "srv/${INSTANCE}/config" "srv/${INSTANCE}/docker-compose.yml" "srv/${INSTANCE}/backup.sh" "srv/${INSTANCE}/restore-drill.sh" "srv/${INSTANCE}/garage-archive.mjs"
    "etc/systemd/system/${INSTANCE}-backup.service" "etc/systemd/system/${INSTANCE}-backup.timer" "etc/systemd/system/${INSTANCE}-compose.service"
)
CONFIG_PATHS=()
for rel_path in "${CONFIG_CANDIDATE_PATHS[@]}"; do
    [[ -e "/${rel_path}" ]] && CONFIG_PATHS+=("${rel_path}")
done
if [[ ${#CONFIG_PATHS[@]} -eq 0 ]]; then
    echo "Error: None of the target configuration paths exist to archive" >&2
    exit 1
fi
tar -C / -cf "${CONFIG_TAR}" "${CONFIG_PATHS[@]}"

ENC_BACKUP="${STAGE_DIR}/$(basename "${BACKUP_TAR}").gpg"
ENC_CONFIG="${CONFIG_TAR}.gpg"
# GitLab 能读的备份必须是未压缩的 tar，压缩放在加密之前：gpg 对明文按 ZIP 压缩
gpg --batch --yes --trust-model always --compress-algo ZIP "${RECIPIENT_ARGS[@]}" --output "${ENC_BACKUP}" --encrypt "${BACKUP_TAR}"
gpg --batch --yes --trust-model always --compress-algo ZIP "${RECIPIENT_ARGS[@]}" --output "${ENC_CONFIG}" --encrypt "${CONFIG_TAR}"
rm -f "${CONFIG_TAR}"
(
    cd "${STAGE_DIR}"
    sha256sum -- *.gpg > SHA256SUMS
)
chmod 0600 "${STAGE_DIR}"/*

node "${ARCHIVE_TOOL}" put-tree --role "${ROLE}" --source "${STAGE_DIR}" --prefix "gitlab/${DAY}/${STAMP}/" >/dev/null
echo "OK gitlab/${DAY}/${STAMP}/ $(find "${STAGE_DIR}" -maxdepth 1 -type f | wc -l | tr -d ' ') files"
# 这份上传并读回核验之后，按 日 7 / 周 4 / 月 3 的保留策略清理旧 run，由适配器核对后删除（见 garage-archive.mjs 的 RETENTION）。
# 清理失败时本脚本退出非零（单元显示失败，磁盘不会悄悄涨满），刚上传的这份已经完整可用。
PRUNE_JSON=$(node "${ARCHIVE_TOOL}" prune-runs --role "${ROLE}" --apply)
echo "PRUNE ${PRUNE_JSON}"
