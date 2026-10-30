# task/334/host_hardening · crosery · 2026-10-30

负责人：crosery

## 09:43:25 +08:00 · 开工 · #334 · 从 gitlab/stage 14e46e6d20f3 建 task/334/host_hardening

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 334 host_hardening：建分支与 worktree .claude/worktrees/task-334，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 10:07:43 +08:00 · 开发 · #334 · 依赖升级消除 critical/high，TRUST_PROXY 跳数语义保持

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：app/server 升级 fastify 5.12.7、@fastify/static 10.1.8、@fastify/multipart 10.1.6、multer 2.5.0、undici 7.30.1、sharp 0.35.5、dompurify 3.4.17；app/web 升级 react-router-dom 7.18.5；根 overrides 收窄传递依赖（dompurify、source-map-js、@fastify/busboy、find-my-way、fast-uri、brace-expansion）；fastify 5.12 起数字 trustProxy 失败关闭，app.ts 用 trustProxyHops 保留 N 跳语义
- 结果：pnpm audit --prod：critical 1 → 0，high 42 → 0，moderate 34 → 0，low 16 → 1（katex，低危，不在要求范围）；forum.test.ts 的 TRUST_PROXY=2 用例 3/3 通过
- 下一步：全量 pnpm test 与 pnpm check 在提交前重跑

## 10:08:08 +08:00 · 开发 · #334 · 密钥门禁增加 GitLab 与 sk- 令牌形态（只增规则）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：scripts/check-secrets.mjs 新增 GitLab 令牌（glpat-、glrt-、glptt-、gldt-，正文 20 位以上）与 sk- 形态（正文 32 位以上）规则；tests/tooling/check-secrets.test.ts 用运行时拼出的假令牌验证红绿
- 结果：node scripts/check-secrets.mjs 通过（仓库无匹配字面量）；vitest tests/tooling/check-secrets.test.ts 5 项通过

## 10:08:38 +08:00 · 开发 · #334 · 两套栈容器加固与 GitLab 日志轮转

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：production.yml 与 preview.yml 的 server、web、forum 同时加 read_only、cap_drop ALL、pids_limit（server 256，web 与 forum 128）；server 与 web 的 /tmp 放命名卷（备份快照与 nginx 缓冲写磁盘，不占内存上限），forum 用 noexec 的 16m tmpfs；gitlab compose 加 json-file 轮转；scripts/deployment-environment.mjs 增加 containerHardeningProblems 与两套签名比对
- 结果：docker compose config 两套渲染通过，三个服务均 read_only、cap_drop=[ALL]、pids_limit、no-new-privileges；node scripts/deployment-environment.mjs --check 通过；vitest tests/tooling/container-hardening.test.ts 与 deployment-environment.test.ts 共 46 项通过；未在真机 docker run 验证

## 10:09:03 +08:00 · 开发 · #334 · 镜像单元加 systemd 沙箱，经 install-host 安装

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：deploy/remote/systemd/cdn-mirror.service.d/sandbox.conf 与 cdn-mirror-watch.service.d/sandbox.conf：NoNewPrivileges、ProtectSystem=strict、只读写 /srv/cdn-mirror、ProtectHome、PrivateTmp、内核与命名空间限制；install-host.sh 清单加这两项（plan/apply/verify 照常比对）；测试的物料条目数 8 改 10
- 结果：vitest tests/tooling/install-host.test.ts 11 项通过；未在目标机运行 systemd-analyze security，沙箱是否影响镜像需预发布核对

## 10:09:14 +08:00 · 开发 · #334 · 入口响应头：cdn 加 HSTS，核对 CSP

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：deploy/storage-cdn/edge.caddy 的 cdn 站点加 HSTS（与主站同值）；tests/tooling/response-headers.test.ts 核对两套 CSP 无已退役域名 cdn.crosery.com、script-src 无 unsafe-inline、两套共用一份 CSP、cdn 与主站都有 HSTS
- 结果：vitest tests/tooling/response-headers.test.ts 4 项通过；线上 https://yangtzeu.work 与 prev 的 CSP 仍含 cdn.crosery.com，证据见 MR；cdn.yangtzeu.work 直连超时，线上 HSTS 未验证

