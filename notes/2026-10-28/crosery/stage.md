# stage · crosery · 2026-10-28

负责人：crosery

## 10:55:26 +08:00 · 发布 · 无 issue · 发布 rc.28 修复 CDN 私有索引归档并部署预发布

- 执行者：agent-omp-geek-main-fece2da2（omp，k3.1-pro）
- 做了什么：复用已合入 stage 的 task/303 rclone 缺失对象修复；CI 运行 40611105503 全绿后创建并推送 v0.1.1-rc.28，提交 a5cb5a9cd470daf047551e2b785081f52cab83cf
- 结果：Deploy Preview 运行 40621471746 全部 job 成功；cdn-upload 与私有索引归档通过；release.json=0.1.1-rc.28@a5cb5a9cd470
- 下一步：核对官网、控制台、论坛真实浏览器资源加载

## 10:55:27 +08:00 · 验收 · 无 issue · 预发布大资源已从 Garage CDN 加载

- 执行者：agent-omp-geek-main-fece2da2（omp，k3.1-pro）
- 做了什么：真实 Chromium 打开 https://prev.yangtzeu.work/、/console、/forum/，读取 performance 资源地址并截图；Range 请求核对大文件尺寸与缓存
- 结果：官网 24 个静态/媒体资源全部来自 cdn.yangtzeu.work，无同源大资源；控制台 36 个构建资源与论坛 6 个首屏构建资源均来自新 CDN；vendor 219519B、console CSS 942242B、forum CSS 851834B、forum JS 598629B 均返回 206 与一年 immutable 缓存

## 13:50:24 +08:00 · 发布 · 无 issue · 发布 rc.29：旧帖图片与主站反代配置并入预发布

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：#304（MR !47）与 #305（MR !48）合入 stage 94140632；GitHub 与 GitLab 的 stage 一致，CI 运行 40636046607 全绿；在 94140632aaea 上创建并推送 v0.1.1-rc.29（GitHub 与 GitLab 各一份）。
- 结果：Deploy Preview 运行 40637152774 五个 job 全部成功；预发布 release.json=0.1.1-rc.29@94140632aaea

## 13:50:24 +08:00 · 验收 · 无 issue · rc.29 预发布核对：资源主机、旧帖正文、正式库副本升级演练

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：真实 Chromium（ego）打开 https://prev.yangtzeu.work/ 与 /forum/：首页 18 个资源中 14 个来自 cdn.yangtzeu.work、同源仅 3 个接口请求；GET /forum/t/{t35,t6,t9,t73}.md 的 aliyuncs 引用均为 0，CDN 图片数 9/6/2/1。新做一份正式库备份 20261028T054823Z-3636030，用 rc.29 镜像在其副本上演练升级、二次启动与旧镜像回滚：三次 integrity ok、外键违规 0；旧帖正文 aliyuncs 引用 7→0、CDN 引用 0→8、edited_at 非空的帖子数 7→7（人工编辑未被改写）；回滚到 0.1.0 镜像后表结构无差异。副本已从 Arch 删除。
- 结果：预发布功能核对通过。发现：本机到 Garage 公网入口 103.240.197.216 的 HTTPS 连接 20 次里 15 次建连超时（同机对 prev 源站 20/20 成功），HK 与 Arch 到同一入口各 20/20 成功，说明问题在国内到该入口的路径；主站反代已安装但 cdn 的 A 记录仍指向 103.240.197.216，等所有者登录 DNSPod 切换。

## 17:32:34 +08:00 · 合并 · #306 · 把 main 的 hotfix 提交合回 stage

- 执行者：agent-omp-geek-main-fece2da2（omp，deepseek-v4.1-flash）
- 做了什么：git merge --no-ff origin/main（228be7bf deploy-hotfix 工作流与 hotfix-policy），恢复 stage >= main 硬不变量
- 结果：本地 git merge-base --is-ancestor 228be7bf HEAD 为真；check-doc-sync 通过（8 组模块与文档）；note check 通过（140 条链路）

## 17:35:13 +08:00 · 验收 · #306 · 正式环境补齐预发布改动：CSP 对齐与比赛官网迁移

