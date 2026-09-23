# Portal 模块合同（`app/web/sites/portal`）

> 公开官网：3D 书桌与 YUGC OS 桌面、加入我们（信封场景）、论坛与 GitHub 场景、文档、意见箱和邀请落地；无独立登录态。

状态：`current` · 更新：2026-09-24

## 范围与路由

前端入口 `app/web/sites/portal/App.tsx`，后端 `app/server/src/routes/portal/index.ts`。路由只从自己的模块目录注册，不导入 admin/forum 路由。

| 路由 | 页面 | 说明 |
|---|---|---|
| `/` | `pages/Home.tsx` | 加载动画 → 3D 书桌 → 点电脑开机 → YUGC OS 桌面（仪表盘 + 桌面图标 + 窗口 + Dock + ⌘K 启动器） |
| `/join-us` | `pages/JoinUs.tsx` | 加入我们：信封场景，DOM 信纸就是表单，真实提交 `POST /api/portal/apply` |
| `/apply` | — | 旧地址，`<Navigate replace>` 到 `/join-us`，已发出的链接不失效 |
| `/forum-3d` | `pages/Forum3D.tsx` | 论坛版块气泡场景，主入口「进入论坛首页」一直可见，版块图标为 Remix 线性图标 |
| `/github` | `pages/GithubScene.tsx` | GitHub 组织贡献天际线（高度为示意，页面标注）+ 公开仓库快照 |
| `/docs`、`/docs/:id` | `pages/Docs.tsx` | 公开产品介绍与用户指南（白名单由 `/api/docs` 决定） |
| `/feedback`、`/feedback/:org` | `pages/Feedback.tsx` | 匿名意见箱；未指定组织时默认本组织 |
| `/join/:token` | `pages/JoinByToken.tsx` | GitHub 组织邀请链接（能力令牌）落地页 |

`/join-us` 与 `/join/:token` 是两件事：前者是招新投递，后者是已有邀请链接的组织加入。首页之外的页面按路由懒加载。

## 模块地图

| 路径 | 职责 |
|---|---|
| `three/stage.ts` | 三个 3D 场景共用的「摄影棚」：渲染器、按需渲染循环、指针视差、环境动画节流、资源释放 |
| `three/desk.ts`、`join.ts`、`forum.ts`、`github.ts` | 各场景的程序化建模与动画，纯 three.js + TypeScript（strict），不依赖 React |
| `lib/deskMachine.ts` | 首页状态机 `loading → idle → focusing → booting → desktop → returning` 与各层可见性 |
| `lib/loaderProgress.ts` | 加载动画的真实进度模型（步骤权重、最短展示时长、平滑趋近） |
| `lib/cameraMath.ts`、`lib/motion.ts` | 相机距离（cover/contain）、像素 ↔ 相机平面换算、缓动与插值 |
| `lib/pixelRatio.ts` | 3D 像素比调速器：起步档位、降档规则、帧间隔预算（纯逻辑） |
| `lib/osApps.ts` | YUGC OS 应用清单、启动器过滤、终端命令、日历、行数截断 |
| `lib/links.ts` | 站外链接的唯一解析点：论坛首页/版块/话题、控制台、GitHub 组织 |
| `lib/snapshots.ts` | 读取 `public/portal/forum-latest.json`、`repos.json` 快照 |
| `lib/icons.ts`、`components/Icon.tsx` | Remix Icon 路径注册表与图标组件 |
| `components/os/*` | YUGC OS 桌面：仪表盘组件、窗口、菜单栏、Dock、启动器 |
| `components/Loader.tsx`、`Emblem.tsx`、`SceneBar.tsx`、`PageShell.tsx` | 加载动画、校徽几何、场景页顶栏、普通页外壳 |
| `components/ChoiceChips.tsx` | 少量选项的单选胶囊（原生 radio，方向键切换）；官网表单不用原生下拉框 |
| `styles/*.css` | 视觉令牌与组件样式（`.pt-root` 作用域），规范见 [DESIGN](../../design/DESIGN.md)「官网视觉语言」 |

文档 API 仅允许公开产品介绍和用户指南；内部规范、部署、安全与审查材料不在白名单。反馈写入 data.db，管理侧由服务端 admin/console 接口读取、控制台（`app/console`）页面处理；两侧通过一致数据模型协作，不互相 import 路由。

