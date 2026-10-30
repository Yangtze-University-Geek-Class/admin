#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# 演练只允许使用经审查的镜像摘要：compose 漂移到 tag/latest 或换摘要时，必须在解密与启动之前失败
EXPECTED_IMAGE="gitlab/gitlab-ce@sha256:bb79dc86267c557fd11e7feb0cd9dd506dd02e991ecdd6cae11ca7d7e5d36fc3"
EXPECTED_IMAGE_PATTERN='^gitlab/gitlab-ce@sha256:[0-9a-f]{64}$'

WORK_DIR=""
TARGET_DAY=""
TARGET_RUN=""
CLEANUP=0
ENVIRONMENT=production

while [[ $# -gt 0 ]]; do
    case "$1" in
        --environment) ENVIRONMENT="${2:-}"; shift 2 ;;
        --run)
            if [[ $# -lt 2 || "$2" =~ ^-- ]]; then
                echo "Error: --run requires an archive selector <YYYY-MM-DD>/<run>" >&2
                exit 1
            fi
            TARGET_RUN="$2"
            shift 2
            ;;
        --day)
            # 只用于列候选：--day 不会替你选，仍然必须显式给出 --run
            if [[ $# -lt 2 || "$2" =~ ^-- ]]; then
                echo "Error: --day requires a date argument (YYYY-MM-DD)" >&2
                exit 1
            fi
            TARGET_DAY="$2"
            shift 2
            ;;
        --cleanup)
            CLEANUP=1
            shift
            ;;
        -h|--help)
            echo "Usage: restore-drill.sh --run YYYY-MM-DD/<run> [--cleanup]"
            echo "       restore-drill.sh [--day YYYY-MM-DD]   # list available runs, restore nothing"
            exit 0
            ;;
        *)
            echo "Error: Unknown argument: $1" >&2
            echo "Usage: restore-drill.sh --run YYYY-MM-DD/<run> [--cleanup]" >&2
            exit 1
            ;;
    esac
done
case "${ENVIRONMENT}" in
    production) INSTANCE=gitlab; ROLE=gitlab-backup; REQUIRED_VARS=(GITLAB_BACKUP_S3_ACCESS_KEY_ID GITLAB_BACKUP_S3_SECRET_ACCESS_KEY) ;;
    preview) INSTANCE=gitlab-preview; ROLE=gitlab-preview-backup; REQUIRED_VARS=(GITLAB_PREVIEW_BACKUP_S3_ACCESS_KEY_ID GITLAB_PREVIEW_BACKUP_S3_SECRET_ACCESS_KEY) ;;
    *) echo 'Invalid GitLab restore environment' >&2; exit 2 ;;
esac
DRILL_CONTAINER="${INSTANCE}-drill"
DRILL_ROOT="${GITLAB_DRILL_ROOT:-/srv/${INSTANCE}-drill}"
COMPOSE_FILE="${GITLAB_COMPOSE_FILE:-/srv/${INSTANCE}/docker-compose.yml}"
ARCHIVE_TOOL="${GITLAB_ARCHIVE_TOOL:-/srv/${INSTANCE}/garage-archive.mjs}"
BACKUP_ENV="/etc/${INSTANCE}-backup/env"

