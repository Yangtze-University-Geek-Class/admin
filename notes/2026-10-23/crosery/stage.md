# stage · crosery · 2026-10-23

负责人：crosery

## 01:26:26 +08:00 · 发布 · #262 #239 · 本机构建并部署预发布 0.1.1-rc.7（4eabb10273af）

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：所有者 2026-10-23 00:37 批准[已脱敏]（账号被封期间的临时做法，跳过 CI 与 GitHub 部署记录）。本地 tag v0.1.1-rc.7 → 4eabb102（未推送）；docker build --platform linux/amd64 三个镜像，构建参数与 deploy-preview.yml 相同，STATIC_CDN_BASE 留空走同源；docker save | gzip -9，sha256 e3be4323…；部署前在目标机 sqlite3 .backup 预发布库到 /root/yzgc-backups/preview-20261023T0049-7a25ec804b1f.db（integrity_check ok）；scp 归档、deploy-stack.sh 与 compose；env 用目标机现有 .env.preview 只换 IMAGE_TAG（密钥不离开目标机）；按工作流同一组参数运行 deploy-stack.sh
- 结果：部署成功：健康检查 18201/18200 返回 ok，deploy-history 记 2026-10-22T16:55:38Z preview 4eabb10273af OK；https://prev.yangtzeu.work/release.json 为 0.1.1-rc.7@4eabb10273af；/auth/me、/auth/providers、/api/public/competitions、/signin、/device 返回 200，报名、天梯、名单接口匿名 401 not_signed_in；表 29→38、比赛 0→1（种子赛事 oss-challenge-2026-1），旧数据未丢

## 01:26:26 +08:00 · 发布 · #262 · 本机构建并部署预发布 0.1.1-rc.8（bba4b066cd04），修登录页宽屏拉满

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：本地 tag v0.1.1-rc.8 → bba4b066（未推送）；同 rc.7 的步骤构建、打包（sha256 db3bb82c…）、部署前备份到 /root/yzgc-backups/preview-20261023T0110-4eabb10273af.db（integrity_check ok）、只换 IMAGE_TAG、运行 deploy-stack.sh
- 结果：部署成功：健康检查通过；release.json 为 0.1.1-rc.8@bba4b066cd04；正式环境仍是 0.1.0（d4a24749），未触碰

## 01:26:26 +08:00 · 验收 · #262 #239 · agent 在预发布 rc.8 上用 ego-browser 核对登录页与比赛窗口（不是所有者验收）

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：ego-browser 匿名访问 https://prev.yangtzeu.work：/signin 在 1440×900、2000×1100、390×844 量卡片宽度并截图；/device 未登录跳 /signin?return_to=/device；桌面与手机打开「比赛」窗口
- 结果：登录卡片 440px 居中（1440 宽时 x=500，2000 宽时 x=780），手机 358px；无胶囊、无加粗；比赛窗口显示种子赛事、倒计时、赛程三格与页签，未登录按钮为「登录后报名」，手机为底部弹层。手机上副标题末尾「登录」单独折行，未修。登录后的报名、组队、控制台未验证：所有者 GitHub 账号被封，agent 不用别人的账号登录。所有者验收：未进行
- 下一步：所有者在预发布验收；正式 0.1.1 等所有者明确批准，部署前备份正式库

## 03:37:45 +08:00 · 发布 · #262 · 本机构建并部署预发布 0.1.1-rc.9（02003548efa6）：邮箱验证码与密码登录、邀请码注册、账号页

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：本地 tag v0.1.1-rc.9 → 02003548（未推送）；同 rc.7 的步骤构建三个 amd64 镜像（版本串 0.1.1-rc.9@02003548efa6），docker save | gzip -9，sha256 9ab3ff39…；部署前备份预发布库到 /root/yzgc-backups/preview-20261023T0326-bba4b066cd04.db（integrity_check ok）；scp 归档、.sha256、deploy-stack.sh 与两份 compose；env 用目标机现有 .env.preview 只换 IMAGE_TAG（diff 只有这一行）。第一次运行漏传 .sha256，deploy-stack.sh 在装载镜像前停下，deploy-history 记 FAILED，线上仍是 rc.8 未动；补传后重跑。部署后在 server 容器里用 account.js provision 建所有者账号（GitHub 130495739、组织角色 admin、绑定所有者给的邮箱），用 account.js invite 从本机钥匙串经标准输入写入默认邀请码（值不进命令行、日志和记录）
- 结果：部署成功：deploy-history 2026-10-22T19:32:28Z preview 02003548efa6 OK，健康检查 18201/18200 ok；release.json 为 0.1.1-rc.9@02003548efa6；/auth/providers 列出 github 与 email，没有 Google（预发布没配 Google 凭据）；表 38→40（invite_codes、email_challenges）；provision 输出 created true、emailLinked true，users 表 1 行（org_role admin、org_state active），identities 有 github 与 email 两条；invite_codes 1 行（id 1，不限次数、不过期、created_by system）。正式环境仍是 0.1.0（d4a24749），未触碰

