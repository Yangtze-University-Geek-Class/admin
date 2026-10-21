# 能力目录

> 直接读取服务端能力定义、蕴含关系及可定位的路由检查，不复制运行时角色权限包。

状态：`current` · 更新：2026-10-21 · 自动生成，不手工编辑。

来源摘要：`508f709582f8a5a4d158ef6b39a20da22d90aa42ae4cb4712cd8608d13eff7da`。更新日期指目录声明版本，数据新鲜度由摘要和 `pnpm check:catalog` 核对。

[使用与维护](README.md) · [总览](CATALOG.md) · [接口](routes.md) · [数据](data-model.md) · [权限](permissions.md) · [机器目录](catalog.json)

称号和部门权限包可由数据库配置，GitHub 能力还受上游组织角色限制。此目录不读取这些真实配置，也不宣称某个真实用户持有什么权限。对象归属、部门范围、作者身份等仍须按 SECURITY 与测试核验。

| 能力 | 名称 | 业务域 | 蕴含 | 定义 | 直接检查它的操作数 |
|---|---|---|---|---|---:|
| `console.access` | 进入控制台 | `organization` |  | [app/server/src/lib/roles.ts:67](../../../app/server/src/lib/roles.ts#L67) | 4 |
| `github.org.read` | 查看 GitHub 组织 | `github` |  | [app/server/src/lib/roles.ts:68](../../../app/server/src/lib/roles.ts#L68) | 0 |
| `github.org.manage` | 修改组织资料 | `github` | `github.org.read` | [app/server/src/lib/roles.ts:69](../../../app/server/src/lib/roles.ts#L69) | 0 |
| `github.members.manage` | 管理组织成员 | `github` | `github.org.read` | [app/server/src/lib/roles.ts:70](../../../app/server/src/lib/roles.ts#L70) | 0 |
| `github.repos.manage` | 管理仓库 | `github` | `github.org.read` | [app/server/src/lib/roles.ts:71](../../../app/server/src/lib/roles.ts#L71) | 0 |
| `github.teams.manage` | 管理团队 | `github` | `github.org.read` | [app/server/src/lib/roles.ts:72](../../../app/server/src/lib/roles.ts#L72) | 0 |
| `github.invites.manage` | 管理邀请 | `github` | `github.org.read` | [app/server/src/lib/roles.ts:73](../../../app/server/src/lib/roles.ts#L73) | 0 |
| `forum.topic.pin` | 置顶话题 | `forum` |  | [app/server/src/lib/roles.ts:74](../../../app/server/src/lib/roles.ts#L74) | 0 |
| `forum.topic.close` | 关闭话题 | `forum` |  | [app/server/src/lib/roles.ts:75](../../../app/server/src/lib/roles.ts#L75) | 0 |
| `forum.post.moderate` | 管理帖子 | `forum` |  | [app/server/src/lib/roles.ts:76](../../../app/server/src/lib/roles.ts#L76) | 0 |
| `forum.category.manage` | 管理分类 | `forum` |  | [app/server/src/lib/roles.ts:77](../../../app/server/src/lib/roles.ts#L77) | 0 |
| `forum.badge.assign` | 授予论坛徽章 | `forum` |  | [app/server/src/lib/roles.ts:78](../../../app/server/src/lib/roles.ts#L78) | 0 |
| `applications.read` | 查看投递 | `recruitment` |  | [app/server/src/lib/roles.ts:79](../../../app/server/src/lib/roles.ts#L79) | 2 |
| `applications.review` | 审核投递 | `recruitment` | `applications.read` | [app/server/src/lib/roles.ts:80](../../../app/server/src/lib/roles.ts#L80) | 1 |
| `applications.export` | 导出投递 | `recruitment` | `applications.read` | [app/server/src/lib/roles.ts:81](../../../app/server/src/lib/roles.ts#L81) | 1 |
| `feedback.read` | 查看意见箱 | `feedback` |  | [app/server/src/lib/roles.ts:82](../../../app/server/src/lib/roles.ts#L82) | 1 |
| `feedback.manage` | 处理意见 | `feedback` | `feedback.read` | [app/server/src/lib/roles.ts:83](../../../app/server/src/lib/roles.ts#L83) | 2 |
| `audit.read` | 查看审计日志 | `audit` |  | [app/server/src/lib/roles.ts:84](../../../app/server/src/lib/roles.ts#L84) | 1 |
| `roles.manage` | 管理称号与部门 | `organization` | `roles.department.manage` | [app/server/src/lib/roles.ts:85](../../../app/server/src/lib/roles.ts#L85) | 5 |
| `roles.department.manage` | 任免本部门成员 | `organization` |  | [app/server/src/lib/roles.ts:86](../../../app/server/src/lib/roles.ts#L86) | 4 |
| `competitions.manage` | 管理比赛 | `competitions` |  | [app/server/src/lib/roles.ts:87](../../../app/server/src/lib/roles.ts#L87) | 0 |

直接检查数为 0 不代表能力无效：可能通过蕴含、条件或 helper 使用，也可能仍是预留项。生成器不替代权限测试。
