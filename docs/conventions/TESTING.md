# 测试与验收规范

> 核心真实路由与上游论坛演示分别验收；类型、行为、构建和生产证据不相互替代。

状态：`current` · 更新：2026-10-30

## 根入口和分工

`pnpm check/test/build` 验证核心 `app/web` + `app/server` + `app/console`（控制台单测在 `tests/console/`，类型检查用 vue-tsc）；`pnpm forum:check` 验证 `app/forum` 的 Nuxt 类型、测试类型、ESLint、样式规则和单测；`pnpm forum:generate` 生成静态产物。根 `pnpm verify` 顺序编排两者，任一步失败应非零退出。

浏览器分别执行 `pnpm test:e2e`（同时起官网 5179 与控制台 5189 两个 dev server，控制台用样板数据与 `__persona`）和 `pnpm forum:verify`。后者保留上游样式 guard 自测、四套 CDP 行为测试和全路由 smoke，并验证图标真正渲染。未找到浏览器不能算套件通过。工具版本分别固定，不能让 Node 26 测试复用核心 SQLite 的 Node 22 二进制。

## 本机开发

改了代码想在本机看效果，用根目录三条命令（只用回环地址，不连 preview 或 production，不碰 Docker，不动共享浏览器配置）：

```bash
pnpm install        # 根目录，Node 22（根 package.json 的 engines）
pnpm local:up       # 起核心 API、官网、控制台；论坛工具链就绪时一并起来
pnpm local:status   # 每个服务的 HTTP 状态，以及是不是本命令启动的
pnpm local:down     # 只停本命令启动的进程
```

- 地址：官网 `http://127.0.0.1:5173/sites/portal/`，控制台 `http://127.0.0.1:5186/console`，核心 `http://127.0.0.1:3000/healthz`，论坛 `http://127.0.0.1:3456/`。
- `up` 每次先重建 `app/server/dist`；已经在跑的核心不会热替换，改了服务端代码要先 `pnpm local:down` 再 `pnpm local:up`。
- 本机会话与加密密钥首次 `up` 生成到 `.tools/local/secrets.json`（0600，不入库），之后复用，不写进 `deploy/env/.env.dev`。
- 不设 `OAUTH_CLIENT_ID` 与 `OAUTH_CLIENT_SECRET` 就是隔离模式（内存库，GitHub 登录返回 503）；两项都在启动命令的环境里给出，才走真实 GitHub 登录，数据留在 `.tools/local-preview/`，细节见 [LOCAL-PREVIEW](../ops/LOCAL-PREVIEW.md)。
- 论坛需要 Node ≥26 与 pnpm 11.24.0（[TUFF-FORUM](../ops/TUFF-FORUM.md)），依赖用 `pnpm forum:install` 装过。缺任一项时 `up` 只把论坛标为跳过并写明原因，其它服务照起。
- 端口被别的进程占着时，`up` 拒绝启动该服务并列出占用者，不停它，也不按端口杀进程；`down` 只停记在 `.tools/local/stack.json` 里的进程。
- 日志：控制台 `.tools/local/console.log`，核心与官网 `.tools/local-preview/preview.log`，论坛 `.tools/tuff-forum/dev.log`，本命令自己的记录 `.tools/local/stack.log`。

## 隔离

核心使用 `buildApp`/`inject` 注册真实路由，仅 `DB_PATH` 指向内存库，外部 HTTP 和 GitHub 默认拒绝，需响应的用例明确注入模拟；发信商（阿里云、Resend）的请求同样默认拒绝（`tests/server/helpers.ts` 的 `mailFetch`），不发真实邮件。不能复制 handler 验证另一份实现，不读取 `.env` 或业务数据库，不发送真实邀请。

论坛上游测试操作确定性种子和浏览器 localStorage。每次 CDP 使用自己创建的临时 profile，不打开用户已有浏览器配置，不清理用户示例数据。只关闭本次创建的进程组，禁止广泛 pkill。其登录/权限测试证明演示交互，不证明真实身份或服务器授权。`forum:verify` 只对示例种子运行；3456 上若是快照模式或 site 模式（极客班论坛）预览，先 `forum:stop`。快照解析规则用虚构夹具单测（`app/forum/tests/local-snapshot.test.ts`），不读取真实投影。


