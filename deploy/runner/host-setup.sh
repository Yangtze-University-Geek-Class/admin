#!/bin/sh
# crosery-arch 宿主机：初始化 incus，创建常驻 CI 容器 yzgc-runner（#93），以及一次性部署 runner 用的网桥与 profile（#97）。
# 可重复执行。
set -eu

if ! incus storage show default >/dev/null 2>&1; then
  incus admin init --preseed <<'EOF'
config: {}
networks:
- name: incusbr0
  type: bridge
  config:
    ipv4.address: 10.77.0.1/24
    ipv4.nat: "true"
    ipv6.address: none
storage_pools:
- name: default
  driver: btrfs
  config:
    size: 80GiB
profiles:
- name: default
  devices:
    eth0:
      name: eth0
      network: incusbr0
      type: nic
    root:
      path: /
      pool: default
      type: disk
EOF
fi

# 一次性部署 runner（#97）用单独的网桥：和常驻 CI 容器不在同一个二层网段（incus 的 ACL 管不到同一网桥上容器之间的流量）。
if ! incus network show incusdeploy >/dev/null 2>&1; then
  incus network create incusdeploy ipv4.address=10.78.0.1/24 ipv4.nat=true ipv6.address=none
fi

# Docker 把宿主机 FORWARD 策略设成 DROP，会连带丢掉 incus 网桥的转发；在 DOCKER-USER 里放行这两座网桥。
cat > /etc/systemd/system/incus-docker-forward.service <<'EOF'
[Unit]
Description=Let incus bridge traffic pass Docker's FORWARD DROP policy (yzgc runners, #93 #97)
After=docker.service incus.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'for br in incusbr0 incusdeploy; do iptables -C DOCKER-USER -i $$br -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -i $$br -j ACCEPT; iptables -C DOCKER-USER -o $$br -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -o $$br -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT; done'

[Install]
WantedBy=multi-user.target docker.service
EOF
systemctl daemon-reload
systemctl enable incus-docker-forward.service
systemctl restart incus-docker-forward.service

# 出站 ACL：容器不许碰家里局域网、tailscale、netbird、docker0、宿主机本身和代理的 fake-ip 段，其余放行。
# 挡不住的：经家里公网 IP 绕回路由器端口转发的连接（见 docs/ops/CICD.md「自托管 runner」的剩余风险）。
PRIVATE=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,169.254.0.0/16,198.18.0.0/15
incus network acl show runner-egress >/dev/null 2>&1 || incus network acl create runner-egress
if ! incus network acl show runner-egress | grep -q "destination: $PRIVATE\$"; then
  # 网段清单变了：先删掉旧的拒绝规则再按新清单加（整条比对，不只看某一个网段）
  incus network acl show runner-egress | sed -n 's/^ *destination: //p' | while read -r old; do
    incus network acl rule remove runner-egress egress action=reject destination="$old"
  done
  incus network acl rule add runner-egress egress action=reject destination="$PRIVATE"
fi
for br in incusbr0 incusdeploy; do
  incus network set "$br" security.acls=runner-egress \
    security.acls.default.egress.action=allow security.acls.default.ingress.action=allow
done

# 一次性部署 runner 的 profile：jit-pool.sh 用它起容器，jit-image.sh 用它做镜像。
incus profile show yzgc-deploy >/dev/null 2>&1 || incus profile create yzgc-deploy
incus profile edit yzgc-deploy <<'EOF'
description: yzgc one-shot deploy runner (#97), one container per job
config:
  limits.cpu: "6"
  limits.memory: 8GiB
  security.nesting: "true"
  security.syscalls.intercept.mknod: "true"
  security.syscalls.intercept.setxattr: "true"
devices:
  eth0:
    name: eth0
    network: incusdeploy
    type: nic
  root:
    path: /
    pool: default
    type: disk
EOF

if ! incus info yzgc-runner >/dev/null 2>&1; then
  incus launch images:ubuntu/24.04 yzgc-runner \
    -c security.nesting=true \
    -c security.syscalls.intercept.mknod=true \
    -c security.syscalls.intercept.setxattr=true \
    -c limits.cpu=8 -c limits.memory=16GiB \
    -c boot.autostart=true
fi
incus list yzgc-runner
