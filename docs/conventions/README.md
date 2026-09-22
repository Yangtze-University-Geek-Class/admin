# conventions/

> 强制遵守的规范：分支、审查、提交、Issue、MR、发版与文档。违反会被 CODE-REVIEW 退回。

| 文件 | 什么时候读 |
|---|---|
| [`AGENT-START.md`](./AGENT-START.md) | 作为 AI/Agent 进入仓库的第一件事（确认分支 + 读规范） |
| [`BRANCHING.md`](./BRANCHING.md) | 任何提交/推送/切分支之前；确认自己在 `main`/`stage`/`task-*` 上 |
| [`CODE-REVIEW.md`](./CODE-REVIEW.md) | review 别人的 diff，或提交 MR 想合入 `stage` 之前 |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 第一次参与，或需要确认分支/环境/沟通约定 |
| [`RELEASES.md`](./RELEASES.md) | 把 `stage` 合入 `main`、改版本号或准备部署之前 |
| [`COMMITS.md`](./COMMITS.md) | 写 commit message 之前 |
| [`ISSUES.md`](./ISSUES.md) | 开 issue 之前（开发前必须先有 issue） |
| [`PULL-REQUESTS.md`](./PULL-REQUESTS.md) | 开 MR 之前 |
| [`TESTING.md`](./TESTING.md) | 写测试、报告验收结果之前 |
| [`MODULAR-DEVELOPMENT.md`](./MODULAR-DEVELOPMENT.md) | 新增服务、跨服务引用或改动依赖方向之前 |
| [`DOCUMENTATION.md`](./DOCUMENTATION.md) | 新增/移动文档、同步路径或改状态标注之前 |
| [`PROJECT.md`](./PROJECT.md) | 确认授权边界、完成定义与 agent 入口政策 |
| [`REFERENCES.md`](./REFERENCES.md) | 需要外部依据或核对采用范围时 |

这些规范是**强制**的。根 [AGENTS.md](../../AGENTS.md) 的任务映射表把它们列进了必读清单，改对应内容前必须先读那篇。服务级文档见 [docs/services](../services/README.md)。
