#!/bin/sh
# yzgc-runner 容器内：装 Docker 与 CI 用到的工具，建 runner 用户，下载并校验 actions runner（#93）。可重复执行，
# 但重跑会重启容器里的 docker，正在构建镜像的 job 会失败；在没有 job 时跑。
set -eu
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
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  node_version=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r '[.[] | select(.version | startswith("v22.")) | select(.lts != false)][0].version')
  node_tarball=node-${node_version}-linux-x64.tar.xz
  curl -fsSL -o "/tmp/${node_tarball}" "https://nodejs.org/dist/${node_version}/${node_tarball}"
  curl -fsSL -o /tmp/SHASUMS256.txt "https://nodejs.org/dist/${node_version}/SHASUMS256.txt"
  (cd /tmp && grep " ${node_tarball}\$" SHASUMS256.txt | sha256sum -c -)
  tar -xJf "/tmp/${node_tarball}" -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude README.md --exclude LICENSE
  rm -f "/tmp/${node_tarball}" /tmp/SHASUMS256.txt
fi

id runner >/dev/null 2>&1 || useradd -m -s /bin/bash runner
usermod -aG docker runner

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

tarball=/home/runner/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz
if ! echo "${RUNNER_SHA256}  ${tarball}" | sha256sum -c - >/dev/null 2>&1; then
  curl -fsSL --retry 5 --retry-all-errors -o "$tarball" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
fi
echo "${RUNNER_SHA256}  ${tarball}" | sha256sum -c -
for n in 1 2; do
  d=/home/runner/r$n
  [ -x "$d/config.sh" ] || { mkdir -p "$d"; tar -xzf "$tarball" -C "$d"; }
done
# job-started.sh 与本脚本放在同一目录推进容器（incus file push），装到 runner 的 HOME 外面、两个实例共用。
install -o runner -g runner -m 0755 "$(dirname "$0")/job-started.sh" /home/runner/job-started.sh
chown -R runner:runner /home/runner
docker version --format 'docker {{.Server.Version}}'
docker info --format 'storage={{.Driver}} mirrors={{.RegistryConfig.Mirrors}}'