安全防护（#333）：`tests/server/security-decoy.test.ts` 使用真实路由、内存及临时文件SQLite，覆盖生产身份（不依赖NODE_ENV）、权限/step-up/Origin、1–60分钟边界、未知字段拒绝、精确到期与重启不续期、坏值关闭、开关和命中审计失败回滚、GET/HEAD有界合成响应、已有封禁优先、授权出口和跨站诱导豁免及审计隐私。`abuse-notice.test.ts` 保留单层编码规整/双编码不误判，`abuse-shield.test.ts` 验证解封事务及既有限额，`tests/console/nav.test.ts` 验证安全入口显式授权。真实本地管理页另验取消、开启、关闭、自然到期、解封、审计跳转及桌面/390px，不把样板只读或构建成功当作可写功能证明。
## 回归矩阵

CLI（`app/cli`）独立使用 Cargo：根 `pnpm cli:build`/`pnpm cli:test` 固定 locked 与 jobs=2，
`pnpm check:cli` 保留 fmt/Clippy/全量测试门禁。环境变量单测通过测试二进制的独立子进程执行，
每例清空继承环境、隔离 HOME、禁用钥匙串，避免并行修改 `GEEK_TOKEN`/`GEEK_NO_KEYRING` 相互影响。
`app/cli/tests/skill_install.rs` 通过真实 CLI 核对发现目录、profile、显式覆盖、符号链接、
并发与 JSON 退出码；`offline_credentials.rs` 核对无令牌和网络失败；
`device_protocol.rs` 使用合成 loopback HTTP 验证 pending/denied/expired、资料、撤销后401和非TTY验证码，
需要允许绑定 loopback，权限不足必须记失败，不能跳过或算通过。
`tests/tooling/cli-distribution.test.ts` 验证 Cargo 产物路径及安装脚本的校验和、真实本机二进制安装与执行失败；
下载边界使用合成 curl 响应，不声称真实站点分发或跨平台构建通过。
OMP 原生 `read skill://geek` 另用隔离 HOME、仓库外 cwd 验收，不运行模型、也不改用户 global profile。

CDN 迁移（#295）：`tests/tooling/static-cdn{,-s3,-http,-manifest}.test.ts` 在 CLI、S3 HTTP adapter 和清单 seam 覆盖 SigV4、内容地址、已存在逐字比较与冲突拒绝、同 adapter 同键串行、PUT 丢响应先 GET 对账、429/5xx 有界重试、响应头/体超时和长度上限、恶意路径/符号链接、凭据目的地限制与拒绝重定向；匿名 HEAD、完整 GET SHA-256、Range 字节、MIME、CORS 和公开缓存逐项核对，不信 ETag。发布清单必须与全部已验证资源一致；旧清单不能主动覆盖；CLI 生成私有 `0600` 内容索引但不公开，恢复命令按清单重验，缺对象失败。假存储故意允许服务端覆盖，不伪造 Garage 条件写入保障。受限运行器不能 bind 时使用 Node 原生 HTTP parser 与进程内 Duplex；`CDN_TEST_TCP=1` 在允许绑定的环境复跑真实回环 TCP。两者都不证明公网 TLS、供应商权限或恶意并发隔离。开关、工作流、表情三边一致性、邮件模板与宣传片消费者各有定向回归；真实迁移、HLS 全链、桶权限、备份恢复和两环境浏览器由父级验收，详见 [CDN 合同](../ops/CDN.md)。

项目目录（#257）：`tests/server/catalog.test.ts` 观测真实应用的根路由、循环注册和头像子插件，核对启用观测后健康、公开文档与未登录拒绝路径不变；`tests/tooling/project-catalog.test.ts` 从真实应用和内存 SQLite 提取结构，覆盖全部注册项、最终 Schema、自动 HEAD、物理外键和部分索引、能力蕴含、业务声明、Nitro 静态声明、来源摘要确定性、环境变量隔离、重复与悬空引用失败，以及入库目录过期。生成器不监听、不读 `.env`/业务库/私有快照，不发外部请求，不执行被链接的业务测试；`pnpm check:catalog` 独立核对生成物，`pnpm typecheck:catalog` 核对工具类型（也在根 typecheck 中）。目录通过不等于权限、业务或线上验收通过，维护规则见[项目目录](../architecture/catalog/README.md)。

比赛信息发布（#238）：`tests/server/competitions.test.ts`、`tests/console/competitions.test.ts`、`tests/web/portal-competitions.test.tsx` 覆盖五个比赛路由及三条受能力枚举影响的权限配置路由的响应 Schema 挂载、权限包 DTO 完整性和显式授予后生效、审计失败时增改删事务回滚、鉴权、字段与日期范围、可解析 HTTPS、空响应与损坏响应、五种状态、跨结束时刻重排、样板时钟及北京时间截止日末。`tests/e2e/competitions.spec.mts` 在 CI 的 1440×900 / 390×844 浏览器里通过真实 Fastify 路由和内存库验证 URL 失败留在表单、仅改说明不重写精确时分、刷新以及下线/恢复后的公开可见性；只模拟外部 GitHub。它不验证真实 OAuth，不访问本机验收实例；本机用 ego-browser 另做真实 HTTP 与截图验收。

