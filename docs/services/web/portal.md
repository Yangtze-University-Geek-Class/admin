# Portal 模块合同（`app/web/sites/portal`）

> 公开官网：3D 书桌与 YUGC OS 桌面、加入我们（信封场景）、论坛与 GitHub 场景、文档、意见箱和邀请落地；不自建登录，菜单栏显示全站 GitHub 登录的账号或登录入口。

状态：`current` · 更新：2026-09-26

## 范围与路由

前端入口 `app/web/sites/portal/App.tsx`，后端 `app/server/src/routes/portal/index.ts`。路由只从自己的模块目录注册，不导入 admin/forum 路由。

| 路由 | 页面 | 说明 |
|---|---|---|
| `/` | `pages/Home.tsx` | 加载动画 → 3D 书桌 → 点电脑开机 → YUGC OS 桌面（极客娘壁纸 + 应用图标 + 「新来的看这里」便签 + 窗口 + 带名字的 Dock + ⌘K 启动器） |
| `/join-us` | `pages/JoinUs.tsx` | 加入我们：信封场景，DOM 信纸就是表单，真实提交 `POST /api/portal/apply` |
| `/apply` | — | 旧地址，`<Navigate replace>` 到 `/join-us`，已发出的链接不失效 |
| `/forum-3d` | `pages/Forum3D.tsx` | 论坛版块气泡场景，主入口「进入论坛首页」一直可见，版块图标为 Remix 线性图标；进论坛前镜头推近、遮罩盖满，从论坛按后退回来时浏览器可能从往返缓存（bfcache）恢复整页，`pageshow.persisted` 时调场景的 `reset()` 回到进场的样子（#109） |
| `/github` | `pages/GithubScene.tsx` | GitHub 组织贡献天际线（方块高度是装饰）+ 公开仓库列表 |
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
| `lib/osApps.ts` | YUGC OS 应用清单、启动器过滤、终端命令、时间文案 |
| `lib/promo.ts`、`components/PromoPlayer.tsx`、`components/PromoLazy.tsx`、`styles/promo.css` | 宣传片：CDN 地址、「只自动播一次」的 cookie、按浏览器能力挑编码与播放方式、起播预取（纯逻辑在 `lib/promo.ts`）；全屏播放层（见下文「宣传片」） |
| `lib/links.ts` | 站外链接的唯一解析点：论坛首页/版块/话题、控制台、GitHub 组织 |
| `lib/org.ts` | 「组织架构」窗口与「关于极客班」里的称号和部门：读匿名 `GET /api/public/org`（窗口打开时读一次、关掉即取消），`ORG_DEFAULTS` 是与服务端默认值一致的唯一一份兜底（`tests/web/portal-org.test.ts` 核对），读到之前和读不到时显示它；服务端的 Carbon 图标名经 `ORG_ICONS` 换成官网的 Remix 图标，认不出的用圆圈。官网静态文案不写称号名字，因为提督可以在控制台改名 |
| `lib/account.ts` | 全站登录状态：`useAccount()` 读同域 `/auth/me`、`signOut()` 调 `POST /auth/signout`；`signInHref(returnTo)` 生成 `/auth/github?return_to=…`，默认回 `<当前 origin>/forum/` |
| `lib/snapshots.ts` | 读取 `public/portal/forum-latest.json`、`repos.json` 快照 |
| `lib/icons.ts`、`components/Icon.tsx` | Remix Icon 路径注册表与图标组件 |
| `components/os/*` | YUGC OS 桌面：应用图标与「新来的看这里」便签（`Widgets.tsx`）、窗口、菜单栏、Dock、启动器；换壁纸面板在 `YugcOs.tsx`，壁纸图层与换壁纸动效在 `Wallpaper.tsx`；壁纸清单、下载解码与空闲预取在 `lib/wallpapers.ts`（图片地址只写在这里），文件在 `public/portal/wallpapers/`（每张一张 1920×1080 静态图和一张缩略图），见下文「壁纸」 |
| `components/Loader.tsx`、`Emblem.tsx`、`SceneBar.tsx`、`PageShell.tsx` | 加载动画、校徽几何、场景页顶栏、普通页外壳 |
| `components/ChoiceChips.tsx` | 少量选项的单选胶囊（原生 radio，方向键切换）；官网表单不用原生下拉框 |
| `styles/*.css` | 视觉令牌与组件样式（`.pt-root` 作用域），规范见 [DESIGN](../../design/DESIGN.md)「官网视觉语言」 |