if [[ -n "${TARGET_DAY}" && ! "${TARGET_DAY}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "Error: --day must be in YYYY-MM-DD format: ${TARGET_DAY}" >&2
    exit 1
fi

if [[ -n "${TARGET_RUN}" && ! "${TARGET_RUN}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}/[A-Za-z0-9._-]+$ ]]; then
    echo "Error: --run must be in YYYY-MM-DD/<run> format: ${TARGET_RUN}" >&2
    exit 1
fi

# 手动执行时若变量未设置，尝试从标准路径读取
if [[ -f "${BACKUP_ENV}" && -z "${!REQUIRED_VARS[0]:-}" ]]; then
    set -a
    # shellcheck source=/dev/null
    . "${BACKUP_ENV}"
    set +a
fi

# 检查必需环境变量
for var in "${REQUIRED_VARS[@]}"; do
    if [[ -z "${!var:-}" ]]; then
        echo "Error: Required environment variable ${var} is not set" >&2
        exit 1
    fi
done

# 读取 GPG 口令：优先从已打开的 fd 3 读取，否则从 GPG_PASSPHRASE 环境变量读取（严禁输出）
GPG_PASS=""
if { true <&3; } 2>/dev/null; then
    IFS= read -r -u 3 GPG_PASS || true
    exec 3<&-
    if [[ -z "${GPG_PASS}" ]]; then
        echo "Error: Empty passphrase on file descriptor 3" >&2
        exit 1
    fi
elif [[ -n "${GPG_PASSPHRASE:-}" ]]; then
    GPG_PASS="${GPG_PASSPHRASE}"
else
    echo "Error: Passphrase required: provide via file descriptor 3 or GPG_PASSPHRASE" >&2
    exit 1
fi

if [[ ! -f "${ARCHIVE_TOOL}" || -L "${ARCHIVE_TOOL}" ]]; then
    echo "Error: ${ARCHIVE_TOOL} is missing or unsafe" >&2
    exit 1
fi

# 恢复必须点名 run：没有 --run 时只列候选并退出，绝不按时间或字典序替你挑“最新”
if [[ -z "${TARGET_RUN}" ]]; then
    if [[ -n "${TARGET_DAY}" ]]; then
        AVAILABLE_RUNS="$(node "${ARCHIVE_TOOL}" list-gitlab-runs --role "${ROLE}" --day "${TARGET_DAY}")"
    else
        AVAILABLE_RUNS="$(node "${ARCHIVE_TOOL}" list-gitlab-runs --role "${ROLE}")"
    fi
    echo "Error: --run <YYYY-MM-DD>/<run> is required; restore never auto-selects a run" >&2
    node --input-type=module - "${AVAILABLE_RUNS}" <<'NODE' >&2
const value = JSON.parse(process.argv[2]);
const runs = Array.isArray(value?.runs) ? value.runs : [];
if (runs.length === 0) console.log('No GitLab archive runs are available.');
for (const run of runs) console.log(`available run: ${run}`);
NODE
    echo "Usage: restore-drill.sh --run YYYY-MM-DD/<run> [--cleanup]" >&2
    exit 1
fi

# 0. 预检：只接受经审查的 digest 镜像，任何解密/启动之前失败
if [[ ! -f "${COMPOSE_FILE}" ]]; then
    echo "Error: Compose file ${COMPOSE_FILE} does not exist" >&2
    exit 1
fi
IMAGE="$(awk '/^[[:space:]]*image:/{print $2; exit}' "${COMPOSE_FILE}")"
IMAGE="${IMAGE//[\"\']/}"
if [[ -z "${IMAGE}" ]]; then
    echo "Error: Could not extract image from ${COMPOSE_FILE}" >&2
    exit 1
fi
if [[ ! "${IMAGE}" =~ ${EXPECTED_IMAGE_PATTERN} ]]; then
    echo "Error: Image '${IMAGE}' from ${COMPOSE_FILE} is not a pinned digest; expected gitlab/gitlab-ce@sha256:<64 hex> (${EXPECTED_IMAGE})" >&2
    exit 1
fi
if [[ "${IMAGE}" != "${EXPECTED_IMAGE}" ]]; then
    echo "Error: Image '${IMAGE}' from ${COMPOSE_FILE} is not the reviewed image; expected ${EXPECTED_IMAGE}" >&2
    exit 1
fi
RUN_JSON="$(node "${ARCHIVE_TOOL}" resolve-gitlab-run --role "${ROLE}" --run "${TARGET_RUN}")"
readarray -t RUN_FIELDS < <(node --input-type=module - "${RUN_JSON}" <<'NODE'
const value = JSON.parse(process.argv[2]);
if (!/^\d{4}-\d{2}-\d{2}$/.test(value.day ?? '') || !/^gitlab\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\/$/.test(value.prefix ?? '')) process.exit(2);
if (!Array.isArray(value.objects) || value.objects.length === 0) process.exit(3);
let total = 0;
for (const item of value.objects) {
  if (typeof item?.path !== 'string' || item.path === '' || !Number.isSafeInteger(item.bytes) || item.bytes < 0) process.exit(4);
  total += item.bytes;
}
if (!Number.isSafeInteger(total)) process.exit(5);
console.log(value.day);
console.log(value.prefix);
console.log(value.objects.length);
console.log(total);
NODE
)
if [[ ${#RUN_FIELDS[@]} -ne 4 ]]; then
    echo "Error: Could not resolve the requested GitLab archive run ${TARGET_RUN}" >&2
    exit 1
fi
TARGET_DAY="${RUN_FIELDS[0]}"
REMOTE_PREFIX="${RUN_FIELDS[1]}"
OBJECT_COUNT="${RUN_FIELDS[2]}"
OBJECT_BYTES="${RUN_FIELDS[3]}"
echo "Restoring run: ${REMOTE_PREFIX} (${OBJECT_COUNT} objects, ${OBJECT_BYTES} bytes); no other run will be considered"

STAMP="${GITLAB_DRILL_STAMP:-$(TZ=Asia/Shanghai date +%Y%m%dT%H%M%S)}"
WORK_DIR="${DRILL_ROOT}/${STAMP}"
# 演练目录必须由本次运行独占：同一秒重跑、并发运行、或上一次保留下来的现场，都不能被复用——
# 否则失败时的 EXIT 清理会 rm -rf 掉别人保留的演练现场（含明文密钥与日志）。用不带 -p 的 mkdir 原子占位，撞上就失败。
[[ -d "${DRILL_ROOT}" ]] || { mkdir -p "${DRILL_ROOT}"; chmod 700 "${DRILL_ROOT}"; }
mkdir -m 700 "${WORK_DIR}" 2>/dev/null || {
    echo "Error: 演练目录已存在，拒绝复用（换一次运行或先人工确认 ${WORK_DIR}）：${WORK_DIR}" >&2
    WORK_DIR=""
    exit 1
}
for sub in config data data/backups logs; do mkdir -m 700 "${WORK_DIR}/${sub}"; done

warn() {
    echo "Warning: $*" >&2
}

remove_container() {
    # 只删本脚本创建且仍存在的容器；清理失败只告警
    (( CONTAINER_CREATED == 1 )) || return 0
    if docker inspect "${DRILL_CONTAINER}" >/dev/null 2>&1; then
        docker rm -f "${DRILL_CONTAINER}" >/dev/null 2>&1 || warn "failed to remove container ${DRILL_CONTAINER}"
    fi
    CONTAINER_CREATED=0
}

remove_work_dir() {
    # 只在演练根目录之下删除，防止误删根或整个演练父目录；两边都用 pwd -P 解到真实路径，
    # 这样 DRILL_ROOT 里的 .. 或符号链接不能把 rm -rf 引到前缀之外（macOS 的 realpath 不支持 -m）。
    local real_root real_work
    if [[ -z "${WORK_DIR}" || ! -e "${WORK_DIR}" ]]; then
        return 0
    fi
    real_root="$(cd -- "${DRILL_ROOT}" 2>/dev/null && pwd -P)" || real_root=""
    real_work="$(cd -- "${WORK_DIR}" 2>/dev/null && pwd -P)" || real_work=""
    if [[ -z "${real_root}" || -z "${real_work}" \
          || "${real_root}" == "/" || "${real_work}" != "${real_root}/"* || "${real_work}" == "${real_root}/" ]]; then
        warn "refusing to remove unsafe work directory '${WORK_DIR}'"
        return 0
    fi
    rm -rf "${WORK_DIR}" || warn "failed to remove work directory ${WORK_DIR}"
}

DRILL_OK=0
CONTAINER_CREATED=0
on_exit() {
    local rc=$?
    set +e
    trap - EXIT
    if (( DRILL_OK == 0 )); then
        # 失败退出：删除演练容器与整个工作目录（含 config/gitlab-secrets.json 明文密钥），远端加密归档保留
        echo "Drill failed; removing ${DRILL_CONTAINER} and ${WORK_DIR} (encrypted archive is left untouched)" >&2
        remove_container
        remove_work_dir
    fi
    exit "${rc}"
}
# 收到 INT/TERM 时退出，由 EXIT trap 统一清理；只写 trap … TERM 的话清理完脚本会接着往下跑
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 1. 逐对象完整 GET 下载被点名的不可变运行；适配器先核对存在与长度，再按 SHA256SUMS 全量校验，
#    清单缺失、被截断或与对象集合不一致都直接失败（不会退化成只校验部分文件）。摘要打印在 stderr。
node "${ARCHIVE_TOOL}" get-tree --role "${ROLE}" --prefix "${REMOTE_PREFIX}" --destination "${WORK_DIR}/dl" --require-manifest >/dev/null

(
    cd "${WORK_DIR}/dl"
    sha256sum -c SHA256SUMS
)

# 2. 解密该不可变运行里的两个 .gpg 文件
# 一个 run 里必须恰好各有一个数据归档与配置归档：多个候选时静默挑最后一个，等于让恢复用它没核对过的那份。
BACKUP_LIST="$(find "${WORK_DIR}/dl" -maxdepth 1 -type f -name '*_gitlab_backup.tar.gpg')"
CONFIG_LIST="$(find "${WORK_DIR}/dl" -maxdepth 1 -type f -name 'gitlab_config_*.tar.gpg')"
BACKUP_COUNT=$(printf '%s\n' "${BACKUP_LIST}" | grep -c . || true)
CONFIG_COUNT=$(printf '%s\n' "${CONFIG_LIST}" | grep -c . || true)

if [[ "${BACKUP_COUNT}" != "1" ]]; then
    echo "Error: 这个 run 里应当恰好有一个 *_gitlab_backup.tar.gpg，实际 ${BACKUP_COUNT} 个" >&2
    [[ -n "${BACKUP_LIST}" ]] && printf '  %s\n' ${BACKUP_LIST} >&2
    exit 1
fi
if [[ "${CONFIG_COUNT}" != "1" ]]; then
    echo "Error: 这个 run 里应当恰好有一个 gitlab_config_*.tar.gpg，实际 ${CONFIG_COUNT} 个" >&2
    [[ -n "${CONFIG_LIST}" ]] && printf '  %s\n' ${CONFIG_LIST} >&2
    exit 1
fi

BACKUP_GPG="${BACKUP_LIST}"
CONFIG_GPG="${CONFIG_LIST}"

if [[ -z "${BACKUP_GPG}" || ! -f "${BACKUP_GPG}" ]]; then
    echo "Error: No *_gitlab_backup.tar.gpg found in downloaded files" >&2
    exit 1
fi
if [[ -z "${CONFIG_GPG}" || ! -f "${CONFIG_GPG}" ]]; then
    echo "Error: No gitlab_config_*.tar.gpg found in downloaded files" >&2
    exit 1
fi

BACKUP_TAR_NAME="$(basename "${BACKUP_GPG}" .gpg)"
CONFIG_TAR_NAME="$(basename "${CONFIG_GPG}" .gpg)"

DECRYPTED_BACKUP="${WORK_DIR}/dl/${BACKUP_TAR_NAME}"
DECRYPTED_CONFIG="${WORK_DIR}/dl/${CONFIG_TAR_NAME}"

gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --output "${DECRYPTED_BACKUP}" --decrypt "${BACKUP_GPG}" 3<<< "${GPG_PASS}"
gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --output "${DECRYPTED_CONFIG}" --decrypt "${CONFIG_GPG}" 3<<< "${GPG_PASS}"

# 3. 镜像硬性要求已在预检阶段按 digest 固定，这里只解压配置归档
# 4. 解压配置归档，在容器首次启动前复制 gitlab-secrets.json
EXTRACTED_CONFIG_DIR="${WORK_DIR}/extracted_config"
mkdir -p "${EXTRACTED_CONFIG_DIR}"
# 归档内容只应是普通文件与目录：符号链接、硬链接、设备文件、绝对路径或 .. 都可能把解包写到 WORK_DIR 之外
# （那是 root 身份、且紧接着会把其中的 gitlab-secrets.json 复制成运行配置），先逐条核对再解压。
UNSAFE_MEMBERS="$(tar -tf "${DECRYPTED_CONFIG}" | grep -E '(^/|(^|/)\.\.(/|$))' || true)"
if [[ -n "${UNSAFE_MEMBERS}" ]]; then
    echo "Error: 配置归档里有绝对路径或 .. 成员，拒绝解压：" >&2
    printf '  %s\n' ${UNSAFE_MEMBERS} >&2
    exit 1
fi
UNSAFE_TYPES="$(tar -tvf "${DECRYPTED_CONFIG}" | grep -vE '^[-d]' || true)"
if [[ -n "${UNSAFE_TYPES}" ]]; then
    echo "Error: 配置归档里有非普通文件/目录成员（链接、设备等），拒绝解压：" >&2
    printf '  %s\n' "${UNSAFE_TYPES}" >&2
    exit 1
fi
tar -xf "${DECRYPTED_CONFIG}" -C "${EXTRACTED_CONFIG_DIR}" --no-same-owner --no-same-permissions

SECRETS_SRC="${EXTRACTED_CONFIG_DIR}/srv/${INSTANCE}/config/gitlab-secrets.json"
if [[ ! -f "${SECRETS_SRC}" ]]; then
    echo "Error: gitlab-secrets.json not found in config archive" >&2
    exit 1
fi
# 配置归档里记着备份当时的 compose：它的镜像必须与被复核过的固定 digest 一致，
# 否则这次演练证明的只是「某个别的版本能读这份备份」。
ARCHIVED_COMPOSE="${EXTRACTED_CONFIG_DIR}/srv/${INSTANCE}/docker-compose.yml"
if [[ ! -f "${ARCHIVED_COMPOSE}" ]]; then
    echo "Error: 配置归档里没有 srv/${INSTANCE}/docker-compose.yml，无法核对备份时的 GitLab 版本" >&2
    exit 1
fi
ARCHIVED_IMAGE="$(grep -E '^[[:space:]]*image:[[:space:]]*gitlab/gitlab-ce' "${ARCHIVED_COMPOSE}" | head -n 1 | sed -E 's/^[[:space:]]*image:[[:space:]]*//; s/[[:space:]"'"'"']+$//')"
if [[ "${ARCHIVED_IMAGE}" != "${EXPECTED_IMAGE}" ]]; then
    echo "Error: 配置归档里的 GitLab 镜像是 ${ARCHIVED_IMAGE:-空}，与被复核的固定镜像 ${EXPECTED_IMAGE} 不一致" >&2
    exit 1
fi
cp "${SECRETS_SRC}" "${WORK_DIR}/config/gitlab-secrets.json"
chmod 0600 "${WORK_DIR}/config/gitlab-secrets.json"

# 配置归档解压出的明文文件使用完毕，立即删除
rm -rf "${EXTRACTED_CONFIG_DIR}"
rm -f "${DECRYPTED_CONFIG}"

# 5. 启动演练容器（若已存在则直接拒绝）
if docker inspect "${DRILL_CONTAINER}" >/dev/null 2>&1; then
    echo "Error: Container '${DRILL_CONTAINER}' already exists. Remove it before running restore drill." >&2
    exit 1
fi

# 先置位再启动：docker run 中途失败可能留下半创建的同名容器，失败清理要能按名字删掉
CONTAINER_CREATED=1
docker run -d \
    --name "${DRILL_CONTAINER}" \
    --hostname gitlab-drill \
    --network none \
    --memory 6g \
    --cpus 4 \
    --shm-size 256m \
    -v "${WORK_DIR}/config:/etc/gitlab" \
    -v "${WORK_DIR}/logs:/var/log/gitlab" \
    -v "${WORK_DIR}/data:/var/opt/gitlab" \
    -e GITLAB_OMNIBUS_CONFIG="external_url 'http://gitlab-drill'; prometheus_monitoring['enable'] = false; puma['worker_processes'] = 0; sidekiq['concurrency'] = 5; letsencrypt['enable'] = false" \
    "${IMAGE}"

# 6. 等待容器重配完成且核心服务启动就绪（最长 20 分钟，每 10 秒轮询）
START_TIME="$(date +%s)"
TIMEOUT=1200
UP=0

while (( $(date +%s) - START_TIME < TIMEOUT )); do
    # 不用 docker logs | grep -q：pipefail 下 grep 提前退出会让 docker logs 收到 SIGPIPE，整条管道判为失败
    if grep -q 'gitlab Reconfigured!' <<< "$(docker logs "${DRILL_CONTAINER}" 2>&1)"; then
        STATUS="$(docker exec "${DRILL_CONTAINER}" gitlab-ctl status 2>/dev/null || true)"
        if grep -qE 'run:[[:space:]]*puma:' <<< "${STATUS}" && grep -qE 'run:[[:space:]]*postgresql:' <<< "${STATUS}"; then
            UP=1
            break
        fi
    fi
    sleep 10
done

if (( UP == 0 )); then
    echo "Error: gitlab-drill failed to reconfigure and start puma/postgresql within 20 minutes" >&2
    exit 1
fi

# 7. 导入备份并执行恢复
cp "${DECRYPTED_BACKUP}" "${WORK_DIR}/data/backups/${BACKUP_TAR_NAME}"
rm -f "${DECRYPTED_BACKUP}"

docker exec "${DRILL_CONTAINER}" chown git:git "/var/opt/gitlab/backups/${BACKUP_TAR_NAME}"

docker exec "${DRILL_CONTAINER}" gitlab-ctl stop puma
docker exec "${DRILL_CONTAINER}" gitlab-ctl stop sidekiq

BACKUP_ID="${BACKUP_TAR_NAME%_gitlab_backup.tar}"
docker exec "${DRILL_CONTAINER}" gitlab-backup restore BACKUP="${BACKUP_ID}" force=yes

# 恢复完成后删除备份明文包
rm -f "${WORK_DIR}/data/backups/${BACKUP_TAR_NAME}"

# postgresql 重启常超过 runit 的等待时间而报 timeout（进程其实还在起），不以它判失败，下面按状态等就绪
docker exec "${DRILL_CONTAINER}" gitlab-ctl restart || true

# 等待 puma 重启恢复就绪（最长 10 分钟）
PUMA_UP=0
RESTART_START="$(date +%s)"
while (( $(date +%s) - RESTART_START < 600 )); do
    STATUS="$(docker exec "${DRILL_CONTAINER}" gitlab-ctl status 2>/dev/null || true)"
    if grep -qE 'run:[[:space:]]*puma:' <<< "${STATUS}" && grep -qE 'run:[[:space:]]*postgresql:' <<< "${STATUS}"; then
        PUMA_UP=1
        break
    fi
    sleep 5
done

if (( PUMA_UP == 0 )); then
    echo "Error: puma/postgresql not running 10 minutes after restart" >&2
    exit 1
fi

docker exec "${DRILL_CONTAINER}" gitlab-rake gitlab:check SANITIZE=true
docker exec "${DRILL_CONTAINER}" gitlab-rake gitlab:doctor:secrets

# 8. 只与同一环境的在线实例比较，不读取另一个环境的对象计数
COUNT_RB='puts({projects: Project.count, users: User.count, issues: Issue.count}.to_json)'
DRILL_COUNTS="$(docker exec "${DRILL_CONTAINER}" gitlab-rails runner "${COUNT_RB}" | tail -n 1)"
LIVE_COUNTS="$(docker exec "${INSTANCE}" gitlab-rails runner "${COUNT_RB}" | tail -n 1)"
echo "drill: ${DRILL_COUNTS}"
echo "live:  ${LIVE_COUNTS}"
# 备份之后线上可能又新增了数据，计数不同只提示，不判失败
if [[ "${DRILL_COUNTS}" == "${LIVE_COUNTS}" ]]; then
    echo "COUNTS MATCH"
else
    echo "COUNTS DIFFER (live may have changed since ${TARGET_DAY})"
fi

# 10. 收尾处理：若无 --cleanup 则保留并打印清理命令；若有 --cleanup 则执行清理
if (( CLEANUP == 1 )); then
    remove_container
    remove_work_dir
    echo "Cleaned up ${DRILL_CONTAINER} container and work directory: ${WORK_DIR}"
else
    echo ""
    echo "Drill completed successfully. Container and work directory retained."
    echo "To remove, run:"
    echo "  docker rm -f ${DRILL_CONTAINER}"
    echo "  rm -rf ${WORK_DIR}"
fi
# 演练成功：EXIT trap 保留演练现场
DRILL_OK=1