投递取消（#204）：`tests/console/applications.test.ts` 与 `mock-sync.test.ts` 核对五状态、取消提示与不带邮件的 PATCH；`tests/server/mail-outbox.test.ts` 用真实路由与假的发信商覆盖从四种状态取消、强带通知及信件内容仍不写信、保留简历与历史、补备注/恢复、版本冲突；`tests/server/console.test.ts` 核对取消的权限/Origin、列表/搜索/分页/全局计数、概览、目录与 CSV；`legacy-database.test.ts` 在虚构文件库重启两次核对取消状态和完整历史不被迁移覆盖。`tests/e2e/application-cancelled.spec.mts` 将浏览器业务请求交给真实 Fastify 路由和内存库，仅外部身份/发信商使用假响应，覆盖 1440px / 390px 键盘选择、保存、刷新、审核、筛选/导出链接与旧画面冲突。不访问用户验收实例、不发真实邮件，截图不代替预发布上的人工验收。

核心：实例隔离、不打开旧论坛库、真实文档非空、内部文档不公开、保留 GitHub OAuth 和组织权限、篡改状态拒绝、登录门槛（`tests/server/core.test.ts`：成员查询按 `CONSOLE_ORG` 查登录者自己，成员回到发起登录的页面；不是成员、邀请未接受不建会话并审计 `auth.signin_denied`；失败一律 302 到 `/signin?signin=<原因>&return_to=<原路径>`（GitHub 连不上、成员查询 403 是 `failed`，取消授权是 `cancelled`，账号停用是 `account_disabled`；`tests/server/identity.test.ts` 核对回跳地址）；没有有效 state 的错误回调就地 400）、退出清会话、邀请并发和不确定结果、旧 API 返回 410、生产缺少论坛服务失败关闭。论坛接口（`tests/server/forum.test.ts`，内容用 `tests/server/fixtures/forum-content/` 夹具，不读真实论坛内容；只有一条用例核对镜像带的两份公开文件能被读出）：每个端点的正常路径与 401/403/400/404，游客回复带与不带 PoW、蜜罐、按 IP 限流（IPv6 按 /64）与全站游客回复上限，游客与成员昵称的允许清单（前几轮审查的全部探针都要 400）和归一后重名，`TRUST_PROXY=2` 时客户端轮换自己的 `X-Forwarded-For` 仍被限流（`true` 时能绕过，作对照），被移出组织的会话按游客处理，GitHub 拒绝会话里的令牌时会话被删、`sid` 被清、回 401 `session_expired`，之后同一个 `sid` 按游客读（#164；控制台接口与 `/auth/me` 的同一情况在 `tests/server/console.test.ts`，并发的两个请求一起碰到时只审计一次也在这里；`tests/server/invitations.test.ts` 里邀请链接发起人的令牌被拒那条是防回归的哨兵：邀请接口不加载会话、自己接住上游错误，现在它两边都会通过，以后有人让它加载会话又把错误往外抛时才会失败），`state` 与浏览接口的按 IP 限流，已关闭话题只有版务能回，社区部舰员与普通成员的版务差别与审计，账号资料的长度与网址规则，头像上传（sharp 生成的真实 PNG、解压炸弹与 4096×4096 像素上限、超大、非图片、读请求体之前核对登录与次数）与按哈希提供，播种幂等，通知、收藏与通知设置只下发给本人，一帖 @提及最多通知 10 人，`/auth/me` 的 `console_link`；写接口只回改动的记录（#145），每一种写入的真实回答原样经论坛前端的 `parseWriteResult`（`app/forum/shared/forum-api.ts`）读出、一个字段不丢，成员的回答都带本人的用户记录；`/state` 的帖子只有字段加服务端截好的一行摘要 `excerpt`，没有正文，一条话题的帖子按话题取（`GET /api/forum/topics/:topic_id/posts`，游客也能取、不存在的话题 404、按 IP 限流），搜索在服务端按话题标题、帖子正文、用户名与昵称匹配（`GET /api/forum/search`：`%` 是字面量、超长的词 400、空词回空结果、删掉的帖子不参与、游客看到的不比 `/state` 多、按 IP 限流），不改正文的写入（点赞、书签、置顶、改资料）回答里不带正文、改正文的写入（发帖、回复、编辑、删除）带（#156）。

