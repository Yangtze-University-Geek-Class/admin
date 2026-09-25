#!/bin/sh
# yzgc-runner 容器内：把 /home/runner/r1、r2 注册成本仓库的自托管 runner 并装成服务（#93）。
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

for n in 1 2; do
  cd "/home/runner/r$n"
  if [ ! -f .runner ]; then
    # su 不带 -：保留上面导出的 ACTIONS_RUNNER_INPUT_TOKEN
    su runner -c "./config.sh --unattended --url '$REPO_URL' --name crosery-arch-$n --labels yzgc-arch --work _work --replace"
  fi
  # 与托管 runner 对齐：每个实例一个 HOME（~/setup-pnpm、pnpm 的 SQLite 索引、npm 缓存不在两个并发 job 之间共用，
  # 共用时 pnpm 报 disk I/O error），每个 job 开始前清空工作目录（上一个 job 的 sparse-checkout 会留下半个工作区）。
  mkdir -p "/home/runner/r$n/home" && chown runner:runner "/home/runner/r$n/home"
  grep -q '^HOME=' .env || echo "HOME=/home/runner/r$n/home" >> .env
  grep -q '^ACTIONS_RUNNER_HOOK_JOB_STARTED=' .env || echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=/home/runner/job-started.sh" >> .env
  chown runner:runner .env
  # svc.sh install 在服务已存在时报错退出；已装过就只确认它在跑。改过 .env 要重启才生效，会打断这个实例正在跑的 job。
  [ -f .service ] || ./svc.sh install runner
  if systemctl is-active --quiet "$(cat .service)"; then ./svc.sh stop; fi
  ./svc.sh start
done
