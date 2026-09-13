# CI/CD 发布控制实施约定

> 三条工作流（ci / preview / release）已落地并可在 GitHub Actions 上运行；部署 job 默认关闭，机器检查不替代人工试用。

状态：`accepted` · 更新：2026-09-13 · 实施状态：`.github/workflows/ci.yml`、`preview.yml`、`release.yml` 已落地并纳入版本控制；三者的部署 job 分别由仓库变量 `GEEK_DEPLOY_PREVIEW` / `GEEK_DEPLOY_PRODUCTION` 门控，默认未设置即为关闭，只产出并校验产物、不连接任何服务器。GitHub Environments（`preview`/`production`）、required reviewers、环境级 secrets/vars 和目标服务器均**尚未配置**；这些是启用部署前必须由维护者手工完成的前置条件，不由本文档或任何工作流自动创建。

## 当前范围

当前指令先把论坛数据拉到 Mac，不在这个步骤做线上迁移、服务替换或发版。发布规则以 [RELEASES](../conventions/RELEASES.md) 为唯一完整规范；Agent 第一操作以 [AGENT-START](../conventions/AGENT-START.md) 为准。编写此方案不代表已经有运行成功的 GitHub Actions、配置好的审批人或可用预发布服务器。

## 已确认的环境入口

| 环境 | 域名 | 发布选择 |
|---|---|---|
| preview / 预发布 | `https://prev.yangtzeu.work` | prev-X.Y.Z；日常增量为 X.Y.Z@准确 commit |
| production / 正式 | `https://yangtzeu.work` | release-X.Y.Z；正式禁止 @ 后缀 |
| local / 本地开发 | 本机回环地址 | 未发布，不算已部署的 preview |

根 [环境合同](../../deploy/environments.json) 是统一映射，离线发布规划必须核对域名，不允许工作流自由输入一个与 tag 不符的任意部署地址。论坛关于页已接入明确的环境/版本信息；这只显示构建身份，不代替服务端鉴权或部署记录。

两域名可能在同一台物理服务器，但必须使用不同进程、数据目录、数据库、上传目录、会话签名密钥及部署锁。Cookie 使用 host-only（不设置 Domain），禁止 `.yangtzeu.work` 这种父域共享；建议不同 __Host- Cookie 名。预发布不能读取生产用户会话，不能将本地真实备份作为 CI fixture 或公开静态文件。DNS、证书、反代、审批及独立数据通道尚未实际配置，本次只修改仓库代码/规范。

## 后续流水线的职责划分

| 流程 | 触发方式 | 动作与限制 |
|---|---|---|
| CI | PR 面向 main、main 更新 | 隔离安装、校验、测试、构建；无部署秘密、无 tag 写权限，不自动改版本 |
| 候选试用 | 人选择准确 main SHA | 准备隔离候选产物和试用入口，按已接受 prev 基准展示 `版本@SHA`；首次基准单独确认 |
| 预发布日常更新 | 受控选择 main SHA；自动触发须另行启用 | 仅更新 preview，固定现有已批准 prev 基准，不创建 tag、不修改基础版本 |
| 预发布里程碑 | 推送 `prev-*` tag | 严格解析 tag，核对 main 来源、tag 前人工验收、准确产物，部署 preview |
| 正式发布 | 推送 `release-*` tag | 同上，叠加 production 放行和防误操作；禁止 @ 版本 |
| 回滚 | 人工选择历史已验证产物 | 验证历史摘要、环境和数据库兼容性；不移动 tag、不清库 |

工作流不得混淆 `refs/heads/release-...` 与 `refs/tags/release-...`，也不得拿 glob 匹配当版本语法校验。发版不从 pull_request_target 执行不可信 PR 代码，不给 PR/fork 构建部署钥匙。自托管运行器不得接在有生产凭据或本地真实数据的 Mac 上执行不可信 PR。

## 工作流一览

以下按代码现状（`.github/workflows/*.yml`）描述，不代表远程已实际跑通或已具备人工门禁。

### `ci.yml`（CI）

- 触发：`pull_request` 面向 `main`；`push` 到 `main`、`next`；`workflow_dispatch`。
- 权限：顶层仅 `contents: read`；不挂任何 secrets。
- job：`core`（Node 22 + pnpm 9.15.9：`pnpm install --frozen-lockfile` → `pnpm check` → `pnpm test` → `pnpm build`）、`forum`（独立装 Node 26 + pnpm 11.24.0，`node scripts/forum.mjs install/check/generate`，`check`/`generate` 强制 `GEEK_FORUM_SOURCE=demo`）、`verify`（`needs: [core, forum, lint-workflows]` 且 `if: always()` 的汇总 job，供 branch protection 用作单一 required check；三者的 `result` 都必须为 `success`，`lint-workflows` 失败同样让这个 required check 变红）、`lint-workflows`（下载固定版本 `actionlint` 并核对内联 SHA-256，对 `.github/workflows/*.yml` 做静态检查）。
- 门禁：只做机器验证，不产出 artifact，不部署，不写版本或 approved 状态。
- 产物：无。