## 03:37:45 +08:00 · 验收 · #262 · agent 在预发布 rc.9 上核对登录页与账号页（不是所有者验收）

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：ego-browser 匿名访问 https://prev.yangtzeu.work：/signin 在 1440×900 与 390×844 截图；密码方式填所有者邮箱和一个错误密码；验证码方式填错邮箱格式点「获取验证码」；/account 未登录点「去登录」。curl 只打不发信的接口
- 结果：登录页有「通过 GitHub 继续」、「或者用邮箱」和验证码、密码两种方式，没有 Google 按钮；错误密码提示「邮箱或密码不对」，错邮箱提示「邮箱格式不对」；390 宽无横向溢出；/account 未登录显示「还没有登录」，点「去登录」到 /signin?return_to=%2Faccount。/auth/email/verify 没有挑战回 400 code_expired，/auth/email/password 不存在的邮箱回 400 invalid_credentials，/api/console/invites 与 /api/identity/me 匿名 401，/auth/google 404 provider_not_enabled；server 日志 30 分钟内没有 warn 和 error。未验证：真实发验证码与收信（没有给任何邮箱发信）、登录后的账号页、设密码、邀请码注册、控制台邀请码页、Google 登录（没有凭据）。登录页说明文字提到 Google，预发布却没有 Google 按钮，未改。所有者验收：未进行
- 下一步：所有者在预发布用邮箱验证码登录，在「我的账号」设至少 15 位的密码，看控制台的邀请码；正式 0.1.1 等所有者明确批准，部署前备份正式库

## 10:13:42 +08:00 · 发布 · #262 · 本机构建并部署预发布 0.1.1-rc.10（b69740157437）：权限只认极客班账号，GitHub 改由服务器接入

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：本地 tag v0.1.1-rc.10 → b6974015（未推送）；同 rc.9 的步骤构建三个 amd64 镜像（版本串 0.1.1-rc.10@b69740157437，三个 docker build 均 exit 0），docker save | gzip -9，sha256 43bb94b0737469d99b5dd95fcb0f6b5148e9ea0c08ae1a82fe836560a65a5cb5；部署前备份预发布库到 /root/yzgc-backups/preview-20261023-095632-02003548efa6.db（integrity_check ok）；scp 归档、.sha256、deploy-stack.sh 与两份 compose（preview.yml 两边 sha256 都是 cc97039b…），目标机 sha256sum -c OK；env 用目标机现有 .env.preview 只换 IMAGE_TAG（diff 只有这一行），目标机 env 里没有 GH_APP_*，compose 默认留空
- 结果：部署成功：deploy-history 2026-10-23T02:08:15Z preview b69740157437 OK，健康检查 18201/18200 ok，清掉 471d3dbfda3e 的旧镜像（保留最近 5 个 tag）；release.json 为 0.1.1-rc.10@b69740157437；/auth/providers 只有 github 与 email；库里表 40 张、integrity_check ok，users 1 行（admin、active），提督、舰员的称号说明已换成新默认（「站内管理员，拥有全部权限，任命舰长」「在读成员；成为极客班成员后自动获得」）；server 日志 15 分钟内只有 Node 的 MODULE_TYPELESS_PACKAGE_JSON 警告（package.json 与 Dockerfile 这次没改）。正式环境仍是 0.1.0（d4a24749），未触碰

