#!/bin/sh
# yzgc-runner 容器内：把 /home/runner/r1、r2 注册成本仓库的自托管 runner 并装成服务（#93）。
# 注册令牌一小时过期，只从环境变量 RT 读，不进命令行参数和日志。宿主机上这样调用：
#   gh api -X POST repos/<仓库>/actions/runners/registration-token -q .token \
#     | ssh <宿主机> 'read -r T; incus exec yzgc-runner --env RT="$T" -- sh /root/register.sh'
set -eu
: "${RT:?缺少注册令牌 RT}"
REPO_URL=${REPO_URL:-https://github.com/Yangtze-University-Geek-Class/admin}

for n in 1 2; do
  cd "/home/runner/r$n"
  if [ ! -f .runner ]; then
    su runner -c "./config.sh --unattended --url '$REPO_URL' --token \"\$RT\" --name crosery-arch-$n --labels yzgc-arch --work _work --replace"
  fi
  # svc.sh install 在服务已存在时报错退出；已装过就只确认它在跑。
  [ -f .service ] || ./svc.sh install runner
  ./svc.sh start
done
