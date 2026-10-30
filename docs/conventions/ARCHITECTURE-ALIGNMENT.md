# PR 宏观颗粒度对齐

> 每个 PR 都把业务、后端、权限、数据、依赖、文档、验证和交付对齐到实际变更；纯 UI、文档和工程改动也不能省略。

状态：`current` · 更新：2026-10-30 · 适用：所有进入本仓库的 PR，不按 issue 编号、作者、标签或文件路径跳过。

## 硬约束

每个任务在 `docs/changes/<issue>.json` 保存本 PR 的影响声明（GitHub 镜像同步的声明在 `docs/changes/github/<编号>.json`，见「声明格式」），PR 正文必须有「宏观对齐」段落并引用该文件。它不是另一套接口/数据定义：节点、业务域和应用引用[项目目录](../architecture/catalog/README.md)，字段与 Schema 仍从源码生成。

**缺声明、缺维度、实际 diff 未覆盖、假称纯 UI、未知节点、缺相关文档或缺回归，一律失败。** 审查发现设计只处理局部、遗漏资源授权、事务或外部副作用，即使机器检查通过，仍按 [CODE-REVIEW](CODE-REVIEW.md) 判为阻塞。

「对齐」是可追溯的多对多关系，不要求一个功能对应一个接口或一张表，也不为对齐强行拆服务。

## 每个 PR 的固定步骤

1. 在现有[项目地图](../architecture/catalog/map.html)找到业务域与上下游，读对应服务合同；先确定功能放在哪里、复用什么，避免另造平行模块。
2. 在 issue 方案中说明业务规则的前后差异、请求与响应、授权主体/操作/资源范围、数据与事务、外部副作用、失败和兼容路径。UI 也要确认是否改变可操作性、请求参数或权限可见性，不能仅凭文件属于前端就归为纯视觉。
3. 创建或更新本任务的影响声明，覆盖实际改动，并把新的业务流程登记到目录的 `ownership.json`；接口、表与能力继续从代码提取，不再手写副本。每个核心业务操作与补充入口必须至少关联一个真实用例，生成器拒绝漏项。
4. 更新相关人工文档及回归，运行生成、目录、宏观对齐和完整验证。
5. PR 正文引用声明，简述关键取舍和残余风险。审查对照真实 diff、目录影响报告及测试结果，不以填了表或 CI 绿标替代设计判断。

## 声明格式