文档 API 仅允许公开产品介绍和用户指南；内部规范、部署、安全与审查材料不在白名单。反馈写入 data.db，管理侧由服务端 admin/console 接口读取、控制台（`app/console`）页面处理；两侧通过一致数据模型协作，不互相 import 路由。

three.js 只通过各页面里的 `import("../three/<scene>")` 进入，不在首屏包里；卸载时 `Stage.dispose()` 释放几何体、材质、贴图、环境贴图并丢弃 WebGL 上下文。没有 WebGL 时首页直接给系统桌面，场景页的 DOM 入口（信纸、版块列表、仓库列表）照常可用。

## 链接与数据

- 论坛首页 `externalUrl("forum", "/")`：生产为 `https://yangtzeu.work/forum/`，本机开发为 `http://127.0.0.1:3456/`；版块 `/c/<slug>`，话题 `/t/<id>`（论坛按话题 id 解析，例如 `/t/t84`；`topic-84` 这类 slug 打不开）。
- 控制台 `externalUrl("admin", "/console")`：生产与预发布都是本域名下的 `/console`（每个环境只有一个域名，管理端按路径进入），本机开发为 `/sites/admin/console`。意见箱是站内 `/feedback`。
- 论坛最新与公开仓库在生产官网拿不到实时接口（论坛的本地状态接口只在开发时存在），因此随构建发布静态快照 `public/portal/forum-latest.json`、`public/portal/repos.json`。界面上不写「快照」「示意」这类给开发者看的说明（`tests/web/portal-os.test.ts` 扫描拦截），数字只写数据里真有的（话题数、用户数、仓库数）。论坛快照只收录已在仓库里公开编辑过的话题（`app/forum/content/curation.json` 的 `topics`），字段白名单为 id、标题、分类、颜色、回复数、浏览数、时间，**不带作者或任何用户名**：论坛私有投影里的用户名含真实姓名，不得进入公开官网包。更新快照 = 替换这两个文件并跑 `tests/web/portal-snapshots.test.ts`（它校验字段白名单与话题 id）。
- GitHub 天际线的方块高度由固定种子生成（`lib/skyline.ts`），只是造型：页面上不做色阶图例、不标数值，也不在任何地方把它说成提交统计。

## 登录入口（菜单栏）

官网不自建登录态，只显示核心服务的全站 GitHub 登录（官网、论坛、控制台共用同一个 `sid`，只有 `CONSOLE_ORG` 的 active 成员能登录，见 [SECURITY](../../architecture/SECURITY.md)「登录门槛」）。`components/os/YugcOs.tsx` 在菜单栏时钟左边放这个入口，`lib/account.ts` 读完 `/auth/me` 之前不显示：

- 未登录：「用 GitHub 登录」链接（GitHub 图标 + 文字，钴蓝底），指向 `/auth/github?return_to=<当前 origin>/forum/`，登录后进论坛首页。本机开发时 5173 把 `/auth` 代理给 127.0.0.1:3000，回到的 `/forum/` 再 302 到 3456（见 [LOCAL-PREVIEW](../../ops/LOCAL-PREVIEW.md)）。
- 已登录：头像与 GitHub 登录名（最长 120px，超出省略），点开是「论坛」「控制台」「退出」菜单，「控制台」只在 `/auth/me` 的 `console_link` 为 true 时出现；退出调 `POST /auth/signout`，官网、论坛、控制台一起变成未登录。菜单宽约 220px，靠右时往左收，不出屏幕。

**控制台入口只给管理者**：`/auth/me` 的 `console_link`（持有 `console.access`、`github.org.read`、`feedback.read` 之外任一能力的人：提督、舰长、队长、带部门权限包的舰员）为 true 时，桌面图标、Dock、「前往」菜单、启动器（⌘K）、终端的 `ls` / `open console`、头像菜单和普通页面页脚才出现「控制台」；没登录、普通舰员和领航员都看不到。`lib/osApps.ts` 的 `visibleApps(consoleLink)` 是桌面这几处唯一的过滤，`components/PageShell.tsx` 的页脚同样按它显示。这只决定入口显不显示，控制台自己的准入不变（直接打开 `/console` 仍按能力判定）。单测 `tests/web/portal-os.test.ts`，浏览器用例 `tests/e2e/workflows.spec.ts`（页脚按 `console_link` 出现）。

