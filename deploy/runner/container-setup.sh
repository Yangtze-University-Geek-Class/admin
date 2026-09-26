#!/bin/sh
# runner 容器内：装 Docker 与工作流用到的工具，建 runner 用户，下载并校验 actions runner。两种用法：
#   sh container-setup.sh ci   常驻 CI 容器 yzgc-runner（#93）：两个实例 r1/r2、清工作目录的钩子、每天清镜像。
#                              可重复执行，但会重启容器里的 docker，正在构建镜像的 job 会失败；在没有 job 时跑。
#   sh container-setup.sh jit  一次性部署 runner 的镜像（#97，由 jit-image.sh 调用）：一份 runner、接一个 job 就关机的服务。
set -eu
MODE=${1:-ci}
case "$MODE" in ci|jit) ;; *) echo "用法：sh container-setup.sh ci|jit" >&2; exit 2 ;; esac
export DEBIAN_FRONTEND=noninteractive
RUNNER_VERSION=2.337.0
RUNNER_SHA256=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613

# 家里连 archive.ubuntu.com 慢，换中科大源（apt 仍按 Ubuntu 签名校验）。
for f in /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
  [ -f "$f" ] && sed -i -E 's#http://(archive|security|mirrors\.tuna\.tsinghua\.edu\.cn)(\.ubuntu\.com)?/ubuntu/?#http://mirrors.ustc.edu.cn/ubuntu/#' "$f"
done
apt-get update -q
apt-get install -y -q --no-install-recommends \
  ca-certificates curl git jq gh unzip zip xz-utils zstd gzip rsync file \
  openssh-client openssl shellcheck build-essential python3 libicu74 \
  docker.io docker-buildx docker-compose-v2

# Docker Hub 在家里连不上，走镜像加速；overlay2 显式指定，不让它在 btrfs 上选 btrfs 驱动。
# 三个 Dockerfile 的基础镜像按 digest 写死，经加速源拉取时 Docker 按 digest 校验内容，加速源换不了镜像。
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "storage-driver": "overlay2",
  "registry-mirrors": ["https://docker.m.daocloud.io", "https://docker.1ms.run"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl enable docker >/dev/null 2>&1
systemctl restart docker

# 系统级 Node 22 LTS：对齐 ubuntu-latest 预装的 node（branch-guard、docker、pr-contract 不经 setup-node 直接调）。
# 同一个官方包（按 SHASUMS256 校验）还要解进 runner 的工具缓存，见下面的 seed_node_tool_cache。
if node --version 2>/dev/null | grep -q '^v22\.'; then
  node_version=$(node --version)
else
  node_version=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.version | startswith("v22.")) | select(.lts != false)][0].version')
fi
# 下载目录由这一次运行用 mktemp 新建（0700），退出时删掉；「核对过」记在变量里，不看文件在不在：
# /tmp 对 job 可写，上次失败留下的包、或者 job 放进去的同名文件，都不能不经核对就解进 /usr/local 和工具缓存。
node_dir=$(mktemp -d)
trap 'rm -rf "$node_dir"' EXIT
node_tarball=$node_dir/node-${node_version}-linux-x64.tar.xz
node_verified=
fetch_node() {
  if [ -n "$node_verified" ]; then return 0; fi
  curl -fsSL -o "$node_tarball" "https://nodejs.org/dist/${node_version}/${node_tarball##*/}"
  curl -fsSL -o "$node_dir/SHASUMS256.txt" "https://nodejs.org/dist/${node_version}/SHASUMS256.txt"
  # 先挑出这个包的那一行再核对：清单里没有这一行时 grep 就失败，不把空输入交给 sha256sum。
  if ! (cd "$node_dir" && grep " ${node_tarball##*/}\$" SHASUMS256.txt > tarball.sha256 && sha256sum -c tarball.sha256); then
    echo "${node_tarball##*/} 与 nodejs.org 的 SHASUMS256 对不上" >&2
    exit 1
  fi
  node_verified=1
}
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  fetch_node
  # 官方包里的属主是 uid 1001；root 解包默认保留属主，容器里 1001 多半就是 runner，/usr/local 会变成 runner 的
  tar -xJf "$node_tarball" -C /usr/local --strip-components=1 --no-same-owner --exclude CHANGELOG.md --exclude README.md --exclude LICENSE
fi

