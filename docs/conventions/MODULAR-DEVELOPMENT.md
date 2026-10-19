# 模块化开发规范

> 职责清楚、依赖单向、契约明确；`app/` 与 `docs/services/` 严格对齐，不为目录形式制造部署复杂度。

状态：`current` · 更新：2026-10-18

## 当前边界

- 前端：官网在 `app/web/sites/portal`，拥有本端路由、页面、业务组件；共享 React 适配在 `app/web/shared`，不得反向导入站点。极客班控制台是独立的 Vue 3 + Tuffex 包 `app/console`（[console 合同](../services/console/README.md)），与 `app/web` 互不导入，也不导入 `app/server` 源码。
- 论坛：`app/forum` 是直接采用的 Nuxt/Vue/TuffEx 原仓工程，不导入核心 React 实现，也不被核心导入。
- 后端：`app/server/src/routes/<module>/index.ts` 是模块注册入口，`contracts.ts` 是输入协议源，路由只处理 HTTP 映射、授权与调用。多处写操作共用的规则放在具名策略/服务中，不在每个 handler 复制归档、锁定、删除幂等或额度校验。
- 组装：`app/web` 官网与 `app/console` 控制台各自构建，产物共同装进 web 镜像；`app/server` 由 `app.ts` 组装、`index.ts` 监听，`app/forum` 独立构建。四个源码应用对应 `web`、`server`、`forum` 三个运行单元，镜像仓库按环境分开（`yzgc-preview/*`、`yzgc-production/*`，见 [DEPLOY](../ops/DEPLOY.md)）。

跨服务只通过显式 URL、HTTP 契约及后续统一认证接口连接，禁止共用可变 store 或直接读取对方数据库。

## 目录与文档对齐（硬规则）

**新增服务 = 新增 `app/<service>` + 新增 `docs/services/<service>/README.md`**，两处缺一即视为未完成；模块细节放同目录子文档。`docs/README.md` 是 app ↔ docs ↔ 规范的三列地图。已退役的 `docs/modules/` 目录不再重建。

## 允许的依赖方向

```text
前端站点 -> shared -> 通用依赖
后端启动 -> 应用组装 -> 路由模块 -> 策略/持久化/适配器
                         -> 显式应用服务
论坛 Nuxt 应用 -> 其自有 shared/ 与组件库（不跨入核心包）
```

禁止站点之间导入、shared 导入站点、路由模块互相导入、底层基础设施导入路由或应用组装。身份/持久化适配器 `app/server/src/lib` 不得反向导入 HTTP 中间件；身份适配只接收普通参数和返回结果，不接受 Fastify 请求/响应对象。旧论坛 OAuth 桥接已退役，不能重新引入到 `app/forum`。配置类型是基础合同而不是启动逻辑，可被类型导入。跨前后端不得导入对方实现；协议通过独立类型或生成合同共享。

检查由 TypeScript AST 解析静态 import、动态 import、re-export、import-type，并解析后端 `.js` 指向 `.ts` 以及 tsconfig 声明的路径别名，不以导入名称判断所属模块。本地导入或已声明别名解析失败不是忽略理由，检查必须失败；不允许靠新增别名绕过检查。CSS 选择器、运行时 HTTP 调用和跨站 URL 的语义还需测试，不宣称 import 检查覆盖它们。论坛另行执行自身的 Nuxt 类型、ESLint、TuffEx 样式 guard 和浏览器验收；根 TypeScript 检查不自动证明 Vue 源码正确。

## 数据与事务

`data.db` 由核心服务 `app/server` 拥有，保存反馈、邀请、投递、称号与能力配置、审计、邮件队列和论坛业务数据；位于本环境自己的命名卷（容器内 `/data/data.db`），不跨环境共享。论坛前端经核心 `/api/forum/*` 访问，不能直接读库。旧 `forum.db` 与附件按授权[保全](../ops/FORUM-DATA-CAPTURE.md)；代码退役不授予删除旧数据的权限。公开旧帖只作为核心后端的只读播种输入；本机私有快照是另一条开发专用只读路径，不是在线论坛的数据源。核心 SQL 值参数化，动态列名只来自代码允许列表。

应用、运行单元、业务域及数据表的关系见[项目目录](../architecture/catalog/README.md)。它记录实际结构与显式归属，不要求一个业务只能对应一个接口或一张表；业务规则与权限仍以服务端实现和对应合同为准。

一次本地业务状态变化及派生计数应处于同一事务。外部请求不能放进长事务。邀请额度先原子预留，再调用 GitHub；明确失败可补偿，结果未知保留待核对状态，不能盲目重试。删除重试不得再次扣计数。

## 新增功能的固定步骤

明确产品服务、数据所有者与文档落点（`docs/services/<service>/`）；先定义请求/响应、错误和权限；加入本模块路由或 feature；复用既有策略，不跨模块取数据库实现；补真实路由测试；更新服务文档与 [API](../architecture/API.md)/[USAGE](../ops/USAGE.md)；通过根验收。

## 拆分尺度

按职责拆，不按任意行数拆。单个页面混合仓库浏览、提交历史、Issue、PR、设置时按 feature 拆；公用文件不自动承接所有「以后可能复用」的代码。新增抽象必须至少解决一个真实重复、生命周期问题或测试隔离问题。

仅在确实出现不同部署周期、扩缩容、安全隔离或团队 ownership 时评估独立服务。不为目录审美增加微服务或数据库；但用户明确要求直接采用另一技术栈原仓时，允许独立包、锁文件和运行时，根入口负责编排。论坛这一已接受例外见 [ADR-0003](../decisions/0003-adopt-tuff-forum.md)，先前决策见 [ADR-0001](../decisions/0001-modular-monolith.md)。当前三个服务仍由同一套 compose 模板、同一台机器上的两套栈交付，不等于微服务化。