## 10:13:42 +08:00 · 验收 · #262 · agent 在预发布 rc.10 上核对控制台（不是所有者验收）

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：ego-browser 用浏览器里已有的所有者预发布会话只读访问（先确认会话是邮箱登录：/auth/me provider email，/api/console/me site_role admin、github none、22 项能力，所以 GitHub 页面不会拿被封账号的令牌去调 GitHub）：/console/people、/console/github、/console/github/invite-links，1440 宽截图；没有点任何保存、生成、停用或删除。curl 匿名打 /healthz、/release.json、/auth/providers、/auth/me、/api/console/me、/api/admin/<org>/overview、/api/public/org
- 结果：所有者邮箱会话是提督，导航里 GitHub 组织的 9 页都在；成员表 1 人（@Crosery，提督，站内角色「管理员」，登录方式 GitHub、邮箱），表上方提示「GitHub 还没接上，名单里只有登录过本站的人和有称号的人」；/console/github 显示「GitHub 还没接上」和要由组织所有者建 App 的说明，409 github_not_connected；邀请链接页能打开，「生成链接」置灰并有说明，但空状态仍写「用右上角的「生成链接」创建第一条。」，与置灰的按钮矛盾，回到 task 分支改；页面都没有横向溢出。匿名 /api/console/me 与 /api/admin/... 回 401 not_signed_in。未验证：真实 GitHub App（没有凭据）、GitHub 会话下的组织页面、改站内角色的保存（没在所有者数据上做写操作）、真实发信、Google。所有者验收：未进行

## 10:23:17 +08:00 · 发布 · #262 · 本机构建并部署预发布 0.1.1-rc.11（b542b3be2eb5）：邀请链接空状态修正

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：本地 tag v0.1.1-rc.11 → b542b3be（未推送）；同 rc.10 的步骤构建三个 amd64 镜像（版本串 0.1.1-rc.11@b542b3be2eb5，均 exit 0），归档 sha256 0112a6159bcc81687d335137323d4c762926b974beec99f296448f2a640faeeb；部署前备份预发布库到 /root/yzgc-backups/preview-20261023-101421-b69740157437.db（integrity_check ok）；env 仍用目标机 .env.preview 只换 IMAGE_TAG（diff 只有这一行）
- 结果：部署成功：deploy-history 2026-10-23T02:22:28Z preview b542b3be2eb5 OK，sha256 校验通过，健康检查 18201/18200 ok；release.json 为 0.1.1-rc.11@b542b3be2eb5；库 integrity_check ok，users 仍是 1 行 admin、active；server 日志 5 分钟内除 MODULE_TYPELESS_PACKAGE_JSON 警告外没有 warn、error。正式环境仍是 0.1.0（d4a24749），未触碰

## 10:23:17 +08:00 · 验收 · #262 · agent 在预发布 rc.11 上核对邀请链接页（不是所有者验收）

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：ego-browser 用浏览器里已有的所有者邮箱会话只读打开 /console/github/invite-links，1440 宽截图，没有点任何按钮；之后关掉这次的浏览器任务
- 结果：页面读到的 release.json 是 0.1.1-rc.11@b542b3be2eb5；「生成链接」置灰，说明「GitHub 还没接上，生成新链接要等服务器配好 GitHub App，或用 GitHub 登录后再来；已有的链接照常可以停用和删除。」，空状态改成「接上 GitHub 后，用右上角的「生成链接」创建第一条。」，没有横向溢出。所有者验收：未进行
- 下一步：所有者在预发布用邮箱会话看控制台；确认 ADR-0005 第二次修订第 2–5 条与审查里交给所有者定的几项；GitHub App 要由没被封的组织所有者建；正式 0.1.1 等所有者明确批准，部署前备份正式库

## 12:08:35 +08:00 · 发布 · #262 · 本机构建并部署预发布 0.1.1-rc.12（2101fe40448a）：登录页注册标签、Google 登录、侧栏悬停高亮

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：本地 tag v0.1.1-rc.12 → 2101fe40（未推送）；同 rc.7 的步骤构建三个 amd64 镜像（版本串 0.1.1-rc.12@2101fe40448a），docker save | gzip -9，sha256 24683660…；部署前备份预发布库到 /root/yzgc-backups/preview-20261023-034510-b542b3be2eb5.db（integrity_check ok）；scp 归档、.sha256、deploy-stack.sh 与两份 compose；env 用目标机现有 .env.preview：换 IMAGE_TAG，加 GOOGLE_CLIENT_ID 与 GOOGLE_CLIENT_SECRET（值从本机钥匙串经标准输入写入，不进命令行、日志和记录；diff 只有这三项）；运行 deploy-stack.sh。Google OAuth 客户端建在所有者已有的 Google Cloud 项目里，应用是 Testing 状态，测试用户只有所有者的 Google 账号
- 结果：部署成功：deploy-history 2026-10-23T03:57:39Z preview 2101fe40448a OK；release.json 为 0.1.1-rc.12@2101fe40448a；/auth/providers 为 github、google、email；GET /auth/google 302 到 accounts.google.com，redirect_uri 为 https://prev.yangtzeu.work/auth/google/callback，带 PKCE S256。正式环境仍是 0.1.0（d4a24749），未触碰