# actions/setup-node 按 .nvmrc 的「22」先查 runner 的工具缓存，命中就不下载；没命中才从
# github.com/actions/node-versions 下 Node 包，家里要 13 分钟（v0.1.0-rc.7 的部署 job 实测，#104）。
# 布局是 @actions/tool-cache 的 find / cacheDir：$RUNNER_TOOL_CACHE/node/<版本>/x64 目录 + 同级的 x64.complete 标记，
# RUNNER_TOOL_CACHE 是 <runner 目录>/_work/_tool。job-started.sh 只清 _work/<仓库>/<仓库>，工具缓存留得住。
# 这里的 Node 版本等于上面系统级的版本；重做容器（或 jit 镜像）时才会换成更新的 22.x。
seed_node_tool_cache() {
  for cache in "$@"; do
    dir=$cache/node/${node_version#v}/x64
    if [ -f "$dir.complete" ]; then continue; fi
    fetch_node
    rm -rf "$dir"
    mkdir -p "$dir"
    tar -xJf "$node_tarball" -C "$dir" --strip-components=1
    : > "$dir.complete"
    echo "工具缓存：$dir"
  done
}

id runner >/dev/null 2>&1 || useradd -m -s /bin/bash runner
usermod -aG docker runner

tarball=/home/runner/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz
if ! echo "${RUNNER_SHA256}  ${tarball}" | sha256sum -c - >/dev/null 2>&1; then
  curl -fsSL --retry 5 --retry-all-errors -o "$tarball" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
fi
echo "${RUNNER_SHA256}  ${tarball}" | sha256sum -c -

if [ "$MODE" = jit ]; then
  d=/home/runner/actions-runner
  [ -x "$d/run.sh" ] || { mkdir -p "$d"; tar -xzf "$tarball" -C "$d"; }
  rm -f "$tarball"
  # JIT 配置由宿主机的 jit-pool.sh 写进 /home/runner/.jit（0600）。读进环境变量后马上删文件；
  # runner 从 ACTIONS_RUNNER_INPUT_JITCONFIG 读到以后会把它从自己的环境里清掉，不传给 job。
  # 但 run.sh 父进程的环境里还有它，runner 也会把解出的凭据写进 actions-runner/.credentials*，
  # job 与 runner 同一个用户，读得到：这只是本 runner 自己的凭据，随 job 结束注销。
  cat > /usr/local/bin/yzgc-jit-run <<'EOF'
#!/bin/sh
set -eu
ACTIONS_RUNNER_INPUT_JITCONFIG=$(cat /home/runner/.jit)
rm -f /home/runner/.jit
export ACTIONS_RUNNER_INPUT_JITCONFIG
cd /home/runner/actions-runner
exec ./run.sh
EOF
  chmod 0755 /usr/local/bin/yzgc-jit-run
  # 跑完一个 job（或者 runner 没起来）就关机；容器是 incus 的 ephemeral 实例，关机即删除。
  # RuntimeMaxSec 只是兜底：空闲超过 5 小时的 runner 由 jit-pool.sh 先注销再删容器，
  # 最晚接到的 job（build 最长 60 分钟）在 8 小时内也能跑完，不会被中途杀掉。
  cat > /etc/systemd/system/yzgc-jit-runner.service <<'EOF'
[Unit]
Description=GitHub Actions JIT runner: one job, then power off (yzgc deploy, #97)
Wants=network-online.target docker.service
After=network-online.target docker.service

[Service]
Type=exec
User=runner
Environment=HOME=/home/runner
ExecStart=/usr/local/bin/yzgc-jit-run
ExecStopPost=+/usr/bin/systemctl poweroff --no-block
RuntimeMaxSec=8h
EOF
  systemctl daemon-reload
  seed_node_tool_cache "$d/_work/_tool"
  chown -R runner:runner /home/runner
  apt-get clean
  docker version --format 'docker {{.Server.Version}}'
  exit 0
fi

# 每天清一次 72 小时前的镜像与构建缓存，CI 每次都会构建三条镜像。
cat > /etc/systemd/system/runner-docker-prune.service <<'EOF'
[Unit]
Description=Prune Docker images and build cache older than 72h (yzgc runner)
[Service]
Type=oneshot
ExecStart=/usr/bin/docker system prune -af --filter until=72h
ExecStart=/usr/bin/docker builder prune -af --filter until=72h
EOF
cat > /etc/systemd/system/runner-docker-prune.timer <<'EOF'
[Unit]
Description=Daily Docker prune for yzgc runner
[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now runner-docker-prune.timer

for n in 1 2; do
  d=/home/runner/r$n
  [ -x "$d/config.sh" ] || { mkdir -p "$d"; tar -xzf "$tarball" -C "$d"; }
done
# job-started.sh 与本脚本放在同一目录推进容器（incus file push），装到 runner 的 HOME 外面、两个实例共用。
install -o runner -g runner -m 0755 "$(dirname "$0")/job-started.sh" /home/runner/job-started.sh
seed_node_tool_cache /home/runner/r1/_work/_tool /home/runner/r2/_work/_tool
chown -R runner:runner /home/runner
docker version --format 'docker {{.Server.Version}}'
docker info --format 'storage={{.Driver}} mirrors={{.RegistryConfig.Mirrors}}'
