# 测试与验收规范

> 核心真实路由与上游论坛演示分别验收；类型、行为、构建和生产证据不相互替代。

状态：`current` · 更新：2026-09-23

## 根入口和分工

`pnpm check/test/build` 验证核心 `app/web` + `app/server`；`pnpm forum:check` 验证 `app/forum` 的 Nuxt 类型、测试类型、ESLint、样式规则和单测；`pnpm forum:generate` 生成静态产物。根 `pnpm verify` 顺序编排两者，任一步失败应非零退出。

浏览器分别执行 `pnpm test:e2e` 和 `pnpm forum:verify`。后者保留上游样式 guard 自测、四套 CDP 行为测试和全路由 smoke，并验证图标真正渲染。未找到浏览器不能算套件通过。工具版本分别固定，不能让 Node 26 测试复用核心 SQLite 的 Node 22 二进制。

## 隔离

核心使用 `buildApp`/`inject` 注册真实路由，仅 `DB_PATH` 指向内存库，外部 HTTP 和 GitHub 默认拒绝，需响应的用例明确注入模拟。不能复制 handler 验证另一份实现，不读取 `.env` 或业务数据库，不发送真实邀请。

论坛上游测试操作确定性种子和浏览器 localStorage。每次 CDP 使用自己创建的临时 profile，不打开用户已有浏览器配置，不清理用户示例数据。只关闭本次创建的进程组，禁止广泛 pkill。其登录/权限测试证明演示交互，不证明真实身份或服务器授权。`forum:verify` 只对示例种子运行；3456 上若是快照模式预览，先 `forum:stop`。快照解析规则用虚构夹具单测（`app/forum/tests/local-snapshot.test.ts`），不读取真实投影。

## 回归矩阵

核心：实例隔离、不打开旧论坛库、真实文档非空、内部文档不公开、保留 GitHub OAuth 和组织权限、篡改状态拒绝、退出清会话、邀请并发和不确定结果、旧 API 返回 410、生产缺少论坛服务失败关闭。

论坛：种子确定性、store 状态、权限 helper、持久化解析、提及；桌面/移动 shell、主题筛选/排序/分页、回复/引用/编辑/软删/收藏/点赞、用户资料、通知与全路由图标。开发提醒不得遮挡主流程。

核心 UI：危险操作取消、焦点返回、移动导航、文档语言及入口；门户论坛链接必须指向 `app/forum` 的新入口，不加载旧 React 论坛。工程检查要覆盖真实导入解析、别名、反向依赖、站点 host 一致性和文档同步。

## 分支、环境与发布门禁回归

`tests/tooling/deployment-environment.test.ts` 在临时目录合成夹具，验证 `.env.production` / `.env.preview` 的字段契约（非密值必须预填、密钥必须留空、两环境端口与域名必须不同）与 [deploy/environments.json](../../deploy/environments.json) 的一致性；它不读取真实密钥、不连接服务器。

分支不变量由 `scripts/check-branch-invariants.mjs` 检查（`tests/tooling/branch-invariants.test.ts` 用临时 Git 仓库覆盖不变量与命名规则）：`--require-remote-refs` 在 CI 上核对真实远端 refs，`--push` 供本地 pre-push 使用；本地也可以用同一命令自查（见 [BRANCHING](BRANCHING.md)）。这类检查只读 Git 证据，不 fetch、不改 refs。

`tests/tooling/release-policy.test.ts` 在临时 Git 仓库里覆盖分支模型：`main`/`stage` → 两个环境的唯一映射、拒绝个人/任务分支、拒绝非末端或不存在的提交、拒绝已退役的 tag/版本/批准开关、以及「规划只读」（不写文件、不改 refs、不动工作区）。`scripts/release-bundle.mjs` 与 `tests/tooling/release-bundle.test.ts` 已随发布包模型一起删除。任何规划输出都**不授予**部署批准（`deploymentAuthorized: false`），自动测试也不替代人工试用。

授权数据拉取后使用 `scripts/forum-migration/verify.py` 逐文件核对哈希，并将冻结的 SQLite 在线备份恢复到内存核对所有表/条数。它是这次数据交付的单独核验，不是让常规 CI 使用真实用户数据。未来 capture/verify 工具单测只能使用虚构临时文件。

## 退役与报告

旧论坛专属测试随源码归档，不在新工程假运行，也不混入新结果。保留的核心邀请和 OAuth 行为必须在新 fixture 下重验。报告分别记录核心测试、原仓测试、浏览器场景、构建以及未执行项；不能用此前 48 项结果替代新架构证据。

验收中修改源码后重跑相关验证；mock 界面、静态生成、真实后端及生产验收是不同层次。统一认证、后端持久化或上线未实施时必须明确记录，禁止写“全线生产迁移已完成”。
