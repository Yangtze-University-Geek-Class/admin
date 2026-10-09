# 测试与验收规范

> 核心真实路由与上游论坛演示分别验收；类型、行为、构建和生产证据不相互替代。

状态：`current` · 更新：2026-10-09

## 根入口和分工

`pnpm check/test/build` 验证核心 `app/web` + `app/server` + `app/console`（控制台单测在 `tests/console/`，类型检查用 vue-tsc）；`pnpm forum:check` 验证 `app/forum` 的 Nuxt 类型、测试类型、ESLint、样式规则和单测；`pnpm forum:generate` 生成静态产物。根 `pnpm verify` 顺序编排两者，任一步失败应非零退出。

浏览器分别执行 `pnpm test:e2e`（同时起官网 5179 与控制台 5189 两个 dev server，控制台用样板数据与 `__persona`）和 `pnpm forum:verify`。后者保留上游样式 guard 自测、四套 CDP 行为测试和全路由 smoke，并验证图标真正渲染。未找到浏览器不能算套件通过。工具版本分别固定，不能让 Node 26 测试复用核心 SQLite 的 Node 22 二进制。

## 隔离

核心使用 `buildApp`/`inject` 注册真实路由，仅 `DB_PATH` 指向内存库，外部 HTTP 和 GitHub 默认拒绝，需响应的用例明确注入模拟；发信商（阿里云、Resend）的请求同样默认拒绝（`tests/server/helpers.ts` 的 `mailFetch`），不发真实邮件。不能复制 handler 验证另一份实现，不读取 `.env` 或业务数据库，不发送真实邀请。

论坛上游测试操作确定性种子和浏览器 localStorage。每次 CDP 使用自己创建的临时 profile，不打开用户已有浏览器配置，不清理用户示例数据。只关闭本次创建的进程组，禁止广泛 pkill。其登录/权限测试证明演示交互，不证明真实身份或服务器授权。`forum:verify` 只对示例种子运行；3456 上若是快照模式或 site 模式（极客班论坛）预览，先 `forum:stop`。快照解析规则用虚构夹具单测（`app/forum/tests/local-snapshot.test.ts`），不读取真实投影。

## 回归矩阵

投递取消（#204）：`tests/console/applications.test.ts` 与 `mock-sync.test.ts` 核对五状态、取消提示与不带邮件的 PATCH；`tests/server/mail-outbox.test.ts` 用真实路由与假的发信商覆盖从四种状态取消、强带通知及信件内容仍不写信、保留简历与历史、补备注/恢复、版本冲突；`tests/server/console.test.ts` 核对取消的权限/Origin、列表/搜索/分页/全局计数、概览、目录与 CSV；`legacy-database.test.ts` 在虚构文件库重启两次核对取消状态和完整历史不被迁移覆盖。`tests/e2e/application-cancelled.spec.mts` 将浏览器业务请求交给真实 Fastify 路由和内存库，仅外部身份/发信商使用假响应，覆盖 1440px / 390px 键盘选择、保存、刷新、审核、筛选/导出链接与旧画面冲突。不访问用户验收实例、不发真实邮件，截图不代替预发布所有者验收。