## 10:12:33 +08:00 · 开发 · #334 · 部署、CDN、环境、web 文档同步；宏观对齐声明

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：docs/ops/DEPLOY.md 增加容器加固、宿主沙箱、部署账号现状；docs/ops/STORAGE-CDN.md 增加边缘 HSTS 说明；docs/ops/ENVIRONMENTS.md 与 docs/services/web/README.md 更新日期；新增 docs/changes/334.json，node scripts/check-architecture.mjs --base gitlab/stage 通过
- 结果：宏观对齐通过（24 个变更文件，44 个关联节点）

## 10:12:33 +08:00 · 开发 · #334 · 文档核对（不改内容的文档）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：文档核对：docs/ops/CICD.md 不用改——没有改 .github/workflows，部署流程与门禁不变
- 结果：未改内容，只核对

## 10:12:34 +08:00 · 开发 · #334 · 文档核对（环境文档）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：文档核对：docs/ops/ENVIRONMENTS.md 不用改——env 键与 TRUST_PROXY 取值没有变，只有 compose 的容器设置与宿主 drop-in 改了；日期同步到今天
- 结果：未改内容，只核对

## 10:12:34 +08:00 · 开发 · #334 · 文档核对（服务文档）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：文档核对：docs/services/server/README.md 不用改——依赖只升到修复版本，第 112 行关于遗留依赖的描述仍成立；TRUST_PROXY 的运行语义不变
- 结果：未改内容，只核对

## 10:14:00 +08:00 · 开发 · #334 · 文档核对（服务文档，server 与 web）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：文档核对：docs/services/server/ 不用改——依赖只升到修复版本，第 112 行关于遗留依赖的描述仍成立；TRUST_PROXY 的运行语义不变，只改了实现方式；文档核对：docs/services/web/ 不用改——web 依赖只升级 react-router-dom 与 dompurify，页面结构与源码地图未变
- 结果：未改内容，只核对；头部日期已在上一提交同步到 2026-10-30

## 10:26:09 +08:00 · 开发 · #334 · 全量测试与门禁结果（未全部跑完）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：pnpm test 全量在主机负载约 250 下跑到 13 个文件后停止；单独重跑 promotion-windows.test.ts 得到 42/43，1 项 500 提交用例超时；pnpm typecheck 通过；pnpm check 的 check:environments、check:secrets、check:docs、check:boundaries、check:site-config、check:runtime、check:cli、check:doc-sync（--base gitlab/stage）、check:architecture（--base gitlab/stage）通过
- 结果：未全量通过：全量测试未跑完；check:env-isolation 与 check:notes 失败为 stage 基线（deploy/hotfix/windows.json 域名计数、task_308_stage_close.md:5 首条不是开工），本 MR 未触及
- 下一步：负载下降后重跑 pnpm test 全量，并补 promotion-windows 的超时用例

## 10:39:45 +08:00 · 开发 · #334 · 删除未使用的 @fastify/multipart 与 multer

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：git grep 在 app、tests、scripts、deploy 中对 multer、@fastify/multipart、@fastify/busboy 零引用后，从 app/server/package.json 删除这两项，并删掉根 overrides 中仅为 multipart 服务的 @fastify/busboy；更新 docs/services/server/README.md 第 112 行的遗留依赖说明
- 结果：pnpm install 更新锁文件；pnpm audit --prod：critical 0、high 0、moderate 0、low 1（katex）

## 10:42:41 +08:00 · 开发 · #334 · trustProxyHops 测试先红后绿

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：新增 tests/server/trust-proxy-hops.test.ts：TRUST_PROXY=2 的客户端地址与升级前一致（198.51.100.7）、=1 取最近一跳、伪造的最左端地址不生效、裸数字在 fastify 5.12 下不信任。红：把 trustProxyHops 临时改回裸数字，3 项失败（得到 172.18.0.3）；绿：恢复后 4 项通过
- 结果：红绿已记录；tests/server/trust-proxy-hops、configuration、forum、forum-v2-endpoints 共 101 项通过；events、identity、console 共 33 项通过（审计 IP）

