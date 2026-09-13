# 当前系统架构

> 统一根入口、保留核心服务、独立采用 Nuxt/TuffEx 原仓论坛；明确当前实现与目标的差异。

状态：`current` · 更新：2026-09-13

## 当前拓扑

```text
geek_main 根 README / AGENTS / 命令 / docs
  ├─ web/sites/portal、admin  [React / Vite，Node 22]
  │      └─ HTTP -> server/src/app.ts -> portal/admin 路由
  │                   └─ services -> data.db、GitHub、Turnstile
  └─ modules/forum           [原仓 Nuxt / Vue / TuffEx，Node >=26]
         └─ Pinia：示例种子 + localStorage，或本机只读快照（dev 专用 /api/local-forum）
```

论坛不再是 web/sites 下的 React 入口。根 `pnpm verify` 编排核心与论坛各自检查，两个 pnpm 锁文件、运行时和 node_modules 分开管理。独立技术栈是用户明确采用原仓的要求，不是为了目录外观创建微服务。

核心 Vite 生成 portal/admin 两个 HTML；论坛由 Nuxt generate 生成独立静态产物。本机核心在 5173/3000，新论坛在 3456；旧论坛链接转到新首页，旧帖子 ID 不尝试猜测映射。生产环境尚未部署新论坛。

## 核心数据与身份

`buildApp` 注册真实核心应用但不监听；`index.ts` 才加载环境和监听。`services.ts` 只拥有 data.db、缓存和外部客户端。data.db 的 sessions、invite_links、invite_attempts、invitations、feedback、audit_logs、app_state 保留。核心 GitHub OAuth 的 sid 和组织权限校验保留，不再创建旧 forum_sid。

原始 forum.db 及附件在私有备份中保持原样，未删除、未导入可写库；本机展示的只读投影由该备份离线生成（见 [数据保全](../ops/FORUM-DATA-CAPTURE.md)）。旧论坛数据和代码生命周期分开；代码退役不等于授权删除数据。跨设备的新论坛存储和旧数据导入必须另立方案。

## 上游论坛的真实边界

依据 modules/forum/README.md、app/stores/session.ts 和 app/plugins/persist.client.ts：选择用户是 mock，全部数据在浏览器，没有服务端认证或业务 API。Nuxt dev server 和本地进程标记不等于论坛后端。上游 Cloudflare PRD 是 Draft，未作为已实现能力。不能将页面权限按钮或 localStorage 状态当作内部社区安全边界。本机 `forum:start` 发现私有快照目录时，dev 专用 Nitro 路由 `/api/local-forum/*` 只读提供极客班归档，前端整体替换 store、固定游客会话、把示例登录换成只读说明并停止把论坛状态写入 localStorage；这只是本机展示，没有服务端认证、写入或跨设备存储，静态产物中不存在这些路由。

原仓文件、MIT 声明和提交摘要保留，业务页面未重写为 React。少量集成差异包括本地提醒、根入口、进程管理和隔离浏览器验证，详见 [ADR-0003](../decisions/0003-adopt-tuff-forum.md)。

## 目标结构，尚未完整实现

公开宣传主页 -> GitHub 等 Provider 登录 -> 内部 Hub -> 论坛 / GitHub 组织管理 / 可扩展服务。用户要求的蓝白科技、3D 游戏感 Hub 和 DIY 服务注册仍是后续实施目标。TuffEx 已为后续 UI 选定，但组件文档或导入原仓不证明所有模块已经迁到 Vue。

## 验证和发布

核心邀请仍原子预留额度、按结果补偿，不能因为论坛更换退化其正确性。核心接口和论坛演示分别测试；原论坛历史 48 项通过不算新架构验收。旧 /api/forum/* 返回 410；生产未接入新服务时 /forum 返回 503。真实认证、服务器权限、跨设备存储、内容安全和部署回滚未验证前，不开放新论坛为生产内部服务。

参见 [API](API.md)、[SECURITY](SECURITY.md)、[模块规则](../conventions/MODULAR-DEVELOPMENT.md) 与 [本地运行](../ops/TUFF-FORUM.md)。
