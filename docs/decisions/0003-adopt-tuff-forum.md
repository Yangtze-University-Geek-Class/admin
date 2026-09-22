# ADR-0003：直接采用 Tuff Forum 替换原论坛

> 用户明确选择使用原仓代码，而不是模仿 UI 或重写一套 React 论坛。

状态：`accepted` · 更新：2026-09-23

## 背景和依据

用户要求通过 Mac 拉取 `https://github.com/talex-touch/tuff-forum`，直接使用其代码、组件库和开发规范，并放弃原有论坛实现。已核实上游提交 `37164f75c0258b65922ea2151592e1f4efce8bde`，82 个跟踪文件，MIT License，版权 2026 TalexDreamSoul。源码原始摘要记录于 `app/forum/UPSTREAM.json`，许可证原样保留。

上游 README 和 `app/stores/session.ts`、`app/plugins/persist.client.ts` 明确表明它仅有浏览器前端演示：模拟身份、Pinia 状态、localStorage 持久化。Cloudflare PRD 处于 Draft，不是已提供的后端。不能将“采用原代码”表述成“已有真实认证和数据库”。

## 已实施决策

完整引入到 `app/forum`，保留独立 Node >=26、pnpm 11.24.0、Nuxt 4、Vue 3、Pinia、UnoCSS 和 TuffEx 0.6.0；不翻译成 React，不升级核心包迎合另一模块。根命令负责统一编排，两个锁文件分别 frozen 安装。此处因用户明确授权而调整 ADR-0001 的单一前端工程约定，并落实 [Tuffex 选型 ADR-0002](0002-tuffex-ui-foundation.md) 的论坛部分；不新增 Cloudflare 账号、付费资源或公网部署。

旧 `app/web/sites/forum`、`app/server/src/routes/forum`、专属身份/策略实现和对应测试退出活动代码，保留本机源码归档和压缩备份；决策当时原业务数据库未访问，随后按单独授权做了本机私有备份与只读投影，仍未迁移进可写库、未删除。核心只创建 data.db，不再打开 forum.db，不再签发旧 forum_sid。旧论坛 HTTP 接口返回 410，不伪造成功。旧页面在开发态跳到新首页，生产态未接好服务前关闭，不能将旧数字 ID 指到不相关新主题。

## 边界和许可

论坛只能通过其公开入口及后续显式协议接入核心，不导入 React 页面、核心数据库或旧会话实现。保留上游自动组件注册、图标收集、样式检查、自测和业务单测。集成起初只增加模块指针、本地进程标识、演示提醒及浏览器工具可移植性/隔离清理；2026-09-13 起扩展为本机只读快照适配器（dev 专用 Nitro 只读路由、客户端整体替换插件、页面门控，以及 `ADOPTION.json` 登记的少量上游文件调整）。变更必须记录在 `ADOPTION.json`，不重写上游来源摘要来掩盖差异。

用户给出的蓝白科技角色是后续品牌主题基准，不替换上游版权标识。图像素材和 3D Hub 尚未交付，不能拿本决策当作设计完成证据。

## 尚未实施的目标

2026-09-13 实施状态：本机可按 [forum 服务合同](../services/forum/README.md) 的只读快照模式显示极客班归档，其余目标未变。目标结构为公开宣传主页、受服务器会话保护的内部 Hub、论坛/GitHub 管理/扩展服务入口。真实 GitHub 统一认证、可扩展 Provider 协议、论坛后端及跨设备存储、服务注册规范、3D 游戏感 Hub 均需后续实施。该上游没有可直接复用的生产实现，不能把示例身份作为安全边界。旧账号、帖子和附件是否迁移需显式数据方案，不默认搬运或丢弃。

## 验证和回滚

核心运行根 check/test/build；论坛运行原仓 check/generate 和 CDP 验收。两类结果分别报告，旧 48 项测试不是新架构验收。代码回滚先停止本任务进程，从本机备份恢复选定源文件，再恢复根编排/构建；不覆盖业务数据库。部署和凭据配置仍需对应环境授权。

运行方法见 [TUFF-FORUM](../ops/TUFF-FORUM.md)，服务规则见 [forum 服务合同](../services/forum/README.md)。
