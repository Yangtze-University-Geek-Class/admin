# task/278/contest_site · crosery · 2026-10-24

负责人：crosery

## 14:04:50 +08:00 · 开工 · #278 · 接手 #278 第一期比赛官网、托管、SDK、GitLab 贡献计分、奖励与兑奖码

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：主会话已从 stage e43df562 建好 task/278/contest_site 与 .claude/worktrees/task-278（含 #280 的 1bd64d6d：grade.ts 与 account_profiles 两列）；读完 AGENTS.md 第 0 节规范、COMMITS、TESTING、交接目录的 SPEC §7、CONTRACT-278、DESIGN-278、CONTRACT-274 通用约定、ACCEPTANCE F 节，以及现有比赛、GitLab 同步、权限、限额、操作记录代码
- 结果：git branch --show-current = task/278/contest_site，工作区干净，HEAD 1bd64d6d
- 下一步：先写服务端：托管与站点包校验、公开接口与缓存限流、贡献收集与有用标签核实、年级系数、奖项、定榜与兑奖码

## 14:30:32 +08:00 · 方案 · #278 · 服务端方案定稿：托管、公开接口、贡献收集、年级系数、定榜与兑奖码

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：按 CONTRACT-278 与所有者 10-24 13:45 的规则定下替所有者做的决定：积分记录加 grade/grade_factor/weighted_points 三列（百分数，不重建 CHECK），扣分不乘系数；标签被拿掉时只撤销经标签自动加的分、候选回待确认，控制台确认的不动，定榜后都不改；作者自己打的「有用」不算；定榜名次严格不并列（同分先到者在前，再按报名先后），只发给分数大于 0 的个人；兑奖码 YUGC-XXXX-XXXX-XXXX-XXXX（80 位随机），库里存 SHA-256、AES-GCM 密文和末四位；新节点 competition.prize.redeem（已被 competition.* 与 * 覆盖，不改种子台账）；公开接口缓存 10 秒、按 IP 每分钟 120 次，另加整份快照接口给 SDK 轮询；预览用一小时有效的签名路径段，因为 sandbox 页面的子资源请求不带 cookie；站点文件放在数据库旁的 sites/，不加新环境变量
- 结果：lib/ 新增 site-package、competition-site-store、competition-rules-store、competition-public、competition-candidates、competition-prizes；server tsc 通过，现有服务端测试除两处表与种子清单外全过，两处按新增的表与种子补上
- 下一步：写服务端测试：托管与预览、公开接口不漏字段与限流、标签核实、年级系数、定榜、兑奖

## 14:44:10 +08:00 · 开发 · #278 · 服务端：官网托管、公开接口、贡献收集、年级系数、定榜与兑奖

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：新增 7 张表与 3 个积分列；site-package 校验站点包；/c/:slug 同域托管加 sandbox CSP 与签名预览；公开天梯、动态、统计、快照接口按 IP 限流并缓存 10 秒；GitLab 收集合并的 MR 与 Issue 并核实「有用」标签；年级系数按记分时刻落库；定榜生成兑奖码，控制台查找与核销；新节点 competition.prize.redeem；同步 server README、endpoint-contracts、data-model、API、SECURITY
- 结果：npx tsc -p app/server/tsconfig.json --noEmit 无错误；npx vitest run tests/server 35 个文件 602 个测试全部通过（新增 competition-site/public/candidates/prizes 四组 25 个）
- 下一步：提交服务端；再做 SDK、打包脚本、nginx、官网、门户与控制台

## 14:44:30 +08:00 · 提交 · #278 · 提交服务端阶段 326e9c10

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：按文件逐个 git add 39 个文件，提交 326e9c10 feat(server): 比赛官网托管、公开接口、贡献收集、年级系数、定榜与兑奖码（Refs #278）
- 结果：本地提交，没有推送
- 下一步：SDK、scripts/contest-site.mjs、nginx 与运维文档

