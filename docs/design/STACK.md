# 当前技术栈与版本治理

> 记录已采用框架及版本来源，未来升级另立提议。

状态：`current` · 更新：2026-09-24

## 核心包：app/web + app/server + app/console

| 层 | 当前方案 | 版本线 |
|---|---|---|
| 工作区 | pnpm workspace，`app/web`、`app/server`、`app/console` 三包（论坛独立） | pnpm 9.15.9 |
| 运行时 | Node.js，TypeScript ESM | Node 22，至少 22.13 |
| 前端（官网 app/web） | React / React DOM | 18.3 |
| 路由 | react-router-dom，Declarative | 7 |
| 查询 | TanStack Query | 5 |
| 构建 | Vite / TypeScript（官网 Vite 6，控制台 Vite 7） | 6、7 / 5 |
| 样式 | Tailwind / PostCSS / CSS 变量 | Tailwind 3 |
| 后端 | Fastify 与 Cookie/限流/static（`app.ts` 只注册这三个插件，没有 multipart） | Fastify 5 |
| 持久化 | SQLite WAL / better-sqlite3（命名卷中的文件；**未迁移 Postgres**） | better-sqlite3 11 |
| GitHub/网络 | Octokit / OAuth / undici | 锁文件版本 |
| 内容 | marked / DOMPurify / highlight.js | 锁文件版本 |
| 遗留依赖 | `app/server` manifest 仍声明 `@fastify/multipart`、`multer`、`sharp`、`marked`、`dompurify`、`isomorphic-dompurify`、`bcryptjs`，server 源码不使用（`bcryptjs` 只被死代码 `password-policy.ts` 引用）；旧论坛上传接口已退役，不代表任何现役能力，清单见 [server 合同](../services/server/README.md) | 锁文件版本 |
| 测试 | Vitest / Testing Library / jsdom / Playwright | Vitest 3 |
| 交付 | Docker 镜像 + Docker Compose（两套栈：`/opt/yzgc/production`、`/opt/yzgc/preview`）+ 宿主 nginx TLS 终止；基础镜像 `node:22-bookworm-slim`（server；web 构建）、`node:26-bookworm-slim`（forum 构建）、`nginx:1.31-alpine`（web/forum 运行） | Node 22 / nginx 1.31 / compose v2 |

控制台 `app/console` 的锁定版本：Vue 3.5.42、vue-router 4.6.4、@talex-touch/tuffex 0.6.0（与论坛同版本）、Vite 7.3.6、@vitejs/plugin-vue 6.0.9、UnoCSS 66.10.2（只用图标预设）+ @iconify-json/carbon 1.2.27、vue-tsc 3.3.11。Tuffex 与 `@talex-touch/utils` 声明 Node ≥26，控制台在 Node 22 上构建与运行，已实测；`@talex-touch/utils` 的 `electron` peer 由根 `pnpm.packageExtensions` 标为可选，锁文件不含 electron；`@unocss/inspector` 的 `@vitejs/devtools-kit` 由 `pnpm.overrides` 固定 0.7.3。详见 [console 合同](../services/console/README.md)。

精确声明范围来自 package.json，精确解析版本来自 pnpm-lock.yaml，执行环境由 check:runtime 输出。声明 `^5.7.2` 不等于安装版本一定为 5.7.2。核心不因历史研究中的 React 19、Vite 8、Tailwind 4、Router 8、TypeScript 7 提议而自动升级；新论坛的独立 Vite 版本以下表为准。**数据层现状是 SQLite，Postgres 迁移未做**，不得写成已完成。

## 已直接采用的论坛包：app/forum

| 层 | 本机实际解析版本/配置 |
|---|---|
| 原仓 | talex-touch/tuff-forum @ 37164f75c0258b65922ea2151592e1f4efce8bde |
| 运行时与包管理 | Node 26.8.2（上游要求 >=26），pnpm 11.24.0 |
| 框架与状态 | Nuxt 4.5.2、Vue 3.5.42、Pinia 4.0.3 |
| 组件与样式 | @talex-touch/tuffex 0.6.0、UnoCSS 66.10.2 |
| 内部构建 | Vite 8.2.2、Nitro 2.13.4，Nuxt SPA 模式 ssr:false |
| 测试 | Vitest 3.2.7、原仓 CDP Chromium 验收 |
| 数据与认证 | 部署镜像（site 模式）：极客班论坛自己的分类和标签在构建时写入，没有帖子和用户，不写 localStorage；示例模式：浏览器 localStorage 和示例身份；本机快照模式：dev 专用 Nitro 只读路由提供的极客班投影；论坛本身都没有后端和认证，顶栏登录入口走全站 GitHub 登录（示例预览和上游验收除外） |

来源为 `app/forum` 的 manifest、独立锁文件、已安装包及 Nuxt 启动输出，不声称 npm latest。工具链通过根 forum:* 编排，两套 node_modules 不混用，MIT 许可保留。详见 [论坛服务合同](../services/forum/README.md)。

## 后续 UI 已接受选型

用户指定 Tuffex，详见 [使用政策](../components/tuffex/USAGE-POLICY.md) 与 [AI 文档库](../components/tuffex/README.md)。本地参考源码包为 @talex-touch/tuffex 0.6.0，声明 Node >=26 和 Vue ^3.5.27，依据见 [SOURCES](../components/tuffex/SOURCES.md)。这些参考快照字段不等于 npm latest；论坛本次独立安装也已核实 0.6.0，其他模块迁移情况不能从快照推断。

既有 `app/web` 包（官网）仍是 React/Node 22 环境；控制台已按本选型迁到 `app/console`（Vue 3 + Tuffex，Node 22 根工作区）；其他新增或并行迁移的服务应分别核对实际 manifest。Vue 组件不能直接当作 React 组件使用。组件文档建设与论坛代码接入是不同变更，实际迁移状态以各服务代码和验收为准。

## 升级准入

明确安全修复、支持周期或实际收益；查官方兼容性；先验证运行时和原生 ABI；固定解析并执行完整回归/浏览器验证。框架大版本独立变更，不仅为追新而打包升级。测试和图片解码能力补充不意味着业务框架迁移。

## 环境一致性

.nvmrc、.node-version 和 engines 表达同一基线。系统 Node 可以不同，但项目命令必须选择正确版本。切换 Node 后重新准备原生依赖，不提交运行时下载、缓存或本机路径。未引入 SSR、Next.js、ORM 重写；容器编排限于 `deploy/compose` 的两个栈模板，不引入 Kubernetes 或多节点编排。

官方支持信息：https://nodejs.org/en/about/previous-releases 。升级时重新核对，不把本文视为永久兼容矩阵。