官网不读 `?signin=`。从官网登录没成功时回到的是论坛首页，由论坛说明原因（见 [forum 合同](../forum/README.md)「全站登录」）。预发布与正式的论坛镜像是极客班论坛（自己的站名、分类和标签，帖子与回复存在核心服务，见 [forum 合同](../forum/README.md)「服务端模式」），登录方式是统一登录，从官网登录后回到的 `/forum/` 顶栏显示同一个账号。退出等服务端确认后才显示未登录。

## 加入我们（投递）

`POST /api/portal/apply` 匿名可提交，准入与邀请落地共用（蜜罐 + PoW + 可选 Turnstile），落库 `applications` 表并写审计；接口细节见 [API](../../architecture/API.md)。前端 PoW 指纹与后端逐字一致：`apply:<姓名>:<邮箱>`（均为 trim 后取值），`pow` 只发 `{ timestamp, nonce }`（`powProof`）。提交成功后才开始折信、封口、投递动画，回执显示服务端返回的编号、时间和原文消息；失败时信纸留在原位并显示错误，不做假成功。

## 壁纸

所有者 2026-09-26：「切换壁纸的时候不会马上切换，会卡很久，切换壁纸的时候有个对应的动效」（#147）。原来点下去要等 1920×1080 的大图下载、解码完才换，弱网时要等好几秒，这期间桌面没有任何变化。

- **清单与地址**：`lib/wallpapers.ts` 是壁纸图片地址唯一出现的地方，换 CDN（#146）时只改这里。每张壁纸有大图（webp，123KB、238KB）、选择面板用的缩略图（320×180，8KB、13KB）和主色 `tint`。
- **点下去**：`components/os/Wallpaper.tsx` 马上压上新的一层：底色加放大、模糊的缩略图（选择面板里已经加载好，不用等网络）。这一层从点的那张缩略图的位置展开到整个桌面：起点是缩略图在壁纸层里的矩形（`revealClipFrom` 算成 `clip-path: inset(… round 9px)`，和缩略图圆角一样），终点是整个桌面，640ms，缓出曲线 `cubic-bezier(.22, 1, .36, 1)`。大图下载、解码好（`loadWallpaperImage`，`image.decode()`）以后在这一层里淡入 480ms，模糊的画面清晰过来；淡入播完（`transitionend`）再卸掉下面的缩略图。已经解码过的大图（开机那张、换过的、预取过的）直接给大图，不先顶缩略图。
- **减少动态效果**：开了系统的「减少动态效果」时不展开，整层淡入 360ms；拿不到缩略图位置时也走淡入。全站这时把动画和过渡压成 .01ms（`styles/portal.css` 的 `.pt-root *`），整层淡入和清晰过来只改透明度、不位移，`styles/os.css` 用两个类的选择器保留原时长，不看样式表的先后。
- **旧层什么时候卸**：某一层的展开（淡入）动画真正播完（这一层自己的 `animationend`，里面元素冒上来的不算）就整片盖住了它下面的层，这时只卸它下面的层，它上面还在展开的新层不动。不按固定计时卸：主线程卡住、标签页在后台或浏览器限帧时动画会晚开始，按计时卸会在新层盖住之前卸掉旧层、露出空桌面（限速验收时实测到过）。连点几次时每一层只管自己的动画和解码，桌面最后停在最后点的那张，不会闪回先点的；全程没有空白帧，桌面不滚动。
- **大图下载失败**（离线、被拦）：停在底色加模糊缩略图，不闪回旧壁纸。失败不记住，下次换过去重新下载。
- **空闲预取**：桌面出现后等浏览器空闲（`requestIdleCallback`，最多等 4 秒；Safari 没有它，等 1.5 秒），按顺序一张一张、低优先级（`fetchPriority = "low"`）下载：先全部缩略图，再当前这张以外的大图。和换壁纸、开机画面共用同一份下载，同一地址只下一次，预取到一半时点了就接着等这一次。开了省流量（`navigator.connection.saveData`）或网络是 2G、slow-2g 时不预取；退回书桌时停下还没开始的那几张。
- **单测**：`tests/web/portal-wallpapers.test.ts`（清单、展开起点、预取顺序与条件），`tests/web/portal-wallpaper-switch.test.tsx`（jsdom：占位立刻出现、解码后换上大图、旧层和缩略图等动画事件才卸（时间再久也不卸）、连点停在最后一张且不提前卸层、减少动态效果走淡入、下载失败停在占位、开机那张只下一次；预取的顺序、取消、去重与省流量不预取）；`portal-wallpapers.test.ts` 还核对减少动态效果时淡入的时长豁免。