## 15:12:04 +08:00 · 开发 · #278 · 比赛 SDK、第一期官网站点、站点包打包脚本与 nginx

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：新增 shared/competition-sdk（匿名 GET、四种错误、subscribe 最短 5 秒、限流等 retry_after）与 sdk.vite.config.ts 构建 /sdk/competition/v1.js；新增 sites/contests/oss-2026-1 官网（Canvas 天空与参赛者星星、泡泡字标题、翻牌倒计时、终端打字、领奖台天梯、动态流星、规则计分奖项时间线组队 FAQ，减少动态效果时静态）；scripts/contest-site.mjs pack/check 复用服务端校验；web 容器与宿主 nginx 加 /c/、/sdk/，只给站点包上传放宽 21m；同步 docs/services/web/README.md、docs/ops/DEPLOY.md，根目录加 contest:site
- 结果：vitest 4 个文件 46 个测试通过（competition-sdk 5、contest-site 6、tooling/contest-site 3、web-nginx 32）；check-boundaries 通过；tsc -p app/web/tsconfig.json 无错误；node scripts/contest-site.mjs pack 第一期产物：5 个文件、zip 227873 字节，校验通过
- 下一步：提交这一阶段；再做门户比赛窗口（奖项、年级系数、10 秒刷新、我的兑奖码、深链）

## 15:12:37 +08:00 · 提交 · #278 · 提交 SDK 与官网阶段 2510bf2f

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：按文件逐个 git add 32 个文件，提交 2510bf2f feat(portal): 第一期比赛官网、比赛 SDK 与站点包打包脚本（Refs #278）；第一次提交的说明少了标题后的空行，本地 amend 改正，没有推送过
- 结果：本地提交，没有推送
- 下一步：门户比赛窗口：奖项、年级系数与「有用」规则、天梯 10 秒刷新、我的兑奖码、?competition= 深链

## 15:21:20 +08:00 · 开发 · #278 · 门户比赛窗口：奖项、年级系数、10 秒天梯、兑奖码与官网深链

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：competitions.ts 读 prizes、grade_factors、finalized_at；competitionHub 加 readMyResults、factorText、rankRange、shortTime 与 results 路径，计分规则与操作条文案改成「有用」才计分、MR；详情概览加年级系数与奖项、Hero 加「比赛官网」、initialTab；天梯轮询 30 秒改 10 秒；「我的参赛」顶上列定榜结果、兑奖码与复制；?competition=<id>&view=team 深链选中比赛并打开队伍页签，读完从地址去掉；icons 加 file-copy-line、gift-line、thumb-up-line；同步 docs/services/web/portal.md 与 docs/plan/COMPETITION-APP.md
- 结果：npx vitest run tests/web 33 个文件 303 个测试通过（新增 portal-competition-results 8 个，hub 测试改 10 秒与新文案）；tsc -p app/web/tsconfig.json 无错误
- 下一步：提交门户阶段；再做控制台（待确认贡献、计分与奖项、官网、定榜、兑奖页）

## 15:21:35 +08:00 · 提交 · #278 · 提交门户阶段 157ce848

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：按文件逐个 git add 12 个文件，提交 157ce848 feat(portal): 比赛窗口加奖项、年级系数、10 秒天梯、兑奖码与官网深链（Refs #278）
- 结果：本地提交，没有推送
- 下一步：控制台：待确认贡献、计分与奖项、官网上传发布、定榜、兑奖页

## 16:47:04 +08:00 · 开发 · #278 · 控制台比赛页签、兑奖码核销、宿主上传上限回退与浏览器验收

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：控制台比赛页按权限分六个页签：待确认贡献（确认/驳回/立即收集）、计分与奖项（年级系数与可选奖项）、官网（上传校验、预览、发布、下线，413 时说明网关拒收）、定榜（预览名次、定榜、撤销）；新增 /console/competitions/redeem 核销页（查找、二次确认、刚登录过才能核销）与比赛列表的「核销兑奖码」按钮；lib/competition-contest 放表单与提示逻辑，mock 补四个读接口。宿主 nginx 模板回退到 6m 单一反代（第二阶段加的上传 location 让 #168 的 XFF 与 upstream 测试失败），只在 web 容器里给上传放宽 21m，DEPLOY、web README、Dockerfile 注释与 web-nginx 测试同步。sites 路由补响应 Schema；ownership.json 补 22 条比赛流程与证据，重新生成目录，写 docs/changes/278.json。ego-browser 在 1440×900 与 390×844 看官网、门户比赛窗口与控制台：修了奖项卡第三张（无说明）内容下沉、页脚气泡折行与极客娘挡住窗口标题、天梯说明孤字折行、门户手机计分卡 +15～+100 折行、控制台上传人压到上传时间、上传区英文提示、核销结果定义列表错位、「@系统」字样、手机上六个页签折成三行并被裁掉（改成横向滚动并把当前页签滚进可视区）
- 结果：pnpm test 119 个文件 1864 个测试全部通过；pnpm typecheck 通过；pnpm check 在 check:architecture 失败，原因是 origin/stage 停在 4beda55e（GitHub 封禁后没更新），把其他任务的 567 个文件算进来；node scripts/check-architecture.mjs --base 1bd64d6d --branch task/278/contest_site 通过（104 个变更文件、229 个关联节点）；check:catalog 通过；官网包 5 个文件、zip 227916 字节、首屏 JS 16.20 KB gzip；浏览器里官网 origin 为 null、没有 CSP 违规、两种尺寸无横向溢出、减少动态效果时 0 个运行中的动画、Tab 顺序 13 个焦点都有 3px 焦点环；本地核销一次成功，再查同一码显示已核销与核销人，查不存在的码提示「没有这个兑奖码」；截图在 /tmp/geek-takeover/c278/shots/
- 下一步：按阶段提交控制台、宿主上传回退与页面修正、目录与变更清单；真实 GitLab 收集、预览环境与 >6MB 上传未验证

