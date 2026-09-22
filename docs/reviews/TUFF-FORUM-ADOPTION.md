# Tuff Forum 原仓替换验收记录

> 已直接采用原仓前端并切换本机入口；不将缺少真实认证和后端的演示称为生产社区。

状态：`current` · 更新：2026-09-13

> **模型变更（2026-09-23）**：本文记录于 `next` 分支 / `main`+`release-*`+`prev-*` tag 发布模型时代；该模型已被 [BRANCHING](../conventions/BRANCHING.md)（长期只有 `main` 与 `stage`）与 [RELEASES](../conventions/RELEASES.md)（分支驱动、无 tag 流程）取代。下文引用的分支名与 tag 规则只作当时证据。


## 任务与基线

用户明确要求通过 Mac 拉取 tuff-forum，直接采用代码、放弃原论坛，而非只参考设计重写。项目 geek_main，next 分支，核心 HEAD 0602bb5e4b376c2842edb1edfd1faf9da73dd4ad。原有规范化改动及并行新增的 TuffEx 文档均保留，发生哈希不一致时重新读取并合并，没有覆盖新增规范。

上游来源：https://github.com/talex-touch/tuff-forum ，提交 37164f75c0258b65922ea2151592e1f4efce8bde。82 个跟踪文件完整引入 `app/forum`，MIT © 2026 TalexDreamSoul。`app/forum/UPSTREAM.json` 保留原始 SHA256；80 个原始文件逐字节不变，2 个原始文件有已登记集成改动：default 布局插入演示提醒；CDP 工具支持本机 Chromium 路径并使用自有进程组清理。新增模块指针、提醒组件、进程身份标记和元数据不替换上游业务实现。

## 已交付

新模块沿用 Nuxt 4.5.2、Vue 3.5.42、Pinia 4.0.3、UnoCSS 66.10.2、TuffEx 0.6.0，保留上游组件自动注册、图标 safelist、ESLint、样式检查、自测、数据和交互测试。Node >=26 / pnpm 11.24.0 工具链独立，核心仍是 Node 22 / pnpm 9。

旧 React 论坛、Fastify 论坛路由、专属身份/数据库/策略实现及对应测试从活动工程移到 .tools/retired-forum，不再构建或注册。核心只创建 data.db，真实 GitHub 组织管理和邀请保留；旧论坛 API 返回 410。旧页面仅导向新首页，不猜测旧主题编号。

根 forum:* 命令提供安装、检查、生成、启动、状态和停止。源码来源与差异 guard 在 check/build/generate 前执行。核心 portal/header/footer 的论坛入口已指向独立 Nuxt 服务。

本机预览：核心 http://127.0.0.1:5173 ，API http://127.0.0.1:3000 ，新论坛 http://127.0.0.1:3456 。仅回环端口，无开机自启，无公网部署。原 4173 服务未操作。

## 实际验证

| 验证 | 结果与范围 |
|---|---|
| 根 pnpm verify | 通过：核心 check/test/build + 原仓 check/generate |
| 核心单元/路由/工具/组件 | 7 个文件，42/42 通过；含保留的并行 TuffEx 文档测试 |
| 核心 Chromium | 4/4 通过：文档语言、危险操作取消/焦点、移动导航、页头页尾论坛入口 |
| 原仓 Vitest | 5 个文件，97/97 通过 |
| 原仓类型、测试类型、ESLint、样式 guard | 通过 |
| 样式 guard 自测 | 8 项违规反例与 6 项允许项全部通过 |
| 原仓 CDP 验收 | 全部 7 阶段通过：样式、guard 自测、shell、话题列表、主题详情、用户页面、路由 smoke |
| 原仓路由 smoke | 16 路由 × 2 视口 × 2 示例身份，64/64 通过，1036 个图标检查，0 console problems |
| 核心构建 | portal/admin 两个 HTML + Fastify 产物，无旧 React 论坛入口 |
| Nuxt generate | 通过，.output/public 生成 12 个 SPA 路由入口/回退页；ssr:false 不代表预渲染了业务正文 |
| 实际运行服务跨入口 | 浏览器点击官网主导航到 3456 新论坛，提醒和 Tx 侧栏可见；旧页面 302、旧 API 410、healthz 200、0 page errors |
| 源码来源检查 | 82 文件中 2 处登记差异，原始 MIT、package.json、锁文件未改 |