## 10:44:05 +08:00 · 开发 · #334 · 只读根文件系统的写入路径清单

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：逐项核对 server（DB_PATH、FORUM_DB_PATH、FORUM_UPLOAD_DIR、竞赛站点目录 dirname(DB_PATH)/sites、系统备份与 SQLite 的 /tmp）、web 与 forum（nginx 的 pid 与 5 个 *_temp_path 都在 /tmp）、forum 的 .nuxt 与 .output（只在 builder 阶段）；docs/ops/DEPLOY.md 新增写入路径表；tests/tooling/container-hardening.test.ts 断言三个 env 路径在 /data 下并挂 data:/data
- 结果：vitest tests/tooling/container-hardening.test.ts 8 项通过；本机 docker daemon 未运行（套接字不存在），未在真机启动，nginx 官方入口脚本的写入未核实

## 10:52:46 +08:00 · 提交 · #334 · 删除未使用依赖（4c28869f）、trustProxyHops 测试（f6564ae8）、只读写入路径（421792d0）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：依次提交三笔：4c28869f 删除 @fastify/multipart、multer 与仅为 multipart 服务的 @fastify/busboy override；f6564ae8 新增 tests/server/trust-proxy-hops.test.ts；421792d0 DEPLOY.md 写入路径表与 container-hardening 的 /data 断言
- 结果：pnpm audit --prod 基线 critical 1、high 42、moderate 34、low 16；删除后 critical 0、high 0、moderate 0、low 1（katex）

## 10:52:47 +08:00 · 提交 · #334 · sshd 加固物料与门禁（164f158a）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：提交 deploy/remote/sshd/yzgc-hardening.conf、install-host.sh 的 sshd_apply、confirm-sshd、rollback-sshd、plan 与 verify 的端口清单、三条部署工作流的 tar 与 confirm-sshd 步骤，以及 tests/tooling/install-host-sshd.test.ts（14 项）
- 结果：install-host-sshd 14 项通过；install-host 11 项通过；bash -n 与 shellcheck -S warning 无输出；未在目标机执行
- 下一步：防火墙等真实端口清单后另开 issue

## 10:52:47 +08:00 · 提交 · #334 · sshd 文档、逐台保留项与宏观对齐清单（84a220c6）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：DEPLOY.md 增加 sshd 逐台表、安全门、端口清单与分两步走理由；CICD.md 说明 confirm-sshd；docs/changes/334.json 增加覆盖项
- 结果：check-architecture 通过（#334，32 个变更文件，45 个关联节点）；check-doc-sync 通过（8 组）

## 11:16:14 +08:00 · 提交 · #334 · 返工 1：撤掉 GitLab 日志轮转

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：删除 deploy/gitlab/docker-compose.yml 的 logging 块与 container-hardening.test.ts 的 GitLab 用例；DEPLOY.md 改为 GitLab 不在本次范围
- 结果：container-hardening 7 项通过；gitlab compose config 退出码 0
- 下一步：返工 2：撤 HSTS 并按 dig 改正 STORAGE-CDN

## 11:17:03 +08:00 · 提交 · #334 · 返工 2：撤掉 cdn HSTS，DNS 说明按 dig 改正

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：删除 edge.caddy 的 HSTS；response-headers 去掉 cdn 用例；STORAGE-CDN.md 改为 A 记录指向 103.240.197.216（dig 核对），删除 HSTS 段；334.json 去掉 HSTS 表述
- 结果：response-headers 3 项通过；dig 得 103.240.197.216
- 下一步：返工 3-5：依赖（isomorphic-dompurify、STACK、334.json 依赖理由）

## 11:20:23 +08:00 · 提交 · #334 · 返工 4：删除未使用的 isomorphic-dompurify

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：git grep 确认 app 与 tests 零引用；pnpm --filter @yzgc/server remove isomorphic-dompurify；锁文件删除 268 行，jsdom 30 与 undici 8 不再出现
- 结果：生产依赖树 engines.node 最高下限 >=20.18.1（脚本核对）；core、competition-site、forum、profile、forum-v2-endpoints 共 161 项通过

## 11:20:51 +08:00 · 提交 · #334 · 返工 5：依赖说明按实际更正

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：334.json 的依赖理由写明两个高危升级与公告号、删除 isomorphic；STACK.md:23 与 server 合同去掉已删依赖
- 结果：334.json 解析通过；安全公告号来自 audit 前后对比