发信（#148，覆盖范围逐条写在 [mail](../services/server/mail.md)「验证」）：`tests/server/mail-outbox.test.ts` 用真实路由和假的发信商核对队列、同一事件只发一封、白名单、每份投递都发「已收到」、发信队列按收件箱、来源和全站的上限、阿里云失败换 Resend、重试与放弃、租约、最终状态清掉地址和正文、控制台改状态发信（五种投递状态、四种信件，取消不生成邮件；`letter_required`、页面过时或改走又改回时回 409 `status_changed`（服务器时钟往回拨过也一样）、旧页面不带页面状态时拒绝改状态）、「已收到」按收件箱归并（`+` 标签、Gmail 的点）和按 IP 限量（IPv6 按 /64）；`tests/server/mail-envelope.test.ts` 核对转义、链接白名单、按姓称呼、进程时区是 UTC 时仍写北京时间；旧的「评估中」启动时改回「已收到」在 `tests/server/legacy-database.test.ts`；控制台导出 CSV 的北京时间在 `tests/server/console.test.ts`；官网「加入我们」的邮箱正则和投递接口逐字一致在 `tests/web/portal-join.test.ts`。投递次数（同一个 IP 按 /64、同一个设备 cookie 各 24 小时 5 份，第 6 份 429 `apply_limited`，#169）在 `tests/server/applications.test.ts`。

路由级限流（#191）：`tests/server/rate-limits.test.ts` 对邀请链接、控制台导出 CSV 与指派、官网投递、意见箱各自连发到超额，核对第一次超额回 429 `{ error: "rate_limited", message: "操作太频繁，请稍后再试", request_id }` 且 `no-store`，额度内的请求照常（限流在鉴权和校验之前计数），换一个 IP 不受影响。论坛接口的限流在 `tests/server/forum.test.ts`。

论坛：种子确定性、store 状态、权限 helper、持久化解析、提及；桌面/移动 shell、主题筛选/排序/分页、回复/引用/编辑/软删/收藏/点赞、用户资料、通知与全路由图标。开发提醒不得遮挡主流程。

核心 UI：危险操作取消、焦点返回、移动导航、文档语言及入口；控制台按身份的导航可见性、缺能力说明、未登录跳转、成员按称号分页签排序、无原生下拉框/复选框、窄屏抽屉导航与无页面级横向溢出；门户论坛链接必须指向 `app/forum` 的新入口，不加载旧 React 论坛。工程检查要覆盖真实导入解析、别名、反向依赖（含 `app/console` 与 `app/web`、`app/server` 互不导入）、站点配置不含域名（`check-site-config`）、SPA 入口按路径选择（服务端 `resolveSiteEntry` 与 web 容器 nginx，`tests/tooling/web-nginx.test.ts` 在本机有 nginx 时实跑，管理端入口是控制台产物）、论坛路径的跳转（`tests/tooling/forum-redirects.test.ts` 在本机有 nginx 时把宿主、web、论坛三层配置一起实跑：`/forum` 只 308 到相对地址 `/forum/`，预渲染路由带不带结尾斜杠都是 200，任何 `Location` 都不带协议、主机和内部端口）、带哈希产物目录的缓存头（`tests/tooling/hashed-asset-cache.test.ts` 同样在本机有 nginx 时把三层一起实跑：`/assets/`、`/console-assets/`、`/forum/_nuxt/` 下的脚本、样式、字体、图片都缓存一年，安全头与页面相同，论坛的 `_nuxt/builds/latest.json` 不缓存）和文档同步。

移动 YUGC OS 与手机首页（#206，#275 改版）：#275 去掉三维书桌时删除了 `tests/e2e/portal-phone.spec.ts`，现在没有在真实浏览器里自动跑的手机首页用例；手机尺寸的浏览器自动化只剩 `tests/e2e/portal-competitions.spec.ts` 里 390×844 的比赛窗口（列表进详情再返回、操作条贴底、触控目标、没有横向滚动）。jsdom 里的覆盖：`tests/web/portal-phone.test.tsx` 覆盖手机壳层结构（状态栏、四项 Dock、按需打开的指引）、访客右上角只有头像且点开底部资料卡、`console_link` 权限过滤、单击直达（论坛当前页、代码仓库在应用里打开）、主屏下滑搜索、返回主屏幕保留应用状态和手机窗口的 Page Sheet；`tests/web/portal-desktop-skin.test.tsx` 覆盖「晴空」壁纸里极客娘在手机竖屏的位置、图标区间的测量，以及资料卡底部面板（左右等宽留边、去掉 dialog 自带的 max-width、安全区、面板内滚动）和可编辑字段对齐的样式规则；`tests/web/portal-boot-gate.test.tsx` 覆盖开机动画起步门的手机判断（宽度小于 768 或竖屏）、点按和长按都能起步、停在起步门时视口变了按新版本重建；`tests/web/portal-wallpapers.test.ts` 核对竖图尺寸与体积预算、同 id 按形态解析与只预取当前形态。这些都不量真实布局：留边、圆角、安全区和滚动的实际效果目前只靠在浏览器里人工截图核对。Chromium 设备模拟不代表 iPhone Safari 真机，真机证据另立记录。

