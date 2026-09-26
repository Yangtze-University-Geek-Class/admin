#!/bin/sh
# crosery-arch 宿主机：部署用一次性 runner 的补位进程（#97）。root 运行：
#   sh jit-pool.sh token     从 stdin 读 GitHub 令牌（fine-grained，只有组织权限 Self-hosted runners: Read and write），
#                            写成 /etc/yzgc-runner/github.header（root 0600），再用它读一次 runner 组核对令牌可用
#   sh jit-pool.sh install   装到 /usr/local/sbin/yzgc-jit-pool，启用并重启 systemd 服务 yzgc-jit-pool
#   yzgc-jit-pool run        服务本体：保持 POOL 个在跑的容器，每个里面一台只接一个 job 的 JIT runner；
#                            job 跑完容器关机，incus 删掉（ephemeral），这里再补一个新的；每 10 分钟做一次 maintain
# 容器从 jit-image.sh 做的镜像 yzgc-deploy 起，用 host-setup.sh 建的 profile yzgc-deploy。
set -eu
ORG=Yangtze-University-Geek-Class
GROUP_ID=3 # 组织 runner 组 yzgc-deploy：只放行 admin 仓库，不放行公开仓库
LABEL=yzgc-deploy
POOL=${YZGC_JIT_POOL:-2}
HEADER=/etc/yzgc-runner/github.header
API=https://api.github.com

log() { echo "jit-pool: $*"; }

# 令牌只从文件进请求头（curl -H @文件），不进任何命令行
api() {
  curl -fsS --max-time 30 --retry 3 --retry-all-errors -H @"${API_HEADER:-$HEADER}" \
    -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' "$@"
}

# 只数在跑的：启动失败留下的停机实例不占池位，由 maintain 删掉
containers() { incus list --format csv --columns ns | awk -F, '$1 ~ /^ydeploy-/ && $2 == "RUNNING" { print $1 }'; }

# 在 `spawn || …` 里调用时 set -e 不生效，每一步自己判失败
spawn() {
  name=ydeploy-$(date +%m%d%H%M%S)-$(od -An -N2 -tx1 /dev/urandom | tr -d ' \n')
  if ! incus launch yzgc-deploy "$name" --ephemeral --profile yzgc-deploy --quiet; then
    # 启动失败时 incus 不会删掉已经建好的实例
    if incus info "$name" >/dev/null 2>&1; then incus delete -f "$name"; fi
    return 1
  fi
  i=0
  until incus exec "$name" -- systemctl is-active --quiet docker.service 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -ge 90 ]; then log "$name 90 秒内没起来，删掉"; incus delete -f "$name"; return 1; fi
    sleep 1
  done
  body=$(printf '{"name":"%s","runner_group_id":%s,"labels":["self-hosted","Linux","X64","%s"],"work_folder":"_work"}' "$name" "$GROUP_ID" "$LABEL")
  # JIT 配置只经变量和 stdin 进容器（printf 是 shell 内建，不产生进程参数）
  if ! jit=$(api -X POST "$API/orgs/$ORG/actions/runners/generate-jitconfig" -d "$body" | jq -er .encoded_jit_config); then
    log "$name 拿不到 JIT 配置，删掉"; incus delete -f "$name"; return 1
  fi
  if ! printf '%s' "$jit" | incus exec "$name" -- sh -c 'umask 077; cat > /home/runner/.jit && chown runner:runner /home/runner/.jit' ||
    ! incus exec "$name" -- systemctl start --no-block yzgc-jit-runner.service; then
    log "$name 启动 runner 失败，删掉"; incus delete -f "$name"; return 1
  fi
  log "$name 已起，等 job"
}

