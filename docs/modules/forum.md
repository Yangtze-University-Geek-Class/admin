# Forum 模块合同

> 直接采用 Tuff Forum 原代码、TuffEx 组件与验证方式；本机可只读显示极客班论坛快照，仍无真实认证与后端。

状态：`current` · 更新：2026-09-13

## 所有权与来源

唯一活动实现为 `modules/forum`。上游 `talex-touch/tuff-forum`，固定提交 `37164f75c0258b65922ea2151592e1f4efce8bde`，MIT © 2026 TalexDreamSoul。原始文件摘要见 `UPSTREAM.json`，必须保留 LICENSE。旧 React 页面、Fastify 论坛路由和专属身份实现已归档，不再修出平行论坛。决策见 [ADR-0003](../decisions/0003-adopt-tuff-forum.md)。

## 工程边界

Node >=26、pnpm 11.24.0；Nuxt 4/Vue 3、Pinia、UnoCSS、TuffEx 0.6.0。独立 pnpm workspace 和锁文件，根命令只做进程编排，不能跨包导入核心 React 页面、Fastify 模块或数据库。`app/pages` 管路由，`components` 管组合，`composables` 管交互状态，`stores` 管原仓数据和操作，`data` 管类型、种子、权限与序列化。

UI 依照 [Tuffex 使用政策](../components/tuffex/USAGE-POLICY.md)，同时保留原仓更严格的样式规则：使用真实 Tx 组件 props/slots 和 Uno 工具类，无项目自定义样式表、Vue style 块、内联样式写入。保留组件自动注册与库内图标 safelist 收集，不手工仿制同名 React 组件。当前全量组件 CSS 是上游明确采用的集成方案，不随意删除导致组件失样式。

## 当前身份与数据

示例模式：`stores/session.ts` 的 login 只是选择示例用户；`plugins/persist.client.ts` 使用 localStorage 保存示例状态。没有真实认证、服务端权限、共享数据库、附件存储或邮件服务。界面权限和 store 测试仅验证演示行为，不承担安全边界。不得加载旧论坛会话或向后台传递示例 role 以取得真实权限。

只读快照模式：根 `scripts/forum.mjs start|dev` 发现 `.tools/forum-runtime/<快照>/` 或收到 `GEEK_FORUM_CONTENT_DIR` 时，把该目录交给 Nuxt。dev 专用 Nitro 路由 `server/routes/api/local-forum/state` 与 `assets/[hash]` 只读提供 `content.json`、`asset-index.json` 和 `assets/`；`plugins/local-snapshot.client.ts` 经 `shared/local-snapshot.ts` 校验后整体替换 store，会话固定为游客，`persist.client.ts` 不把论坛状态和会话写入 localStorage（侧栏、主题等 UI 偏好仍存本机浏览器）；示例用户选择器、重置控件和 `/new` 命令不再出现，所有「登录」触发点改为打开只读说明；`LocalSnapshotGate` 在数据到达前不挂载页面，加载失败显示错误而不回退示例种子。两条路由仅 dev 服务器提供、只接受 GET/HEAD，资产只按 64 位小写哈希解析，类型与 disposition 取自索引，SVG 不在允许列表，响应 no-store，支持单段 Range。这仍是本机只读展示：没有真实登录、写入、跨设备持久化或服务端授权；`GEEK_FORUM_SOURCE=demo` 可强制回到示例种子。

编辑层：`content/curation.json` 与 `content/posts/*.md` 由 `shared/local-curation.ts` 在服务端应用于快照，再经 `parseSnapshotState` 重新校验。规则固定为：投影里标记 `archived` 的旧分类全部并入「老帖归档」一个分类，每个旧帖以 `legacy-<原分类 id>` 标签保留原分类名；`categories`/`tags` 新增新时代分类与标签，`categoryPatches` 只允许改 name/description/color/icon，`categoryOrder` 决定侧栏顺序，`topics` 可改标题、分类、标签、置顶，`posts` 用 `contentFile` 指向润色后的 Markdown。任何引用不存在的 id 都让加载失败（503 `invalid_state`），不静默跳过。编辑后需重启 `pnpm forum:start`。原投影文件不被修改；旧分类 URL（`legacyLinks.categories`）尚未映射到归档标签页。

演示种子可复现；测试不允许通过随机新 ID 改写原仓确定性约定。用户浏览器内的示例内容不在不同设备同步。上游“重置示例数据”只由用户明确点击执行，不在迁移脚本中清理用户存储。

## 环境和版本显示

“关于”页的 DeploymentInfo 显示 local / preview / production。固定域名来自根 deploy/environments.json：prev.yangtzeu.work 预发布，yangtzeu.work 正式。本机明确标记“本地开发 · 未发布”，另按内容来源标记“上游示例”或“极客班论坛只读快照 + 采集时间”。Nuxt 配置只读取公共的域名/版本合同，不跨模块引用 React、Fastify 或业务数据。GEEK_RELEASE_VERSION 和完整 GEEK_RELEASE_COMMIT 只由受控构建注入，不是人已验收的证据。

## 验证

从根执行 `pnpm forum:check`：Nuxt 类型、测试类型、ESLint、样式 guard、Vitest；`pnpm forum:generate` 验证静态构建；`pnpm forum:verify` 运行 guard 自测及原仓 CDP 四套交互和全路由 smoke。CDP 使用独立临时浏览器，只清理本次进程组。原仓单测与旧 Fastify 的历史测试不能混算。`forum:check/generate/verify` 始终以示例种子运行、不转发快照目录；3456 上若有快照模式预览，`forum:verify` 拒绝执行并要求先 `forum:stop`。快照文档与资产索引的解析规则由 `tests/local-snapshot.test.ts` 用虚构夹具覆盖，测试不读取真实投影。

## 生产准入

真实统一认证、后端持久化、服务器授权与内部 Hub 未实现前，不作为生产内部论坛开放。后续在该原代码上接入真实服务，而不是重新启用旧论坛。原始数据库和附件已按后续明确授权拉到 Mac 私有备份目录，见 [数据保全](../ops/FORUM-DATA-CAPTURE.md)；由 `prepare.py` 生成的只读投影可按上文快照模式在本机显示，但未导入可写数据库、未激活旧会话。目标数据模型转换、身份认领和上线仍需另行设计/验收，不删除源数据。运行入口见 [TUFF-FORUM](../ops/TUFF-FORUM.md)。