当前格式 `version: 1`，实际示例见 [#257 的声明](../changes/257.json)，判定实现是 `scripts/check-architecture.mjs`。

| 字段 | 必须写什么 |
|---|---|
| `issue`、`kind`、`summary` | 对应任务号、改动性质和真实业务/工程目标 |
| `applications`、`domains` | 受影响源码应用和业务域，必须存在于目录 |
| `flows` | 业务 PR 必须引用已登记用例；受影响业务域都要有对应流程 |
| `assessments` | 下表八个维度，逐项给 `status`、`reason`、`evidence` |
| `coverage` | 按具体模块/用例列 `paths`、`domains`、`nodes`、`reason`，覆盖全部实际改动 |
| `documents` | 相关人工文档；生成目录、索引和执行记录不能代替业务说明 |
| `tests` | 实际测试文件；代码或工作流变化必须在本 PR 增补回归 |
| `compatibility`、`migration`、`rollback` | 兼容性、数据演进、恢复路径；不涉及时也说明理由 |

GitHub 一侧的同步工单声明放 `docs/changes/github/<编号>.json`，由 `check-architecture.mjs --forge github` 读取；命令行不传 `--forge` 时，在 GitHub Actions 里（`GITHUB_ACTIONS=true`）按 github 读，别处按 gitlab 读，core 的 `pnpm check` 与 `architecture-alignment` 读的是同一份（#335）。GitHub 与 GitLab 的编号各自增长，两边同号的声明不能放在同一个扁平目录，否则后写的会覆盖先写的。

检查器的版本兼容（#330）：CI 的 `architecture-alignment` 只取 PR 目标分支（base）里的 `scripts/check-architecture.mjs`，候选分支改它不能自己放行。目标分支的检查器导出 `FORGES`（认 `--forge`）时，GitHub 一侧传 `--forge github`；不导出时按旧参数调用，只读扁平的 `docs/changes/<编号>.json`。目标分支连检查器文件都没有时失败关闭。GitHub `stage` 合入 #330 之前，同步 PR 按旧参数调用，首次同步的做法见 [BRANCHING](BRANCHING.md)「GitHub 镜像同步」的「首次同步」。

`coverage.paths` 可写具体文件或具体模块目录，以 `/` 结尾表示目录。拒绝 `app/`、`docs/`、`scripts/`、整个应用根目录等过宽范围和通配符。路径不能逃逸仓库，引用不能只指向声明自身。

八个维度缺一不可：

| 键 | 对齐内容 |
|---|---|
| `business` | 用户目标、业务归属、规则、不变量及状态转换 |
| `backend` | 模块设计、调用方、接口输入输出、错误、并发与兼容 |
| `permissions` | 身份、能力、资源范围、越权拒绝、服务端执行点 |
| `data` | 表与字段、所有权、事务、隐私、保留/删除及迁移 |
| `dependencies` | 上下游、外部服务、邮件/任务/审计等副作用 |
| `documentation` | 哪些事实变了，在哪些相关文档同步 |
| `verification` | 正常和拒绝路径、边界、回归、未验证项 |
| `delivery` | 构建产物、配置、环境、上线与回滚影响 |

`status` 只能是 `changed`、`unchanged`、`not-applicable`。后两者不免除具体理由和证据；触及后端、权限、持久化、依赖或交付相关实现时，必须引用本次对应 diff，不能以 `not-applicable` 放行。占位内容、只有“无影响”不算评估。

## 分类不是豁免

- `business`：业务处理、授权、持久化等行为变化；须关联业务流程。后端 routes/middleware/lib 及前端应用逻辑的修改不能伪装成工程或纯 UI。
- `ui-only`：严格限于样式、素材及相应文档/测试。修改组件逻辑、请求调用、条件显示或配置时不能直接用此分类。
- `docs-only`：只有文档和执行记录。不得夹带代码、配置或工作流。
- `engineering`：工具、构建、测试基建等工程变化。仍然要完成八维评估、实际文件覆盖、相关文档及回归。

非注册文件（store、策略、邮件 helper、前端逻辑等）由目录的源码归属映射到业务域；Nitro 后端及补充接口也纳入判定。修改到未登记业务源码必须先补归属，流程证据必须覆盖实际业务源码，不能引用无关用例凑数。跨域流程使用 relatedDomains 明确列出数据/副作用涉及的域。

新增或改变业务接口的 Schema 时必须同时声明响应 Schema。既有未补齐的响应契约作为存量缺口保留，不能将其称为完整 OpenAPI。物理表结构变化必须明确声明 `data: changed`，说明迁移、兼容与恢复并给出回归。

首次引入目录时没有可比较的基线，必须只建立真实目录，不允许同时修改业务路由、授权或数据结构来绕过增量契约检查。之后按 base/head 目录比较；删除实体可追溯到旧目录，回归与更新文档必须存在于候选提交，已删除测试不算新验证。

## 删除与重命名的基线证据

删除未关联现存流程的业务源码时，不要求在当前目录捏造一个引用已删除文件的流程。影响声明可提供 `removals`：`path`、`domains`、具体 `reason` 和旧源码唯一 `baseAnchor`。检查器必须从真实 Git diff 确认文件已删除，从 merge-base 读取旧源码核对唯一锚点，并与旧目录的业务域、当前 coverage、文档、回归及迁移/回滚评估对齐；普通保留文件不能走这条路径。

纯重命名可再给 `replacement`，必须是本 PR 实际变动、归属已对齐且与旧文件内容完全一致的源码。混有实现修改时不按纯重命名放行，仍要对齐现存业务流程。现存流程和当前源码的证据仍在目录维护，历史移除证据只在本 PR 声明与 Git 基线中保存。

## 文档事实未变与生成物

沿用既有文档同步规则：合法重构或回归补充未改变文档事实时，可以声明 documentation: unchanged，并在本任务新增执行记录中写真实的“文档核对：路径 不用改——理由”。检查复用 check-doc-sync 的对照表与核对解析，只认当前任务链新增且未改写的记录；错路径、空理由、模板原文和别的任务记录无效。没有对应模块映射的工具改动，仍须明确核对本 PR 引用的人工文档。其余八维评估与审查不豁免。

固定的目录 JSON、地图 HTML、生成 Markdown 和 docs/INDEX 是派生产物：保留 diff 覆盖与新鲜度检查，但不因为它们随文档重建，就把 docs-only PR 当成代码变更或强索新回归。直接篡改生成物仍由 check:catalog/目录测试拒绝。

## 命令与报告

```bash
pnpm catalog:generate
pnpm docs:index
pnpm check:catalog
pnpm check:architecture
pnpm verify
```

任务分支上的 `pnpm check` 包含目录及宏观对齐。默认比较 merge-base 到工作区，包括未提交和未跟踪文件；CI 显式传入 base/head/branch，只读这些 Git 提交，不受脏工作区影响：

```bash
node scripts/check-architecture.mjs \
  --base origin/stage --head HEAD --branch task/257/architecture_catalog \
  --body-file /tmp/pr-body.md --report /tmp/architecture-impact.json
```

CI 在每个 PR 创建、同步、重开、正文编辑等事件上运行 `architecture-alignment`，不设路径过滤或跳过标签。常规 PR 使用目标提交中的检查器，只把候选 Git 对象当数据；首次安装仍执行完整引导检查，不用成功退出代替检查。不读取部署 secrets，不安装或执行候选应用。目录新鲜度与真实回归由核心 `verify` 一起保证。

报告含实际文件、当前关联节点、移除节点 id、八维评估和目录摘要，可在地图「PR 影响」中导入。摘要不一致或未知节点拒绝导入，避免把旧报告套到新地图。导入报告只用于阅读，不能替代 GitHub 检查或审批。

## 合并与边界

进入 `stage` 前，`architecture-alignment`、`pr-contract (PR 正文契约)`、`verify (required check)` 都必须成功。GitHub 的真实拦截还需要将它们设置为受保护分支的必需检查，并要求 PR、对管理员同样生效；配置状态以 [CICD](../ops/CICD.md) 的实测记录为准，不能仅凭 job 名称称为已保护。

机器核对能发现缺项、悬空、实际路径不一致、契约/数据结构变化和漏文档，但不能证明任意自然语言理由真实或所有业务语义正确。审查必须继续核对完整用例、授权、事务和失败路径。测试通过与宏观对齐通过都不是发布授权。