three.js 只通过各页面里的 `import("../three/<scene>")` 进入，不在首屏包里；卸载时 `Stage.dispose()` 释放几何体、材质、贴图、环境贴图并丢弃 WebGL 上下文。没有 WebGL 时首页直接给系统桌面，场景页的 DOM 入口（信纸、版块列表、仓库列表）照常可用。

## 链接与数据

- 论坛首页 `externalUrl("forum", "/")`：生产为 `https://yangtzeu.work/forum/`，本机开发为 `http://127.0.0.1:3456/`；版块 `/c/<slug>`，话题 `/t/<id>`（论坛按话题 id 解析，例如 `/t/t84`；`topic-84` 这类 slug 打不开）。
- 控制台 `externalUrl("admin", "/console")`：生产与预发布都是本域名下的 `/console`（每个环境只有一个域名，管理端按路径进入），本机开发为 `/sites/admin/console`。意见箱是站内 `/feedback`。
- 论坛最新与公开仓库在生产官网拿不到实时接口（论坛的本地状态接口只在开发时存在），因此随构建发布静态快照 `public/portal/forum-latest.json`、`public/portal/repos.json`，界面一律标「快照 <日期>」，不冒充实时数据。论坛快照只收录已在仓库里公开编辑过的话题（`app/forum/content/curation.json` 的 `topics`），字段白名单为 id、标题、分类、颜色、回复数、浏览数、时间，**不带作者或任何用户名**：论坛私有投影里的用户名含真实姓名，不得进入公开官网包。更新快照 = 替换这两个文件并跑 `tests/web/portal-snapshots.test.ts`（它校验字段白名单与话题 id）。
- GitHub 天际线的方块高度由固定种子生成（`lib/skyline.ts`），页面标「示意」，不是提交统计。

## 加入我们（投递）

`POST /api/portal/apply` 匿名可提交，准入与邀请落地共用（蜜罐 + PoW + 可选 Turnstile），落库 `applications` 表并写审计；接口细节见 [API](../../architecture/API.md)。前端 PoW 指纹与后端逐字一致：`apply:<姓名>:<邮箱>`（均为 trim 后取值），`pow` 只发 `{ timestamp, nonce }`（`powProof`）。提交成功后才开始折信、封口、投递动画，回执显示服务端返回的编号、时间和原文消息；失败时信纸留在原位并显示错误，不做假成功。

## 性能预算

在 1440×900、DPR 2 的 M4 Pro 上验收（ego-browser，rAF 采样 120 帧 + WebGL 帧耗时插桩）：

