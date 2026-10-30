# Web 服务合同（`app/web`）

> 官网 portal（React/Vite）+ shared 适配层；web 镜像同时托管控制台产物（`app/console`），是每个环境的 HTTP 入口容器。

状态：`current` · 更新：2026-10-31 · 源码：`app/web/` · 镜像：`yzgc-<environment>/web:<sha12>`

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/web/sites/portal/` | 公开站点：`App.tsx` 路由（`/`、`/forum-3d`、`/docs`；`/?open=<应用>` 进桌面打开窗口，旧地址 `/join-us`、`/apply`、`/feedback` 只做跳转）、`pages/`、`three/`（按需加载的 three.js 场景：论坛气泡）、`components/`（`boot/` 开机动画、`os/` YUGC OS 桌面与窗口（含「账号资料」窗口；「加入我们」窗口分包加载失败时只在窗口里说明，见 [portal](portal.md)）、页面外壳）、`lib/`（进站规则、相机数学、链接、快照、图标、全站登录状态 `account.ts`、部门、代码仓库、埋点）、`styles/`（`--pt-*` 与 YUGC OS v2 的 `--os-*` 令牌）、`index.html` 入口；不自建登录态，菜单栏头像打开「账号资料」窗口（见 [portal](portal.md)「账号资料窗口」） |
| `app/web/sites/contests/<比赛>/` | 比赛官网（#278）：每场比赛一个独立的 Vite 站点，单独构建成站点包，由控制台上传、server 在 `/c/<slug>/` 托管，不进 web 镜像。起步模板在 `_starter/`（复制改名就是一场新比赛的起点，只演示四个必带接口怎么接——比赛信息、人员、队伍、奖励，不含视觉设计），完整上手步骤见 [contest-site-quickstart](../server/contest-site-quickstart.md)。第一期是 `oss-2026-1/`：`site.config.ts`（名称、版本、比赛 id、兜底起止时间、刷新间隔，构建时生成 `yzgc-site.json`；`FALLBACK` 是接口回来之前先显示的奖项、年级系数和两档基础分表，`tests/web/contest-site.test.ts` 核对它和服务端一致）、`index.html`、`src/`（浅色底、不沿用主站风格。首屏按所有者 10-24 16:57 的要求一屏讲清楚：极客班第一届内部赛、怎么拿分三步（组织者标「有用」、重要程度 × 核心度查表、乘年级系数）、倒计时与报名，右边奖金卡和天梯前几名（`hero.ts`），1440×900 与 390×844 都在一屏内；效果是几层光（漂移柔光、转动光束、流动的透视网格、跟着指针的亮光）、逐字翻上来的比赛名、随指针倾斜的卡片和滚动驱动的首屏推远，减少动态效果时停在最终的样子。`scoring.ts` 画两张基础分表、年级系数柱和「算一算」；另有贡献热力图拼成的 Canvas 标题（字形与配色在 `shared/lib/heatmark`）、滚动数字倒计时、斜着滚动的贡献条、终端打字、天梯与领奖台、带两档的动态与流星、各段落渲染）。只能用同源资源：页面在 sandbox CSP 下运行，外部头像显示首字母 |
| `app/web/shared/competition-sdk/` | 比赛官网 SDK（#278，CONTRACT-278 §3）：`createClient({ competition })` 读 `/api/public/competitions/:id/*`（只发匿名 GET），错误归成 `network`、`not_found`、`rate_limited`、`server` 四种，`subscribe` 按间隔轮询（最短 5 秒，页面在后台时暂停，限流时等够 `retry_after`），`signupUrl`、`teamUrl` 跳回桌面的比赛窗口。`getParticipants({ cursor?, limit? })`、`getTeams()` 是站点包必带的另外两个接口（和天梯不同：给全部已报名的人 / 全部未解散的队，不是只有拿过分的）——个人赛调 `getTeams()` 不会报错，`enabled` 为 `false` 时直接跳过「队伍」这一段。官网站点直接打包进去；`sdk.vite.config.ts` 另外构建成 `dist/sdk/competition/v1.js`，由镜像在 `/sdk/competition/v1.js` 提供 |
| `app/web/shared/lib/` | 网络（`api`、`http`、`runtime`）、URL/站点（`site`）、Markdown（`markdown`）、挂载（`mount`）、PoW、主题、「OSS CHALLENGE」热力图字标的字形与配色（`heatmark`，#278，比赛官网首屏标题和主站比赛窗口的字标共用）、只读 mock（含开发预览身份 `?__mock=member\|registered\|visitor`，正式构建删掉） |
| `app/web/shared/ui/` | 官网复用的交互原语：Modal、ConfirmDialog、Select、ImageLightbox、TurnstileWidget 等 |
| `app/web/shared/styles/` | 基础样式与令牌（`base.css`、`rounded.css`） |
| `app/web/shared/config/` | 公开前端配置（`app.config.json` → `config/index.ts` 的站点标题与 basePath 合同；不含域名） |
| `app/web/Dockerfile` | Node 22 构建官网（`app/web`）与控制台（`app/console`）两份产物，叠进同一个 nginx 站点根 → 静态托管与反代；容器内监听 8080（非特权），并生成 `release.json` 供发布身份核对 |
| `app/web` 镜像内 nginx 配置 | 由 `Dockerfile` 生成。第一层访问防护（#333）：`set_real_ip_from` 只信任隧道两端（10.66.0.1、10.66.0.2）与 Docker 网段（172.16.0.0/12），之后 `real_ip_header X-Forwarded-For`、`real_ip_recursive on`，这样 `$remote_addr` 是 HK Caddy 写进头里的真实客户端；`/api/`、`/auth`、`/auth/*` 对读请求（GET/HEAD/OPTIONS，`yzgc_read`：每秒 30、突发 200）与写请求（`yzgc_write`：每秒 5、突发 60）分桶限流，每个 IP 最多 100 个并发连接，超额回 429 `{"error":"rate_limited","message":…,"notice":…}`，`notice` 与 server 的 `SHIELD_NOTICE` 逐字相同；静态文件与论坛不在限流范围内。这一层与 server 读同一对键 `SHIELD_ENABLED`、`SHIELD_ALLOWLIST`（compose 传进 web 容器）：容器 CMD 先跑镜像里的 `yzgc-shield-render`，按 server 的同一套规则校验后写出 `/etc/nginx/yzgc-shield/exempt.conf`（`geo $yzgc_shield_exempt`，按 real_ip 之后的 `$remote_addr` 匹配），再起 nginx；`off` 时第一层限流整体不生效，白名单来源的限流 key 为空、不进任何桶（server 自己的接口限流与全站上限另按 server 的规则）；写错开关或网段时脚本退出非零、容器起不来，日志只报第几段和项数，不打印网段；网段主机位清零、重复合并、`/0` 并进兜底行，nginx 加载时不出带网段的警告；接受与拒绝的写法与 server 的 `parseShieldAllowlist`（Node `isIP`）相同，IPv6 的区域标识（`%eth0`）与 Node 一样接受后不参与匹配，IPv6 网段覆盖到 IPv4 映射段 `::ffff:0:0/96` 的部分另写成等价的 IPv4 网段，和 server 的 `BlockList` 对 IPv4 客户端给出同一个结果；不经 CMD 直接起 nginx 时用镜像里 on、无白名单的默认文件。`tests/tooling/web-nginx.test.ts` 用本机 sh 实跑渲染脚本（与 `parseShieldAllowlist` 逐项对照接受与拒绝），并在本机 nginx 上实测白名单放行、off 不限、其他来源照常 429；线上容器的实际行为未验证，以部署后的烟测为准。 `/api/*` 使用 `location ^~ /api/` 前缀优先匹配（防止 `/api/forum/avatars/*.webp` 等动态文件接口被下方的静态图片正则拦截出 404，#173）；`/auth`、`/auth/*`（OAuth 登录与回调）、`/oidc/*`（对外授权的签发者，#270）、`/healthz` → `server:3000`；给自动化攻击工具的蜜罐（#333 追加）`location ~*` 的常见扫描路径（`/.env`、`/.git/`、`/wp-login.php`、`/wp-admin`、`/phpmyadmin`、`/actuator/` 等，前缀表在 `lib/shield.ts`，正则与之逐字一致并由 `tests/tooling/abuse-notices.test.ts` 核对）→ `server:3000` 计分封禁，`/.well-known/security.txt` → `server:3000`（RFC 9116，不走 SPA 入口）；`/forum` 308 到相对地址 `/forum/`，`/forum/llms.txt`、`/forum/t/*.md`、`/forum/published/<16位hash>.webp` 保留完整 URI 与 cookie → `server:3000`，其余 `/forum/*`（含页面图片、字体，`location ^~` 不让官网的图片规则截走）剥掉前缀后 → `forum:3000`，论坛发出的相对跳转由 `proxy_redirect / /forum/` 补回前缀；server 块 `absolute_redirect off`，容器发出的跳转（含补过前缀的）都是相对地址，不会带上容器的 `http://…:8080`（#140）；`/admin`、`/console` 及其子路径与 `/signin`、`/device`（设备授权确认页）、`/account`（账号页，#262）、`/authorize`（对外授权的同意页，#270）、`/bind-email`（绑定邮箱页，#273）、`/complete-profile`（补资料页，#280）→ 控制台入口 `sites/console/index.html`，其余 → portal，与 Host 无关；`/assets/*`（官网）与 `/console-assets/*`（控制台）里只有带内容哈希的构建产物，用 `location ^~` 整个目录缓存一年（`max-age=31536000`），字体、壁纸、图片也是，不再被后面「图片、字体 7 天」的正则截走（#146；两个目录都不能有 public/ 里原样复制的文件，`scripts/static-cdn.mjs` 与 `tests/tooling/static-cdn.test.ts` 核对，缓存头由 `tests/tooling/hashed-asset-cache.test.ts` 在本机 nginx 上实测）；目录外不带哈希的图片、字体缓存 7 天；`/sites/*` 只提供真实文件，不存在即 404；`/cli/<版本>/geek-*`（geek 命令行二进制与 `.sha256`，#277）同样整个按版本号分目录、长缓存一年，`/cli/install.sh`、`/cli/install.ps1`、`/cli/latest.json` 不缓存，且 `/cli/` 这个 location 用 `sub_filter` 把响应里的生产域名 `https://yangtzeu.work` 换成 `https://<请求的域名>`（宿主 nginx 用 `Host $host` 透传），所以安装脚本的默认源站跟着访问的域名走，预发布的 `install.sh` 默认从预发布装；替换值来自 `map $host $cli_origin`，只认字母、数字、点和连字符组成的名字，`$`、引号、空白等别的字符一律退回生产域名，因为这段文字最后会交给 sh 执行（#289，`tests/tooling/hashed-asset-cache.test.ts` 在本机 nginx 上逐字核对，含带 `$(...)` 的恶意 Host）；这些产物由 `scripts/cli-dist.mjs` 在构建这个镜像之前产出到 `dist/cli/`，发版构建用 `--build-context cli=dist/cli` 换进 `Dockerfile` 的空 `cli` 阶段再复制到 `/cli/`（交叉编译工具不进镜像）；不传时镜像照样能建，`/cli/` 是空的，细节见 [cli 合同](../cli/README.md)；`/c/*`（比赛官网，#278）→ `server:3000`，CSP 由 server 下发；`/sdk/*` 只提供镜像里的 SDK 文件，缓存 5 分钟、带 `Access-Control-Allow-Origin: *`，不存在即 404；`/api/` 里只有站点包上传 `POST /api/console/competitions/<id>/site/versions` 一条放宽到 `client_max_body_size 21m`，其余 6m（宿主模板仍是整站 6m，见 DEPLOY）；安全头由宿主 nginx 统一下发，容器不重复 |

模块细节：[portal](portal.md)、[shared](shared.md)；管理端已迁到 `app/console`（[console 合同](../console/README.md)，迁移说明见 [admin](admin.md)）。依赖方向：站点 → shared → 通用依赖；shared 不得反向导入站点；`app/web` 与 `app/console` 互不导入。

## 契约

- **两个前端包、一个镜像**：官网由本包的 Vite 构建产出 `sites/portal/index.html`，控制台由 `app/console` 单独构建产出 `sites/console/index.html`；`web` 镜像同时承担 TLS 之后的静态托管与反向代理，是唯一对宿主机暴露业务端口的容器（容器内 8080，宿主 production `127.0.0.1:18100`、preview `127.0.0.1:18200`）。
- **域名**：每个环境只有一个域名——正式 `yangtzeu.work`、预发布 `prev.yangtzeu.work`。portal、控制台、论坛同域，按路径区分：控制台是 `/console/…`（统一登录页 `/signin`、设备授权确认页 `/device`、账号页 `/account`、对外授权的同意页 `/authorize`、绑定邮箱页 `/bind-email` 与补资料页 `/complete-profile`（#280）也在控制台产物里，旧的 `/admin/…` 跳到 `/console`），论坛是 `/forum/…`，其余路径是 portal。旧的管理端独立子域与论坛子域都已退役（见 [DEPLOY](../../ops/DEPLOY.md) 历史章节）。
- **HTTP 边界**：前端只通过 `shared/lib/api` 访问 `/api/*`；跨端链接使用 `externalUrl`，同端使用 Router。生产态跨端链接是同源路径（`/forum/…`、`/console`），不拼域名；开发态仍走 `/sites/<端>/…`，论坛指向本机 3456。
- **配置**：构建期只读公开配置（`app.config.json`），不加载私有 `.env`，也不含任何域名；同一源码按发布身份分别构建，正式产物额外包含下述授权提示。`scripts/check-site-config.mjs`（`pnpm check:site-config`）校验站点不带 host、论坛 basePath 非空且不与其他站点重叠、production 数据源固定为 live。
- **GitLab 链接**：`links.gitlab()` 返回同源 `/api/public/gitlab`，后端按本环境基址和群组给出302；`urls.gitlab` 已移除，不把正式 GitLab 地址带进预发布产物。GitLab 项目本身的 HTTPS/clone 地址仍来自经过校验的项目 DTO。
- **静态资源 CDN 开关**（#146）：构建参数 `STATIC_CDN_BASE` 为空时与原来一样同源；等于由环境文件 `STATIC_CDN_ORIGIN` 派生的 `<源站>/yzgc/static/site/` 时（#360，源站不写在代码里），`vite.config.ts` 用 `experimental.renderBuiltUrl` 把带哈希的构建资源（`assets/` 下的 JS、CSS、字体、图片）改写到 CDN，`base` 仍是 `/`，入口 HTML、路由和 `public/` 里不带哈希的文件（favicon、logo、论坛快照、邮件里引用的图）仍走源站；桌面壁纸由 `sites/portal/lib/wallpapers.ts` import（文件在 `sites/portal/assets/wallpapers/`），构建时带哈希，跟着开关走。别的非空值让构建失败。规则只在 `scripts/static-cdn-base.mjs`；`app/web/Dockerfile` 把同一个参数传给官网与控制台两次构建，并断言两个入口页引用的是对应地址。开关由部署工作流决定，上传与核对见 [CICD](../../ops/CICD.md)「静态资源 CDN」。两个环境用同一个 CDN 前缀，产物仍不含环境域名。
- **正式授权提示**（#336）：`scripts/security-notice.mjs` 仅在 `GEEK_DEPLOYMENT_ENVIRONMENT=production` 的构建中加入 `security-authorization` HTML 元数据与入口 JS 注释；开发服务器、预发布和未指定环境的本机构建不注入。JS 在压缩之后、内容哈希之前处理，共享 CDN 前缀不会出现同名不同字节；不新增运行时脚本或改变页面布局。只提示未经授权的攻击应停止，保留普通浏览和已授权维护/验收；不替代 #333 的服务端防护，也不保证外部模型遵从。范围见 [SECURITY](../../architecture/SECURITY.md#正式产物的-ai-授权提示336)。
- **UI 选型**：官网是既有 React 实现，后续新增/迁移界面按 [Tuffex 使用政策](../../components/tuffex/USAGE-POLICY.md)；控制台已迁到 Vue + Tuffex（`app/console`）。不引入平行基础 UI 体系。
- **比赛窗口**（#238）：读匿名比赛接口，按时间显示六种状态（含规划中，#278 重开），每分钟同步重排；日期不在当前北京年份时保留年份，起止同一天只写一个日期；内部与外部链接均可选，只有可解析的 HTTPS 地址可点。损坏的列表响应进入失败态，不冒充空数据；样板截止日期按北京时间日末构造。详见 [portal](portal.md)「比赛窗口」。
- **比赛官网与 SDK**（#278）：官网站点包不在 web 镜像里，`pnpm --filter @yzgc/web build:contest` 构建到 `sites/contests/<比赛>/dist/site/`，`pnpm contest:site pack <目录> --competition <比赛 id>` 打成 zip 并跑一遍与上传接口相同的校验（`scripts/contest-site.mjs`，规则在 `app/server/src/lib/site-package.ts`：zip ≤ 20MB、≤ 500 个文件、必须有 `index.html` 与 `yzgc-site.json`、不能有符号链接与以 `.` 开头的文件），再在控制台上传、预览、发布。官网只调 `/api/public/*`，不带 cookie；报名、组队、看自己的兑奖码都跳回桌面的比赛窗口（`/?open=competitions&competition=<id>`，加 `&view=team` 直接到组队）。主构建之后再跑 `vite build -c sdk.vite.config.ts` 产出 `dist/sdk/competition/v1.js`，镜像构建时断言它存在。
- **首页与 YUGC OS v2**（#275）：首页先看今天（北京时间）播没播过开机动画（Canvas 2D，电脑与手机两套构图，能跳过、静音、重播），没播就播，播完淡出到桌面；播过或开了减少动态效果直接进桌面。三维书桌、加载动画、iPhone 模型首页、GitHub 天际线场景与旧吉祥物都已删除，three.js 只留给论坛场景页（加入我们在 #279 改成桌面窗口）。桌面默认壁纸「晴空」接着开机动画最后一帧画；菜单栏头像打开「账号资料」窗口（#280 起是桌面窗口）；组织架构读 `/api/public/departments`，代码仓库与终端按真实身份读取公开或成员项目并隔离旧私有状态，入口使用极客班统一登录；加入我们是桌面窗口（#279），要登录并显示当天剩余投递份数；前端埋点攒批发 `POST /api/events`。手机是同一套组件的主屏幕形态（状态栏、四列应用、主屏幕加三个主入口的 Dock，窗口按 iOS 页面卡片从底部升起，#233）。细节见 [portal](portal.md)。

## 运行

```bash
pnpm dev:web        # 官网只读 mock 预览，无需 OAuth 或业务数据库
pnpm dev:console    # 控制台（app/console），默认连本地后端，?__data=mock 切样板数据
pnpm dev            # 前后端开发（需要本机 .env，模板见 ../../ops/ENVIRONMENT.md）
pnpm preview:local  # 核心 5173/3000 + 独立论坛 3456，见 ../../ops/LOCAL-PREVIEW.md
pnpm --filter @yzgc/web dev:contest    # 比赛官网开发（5195，/api 代理到本机 3000）
pnpm --filter @yzgc/web build:contest  # 比赛官网站点包产物
pnpm contest:site pack app/web/sites/contests/oss-2026-1/dist/site --competition oss-challenge-2026-1
pnpm contest:site dev app/web/sites/contests/oss-2026-1/dist/site --variant team --prizes  # 带示例数据预览，不连后端
```

本机地址：官网 `http://127.0.0.1:5173/sites/portal/`（不带尾斜杠的 `/sites/portal` 同样回落到入口，支持 Router 记录的首页后退与刷新）；控制台 `http://127.0.0.1:5186/console`（`pnpm dev:console`）。5173 上的 `/console`、`/admin`、`/signin`、`/device`、`/account`、`/authorize`、`/bind-email`、`/complete-profile` 与旧的 `/sites/admin/*` 在开发态 302 到 5186；`/forum/<路径>` 302 到 `http://127.0.0.1:3456/<路径>`（去掉 `/forum` 前缀，查询参数保留，登录后回到论坛原页面靠它）。容器内由 nginx 托管构建产物并按路径选择入口；宿主 nginx 只做 TLS 终止与 `server_name` → 回环端口转发。

镜像的构建阶段 `node:22-bookworm-slim` 与运行阶段 `nginx:1.31-alpine` 在 `app/web/Dockerfile` 里按 digest 固定（`<tag>@sha256:<digest>`，#97）；换基础镜像的步骤见 [DEPLOY](../../ops/DEPLOY.md)「基础镜像按 digest 固定」。

## 验证命令

```bash
pnpm typecheck                        # app/web/tsconfig.json
pnpm test                             # 组件与共享层单测
pnpm test:e2e                         # 浏览器验证（Playwright）
pnpm build                            # Vite 产物
node scripts/check-boundaries.mjs     # 站点/shared 依赖方向
node scripts/check-site-config.mjs    # 站点配置不含域名、论坛 basePath、production 数据源
```

浏览器验收项（键盘/焦点、错误与空状态、窄屏与移动导航、模态背景 inert、分页 URL）见 [TESTING](../../conventions/TESTING.md) 与 [DESIGN](../../design/DESIGN.md)。

## 已知限制

- 本机 mock 预览是只读样板（写操作一律回 501 `mock_read_only`），不连真实后端；真实数据只在连上 `app/server` 后出现。
- PR 预览（#245）：构建时设 `VITE_PREVIEW_MOCK=1`，生产形态的构建改用样板数据（`shared/config` 的 `PREVIEW_MOCK`，`runtimeEnvironment()` 返回数据源 mock、不显示开发控制台、不允许切换），不连任何后端。只有根目录 `netlify.toml` 设置它，镜像构建与部署工作流从不设置；未设置时常量被构建替换成 `false`，样板数据代码照旧从生产产物里删掉（`tests/tooling/pr-preview.test.ts` 核对）。
- 旧入口跳转**只存在于本机 Vite dev**（`vite.config.ts` 的开发中间件）：`/sites/forum/*` 302 到新论坛首页 `http://127.0.0.1:3456/`，`/forum`、`/forum/*` 保留路径 302 到 3456；不猜测旧帖子 ID 映射。容器栈里 `/sites/forum/*` 返回 404，`/forum/*` 由 nginx 反代到 forum 容器。
- WCAG 2.2 AA 是目标而非已达成结论；对比度、放大、屏幕阅读器需独立测量。
- 论坛前端（`app/forum`）与控制台（`app/console`）是 Vue/Tuffex，与本包无代码复用：Vue 组件不能当作 React 组件使用。
- 开发态官网右上角的「DEV CONTROL」浮层会挡住文档页的语言切换按钮（点击被拦截，键盘可用）；属官网既有问题，未在本次处理。
