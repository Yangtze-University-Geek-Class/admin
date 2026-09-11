# 文档索引

这个目录是本项目的**积累知识库**。改代码之前先在这里找对应的那篇。

写代码的硬规则见根目录 [`AGENTS.md`](../AGENTS.md) §0 —— 动手前必须先停下来查这里。

> 全部文档的机器生成索引见 [`INDEX.md`](./INDEX.md)（由 `node scripts/docs-index.mjs` 维护）。

---

## 按改动类型找文档

### 规范（强制遵守）

| 你要做什么 | 先读 |
|---|---|
| 提 issue / 报 bug / 提需求 | [`conventions/ISSUES.md`](./conventions/ISSUES.md) |
| 提交代码、写 commit message | [`conventions/COMMITS.md`](./conventions/COMMITS.md) |
| 开 PR、review、合并 | [`conventions/PULL-REQUESTS.md`](./conventions/PULL-REQUESTS.md) |
| 改 UI、加页面、调交互 | [`design/DESIGN.md`](./design/DESIGN.md) |
| 升级依赖、引入框架、改构建 | [`design/STACK.md`](./design/STACK.md) |
| 第一次参与这个项目 | [`conventions/CONTRIBUTING.md`](./conventions/CONTRIBUTING.md) |

### 架构与现状

| 你要改什么 | 先读 |
|---|---|
| 前端三站的目录 / 边界 / 构建 | [`plan/WEB-SPLIT.md`](./plan/WEB-SPLIT.md) |
| 前端现状（页面清单、API 对应、共享面） | [`plan/REFACTOR.md`](./plan/REFACTOR.md) |
| 后端路由 / 数据库 schema / OAuth / 加密 | [`architecture/ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) |
| 安全模型、威胁模型、防护层 | [`architecture/SECURITY.md`](./architecture/SECURITY.md) |
| 部署、nginx、certbot、systemd、环境变量 | [`ops/DEPLOY.md`](./ops/DEPLOY.md) |
| 用户可见的功能与用法 | [`ops/USAGE.md`](./ops/USAGE.md) |

---

## 目录结构

| 目录 | 放什么 |
|---|---|
| `conventions/` | 强制遵守的规范：提交、Issue、PR、贡献流程 |
| `design/` | 设计与技术选型：页面规范、版本基线 |
| `architecture/` | 长期有效的系统设计：架构、安全模型 |
| `plan/` | 计划与现状：拆分方案、现状盘点（有保质期） |
| `ops/` | 运维与使用：部署 runbook、用户指南 |

**新增文档放哪**，按内容性质判断：

- 强制所有人遵守 → `conventions/`
- 界面怎么做、技术用什么版本 → `design/`
- 系统怎么设计、边界在哪 → `architecture/`
- 待办、迁移计划、现状盘点 → `plan/`（落地后删除或压缩成结论）
- 照着做就能跑的操作手册 → `ops/`

判断标准：**这篇文档半年后还有用吗？** 有 → `architecture/` 或 `design/`；没有 → `plan/`。

---

## 文档清单

### conventions/ — 规范

| 文件 | 内容 | EN |
|---|---|---|
| [`CONTRIBUTING.md`](./conventions/CONTRIBUTING.md) | 贡献总入口：上手、流程、硬性约束、部署、沟通约定 | [EN](./conventions/CONTRIBUTING.en.md) |
| [`COMMITS.md`](./conventions/COMMITS.md) | commit 规范（Conventional Commits + 中文描述） | [EN](./conventions/COMMITS.en.md) |
| [`ISSUES.md`](./conventions/ISSUES.md) | Issue 规范：查重流程、创建模板、标签体系、关闭条件 | [EN](./conventions/ISSUES.en.md) |
| [`PULL-REQUESTS.md`](./conventions/PULL-REQUESTS.md) | PR 规范：分支模型、描述模板、review 检查项、合并 | [EN](./conventions/PULL-REQUESTS.en.md) |

### design/ — 设计与技术选型

| 文件 | 内容 | EN |
|---|---|---|
| [`DESIGN.md`](./design/DESIGN.md) | 页面设计规范：无障碍基线、组件模式、视觉与中文排版、状态反馈 | [EN](./design/DESIGN.en.md) |
| [`STACK.md`](./design/STACK.md) | 技术栈与版本基线：目标组合、升级顺序、各框架用法要点 | [EN](./design/STACK.en.md) |

### architecture/ — 系统设计

| 文件 | 内容 | EN |
|---|---|---|
| [`ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) | 系统架构：拓扑、鉴权流程、DB schema、加密、防滥用 | [EN](./architecture/ARCHITECTURE.en.md) |
| [`SECURITY.md`](./architecture/SECURITY.md) | 威胁模型 + 当前防护层 | [EN](./architecture/SECURITY.en.md) |

### plan/ — 计划与现状

| 文件 | 内容 | EN |
|---|---|---|
| [`WEB-SPLIT.md`](./plan/WEB-SPLIT.md) | 前端三站拆分方案：目标结构、边界规则、执行计划、待决策项 | [EN](./plan/WEB-SPLIT.en.md) |
| [`REFACTOR.md`](./plan/REFACTOR.md) | 前端现状盘点：三站边界、页面清单、API 全表、已知缺陷 | [EN](./plan/REFACTOR.en.md) |

### ops/ — 运维与使用

| 文件 | 内容 | EN |
|---|---|---|
| [`DEPLOY.md`](./ops/DEPLOY.md) | 部署 runbook + 故障排查表 | [EN](./ops/DEPLOY.en.md) |
| [`USAGE.md`](./ops/USAGE.md) | 按角色（admin / member / 外部访客）写的用法 | [EN](./ops/USAGE.en.md) |

`*.en.md` 是对应的英文版。**改中文版时同步改英文版**（见 `AGENTS.md` §4.7）。

---

## 维护约定

1. **索引是生成物。** 改了文档的 H1 标题或首个引用块（`> ...`）后，跑一次：

   ```bash
   node scripts/docs-index.mjs          # 重新生成 INDEX.md
   node scripts/docs-index.mjs --check  # 只校验，过期则 exit 1
   ```

2. **每个目录的说明取自该目录 `README.md` 的首个引用块。** 新建目录时补一份 README。

3. **移动或改名文档时同步修正相对链接。** 跨目录引用用 `../<folder>/<file>.md`。

4. **强制规则写进 `AGENTS.md` 的映射表**，否则 agent 不知道要先读它。`AGENTS.md` §0 的表与本文的「按改动类型找文档」必须保持一致。

---

## 公开可见性

`server/src/routes/docs.ts` 里有一份白名单，**只有列进去的 `.md` 才会出现在线上文档站**（`/docs/<id>`）：

```
README · USAGE · DEPLOY · ARCHITECTURE · SECURITY （各中英）
```

该接口**无鉴权**。

**以下不在白名单里，属于内部文档，公网读不到**：

`conventions/*` · `design/*` · `plan/*` · `INDEX.md` · `AGENTS.md`

要把某篇放上文档站，在 `server/src/routes/docs.ts` 的 `DOC_FILES` 数组里加一条（`id` 决定 URL，`file` 决定读哪个文件，路径要跟着目录变）。**加之前先确认内容能不能公开** —— 规范里含服务器信息、内部约定与安全模型。