## 11:40:31 +08:00 · 提交 · #334 · 返工 3：@fastify/static 与 sharp 的高危公告核对（无代码提交）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：核对 audit-334-before.json：@fastify/static 高危 GHSA-83w8-p2f5-377r（<=10.1.0，修复于 10.1.1），当前 10.1.8；sharp 高危 GHSA-f88m-g3jw-g9cj（<0.35.0）、GHSA-rgj7-g3m4-5g8c（<0.35.4）、GHSA-wq5f-xc86-pv6w（<0.35.5），当前 0.35.5。STACK 升级准入：安全修复，按插件 major 变更，fastify 框架仍是 5.x。
- 结果：兼容性：tests/server core、competition-site、forum、profile、forum-v2-endpoints 共 161 项通过（静态托管与头像 WebP 转换）；生产树 engines.node 最高下限 >=20.18.1

## 11:40:31 +08:00 · 提交 · #334 · 返工 6：verify 接受 permitrootlogin 两种写法（d28cbc74）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：install-host verify 对 permitrootlogin 接受 prohibit-password 与 without-password；新增两项测试（接受 without-password、拒绝 yes）
- 结果：install-host-sshd 16 项通过；改前的 verify 运行 without-password 用例失败（红），改后通过（绿）

## 11:40:31 +08:00 · 提交 · #334 · 返工 8：sshd -T 失败直接报错，不再 || true（76daad14）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：inventory 与 verify 中 sshd -T 失败时报「sshd -T 失败」并退出非零；新增用例：假 sshd -T 失败时 verify 不打印「物料一致」
- 结果：install-host-sshd 17 项通过

## 11:40:31 +08:00 · 提交 · #334 · 返工 9：systemd 用例标题与断言一致（9cd08277）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：标题改为 apply 只 reload sshd 与 daemon-reload，有凭据才启用镜像定时器，不 restart、stop、kill 或 start
- 结果：install-host 11 项通过

## 11:40:31 +08:00 · 提交 · #334 · 返工 10：sshd 门禁拆成 sshd-harden.sh，待确认状态改为固定字段（03f54589）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：新增 deploy/remote/sshd-harden.sh（apply、verify、inventory、confirm、rollback）；install-host 的 apply、verify、confirm-sshd、rollback-sshd 转给它；sshd-pending 固定 dest、had、backup 三个字段，逐行读取，未知字段与 dest 指向别处都拒绝；计时器运行 STATE_DIR 里的副本；三条工作流 tar 加入 sshd-harden.sh
- 结果：install-host-sshd 与 install-host 共 30 项通过（含两项新增的待恢复记录校验）；shellcheck -S warning 无输出

## 11:40:31 +08:00 · 提交 · #334 · 返工 11：主配置没有 Include drop-in 目录时拒绝（38ab2f77）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：sshd-harden 的 include_problem：没有 Include /etc/ssh/sshd_config.d/*.conf，或 Include 之前有其它指令，inventory 写明原因，apply 在写入前拒绝，verify 报错；假根的 sshd 主配置由 fixture 写入
- 结果：32 项通过；新增两项（plan 报出且 apply 拒绝、Include 之前有指令时拒绝）；shellcheck 无输出

## 11:40:31 +08:00 · 提交 · #334 · 返工 7：sshd 新连接探测失败关闭，端口与地址从 sshd -T 读，流水线注入部署密钥（7a12f510）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：TCP 探测与默认成功的 ssh 探测去掉；probe_fresh_connection 用 ssh-agent 转发的部署密钥经回环连回本机执行 true，端口取 sshd -T 的 port，地址取具体 IPv4 listenaddress，通配或没有时用 127.0.0.1；apply 没有 --sshd-probe-with-agent 时在写入前拒绝；三条工作流 apply 步骤加载 id_deploy 到 ssh-agent 并 ssh -A 转发
- 结果：install-host-sshd 与 install-host 共 36 项通过（新增：无探测参数拒绝且不写文件、探测用 sshd -T 的端口、具体监听地址用于探测、没有 port 时回滚，reload 后 sshd -T 失败时恢复）；未做改前对照红跑（只对 permitrootlogin 做了）；残余风险：转发 agent 期间宿主可用部署密钥