- **像素比调速器**（`lib/pixelRatio.ts`，`three/stage.ts` 接入）：起步 `Math.min(devicePixelRatio, 2)`，Retina 屏上几何边缘与贴图文字不再被放大发虚。连续绘制时把相邻两帧的间隔喂给调速器，每满 60 帧看一次 p95，超过预算就降一档（2 → 1.5 → 1.25），同一会话只降不升；降到的档位记在 `sessionStorage` 的 `yugc:pixel-ratio`，换场景也从这一档起步。预算 = max(12ms, 1.5 × 刷新间隔)，刷新间隔取见过的最短帧间隔（封顶 16.7ms；Stage 建好时另用 40 个空 rAF 探一次）：120Hz 屏预算 12.5ms，60Hz 屏 25ms，稳定 60fps 的 60Hz 屏不会误降。前 30 帧（着色器编译、贴图上传）、≥100ms 的卡顿、首页加载动画盖着画布的时段都不计入。单测 `tests/web/portal-pixel-ratio.test.ts`。
- 带字的程序化贴图（笔记本屏幕、开机按钮、便签、海报、仓库楼牌、论坛气泡、信箱铭牌）按 2 倍分辨率画（`canvasTexture` 的 `scale`，`TEXT_SCALE`），各向异性过滤取 `renderer.capabilities.getMaxAnisotropy()`（封顶 8），斜着看也清楚。信纸贴图按 DOM 信纸宽 × 设备像素比（封顶 2）建，落位那一帧与表单一样清楚。笔记本屏幕拆成静态底图 + 开机按钮 + 时钟三张贴图，悬停与走时只重画小的那张。
- 阴影贴图 1024，`shadowMap.autoUpdate = false`，只有物体移动时置 `needsUpdate`。
- 按需渲染：没有动画、指针没动时循环停止；环境动画（热气、悬浮、气泡自转、天际线呼吸）只在用户最近 8 秒有操作时播放，之后缓缓停到静止姿态；进入系统桌面、标签页隐藏、画布离开视口时循环停止。
- 动画进行中每个 rAF 都画，不做隔帧跳过（实测 Chromium 在画/不画交替时会把下一帧推迟约 1 秒）；动画时钟按夹紧后的帧 dt 累加，卡一帧只会慢，不会跳过步骤。
- 平滑：所有趋近都用帧率无关的指数阻尼（`damp`，或 `1 - exp(-λ·dt)`），镜头推近/退回与信封各段都用三次缓入缓出、五次缓出，没有线性段。推镜时屏幕上盖一层与开机画面同色的幕渐显（30%–75%），镜头飞完才暂停 3D 循环，最后一帧与 DOM 开机画面同色交接；退回书桌时指针视差从 0 缓缓接上，落位那一帧不会被视差拽一下。信纸落位后 3D 信纸在表单下面再留 0.3s，等表单淡入完才藏；投递时信封的柔影从当前不透明度淡出，塞进投信口的最后一段用 smoothstep。稍后才出现的物体（火漆、推镜的幕）在 `warmUp` 时一起预编译，第一次出现不卡。
- 循环内不分配对象：更新函数存在数组里用下标遍历；射线拾取的目标数组、提示文字、相机偏移与像素换算的结果对象都预先建好；DOM 信纸位置只在阶段开始和窗口尺寸变化时读。InstancedMesh 只上传变化的实例区间；看不出的 clearcoat 与大面积 `backdrop-filter` 不用；持续转动的物体不投实时阴影（用贴地柔影）。
- 加载动画到 100% 后停 0.3s 再合幕，签名的裁切框四周留出连笔的余量，写完时整条签名完整可见；同一会话再次进入时花瓣过渡缩短，0.5s 里也能完整走完，不带半成品合幕。进度趋近按帧间隔换算，120Hz 屏不会走得更快。
- 单帧 CPU+GPU 耗时（`gl.finish` 计时）p95 ≤ 4.5ms，即 60fps（16.7ms）预算的四分之一以内；共享 `base.css` 的全屏模糊背景流动层在官网关闭（它单独就把页面压到 30fps）。
- 2026-09-24 实测（ego-browser 内置 Chromium，M4 Pro，1440×900 DPR 2）。注意：该自动化浏览器对任何持续动画的页面都把 rAF 限在约 30Hz（空白页 120Hz、只有一个 CSS 旋转动画的测试页也是 29fps），所以 rAF 帧率在原型与新版上都是 ~29，不能用来比较；可比较的是单帧耗时与实际绘制次数：

| 场景 | 原型：单帧耗时 p50 / p95 · draw call | 新版：单帧耗时 p50 / p95 · draw call | 新版空闲行为 |
|---|---|---|---|
| 书桌空闲 | 2.0 / 4.5ms · 88 | 1.3 / 2.3ms · 50 | 静置 8s 后停止渲染（0.1 次/秒） |
| 书桌悬停 | 2.0 / 4.6ms · 88 | 1.5 / 3.0ms · 50 | 指针移动时按帧画 |
| 系统桌面 | 不渲染 3D；主线程 4.6ms/s | 不渲染 3D；主线程 4.7ms/s | 3D 循环暂停 |
| 加入我们 | 1.1 / 2.7ms · 30 | 1.0 / 1.9ms · 19 | 写信时停止渲染 |
| 论坛 | 1.7 / 3.6ms · 84 | 1.1 / 1.8ms · 45 | 静置后停止自转与渲染 |
| GitHub | 1.1 / 4.4ms · 16 | 1.6 / 4.1ms · 16 | 静置后停止呼吸与渲染 |

  上表只证明每帧工作量在 60fps 预算内。不受限速的帧率另在前台有头 Chromium 上测（Playwright 自带 Chromium 1243，M4 Pro 内屏 120Hz，1440×900 DPR 2，生产构建 `vite build`，静态服务按容器规则回落到 `sites/portal/index.html`；每个场景边移动指针边采 180 个 rAF 间隔）：

| 场景 | fps | 帧间隔 p50 / p95 / 最大 |
|---|---|---|
| 书桌（指针移动中） | 120.1 | 8.3 / 10.1 / 10.4ms |
| 点屏幕：推镜 + 开机 | 119.3 | 8.3 / 10.2 / 16.7ms，无长任务 |
| 加入我们（信封入场） | 120.0 | 8.3 / 10.0 / 10.3ms |
| 论坛气泡 | 120.1 | 8.3 / 9.9 / 10.4ms |
| GitHub 天际线 | 120.0 | 8.3 / 10.2 / 10.4ms |

  即在 120Hz 屏上满帧，推镜过程中最慢一帧 16.7ms（仍在 60fps 预算内）。Safari、中低端设备与 iOS 真机未测。

  2026-09-24 调速器接入后复测（同一台机器、同一脚本，生产构建；像素比从 1.5 提到 2，调速器全程没有降档）：