## 16:52:40 +08:00 · 提交 · #278 · 提交控制台、宿主上传回退、页面修正、路由 Schema 与架构清单

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：按文件逐个 git add，分五个提交：a2d85e29 feat(console) 比赛页四个新页签与兑奖码核销；11136e18 fix(deploy) 宿主模板退回 6m、上传只在容器放宽；9fb497ef fix(portal) 官网页脚、奖项卡与门户手机计分卡排版；1b774ac5 fix(server) 官网托管路由登记响应 Schema；c8a3837a docs(architecture) ownership、目录与 docs/changes/278.json。第二个提交起初把部署回退和排版修正合在一个 fix(web) 里，scope 不在词表、也不是一个目的，没推送前 reset --soft 拆成两个
- 结果：本地提交，没有推送；工作区干净；pnpm test 119 个文件 1864 个测试通过
- 下一步：交主会话：审查、预览环境验收；真实 GitLab 收集与「有用」标签、经宿主上传 >6MB、真实账号核销未验证

## 17:34:33 +08:00 · 返工 · #278 · 比赛官网改成浅色、不沿用主站风格

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：按所有者 2026-10-24 16:38 的要求（「[已脱敏]」）重做第一期官网：去掉夜空 Canvas（sky.ts）和极客娘图（public/geek-girl.webp），首屏改成暖白底加四团慢慢漂移的彩色光晕，标题是贡献热力图拼出的「OSS CHALLENGE」（5×7 点阵、指针放大、点一下扩波纹、有新贡献时自动扩一圈），倒计时每位数字滚动，首屏下面加一条斜着滚动的贡献条（ticker.ts）；各段落改成白卡片、2px 墨线和彩色硬阴影，年级系数改成柱状图，第一名奖项卡是转动的彩色边框，天梯换名次时行位移动画；手机 720px 以下单列。另修 server：已发布版本的 HTML 原来也是 public, max-age=300，换版本后浏览器拿缓存里的旧 index.html 去找已经删掉的资源文件，整页不加载（本机换包时复现：页面引用旧的 index-BW3XsS8W.js，fetch 失败）；改成 HTML no-cache、其它文件仍 5 分钟，测试、接口文档、API.md、目录与 changes/278.json 同步。测试里的必备文件和打包样例换成 ticker.ts 与 styles.css，vite 的 publicDir 关掉。
- 结果：构建 JS 33.21 kB（gzip 13.90 kB）、CSS 6.79 kB gzip，包 4 个文件 25080 字节；pnpm typecheck 通过，pnpm test 119 个文件 1864 条全过。ego 浏览器在本机 nginx 叠加宿主 CSP 的环境里：1440×900 与 390×844 横向溢出 0、来源 null、只请求同源资源，可见文字 191 处对比度全部 ≥4.5，渐变字三色在底色上 4.83–5.93；减少动态效果时运行中的动画 0 个、标题照常画出；Tab 焦点有 3px 紫色描边；换包后普通刷新直接拿到新的 index-CgGejInr.js。截图在 /tmp/geek-takeover/c278/shots/v3-site-*。
- 下一步：跑 check:catalog、check-architecture 与 pnpm check，提交，收 ego TaskSpace，回报 team-lead。