## 12:08:35 +08:00 · 验收 · #262 · agent 在预发布 rc.12 上核对登录页与控制台侧栏（不是所有者验收）

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：ego-browser 打开 https://prev.yangtzeu.work/signin，1440×900 与 390×844 各截「登录」「注册」两个标签，读按钮文字、宽度与表单标签；用浏览器里已有的所有者会话打开 /console，1440×560 把侧栏滚到 200，悬停「邀请」「邀请链接」读条目上沿与高亮上沿。注册后两种说明与按钮换行宽度是在本机开发服务器 127.0.0.1:5196 上拦接口返回值核对的，不在预发布上
- 结果：注册标签：邮箱、邀请码、验证码、「密码（可以不填）」；桌面「通过 GitHub 继续」「用 Google 注册」各 202px，没填邀请码时 Google 按钮是灰的；手机两个按钮竖排各 332px，横向无溢出。侧栏：根滚动 200、__body 滚动 0，「邀请」条目 311 = 高亮 311，「邀请链接」342 = 342（rc.11 上同样操作是 311 对 111）。没验证：真实发验证码与收信、真实 Google 授权往返、注册真实账号。所有者验收：未进行
- 下一步：所有者在预发布验收；正式 0.1.1 等所有者明确批准，部署前备份正式库

## 15:54:16 +08:00 · 发布 · #270 · GitLab 一侧接上统一登录、自动跳转、仓库改私有（geek-main-1c 执行，合并人复核），发现建号时头像没带过去

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：geek-main-1c 15:3x–15:4x 在 GitLab 主机：备份 gitlab.rb，secret 从凭据库经 stdin 写进 root 0600 文件，追加 omniauth（issuer https://prev.yangtzeu.work/oidc，client gitlab，pkce，uid_field sub），reconfigure；用所有者账号的邮箱验证码在 ego-browser 走真实往返，进的是 GitLab 用户 4 Crosery、没有另建号；再开自动跳转、disable_password_authentication_for_users_with_sso_identities，把 geek 组和 4 个仓库改私有，root 不绑统一登录。合并人 15:5x 独立核对：匿名访问、登录页表单、用户与身份、可见性、应用设置、4 张截图下载；又查了两个号的资料与头像
- 结果：未登录 /geek、/geek/admin 302 到 sign_in，项目接口 404，git info/refs 401，公开项目 []；/users/sign_in 只剩提交到 /users/auth/openid_connect 的表单，?auto_sign_in=false 有密码框；用户 4 Crosery、5 LYsnowQ 各一个 openid_connect 身份，6 GitLabDuo 是 GitLab 自建 bot；组和 geek/admin、geek-cli、geek_bot、github 都是 private；SSO 用户禁用密码为 true、注册关闭。证据贴 MR !2 评论 366。缺口：两个号都是默认 identicon 头像——LYsnowQ 的 GitHub 头像在预发布容器能下载（200 image/png 约 280 KB），是建号后 PUT /users/5 传头像没成功，代码不记这一步的错误且只传一次；Crosery 的 GitHub 被封、库里没有头像来源。作为候选交给所有者，不在 #270 改
- 下一步：所有者验收；头像缺口由所有者决定是否修，原因先由 geek-main-1c 查 GitLab 日志里 PUT /api/v4/users/5 的返回码

## 15:56:41 +08:00 · 发布 · #270 · 头像没带过去的原因：GitLab 头像上限 200 KiB，我们按 1 MB 放行

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：geek-main-1c 只读查 GitLab api_json.log：15:25:24 PUT /api/v4/users/5 回 400（correlation_id 01M5KTCWKKM9VXC0WD6CTSEFXQ），api_error avatar is too big (should be at most 200 KiB)，avatar.png 282806 字节；没有对用户 4 发过 PUT。合并人匿名核对 LYsnowQ 的 GitHub 头像：原图与 s=460 都是 282806 字节，s=256 是 107154 字节
- 结果：原因确认：gitlab-sync.ts:20 的 AVATAR_MAX_BYTES 是 1 MB，大于 GitLab 的 200 KiB。写进 MR !2 评论 367 前后的进展记录；作为候选交给所有者（取 s=256、上限 200 KiB、失败记错误并重试、补传现有账号），不在 #270 里改
- 下一步：所有者决定是否修