核心：实例隔离、不打开旧论坛库、真实文档非空、内部文档不公开、保留 GitHub OAuth 和组织权限、篡改状态拒绝、登录门槛（`tests/server/core.test.ts`：成员查询按 `CONSOLE_ORG` 查登录者自己，成员回到发起登录的页面；不是成员、邀请未接受不建会话并审计 `auth.signin_denied`；GitHub 连不上、成员查询 403 回 `?signin=failed`；取消授权回 `?signin=cancelled`；没有有效 state 的错误回调就地 400）、退出清会话、邀请并发和不确定结果、旧 API 返回 410、生产缺少论坛服务失败关闭。论坛接口（`tests/server/forum.test.ts`，内容用 `tests/server/fixtures/forum-content/` 夹具，不读真实论坛内容；只有一条用例核对镜像带的两份公开文件能被读出）：每个端点的正常路径与 401/403/400/404，游客回复带与不带 PoW、蜜罐、按 IP 限流（IPv6 按 /64）与全站游客回复上限，游客与成员昵称的允许清单（前几轮审查的全部探针都要 400）和归一后重名，`TRUST_PROXY=2` 时客户端轮换自己的 `X-Forwarded-For` 仍被限流（`true` 时能绕过，作对照），被移出组织的会话按游客处理，GitHub 拒绝会话里的令牌时会话被删、`sid` 被清、回 401 `session_expired`，之后同一个 `sid` 按游客读（#164；控制台接口与 `/auth/me` 的同一情况在 `tests/server/console.test.ts`，并发的两个请求一起碰到时只审计一次也在这里；`tests/server/invitations.test.ts` 里邀请链接发起人的令牌被拒那条是防回归的哨兵：邀请接口不加载会话、自己接住上游错误，现在它两边都会通过，以后有人让它加载会话又把错误往外抛时才会失败），`state` 与浏览接口的按 IP 限流，已关闭话题只有版务能回，社区部舰员与普通成员的版务差别与审计，账号资料的长度与网址规则，头像上传（sharp 生成的真实 PNG、解压炸弹与 4096×4096 像素上限、超大、非图片、读请求体之前核对登录与次数）与按哈希提供，播种幂等，通知、收藏与通知设置只下发给本人，一帖 @提及最多通知 10 人，`/auth/me` 的 `console_link`；写接口只回改动的记录（#145），每一种写入的真实回答原样经论坛前端的 `parseWriteResult`（`app/forum/shared/forum-api.ts`）读出、一个字段不丢，成员的回答都带本人的用户记录；`/state` 的帖子只有字段加服务端截好的一行摘要 `excerpt`，没有正文，一条话题的帖子按话题取（`GET /api/forum/topics/:topic_id/posts`，游客也能取、不存在的话题 404、按 IP 限流），搜索在服务端按话题标题、帖子正文、用户名与昵称匹配（`GET /api/forum/search`：`%` 是字面量、超长的词 400、空词回空结果、删掉的帖子不参与、游客看到的不比 `/state` 多、按 IP 限流），不改正文的写入（点赞、书签、置顶、改资料）回答里不带正文、改正文的写入（发帖、回复、编辑、删除）带（#156）。

发信（#148，覆盖范围逐条写在 [mail](../services/server/mail.md)「验证」）：`tests/server/mail-outbox.test.ts` 用真实路由和假的发信商核对队列、同一事件只发一封、白名单、每份投递都发「已收到」、发信队列按收件箱、来源和全站的上限、阿里云失败换 Resend、重试与放弃、租约、最终状态清掉地址和正文、控制台改状态发信（五种投递状态、四种信件，取消不生成邮件；`letter_required`、页面过时或改走又改回时回 409 `status_changed`（服务器时钟往回拨过也一样）、旧页面不带页面状态时拒绝改状态）、「已收到」按收件箱归并（`+` 标签、Gmail 的点）和按 IP 限量（IPv6 按 /64）；`tests/server/mail-envelope.test.ts` 核对转义、链接白名单、按姓称呼、进程时区是 UTC 时仍写北京时间；旧的「评估中」启动时改回「已收到」在 `tests/server/legacy-database.test.ts`；控制台导出 CSV 的北京时间在 `tests/server/console.test.ts`；官网「加入我们」的邮箱正则和投递接口逐字一致在 `tests/web/portal-join.test.ts`。投递次数（同一个 IP 按 /64、同一个设备 cookie 各 24 小时 5 份，第 6 份 429 `apply_limited`，#169）在 `tests/server/applications.test.ts`。

路由级限流（#191）：`tests/server/rate-limits.test.ts` 对邀请链接、控制台导出 CSV 与指派、官网投递、意见箱各自连发到超额，核对第一次超额回 429 `{ error: "rate_limited", message: "操作太频繁，请稍后再试", request_id }` 且 `no-store`，额度内的请求照常（限流在鉴权和校验之前计数），换一个 IP 不受影响。论坛接口的限流在 `tests/server/forum.test.ts`。