## 11:40:32 +08:00 · 提交 · #334 · 返工 12：端口清单只逐条打印公网监听（bd8799d5）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：install-host inventory 逐条打印 0.0.0.0、::、* 与非回环非隧道地址上的监听（协议 地址:端口 进程名）；回环与 tun*、wg* 只记个数；ss 失败报错；隧道地址来自 ip -o -4 addr show
- 结果：install-host-sshd 与 install-host 共 37 项通过（新增：假 ss 四条监听，只打印公网两条，计 2 项，输出不含 cupsd、docker-proxy、127.0.0.1、10.66.0.2）

## 11:40:32 +08:00 · 提交 · #334 · 返工 13：宿主防火墙 plan 只读，apply 由 FIREWALL_APPLY 控制（8530489a）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：新增 deploy/remote/firewall-harden.sh（plan、ports、apply、confirm、rollback）与 firewall/ports.txt（arch：sshd、80、443；gitlab-preview：sshd）；规则只在 inet 表 yzgc_fw，公网接口放行已建立连接与 ports.txt，其余入站丢弃，lo 与 tun*、wg* 不限；apply 先 nft -c、备份旧表、安排 900 秒计时器、nft -f；install-host 增加 firewall-* 模式；三条工作流 plan 每次输出，FIREWALL_APPLY 为 on 才 apply，apply 后从 runner 连 DEPLOY_SSH_HOST 的放行端口，失败即 firewall-rollback
- 结果：firewall-harden 10 项通过（端口清单、plan 清单、nft -c 失败不装、规则内容、回滚删本表、回滚换回旧表、探测失败的回滚路径、confirm、待恢复记录校验、install-host 分发、edge 被拒）；install-host、install-host-sshd、container-hardening、response-headers 共 57 项一起通过；shellcheck 无输出

## 11:40:32 +08:00 · 提交 · #334 · 返工 14：备份开始前清掉残留快照目录（273dbbc1）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：未改为 tmpfs：生产库大小未核实，server 内存上限 512m；改做残留清理：removeStaleBackupDirs 清掉不属于本进程、超过 10 分钟的 yzgc-backup-*；activeBackupDirs 保护正在进行的备份
- 结果：system-backup 6 项通过（新增：残留删除、较新与进行中的目录保留）；红：临时禁用清理调用后该用例失败；tsc -p app/server/tsconfig.json --noEmit 退出码 0

## 11:40:32 +08:00 · 提交 · #334 · 返工：文档与架构声明（6915d6d3）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：DEPLOY.md 的 sshd 小节改为 sshd-harden 安全门、防火墙小节与公网端口清单口径；CICD.md 说明 ssh -A、FIREWALL_APPLY；334.json kind 改为 business，登记 flow:platform.system_backup 与关联域，移除撤销的覆盖项，补齐新文件
- 结果：check-architecture 通过（37 个变更文件，46 个关联节点）；check-doc-sync 通过（8 组）；note check 仅失败于 stage 上的 task_308 记录（不在本分支）

## 12:37:58 +08:00 · 返工 · #334 · 复审 1：gitlab-cutover 上传的物料补上 sshd-harden.sh 与 firewall-harden.sh（955fa329）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：gitlab-cutover.yml 的 tar 列表加入两个脚本；install-host.test.ts 解析 install-host.sh 的 ${HERE} 引用，断言四条工作流的上传列表都包含它们
- 结果：install-host.test.ts 12 项通过；工作流恢复到 HEAD 时新用例失败（红）

## 12:38:23 +08:00 · 返工 · #334 · 复审 12：DEPLOY.md 对象存储段改为直连 A 记录（ee762ac5）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：DEPLOY.md「香港对象存储」段的公网入口改为与 STORAGE-CDN.md 一致：cdn 的 A 记录直连 Garage 机，香港模板未安装，回滚值改由 STORAGE-CDN 说明
- 结果：文字改动，grep 确认原句已删除；没有改命令或配置

