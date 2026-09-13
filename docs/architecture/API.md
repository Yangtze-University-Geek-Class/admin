# API 与数据契约

> 模块自有 Schema、明确错误语义和外部副作用约定。

状态：`current` · 更新：2026-09-13

## 合同

各路由模块 contracts.ts 拥有本模块请求 Schema。http-contracts 提供公共参数验证；文档 ID 等非数字标识必须有模块例外。TypeScript 泛型不代替运行时校验，用户不得提供待执行的 Schema。

JSON 写操作定义类型、长度、范围、枚举与必填项，拒绝未知字段。分页为有界正整数，验证后转换。SQL 值仍参数化。

## 接口族

portal 包括 /api/docs、/api/feedback、/api/join/:token、/api/public/config；admin 包括 /auth/*、/api/me/orgs、/api/admin/:org/*。旧 `/api/forum` 及其子路径、`/auth/forum/*`、`/forum/u/*` 返回 410 legacy_forum_retired。新论坛位于 modules/forum，上游没有论坛业务 API，不将旧 API 改为模拟成功。开发态 `/forum/*` 跳转新首页，生产未接好服务时返回 503。

核心 OAuth 回调和 sid 保留，oauth_state 保持签名和有效期检查；不再创建旧 forum_sid。Nuxt 的选择示例用户不进入此会话模型，不为其签发真实权限。开发专用 `/__geek_forum` 仅标记受控预览进程，明确 realAuthentication=false / serverPersistence=false、contentSource 和 snapshotConfigured（快照目录已配置，不是数据库连接），生产不提供该标记。dev 专用、仅 GET/HEAD 的 `/api/local-forum/state`（整份只读快照文档）和 `/api/local-forum/assets/:hash`（按索引提供附件，支持单段 Range，多段请求退化为完整正文）只在设置快照目录时存在，静态产物中没有；它们没有会话，也不是业务写接口。机器码：404 `local_snapshot_not_configured` / `asset_not_found` / `asset_missing_on_disk`，405 `method_not_allowed`，416 `range_not_satisfiable`，500 `asset_size_mismatch`，503 `invalid_document` / `invalid_state` / `invalid_asset_index` / `snapshot_unavailable`。dev 错误处理器会在错误体附带堆栈，这是这些路由不进生产的原因之一。后续真实论坛 API 必须另立契约及权限测试。

## 错误

校验 400、未登录 401、权限/来源 403、不存在 404、冲突 409、超大 413、不支持图片 415、频率限制 429、服务异常 5xx。错误体含机器码 error、必要 message 和可用的 request_id；不得暴露 Token、SQL、完整外部响应或堆栈。

## 幂等与验证

核心邀请按链接与标准化收件人记录，成功重试复用结果；明确失败补偿，未知结果保留额度并待核对。PR 合并带 head SHA；评论并关闭先确认，再依次等待成功。旧论坛软删除策略已经退出运行，其历史测试不能作为新论坛后端行为证明。

测试覆盖正常、非法字段、未知字段、边界、角色、缺失资源和并发。Mock 是只读预览，不伪造写成功。新 DTO 使用具名类型；复杂上游宽类型限制在适配边界并说明理由。

官方依据：https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/ ，https://fastify.dev/docs/latest/Guides/Testing/
