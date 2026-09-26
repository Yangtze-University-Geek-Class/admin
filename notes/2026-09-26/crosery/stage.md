# stage · crosery · 2026-09-26

负责人：crosery

## 10:40:02 +08:00 · 发布 · #77 · 打 v0.1.0-rc.6 发预发布（宣传片 #77、一次性部署 runner #97）

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：所有者授权持续发预发布（修好就发）；stage 63fa3e5 的 CI 36212068354 通过后 git tag -a v0.1.0-rc.6 63fa3e5 并推送；部署首次跑在一次性 runner 上
- 结果：tag 对象 6548d7b，指向 63fa3e5c2733；pre-push 发布 tag 规则通过；Deploy Preview 运行 36212370824，plan 在 ydeploy-0926100542-88b1 上开始
- 下一步：部署成功后装预发布宿主 nginx 新模板（CSP），核对 release.json 与宣传片

## 11:23:48 +08:00 · 发布 · #77 · 预发布宿主 nginx 装新模板（宣传片 CSP）

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：把 stage 63fa3e5 的 deploy/nginx/preview.conf 装到 103.117.123.226 的 /etc/nginx/sites-available/yzgc-preview.conf：先备份到 /root/nginx-backup/yzgc-preview.conf.20260926112331，nginx -t 通过后 systemctl reload nginx
- 结果：nginx -t 通过（github.yangtzeu.work 的 conflicting server name 警告是原有的）；公网响应头 media-src 'self' blob: https://cdn.crosery.com、connect-src 带 https://cdn.crosery.com；与线上旧文件只差 CSP 一行和注释一行

## 12:03:43 +08:00 · 发布 · #99 · rc.6 部署超时取消；打 v0.1.0-rc.7（并发下载镜像归档）

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：rc.6 运行 36212370824 的 deploy job 单连接下载镜像归档 40 分钟只下到约 110MB，触发 45 分钟超时被取消，未连目标机；#100 合并后 stage e14fa01 的 CI 36216238998 通过，git tag -a v0.1.0-rc.7 e14fa01 并推送
- 结果：tag 对象 d36a4b6，指向 e14fa0133700；pre-push 发布 tag 规则通过；预发布仍是 rc.5，等 rc.7 部署

## 15:47:41 +08:00 · 验收 · #57 · 预发布投递链路实测：提交成功

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：所有者 14:58 把「投递没问题」列为上线标准。本机系统代理（127.0.0.1:7890）对 prev.yangtzeu.work 的 TLS 握手被断开，改用 Playwright Chromium 加 --no-proxy-server 打开 https://prev.yangtzeu.work/join-us，填一封写明是测试的投递（姓名「投递验证」、邮箱 apply-check@example.com）并寄出
- 结果：POST /api/portal/apply 201，编号 9a469f90-cf76-4ef1-9223-d528b45b224c，页面显示「信收到了 / 投递成功，我们会在 3 个工作日内联系你。」；预发布库里多了这一条测试投递，控制台里可以忽略或删除
