# 代码审查规范（diff 审查）

> 本仓库专属的 diff 审查清单：触发时机、逐项检查、结论格式与审查记录位置。

状态：`current` · 更新：2026-09-23

本规范规定**看什么、怎么判、写在哪**；MR 的字段要求与门禁见 [PULL-REQUESTS](PULL-REQUESTS.md)，分支模型见 [BRANCHING](BRANCHING.md)。

## 触发时机

必须在以下任一情形发生前完成审查：

- 任何要合入 `stage` 的 MR（含文档、脚本、配置）。
- 任何要合入 `main` 的操作（`main` 只收 `stage`，因此这次审查实际是对「`stage` 当下状态」的第二道复核）。
- 部署开关打开后的镜像构建内容变更：Dockerfile、compose、`.env` 契约、`deploy/remote/*.sh`。
- 任何触及认证、授权、密钥、`.env`、数据库 schema 的改动（无论大小）。

不必逐条走完整清单的情形：纯历史材料补充、注释错字、`.tools` 私有目录内容——但**结论仍要写在 MR 里**，写「无需逐项审查 + 理由」。

## 必须逐项检查的清单

1. **分支不变量**：当前分支是否为 `task/<issue>/<slug>` 或 `stage`（分支名不含 `-`，见 [BRANCHING](BRANCHING.md) 命名规则）；`stage` 是否包含 `main`（`git merge-base --is-ancestor origin/main origin/stage`）；是否存在把 `task/**`、`dev/**` 直接指向 `main` 的路径。
2. **是否直推 `main`**：MR 的目标分支、提交来源、CI 触发 ref；发现任何绕过 `stage` 的写入 `main` 的路径即阻塞。
3. **密钥是否入库**：diff 里不得出现真实 token、密码、会话 Cookie、SSH 私钥、`OAUTH_CLIENT_SECRET`/`SESSION_SECRET`/`ENCRYPTION_KEY`/`TURNSTILE_SECRET_KEY` 的真值。`node scripts/check-secrets.mjs` 只覆盖部分文本模式，**通过它不等于没有泄漏**，必须人眼过一遍 diff 中的新增字符串。
4. **`.env` 只允许非密值**：`deploy/env/.env.production`、`deploy/env/.env.preview` 入库的只能是地址、端口、域名、路径、开关等可见事实；密钥字段必须留空，由 CI/CD 用环境级 secrets 注入。字段增删要同步 [ENVIRONMENTS](../ops/ENVIRONMENTS.md) 与 [deploy/environments.json](../../deploy/environments.json)。
5. **镜像与 compose 变更风险**：镜像 tag 语义（`<sha12>`）、镜像仓库是否仍按环境分开（`yzgc-preview/*` 与 `yzgc-production/*`，同一 SHA 不得共用镜像引用）、端口是否与另一环境冲突（18100/18101 vs 18200/18201）、命名卷是否被改成宿主目录、健康检查是否仍在、`dockerfile:` 路径是否指向 `app/<service>/Dockerfile`、构建上下文是否仍为仓库根。
6. **测试与文档同步**：行为变更是否带来相应回归；改动的 API/环境变量/命令/路径是否同步到 [services/](../services/README.md)、[API](../architecture/API.md)、[ENVIRONMENTS](../ops/ENVIRONMENTS.md)、[README](../../README.md)、[TESTING](TESTING.md)；文档索引是否重新生成（`node scripts/docs-index.mjs --check`）。
7. **边界规则**：`app/` 与 `docs/` 严格对齐（新增服务必须同时有 `docs/services/<svc>/README.md`）；站点之间、shared → 站点、路由模块互相导入、`lib` 反向依赖 `middleware` 都是禁止方向；论坛（Vue/Nuxt）不得导入核心 React/Fastify 实现。
8. **提交信息规范**：遵循 [COMMITS](COMMITS.md) 的 `<type>(<scope>): <中文简述>`，一次提交一个可独立回滚的目的，不出现 `update`/`WIP`/无信息量消息；机械搬迁与行为改变尽量分开。
9. **旧模型残留**：diff 中不得把 `next` 分支、`feat/|fix/|docs/` 命名、`release-*`/`prev-*` tag、「push `stage`/`main` 即部署」、systemd、`/opt/yzgc-admin`、宿主 3000 端口当成现行模型（历史章节内须显式标注历史）。发布 tag 只能是 `vX.Y.Z-rc.N` / `vX.Y.Z`（见 [RELEASES](RELEASES.md)）。
10. **危险操作**：数据库结构变更是否有兼容与恢复路径；是否有删除数据、覆盖配置、顺带升级无关依赖、修改生产凭据的动作；是否存在「以测试通过代替人工验收」的表述。
11. **执行记录**：本 task 的 `notes/` 链路（[NOTES](NOTES.md)）从「开工」起连续，已记录到「PR」；对照提交、PR 和 CI 核对记录内容属实，时间、SHA、结果对得上，已有记录未被删除或改写。审查进行中允许暂缺「审查」记录（此时 CI `branch-guard` 缺少审查记录是预期的，不作为审查的阻塞项）；审查结论给出后，由作者在合并前补记「审查」记录（`docs(notes): …`），届时 CI 的执行记录检查校验「审查」补齐后方可合并。

## 产出格式

审查结论以条目形式写进 MR 评论或 MR 描述，每条包含四要素：

```text
[严重度] 文件:行 — 理由（一句话，指向具体规则或真实后果）— 修法（可执行的具体动作）
```

严重度：

| 严重度 | 含义 | 处理 |
|---|---|---|
| `阻塞` | 破坏不变量、泄漏密钥、越权、数据不可恢复、把历史当现行规范 | 必须修完再合并 |
| `应修` | 会带来看得见的缺陷或维护陷阱，但不阻塞本次合并 | 修，或在 MR 里写明为何本次不修 |
| `建议` | 可读性、命名、组织方式 | 作者自行决定 |

## 结论

结论只有三种，逐字使用：

- **阻塞**：存在 `阻塞` 条目，或门禁（`pnpm verify`、必需 CI 检查）未通过。
- **有条件通过**：无 `阻塞` 条目，但有未完成的 `应修`（必须写明条件与责任人和复查方式）。
- **通过**：无未决条目，门禁通过。

不能写「基本没问题」「看起来可以」这类模糊结论；也不能用机器 PASS 代替人对 diff 的判断。

## 审查记录位置

**审查记录必须写在 MR 里**（MR 描述或 MR 评论），内容至少包含：审查人、时间、被审查的 commit SHA、逐条结论、最终结论。不写进被审查的代码提交本身（自引用问题），也不只存在于聊天记录或本地笔记。合入 `stage` 后，MR 就是这次审查的可追溯存档。

## 与人工验收的边界

代码审查是**机器可核验 + 人工判断**的第二道筛子，不构成 [RELEASES](RELEASES.md) 要求的人工试用与发布批准。审查通过 ≠ 部署授权；部署与发版是独立授权动作。
