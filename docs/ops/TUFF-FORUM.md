# Tuff Forum 本机运行与上游维护

> 独立启动直接引入的 Nuxt/TuffEx 原仓；本机有私有快照时显示极客班论坛内容，登录只走全站 GitHub 登录，不将其冒充生产论坛。

状态：`current` · 更新：2026-09-26

## 代码和环境

实际代码为 `app/forum`，上游提交 `37164f75c0258b65922ea2151592e1f4efce8bde`，MIT 版权声明保留。`UPSTREAM.json` 记录最初 82 个文件摘要。完整上游说明见 [原仓 README](../../app/forum/README.md)，服务合同（源码地图、契约、验证、限制）见 [forum 服务合同](../services/forum/README.md)，项目决策见 [ADR-0003](../decisions/0003-adopt-tuff-forum.md)。线上由 `yzgc/forum:<sha12>` 镜像提供静态产物，由 web 容器按 `/forum/*` 反代（见 [DEPLOY](DEPLOY.md)）。

论坛要求 Node >=26、pnpm 11.24.0；核心仍要求 Node 22、pnpm 9.15.9。`scripts/forum.mjs` 从根选择论坛工具链，不改系统默认 Node，不让 pnpm 9 改写论坛锁文件。当前 Mac 使用 `/opt/homebrew/bin/node` 和已隔离安装的 `.tools/pnpm11/package/bin/pnpm.cjs`。新机器应提供对应版本，可通过 `FORUM_NODE` 指定 Node 原生可执行文件，通过 `FORUM_PNPM` 指向 pnpm.cjs。它们是工具路径，不是登录凭据。

`GEEK_FORUM_CONTENT_DIR` 指定只读快照目录（须含 content.json、asset-index.json、manifest.json 和 assets/，相对路径按仓库根解析，不合格时 start 直接报错）；未设置时 `start|dev` 自动选择 `.tools/forum-runtime/` 下名称最大的合格快照目录，没有则用示例种子。`GEEK_FORUM_SOURCE=demo` 强制示例种子。`check`、`generate`、`verify` 默认以 `GEEK_FORUM_SOURCE=demo` 运行，静态产物里也没有快照路由。调用方显式给 `GEEK_FORUM_SOURCE=site` 时，`generate`/`check`/`start`/`dev` 按镜像的方式构建极客班论坛：站名「极客班论坛」、`curation.json` 里的分类和标签、`content/published` 里公开的旧帖，也不读快照目录（`GEEK_FORUM_SOURCE` 只接受不设置、空、`demo`、`site`，写错时 `forum.mjs` 以退出码 2 退出）；`verify` 忽略它，上游 CDP 验收只跑示例种子。例：`GEEK_FORUM_SOURCE=site GEEK_FORUM_BASE_PATH=/forum/ node scripts/forum.mjs generate`。start 确认实例后会用 HEAD 探测 `/api/local-forum/state`，快照损坏时直接打印机器码。

分类、标签、话题归类与润色正文在 `app/forum/content/curation.json` 和 `app/forum/content/posts/*.md` 中维护（规则见 [forum 服务合同](../services/forum/README.md)）：旧论坛内容默认不显示（`legacy.mode = "hide"`，没有「老帖归档」类别），要重新开启哪篇旧帖就把话题编号写进 `legacy.include`；新时代分类按 `categoryOrder` 排在侧栏；改动后重启 `pnpm forum:start` 生效，引用错误会让快照加载失败并显示错误。

上游 pnpm-workspace 设置不自动安装 Electron peer，只允许其列出的依赖安装脚本。本次安装沿用 frozen-lockfile；不要把论坛加入旧根 pnpm workspace 后统一重算版本。

## 根命令

```bash
pnpm forum:install
pnpm forum:check
pnpm forum:generate
pnpm forum:start
pnpm forum:status
pnpm forum:stop
pnpm forum:verify
```

本机访问 `http://127.0.0.1:3456/`。start 创建带唯一身份标识的独立预览进程，重复 start 复用同一实例；stop 先核对标识再结束本任务的整个进程组，避免 nuxt 残留占用端口。端口占用时不结束其他服务。`status` 输出 `contentSource`、`mode`（`local-snapshot`、`site` 或 `browser-demo`）和 `snapshotConfigured`（快照目录已配置，仍是静态只读投影，不是数据库连接）。`forum:verify` 只复用本仓库的示例模式预览；3456 上若是快照模式、极客班论坛（`site`）模式或非本仓库的监听者，会拒绝执行。日志在 `.tools/tuff-forum/dev.log`，运行状态在 `.tools/tuff-forum/runtime.json`，均不提交；没有开机自启。核心预览仍由 `scripts/local-preview.mjs` 管理，端口为 5173/3000。

CDP 浏览器套件可通过 `TUFF_FORUM_CHROME` 指定 Chrome/Chromium 原生二进制。根启动器优先复用本机已准备的 Playwright Chromium；没有浏览器时明确失败，不把未运行的套件算通过。每次验证创建独立临时 profile，只清理本次进程组和目录，不使用名称模式去结束用户浏览器。

## 数据和认证限制