## 17:37:33 +08:00 · 提交 · #278 · 浅色官网与 HTML 缓存修复分两个提交

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：5bd3e9a0 feat(portal) 官网改浅色独立风格（站点源码、测试、目录、web README、portal.md、changes/278.json）；d029c543 fix(server) 已发布官网 HTML 改 no-cache（路由、测试、endpoint-contracts、API.md、目录不变量、changes/278.json）。两个提交各自重新生成目录，check:catalog 在两个状态下都通过。只加指定文件，没有推送。
- 结果：两个提交落在 task/278/contest_site，工作区只剩这条记录。
- 下一步：跑 pnpm check 与 check-architecture，提交记录，收 ego TaskSpace 和本机服务，回报 team-lead。

## 17:54:27 +08:00 · 返工 · #278 · 变基到 #280 合并后的 stage 4c7c5dd5

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：按 team-lead 转达：#280 已合进 GitLab stage（4c7c5dd5），用 git rebase --onto 4c7c5dd5 1bd64d6d 把 12 个 #278 提交搬过去，丢掉和 #280 第一个提交同内容的 1bd64d6d。冲突：server README 与 data-model 的长行（两边都留）、web README 与 portal.md（#280 的账号资料窗口说法加 #278 的官网、SDK、nginx 说法）、console README 与 mock 的类型导入（取并集）、ownership.json 的文件归属表尾（两边都留，核对过 stage 新增的 118 行全在），生成的目录文件每一步都 pnpm catalog:generate 重新生成，没有手工合并。变基后两处行为冲突：#280 的 helpers.signIn 给新账号默认填大二，比赛用例原来从没填年级起步，积分被乘了 1.3；#280 的 real-info 测试规定比赛代码不读 real_name，而兑奖查找给 users.manage 返回真实姓名。处理：比赛夹具和 competition-scores 用例登录后把 enrollment_year 清空（要年级的用例自己写）；兑奖查找不再读也不再返回真实姓名，控制台核销页只显示用户名与昵称，接口契约、API.md、控制台 README、目录不变量跟着改。没有放宽 real-info 的白名单。
- 结果：pnpm typecheck 通过；比赛相关与 real-info、控制台测试 22 个文件 248 条通过（修之前 11 条失败）。
- 下一步：提交变基后的修复，再做 16:59 的计分规则（重要程度×核心度、低年级系数、模拟、防刷）和 16:57 的首屏。

## 19:05:01 +08:00 · 方案 · #278 · 计分改两档评定、官网首屏一屏讲清楚

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：按所有者 16:59（[已脱敏]）与 16:57（[已脱敏]）定方案：基础分 = 重要程度（一般/重要/关键）× 核心度（边缘/业务/核心）查表，Issue 5–30、MR 15–100，落在原 CHECK 内不重建表；规则只放 app/server/src/lib/competition-rubric.ts（不导入任何模块），服务端登记、试算接口、候选确认、公开 scoring 与模拟脚本都读它；GitLab 用「重要程度::」「核心度::」标签，三个标签都由非作者的评审人最后加上才自动计分；防刷每人每周「一般 × 边缘」只算 1 条；scripts/contest-score-sim.mjs 固定种子模拟 60 人比赛选系数。官网首屏左边标题、怎么拿分三步、倒计时与报名，右边奖金卡与天梯前五（手机前三），几层光、逐字标题、随指针倾斜、滚动驱动，减少动态效果停在最终状态。
- 结果：方案定稿：默认系数 3.5/2.2/1.4/1.0，防刷每周 1 条
- 下一步：实现服务端、控制台、门户、官网，跑模拟、迁移演练和浏览器验收