论坛：种子确定性、store 状态、权限 helper、持久化解析、提及；桌面/移动 shell、主题筛选/排序/分页、回复/引用/编辑/软删/收藏/点赞、用户资料、通知与全路由图标。开发提醒不得遮挡主流程。

核心 UI：危险操作取消、焦点返回、移动导航、文档语言及入口；控制台按身份的导航可见性、缺能力说明、未登录跳转、成员按称号分页签排序、无原生下拉框/复选框、窄屏抽屉导航与无页面级横向溢出；门户论坛链接必须指向 `app/forum` 的新入口，不加载旧 React 论坛。工程检查要覆盖真实导入解析、别名、反向依赖（含 `app/console` 与 `app/web`、`app/server` 互不导入）、站点配置不含域名（`check-site-config`）、SPA 入口按路径选择（服务端 `resolveSiteEntry` 与 web 容器 nginx，`tests/tooling/web-nginx.test.ts` 在本机有 nginx 时实跑，管理端入口是控制台产物）、论坛路径的跳转（`tests/tooling/forum-redirects.test.ts` 在本机有 nginx 时把宿主、web、论坛三层配置一起实跑：`/forum` 只 308 到相对地址 `/forum/`，预渲染路由带不带结尾斜杠都是 200，任何 `Location` 都不带协议、主机和内部端口）、带哈希产物目录的缓存头（`tests/tooling/hashed-asset-cache.test.ts` 同样在本机有 nginx 时把三层一起实跑：`/assets/`、`/console-assets/`、`/forum/_nuxt/` 下的脚本、样式、字体、图片都缓存一年，安全头与页面相同，论坛的 `_nuxt/builds/latest.json` 不缓存）和文档同步。

移动 YUGC OS 与手机首页（#206）：`tests/e2e/portal-phone.spec.ts` 在真实 Chromium 里覆盖 360×780、390×844、430×932 的整个模型取景与实际触点、显示屏与交接遮罩的四角几何圆角、两张独立竖图与 180×390 缩略图、主屏下滑搜索、旋转与横竖切换保留窗口内容、系统设置内换壁纸与回书桌、跳过开机首帧不透明与慢图解码等待、减少动态效果与无 WebGL 回退、模型下载失败释放场景、非零不对称安全区，以及 1440×900 电脑端不改版；`tests/web/portal-phone.test.tsx` 覆盖手机壳层结构、`console_link` 权限过滤、论坛/GitHub 一跳直达、隐藏面板不卸载与返回主屏幕；`tests/web/portal-wallpapers.test.ts` 核对竖图尺寸与体积预算、同 id 按形态解析与只预取当前形态。Chromium 设备模拟不代表 iPhone Safari 真机，真机证据另立记录。

控制台只读权限树（#176）：`tests/console/permission-tree.test.ts` 覆盖 `/me` 优先于来源、受限冲突、传递蕴含与环、多来源唯一节点、动态包与名称、归档/缺失部门、owner/guest 固定规则、领航员不派生普通舰员及未知 id。浏览器分别核对真实 `/console/people?view=permissions` 的前进后退、搜索与展开记忆、键盘、390px 详情焦点、普通成员页面门与 401 登录回跳，以及 catalogue/部门失败时旧树隐藏和刷新恢复。动态名称/权限包/归档用隔离内存服务的真实路由修改后重读；只注入虚构 GitHub 外部响应，不读取业务库、不发邮件，也不把该证据称为真实 OAuth 或预发布人工验收。