控制台只读权限树（#176）：`tests/console/permission-tree.test.ts` 覆盖 `/me` 优先于来源、受限冲突、传递蕴含与环、多来源唯一节点、动态包与名称、归档/缺失部门、owner/guest 固定规则、领航员不派生普通舰员及未知 id。浏览器分别核对真实 `/console/people?view=permissions` 的前进后退、搜索与展开记忆、键盘、390px 详情焦点、普通成员页面门与 401 登录回跳，以及 catalogue/部门失败时旧树隐藏和刷新恢复。动态名称/权限包/归档用隔离内存服务的真实路由修改后重读；只注入虚构 GitHub 外部响应，不读取业务库、不发邮件，也不把该证据称为真实 OAuth 或预发布人工验收。

邀请页历史记录版式（#211）：`tests/e2e/workflows.spec.ts` 增加 `/console/github/invitations` 用例，在 1440/1280/1024×900 与 390×844 量真实 Chromium 渲染的几何：24 字符合成 token（与线上 `randomBytes(18)` 等长，取自 `/invitations` 样板）在本格内截断、不划穿「结果」列、悬停 `title` 带全值；`pending_admin` 显示「待核对」，结果徽章与北京时间各保单行；两张表行高一致；窄屏横向滚动关在 `.tx-data-table` 自己的容器里、页面无横向溢出。根修法是 `app/console/src/styles/layout.css`：`.ellipsis` 共用溢出和单行规则，`inline-block` + `vertical-align: bottom` + `max-width: 100%` 只补到 14 处普通行内 `span.ellipsis`；概览的 `dd` 保留块布局。抽查共用页面的窄屏边界，不固定 CSS display 或日期分隔符作为行为契约。

同一用例还在 390px 核对概览的 GitHub 组织名不会越过自身事实列：覆盖共用截断规则把原生块元素误改成按内容撑宽的行内块时，组织名压到相邻组织角色的回归。

测试报告（#248）：CI 的 `core` 用 `pnpm run test --coverage` 产出 Vitest v8 覆盖率（server、console、web），产物 `vitest-coverage`；`test-report.yml` 在 PR 上于托管 runner 跑 `pnpm test:e2e`，产物 `playwright-report`（HTML，含失败 trace）。两份保留 14 天，只作机器验证附件：没有覆盖率门槛，也不替代 PR 里的改前改后截图和人工验收。本机仍不跑 Playwright（见环境约定），要看报告去 CI 产物。`stage` 上的 e2e 此前不在 CI 里跑，#233 把手机窗口改成页面抽屉后 `.is-phone .pt-win` 的 `display:flex` 盖掉了 `[hidden]`，收起的窗口仍显示，用例红了没人发现，现已补 `.is-phone .pt-win[hidden]` 并让 e2e 进 PR 检查；托管 runner 比本机慢，超时用 `E2E_TIMEOUT_SCALE` 放大。

宏观对齐（#257）：`architecture-alignment.test.ts` 通过公开检查接口与真实临时 Git 提交覆盖八维缺项、假 UI 分类、未覆盖文件、过宽路径、未知目录节点、生成文档冒充业务文档、漏回归、隐藏正文引用，以及固定提交不受脏工作区干扰。`catalog-map.test.ts` 核对地图与目录同源、离线和脚本数据转义。真实浏览器另测搜索定位、节点与跨页钻取、PR 报告导入、窄屏导航和详情，不把静态检查当浏览器验收。

`catalog-coverage.test.ts` 核对全部业务操作及补充入口都有流程关联；删除真实接口的关联后生成必须失败。`pr-contract.test.ts` 拒绝阻塞审查、隐藏或重复标题、围栏/缩进代码中的伪结论；宏观检查共享同一正文解析，并拒绝用已删除流程证明当前源码。`catalog-map.spec.ts` 在 CI 真实 Chromium 中覆盖地图搜索、表关系、窄屏和影响报告的成功、过期摘要、未知节点及清除操作。

## 首场内部个人赛（GitHub #276）

