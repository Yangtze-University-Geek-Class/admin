# Tuff Forum 本机运行与上游维护

> 独立启动直接引入的 Nuxt/TuffEx 原仓；本机默认只读显示极客班快照，不将其冒充生产论坛。

状态：`current` · 更新：2026-09-13

## 代码和环境

实际代码为 `app/forum`，上游提交 `37164f75c0258b65922ea2151592e1f4efce8bde`，MIT 版权声明保留。`UPSTREAM.json` 记录最初 82 个文件摘要。完整上游说明见 [原仓 README](../../app/forum/README.md)，服务合同（源码地图、契约、验证、限制）见 [forum 服务合同](../services/forum/README.md)，项目决策见 [ADR-0003](../decisions/0003-adopt-tuff-forum.md)。线上由 `yzgc/forum:<sha12>` 镜像提供静态产物，由 web 容器按 `/forum/*` 反代（见 [DEPLOY](DEPLOY.md)）。

论坛要求 Node >=26、pnpm 11.24.0；核心仍要求 Node 22、pnpm 9.15.9。`scripts/forum.mjs` 从根选择论坛工具链，不改系统默认 Node，不让 pnpm 9 改写论坛锁文件。当前 Mac 使用 `/opt/homebrew/bin/node` 和已隔离安装的 `.tools/pnpm11/package/bin/pnpm.cjs`。新机器应提供对应版本，可通过 `FORUM_NODE` 指定 Node 原生可执行文件，通过 `FORUM_PNPM` 指向 pnpm.cjs。它们是工具路径，不是登录凭据。

`GEEK_FORUM_CONTENT_DIR` 指定只读快照目录（须含 content.json、asset-index.json、manifest.json 和 assets/，相对路径按仓库根解析，不合格时 start 直接报错）；未设置时 `start|dev` 自动选择 `.tools/forum-runtime/` 下名称最大的合格快照目录，没有则用示例种子。`GEEK_FORUM_SOURCE=demo` 强制示例种子。`check`、`generate`、`verify` 永远以 `GEEK_FORUM_SOURCE=demo` 运行，静态产物里也没有快照路由。start 确认实例后会用 HEAD 探测 `/api/local-forum/state`，快照损坏时直接打印机器码。

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

本机访问 `http://127.0.0.1:3456/`。start 创建带唯一身份标识的独立预览进程，重复 start 复用同一实例；stop 先核对标识再结束本任务的整个进程组，避免 nuxt 残留占用端口。端口占用时不结束其他服务。`status` 输出 `contentSource`、`mode`（`local-snapshot` 或 `browser-demo`）和 `snapshotConfigured`（快照目录已配置，仍是静态只读投影，不是数据库连接）。`forum:verify` 只复用本仓库的示例模式预览；3456 上若是快照模式或非本仓库的监听者，会拒绝执行。日志在 `.tools/tuff-forum/dev.log`，运行状态在 `.tools/tuff-forum/runtime.json`，均不提交；没有开机自启。核心预览仍由 `scripts/local-preview.mjs` 管理，端口为 5173/3000。

CDP 浏览器套件可通过 `TUFF_FORUM_CHROME` 指定 Chrome/Chromium 原生二进制。根启动器优先复用本机已准备的 Playwright Chromium；没有浏览器时明确失败，不把未运行的套件算通过。每次验证创建独立临时 profile，只清理本次进程组和目录，不使用名称模式去结束用户浏览器。

## 数据和认证限制

快照模式下页面显示极客班论坛只读快照：「登录」只打开只读说明，没有发帖、回复或资料修改，论坛状态与会话不写 localStorage（侧栏、主题等 UI 偏好仍存浏览器），附件经 `/api/local-forum/assets/<hash>` 只读提供并支持单段 Range，加载失败显示错误而不回退示例。示例模式保留上游模拟身份选择及 localStorage。发帖/回复/收藏等交互只改变本浏览器演示数据；换浏览器不会共享，清理浏览器存储或使用上游重置功能会丢失示例修改。停止 Nuxt 进程不会主动清空浏览器存储。请勿输入真实凭据、患者/学生资料或需要保留的数据。

页面提醒说明这些限制。核心 GitHub OAuth 与示例登录完全不同，不能跨用。原仓接入阶段没有读取现有 .env、登录 GitHub/Cloudflare、发送邀请或部署公网。随后获准的[原始数据拉取](FORUM-DATA-CAPTURE.md)生成本机私有备份和只读投影；快照模式只读取该投影，不连接任何数据库，也不代表已迁移到可写论坛服务。

## 更新与差异管理

未来上游更新须固定新 commit，审阅 LICENSE、依赖和行为变化，运行完整检查，逐项回放本项目的小型集成差异。原始摘要不能随便重生成来让漂移检查通过；同时更新新基线、迁移记录及可回滚备份。不删除 MIT 作者和许可文本。

## 发布准入

当前只能用作本地原仓体验，不是可上线的内部社区。必须先实现服务器身份、权限、真实存储和迁移策略，再对接统一 Hub；用前端路由重定向或任意用户选择器保护内部数据无效。上游 Cloudflare 草案不构成自动部署/购买授权。生成静态产物通过仅证明构建可用。
