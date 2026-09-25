#!/bin/sh
# 每个 job 开始前清空工作目录，和托管 runner 一样从空目录检出。自托管 runner 在 job 之间复用
# _work/<仓库>/<仓库>；上一个 job 的 sparse-checkout（pr-contract 只检出一个文件）会让下一个 job 缺文件。
set -eu
ws=${GITHUB_WORKSPACE:-}
# 只认 /home/runner/r<N>/_work/ 下至少两层、不以 . 开头的目录（正常就是 _work/<仓库>/<仓库>），删除范围出不了 _work；
# 路径里带 .. 的一律不碰。
case "$ws" in
  *..*) echo "job-started: 跳过，路径里有 ..：$ws"; exit 0 ;;
  /home/runner/r[0-9]/_work/[!.]*/[!.]*) ;;
  *) echo "job-started: 跳过，GITHUB_WORKSPACE=${ws:-空}"; exit 0 ;;
esac
[ -d "$ws" ] && find "$ws" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
echo "job-started: 已清空 $ws"