| 场景 | 像素比 1.5（改前）fps · 帧间隔 p50 / p95 / 最大 | 像素比 2（改后）fps · 帧间隔 p50 / p95 / 最大 | 改后单帧 CPU+GPU p50 / p95 |
|---|---|---|---|
| 书桌（指针移动中） | 120.0 · 8.3 / 10.3 / 10.4ms | 120.0 · 8.3 / 10.0 / 10.4ms | 0.5 / 1.6ms |
| 点屏幕：推镜 + 开机 | 117.4 · 8.3 / 10.1 / 40.6ms | 118.0 · 8.3 / 9.5 / 33.3ms，无长任务 | — |
| 加入我们（信封入场） | 120.0 · 8.3 / 10.0 / 10.3ms | 119.9 · 8.3 / 10.2 / 10.3ms | 0.4 / 1.2ms |
| 论坛气泡 | 120.0 · 8.3 / 9.9 / 10.1ms | 119.9 · 8.3 / 9.9 / 10.4ms | 0.3 / 0.9ms |
| GitHub 天际线 | 120.0 · 8.3 / 9.8 / 10.3ms | 120.0 · 8.3 / 9.8 / 10.4ms | 0.2 / 0.4ms |

  推镜的最大帧间隔两次都落在开机画面接管的那一刻（DOM 开机层淡入 + 3D 循环暂停），不是 3D 渲染本身；改后比改前短。单帧耗时是 rAF 回调 + `gl.finish` 的计时，与上面 ego-browser 的插桩方式不同，只在这一行内比较。降档路径另在浏览器里实测：每帧人为加 22ms，调速器 60 帧内降到 1.25 并写入 `yugc:pixel-ratio`，帧率恢复后不回升，进入下一个场景仍从 1.25 起步。

## 界面规则

- 界面里禁止 emoji 与装饰性 unicode 箭头/符号（↵ ↗ ✓ ▶ ← → ● 之类），图标一律用 `components/Icon.tsx`；允许 ⌘、·、…、×。`tests/web/portal-os.test.ts` 扫描官网源码拦截违规，并检查每个用到的图标名都在注册表里。
- 用户可见的招新入口统一叫「加入我们」。
- 开发态总控（`shared/ui/DevControlCenter.tsx`）默认收起成左下角小胶囊，点开才展开；生产配置下不渲染。窄屏（≤860px）官网里改放右上角顶栏下方，不压住 Dock 与底部固定栏。
- 窄屏（≤860px）的 YUGC OS：Dock 不再浮在内容上，而是排在滚动区下面的一条底栏（含 `safe-area-inset-bottom`），任何卡片的按钮都不会被它盖住。
- 文案：像班里的人在说话，短、具体，说清这是什么、给谁用、接下来会怎样；不写口号式标题和装饰性英文大写标签（RECRUITING、YUGC POST 之类），终端提示符只出现在真的终端里（终端窗口、终端组件、GitHub 场景里的小终端）。只写仓库里有出处的事实（部门职责取自 `app/server/src/lib/roles.ts`，版块说明取自 `app/forum/content/curation.json`）；服务端返回的文案（投递、意见箱、邀请的回执）原样显示。
- 浏览器自带的表面也用官网颜色：文字选中、光标、滚动条、焦点环、`accent-color`；计数、时钟、百分比用等宽数字（`font-variant-numeric: tabular-nums`）。卡片只有一种层级：细描边 + 贴身短投影；浮层（窗口、菜单、启动器、Dock）只用有偏移的投影。弱化文字 `--pt-ink-mute: #646b8a`，在纸色与冰白底上 ≥4.5:1。
- 官网表单不用原生下拉框：选项只有几个时用 `components/ChoiceChips.tsx`（意见箱分类）。

## 验收

`pnpm check && pnpm test && pnpm build`；浏览器验证见 [TESTING](../../conventions/TESTING.md)。单测覆盖状态机、加载进度、相机与摆放数学、像素比调速器、启动器过滤、终端、日历、快照结构、图标注册表与禁用字符。3D 画面、动画节奏与帧率只能在真实浏览器里验收，截图与测量结果写进 MR。
