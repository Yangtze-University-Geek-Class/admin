# ADR-0004：论坛的存储与授权放进核心服务，接口前缀 `/api/forum`

> Tuff Forum 前端（ADR-0003）没有后端；论坛的帖子、账号资料和社区功能由核心服务 `app/server` 提供，存在同一个 `data.db` 里。

状态：`accepted` · 更新：2026-09-27 · 依据：项目所有者 2026-09-26 的上线要求（#57）；主 agent 定下的接口约定（server 与 forum 两个 PR 共用）。

## 背景

所有者 2026-09-26 定的上线标准：投递没问题；游客能看帖、能回复，不能发帖；成员能发帖；账号资料能改昵称、头像、个人签名；点赞、收藏、关注、通知、编辑和删除自己的帖子这些常见社区功能要有；控制台入口只给管理者显示。

[ADR-0003](0003-adopt-tuff-forum.md) 采用的 Tuff Forum 只有浏览器演示：Pinia 状态、localStorage 持久化、示例身份。旧 React/Fastify 论坛与 `forum.db` 已退役，不能拿回来用。全站登录已经统一到核心服务签发的 `sid`，称号与能力（`computeAccess`）也在核心服务里。

## 决策

- **存储在核心服务**：论坛数据是 `data.db` 里新增的 `forum_*` 表（用户、话题、帖子、点赞、收藏、关注、通知、用户建的标签、头像、计数器、浏览去重、限流记录），表结构与字段归属见 [数据模型](../services/server/data-model.md)。不另起数据库、不另起服务、不打开旧 `forum.db`。
- **接口前缀 `/api/forum`**：路由模块 `app/server/src/routes/forum-api/`（旧论坛的 `routes/forum` 目录名由 `scripts/check-forum-adoption.mjs` 守着不许回来，新模块换了名字），端点、错误码与限流见 [API](../architecture/API.md)「论坛」。返回的 `state` 与论坛前端 `app/forum/app/data/types.ts` 的 `ForumState`（version 1）同形，前端整体替换。这是新写的接口，不是旧论坛路由的复活：旧论坛的其它路径、`/auth/forum/*`、`/forum/u/*` 仍返回 410。
- **身份只认 `sid`**：成员第一次带 `sid` 请求时建论坛用户（`m<GitHub user_id>`），之后每次请求按 `computeAccess` 刷新角色与称号；论坛能力（`forum.*`）与控制台同一条授权路径，控制台里改的权限包下一次请求就在论坛生效。没有 `sid` 的是游客：只能看帖和回复，回复要带昵称、PoW 与空蜜罐字段，按 IP 限流。
- **内容种子随镜像发布**：server 镜像带论坛的两份公开文件 `app/forum/content/curation.json`（分类、标签）与 `app/forum/content/published/topics.json`（公开的旧帖），启动时按编号「没有才插入」。以后从旧论坛再导出的帖子，重新导出 `topics.json` 再发版就会进来；线上已有的回复、置顶变化不会被覆盖。
- **迁移与备份随 `data.db`**：没有迁移框架，论坛表和控制台的表一样只 `CREATE TABLE IF NOT EXISTS`、不改已有表；备份、恢复按 `data.db` 整体做（#72）。

## 考虑过的方案

- **论坛自己的 Nitro 后端 + 独立数据库**：论坛镜像是静态产物，加服务端要引入第二个 Node 运行时、第二个 SQLite、第二套会话校验，还要把称号与能力复制一份，与「全站一个登录、一个授权来源」相悖。
- **恢复旧 Fastify 论坛路由与 `forum.db`**：数据模型与现在的前端不同，旧身份体系已退役，ADR-0003 明确不修出平行论坛。

## 后果

- 论坛写接口与控制台同源同库：`/api/forum/*` 的写请求经过同一个 Origin 校验；站点 CSP 与论坛的 Markdown 输出净化继续是管理端权限的直接防线（[SECURITY](../architecture/SECURITY.md)）。
- 核心服务启动时读论坛的两份公开 JSON：文件缺失或引用不存在的分类、标签时启动失败，不带半份论坛上线。
- `sharp` 从遗留依赖变成在用依赖（头像重新编码）。
- 整份 `state` 每次请求全量下发，适合现在的规模；帖子多到影响首屏时再做分页，届时另开 issue。
- 旧论坛账号与 GitHub 登录的关联、旧帖认领（#58）不在本决策内。

## 实施状态

2026-09-27（#145）：写接口不再回整份 `state`，只回这次写入改动的记录（`{ changes, viewer, guestPolicy }`，可见性与 `GET /state` 相同，形状见 [API](../architecture/API.md)「写接口的回答」）；论坛前端按编号并进手里的状态（`applyChanges`），不再整体替换，写入先显示再发请求，失败退回服务端确认的值（[forum 服务合同](../services/forum/README.md)「服务端模式」）。上面「决策」里的「前端整体替换」与「后果」里的「整份 `state` 每次请求全量下发」现在只对首屏的 `GET /api/forum/state` 成立；首屏不再一次拉全部帖子正文由 #156 跟进。写入的回答不再带回别人的新动态，别人的新回复和通知要重新读状态（刷新页面）才出现。

## 重新评估的条件

帖子量或并发让单个 SQLite 文件、全量 `state` 成为瓶颈；论坛需要独立于核心服务发布；或者需要多实例部署。