- 执行者：agent-omp-geek-main-fece2da2（omp，deepseek-v4.1-flash）
- 做了什么：对照预发布与正式：正式前置 Caddy 的 yangtzeu.work 块 CSP 仍是旧值（缺 cdn.yangtzeu.work 与 blob:），导致 cdn-plan 判为同源、正式全部资产走同源；比赛官网站点包与 competition_sites/competition_site_versions 只在预发布
- 结果：已备份 /etc/caddy/sites/yzgc.caddy.bak-20261028T*，caddy validate 通过后 reload：正式 CSP 与预发布一致；/data/sites 迁入 4 个文件（md5 全等）、DB 补 2 行（VACUUM INTO 备份 data.db.bak-before-contest-site-20261028）；/c/oss-challenge-2026-1/ 200，site_url 非空，浏览器渲染与预发布一致；正式论坛/控制台无 console error

## 17:39:11 +08:00 · 开发 · #306 · cdn 边缘入口预置证书，DNS 切换前即可完成 TLS 验证

- 执行者：agent-omp-geek-main-fece2da2（omp，deepseek-v4.1-flash）
- 做了什么：主站 hk-cn2 的 storage-cdn-edge.caddy 增加 tls 指向从 Garage 机复制的 cdn.yangtzeu.work 证书（/etc/caddy/certs，caddy:caddy 750/600）；备份 storage-cdn-edge.caddy.bak-20261028T*
- 结果：caddy validate 通过、reload 成功（首次因目录 700 root 失败，改 caddy:caddy 750 后成功）；--resolve 指向 156.238.244.78 实测 200×3、connect 0.05s、219,519 字节 0.41–0.65s；Range 206、CORS 与 immutable 缓存头透传；对照直连 Garage 1/3 建连超时（75s）。DNS 未改

## 18:22:13 +08:00 · 阻塞 · #308 · P0：成员没有 GitLab 访问入口，已建单并定位到正式缺 OIDC_JWKS 与 GITLAB_API_TOKEN

- 执行者：agent-omp-geek-main-fece2da2（omp，deepseek-v4.1-flash）
- 做了什么：按所有者 17:56 原话「gitlab他们都没有访问权限，你都记录下」建 GitLab #308（bug/P0/func:auth/hot-fix/infra:deploy）；只读核对 gitlab-psql：真人账号 7、signup_enabled=f、oauth_applications 0、admin 仓库私有、组 geek 只有 5 位 30 权限；正式 .env.production 的 OIDC_JWKS 与 GITLAB_API_TOKEN 为空、GITLAB_SYNC=off、gitlab_accounts=0
- 结果：issue https://git.yangtzeu.work/geek/admin/-/work_items/308 已开，附根因评论（CICD.md:18 记载 preview 17 / production 15 项 secrets，缺的正是这两项；API.md:67 无 OIDC_JWKS 时 /oidc/* 404）。未改任何线上配置，补齐环境级密钥需所有者授权
- 下一步：所有者确认补 OIDC_JWKS/GITLAB_API_TOKEN 与 GitLab 客户端登记后，再开 task 分支

## 18:23:54 +08:00 · 阻塞 · #308 · 决定性命中：GitLab 统一登录的 issuer 指向预发布

- 执行者：agent-omp-geek-main-fece2da2（omp，deepseek-v4.1-flash）
- 做了什么：只读核对 /etc/gitlab/gitlab.rb 3850-3862：omniauth_enabled=true、auto_sign_in_with_provider=openid_connect、args.issuer=https://prev.yangtzeu.work/oidc、identifier=gitlab、redirect_uri=git.yangtzeu.work/users/auth/openid_connect/callback（secret 未读取未打印）；实测 prev 的 .well-known=200、正式 .well-known 与 /oidc/jwks=404
- 结果：GitLab 登录读的是预发布库账号，正式 45 个账号在预发布没有身份，被 access_denied 回退；登录页还自动跳该 provider。已在 #308 追加定位评论（note 1656）
- 下一步：需所有者授权：正式 OIDC_JWKS keygen 写入、gitlab.rb issuer 改 https://yangtzeu.work/oidc 并 reconfigure、补 GITLAB_API_TOKEN 后按需开 GITLAB_SYNC