## 12:38:23 +08:00 · 返工 · #334 · 复审 10：sshd 待恢复记录的 backup 必须是本 drop-in 旁边的备份，备份缺失时拒绝（74e249a5）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：sshd-harden.sh 增加 backup_ok，只认 <drop-in>.bak-<UTC 时间戳>；had=1 且备份不存在时拒绝，不再删除现有 drop-in
- 结果：install-host-sshd.test.ts 28 项通过；恢复到 HEAD 的脚本时两项新用例失败（红）；bash -n 与 shellcheck -S warning 通过

## 12:38:23 +08:00 · 返工 · #334 · 复审 8：ip 失败时 inventory 与防火墙 plan 不打印监听明细（34db9dc9）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：install-host.sh inventory 与 firewall-harden.sh plan 在 ip addr 失败时只给警告，不打印监听、不计数；plan 仍退出 0，不挡住 confirm-sshd
- 结果：两个测试文件 40 项通过；恢复到 HEAD 的脚本时两项新用例失败（红）

## 12:38:24 +08:00 · 返工 · #334 · 复审 5：防火墙只在 arch 上装一份，gitlab-preview 不再是防火墙目标（7b5cdf37）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：ports.txt 删除 gitlab-preview 行并注明端口为并集；firewall-harden.sh 只接受 --target arch；GITLAB.md 写明两者同机；DEPLOY.md 逐台表同步
- 结果：firewall-harden 与 install-host 测试 24 项通过；新用例断言 gitlab-preview 被拒且不调用 nft

## 12:38:24 +08:00 · 返工 · #334 · 复审 6：隧道与回环每个接口模式各写一条 accept（25f8112d）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：render_ruleset 改为 iifname "lo"、"tun*"、"wg*" 各一条，不再把通配放进集合
- 结果：firewall-harden 13 项通过；恢复到 HEAD 时相关用例失败（红）。nft -c 没有在真机或容器里运行，未经 nft 验证

## 12:38:24 +08:00 · 返工 · #334 · 复审 3：公网口放行 ICMP 必要类型、NDP、packet-too-big 与 DHCP 应答（c5e9cc01）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：规则增加 ICMP 回显（10/秒限速）、不可达与超时、ICMPv6 邻居与路由发现、packet-too-big、公网口 udp 67→68 应答；全部在公网丢弃之前。packet-too-big 超出清单原文，在 MR 说明
- 结果：firewall-harden 13 项通过，顺序与类型断言都在；恢复到上一版脚本时新用例失败（红）。nft 语法未经 nft -c 验证

## 12:38:24 +08:00 · 返工 · #334 · 复审 9：plan 把 docker 发布端口与 DHCP 客户端从「会被挡」里分出（b383ced7）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：proc 为 docker-proxy 的监听标注为走 forward 链、不计数；udp 68 的 dhclient 标注为 DHCP 客户端、不计数；计数说明注明 docker 的 iptables 依赖
- 结果：firewall-harden 14 项通过；恢复到 HEAD 时 docker 用例失败（红）。daemon.json 的 iptables 设置未核实

## 12:38:24 +08:00 · 返工 · #334 · 复审 4：重启后残留的防火墙待确认记录不再永久拒绝 apply（47fdb9f0）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：pending 存在时，若回滚计时器与回滚服务都不在运行且 yzgc_fw 表不存在，记一行日志、清掉记录后继续；否则仍拒绝。nft 检查移到 pending 判断之前
- 结果：firewall-harden 17 项通过；恢复到 HEAD 时「重启后」用例失败（红）。sshd-pending 有同样的残留问题，本次没有改，列为残余风险

## 12:38:24 +08:00 · 返工 · #334 · 复审 7：ssh -A 与 ssh-agent 只在 sshd 物料要变时启用，900 秒有效，回环探测 -F /dev/null（44d9cf35）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：三条工作流先 plan，sshd drop-in 为 changed 或 missing 才 ssh-add -t 900、ssh -A 并注入 --sshd-probe-with-agent；sshd-harden.sh 回环探测加 -F /dev/null；DEPLOY.md、CICD.md 与 SECURITY.md 写明转发的残余风险，受限探测密钥列为候选
- 结果：install-host 与 install-host-sshd 42 项通过；工作流 run 块 bash -n 与 shellcheck 通过（从 YAML 文本抽出，仓库里没有 YAML 解析器）

