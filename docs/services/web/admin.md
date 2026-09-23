# Admin 模块合同（已迁出 `app/web`）

> 管理端前端已从 `app/web/sites/admin`（React）迁到独立的 Vue 包 `app/console`；本页只记录迁移事实与仍然有效的服务端约定。

状态：`current` · 更新：2026-09-24 · 前端：`app/console/`（见 [console 合同](../console/README.md)） · 后端：`app/server/src/routes/admin`、`app/server/src/routes/console`

## 迁移

2026-09-24（#13）起，`app/web/sites/admin` 与它独占的共享组件（`FeedbackFab`、`DiffView`、`NumberInput`）已删除。极客班控制台与 GitHub 组织管理页面都在 `app/console`，用 Tuffex 组件实现，路由是 `/console/**`；旧的多组织入口 `/admin`、`/admin/:org/*` 不再有页面，统一跳到 `/console`，组织固定为 `CONSOLE_ORG`。`app/web` 现在只剩官网 `sites/portal` 与 `shared`。

## 仍然有效的服务端约定

组织 API `/api/admin/:org/*` 先 requireAuth，再 requireOrgRole；membership 必须 active，使用当前用户 token。组织设置、成员和仓库管理要求组织 admin；Issue/PR 还受 GitHub 实际仓库权限限制。按钮不是授权机制。

公开邀请为唯一受限的代持 token 场景，不推广为通用 GitHub 代理。组织审计不可暴露其他组织或全局登录事件。

危险操作先确认，取消时不应已经发送评论等部分操作。PR 合并携带用户检查的 head SHA。普通成员不显示组织管理员专属写入口。前端怎样落实这些约定见 [console 合同](../console/README.md)「状态」。

服务端回归测试验证跨组织、角色、active membership、邀请、合并 SHA；外部客户端全部明确模拟，不操作真实仓库。前端的确认取消、移动导航见 `tests/e2e/workflows.spec.ts`。