## 宣传片

所有者 2026-09-25：「点击投递简历的时候第一次默认会播放这个宣传视频，要求进行分片让人无感大小快速播放，也可以选择去进行跳过，只播放一次，跟随浏览器 cookie 走，也可以在桌面里面看到这个宣传片点击再次播放。」（#77）

- **什么时候播**：`pages/JoinUs.tsx` 挂载时看 cookie `yugc_promo_seen`，没有就先挂全屏播放层，播完或跳过才开始信封动画。所有进入「加入我们」的路径（桌面、Dock、快捷键、页头链接、直接打开网址）都经过这里。cookie 是 host-only、一年、`Path=/`、`SameSite=Lax`（https 下 `Secure`），值只有 `1`。真正开始播放、跳过、播完或浏览器根本播不了时写入；加载失败不写，下次再试。
- **桌面重看**：`lib/osApps.ts` 的「宣传片」应用（`{ kind: "panel", panel: "promo" }`）在桌面上打开同一个播放层，不读也不写 cookie。
- **片源**：七牛 CDN `https://cdn.crosery.com/yzgc/static/promo/v5-tone-e1419fc9331a/`，地址只在 `lib/promo.ts` 的 `PROMO_BASE`。AV1 10-bit 三档（480p、720p、1080p）与 H.264 五档（240p、360p、480p、720p、1080p）各一份 master（`master-av1.m3u8`、`master-h264.m3u8`），fMP4 分片 4 秒一段、所有档位关键帧对齐；240p、360p 音频 64k（平均约 240、450kbps，峰值约 340、640kbps），给弱网手机（#103）。封面有两张：`poster.jpg`（1920 宽，171KB）给桌面，`poster-640.jpg`（58KB）给触屏，弱网时大封面会和第一个分片抢带宽。master 里的码率由片子目录的 `scripts/write-masters.py` 按实际分片算（BANDWIDTH 是单段峰值），编码串从各档 `init.mp4` 读。画质参数沿用所有者片子目录 `qa/verification.md` 交付的 web264-28 与 av1-46；分片包由片子目录里的 `scripts/package-hls.sh` 生成、`scripts/qiniu-promo.mjs` 上传（insertOnly，只写 `yzgc/static/promo/` 下），不进 Git。路径带内容哈希，CDN 缓存一年；换片子就换目录并改 `PROMO_BASE`。
- **挑播放方式**（`choosePlayback`）：有 MediaSource（含 iOS 17.1+ 的 ManagedMediaSource）就用 hls.js，没有时退到原生 HLS（老 iOS、微信）；两条路都没有就不播、直接进信纸。触屏设备（`pointer: coarse`）一律 H.264（它的梯子最低到 240p）；桌面 AV1 只在 `mediaCapabilities` 说 1080p 流畅**且硬解**（`powerEfficient`）时用，原生 HLS 要 `canPlayType` 对 AV1 是 `probably`，否则 H.264。
- **起播档**（`startEstimate`、`startLevelIndex`）：带宽估计有 Network Information 的下行估计就用它，开了省流量按 0，都没有按设备猜（触屏 1Mbps、桌面 4Mbps）；估计会过时、偏高（DevTools 限速时 Chrome 仍报 10Mbps），所以封顶触屏 1.5Mbps、桌面 4Mbps。起播选峰值码率不超过估计 × 0.7 的最高一档，一档都不够就用最低的：没有网络信息的手机从 360p 起、桌面从 720p 起。hls.js `autoStartLoad: false`，解析完档位按同一个函数设 `startLevel` 再开始加载，之后按实测带宽切换；缓冲 30 秒（最多 60 秒），`capLevelToPlayerSize` 且像素比最多按 2 算。不开 worker（fMP4 不需要转封装，也不用给 CSP 加 `worker-src`）。用的是 hls.js 精简版（`hls.js/light`，片源没有字幕、多音轨、DRM），独立分包 gzip 约 118KB，只在要播时加载。点视频或空白处后焦点留在播放层上，Esc 照样能关；触屏不显示按键提示。
- **画面与控件**（#103，所有者 2026-09-26：「这些大额头和下巴丑死了，这些按钮可以融进宣传片里面，跟游戏一样」；#142，所有者 2026-09-26 22:14：「宣传片这边不需要这个进度条和播放暂停啥的，只需要右上角的跳过，就是让人无感播放」）：画面按 16:9 放进屏幕（`.pt-promo-stage` 用容器查询单位算最大尺寸），画面上只有右上角的「跳过 Esc」（replay 叫「关闭」），一直在；没有播放 / 暂停、进度条、时间、音量和「打开声音」，空格与 M 也不再有作用；播完自动关。点画面从不暂停，只会让片子往「在播、有声音」走：静音时打开声音，被系统或浏览器停下时接着播（点击是用户手势，浏览器这时允许带声音播）；停下时画面中间提示「点画面播放」，提示不挡点击。播放中 2.5 秒不动鼠标，指针隐藏，动一下就回来。画面上只有一个按钮，焦点一直在它身上（Tab 不会跑到下面的页面）。画面外的空白不是深色条：每 0.5 秒把当前画面缩成 32×18 画到背景画布，CSS 放大模糊（出画面前先画封面）。
- **手机竖着拿**（所有者：「能不能默认横屏播放」）：`(orientation: portrait) and (pointer: coarse) and (max-width: 600px)` 时画面框转 90 度（平板竖放不转）（宽 100dvh、高 100dvw），片子横过来铺满屏幕，控件跟着转；横过手机后媒体查询不再命中，就是正常横屏。
- **缓冲**：播放中卡住（`waiting`）显示「正在缓冲…」，6 秒没恢复提示可以先跳过。
- **自动播被拒与减少动态效果**（#142）：先带声音自动播；浏览器不让就静音播（点画面打开声音）。静音也不让播时，gate 直接结束（`blocked`），进信纸，不停在封面等人点；replay 是自己点开的，停在封面提示「点画面播放」。gate 遇到减少动态效果不自动播：什么都不加载，播放层不画出来就结束（`blocked`）；replay 照常播。`blocked` 和 `unsupported` 一样算看过：是浏览器或用户的设置，以后多半也不会自动播，每次进「加入我们」都闪一下播放层没有意义，想看从桌面「宣传片」打开。没有采用「封面 + 跳过 + 几秒后自动关」：那只是让人对着静图多等几秒，和无感播放相反。减少动态效果时播放层不做淡入，加载圈不转。
- **出错时**（#110）：播放层分包加载失败（断网、发版后旧页面找不到新文件名）按「加载失败」直接结束（`components/PromoLazy.tsx`），不让官网跟着卸载；失败只影响这一次打开，下次打开重新加载分包，网络恢复后照常能播。浏览器会记住加载失败的模块地址（Chrome、Firefox 按 HTML 规范如此，桌面预取时断网失败也算），同一地址再 import 不发请求直接失败，所以播放层和 hls.js 分包各写死原地址加 3 个 `?retry=n` 地址（`lib/promo.ts` 的 `retryableImport`）：生产构建把每个打成文件名不同的分包（`PromoPlayer` 约 5KB、`hls.light` 约 372KB 各多 3 份，只在重来时下载），原地址失败时马上换下一个试一次，之后每次重来换一个，用完停在最后一个，要刷新页面才会再从头来；换地址只以生产构建为准。边界检查不许非字面量 import、CSP 不许 eval，所以只能是有限个写死的地址。播放层样式 `styles/promo.css` 跟官网主包由 `PromoLazy.tsx` 引入，不跟播放层分包：Vite 的分包预加载把失败过的样式表记为已加载、不再重试。`play()` 被拒时，`NotSupportedError`（片源放不了）按加载失败结束；其他原因（如 `AbortError`）gate 按加载失败结束（不记看过，下次再试），replay 停在封面等点画面；起播过程中意外抛错按加载失败结束一次。
- **起播预取**：桌面出现、这个浏览器还没看过宣传片、没开省流量时，先 preconnect CDN，空闲时预取「加入我们」页、播放器、hls.js 分包，以及起播那一档（与播放器同一个 `startLevelIndex`）的 master、播放列表、初始化段与第一个分片。点「加入我们」后这些都从缓存来。
- **CDN 预取**：CDN 边缘节点第一次被请求时回源（2026-09-26 实测五档 135 个分片几乎全是 `x-qnm-cache: Miss`，TTFB 0.33–0.48s；第二次请求变 `Hit`）。换片子上传后，用片子目录的 `node scripts/qiniu-promo.mjs prefetch` 让七牛预取两个 master、每档播放列表、初始化段与前 3 个分片和封面（44 个地址，七牛每天限额 100）。实测预取任务成功后边缘节点第一次请求仍是 `Miss`（七牛预取的是上层缓存），TTFB 降到 0.25–0.33s，改善有限；弱网能播主要靠低档位与缓冲。
- **CSP 与防盗链**：宿主 nginx 的站点策略 `media-src` 与 `connect-src` 放行 `https://cdn.crosery.com`（见 [DEPLOY](../../ops/DEPLOY.md)）；CDN 按 Referer 只放行本站域名、`localhost` 与空 Referer，**本机开发要用 `http://localhost:5173` 打开**，用 `127.0.0.1` 时 CDN 返回 403，播放层按「加载失败」直接放行到信纸。
- **弱网实测**（#103，2026-09-26，ego-browser 内置 Chromium 模拟手机竖屏触屏，开发构建在 `localhost`，本页禁用缓存，CDP 限速 450kbps / RTT 400ms）：从请求 master 到第一帧 3.7 秒（360p 起播），之后降到 240p 连续播放，30 秒内起播后没有再卡，缓冲从 3.7 秒涨到 18.7 秒。改之前手机从 480p 以上起播，同样条件下首帧约 30 秒。
- **2026-09-26 实测**（#77；ego-browser 内置 Chromium，M4 Pro，生产构建在 `localhost` 上，CDP 限速 Fast 4G = 9 Mbps / RTT 150ms）：在桌面停留、预取完成后按 1 打开「加入我们」，从按键到第一帧 587–628ms（三次，含 520ms 图标飞行动画），AV1，带声音。刚到桌面就立刻点（预取没做完）或直接打开 `/join-us`：播放层出现后 1.7–2.1s 出第一帧；Slow 4G（1.6 Mbps / RTT 560ms）约 8s。Safari（macOS、iOS）与微信内置浏览器未测。

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
- 竖屏（`lib/cameraMath.ts` 的 `STACKED_QUERY`：宽 ≤760px 或宽高比 <0.9，CSS 用同一条媒体查询）：文案叠在画面上下，3D 主体放进文案之间留出的横带。横带由页面量 DOM 得出（首页：顶栏下沿到文案上沿；场景页：主按钮下沿到底部列表上沿），`three/stage.ts` 的 `bandPose` 取主体贴身的角点、按透视投影算相机距离与 `setViewOffset` 偏移（纯数学在 `fitInBand`，有单测），文案尺寸变化时重新取景。不再为每种屏幕比例手调相机坐标。竖屏时首页不挂墙上的海报（会落在顶栏品牌后面）；触屏（`hover: none`）不显示 Enter 之类的按键提示。
- 窄屏（≤860px）的 YUGC OS：Dock 不再浮在内容上，而是排在滚动区下面的一条底栏（含 `safe-area-inset-bottom`），任何卡片的按钮都不会被它盖住。
- 文案：像班里的人在说话，短、具体，说清这是什么、给谁用、接下来会怎样；不写口号式标题和装饰性英文大写标签（RECRUITING、YUGC POST 之类），终端提示符只出现在真的终端里（终端窗口、终端组件、GitHub 场景里的小终端）。只写仓库里有出处的事实（部门与称号取自 `/api/public/org`，默认值与 `app/server/src/lib/roles.ts` 一致，版块说明取自 `app/forum/content/curation.json`）；服务端返回的文案（投递、意见箱、邀请的回执）原样显示。
- 浏览器自带的表面也用官网颜色：文字选中、光标、滚动条、焦点环、`accent-color`；计数、时钟、百分比用等宽数字（`font-variant-numeric: tabular-nums`）。卡片只有一种层级：细描边 + 贴身短投影；浮层（窗口、菜单、启动器、Dock）只用有偏移的投影。弱化文字 `--pt-ink-mute: #646b8a`，在纸色与冰白底上 ≥4.5:1。
- 官网表单不用原生下拉框：选项只有几个时用 `components/ChoiceChips.tsx`（意见箱分类）。

## 验收

`pnpm check && pnpm test && pnpm build`；浏览器验证见 [TESTING](../../conventions/TESTING.md)。单测覆盖状态机、加载进度、相机与摆放数学、像素比调速器、启动器过滤、终端、时间文案、快照结构、图标注册表与禁用字符。3D 画面、动画节奏与帧率只能在真实浏览器里验收，截图与测量结果写进 MR。
