#!/bin/sh
# yzgc-runner 容器内：把 /home/runner/r1…rN（N = RUNNER_INSTANCES，默认 4，#124）注册成本仓库的自托管 runner 并装成服务（#93）。
# 已注册且服务在跑的实例不动（不打断正在跑的 job）；只补注册、补装新增的实例。
# 先跑 container-setup.sh（它会放好 /home/runner/job-started.sh）。
# 注册令牌一小时过期，从 stdin 读一行，经 runner 认的环境变量 ACTIONS_RUNNER_INPUT_TOKEN 交给 config.sh，
# 不出现在任何进程的命令行参数里（ps 看不到），也不写日志。宿主机上这样调用：
#   gh api -X POST repos/<仓库>/actions/runners/registration-token -q .token \
#     | ssh <宿主机> 'incus exec yzgc-runner -- sh /root/register.sh'
set -eu
IFS= read -r ACTIONS_RUNNER_INPUT_TOKEN
[ -n "$ACTIONS_RUNNER_INPUT_TOKEN" ] || { echo "stdin 里没有注册令牌" >&2; exit 1; }
export ACTIONS_RUNNER_INPUT_TOKEN
REPO_URL=${REPO_URL:-https://github.com/Yangtze-University-Geek-Class/admin}

for n in $(seq 1 "${RUNNER_INSTANCES:-4}"); do
  cd "/home/runner/r$n"
  changed=0
  if [ ! -f .runner ]; then
    # su 不带 -：保留上面导出的 ACTIONS_RUNNER_INPUT_TOKEN
    su runner -c "./config.sh --unattended --url '$REPO_URL' --name crosery-arch-$n --labels yzgc-arch --work _work --replace"
  fi
  # 与托管 runner 对齐：每个实例一个 HOME（~/setup-pnpm、pnpm 的 SQLite 索引、npm 缓存不在两个并发 job 之间共用，
  # 共用时 pnpm 报 disk I/O error），每个 job 开始前清空工作目录（上一个 job 的 sparse-checkout 会留下半个工作区）。
  mkdir -p "/home/runner/r$n/home" && chown runner:runner "/home/runner/r$n/home"
  grep -q '^HOME=' .env || { echo "HOME=/home/runner/r$n/home" >> .env; changed=1; }
  grep -q '^ACTIONS_RUNNER_HOOK_JOB_STARTED=' .env || { echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=/home/runner/job-started.sh" >> .env; changed=1; }
  chown runner:runner .env
  # svc.sh install 在服务已存在时报错退出，只在没装过时装。.env 改过才重启（会打断这个实例正在跑的 job），
  # 没改过只保证服务在跑：加实例时重跑本脚本，已有实例上的 job 不受影响。
  [ -f .service ] || { ./svc.sh install runner; changed=1; }
  if [ "$changed" = 1 ] && systemctl is-active --quiet "$(cat .service)"; then ./svc.sh stop; fi
  systemctl is-active --quiet "$(cat .service)" || ./svc.sh start
done
