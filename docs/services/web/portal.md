# Portal 模块合同（`app/web/sites/portal`）

> 公开介绍、文档、反馈和邀请落地；无独立登录态。

状态：`current` · 更新：2026-09-23

## 范围与入口

前端 `app/web/sites/portal/App.tsx`，后端 `app/server/src/routes/portal/index.ts`。页面包括介绍、文档、反馈和邀请。路由只从自己的模块目录注册，不导入 admin/forum 路由。

## 数据与协议

文档 API 仅允许公开产品介绍和用户指南；内部规范、部署、安全与审查材料不在白名单。反馈写入 data.db，管理侧由 admin 模块接口读取/处理；两侧通过一致数据模型协作，不互相 import 路由。

邀请链接为能力令牌。POST 校验输入、蜜罐、PoW、可选 Turnstile；原子预留额度，调用保存的加密凭据授权的邀请操作，记录 sent/failed/pending_admin。GitHub 结果未知时不自动重发。

## UI 与验收

跨端链接使用 externalUrl，Markdown 走统一净化入口，验证码共用 TurnstileWidget 生命周期。公开表单显示提交中、成功、错误和恢复入口。

验证文档非空、内部文件不可公开、并发不超额、合同错误 400、mock DTO 与页面一致；浏览器检查路由、复制/图片和表单。参见 [测试规范](../../conventions/TESTING.md)。
