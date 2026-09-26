#!/bin/sh
# crosery-arch 宿主机：做一次性部署 runner 的 incus 镜像 yzgc-deploy（#97）。root 在本目录运行，先跑过 host-setup.sh：
#   sh jit-image.sh <按 digest 写的基础镜像>...
# 参数是要预先拉进镜像的基础镜像（省掉每个 job 重新拉），取自三个 Dockerfile：
#   sh jit-image.sh $(grep -ho '^FROM [^ ]*@sha256:[0-9a-f]*' ../../app/*/Dockerfile | cut -d' ' -f2 | sort -u)
# 重做镜像不影响已经在跑的容器；jit-pool.sh 之后起的新容器用新镜像。
set -eu
here=$(cd "$(dirname "$0")" && pwd)
builder=yzgc-deploy-build

for ref in "$@"; do
  case "$ref" in *@sha256:*) ;; *) echo "只接受按 digest 写的镜像：$ref" >&2; exit 2 ;; esac
done

if incus info "$builder" >/dev/null 2>&1; then incus delete -f "$builder"; fi
incus launch images:ubuntu/24.04 "$builder" --profile yzgc-deploy
i=0
until incus exec "$builder" -- getent hosts mirrors.ustc.edu.cn >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -lt 60 ] || { echo "构建容器 60 秒内没联网" >&2; exit 1; }
  sleep 1
done

incus file push "$here/container-setup.sh" "$builder/root/container-setup.sh"
incus exec "$builder" -- sh /root/container-setup.sh jit
for ref in "$@"; do
  incus exec "$builder" -- docker pull -q "$ref"
done
# 清掉 machine-id：否则从同一镜像起的容器 machine-id 相同，DHCP 会分到同一个地址。
incus exec "$builder" -- sh -c 'rm -f /root/container-setup.sh /var/lib/dbus/machine-id && : > /etc/machine-id'
incus stop "$builder"
incus publish "$builder" --alias yzgc-deploy --reuse
incus delete "$builder"
incus image list yzgc-deploy