## 19:20:24 +08:00 · 开发 · #278 · 两档计分、年级系数模拟与防刷，官网首屏一屏讲清楚

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：服务端：规则只放 competition-rubric.ts（Issue 5–30、MR 15–100、扣分 -50），积分记录存两档、防刷折扣与贡献时间的快照，新增 score-preview 试算接口，候选按 GitLab「重要程度::」「核心度::」标签自动计分，防刷每人每周（北京时间）「一般 × 边缘」只算 1 条、之后记 0 分；scripts/contest-score-sim.mjs 固定种子 278 跑 5000 场 60 人比赛，选出默认系数 3.5/2.2/1.4/1.0。迁移在预发布库副本上演练两遍：14 列变 21 列，0 行与 3 条虚构记录（合计 20）两种情况各跑两次，结果一致、integrity ok，副本已删。控制台：ScoreLevels 两个下拉框选完即试算，积分登记与候选确认共用，规则页只读两档表。门户：比赛详情与天梯讲两档表与防刷。官网：首屏写清第一届内部赛、三步怎么拿分、奖金 700/140/70 与兑奖码、实时天梯、倒计时和报名；计分段两张热力表、年级系数柱、「算一算」；接口没回来先用 FALLBACK，测试核对它和服务端一致；措辞统一为「组织者」。
- 结果：模拟：大一占前 8 名 26.2%，大一拿第一 18.1%、进前 3 52.4%、进前 8 92.1%；同等质量下大一所需投入是大四的 0.40 倍；刷分的人进前 8 为 0%（没有防刷时 89.8%），核心贡献者进前 8 为 94.5%，正常得分被防刷误伤 2.2%。pnpm typecheck 通过，pnpm test 123 个文件 1923 条通过；check:runtime、site-config、environments、boundaries、docs、doc-sync、notes、secrets、catalog 通过，check-architecture（base 4c7c5dd5）111 个变更文件 233 个节点。ego 本机 nginx（带 CSP）：1440×900 首屏各块底边 ≤728、390×844 ≤816，横向溢出 0，没有 emoji，减少动态效果 0 个动画在跑，指针移动 3 秒 240 帧，首屏 JS 18.44KB gzip；控制台试算写出「基础分 45 × 大一 3.5 = 158 分。」。最后几轮截图因浏览器窗口被最小化没拍到，截图停在 v4（措辞改成组织者之前）。
- 下一步：提交记录，收 ego TaskSpace 与本机服务，回报 team-lead

## 19:20:30 +08:00 · 提交 · #278 · 两档计分与首屏分四个提交

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：b1cc096d feat(server) 两档计分、年级系数、每周防刷、试算接口、模拟脚本与服务端文档；491a09a9 feat(console) 两档下拉框与试算、规则页只读表；70f4b378 feat(portal) 官网首屏、计分段、SDK 与门户文案；fcbb36ef docs(architecture) 目录、ownership 与 changes/278.json。每个提交只加指定文件，没有推送。
- 结果：四个提交落在 task/278/contest_site，pnpm catalog:generate 后 check:catalog 通过；工作区只剩这两条记录
- 下一步：提交记录，交主会话审查与预览环境验收

## 19:42:55 +08:00 · 返工 · #278 · 门户比赛窗口的官网入口与详情头图改成浅色

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：按 team-lead 转达（所有者 16:38、16:57 要求[已脱敏]）：新增 ContestBackdrop（ContestGlow 柔光与流动透视网格、HeatMark 热力图字标），官网入口横幅和详情头图换成和官网首屏同一套色板与元素；字形与配色挪到 app/web/shared/lib/heatmark.ts，官网 title.ts 改为导入，样子不变；夜空 NightSky 删除，原文件、旧 ContestSite 与旧 competitions.css 按 4c7c5dd5 逐字节归档到 docs/history/portal-contest-night/ 并写 README；portal.md、web README、DESIGN.md、ownership、changes/278.json 跟着改。中途发现减少动态效果的规则写在格子入场动画前面压不住（152 个格子还在等延迟），挪到后面后为 0。
- 结果：pnpm typecheck 通过，pnpm test 123 个文件 1923 条通过，check:catalog、check:docs、check-architecture（base 4c7c5dd5，124 个变更文件 234 个节点）等通过。ego 本机：1440×900 横幅 1066×100、头图 706×237，390×844 横幅 344×171、头图 344×276，横向溢出 0、没有 emoji；截图像素测渐变字对比度 4.99–6.44，导语 8.95；减少动态效果 0 个动画在跑。帧率因浏览器窗口不在前台（hasFocus=false）测出 8–162 帧/2 秒不稳定，不作结论。截图 /tmp/geek-takeover/c278/shots/v6-portal-1440-banner.png、v6-portal-1440-hero.png、v6-portal-390-banner.png、v6-portal-390-hero.png，官网 v5-site-1440-hero.png、v5-site-390-hero.png。
- 下一步：提交记录，收 ego TaskSpace 与本机服务，回报 team-lead

## 19:42:55 +08:00 · 提交 · #278 · 门户浅色入口与头图一个提交