[有限矩阵与命令](../services/server/competition-rehearsal.md)覆盖身份/资源/精确时间/状态/幂等/并发/外部故障。新增 `competition-readiness`、`competition-identity-boundaries` 与 `competition-rehearsal` 路由测试，复用真实buildApp、同库SQLite与GitLab HTTP Adapter；身份集成哨兵保留严格失败断言，不skip。`scripts/contest-rehearsal.mts --smoke`经真实OAuth路由走至报名、贡献、审核、定榜、兑奖核销与重启；`--serve`只绑定loopback给父级浏览器接力，生产应用不注册fixture入口。Node22用 `node --import ./app/server/node_modules/tsx/dist/loader.mjs scripts/contest-rehearsal.mts --smoke`避免tsx CLI额外IPC监听。Vitest workers≤2；监听EPERM与业务断言失败分开报告。既有固定种子评分模拟不能代替路由流程。

## 身份、公开资料与 GitLab 回归（GitHub #271）

`session-cleanup.test.ts` 经真实身份路由与主动清理 Interface 核对七天会话的精确边界：到期前 1ms 仍可访问，到期等值回 401；同一时刻的批量清理只删到期会话，较新会话仍可访问。保留原有启动/每小时清理、停机、错误隔离、WAL 与备份字节检查。

`identity-eligibility.test.ts`、`permission-expiry.test.ts`、`console-owner-eligibility.test.ts`、`oidc-eligibility.test.ts` 覆盖有效直接 member/alumni、active/owner、等值到期、继承与回拨缓存，以及两轮 sub/id 稳定。`public-profile-consumers.test.ts` 经真实 buildApp/inject 验证 canonical 资料与头像覆盖 forum/state/changes/搜索、设备令牌；另覆盖 canonical 昵称/头像为空时，同一 GitHub uid 改名换头像后无需再访问论坛，游客、登录用户、搜索和补全立即读取当前绑定，canonical 自定义值与无档案历史作者仍保持原优先级。不以 TCP 或浏览器作为这些断言的前提，不读取业务库。CLI `app/cli/tests/profile_consumers.rs` 是独立本地 TCP 模拟服务器集成测试，需要监听许可；`cargo test --bin geek` 可单独运行非网络单测，不能冒充前者。

`gitlab-sync.test.ts` 的 managed identity safety 场景覆盖缓存绑定失配、同 provider 绑定歧义、完整分页失败/跳页、HTTP 401/403/404/429/500/503、超时、管理员/bot/service/root、详情不完整/缺 sub、源资格不完整不影响其他账号、同邮箱不合并、远端漂移、两循环与资格恢复竞态、block 失败重试。`competition-candidates.test.ts` 通过真实 collect 路由验证失败保分、明确 remove 正常撤分、分页第二页失败/跳页/循环、较新坏事件不被跳过后误用旧 remove、失配作者/审核人不归属，以及审核人停用和等待期间撤权不加分。`forum.test.ts` 与 `forum-v2-endpoints.test.ts` 的名字场景显式设置 canonical 用户名，不把注册时的随机用户名等同 GitHub 登录名；旧非法昵称分别验证 canonical 与缺档案历史路径，头像精确核对统一地址与旧地址同字节兼容、清除后均不可再取。所有外部 HTTP 仅合成响应，Vitest 使用 `--maxWorkers=2`；真实 GitLab/OAuth、邮件及预发布不属于隔离测试证明范围。

## 分支、环境与发布门禁回归

`tests/tooling/deployment-environment.test.ts` 在临时目录合成夹具，验证 `.env.production` / `.env.preview` 的字段契约（非密值必须预填、契约外字段拒绝、密钥必须留空、`PUBLIC_ORIGIN` 逐字等于环境 origin、两环境端口与域名必须不同、`TRUST_PROXY` 等于宿主 nginx 与 web 容器 nginx 两层；发信：`MAIL_RECIPIENTS` 只能是 `all` 或 `allowlist`（两个环境模板现在都是 `all`，#169），发信密钥可以全部留空，阿里云两项只填一项拒绝，名单格式不对拒绝且报错不带名单内容，发不出信或带不了 Reply-To 的组合给提示）与 [deploy/environments.json](../../deploy/environments.json) 的一致性；它不读取真实密钥、不连接服务器。

正式产物授权提示（#336）：`tests/tooling/security-notice.test.ts` 分别使用官网和控制台实际安装的 Vite，在临时目录真实压缩构建，验证开发/预发布与无插件基线逐字节一致、生产内容哈希隔离及确定性、原生 Node 加载产物的导出与动态分块、页面正文和 CSP 内联脚本哈希不变、继承 production 变量的开发服务器仍不注入，以及实际入口注释丢失时发布检查器必须拒绝。`app/forum/tests/security-notice.test.ts` 独立使用 Nuxt 依赖的 Vite 8 验证原生压缩后的入口、执行结果和环境间哈希；不让根测试依赖论坛工具链。论坛另执行 `forum:check` 与两种发布身份的 site 静态生成；真实页面烟测使用本地隔离实例，不代表线上验收或模型拒答效果。

