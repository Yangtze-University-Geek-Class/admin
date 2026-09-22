# 贡献规范

> 统一入口、最小变更、可审查的提交与资源隔离。

状态：`current` · 更新：2026-09-23

## 开始前

AI 先执行 [AGENT-START](AGENT-START.md) 的阅读门禁，不能先运行下列命令再补规范。**第一步是确认分支**：`git branch --show-current`，确认自己在 `task/<issue>-<slug>` 或 `stage` 上，不在就直接停止。

读根 README 与对应服务文档（[docs/services](../services/README.md)）。确认 `git status --short`、分支和 HEAD；不要覆盖已有未提交修改。使用 Node 22 和固定 pnpm（`pnpm@9.15.9`）做 frozen-lockfile 安装；论坛的独立工具链（Node ≥26 / pnpm 11.24.0）只经根 `forum:*` 命令使用。前端预览从根 `pnpm dev:web` 启动，无需生产配置。

## 分支与改动

长期分支只有 `main`（正式）和 `stage`（预发布），完整规则（含不变量、禁止事项、清理要求）见 [BRANCHING](BRANCHING.md)：

- 开发前先按 [ISSUES](ISSUES.md) 开 issue，再从 `stage` 拉 `task/<issue>-<slug>`；
- 一次任务一条 task 分支，MR 回 `stage`，正文写 `Closes #<issue>`；
- **MR 合并后必须立即删除 task 分支**，不留死分支；
- `dev-<github-username>` 是个人自由分支，想怎么改都行，但不得作为进入 `stage` 的凭据，也不部署；
- 禁止直接向 `main` 提交，禁止 `task/*`、`dev-*` 直接进 `main`。`main` 只接受来自 `stage` 的合并。

发版与人工验收见 [RELEASES](RELEASES.md)：合并进 `main` 就是正式发布，人工验收必须在合入之前完成；普通 commit 不自动升号，不把 feat/fix 消息当作发版许可。

先定服务、契约与验收，再改代码；修复缺陷时添加能区分修复前后的回归。新增依赖要说明目的、许可、运行环境、体积与维护代价。不要顺便升级无关框架，也不要为了纯目录偏好搬整个工程。

## 提交前

运行根 `pnpm verify`；影响浏览器行为时跑 `pnpm test:e2e`。审阅 diff，补文档，确认无密钥、真实数据或编译产物。失败和未验证项如实写入 MR，不能只截取部分成功输出。改动触及标题/摘要/路径时重新生成文档索引（`pnpm docs:index`）。

提交遵循 [COMMITS](COMMITS.md)，审查按 [CODE-REVIEW](CODE-REVIEW.md) 逐项过一遍并把结论写进 MR，MR 字段要求见 [PULL-REQUESTS](PULL-REQUESTS.md)。提交、push、合并、部署分别需要对应授权；要求改代码不等于要求自动发布。

## 数据与运维

业务数据修改不属于普通贡献流程。维护脚本必须明确绝对路径和写入确认，在经验证的副本上演练后再由授权人员操作。数据库备份/恢复和部署参见 [DEPLOY](../ops/DEPLOY.md)；环境变量与部署前置见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)。