浏览器场景保留原仓断言，包括筛选、分页、引用、编辑、软删、关闭/置顶、发帖、资料、关注、通知、书签、搜索、移动和主题切换。这些操作验证浏览器演示，不是服务端权限或真实数据库。

本机截图在 .tools/tuff-forum/screenshots/forum-desktop.png 与 forum-mobile.png。上游交互报告和截图在 modules/forum/reports（已忽略），无需把生成物加入源码。

## 处理过的问题与告警

原仓浏览器脚本硬编码 Google Chrome 应用位置，本机没有该路径；已改用现有 Playwright Chromium并补充缺失可执行文件错误处理，重新运行全部套件成功。首次门户链接测试同时匹配页头/页尾而触发严格定位错误，已分别验证两个入口，重跑通过，未删除断言或降低行为要求。

pnpm 子进程 PATH/新安装脚本执行位问题已通过独立工具链解决。文档编辑出现的 SHA 冲突和精确匹配失败没有产生部分写入；重新读取后保留新增 TuffEx 规范。Nuxt 构建有上游 h3 未使用导入警告，不影响退出状态；没有通过关闭检查消除它。

## 备份与数据

源码备份：.tools/backups/pre-tuff-forum-20260913-022147/source.tar.gz、retired-source.tar.gz；旧文档副本也保存在同一目录。备份先验证后才移出旧实现。

旧业务数据库和附件没有读取、删除或导入。核心本地预览重启清空的是它自己的隔离内存数据，不是业务库。新论坛 localStorage 不因服务重启清空；没有在用户浏览器中执行重置。

## 尚未交付

上游 README 明确没有真实后端/认证。选择示例用户不是 GitHub 登录，localStorage 不是跨设备存储，Cloudflare PRD 是 Draft。统一 GitHub 登录 Hub、认证 Provider 扩展、服务注册协议、新论坛服务器权限/持久化、旧数据迁移和 3D 游戏感品牌界面尚未实施，不能用此次前端替换代替它们。

未部署生产、配置 DNS/TLS/Cloudflare、购买服务、访问真实 GitHub 写接口、读取 .env、提交或推送代码。旧凭据泄漏仍需所有者轮换，本次迁移没有解决历史泄漏。测试通过不证明所有安全问题消失或达到 WCAG/ASVS 等级。

后续必须在所采用的原仓上接入真实服务，不恢复平行旧论坛。规范入口为 [docs README](../README.md)，采用决策为 [ADR-0003](../decisions/0003-adopt-tuff-forum.md)。

## 工具收尾记录

WebCodex 汇总仍显示已有的两个 secret-like 文件名提示和历史失败/stale 验收账目，没有活动 Job 或冲突；不能把工具汇总称为全绿。该汇总未反映本次成功 Job 的全部结果，实际证据分别是：96f793c1-60d4-41fc-b192-aff34ec63677（根 verify，exit 0），ac4b94f7-6f7c-405d-9c45-9697905b6b8c（原仓 check + 全部 CDP，exit 0），0cbc5449-7f85-4590-87d6-a52fa82fec9e（42 项核心测试 + 4 项 Chromium，exit 0），b6b9d5c0-abd0-46ee-bedd-7324c21e18db（运行服务间实际导航，exit 0），39b36db3-c8f6-475b-9947-8291269ba616（最终文档、来源、类型和差异检查，exit 0）。不为消除汇总提示删除工程文件或重复重跑已完成的任务。

最终文档检查为 271 个文档/入口；核心边界扫描 92 文件、364 处导入；上游来源检查 82 文件/2 处登记差异。并行 TuffEx 资料完整性检查通过，未覆写其固定参考快照。工作区保持 next 与基线 HEAD、无冲突、未提交。
