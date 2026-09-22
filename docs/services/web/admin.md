# Admin 模块合同（`app/web/sites/admin`）

> 使用当前用户 GitHub 权限的组织管理模块。

状态：`current` · 更新：2026-09-23

前端 `app/web/sites/admin`（`pages/` + 按职责划分的 `features/`），后端 `app/server/src/routes/admin`，data.db 保存会话、邀请、反馈和审计。仓库详情按代码、提交、Issue、PR、设置职责划分 feature。

组织 API 先 requireAuth，再 requireOrgRole；membership 必须 active，使用当前用户 token。组织设置、成员和仓库管理要求组织 admin；Issue/PR 还受 GitHub 实际仓库权限限制。按钮不是授权机制。

公开邀请为唯一受限的代持 token 场景，不推广为通用 GitHub 代理。组织审计不可暴露其他组织或全局登录事件。

危险操作先确认，取消时不应已经发送评论等部分操作。PR 合并携带用户检查的 head SHA。普通成员不显示组织管理员专属写入口。退出清空身份关联查询，移动端可以切换组织和导航。

测试验证跨组织、角色、active membership、邀请、确认取消、合并 SHA、移动导航。外部客户端全部明确模拟，不操作真实仓库。