邀请页历史记录版式（#211）：`tests/e2e/workflows.spec.ts` 增加 `/console/github/invitations` 用例，在 1440/1280/1024×900 与 390×844 量真实 Chromium 渲染的几何：24 字符合成 token（与线上 `randomBytes(18)` 等长，取自 `/invitations` 样板）在本格内截断、不划穿「结果」列、悬停 `title` 带全值；`pending_admin` 显示「待核对」，结果徽章与北京时间各保单行；两张表行高一致；窄屏横向滚动关在 `.tx-data-table` 自己的容器里、页面无横向溢出。根修法是 `app/console/src/styles/layout.css`：`.ellipsis` 共用溢出和单行规则，`inline-block` + `vertical-align: bottom` + `max-width: 100%` 只补到 14 处普通行内 `span.ellipsis`；概览的 `dd` 保留块布局。抽查共用页面的窄屏边界，不固定 CSS display 或日期分隔符作为行为契约。

同一用例还在 390px 核对概览的 GitHub 组织名不会越过自身事实列：覆盖共用截断规则把原生块元素误改成按内容撑宽的行内块时，组织名压到相邻组织角色的回归。

## 分支、环境与发布门禁回归

`tests/tooling/deployment-environment.test.ts` 在临时目录合成夹具，验证 `.env.production` / `.env.preview` 的字段契约（非密值必须预填、契约外字段拒绝、密钥必须留空、`PUBLIC_ORIGIN` 逐字等于环境 origin、两环境端口与域名必须不同、`TRUST_PROXY` 等于宿主 nginx 与 web 容器 nginx 两层；发信：`MAIL_RECIPIENTS` 只能是 `all` 或 `allowlist`（两个环境模板现在都是 `all`，#169），发信密钥可以全部留空，阿里云两项只填一项拒绝，名单格式不对拒绝且报错不带名单内容，发不出信或带不了 Reply-To 的组合给提示）与 [deploy/environments.json](../../deploy/environments.json) 的一致性；它不读取真实密钥、不连接服务器。

分支不变量由 `scripts/check-branch-invariants.mjs` 检查（`tests/tooling/branch-invariants.test.ts` 用临时 Git 仓库覆盖不变量、命名规则与 pre-push 的发布 tag 规则：格式错误、rc 不在 stage、正式 tag 不在 main、同提交缺 rc 只告警、版本号不符、删除或移动发布 tag、附注 tag、非发布 tag 只告警）：`--require-remote-refs` 在 CI 上核对真实远端 refs，`--push` 供本地 pre-push 使用；本地也可以用同一命令自查（见 [BRANCHING](BRANCHING.md)）。这类检查只读 Git 证据，不 fetch、不改 refs。

`tests/tooling/task-worktree.test.ts` 在临时 Git 仓库里建 worktree、把 `gh` 换成假的，覆盖推送前的 worktree 检查：PR 已合并或 issue 已放弃、没 finish 的 worktree 让 `task.mjs list --check` 与 `.githooks/pre-push` 失败，清理后放行，查不到 GitHub 只警告，gh 偶发失败一次会重试，主工作区停在已合并的 task 分支上时提示切回而不是 finish。

`tests/tooling/issue-sweep.test.ts` 用虚构的 issue 与 PR 覆盖每天的 issue 巡检（[TRACKING](TRACKING.md) §1）：PR 已合并还开着的补关（head 是 task 分支或正文有关闭关键字，合进 `main` 的和只写 `Refs` 的不算；最近一次合并之后重开过的（按时间线上的重开时间，两次合并夹着一次重开时看最近那次合并；查不到重开时间就不关，超期记录写明是查不到）、合并后有过「关闭」记录又开着的、还有开着的 PR 关联的、PR 合并不到一小时的都不关，超期记录写明已合并的 PR 和没补关的原因），14 天没动静的留「超期」，关了却没有合并 PR 也没有「关闭」记录的留「缺记录」且只留一次，记录格式与 TRACKING 的类型表一致；命令行换成假 `gh`（只认带 `REOPENED_EVENT` 与 `last: 1` 的重开查询），核对 GraphQL 出错时不补关，不带 `--apply` 不写、带了才关闭和留言、一个失败不影响其它但以 1 退出，评论到 100 条时翻页取全。