### `preview.yml`（Preview release，`https://prev.yangtzeu.work`）

- 触发：`push` tag `prev-*`（走 `release-policy tag` 模式，展示版本 `X.Y.Z`，不需要基准证据）；`workflow_dispatch` 传入 `commit` + `base_tag`（走 `release-policy preview` 模式，展示版本 `X.Y.Z@<12 位 commit>`，必须证明 `base_tag` 对应提交已有成功的 preview 部署记录，否则失败关闭；`vars.GEEK_PREVIEW_BOOTSTRAP=enabled` 只在 preview 环境从未有过任何成功部署记录的冷启动情形下放行，见下方仓库级 vars 表）。
- job：`plan`（`scripts/release-policy.mjs` 离线解析发布身份与基准证据，并对 `preview` Environment 的保护规则做一次只读提示——只发 `::warning`，不失败）→ `build`（双工具链安装、`node scripts/release-bundle.mjs build` 产出发布包，`actions/upload-artifact` 上传 `<artifactName>.tar.gz`/`.sha256`/`release.json`，保留 30 天；随后打印部署开关状态提示）→ `deploy`（`needs: [plan, build]`，`if: vars.GEEK_DEPLOY_PREVIEW == 'enabled'`，`environment.name: preview`，重算并核对产物 sha256、通过 SSH 把产物与 `deploy/remote/deploy-release.sh` 送到目标机执行、写显式 deployment 记录）。
- 门禁：`deploy` job 默认因 `GEEK_DEPLOY_PREVIEW` 未设置而跳过；`environment: preview` 这一行本身不产生人工门禁（见下方“机器门禁与人工门禁”）。
- 产物：`geek-preview-<releaseId>.tar.gz`、`.tar.gz.sha256`、`release.json`。

### `release.yml`（Production release，`https://yangtzeu.work`）

- 触发：`push` tag `release-*`。
- job：`plan` → `evidence`（正式发布特有；三项证据任一缺失即失败关闭：① 同一提交在 preview 环境有成功部署记录；② `https://prev.yangtzeu.work/release.json` 当前就是该提交；③ `production` GitHub Environment 已配置 `required_reviewers`，用 REST 实测 protection_rules，不信任 YAML 里写了 `environment: production` 这一行）→ `build`（同 preview 流程，另外比对 server/web 组件摘要与 `evidence` job 读到的 preview 摘要必须逐字节相等；forum 组件因注入内容不同不参与比较）→ `deploy`（`needs: [plan, evidence, build]`，`if: vars.GEEK_DEPLOY_PRODUCTION == 'enabled'`，`environment.name: production`，流程同 preview，部署不设 `cancel-in-progress`）。
- 门禁：`deploy` 默认因 `GEEK_DEPLOY_PRODUCTION` 未设置而跳过；即使开关打开，`evidence` job 仍会先核对 `production` Environment 是否配置了 `required_reviewers`，未配置则整条流水线在 `evidence` 阶段失败关闭。
- 产物：`geek-production-<releaseId>.tar.gz`、`.tar.gz.sha256`、`release.json`。

## 所需 GitHub Environments / secrets / vars 清单

以下是启用远程部署前必须由维护者手工配置的清单；条目取自工作流实际读取的变量名，当前均未配置。

### Environments（仓库设置 → Environments）

| 环境名 | 供哪个工作流引用 | 建议保护规则 |
|---|---|---|
| `preview` | preview.yml 的 `deploy` job（`environment.name: preview`，url 取 `plan` 输出的 `publicOrigin`） | 建议限制 allowed tags 为 `prev-*`、禁止自批。**不强制 `required_reviewers`**：`plan` job 会 REST 读一次保护规则，但只发 `::warning` 和 summary 提示，读不到或为空都不阻断——预发布的人工环节按 [RELEASES](../conventions/RELEASES.md) 落在打 `prev-*` tag 之前的人工试用、以及 `workflow_dispatch` 由维护者本人选定 `commit` + `base_tag` 上 |
| `production` | release.yml 的 `deploy` job；`evidence` job 会 REST 核对其 `required_reviewers` | **必须配置 `required_reviewers`**，否则 `evidence` job 会让流水线失败关闭；另建议限制 allowed tags 为 `release-*`、禁止自批 |

