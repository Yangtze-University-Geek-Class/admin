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

# 出站 ACL：容器不许碰家里局域网、tailscale、netbird、docker0 与宿主机本身，其余放行。
incus network acl show runner-egress >/dev/null 2>&1 || incus network acl create runner-egress
incus network acl show runner-egress | grep -q "10.0.0.0/8" || \
  incus network acl rule add runner-egress egress action=reject \
    destination=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,169.254.0.0/16
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