- 执行者：agent-claude-geek-main-3c2a7a67-c278（Claude Code 子 agent，claude-opus-5-5）
- 做了什么：2a167458 feat(portal) 比赛窗口的官网入口与详情头图改成和官网同一套浅色（代码、共享字形、测试、文档、归档、目录与 changes/278.json 在同一个提交里，目录已重新生成）。只加指定文件，没有推送。
- 结果：提交落在 task/278/contest_site；工作区只剩这两条记录
- 下一步：交主会话审查与预览环境验收

## 20:43:18 +08:00 · 提交 · #278 · rebase 到合并了 #277 的 stage 93322115

- 执行者：agent-claude-geek-main-3c2a7a67（Claude Code 主会话，claude-opus-5-5）
- 做了什么：task/278/contest_site 从 4c7c5dd5 rebase 到 93322115（#277 合并）。冲突只在文档与生成的目录：docs/architecture/API.md 两节都保留（#278 的比赛小节在前、#277 的命令行令牌一节在后），server README 的 portal 路由行合并两边的说明，web README 的 nginx 一行按分句合并 #277 的 /cli/ 与 #278 的 /c/、/sdk/、21m 上传；目录文件在 6 个冲突提交上用 pnpm catalog:generate 重新生成。rebase 前的头留在本机 refs/backup/task278-pre-rebase。
- 结果：rebase 前后差异的文件清单与 4c7c5dd5..93322115 完全一致（70 个文件）；在 d456805d 上 vitest 125 文件 1944 条、typecheck、check-architecture --base 93322115（124 文件 234 节点）、check-doc-sync、check:catalog/secrets/notes/docs/runtime/site-config/environments/boundaries/cli 全部通过。迁移在 20:31 新取的预发布库复制品上连跑两次，第二次表结构、行数、内容都没有变化。
- 下一步：推送，开 MR，写审查结论。

## 20:48:09 +08:00 · PR · #278 · 开 MR !12：task/278/contest_site → stage

- 执行者：agent-claude-geek-main-3c2a7a67（Claude Code 主会话，claude-opus-5-5）
- 做了什么：在 git.yangtzeu.work 的 geek/admin 开 MR !12（https://git.yangtzeu.work/geek/admin/-/merge_requests/12），源分支 task/278/contest_site 头 4087d677，目标 stage 93322115，merge commit、合并后删源分支。正文按 PULL-REQUESTS 九节写：目的引所有者原话与 13:45、16:38、16:57、16:59 四次补充，Closes #278，变更范围，宏观对齐，解决链路（年级系数改成 3.5/2.2/1.4/1.0 的依据），验证命令与结果，迁移演练两次的逐表行数，18 张截图，人工验收步骤，审查结论，风险与回滚。标签 P1、enhancement、func:api、func:data、func:external、portal、ui:layout、ui:visual。
- 结果：MR !12 已开，GitLab 返回 sha 4087d677
- 下一步：写审查记录、推送后合并

## 20:48:09 +08:00 · 审查 · #278 · 审查 #278：通过

- 执行者：agent-claude-geek-main-3c2a7a67（Claude Code 主会话，claude-opus-5-5）
- 做了什么：主会话按 .agents/skills/code-review 两条线逐项核对 93322115..4087d677，没有另开子 agent；作者是子 agent c278，rebase 是审查人自己做的，属于作者自审。规范：检查全过、没有新依赖；400bf7b0、b02889cd 的 docs(architecture) 不在 COMMITS 词表里，已推送并被记录引用，不改写；公开接口只给用户名、昵称、头像，兑奖查找不读真实姓名，real-info 白名单没放宽；兑奖码只存散列、密文和末四位；/c/<slug>/ 每个响应带 sandbox CSP 并去掉 Set-Cookie；标签加分前核对加标签的人有 competition.score.review 且不是作者。需求：期望结果 1–4、四类测试都在；视觉语言按 16:38、16:57 改成浅色；改分按 16:59 改成两档；接口路径和正文写法不同、功能一致（publish 带 version_id、回滚即发布旧版、accept）。结论写进 MR !12 的「审查结论」。
- 结果：通过。未验证：预发布上的验收条件 1、2、4（要 rc.20，官网包由所有者上传发布），真实 GitLab 收集一轮，真实兑奖核销，大于 6MB 的站点包经宿主上传
- 下一步：推送记录，合并 MR !12，关 #278