仅在 YAML 写 `environment: production` 不会自动产生保护规则——GitHub 会为不存在的环境名自动创建一个没有任何保护规则的环境；`release.yml` 因此不依赖这一行本身，而是用 REST API 实测。私有仓库能否配置 required reviewers 取决于实际 GitHub 计划，需维护者核实（见下方“启用顺序”）。

### 环境级 secrets（`preview`、`production` 各配一套，且两环境必须使用不同主机/用户/密钥）

| 名称 | 用途 |
|---|---|
| `DEPLOY_SSH_HOST` | 目标机地址 |
| `DEPLOY_SSH_PORT` | SSH 端口 |
| `DEPLOY_SSH_USER` | 部署用户（非 root） |
| `DEPLOY_SSH_KEY` | SSH 私钥全文 |
| `DEPLOY_SSH_KNOWN_HOSTS` | 目标机主机公钥行（`StrictHostKeyChecking=yes`） |

### 环境级 vars（`preview`、`production` 各配一套，取值必须互不相同）

| 名称 | 用途 |
|---|---|
| `DEPLOY_ROOT` | 部署根目录，见 [DEPLOY](DEPLOY.md) 的“流水线部署布局” |
| `DEPLOY_SERVICE` | systemd 服务名，与 sudoers 免密条目一一对应 |
| `DEPLOY_LOCAL_HEALTH` | 目标机本地健康检查 URL（`http://127.0.0.1:<端口>/...`） |
| `DEPLOY_TARGET_ENVIRONMENT` | 反回落哨兵：取值必须逐字等于所在环境名（`preview` 环境填 `preview`，`production` 环境填 `production`）。两个环境用的是同名 secrets/vars，环境级缺失时 GitHub 会静默回落到仓库级同名值，两端可能因此指向同一台机器；两个 deploy job 都会核对本变量是否等于自己的环境名，不等即失败并提示“环境级变量未配置或被仓库级值覆盖”。GitHub 逐个变量独立解析（environment > repository > organization），所以该哨兵只证明 `DEPLOY_TARGET_ENVIRONMENT` 本身配在环境级；`DEPLOY_ROOT`、`DEPLOY_SERVICE`、`DEPLOY_LOCAL_HEALTH` 与 5 个 SSH secret 仍须维护者逐项确认配在环境级，并且不要在仓库级创建任何同名 `DEPLOY_*` 项（仓库级一旦存在就可能静默回落） |

### 仓库级 vars（部署总开关，默认全部不设置即关闭）

| 名称 | 作用 |
|---|---|
| `GEEK_DEPLOY_PREVIEW` | 取值 `enabled` 才运行 preview.yml 的 `deploy` job；未设置时 `build` 仍产出并校验产物，仅打印“部署开关未启用”提示 |
| `GEEK_DEPLOY_PRODUCTION` | 取值 `enabled` 才运行 release.yml 的 `deploy` job；同上 |
| `GEEK_PREVIEW_BOOTSTRAP` | 仅冷启动有效的一次性开关。放行条件已收紧为「本仓库 `preview` 环境历史上从未有过任何 status 为 `success` 的 deployment」（工作流用 `GET /repos/{owner}/{repo}/deployments?environment=preview&per_page=100` 翻页统计，并逐个查其全部历史状态）。只要出现过一次成功部署，冷启动阶段即结束，此后即使取值为 `enabled` 也会**失败并提示删除该变量**，不会变成一个无范围的长期后门。建立首个基准后请立刻删除 |

## 启用顺序

以下每一步都需要人确认结果后再进入下一步；本文档不代表任一步已经执行。

