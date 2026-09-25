#!/bin/sh
# crosery-arch 宿主机：初始化 incus 并创建 yzgc-runner 容器（#93）。可重复执行。
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

# Docker 把宿主机 FORWARD 策略设成 DROP，会连带丢掉 incusbr0 的转发；在 DOCKER-USER 里放行这一座网桥。
cat > /etc/systemd/system/incus-docker-forward.service <<'EOF'
[Unit]
Description=Let incusbr0 traffic pass Docker's FORWARD DROP policy (yzgc runner, #93)
After=docker.service incus.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -i incusbr0 -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -i incusbr0 -j ACCEPT; iptables -C DOCKER-USER -o incusbr0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -o incusbr0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT'

[Install]
WantedBy=multi-user.target docker.service
EOF
systemctl daemon-reload
systemctl enable --now incus-docker-forward.service

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
incus network set incusbr0 security.acls=runner-egress \
  security.acls.default.egress.action=allow security.acls.default.ingress.action=allow

if ! incus info yzgc-runner >/dev/null 2>&1; then
  incus launch images:ubuntu/24.04 yzgc-runner \
    -c security.nesting=true \
    -c security.syscalls.intercept.mknod=true \
    -c security.syscalls.intercept.setxattr=true \
    -c limits.cpu=8 -c limits.memory=16GiB \
    -c boot.autostart=true
fi
incus list yzgc-runner
