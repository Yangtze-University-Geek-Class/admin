#!/usr/bin/env bash
# 把 platform-maintenance.sh 的本地快照压缩、加密后，交给只新增归档器写入 BACKUP_S3_* 指定的七牛私有备份桶；独立运行，不放宽 backup service 的 AF_UNIX。
set -Eeuo pipefail
umask 077

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ENVIRONMENT=""
SOURCE=""
OUTPUT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --environment) ENVIRONMENT="${2:-}"; shift 2 ;;
        --source) SOURCE="${2:-}"; shift 2 ;;
        --out) OUTPUT="${2:-}"; shift 2 ;;
        -h|--help)
            echo "Usage: platform-archive.sh --environment <preview|production> --source <absolute snapshot dir> --out <new absolute dir>"
            exit 0
            ;;
        *) echo "Error: Unknown or incomplete argument: $1" >&2; exit 1 ;;
    esac
done

if [[ "${ENVIRONMENT}" != "preview" && "${ENVIRONMENT}" != "production" ]]; then
    echo "Error: --environment must be preview or production" >&2
    exit 1
fi
if [[ ! "${SOURCE}" =~ ^/[A-Za-z0-9_./-]+$ || ! "${OUTPUT}" =~ ^/[A-Za-z0-9_./-]+$ || "${SOURCE}" == *"/../"* || "${OUTPUT}" == *"/../"* ]]; then
    echo "Error: source/out must be canonical safe absolute paths" >&2
    exit 1
fi
if [[ ! -d "${SOURCE}" || -L "${SOURCE}" || -e "${OUTPUT}" || -L "${OUTPUT}" ]]; then
    echo "Error: source must be a real directory and out must not exist" >&2
    exit 1
fi
if [[ ! -f "${HERE}/garage-archive.mjs" || -L "${HERE}/garage-archive.mjs" ]]; then
    echo "Error: garage-archive.mjs is missing" >&2
    exit 1
fi

EXPECTED=(
    manifest.json manifest.json.sha256
    receipt.json receipt.json.sha256
    system-backup.tar.gz system-backup.tar.gz.sha256
)
for name in "${EXPECTED[@]}"; do
    if [[ ! -f "${SOURCE}/${name}" || -L "${SOURCE}/${name}" ]]; then
        echo "Error: snapshot is missing a regular ${name}" >&2
        exit 1
    fi
done
ACTUAL_FILES=$(find "${SOURCE}" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; | sort)
if [[ "${ACTUAL_FILES}" != "$(printf '%s\n' "${EXPECTED[@]}" | sort)" ]]; then
    echo "Error: snapshot contains unexpected or missing files" >&2
    exit 1
fi
node --input-type=module - "${SOURCE}" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const source = process.argv[2];
for (const name of ['manifest.json', 'receipt.json', 'system-backup.tar.gz']) {
  const line = readFileSync(join(source, `${name}.sha256`), 'utf8');
  const expected = new RegExp(`^([0-9a-f]{64})  ${name.replace('.', '\\.') }\\n$`).exec(line)?.[1];
  const actual = createHash('sha256').update(readFileSync(join(source, name))).digest('hex');
  if (!expected || expected !== actual) process.exit(2);
}
NODE

if ! RECEIPT_FIELDS=$(node --input-type=module - "${SOURCE}/receipt.json" "${ENVIRONMENT}" <<'NODE'
import { readFileSync } from 'node:fs';
const [file, environment] = process.argv.slice(2);
const receipt = JSON.parse(readFileSync(file, 'utf8'));
const role = `platform-${environment}-backup`;
const pattern = new RegExp(`^platform/${environment}/\\d{4}-\\d{2}-\\d{2}/[A-Za-z0-9._-]+/$`);
if (receipt?.format !== 'yzgc-platform-backup-receipt@1' || receipt.environment !== environment
  || receipt.archive?.role !== role || !pattern.test(receipt.archive?.prefix ?? '')) process.exit(2);
console.log(`${role}\t${receipt.archive.prefix}`);
NODE
); then
    echo "Error: receipt environment/archive contract mismatch" >&2
    exit 1
fi
IFS=$'\t' read -r ROLE PREFIX <<< "${RECEIPT_FIELDS}"
if [[ -z "${ROLE}" || -z "${PREFIX}" ]]; then
    echo "Error: receipt environment/archive contract mismatch" >&2
    exit 1
fi

if [[ -z "${BACKUP_GPG_RECIPIENT:-}" ]]; then
    echo "Error: BACKUP_GPG_RECIPIENT is required" >&2
    exit 1
fi
# 备份目标的端点、区域、桶、前缀与凭据都来自环境（BACKUP_S3_*），这里只查键是否存在，取值不打印
for var in BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY; do
    if [[ -z "${!var:-}" ]]; then
        echo "Error: ${var} is required" >&2
        exit 1
    fi
done
if ! gpg --batch --list-keys "${BACKUP_GPG_RECIPIENT}" >/dev/null 2>&1; then
    echo "Error: platform backup GPG recipient is unavailable" >&2
    exit 1
fi

mkdir -m 0700 "${OUTPUT}"
PLAIN="${OUTPUT}/platform-backup.tar"
ENCRYPTED="${OUTPUT}/platform-backup.tar.gpg"
cleanup() { rm -f "${PLAIN}"; }
trap cleanup EXIT
# 快照里的 system-backup.tar.gz 本身已是 gzip；外层 tar 只包 3 个小文件，gpg 加密时再按 ZIP 压缩
tar -C "${SOURCE}" -cf "${PLAIN}" "${EXPECTED[@]}"
gpg --batch --yes --trust-model always --compress-algo ZIP --recipient "${BACKUP_GPG_RECIPIENT}" --output "${ENCRYPTED}" --encrypt "${PLAIN}"
rm -f "${PLAIN}"
node --input-type=module - "${ENCRYPTED}" "${OUTPUT}/SHA256SUMS" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
const [source, target] = process.argv.slice(2);
const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
writeFileSync(target, `${digest}  ${basename(source)}\n`, { flag: 'wx', mode: 0o600 });
NODE
chmod 0600 "${ENCRYPTED}" "${OUTPUT}/SHA256SUMS"

UPLOAD_JSON=$(node "${HERE}/garage-archive.mjs" put-tree --role "${ROLE}" --source "${OUTPUT}" --prefix "${PREFIX}")
# 上传并读回核验之后，按 日 7 / 周 4 / 月 3 的保留策略清理旧 run（见 garage-archive.mjs 的 RETENTION），清理由适配器核对后删除。
PRUNE_JSON=$(node "${HERE}/garage-archive.mjs" prune-runs --role "${ROLE}" --apply)
node --input-type=module - "${ENVIRONMENT}" "${PREFIX}" "${UPLOAD_JSON}" "${PRUNE_JSON}" <<'NODE'
const [environment, prefix, upload, prune] = process.argv.slice(2);
console.log(JSON.stringify({ environment, prefix, upload: JSON.parse(upload), prune: JSON.parse(prune) }));
NODE