1. 不配任何 secrets/vars/Environment，推一个 `prev-X.Y.Z` tag 或跑一次 `workflow_dispatch`，确认 `plan` + `build` 能在 GitHub 提供的 Linux runner 上跑完并产出 artifact；`deploy` 因开关未设置而跳过，属预期行为。
2. 按 [DEPLOY](DEPLOY.md) 的“流水线部署布局”与 `deploy/remote/deploy-release.sh` 头部注释的前置条件，在目标机准备部署用户、`DEPLOY_ROOT`、`shared/.env`、sudoers 单条 `systemctl restart <服务名>` 免密条目、Node 22、pnpm 9.15.9；先手工演练一次 `deploy-release.sh` 与一次 `rollback.sh`。
3. 创建 `preview` GitHub Environment，配置上述 5 个 secrets + 4 个 vars（均为环境级，其中 `DEPLOY_TARGET_ENVIRONMENT` 填 `preview`）；先不打开仓库级部署开关。
4. 冷启动首个 preview 基准：设置 `GEEK_PREVIEW_BOOTSTRAP=enabled` 与 `GEEK_DEPLOY_PREVIEW=enabled`，推首个 `prev-X.Y.Z`；成功后立刻删除 `GEEK_PREVIEW_BOOTSTRAP`。
5. 用 `workflow_dispatch` 跑一次 `commit + base_tag` 的日常增量，确认基准证据检查能从上一步的部署记录读到成功状态。
6. 创建 `production` GitHub Environment 并配置 `required_reviewers`，以及 production 环境级的 5 个 secrets + 4 个 vars（`DEPLOY_TARGET_ENVIRONMENT` 填 `production`，其余取值必须与 preview 全部不同）；若实际 GitHub 计划不支持私有仓库这一能力，到此为止，正式发布保持人工执行已验证产物，不打开 `GEEK_DEPLOY_PRODUCTION`。
7. 先验证构建可复现，再谈正式发布：对**同一个 commit** 连跑两次 `build`（或在本地对同一工作树跑两次 `pnpm build`），比对两次 `release.json` 的 `components.server.sha256` 与 `components.web.sha256` 是否逐字节相等。这两个组件不注入任何环境/版本元数据，`release.yml` 正是靠它们与预发布验收产物相等来断言「人试用过的就是这一份」；若同一 commit 两次构建就不相等，该断言只会随机失败，此时禁止打开 `GEEK_DEPLOY_PRODUCTION`，先定位不确定性来源。本地已实测一次相等（2026-09-13，同一工作树两次 `pnpm build` 的 server/web 摘要一致）；这是一次样本，不等于在 Linux runner 上也必然可复现，仍须在 CI 上实跑确认。
8. 确认候选提交已在 preview 线上（`https://prev.yangtzeu.work/release.json` 的 `commit` 字段与之一致）且已有人实际试用并明确批准后，才创建 `release-X.Y.Z` tag，再设置 `GEEK_DEPLOY_PRODUCTION=enabled`。

### 平台能力实测（2026-09-13，`gh api` 只读核对）

本机用只读 `gh api` 核对了本仓库的实际平台能力，结果直接决定上面第 6 步当前走不下去：

- 组织 `Yangtze-University-Geek-Class` 的 `plan.name` 实测为 `free`；仓库 `admin` 实测为 `private`（`visibility: private`）。
- `GET /repos/{owner}/{repo}/rulesets` 与 `GET /repos/{owner}/{repo}/branches/main/protection` 均返回 `403`，消息为 `Upgrade to GitHub Pro or make this repository public to enable this feature.`——即 `main` 与 `release-*`/`prev-*` 的 refs 保护在当前计划下配置不了。
- `GET /repos/{owner}/{repo}/environments` 的 `total_count` 实测为 `0`：`preview` 与 `production` 两个 Environment 都尚未创建，因此也不存在任何 `required_reviewers`。

结论：`production` 的人工门禁在**计划升级**或**改用受控外部审批**之前无法启用；`release.yml` 的 `evidence` job 会正确地在第三项证据上失败关闭。在此之前 `GEEK_DEPLOY_PRODUCTION` 必须保持关闭（不设置），正式发布由人手工执行已验证产物。403 消息里提到的“公开此仓库”不是本项目的可选项（见下方“机器门禁与人工门禁”），也不得以计划限制为由取消人工验收、伪造审批记录或删掉这项检查。

## 准入链

完整 ref + commit → main 祖先检查 → 版本/环境规则 → 锁文件安装与核心/论坛独立验证 → 被人试用的产物摘要和审批记录 → 对应环境放行 → 下载同一不可变产物 → 串行部署 → 健康、深链接和必要业务检查 → 记录结果或按方案回滚。

每个阶段明确失败退出；不能 `continue-on-error` 掩盖失败。生产和预发布使用不同并发锁、目录、域名/端口、数据库、Cookie、凭据和服务身份。旧请求排队不能覆盖更晚版本；切换前再次核对目标、tag 解析 SHA 和当前部署序号。生产部署不得在切换中被新任务直接取消。

## 机器门禁与人工门禁

GitHub 环境应显式创建并配置允许 tag/branch、人工 reviewer、禁止自批和绕过策略，再绑定环境级最小权限 secrets。仅在 YAML 写 `environment: production` 不会自动创建人工门禁；GitHub 会为不存在的名称创建没有保护规则的环境。