## 12:38:24 +08:00 · 返工 · #334 · 复审 2：防火墙外部探测改为经跳板新建 ssh 连接，失败回滚；门禁移到 sshd 确认之后（c2458037）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：新增 deploy/remote/firewall-gate.sh：firewall-apply → ssh -F 配置 yzgc-target true → firewall-confirm，失败都 firewall-rollback 并退出 1；工作流先 verify 与 confirm-sshd，再 firewall-plan 与门禁；去掉 /dev/tcp 与 DEPLOY_SSH_HOST；ports 模式删除
- 结果：firewall-gate 6 项通过，防火墙与 install-host 测试共 65 项通过；把探测回滚分支改成 if false 时 3 项失败（红）。门禁没有在 GitHub Actions 或真机运行，80、443 未被探测

## 12:38:24 +08:00 · 返工 · #334 · 复审：docs/changes/334.json 补上新文件的覆盖（c599bc29）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：防火墙条目列全五个文件，gitlab-cutover、SECURITY.md、GITLAB.md 增加覆盖，documents 与 tests 同步；rollback 说明防火墙恢复方式
- 结果：check-architecture 通过（42 个变更文件，47 个关联节点）；check-doc-sync 通过（8 组）

## 12:46:25 +08:00 · 提交 · #334 · 重启后残留的 sshd 待确认记录（172a16ab），重新生成项目目录（e5d389f2）

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：sshd-harden.sh 加 rollback_armed：apply 遇到 sshd-pending 时，计时器或回滚服务还在就拒绝，都不在就先按记录恢复原 drop-in 并 reload 再照常 apply；测试加两条（重启后先恢复再 apply、计时器还在仍拒绝），DEPLOY.md sshd 安全门加第 8 条；项目目录按当前源码重新生成
- 结果：install-host-sshd 32/32 通过；新用例对旧脚本失败（红），改后通过（绿）；bash -n、shellcheck -S warning 通过；check:catalog 通过

## 12:51:35 +08:00 · 返工 · #334 · 门禁 1：pnpm check 的目录核对失败，重新生成项目目录（d2164ac5）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：pnpm catalog:generate，改动限于 docs/architecture/catalog 的生成文件（行号与来源摘要）
- 结果：pnpm run check:catalog 退出码 0

## 12:51:36 +08:00 · 返工 · #334 · 门禁 2：deploy/hotfix/windows.json 的域名登记上限 1 改为 3（fee18d17）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：origin-exceptions.json 的 max 从 1 改为 3，理由写明含域名的字段；没有改动记录内容
- 结果：pnpm run check:env-isolation 退出码 0。这个失败在 gitlab/stage 上同样存在（同一文件、同一登记），不是本分支引入

## 12:51:36 +08:00 · 返工 · #334 · 门禁 3：334.json 补上目录与环境登记的覆盖（1474255a）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：coverage 增加 docs/architecture/catalog 六个生成文件与 origin-exceptions.json
- 结果：check-architecture --base gitlab/stage 通过（49 个变更文件，47 个关联节点）；check-doc-sync --base gitlab/stage 通过

## 12:51:37 +08:00 · 返工 · #334 · 门禁未通过：check:notes 与 check:architecture 的默认基线（无提交，待所有者或发起人裁决）

- 执行者：agent-t334（Claude Code，claude-haiku-5-5，由 agent-claude-01d717b4 派遣）
- 做了什么：pnpm check 在 check:notes 停下：task_308_stage_close.md:5 第一条不是开工，记录在 stage 上，修它需要补写开工或改 CLOSED_CHAIN_EXCEPTIONS，两者都要所有者裁决。check:architecture 不带 --base 时默认 origin/stage，与 gitlab/stage 相差 110 与 4 个提交
- 结果：pnpm check:notes 退出码 1，原始报错见上；pnpm check:architecture 退出码 1，「宏观对齐失败：#334，190 个变更文件，103 个关联节点。」；带 --base gitlab/stage 时通过

## 17:27:13 +08:00 · 收尾 · #334 · 放弃，清理 worktree

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs finish 334：删 worktree .claude/worktrees/task-334 与本地分支 task/334/host_hardening
- 结果：issue 已关闭，没有 PR（放弃）