# 每 10 分钟一次。在 `maintain || …` 里调用，set -e 不生效，失败的那一项记日志、下次再试。
#   1. 启动失败留下的停机实例：删掉（ephemeral 实例正常关机时 incus 自己会删）
#   2. 容器没了、GitHub 上还挂着的 runner（宿主机重启、容器被强删）：按名字注销
#   3. 空闲超过 5 小时的 runner：先在 GitHub 上注销（runner 忙时 GitHub 拒绝），成功了再删容器、由补位换新的。
#      这样容器里服务的 8 小时上限只是兜底，接到 job 的 runner 不会在 job 中途被杀
maintain() {
  incus list --format csv --columns ns | awk -F, '$1 ~ /^ydeploy-/ && $2 != "RUNNING" { print $1 }' \
    | while read -r name; do
        if incus delete -f "$name"; then log "删掉没在跑的 $name"; fi
      done
  runners=$(api "$API/orgs/$ORG/actions/runner-groups/$GROUP_ID/runners?per_page=100") || return 1
  live=$(containers)
  printf '%s' "$runners" \
    | jq -r '.runners[] | select(.name | startswith("ydeploy-")) | select(.status == "offline") | "\(.id) \(.name)"' \
    | while read -r id name; do
        printf '%s\n' "$live" | grep -qx "$name" && continue
        if api -X DELETE "$API/orgs/$ORG/actions/runners/$id" >/dev/null; then log "注销离线的 $name"; else log "注销离线的 $name 失败"; fi
      done
  now=$(date +%s)
  incus list --format json | jq -r '.[] | select(.name | startswith("ydeploy-")) | "\(.name) \(.created_at)"' \
    | while read -r name created; do
        [ $((now - $(date -d "$created" +%s))) -ge 18000 ] || continue
        runner=$(printf '%s' "$runners" | jq -r --arg n "$name" '.runners[] | select(.name == $n) | "\(.id) \(.busy)"')
        case "$runner" in
          "") if incus delete -f "$name"; then log "删掉没注册上的 $name"; fi ;;
          *" false")
            if api -X DELETE "$API/orgs/$ORG/actions/runners/${runner%% *}" >/dev/null && incus delete -f "$name"; then
              log "回收空闲超过 5 小时的 $name"
            fi ;;
          *) ;; # 正在跑 job，等它自己结束
        esac
      done
}

run() {
  [ -r "$HEADER" ] || { log "缺令牌文件 $HEADER，先跑 sh jit-pool.sh token"; exit 1; }
  last_maintain=0
  while :; do
    # 维护放在补位前面：补位一直失败时也照样回收空闲太久的 runner
    now=$(date +%s)
    if [ $((now - last_maintain)) -ge 600 ]; then
      maintain || log "读 runner 列表失败，10 分钟后再试"
      last_maintain=$now
    fi
    n=$(containers | awk 'END { print NR }')
    if [ "$n" -lt "$POOL" ]; then
      spawn || { log "补位失败，60 秒后再试"; sleep 60; }
      continue
    fi
    sleep 5
  done
}

save_token() {
  install -d -m 0700 /etc/yzgc-runner
  IFS= read -r token
  [ -n "$token" ] || { echo "stdin 里没有令牌" >&2; exit 1; }
  umask 077
  printf 'Authorization: Bearer %s\n' "$token" > "$HEADER.tmp"
  # 先用新令牌读一次 runner 组，读得到才替换：轮换时新令牌不对，旧令牌照常能用
  API_HEADER=$HEADER.tmp
  if ! api "$API/orgs/$ORG/actions/runner-groups/$GROUP_ID" \
    | jq -er '"令牌可用：runner 组 \(.name)，可见范围 \(.visibility)，公开仓库 \(.allows_public_repositories)"'; then
    rm -f "$HEADER.tmp"
    echo "新令牌读不到 runner 组 $GROUP_ID，没有替换" >&2
    exit 1
  fi
  API_HEADER=
  mv "$HEADER.tmp" "$HEADER"
}

install_service() {
  install -m 0755 "$0" /usr/local/sbin/yzgc-jit-pool
  cat > /etc/systemd/system/yzgc-jit-pool.service <<'EOF'
[Unit]
Description=Keep one-shot GitHub Actions JIT runners for yzgc deploys (#97)
Wants=network-online.target
After=network-online.target incus.service incus-docker-forward.service

[Service]
ExecStart=/usr/local/sbin/yzgc-jit-pool run
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable yzgc-jit-pool.service
  systemctl restart yzgc-jit-pool.service
  systemctl --no-pager --lines=0 status yzgc-jit-pool.service
}

case "${1:-}" in
  token) save_token ;;
  install) install_service ;;
  run) run ;;
  *) echo "用法：sh jit-pool.sh token|install|run" >&2; exit 2 ;;
esac