还应保护 main，以及 `release-*`、`prev-*` tag 的创建/更新/删除；普通 CI token 只读，不自动打 tag。可信发布者在创建 tag 前必须核对人工试用记录。自动部署若由人创建 tag 触发，仍须核对同一 SHA/产物证据，不信任可被 AI 或代码作者随意改写的 JSON `approved=true`。

本仓是私有项目，启用前必须确认实际 GitHub 计划能否为私有仓库提供 required reviewers 等能力。不能假定写好 YAML 就具备：官方当前说明，Free/Pro/Team 的这类保护规则只用于公共仓库。若当前计划不能提供，保持自动部署关闭，由受控外部审批/发布服务提供等价门禁，或由人手工执行已验证产物的部署；不得以此为由取消人工验收或公开私有仓库。

## 证据链

`release.yml` 的 `evidence` job 在 `build` 之前核对以下三项，任一缺失即失败关闭，不进入构建：

1. 同一提交在 `preview` 环境有成功的 GitHub 部署记录（显式 deployment，不是分支或 tag 名称匹配）。
2. `https://prev.yangtzeu.work/release.json` 当前的 `commit` 字段就是本次候选提交——避免“上一个预发布通过”被推广到未经试用的新代码。
3. `production` GitHub Environment 已配置 `required_reviewers`（REST 实测 protection_rules，不信任 YAML 中 `environment: production` 那一行本身）。

`build` job 之后另外比对核心组件摘要：server、web 组件的 `MANIFEST.sha256`/`release.json.components.*.sha256` 必须与 `evidence` job 读到的 preview 验收产物逐字节相等；forum 组件因构建时注入的环境/版本元数据不同，不参与相等性比较。以上证据链全部是机器可核验的一致性检查，不构成、也不能代替 [RELEASES](../conventions/RELEASES.md) 要求的“打 tag 之前的人工试用与明确批准”。

## 明确不做的事

- 任何工作流都不自动创建/移动/删除 tag，不自动升级 `package.json` 或任何版本字段，不写 `approved`/`deploymentAuthorized: true` 之类的放行状态。
- `production` 的 `deploy` job 不设 `cancel-in-progress`，不会在切换过程中被后来的新任务直接取消。
- 不从 `pull_request_target` 触发，不给 fork/PR 构建授予部署 secrets；`ci.yml` 顶层权限仅 `contents: read`，不挂载任何 secrets。
- 不把 `.tools`、真实数据库、`.env`、SSH 材料、内部文档或浏览器状态打进 CI artifact、缓存或发布包；发布包采用文件允许列表构建（见 `scripts/release-bundle.mjs`）。
- 机器 PASS（`pnpm verify`、CI 全绿、`release-policy.mjs` 输出）不构成人工验收记录，也不授权任何部署或发版动作。

## 双工具链和构建包

核心按根 manifest/锁文件使用 Node 22、pnpm 9.15.9；论坛按独立 manifest/锁文件使用 Node >=26、pnpm 11.24.0。分别安装、分别运行现有测试，避免用一套 Node 运行另一 ABI 的原生 SQLite 模块。线上目标为 Linux，不上传 Mac 原生依赖。

CI 使用临时测试库和虚构数据。发布包采用文件允许列表，仅包含运行必需代码/静态产物/版本元数据。禁止将整个工作区直接 tar 上传；`.tools`、真实数据库、附件备份、.env、SSH 材料、内部文档和浏览器状态不进入 CI artifacts、缓存或发布包。备份与发布产物是不同通道。

版本信息由构建注入独立 metadata：environment、baseVersion、displayVersion、full commit SHA、tag（有则填）、artifact digest、构建工具链与运行编号。@ 展示不是 package.json/npm 版本字段；不得为了展示每天改 manifest。精确版本号由人接受的 tag 决定。

## 服务器接入前待完成项

域名已确定为 prev.yangtzeu.work 与 yangtzeu.work；维护者仍须确认它们的服务器隔离方式、端口、目录、运行用户、服务名称、健康检查、数据库备份恢复与回滚路径；确认允许的发版人/验收人和首次版本；确认 GitHub 计划、保护规则和秘密范围。缺失项不从现有生产地址猜出来，也不复制现有 root SSH 凭据进 Actions。

现有新论坛还只有浏览器演示，没有生产身份/后端。数据原样到本地不等于目标 schema 已迁移，不因此放开生产门禁。数据库变更上线前另做副本演练、条数和引用核验、隐藏/删除/角色保留、附件校验及增量截流方案。

## 官方依据

核对日期：2026-09-13。以下是平台行为依据，不代表远程设置已完成。

- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax ：事件/ref 过滤、权限与并发。
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments ：环境保护、秘密放行、自动创建环境及私有仓库计划限制。
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets ：main/tag refs 保护。
