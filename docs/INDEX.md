# 文档索引

> 本文件由 `node scripts/docs-index.mjs` 生成，**请勿手工编辑**。
> 改了文档标题或摘要后重新生成；提交前用 `node scripts/docs-index.mjs --check` 自查。

改代码前该读哪篇，见 [`README.md`](./README.md) 的「按改动类型找文档」表；强制规则见 [`../AGENTS.md`](../AGENTS.md) §0。

## conventions/

强制遵守的规范：提交、Issue、PR、贡献流程。违反会被 PR review 退回。

| 文档 | 说明 | EN |
|---|---|---|
| [`COMMITS.md`](./conventions/COMMITS.md) | 本仓库统一使用 **Conventional Commits + 中文描述**。风格参照 `t-dynamic-spectrum`。 | [EN](./conventions/COMMITS.en.md) |
| [`CONTRIBUTING.md`](./conventions/CONTRIBUTING.md) | 本文件是贡献流程的总入口。改代码之前，先读 AGENTS.md §0 —— 它要求先停下来查 `docs/` 里对应的那篇。 | [EN](./conventions/CONTRIBUTING.en.md) |
| [`ISSUES.md`](./conventions/ISSUES.md) | 适用于本仓库（GitHub 平台）的所有缺陷、需求与验收。GitHub Issue 是团队的**持久记录**，不能用聊天上下文或本地笔记替代。 | [EN](./conventions/ISSUES.en.md) |
| [`PULL-REQUESTS.md`](./conventions/PULL-REQUESTS.md) | 适用于本仓库（GitHub 平台）的所有 Pull Request。 | [EN](./conventions/PULL-REQUESTS.en.md) |

## design/

界面怎么做、技术用什么版本。改 UI 或动依赖之前先读这里。

| 文档 | 说明 | EN |
|---|---|---|
| [`DESIGN.md`](./design/DESIGN.md) | 三站（portal / forum / admin）重构后的视觉与交互基线。所有数值与条款来自权威标准与大厂官方文档（2026-09-12 核对），来源逐节列出。 技术版本基线见 STACK.md。English: DESIGN.en.md | [EN](./design/DESIGN.en.md) |
| [`STACK.md`](./design/STACK.md) | 本文确定重构后采用的技术栈与版本，以及各框架的**用法要点**（不是教程，是"在本项目里该怎么用"）。 版本号与迁移结论均来自各项目官方文档（2026-09-12 核对），来源 URL 逐节列出。 | [EN](./design/STACK.en.md) |

## architecture/

长期有效的系统设计：架构、鉴权、数据模型、安全模型。改动系统边界或数据之前先读这里。

| 文档 | 说明 | EN |
|---|---|---|
| [`ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) | 系统怎么设计的：拓扑、鉴权流程、数据模型、加密、防滥用。改后端路由 / DB / OAuth 之前先读这篇。 | [EN](./architecture/ARCHITECTURE.en.md) |
| [`SECURITY.md`](./architecture/SECURITY.md) | 威胁模型 + 当前防护层。涉及限流、验证码、可能暴露的数据之前先读这篇；安全姿态变化时必须更新。 | [EN](./architecture/SECURITY.en.md) |

## plan/

计划与现状盘点，**有保质期**。落地后应删除或压缩成结论，不要长期堆积。

| 文档 | 说明 | EN |
|---|---|---|
| [`REFACTOR.md`](./plan/REFACTOR.md) | 分支：`next` · 建立于 2026-09-12 · 基线提交 `4959668` 用途：动手重构前先把「现在长什么样」钉死。本文只描述现状，不含改造动作。 中英对照见 REFACTOR.en.md。 | [EN](./plan/REFACTOR.en.md) |
| [`WEB-SPLIT.md`](./plan/WEB-SPLIT.md) | 状态：**待确认**（未执行）。现状盘点见 REFACTOR.md。 目标：三端（portal / forum / admin）在前端目录、后端路由目录、构建产物三个层面物理隔离，改一个端不可能碰坏另一个端。 | [EN](./plan/WEB-SPLIT.en.md) |

## ops/

运维与使用：照着做就能跑的操作手册。

| 文档 | 说明 | EN |
|---|---|---|
| [`DEPLOY.md`](./ops/DEPLOY.md) | 从零把服务跑起来，以及线上出问题时怎么查。含完整 runbook 与故障排查表。 | [EN](./ops/DEPLOY.en.md) |
| [`USAGE.md`](./ops/USAGE.md) | 各角色（管理员 / 普通用户 / 外部访客）能看到什么、能做什么。改功能时对照它确认预期行为有没有变。 | [EN](./ops/USAGE.en.md) |

---

共 12 篇文档（另有 13 篇英文版）。索引按目录分组，组内按文件名排序。
