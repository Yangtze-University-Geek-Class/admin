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
| `lib/osApps.ts` | YUGC OS 应用清单、启动器过滤、终端命令、日历、行数截断 |
| `lib/links.ts` | 站外链接的唯一解析点：论坛首页/版块/话题、控制台、GitHub 组织 |
| `lib/snapshots.ts` | 读取 `public/portal/forum-latest.json`、`repos.json` 快照 |
| `lib/icons.ts`、`components/Icon.tsx` | Remix Icon 路径注册表与图标组件 |
| `components/os/*` | YUGC OS 桌面：仪表盘组件、窗口、菜单栏、Dock、启动器 |
| `components/Loader.tsx`、`Emblem.tsx`、`SceneBar.tsx`、`PageShell.tsx` | 加载动画、校徽几何、场景页顶栏、普通页外壳 |
| `styles/*.css` | 视觉令牌与组件样式（`.pt-root` 作用域），规范见 [DESIGN](../../design/DESIGN.md)「官网视觉语言」 |

文档 API 仅允许公开产品介绍和用户指南；内部规范、部署、安全与审查材料不在白名单。反馈写入 data.db，管理侧由服务端 admin/console 接口读取、控制台（`app/console`）页面处理；两侧通过一致数据模型协作，不互相 import 路由。

three.js 只通过各页面里的 `import("../three/<scene>")` 进入，不在首屏包里；卸载时 `Stage.dispose()` 释放几何体、材质、贴图、环境贴图并丢弃 WebGL 上下文。没有 WebGL 时首页直接给系统桌面，场景页的 DOM 入口（信纸、版块列表、仓库列表）照常可用。

## 链接与数据

- 论坛首页 `externalUrl("forum", "/")`：生产为 `https://yangtzeu.work/forum/`，本机开发为 `http://127.0.0.1:3456/`；版块 `/c/<slug>`，话题 `/t/<slug>`。
- 控制台 `externalUrl("admin", "/console")`：生产为 `https://github.yangtzeu.work/console`。意见箱是站内 `/feedback`。
- 论坛最新与公开仓库在生产官网拿不到实时接口（论坛的本地状态接口只在开发时存在），因此随构建发布静态快照 `public/portal/forum-latest.json`、`public/portal/repos.json`，界面一律标「快照 <日期>」，不冒充实时数据。更新快照 = 替换这两个文件并跑 `tests/web/portal-snapshots.test.ts`。
- GitHub 天际线的方块高度由固定种子生成（`lib/skyline.ts`），页面标「示意」，不是提交统计。

## 加入我们（投递）

`POST /api/portal/apply` 匿名可提交，准入与邀请落地共用（蜜罐 + PoW + 可选 Turnstile），落库 `applications` 表并写审计；接口细节见 [API](../../architecture/API.md)。前端 PoW 指纹与后端逐字一致：`apply:<姓名>:<邮箱>`（均为 trim 后取值），`pow` 只发 `{ timestamp, nonce }`（`powProof`）。提交成功后才开始折信、封口、投递动画，回执显示服务端返回的编号、时间和原文消息；失败时信纸留在原位并显示错误，不做假成功。

## 性能预算

在 1440×900、DPR 2 的 M4 Pro 上验收（ego-browser，rAF 采样 120 帧 + WebGL 帧耗时插桩）：

- 渲染器像素比上限 `Math.min(devicePixelRatio, 1.5)`；阴影贴图 1024，`shadowMap.autoUpdate = false`，只有物体移动时置 `needsUpdate`。
- 按需渲染：没有动画、指针没动时循环停止；环境动画（热气、悬浮、气泡自转、天际线呼吸）只在用户最近 8 秒有操作时播放，之后缓缓停到静止姿态；进入系统桌面、标签页隐藏、画布离开视口时循环停止。
- 动画进行中每个 rAF 都画，不做隔帧跳过（实测 Chromium 在画/不画交替时会把下一帧推迟约 1 秒）；动画时钟按夹紧后的帧 dt 累加，卡一帧只会慢，不会跳过步骤。
- 循环内不分配对象；InstancedMesh 只上传变化的实例区间；看不出的 clearcoat 与大面积 `backdrop-filter` 不用；持续转动的物体不投实时阴影（用贴地柔影）。
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

  真实用户浏览器（不受该限速）上的 60fps 结论需要人工在普通 Chrome / Safari 里复测，本表只证明每帧工作量在 60fps 预算内。

## 界面规则

- 界面里禁止 emoji 与装饰性 unicode 箭头/符号（↵ ↗ ✓ ▶ ← → ● 之类），图标一律用 `components/Icon.tsx`；允许 ⌘、·、…、×。`tests/web/portal-os.test.ts` 扫描官网源码拦截违规，并检查每个用到的图标名都在注册表里。
- 用户可见的招新入口统一叫「加入我们」。
- 开发态总控（`shared/ui/DevControlCenter.tsx`）默认收起成左下角小胶囊，点开才展开；生产配置下不渲染。

## 验收

`pnpm check && pnpm test && pnpm build`；浏览器验证见 [TESTING](../../conventions/TESTING.md)。单测覆盖状态机、加载进度、相机与摆放数学、启动器过滤、终端、日历、快照结构、图标注册表与禁用字符。3D 画面、动画节奏与帧率只能在真实浏览器里验收，截图与测量结果写进 MR。