快照模式（`mode: local-snapshot`）下页面显示极客班论坛内容，界面不再出现「只读快照」字样。登录方式与内容来源分开：除了 `forum.mjs` 的上游验收（`verify`）和示例种子上的本机预览（`start`/`dev` 没有快照目录），论坛一律走统一登录（`GEEK_FORUM_LOGIN=demo` 只由 `forum.mjs` 设置），镜像（极客班论坛）也是。统一登录下论坛**没有自己的登录**：登录是核心服务的全站 GitHub 登录，官网、论坛、控制台共用同一个 `sid` cookie。顶栏右上角是唯一的入口，读到 `/auth/me` 之前不显示；未登录是一个「用 GitHub 登录」按钮，指向 `/auth/github?return_to=<当前论坛页面>`，登录后回到这一页；已登录显示头像，菜单里是昵称与 `@<登录名>`、「我的主页」「账号资料」「我的书签」「通知」、「控制台」（只给 `/auth/me` 的 `console_link` 为 true 的人；同域 `/console`，本机开发是 5173 上的 `/console`）、「返回宣传主页」「查看环境与版本」和「退出」（`POST /auth/signout`，全站一起退出；服务端确认后才显示已退出），每一项都有图标。窄屏按钮只写「登录」。账号只在顶栏右上角的头像菜单；侧栏没有站点卡片和账号卡片，第一行是「筛选侧栏」；极客班校徽在顶栏左上角站名前（#62）。只有极客班 GitHub 组织（`CONSOLE_ORG`）的成员能登录成功；游客不登录照样浏览全部帖子。登录没成功时核心服务带 `?signin=not_member|invite_pending|cancelled|failed` 回到原页面，论坛弹一次 Tuffex toast 说明原因并把这个参数从地址里去掉。本机开发时论坛单独跑在 3456，`nitro.devProxy` 把 `/auth`、`/api/public/org`、`/api/forum` 转给 127.0.0.1:3000 并把 `Origin` 换成 5173（否则退出、回复会被核心的来源校验 403），登录入口指向 5173（见 [LOCAL-PREVIEW](LOCAL-PREVIEW.md)）。

快照模式只能看：GitHub 账号不对应快照里的论坛成员，会话固定为游客；`/new`、`/bookmarks`、`/notifications`、偏好设置页显示「……还没开放」，话题页最后一帖下方显示「回复还没开放」，「赞」「书签」「关注」弹 toast「现在还不能操作」。论坛状态与会话不写 localStorage（侧栏、主题等 UI 偏好仍存浏览器），附件经 `/api/local-forum/assets/<hash>` 只读提供并支持单段 Range，加载失败显示错误而不回退示例。

极客班论坛（`mode: site`，预发布与正式镜像用 `GEEK_FORUM_SOURCE=site` 构建）：站名「极客班论坛」，分类和标签来自 `app/forum/content/curation.json`，构建时带上 `app/forum/content/published` 里公开的旧帖（只有首帖，作者是「极客班」），没有上游示例内容；`/llms.txt` 与每篇公开旧帖的 `t/<id>.md` 按这份状态生成。页面打开后向核心服务要整份论坛（`GET /api/forum/state`）：游客能看帖、用昵称回复（浏览器里算工作量证明），成员能发帖、回复、编辑删除自己的帖子、点赞、收藏、关注、看通知、改资料和头像，版务按服务端下发的能力；核心服务连不上时只显示构建时的公开旧帖，写操作关闭。浏览器里不存论坛状态和会话。细节见 [forum 服务合同](../services/forum/README.md)「服务端模式」。本机想看极客班论坛接上后端的样子：先按 [LOCAL-PREVIEW](LOCAL-PREVIEW.md) 在 3000 起核心服务，再 `GEEK_FORUM_SOURCE=site pnpm forum:start`。

示例种子（`mode: browser-demo`，`forum:generate` 默认用它）只决定内容。只有 `forum.mjs verify` 与没有快照目录的 `start`/`dev` 设 `GEEK_FORUM_LOGIN=demo`，保留上游模拟身份选择及 localStorage，顶栏是示例的「登录」；默认的 `forum:generate` 是统一登录，不恢复浏览器里存过的示例会话，内容仍是上游示例帖子。发帖/回复/收藏等交互只改变本浏览器演示数据；换浏览器不会共享，清理浏览器存储或使用上游重置功能会丢失示例修改。停止 Nuxt 进程不会主动清空浏览器存储。请勿输入真实凭据、患者/学生资料或需要保留的数据。

核心 GitHub OAuth 与示例登录完全不同，不能跨用；示例身份不会进入 `sid` 会话。原仓接入阶段没有读取现有 .env、登录 GitHub/Cloudflare、发送邀请或部署公网。随后获准的[原始数据拉取](FORUM-DATA-CAPTURE.md)生成本机私有备份和只读投影；快照模式只读取该投影，不连接任何数据库，也不代表已迁移到可写论坛服务。**未做**：旧论坛账号（包括当年用 GitHub 登录过的）还没有和现在的 GitHub 登录关联，改过的姓名也没有同步；帖子作者仍只是快照里的旧账号。

## 更新与差异管理

未来上游更新须固定新 commit，审阅 LICENSE、依赖和行为变化，运行完整检查，逐项回放本项目的小型集成差异。原始摘要不能随便重生成来让漂移检查通过；同时更新新基线、迁移记录及可回滚备份。不删除 MIT 作者和许可文本。

## 发布准入

极客班论坛的存储与授权在核心服务（#57），前端按服务端的回答显示和提示，授权只在服务端；用前端路由重定向或任意用户选择器保护内部数据无效。旧论坛账号的迁移与认领（#58）还没做。上游 Cloudflare 草案不构成自动部署/购买授权。生成静态产物通过仅证明构建可用。