分支不变量由 `scripts/check-branch-invariants.mjs` 检查（`tests/tooling/branch-invariants.test.ts` 用临时 Git 仓库覆盖不变量、命名规则与 pre-push 的发布 tag 规则：格式错误、rc 不在 stage、正式 tag 不在 main、同提交缺 rc 只告警、版本号不符、删除或移动发布 tag、附注 tag、非发布 tag 只告警）：`--require-remote-refs` 在 CI 上核对真实远端 refs，`--push` 供本地 pre-push 使用；本地也可以用同一命令自查（见 [BRANCHING](BRANCHING.md)）。这类检查只读 Git 证据，不 fetch、不改 refs。

`tests/tooling/hotfix-sync.test.ts` 在双裸仓库与临时工作克隆里执行真实合并、推送和窗口关闭。提交身份只配置在该临时工作仓库，供被测脚本创建的 worktree 继承，不能依赖开发者的全局 Git 配置；隔离验证使用 `GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null pnpm exec vitest run tests/tooling/hotfix-sync.test.ts`，仍核对冲突不写、保留钩子/已有分支、stage 未发布功能不进入 main 和重复执行幂等。

`tests/tooling/task-worktree.test.ts` 在临时 Git 仓库里建 worktree、把 `gh` 换成假的，覆盖推送前的 worktree 检查：PR 已合并或 issue 已放弃、没 finish 的 worktree 让 `task.mjs list --check` 与 `.githooks/pre-push` 失败，清理后放行，查不到 GitHub 只警告，gh 偶发失败一次会重试，主工作区停在已合并的 task 分支上时提示切回而不是 finish。

`tests/tooling/issue-labels.test.ts` 覆盖 issue / PR 的改动类型标签（[ISSUES](ISSUES.md) §2）：三组十一类与标签定义；表单下拉转标签；`checkIssue` 对 `ui:*` 缺截图、`func:*` 缺涉及接口、没有「组:类」标签、编号 235 之前的旧 issue 放行；`checkPullRequest` 在关联 issue 带标签时核对 PR 标签覆盖、`ui:*` 不认「无界面变化」、`func:*` 要测试命令加方法路径加状态码或 `requestId`（或有理由的「无接口变更」）；`findSimilar` 找相似 issue、`suggestLabels` 按关键词推测、提单检查评论的内容。`tests/tooling/task-worktree.test.ts` 里的 `startGate` 用例覆盖 `task.mjs start` 对不合格 issue 的拒绝与读不到时的放行。全部用虚构的标题和正文，不连 GitHub、不运行 `--apply`；`issue-gate` 的评论更新和打标签要等工作流进入 `main` 后在真实仓库验证。

`tests/tooling/issue-sweep.test.ts` 用虚构的 issue 与 PR 覆盖每天的 issue 巡检（[TRACKING](TRACKING.md) §1）：PR 已合并还开着的补关（head 是 task 分支或正文有关闭关键字，合进 `main` 的和只写 `Refs` 的不算；最近一次合并之后重开过的（按时间线上的重开时间，两次合并夹着一次重开时看最近那次合并；查不到重开时间就不关，超期记录写明是查不到）、合并后有过「关闭」记录又开着的、还有开着的 PR 关联的、PR 合并不到一小时的都不关，超期记录写明已合并的 PR 和没补关的原因），14 天没动静的留「超期」，关了却没有合并 PR 也没有「关闭」记录的留「缺记录」且只留一次，记录格式与 TRACKING 的类型表一致；命令行换成假 `gh`（只认带 `REOPENED_EVENT` 与 `last: 1` 的重开查询），核对 GraphQL 出错时不补关，不带 `--apply` 不写、带了才关闭和留言、一个失败不影响其它但以 1 退出，评论到 100 条时翻页取全。

