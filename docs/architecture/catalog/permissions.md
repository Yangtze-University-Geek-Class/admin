# 能力目录

> 直接读取服务端能力定义、蕴含关系及可定位的路由检查，不复制运行时角色权限包。

状态：`current` · 更新：2026-10-27 · 自动生成，不手工编辑。

来源摘要：`3dcfa4b15bb927a51d250a1c8afe21c842ebeb0864c15449fda69d84e2eb4659`。更新日期指目录声明版本，数据新鲜度由摘要和 `pnpm check:catalog` 核对。

[使用与维护](README.md) · [总览](CATALOG.md) · [接口](routes.md) · [数据](data-model.md) · [权限](permissions.md) · [机器目录](catalog.json)

称号和部门权限包可由数据库配置，GitHub 能力还受上游组织角色限制。此目录不读取这些真实配置，也不宣称某个真实用户持有什么权限。对象归属、部门范围、作者身份等仍须按 SECURITY 与测试核验。

| 能力 | 名称 | 业务域 | 蕴含 | 定义 | 直接检查它的操作数 |
|---|---|---|---|---|---:|
| `console.access` | 进入控制台 | `organization` |  | [app/server/src/lib/roles.ts:84](../../../app/server/src/lib/roles.ts#L84) | 0 |
| `forum.topic.pin` | 置顶话题 | `forum` |  | [app/server/src/lib/roles.ts:85](../../../app/server/src/lib/roles.ts#L85) | 0 |
| `forum.topic.close` | 关闭话题 | `forum` |  | [app/server/src/lib/roles.ts:86](../../../app/server/src/lib/roles.ts#L86) | 0 |
| `forum.post.moderate` | 管理帖子 | `forum` |  | [app/server/src/lib/roles.ts:87](../../../app/server/src/lib/roles.ts#L87) | 0 |
| `forum.category.manage` | 管理分类 | `forum` |  | [app/server/src/lib/roles.ts:88](../../../app/server/src/lib/roles.ts#L88) | 0 |
| `forum.badge.assign` | 授予论坛徽章 | `forum` |  | [app/server/src/lib/roles.ts:89](../../../app/server/src/lib/roles.ts#L89) | 0 |
| `applications.read` | 查看投递 | `recruitment` |  | [app/server/src/lib/roles.ts:90](../../../app/server/src/lib/roles.ts#L90) | 0 |
| `applications.review` | 审核投递 | `recruitment` | `applications.read` | [app/server/src/lib/roles.ts:91](../../../app/server/src/lib/roles.ts#L91) | 0 |
| `applications.export` | 导出投递 | `recruitment` | `applications.read` | [app/server/src/lib/roles.ts:92](../../../app/server/src/lib/roles.ts#L92) | 0 |
| `feedback.read` | 查看意见箱 | `feedback` |  | [app/server/src/lib/roles.ts:93](../../../app/server/src/lib/roles.ts#L93) | 0 |
| `feedback.manage` | 处理意见 | `feedback` | `feedback.read` | [app/server/src/lib/roles.ts:94](../../../app/server/src/lib/roles.ts#L94) | 0 |
| `audit.read` | 查看审计日志 | `audit` |  | [app/server/src/lib/roles.ts:95](../../../app/server/src/lib/roles.ts#L95) | 0 |
| `roles.manage` | 管理称号与部门 | `organization` | `roles.department.manage` | [app/server/src/lib/roles.ts:96](../../../app/server/src/lib/roles.ts#L96) | 0 |
| `roles.department.manage` | 任免本部门成员 | `organization` |  | [app/server/src/lib/roles.ts:97](../../../app/server/src/lib/roles.ts#L97) | 0 |
| `competitions.manage` | 管理比赛 | `competitions` |  | [app/server/src/lib/roles.ts:98](../../../app/server/src/lib/roles.ts#L98) | 0 |
| `accounts.invites.manage` | 管理注册邀请码 | `identity` |  | [app/server/src/lib/roles.ts:99](../../../app/server/src/lib/roles.ts#L99) | 0 |

直接检查数为 0 不代表能力无效：可能通过蕴含、条件或 helper 使用，也可能仍是预留项。生成器不替代权限测试。