`tests/tooling/doc-sync.test.ts` 在临时 Git 仓库里覆盖文档同步（规则见 [docs/README](../README.md)「文档跟着模块改」）：非 task 分支上按第一父链的时间比，模块比文档新就失败并写出那一对和那个提交，文档随后更新即通过，同一提交两边都改通过，PR 以 merge commit 进来时里面返工提交的先后不影响，rebase 那样的直线历史里模块在后就失败，检出发布 tag（detached HEAD，没有分支名）时同样按第一父链的时间比，同一提交上另有 task 分支也不按 PR 核对；task 分支上自动对 `stage` 按 PR 核对，先改文档后返工代码通过，只改模块失败（比的是 merge-base，`stage` 后来改了文档也不算），`stage` 本来不同步时写明不是这条分支造成的；文档核对：这个 task 的执行记录里写了就通过，别的 task 的记录、路径不对、没写理由、照抄模板里的 `<理由>`、理由只有标点或零宽字符的不算，文档只改了「更新：」日期、空白或空行不算改了说明，写了文档核对「更新：」也要跟上，`stage` 上合并提交带来的文档核对算同步；头部「更新：」按作者时间的北京日期比，零点前写、零点后合并不算过期；没提交、没跟踪的新文件算作现在，被忽略的目录不算服务；浅克隆直接报错。

`tests/tooling/deploy-doc-sync.test.ts` 覆盖发版前的文档同步（#192，[CICD](../ops/CICD.md)）：两条部署工作流的 plan job 都有「文档同步（发布 tag 指向的提交）」，排在完整历史的 tag 检出与 Node 安装之后，没有 `if`、`continue-on-error`、`|| true`，plan job 不装依赖（`check-doc-sync.mjs` 与 `note.mjs` 只导入 Node 内置模块），其它 job 都 `needs: plan` 且不带 `always()` 这类条件，两条工作流的这一步逐字相同；再在临时仓库里照工作流的写法用 bash 跑这一步：检出不同步的 rc tag 失败并报出那一对和那个提交，同步的通过，HEAD 不是 tag 指向的提交、浅克隆都失败。删掉这一步、加上吞掉失败的写法或让 build 不依赖 plan，测试都会失败。

`tests/tooling/release-policy.test.ts` 在临时 Git 仓库里覆盖 tag 模型：tag 正则与 RELEASES.md 逐字一致；`vX.Y.Z-rc.N` → preview、`vX.Y.Z` → production；拒绝分支名、`latest`、短 SHA 与格式错误的 tag；拒绝不在 `stage` 上的 rc、不在 `main` 上的正式 tag、同一提交没有同版本 rc 的正式 tag、版本与该提交 `package.json` 不符、已正式发布的版本再打 rc、本地 tag 指向别的提交；拒绝已退役的 `--branch`/版本/批准开关；以及「规划只读」（不写文件、不改 refs、不动工作区）。论坛的 `app/forum/tests/deployment.test.ts` 覆盖展示值：预发布只接受 `X.Y.Z-rc.N@<sha12>`，正式只接受 `X.Y.Z`。`scripts/release-bundle.mjs` 与 `tests/tooling/release-bundle.test.ts` 已随发布包模型一起删除。任何规划输出都**不授予**部署批准（`deploymentAuthorized: false`），自动测试也不替代人工试用。

授权数据拉取后使用 `scripts/forum-migration/verify.py` 逐文件核对哈希，并将冻结的 SQLite 在线备份恢复到内存核对所有表/条数。它是这次数据交付的单独核验，不是让常规 CI 使用真实用户数据。未来 capture/verify 工具单测只能使用虚构临时文件。

## 退役与报告

旧论坛专属测试随源码归档，不在新工程假运行，也不混入新结果。保留的核心邀请和 OAuth 行为必须在新 fixture 下重验。报告分别记录核心测试、原仓测试、浏览器场景、构建以及未执行项；不能用此前 48 项结果替代新架构证据。

验收中修改源码后重跑相关验证；mock 界面、静态生成、真实后端及生产验收是不同层次。统一认证、后端持久化或上线未实施时必须明确记录，禁止写“全线生产迁移已完成”。