`tests/tooling/doc-sync.test.ts` 在临时 Git 仓库里覆盖文档同步（规则见 [docs/README](../README.md)「文档跟着模块改」）：非 task 分支上按第一父链的时间比，模块比文档新就失败并写出那一对和那个提交，文档随后更新即通过，同一提交两边都改通过，PR 以 merge commit 进来时里面返工提交的先后不影响，rebase 那样的直线历史里模块在后就失败，检出发布 tag（detached HEAD，没有分支名）时同样按第一父链的时间比，同一提交上另有 task 分支也不按 PR 核对；task 分支上自动对 `stage` 按 PR 核对，先改文档后返工代码通过，只改模块失败（比的是 merge-base，`stage` 后来改了文档也不算），`stage` 本来不同步时写明不是这条分支造成的；文档核对：这个 task 的执行记录里写了就通过，别的 task 的记录、路径不对、没写理由、照抄模板里的 `<理由>`、理由只有标点或零宽字符的不算，文档只改了「更新：」日期、空白或空行不算改了说明，写了文档核对「更新：」也要跟上，`stage` 上合并提交带来的文档核对算同步；头部「更新：」按作者时间的北京日期比，零点前写、零点后合并不算过期；没提交、没跟踪的新文件算作现在，被忽略的目录不算服务；浅克隆直接报错。

`tests/tooling/deploy-doc-sync.test.ts` 覆盖发版前的文档同步（#192，[CICD](../ops/CICD.md)）：两条部署工作流的 plan job 都有「文档同步（发布 tag 指向的提交）」，排在完整历史的 tag 检出与 Node 安装之后，没有 `if`、`continue-on-error`、`|| true`，plan job 不装依赖（`check-doc-sync.mjs` 与 `note.mjs` 只导入 Node 内置模块），其它 job 都 `needs: plan` 且不带 `always()` 这类条件，两条工作流的这一步逐字相同；再在临时仓库里照工作流的写法用 bash 跑这一步：检出不同步的 rc tag 失败并报出那一对和那个提交，同步的通过，HEAD 不是 tag 指向的提交、浅克隆都失败。删掉这一步、加上吞掉失败的写法或让 build 不依赖 plan，测试都会失败。

`tests/tooling/release-policy.test.ts` 在临时 Git 仓库里覆盖 tag 模型：tag 正则与 RELEASES.md 逐字一致；`vX.Y.Z-rc.N` → preview、`vX.Y.Z` → production；拒绝分支名、`latest`、短 SHA 与格式错误的 tag；拒绝不在 `stage` 上的 rc、不在 `main` 上的正式 tag、同一提交没有同版本 rc 的正式 tag、版本与该提交 `package.json` 不符、已正式发布的版本再打 rc、本地 tag 指向别的提交；拒绝已退役的 `--branch`/版本/批准开关；以及「规划只读」（不写文件、不改 refs、不动工作区）。论坛的 `app/forum/tests/deployment.test.ts` 覆盖展示值：预发布只接受 `X.Y.Z-rc.N@<sha12>`，正式只接受 `X.Y.Z`。`scripts/release-bundle.mjs` 与 `tests/tooling/release-bundle.test.ts` 已随发布包模型一起删除。任何规划输出都**不授予**部署批准（`deploymentAuthorized: false`），自动测试也不替代人工试用。

`tests/tooling/cli-release-wiring.test.ts` 通过真实 `scripts/cli-dist.mjs` 命令和合成 cargo adapter 连续构建同一 CLI 版本：五目标内容变化时五个摘要 URL 全部变化、旧字节仍存在，相同内容重建 URL 稳定，已存在的摘要路径字节不符时拒绝覆盖；`check-cli-dist.mjs` 必须核对五目标、内容寻址文件名及 manifest/sidecar/实际字节三方 sha256。Shell 安装器在隔离 `HOME` 中实际下载、校验、试运行后替换，覆盖新版和旧 manifest、路径逃逸、任意 URL、错误目标、摘要不一致、下载字节不符与不可执行失败；PowerShell 安装器使用同一 manifest 选择契约，测试机有 `pwsh` 时实际运行恶意 manifest 拒绝用例，没有 `pwsh` 必须报告跳过，不能把源码字符串断言写成 PowerShell 已验证。

授权数据拉取后使用 `scripts/forum-migration/verify.py` 逐文件核对哈希，并将冻结的 SQLite 在线备份恢复到内存核对所有表/条数。它是这次数据交付的单独核验，不是让常规 CI 使用真实用户数据。未来 capture/verify 工具单测只能使用虚构临时文件。

## 退役与报告

旧论坛专属测试随源码归档，不在新工程假运行，也不混入新结果。保留的核心邀请和 OAuth 行为必须在新 fixture 下重验。报告分别记录核心测试、原仓测试、浏览器场景、构建以及未执行项；不能用此前 48 项结果替代新架构证据。

验收中修改源码后重跑相关验证；mock 界面、静态生成、真实后端及生产验收是不同层次。统一认证、后端持久化或上线未实施时必须明确记录，禁止写“全线生产迁移已完成”。
