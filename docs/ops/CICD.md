# CI/CD 与部署控制

> 持续集成、宏观对齐与 `.env` 驱动的发布控制；发版只由发布 tag 触发（`vX.Y.Z-rc.N` → 预发布，`vX.Y.Z` → 正式），push 分支只跑 CI；部署开关默认关闭，机器检查不替代人工验收。

状态：`accepted` · 更新：2026-10-30 · 适用：现有发布流程及 GitHub admin#270 的 Arch 迁移接管。源码入口为 `.github/workflows/ci.yml`、两条 `deploy-*.yml`、架构/issue/分支/测试报告工作流；CI 与部署使用 GitHub 托管 runner。历史已发布状态、保护配置与本 task 未提交变更分别取证，不把旧 actionlint/CI 通过记录推广到本次候选。

发布规则以 [RELEASES](../conventions/RELEASES.md) 为唯一完整规范，分支模型以 [BRANCHING](../conventions/BRANCHING.md) 为准，环境字段契约见 [ENVIRONMENTS](ENVIRONMENTS.md)。

## 迁移集成与双仓边界

2026-10-26 协调者只读 refs 比较：两仓 main 同为 `61da3fea76f6f22aa53e731d98c842ac4a38d54f`；GitHub stage 为 `4beda55e7e6eb2dbd95206484ddaa18a72989ff0`，GitLab stage 为 `02cb751c0b830c0e686a180f6c6c5870c0c055ec`，GitHub 落后 473 提交，两者都包含 main。GitHub/GitLab tag 为 36/41，GitHub 缺 `v0.1.1-rc.21` 至 `rc.25`；共有 tag 对象与 peeled commit 无差。证据为主工作区 `.tools/handoff/2026-10-26-control/evidence/refs-comparison.json` 及风险登记；不是本轮已完成同步。

- task270 相对 GitHub stage 的既有集成基线有 **2363 文件**（459552 新增/113173 删除），不是只含迁移脚本。必须完整覆盖代码审查与 GitHub 必需门禁；局部语法、测试和文档检查不能替整段历史给绿。
- `docs/changes/270.json` 现在描述 **GitHub admin#270**（Arch 预部署 + GitLab 运维纳管）；历史 **GitLab geek/admin#270 OIDC** 的原影响声明已原样归档在 [history/changes/gitlab/270.json](../history/changes/gitlab/270.json) 与同名 `.md`，逐字保留、不是重写，也不是删除。两个平台的同号 issue 不是同一件事，引用时写全平台与项目。
- notes 收尾后追加与论坛分类数 6/7 的已知基线失败保留原记录/断言；不重复确认、不放宽校验。全局 notes、索引、影响声明及完整 PR 审查由协调者集成。
- 旧 tag 执行自己的工作流，不会自动得到 ProxyJump 和新目标校验。GitHub SSH secrets 已指 Arch，旧 tag 缺少跳板能力，应失败关闭，不能靠补推旧 tag 验证新链路；不 force/mirror 或重造 tag 对象。
- 原版双栈已由 Arch 接管，版本未变，见 [DEPLOY](DEPLOY.md#迁移现状与授权边界)。本轮只更新后续发布连接及源码合同，没有新的 rc 或正式版本批准；两个已有 enabled 开关保持不变，没有触发发布工作流。
- 2026-10-26 实测 GitHub 账号及 admin 权限恢复。双环境各 5 项 SSH secrets 已更新，正式 10 项、预发布 12 项应用 secrets 按 Arch 原运行值同步；预发布补齐 Google 两项、OIDC_JWKS、GITLAB_API_TOKEN。API 回读共 preview 17 / production 15 项。环境哨兵、required reviewers、tag 规则、分支保护保持不变。

核心单测包含真实 Rust CLI 分发与技能安装用例，测试中的 Cargo 以 `--locked --offline` 运行。`ci.yml` 的 `core` 和 `deploy-hotfix.yml` 的 `hotfix-core` 在单测前先运行 `cargo fetch --manifest-path app/cli/Cargo.toml --locked`，准备该锁文件的依赖；冷 runner 不依赖开发机缓存。预取失败就停止，不去掉测试的离线约束、不跳过两条真实 CLI 用例，也不以 Docker job 的独立缓存代替本 job 的依赖准备。


## 触发与职责

| 工作流 | 触发 | 行为 |
|---|---|---|
| `architecture-alignment.yml` | 每个 PR 的 opened / reopened / synchronize / edited / ready_for_review / labeled / unlabeled，无路径或分支过滤 | 只读真实 base/head Git 对象及 `docs/changes/<issue>.json`，核对八维评估、分类、精确覆盖、目录引用、相关文档与回归；常规 PR 使用 base 中的检查器，首次安装仍完整运行引导检查；检查器复制到 runner 临时目录时同时复制其本地依赖 `hotfix-windows.mjs`（#310），避免 hotfix PR 因模块缺失失败；不执行候选应用、不安装依赖、不拿 secrets；产物 architecture-impact 保留 14 天 |
| `ci.yml` | PR → `main`/`stage`；push `main`/`stage`/`task/**`/`dev/**`（不含 tag）；`workflow_dispatch` | `branch-guard`（分支不变量；task 分支的 PR 另查执行记录与本 PR 的文档同步）→ `core`（Node 22：check/test/build，检出完整历史；`pnpm check` 里的 `check:cli` 只在这个 task 相对 `origin/stage` 真的改了 `app/cli` 时才跑 `cargo fmt --check`/`clippy -D warnings`/`test`，ubuntu-latest 自带 Rust 工具链）∥ `forum`（Node ≥26：check/generate）∥ `env-contract`（`.env` 与 `environments.json`、compose 一致性，前端站点配置不含域名）∥ `docker`（`deploy/compose/{production,preview}.yml` 解析；固定容器构建并核对 CLI 五目标物料；三条镜像构建验证，web 显式接收 `cli=dist/cli`）∥ `docker-cdn`（静态资源 CDN 开关打开时的 web、forum 镜像构建，再像部署工作流一样取出产物、`static-cdn.mjs plan` 列上传清单，不上传，见下文「静态资源 CDN」）→ `verify` 汇总 |
| `deploy-preview.yml` | push tag `v[0-9]+.[0-9]+.[0-9]+-rc.[0-9]+`；`workflow_dispatch`（必填 `tag`，并从同名 tag 运行） | 断言 ref 是 `refs/tags/vX.Y.Z-rc.N` → `release-policy` 规划（提交在 `origin/stage` 上、版本等于 `package.json`）→ 文档同步（tag 指向的提交，见下文）→ `cdn-plan` 决定静态资源 CDN 开关 → 固定容器构建并核对 CLI 五目标物料 → 构建镜像（仅 web 接收 `cli=dist/cli`）→ `cdn-upload` 上传并核对带哈希的静态文件（开关关闭时只报告状态，见下文「静态资源 CDN」）→ 渲染 `.env.preview` → SSH 分发镜像与环境文件 → `deploy-stack.sh` → 健康检查 → 记录 deployment（payload 带 rc tag）。开关 `vars.DEPLOY_PREVIEW_ENABLED`；同一时刻只跑一个，不取消正在跑的运行 |
| `deploy-production.yml` | push tag `v[0-9]+.[0-9]+.[0-9]+`；`workflow_dispatch`（必填 `tag`，并从同名 tag 运行） | 断言 ref 是 `refs/tags/vX.Y.Z`（rc tag 被拒绝）→ `release-policy` 规划（提交在 `origin/main` 上、同一提交有 `vX.Y.Z-rc.N`）→ 文档同步（tag 指向的提交，见下文）→ 证据检查（见下文）→ `cdn-plan` → 固定容器构建并核对 CLI 五目标物料 → 构建镜像（仅 web 接收 `cli=dist/cli`）→ `cdn-upload` → 分发 `.env.production` → 部署 → 记录 deployment。开关 `vars.DEPLOY_PRODUCTION_ENABLED`，`environment: production`，不取消正在跑的运行 |
| `branch-hygiene.yml` | PR `closed`（`merged == true`）、每周一 03:17 UTC、`workflow_dispatch` | 合并后删除 head 为 `task/**` 的本仓分支（`contents: write`，只删 `task/**`，**永不**自动删 `dev/**` 或长期分支）；每周巡检远端 `task/**`，对「14 天无提交活动且无 open PR」的残留分支只输出 `::warning::` 与 step summary，不删除 |
| `cert-watch.yml` | 每天 01:43 UTC、`workflow_dispatch`（都只在默认分支 `main` 上的文件生效，合入 `main` 后才开始） | 从公网用 `openssl s_client -verify_return_error -verify_hostname` 核对 `yangtzeu.work`、`prev.yangtzeu.work` 的证书：连不上、链不可信、名字不匹配或剩余不到总有效期的四分之一即失败（GitHub 通知维护者）。`permissions: {}`，不接触任何 secrets；香港入口由 Caddy 续期，旧转发入口在 DNS 过渡期仍由 certbot 续期，见 [DEPLOY](DEPLOY.md#证书续期与到期监控) |
| `gitlab-cutover.yml` | `workflow_dispatch`，仅 `main`；`apply` 默认 false，保留 production required reviewers、哨兵与部署开关 | `status`/`sync-status` 只读；`stop-preview-sync` 先演算身份、备份和排空旧进程，再改持久设置及 canonical env、重启原镜像并核对健康；`migrate-subjects` 整批拒绝未对账身份；`stop-production-sync` 以同样的备份、锁、排空与健康门把正式写者改 off；`repair-duplicates` 默认演算，逐人核对后解绑并封禁改接前正式同步建出的重复号、把正式库的 sub 与映射改回原号（要求正式写者已停，取部署锁并先跑正式备份，任一条对不上整批拒绝）；`enable-production-sync` 要求预发布确实 off、主体迁完且旧成员资格对齐；`verify-accounts` 逐人核对唯一 OIDC 绑定、原 GitLab ID 与组权限；最后 `switch-issuer`。`path-status` / `move-production-path` / `rollback-production-path`（#335）把正式 GitLab 搬到正式入口的 `/gitlab`，由 `deploy/gitlab/move-path.sh` 串起 Arch 与香港两半（见下文）。不另发 rc、不改镜像或业务用户记录，回滚入口保留。状态输出只含计数、公开 provider uid 与 GitLab ID，不含 secret/sub。超时 120 分钟（搬家前后各一次 GitLab 一致性备份加容器重建）。 |
| `issue-lifecycle.yml` | PR 指向 `stage` 的 opened / edited / synchronize / reopened / closed / labeled / unlabeled、每天 03:37 UTC、`workflow_dispatch`（可勾「只读」） | `pr-contract`：核对 PR 正文契约（`Closes #<issue>` 与 task 分支号一致、issue 存在且开着、十个必需段落、验收证据、审查结论；issue 编号 ≥ 235 时再核对 PR 的「组:类」标签覆盖 issue 的标签、`ui:*` 有截图、`func:*` 有接口测试与接口验证；`scripts/pr-contract.mjs`、`scripts/issue-labels.mjs`，只检出目标分支上的脚本，不执行 PR 代码）；`close-on-merge`：合并进 `stage` 后关闭 issue 并在 issue 与 PR 上各留一条追踪记录（`issues: write`、`pull-requests: write`）；`sweep` 每天巡检（`scripts/issue-sweep.mjs`，规则见 [TRACKING](../conventions/TRACKING.md) §1）：关联 PR 已合并进 `stage` 还开着的 issue 自动关闭并留「关闭」记录（合并后重开过的、还有开着的 PR 的、合并不到一小时的不关），14 天没动静的留「超期」记录，14 天内关闭却没有合并 PR 也没有「关闭」记录的留「缺记录」，不重开（`issues: write`，只检出两个脚本）。定时任务只跑默认分支 `main` 上的文件，合入 `main` 之前仍是旧的每周只告警 |
| `issue-gate.yml` | issue 的 opened / edited / labeled / unlabeled | `gate`：把表单「改动类型」选的值加成「组:类」标签；核对标签、`ui:*` 截图、`func:*` 涉及接口，缺则加 `needs-evidence` 并评论，补齐后摘掉；评论里列出标题相似的开放与已关闭 issue（`scripts/issue-gate.mjs`、`scripts/issue-labels.mjs`；`issues: write`，只检出这两个脚本，不执行 issue 正文）。没有表单的 CLI / API 建单只给关键词推测，不自动加标签。只提示和标记，不关闭、不重开。issues 事件只跑默认分支 `main` 上的文件，所以要随发布进入 `main` 才生效 |
| `pr-agent.yml` | PR 指向 `stage` 的 opened / reopened / ready_for_review | `review`：用开源 PR-Agent（镜像按摘要固定，`docker://pragent/pr-agent@sha256:…`）读 PR diff，经 `https://ai.crosery.com/v1` 调模型（主 `gemini-3.8-flash-high`，备 `gemini-3.5-flash-lite`），在 PR 里写**一条**审查评论。只用 `pull_request`、不检出 PR 代码、不监听 `issue_comment`；只处理同仓库分支的 PR（fork 的拿不到 secrets，跳过）；关掉 describe 与 improve（describe 会改写 PR 正文，破坏十段契约）。密钥只有仓库级 secret `PR_AGENT_LLM_KEY`（网关 key，不属于环境级清单）。**只评论，不批准、不阻塞合并**，也不是审查结论（[CODE-REVIEW](../conventions/CODE-REVIEW.md)「机器审查的边界」）。另有 CodeRabbit 免费版（GitHub App，仅装在本仓库，配置 `.coderabbit.yaml`，不推代码、不批准、关掉所有 finishing touches）。升级镜像要核对新摘要后改工作流并走 PR 审查 |
| `test-report.yml` | PR 指向 `stage` 的 opened / reopened / synchronize / ready_for_review；`workflow_dispatch` | `e2e`：在托管 runner 上装 Chromium 跑 `pnpm test:e2e`，把 Playwright HTML 报告（含 trace）作为产物 `playwright-report` 留 14 天；只读代码、不拿 secret。托管 runner 只有 2 核、无 GPU，超时按 `E2E_TIMEOUT_SCALE=3` 放大（`playwright.config.ts` 的 `SLOW`）。`ci.yml` 的 `core` 另用 `pnpm run test --coverage` 产出 Vitest 覆盖率 HTML，产物 `vitest-coverage` 留 14 天。两份都是机器验证附件，不设覆盖率门槛，不替代人工验收（#248） |

- **push `stage` 或 `main` 不部署任何环境**，只跑 `ci.yml`。部署只由发布 tag 触发，规则见 [RELEASES](../conventions/RELEASES.md)。GitHub 的 tag 过滤按整个 tag 名匹配：`deploy-production.yml` 的 `v[0-9]+.[0-9]+.[0-9]+` 不含 `-`，匹配不到 `vX.Y.Z-rc.N`；两条部署工作流的 plan job 还会用完整正则再断言一次，前导 0、`rc.0` 等格式也会被拒绝。
- 手工运行部署工作流时，「Use workflow from」必须选同一个发布 tag，并在 `tag` 输入框里填这个 tag；ref 与输入不一致即失败。手工运行只用于重新部署已有 tag，不创建 tag。
- 一次只推一个发布 tag：GitHub 在一次推送超过三个 tag 时不产生 push 事件，工作流不会运行。
- **打 tag 之前先等这个提交上 `ci.yml` 的 `verify (required check)` 跑完并通过。** 部署记录用 `required_contexts` 只要求这一项检查，它还在跑或没通过时，创建部署记录返回 409，部署 job 在这一步失败（`scripts/deploy-manual.mjs` 同样）。刚合并进 `stage` 的提交要等 push `stage` 触发的那次 CI 结束再打 rc tag。
- tag 推送触发的是**该 tag 所在提交里**的工作流文件；手工运行也按所选 tag 的工作流文件执行，但入口要求工作流文件已经存在于默认分支（`main`）。
- `ci.yml` 的旧运行（#124）：同一 PR 或同一个 `task/**`、`dev/**` 分支推了新提交，旧提交还没跑完的运行自动取消，runner 让给新提交。被取消的运行因为 `verify` 是 `if: always()`（跳过会被当成通过，不能去掉），还会排一个 `verify` job，最后以 failure 或 cancelled 结束（runner 都忙时它会先显示排队中）。push `main`、`stage` 的运行不取消正在跑的；但同一组里已经有一个在排队时，GitHub 会取消排队中的那一次（默认 `queue: single`），连续合并三次以上时中间的提交可能没有 `verify`：打 rc tag 前先确认这个提交上的 `verify (required check)`，没有就重跑那次运行。
- `dev/**` 只在 `ci.yml` 里做机器验证，不部署、不获得任何发布含义；PR 仍然只能指向 `main`/`stage`，`dev/**` 不得作为进入 `stage` 的凭据；旧的 `dev-*` 名字不再触发 `ci.yml`（见 [BRANCHING](../conventions/BRANCHING.md) 命名规则）。
- `branch-hygiene.yml` 是「合并后立即删除 task 分支」的执行者；它不创建 tag、不动 `main`/`stage`、不改 PR 状态，也不接触任何 secrets。巡检发现残留分支只告警，删除留给人工决定。

- `ci.yml` 顶层权限仅 `contents: read`，不挂载任何 secrets，不产出可部署产物。
- `branch-guard` 运行 `node scripts/check-branch-invariants.mjs`（`--require-remote-refs`）：核对两条不变量（`stage ≥ main`、`main` 不领先 `stage`）与分支命名卫生，并检查写入 `main` 的提交来源。不变量定义见 [BRANCHING](../conventions/BRANCHING.md)。同一脚本的 `--push` 模式还在本地 pre-push 里核对发布 tag（格式、所在分支、版本号、不可删除和移动）；`ci.yml` 不由 tag 触发，tag 的服务端核对在两条部署工作流的 plan job 里。
- **文档跟着模块改**（对照表与规则见 [docs/README](../README.md)「文档跟着模块改」，`scripts/check-doc-sync.mjs`）：`core` 的 `pnpm check` 里有 `check:doc-sync`：PR 运行时检出的是 GitHub 做的合并提交，push `stage`/`main`/`dev/**` 时是分支本身，都按第一父链的时间比较每一对模块与文档；push `task/**` 时按 PR 对 `origin/stage` 核对。检出写 `fetch-depth: 0`，浅克隆直接失败。`branch-guard` 在 task 分支进 `stage` 的 PR 上再跑 `--base origin/stage --head <task 分支>`：merge-base 以来动了模块，就要改对应文档的说明，或者在这个 task 的执行记录里写文档核对（`--head` 用来找到这个 task 的执行记录，检出的合并提交上没有分支名）。第一父链的比较依赖 PR 只用 merge commit 进 `stage`（[BRANCHING](../conventions/BRANCHING.md)）。改 `.github/workflows/` 就要同时改本文档；改 `deploy/` 就要改 [DEPLOY](DEPLOY.md)、[ENVIRONMENTS](ENVIRONMENTS.md) 或本文档里对应的说明（三份里至少动一份，改哪份看改了什么）。
- **发版时在 tag 指向的提交上再核对一次文档同步**（#192）：两条部署工作流的 plan job 在 `release-policy` 规划与环境契约之后、任何构建之前跑「文档同步（发布 tag 指向的提交）」：先核对检出的 HEAD 就是 tag 指向的提交，再运行 `node scripts/check-doc-sync.mjs`。检出的是 tag（detached HEAD，没有分支名），脚本按第一父链的时间核对，与 push `stage` 时 `core` 里 `pnpm check` 的规则相同；完整历史来自 plan 检出的 `fetch-depth: 0`，浅克隆直接失败。脚本只用 Node 内置模块，plan job 只按 `.nvmrc` 装 Node，不装依赖。不通过 plan 就失败，后面每个 job 都 `needs: plan`，不构建、不上传 CDN、不部署；`scripts/deploy-manual.mjs` 只认 build 成功的运行，也部署不了。不通过时按报错在 `stage` 上补文档，再在补好的提交上打下一个 rc。rc tag 打在 `stage` 的合并提交上时比的是 `stage` 的第一父链；打在 PR 里面的某个提交上时比的是那条 task 分支的直线历史，模块提交排在文档提交后面就报不同步。这一步只在包含它的提交上生效：tag 触发的是 tag 所在提交里的工作流文件。`tests/tooling/deploy-doc-sync.test.ts` 核对两条工作流都有这一步、在 plan job 里、排在完整历史的 tag 检出与 Node 安装之后、没有条件和吞掉失败的写法、其它 job 都 `needs: plan`，并在临时仓库里照工作流的写法跑这一步：不同步的提交失败，同步的通过，HEAD 不是 tag 的提交或浅克隆都失败。
- `env-contract` 校验两份 `.env` 的字段契约（非密值必填、契约外字段拒绝、密钥必空、`PUBLIC_ORIGIN` 逐字等于环境 origin、两环境端口/域名必须不同）与 `deploy/environments.json`、compose 文件的一致性，并用 `pnpm check:site-config` 确认前端 `app.config.json` 不含任何域名（每个环境一个 origin，管理端按路径区分）。 `pnpm check` 另跑 `check:env-isolation`（#309）：核对正式、预发布、本机三份 `.env` 键集一致、值互相隔离，正式与预发布除登记的差异键外取值相同，代码和部署片段里的环境域名都登记在 `deploy/env/origin-exceptions.json`（规则见 [RELEASE-PARITY](../conventions/RELEASE-PARITY.md)）。
- 部署工作流用 **build args** 把发布身份注入镜像：`GEEK_RELEASE_VERSION`（正式 `X.Y.Z`，预发布 `X.Y.Z-rc.N@<sha12>`）与 `GEEK_RELEASE_COMMIT`（完整 SHA），不写进 `.env`；展示规则见 [RELEASES](../conventions/RELEASES.md)。
- plan job 检出发布 tag（`fetch-depth: 0`，带全部分支与 tag），核对检出的 HEAD 就是 tag 指向的提交；build 与 deploy job 按 plan 输出的完整 SHA 检出，不再按 tag 名重新解析。
- **镜像名按环境分开**：`deploy-preview.yml` 构建并打包 `yzgc-preview/{server,web,forum}:<sha12>`，`deploy-production.yml` 构建并打包 `yzgc-production/{server,web,forum}:<sha12>`（仓库名来自 plan 输出的 `imageRepository`，归档名 `yzgc-images-<environment>-<sha12>.tar.gz`）。目标机的 `deploy-stack.sh` 在 `docker load` 之前读归档清单，出现别的仓库或别的 tag 就拒绝。`ci.yml` 的 `docker` job 按正式身份构建 `yzgc-production/*`，并用同一个 `IMAGE_TAG` 解析两套 compose，两边出现相同镜像引用即失败；`docker-cdn` 在另一个 runner 上按同样的身份、打开静态资源 CDN 开关再构建 web、forum 两个镜像。
- **CLI 发布物料与 web 镜像同一次构建闭合**：`ci.yml` 的 docker job 与两条部署工作流都调用 `node scripts/cli-dist.mjs --container`；固定到 digest 的 `cargo-zigbuild` 镜像提供 Rust、Zig、cargo-zigbuild 和 macOS SDK，内部逐目标 `rustup target add` 后按 `--locked --jobs 2` 交叉编译。分发器把二进制写成 `dist/cli/<CLI版本>/geek-<target>-<sha256>[.exe]`：同内容 URL 稳定、不同内容换 URL，已存在的摘要路径只在字节一致时复用，不覆盖或删除旧产物。`node scripts/check-cli-dist.mjs` 随后核对 CLI 版本、五目标清单、内容寻址文件名、非空二进制、manifest/sidecar/实际字节三方 sha256 和安装脚本；任一步失败都在 Docker build 前停止。server/forum 不接收 CLI 目录，web 构建显式传 `--build-context cli=dist/cli`，由 `app/web/Dockerfile` 的 scratch `cli` 阶段复制到 `/usr/share/nginx/html/cli/`。本机复现发布物料使用同两条命令；本机 Docker 不可用时只报告未运行，不把普通空 context 镜像称为通过。
- `verify` 是单一 required check 输出，供分支保护引用；任一上游 job 失败即汇总为失败。不得用 `continue-on-error` 掩盖失败。
- **历史核对：2026-10-02 当时没有分支保护或 ruleset 引用 `verify`**（2026-10-02 只读核对：`gh api repos/Yangtze-University-Geek-Class/admin/rulesets` 返回 `[]`，`stage`、`main` 的 `branches/<分支>/protection` 都返回 404 `Branch not protected`）。名字里的 required 不是 GitHub 意义上的必需检查：CI 报红不会自动拦住合并，直推 `stage`/`main`（hot-fix 合回）也不经过 PR 检查。例：`9b38684`（#173 的 hot-fix 直接合回 `stage`）改了 `app/web/`、`app/forum/`、`deploy/` 却没跟文档，push `stage` 的 CI（运行 36318197583）`core` 报文档不同步、`verify` 失败，没有拦住任何东西；PR #174 最后一次 CI（运行 36322153265）的 `branch-guard` 报 `stage` 本来就不同步，`core`、`verify` 也失败，照样在 2026-09-27T16:06:26Z 合进了 `stage`。把 `verify (required check)` 设成 `stage`、`main` 的必需检查、要不要禁止直推，是仓库设置，决定后在 Settings → Rules 里配置（需要仓库 admin 权限），#192 的 PR 不改设置。2026-10-18 启用前，合并的人自己确认 CI 全绿（门禁没通过，[CODE-REVIEW](../conventions/CODE-REVIEW.md) 的结论就是阻塞），发版时 plan job 的文档同步再拦一次（见上文）。
- **部署开关默认关闭**：`DEPLOY_PREVIEW_ENABLED`、`DEPLOY_PRODUCTION_ENABLED` 不设置即不部署；不设置时 `ci`/构建仍照常运行并产出镜像校验结果。取值必须逐字为 `enabled`。

## PR 宏观对齐与远端强制

规则与声明格式见 [ARCHITECTURE-ALIGNMENT](../conventions/ARCHITECTURE-ALIGNMENT.md)。根 `pnpm check` 在 task 分支上核对当前工作区；独立 `architecture-alignment` 对每个 PR 和正文编辑用明确的 base/head/branch 检查，读取候选 JSON/文件而不导入候选应用。目标分支已安装检查器时使用目标版本，候选修改校验器不能自行放行；首次安装不跳过，完整执行引导版本并要求审查。检查没有标签、作者、旧 issue 编号或路径豁免。

`architecture-alignment` 与 `pr-contract (PR 正文契约)` 是独立检查，`verify (required check)` 继续汇总核心/论坛/镜像等机器验证。要让 GitHub 真正拒绝未对齐 PR，stage 必须将三项都设为 required status checks，要求 PR 且对管理员生效；不要用只读配置检查结果替代实际启用。2026-10-18 本次只读核对：仓库 PUBLIC、当前账号 ADMIN，stage 的 protection 返回 404 Branch not protected。此记录是启用前状态。

2026-10-18 用户明确要求完成全部收尾后，已用 GitHub REST 启用并重新读取 stage 分支保护：三项检查均绑定 GitHub Actions app 15368，strict=true，enforce_admins=true，禁止 force-push 和删除。required_pull_request_reviews 已配置，要求通过 PR；required_approving_review_count=0，语义审查继续由独立审查结论和正文契约负责，不冒称 GitHub 强制了另一位账号审批。仓库已关闭 squash/rebase，只允许 merge commit。main、发布 tag 和部署开关未在本任务修改。

这些设置跨工具生效：OMP、Claude、Codex 或人工提交都走相同检查；仓库管理员仍有修改保护配置的权限，模型是否真的理解业务由审查核对，不能从绿标推断。实际 PR 拦截实验与最终 CI 记录保存在 #257 对应的 PR。

真实拒绝实验：PR #258 的 `ac9970772b39832cae99d2957af527222841a5b9` 故意省略宏观对齐段，Actions 运行 `39136692232` 明确因缺少声明引用退出 1；GitHub 返回 `mergeStateStatus=BLOCKED`，对同一 SHA 的标准合并请求返回 HTTP 405（2 of 3 required status checks are failing）。随后恢复完整正文并修复另外的 CI 问题，只有全部必需检查通过后才允许合并；拒绝实验不修改或绕过保护配置。

产物 `architecture-impact.json` 带实际文件、关联节点、八维评估、base/head 和目录摘要，可本机导入项目地图；报告不构成审批。工作流只用 contents: read，不使用 pull_request_target，也不触及任何部署环境。

## 环境身份

| 环境 | 发布 tag（提交所在分支） | GitHub Environment | 栈根 | 入口 |
|---|---|---|---|---|
| preview | `vX.Y.Z-rc.N`（`stage`） | `preview` | `/opt/yzgc/preview` | `https://prev.yangtzeu.work`（管理端 `/admin`、`/console`） |
| production | `vX.Y.Z`（`main`） | `production` | `/opt/yzgc/production` | `https://yangtzeu.work`（管理端 `/admin`、`/console`） |

[deploy/environments.json](../../deploy/environments.json) 是环境身份的唯一机器配置，两份 `.env` 的 `GEEK_DEPLOYMENT_ENVIRONMENT`、`GEEK_ENVIRONMENT_ORIGIN`、`STACK_ROOT`、`COMPOSE_PROJECT_NAME` 必须与之一致，由 `env-contract` 与实际部署脚本双重核对。两环境同机不同栈，不共享数据库、卷、密钥或 Cookie 域。

## 环境级 secrets / vars 清单

启用远程部署前必须由维护者逐项配置。两个环境用的是**同名**条目，环境级缺失时 GitHub 会静默回落到仓库级同名值，因此**不要在仓库级创建任何 `DEPLOY_*` 条目**。

### secrets（`preview`、`production` 各一套，取值必须不同）

| 名称 | 用途 |
|---|---|
| `DEPLOY_SSH_HOST` | 与 tag 物料中模板 `DEPLOY_HOST` 逐字匹配；Arch 候选为 `10.66.0.2`，旧源值不符则失败 |
| `DEPLOY_SSH_PORT` | 与模板 `DEPLOY_PORT` 逐字匹配 |
| `DEPLOY_SSH_USER` | 与模板 `DEPLOY_USER` 逐字匹配；不表示已具目标权限 |
| `DEPLOY_SSH_KEY` | 本次专用部署私钥，权限需预配；禁止个人 root 私钥进入 CI |
| `DEPLOY_SSH_KNOWN_HOSTS` | 预先核验的香港跳板与 Arch 双端主机公钥，`StrictHostKeyChecking=yes` |
| `OAUTH_CLIENT_ID` | GitHub OAuth 应用（每个环境一个，Callback URL 为 `<origin>/auth/callback`，见 [ENVIRONMENTS](ENVIRONMENTS.md#github-oauth-app-回调地址)）。GitHub 不允许 secret 名以 `GITHUB_` 开头，所以这两项叫 `OAUTH_CLIENT_*` 而不是 `GITHUB_CLIENT_*` |
| `OAUTH_CLIENT_SECRET` | GitHub OAuth 应用密钥 |
| `SESSION_SECRET` | 会话签名密钥（≥32 字符随机值） |
| `ENCRYPTION_KEY` | 32 字节密钥的 base64（GitHub token 加密） |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile 站点键 |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile 服务端密钥 |
| `MAIL_ALIYUN_ACCESS_KEY_ID` | 阿里云邮件推送的 AccessKey ID（可选，和下一项要么都配、要么都不配） |
| `MAIL_ALIYUN_ACCESS_KEY_SECRET` | 阿里云邮件推送的 AccessKey Secret |
| `MAIL_RESEND_API_KEY` | Resend 的 API Key（可选） |
| `MAIL_ALLOWLIST` | allowlist 模式的私密收件名单；当前权威源保持 all，独立恢复副本必须另行禁用外发 |
| `GOOGLE_CLIENT_ID` | Google 登录的 OAuth 客户端 ID（可选，和下一项要么都配、要么都不配；回调地址 `<origin>/auth/google/callback`，#262） |
| `GOOGLE_CLIENT_SECRET` | Google 登录的 OAuth 客户端密钥 |
| `OIDC_JWKS` | 对外授权的签名私钥（可选，#270）：`dist/cli/oidc.js keygen` 输出的一行 base64；为空时 `/oidc/*` 一律 404 |
| `GITLAB_API_TOKEN` | 自建 GitLab 管理员的 `api` 令牌（#270）：只在 `GITLAB_SYNC=on` 时必填 |
| `CDN_MIRROR_ACCESS_KEY_ID`、`CDN_MIRROR_SECRET_ACCESS_KEY` | Garage 只读密钥 `backup-reader`（#309）：不进运行时 env，部署后的宿主层步骤经 stdin 写入目标机 `/etc/cdn-mirror/env`，供 CDN 镜像拉取五个桶；没配时沿用目标机已有的凭据 |

两条部署工作流的「渲染运行时 env 文件」步骤把上表从 `OAUTH_CLIENT_ID` 起的每一项按同名传给 `scripts/deployment-environment.mjs render`，`scripts/deploy-manual.mjs` 的 `SECRET_ENV` 也是同一份名单；`tests/tooling/deploy-manual.test.ts` 核对这三处与 `SECRET_FIELDS` 一致。发信四项都没配时照常部署，server 不发信；Google 两项都没配时照常部署，登录页不出现 Google；`OIDC_JWKS` 没配时照常部署，对外授权关闭，`GITLAB_API_TOKEN` 没配而 `GITLAB_SYNC=on` 时渲染失败、不部署，见 [ENVIRONMENTS](ENVIRONMENTS.md)。

### vars

| 层级 | 名称 | 用途 |
|---|---|---|
| 环境级 | `DEPLOY_TARGET_ENVIRONMENT` | **反回落哨兵**：取值必须逐字等于所在环境名，两个 deploy job 都会核对，不等即失败并提示「环境级变量未配置或被仓库级值覆盖」 |
| 仓库级 | `DEPLOY_PREVIEW_ENABLED` | 取值 `enabled` 才运行 `deploy-preview` 的部署 job |
| 仓库级 | `DEPLOY_PRODUCTION_ENABLED` | 取值 `enabled` 才运行 `deploy-production` 的部署 job |

密钥只经环境级 secrets 注入渲染后的运行时 env 文件（`<栈根>/.env.<environment>`），**不写入仓库、镜像、日志或发布记录**；`deploy/env/.env.*` 模板中的密钥字段必须保持空值，由 `env-contract` 强制。

两条 deploy job 使用 `environment.deployment: false` 保留环境 secrets/vars、required reviewers 等保护，同时避免在步骤执行前创建隐式部署记录；目标校验后才执行显式 record/status。自定义 deployment protection App 与该模式不兼容时失败关闭，不移除审批求通。本轮 actionlint 与隔离 shell 已验证，未执行 GitHub Actions 平台实验。该门禁保护 deploy 阶段的目标机传输和记录，不改变上游 CDN job 的上传顺序。

CI/manual 均从同一 tag 物料分发 `deploy-stack.sh` 和 `rollback-stack.sh` 到 `<STACK_ROOT>/incoming/`；不得从工作区拼进历史 tag。历史 tag 没有新 `ssh-config` 命令时失败关闭，不能把当前脚本能力倒算给旧版本。

### SSH 目标与 ProxyJump 失败关闭

两条候选部署工作流在检出 plan 核对的提交后、下载归档/渲染及任何 SSH/SCP 前，调用该提交的 `deployment-environment.mjs ssh-config`；manual 使用从 tag 归档得到的同一入口。要求环境哨兵、模板环境身份与 `DEPLOY_SSH_HOST/PORT/USER` 全部匹配，缺失或旧源地址与 Arch `10.66.0.2` 不符即失败，不以 fallback 静默选目标。

`DEPLOY_PROXY_JUMP` 从模板取值，当前候选为 `root@156.238.244.78:22`，直连必须显式留空。生成的 0600 配置同时供 `ssh -F <配置> yzgc-target`、`scp -F <配置>` 使用，固定专用 key、known_hosts、`IdentitiesOnly`、`BatchMode`、严格主机校验及 `ProxyJump`；跳板与目标双端都须有经核验的主机公钥/专用部署授权，不能复制个人 root key 或关闭校验求通。

这是待合并源码的合同，不会回溯修改旧 tag。2026-10-26 已用同一 `ssh-config` 入口、项目专用 key、双端严格 known_hosts 实测两环境 SSH/SCP 成功；香港该 key 的本地 TCP 转发目标限制为 Arch:22，执行 shell 被拒绝。此证据来自维护者机器，不冒称 GitHub runner 已运行新流程。恢复副本隔离仍见 [ENVIRONMENTS](ENVIRONMENTS.md#副本启动安全门禁)，已接管的权威源不套用副本关闭外发的值。

### GitLab 双实例的受保护运维入口（#308）

`gitlab-cutover.yml` 仍仅从main运行并要求production的真实required reviewers、哨兵、受控Arch目标和部署开关；不放行task分支或取消审批。新增 `preview-status` / `install-preview` / `verify-preview` 分发同一提交的独立编排与安装器，默认plan，`install-preview` 且勾apply才安装；不替换平台应用镜像、不复制正式数据。安装后经 `install-host.sh --target gitlab-preview` 安装该实例的备份与开机单元。

香港入口动作 `edge-status` / `edge-apply` / `edge-verify` / `edge-rollback` 使用独立环境secret `GITLAB_EDGE_SSH_KEY`，主机从canonical `DEPLOY_PROXY_JUMP` 推导，沿用已核验known_hosts。专用key服务端只允许固定动作，不能取shell或上传任意配置；edge-apply写入前还要核对独立预发布容器healthy。首次受限通道安装由所有者单独批准，不能拿个人root私钥替代。候选配置通过真实Caddy解析不是已上线证据，SSO/Git/Issue/MR仍须真实验收。

`path-status` / `move-production-path` / `rollback-production-path`（#335）在同一 job 里分发本次提交的 `deploy/gitlab` 与两份环境模板到 Arch，再在 runner 上跑 `deploy/gitlab/move-path.sh`：Arch 一半经部署 SSH 调 `cutover.sh` 的 `path-status|move-production-path|finish-production-path|rollback-production-path`，香港一半经 `GITLAB_EDGE_SSH_KEY` 调受限接收器的 `production-plan|apply|rollback`，公网核对从 runner 发起。`GITLAB_URL`、sector 从 `deploy/env/.env.production` 读，旧地址从 `deploy/gitlab/gitlab.caddy` 的站点行读，签发者是两份模板的 `PUBLIC_ORIGIN`；不勾 apply 只演算。原 `cutover.sh` 步骤现在也带 `--sector`（`GITLAB_OIDC_SECTOR`），并多分发 `.env.production`（无密钥模板）。`tests/tooling/gitlab-move-path.test.ts` 核对这三个选项的接线。



## 同版本 P0 hotfix（#306）

所有者 2026-10-28 确认的流程见 [RELEASES](../conventions/RELEASES.md#线上紧急缺陷hotfix规约)。新增第十一条工作流 `deploy-hotfix.yml`，只从 `main` 手工触发，输入当前正式版本 tag、明确的 main 完整 SHA 和已批准的 P0 issue。不创建、不移动 tag，不改版本号，不制造 rc 证据。

`issue` 输入必须是 `deploy/hotfix/windows.json` 里登记的、`open` 且没过期、`tag` 就是这次 tag 的 hotfix 窗口（所有者署名与批准原话，最长 7 天）；`plan` 与审批后的二次 `plan` 都用 `scripts/hotfix-policy.mjs` 校验，没登记、已 `closed` 或已过期都直接失败。同一份登记也让 `branch-guard` 放行窗口内 `main` 领先 `stage` 的提交（每个提交要归属于窗口 issue）。hotfix 的 MR 合进 `main` 后用 `scripts/hotfix-sync.mjs` 同步镜像并把 `main` 合回 `stage`；仓库根的 `.gitlab-ci.yml` 可以在 `main` 更新后自动跑它（项目变量 `HOTFIX_SYNC_ENABLED=true` 才启用，默认关闭）。规则见 [BRANCHING](../conventions/BRANCHING.md)「线上紧急修复」。

- `plan` 用只读 `hotfix-policy.mjs` 绑定当前 main、检出 HEAD、工作流 SHA、历史 tag 祖先与提交态版本，核对文档和环境契约。
- `core` 跑 `pnpm check/test/build`，`forum` 使用与常规 CI 相同的 Node 26/pnpm 11 独立检查和生成；`hotfix-verify` 汇总这两项成功并验证线上同版本及成功生产 deployment。上述证据全部成功后，job 再用 `statuses: write` 把同名 `hotfix-verify` 写为 success commit status：`workflow_dispatch` 的 check-run 不会自动满足 Deployments API 的 `required_contexts`，2026-10-29 首次 hotfix 部署因此在创建记录时 409；这个显式状态只映射已完成的真实验证，不跳过检查。普通 CI 的分支不变量仍按原规则报告，不用假绿掩盖 hotfix 期间 main 暂时领先。
- CDN 规划、三镜像构建、内容验证和部署步骤沿用 `deploy-production.yml` 的合同；本工作流与常规正式发布共用 `deploy-production` 并发锁，所有 job 仍在 GitHub 托管 runner。维护这些步骤时同步两份工作流。
- `production` 与 `static-cdn` 的部署来源规则需要额外精确允许 `main`，原 tag 规则和生产 required reviewers 保留；不允许 task、stage 或任意分支取得生产密钥。
- 审批后重新核对 main/tag/线上版本，分发前要求 `yzgc-backup@production.service` 完成一致性备份及隔离恢复验证。镜像与 env 仍经原有校验、`deploy-stack.sh` 健康门和自动回滚。模板密钥留空，production 的 Google 客户端配置经本环境 secrets 注入。
- deployment 的 `ref` 是实际修复 SHA，payload 的 `mode=hotfix`、`base_tag_commit`、`issue` 与 `tag` 一起保留；required context 为真实运行的 `hotfix-verify`，不是修改普通 `verify` 状态。
- 部署记录 API 读取 commit status contexts，因此创建记录前由 `hotfix-policy.mjs publish-check` 严格核对本次 main/workflow_dispatch 的 run、attempt、SHA、唯一成功 hotfix-verify job、check suite、GitHub Actions app 和真实 job URL，再投影为同名成功 status。非空 `required_contexts` 保留；来源不完整、失败或歧义时拒绝发布 status。仅 deploy job 获得 `checks: read`、`statuses: write`，不修改任何 check-run 结论。
- 正式验证后将 main 合回 stage，再核对双仓 refs 与 `git merge-base --is-ancestor main stage`。回滚选择部署历史里的上一生产镜像 SHA，不恢复旧数据库覆盖上线后的新写入。

## 同构清单与发版烟测（#309）

规则见 [RELEASE-PARITY](../conventions/RELEASE-PARITY.md)，实现是 `scripts/parity.mjs`，数据是 `deploy/parity/ledger.json`（同构清单）与 `deploy/parity/smoke.json`（烟测）。`deploy-production.yml` 与 `deploy-hotfix.yml` 各多两个 job，预发布部署不变：

- `parity`（`needs: plan`，检出 plan 核对过的提交）：运行 `node scripts/parity.mjs check --release --version "$RELEASE_VERSION"`（版本取自 plan 的 `version`）。部署后才能做的条目只拦属于更早版本的遗留。清单里还有 `pending` 条目就失败，`build` 的 `needs` 包含它，所以不构建镜像、不上传 CDN、不部署。没有网络访问和 secrets。
- `smoke`（`needs: [plan, deploy]`，仅在 `deploy` 成功后运行）：用 `node scripts/parity.mjs smoke --origin <正式 origin> --env production` 核对 `smoke.json` 的 `require` 段（含内部赛事官网 `/c/oss-challenge-2026-1/`），最多重试 6 次、间隔 30 秒。`deploy-production.yml` 里还会读 `deploy/environments.json` 得到预发布 origin，运行 `parity.mjs compare` 核对 `mirror` 段；证据 job 已核对预发布与正式是同一提交。`deploy-hotfix.yml` 不做 `compare`，因为 `main` 上的修复提交与预发布的 rc 提交可以不同。
- `smoke` 失败只让这次运行变红，不回滚已切换的栈；回滚按 [DEPLOY](DEPLOY.md) 的步骤处理。部署开关关闭时 `deploy` 被跳过，`smoke` 随之跳过。

## 证据链与失败关闭

`deploy-production` 在构建前核对以下证据，任一缺失即失败关闭：

1. 正式 tag `vX.Y.Z` 所在提交上有同一 `X.Y.Z` 的 `vX.Y.Z-rc.N`（plan job 在带全部 tag 的检出里查找，evidence job 再核对一遍列表）；
2. 同一提交在 `preview` 环境有最新状态为 `success` 的 GitHub deployment 记录，且记录 payload 里的 `tag` 是上一条列出的 rc tag 之一（只按显式 deployment 记录判断；分支时代留下的、不带 tag 的旧记录不算）。部署 job 带 `environment: preview`，GitHub Actions 会为它另建一条不带 payload 的记录（ref 是 tag 名），并在 job 结束时置为 `success`，比工作流自己的记录晚几秒；GitHub 文档说新的 `success` 会把同一环境更早的成功记录置为 `inactive`，但 2026-09-25 实测（#69，`gh api repos/<仓库>/deployments/<id>/statuses`）没有发生：`v0.1.0-rc.3`、`rc.4`、`rc.5` 工作流建的记录在自动记录置 success 之后、以及后续 rc 部署成功之后，最新状态仍是 `success`，GraphQL 的 `state` 仍是 `ACTIVE`。所以这里只看最新状态；两条部署工作流和 `deploy-manual.mjs` 自己发的状态一律带 `-F auto_inactive=false`，不会把旧记录置为 `inactive`；
3. `https://prev.yangtzeu.work/release.json` 的 `environment` 是 `preview`，`commit` 是这个提交，`version` 是其中一个 rc 的 `X.Y.Z-rc.N@<sha12>`（`release.json` 由 web 镜像内置）：避免把「上一个预发布通过」推广到未经试用的新代码；
4. `production` GitHub Environment 已配置审批要求（部署 job 用 REST 实测 protection rules，不信任 YAML 里写了 `environment: production` 这一行）；
5. `DEPLOY_TARGET_ENVIRONMENT` 等于 `production`（防环境级变量回落）。

正式构建与预发布构建是同一提交、不同 build args 的两次构建，镜像 digest 不同，所以两者放在不同的镜像仓库里（见上文「镜像名按环境分开」）；工作流目前**不**比对两者的镜像内容。上述都是机器一致性检查，**不构成、也不能代替** [RELEASES](../conventions/RELEASES.md) 要求的人工试用与明确批准。

部署 job 的失败关闭行为：镜像 sha256 校验失败、env 校验失败、SSH 失败或健康门失败都让整条流水线失败，**不自动重试到未知状态**。部署脚本内部在 `docker compose up -d` 失败或健康门失败时（两者走同一条路，见 [DEPLOY](DEPLOY.md)「失败即回滚」）会把 `IMAGE_TAG` 切回部署前的值、重新 `compose up -d` 并复检，结果记为 `ROLLED_BACK`（复检也失败记 `ROLLBACK_FAILED`）——这是脚本的环境自愈，不等于发布成功，也不改变「流水线失败」的结论；不写 `approved=true` 之类的放行状态，不自动覆盖更晚的部署。

## 静态资源 CDN（#295）

目的地、桶、公私索引、SigV4、失败关闭和客户端防覆盖限制唯一合同见 [CDN](CDN.md)。旧七牛 token、表单上传、insertOnly 和 qetag 核对已经退役，不能用旧服务的配置记录证明 Garage 能力。

| job | 当前源码接线 | 凭据范围 |
|---|---|---|
| `cdn-plan` | `static-cdn.mjs decide --origin <环境>`；无凭据或 CSP 未放行仍按原约定同源，部分凭据或 S3 探测失败直接失败 | 仅此 job 与上传 job 注入 S3 两项凭据 |
| `build` | 同一个新 `STATIC_CDN_BASE` 传给 web/forum/server；镜像仍带全部同源资源；离线 `plan` 只收哈希构建资源、指南截图、内置表情和旧帖正文实际引用的 CDN 图片 | 不接密钥，不挂 Environment |
| `cdn-upload` | 签名 S3 GET 逐字核对已存在对象，缺对象才 PUT；公开 HEAD、完整 GET SHA-256、Range、MIME、CORS 校验；资产通过后写 `indexes/releases/<环境>/<完整提交>/manifest.json`，内容索引只生成私有产物 | `STATIC_CDN_S3_ACCESS_KEY_ID`、`STATIC_CDN_S3_SECRET_ACCESS_KEY`，不写镜像或日志 |
| `deploy` | 仍依赖 `cdn-upload` 成功，不提前发布引用不存在资源的 HTML | 原有环境权限不变 |

`STATIC_CDN_S3_ENDPOINT=https://cdn.yangtzeu.work`、region `garage`、bucket `geek-public`、forcePathStyle `true`。凭据只从受保护发布 job 的进程环境读取，不在仓库、业务 `.env`、命令行或构建 job 中出现。两项都不设置时下一次构建同源，现有镜像不会自动切换；宣传片、邮件、指南与旧帖 CDN 图片的固定地址也不跟这个开关走。

当前基线 `.github/workflows/ci.yml` 仍有无凭据的 `docker-cdn` 构建，两个既有部署工作流的上传调用改传环境、完整 SHA 和提交时间，上传器生成稳定来源清单及独立私有内容索引。没有运行这些工作流，也未证明其环境保护状态。所有者本次以 GitLab 为主：父级 task270 的 GitLab 发版草稿应复用同一个 CLI、参数及“上传验证成功才能部署”门禁，不能把 GitHub 历史 token 步骤复制成新服务的配置能力。

新增表情包仍只需维护目录和运行 `sticker-manifest.mjs write/check/urls`；之后由同一套上传链路带上。源文件清单规则见 [forum 合同](../services/forum/README.md)。旧 CDN 资源和发布清单不删除，保证旧镜像回滚。

## PR 预览（#245）

给人工验收界面改动用：每个 PR 自动得到一个官网加控制台的预览链接，数据全是样板，不连任何后端。用 Netlify 的 Deploy Preview（免费版：部署预览不限次数、不扣额度；额度制下只有正式部署每次 15 额度），不是 GitHub Actions 工作流，所以仓库里没有对应的 `.github/workflows/` 文件，也没有任何 secrets。

- 配置只有根目录 `netlify.toml`：构建命令装 web 与 console 的依赖，用 `VITE_PREVIEW_MOCK=1` 各构建一次，再用 `scripts/pr-preview.mjs assemble` 合成 `preview-site/`（官网在 `/`，控制台在 `/admin`、`/console`，与生产 web 容器同路径）；`/api/*`、`/auth/*` 强制 404；其余路由回落（不 force，不盖真实文件）；全站 `X-Robots-Tag: noindex`。
- `VITE_PREVIEW_MOCK` 只有 `netlify.toml` 会设置，镜像构建、`ci.yml` 与两条部署工作流从不设置（`tests/tooling/pr-preview.test.ts` 核对）；样板数据代码在未设置时仍被构建删掉。
- 论坛的预览还没接：它要 Node 26 与 pnpm 11 的独立工具链，`/forum` 暂时落到官网入口。
- 预览只证明界面；自动化 PASS 与预览链接都不是人工验收，也不是发版授权。

## 需要人工完成的前置条件

1. **GitHub Environment**：创建 `preview`、`production`；`production` 必须配置 required reviewers（若计划不支持私有仓库的该能力，见下）；deployment branches and tags 建议只放行发布 tag（`v*`），只做粗筛；rc 与正式的精确区分以两条部署工作流 plan job 的正则为准，禁止自批。
2. **环境级 secrets/vars**：按上表配置两套，取值互不相同。
3. **目标机**：已运行 Arch 双栈与香港入口；后续发布保留固定子网、server DNS 与出网编排，不能覆回旧机的回环绑定或缺失网络配置。旧 Nginx 只作过渡转发。
4. **DNS 与 OAuth**：DNS 由所有者切换；新旧入口 TLS、原会话、OIDC discovery、客户端 IP 已验证，新的 GitHub/Google 完整授权往返仍未验证。
5. **仓库级开关**：两个 enabled 开关保持原样，不是新版本授权。源码集成受原门禁约束；没有触发工作流或补推 tag。

### 平台能力实测（2026-09-13，`gh api` 只读核对）

- 组织 `Yangtze-University-Geek-Class` 的 `plan.name` 实测为 `free`；仓库 `admin` 实测为 `private`。
- `GET /repos/{owner}/{repo}/rulesets` 与 `GET /repos/{owner}/{repo}/branches/main/protection` 均返回 `403`（`Upgrade to GitHub Pro or make this repository public…`）：`main` 与 tag 的 refs 保护在当前计划下配置不了。
- `GET /repos/{owner}/{repo}/environments` 的 `total_count` 实测为 `0`：`preview`、`production` 两个 Environment 都尚未创建。

结论：在**计划升级**或**改用受控外部审批**之前，`production` 的人工门禁无法启用；此时 `DEPLOY_PRODUCTION_ENABLED` 必须保持关闭，正式发布由人手工执行已验证产物。不得以此为由取消人工验收、伪造审批记录。以上为 2026-09-13 的实测快照，启用前必须重新核对。

**更新（2026-09-26 17:49，决定公开仓库）**：`admin` 现在是公开仓库。公开前用 gitleaks 扫过全部分支与 tag 的历史（485 个提交，2 处命中都是测试里的假值），邮箱、手机号、公网 IP 只有测试数据。公开后同时做了：外部贡献者（非协作者）的 fork PR 触发的工作流要经批准才跑（`approval_policy=all_external_contributors`）；开启私密漏洞报告；删掉仓库变量 `CI_RUNNER`，CI 回到 `ubuntu-latest`（公开仓库托管 runner 不计分钟，免费版最多 20 个 job 同时跑）；runner 组 `yzgc-deploy` 放行公开仓库（组里仍只选了 `admin`），否则 rc 部署一直排队；`preview` Environment 只放行 `v*.*.*-rc.*` 形状的 tag，其它分支、tag 与 PR 上声明 `environment: preview` 的 job 拿不到它的 secrets。rulesets、分支保护与 `production` 的 required reviewers 现在可以配，但**都还没配**，规则还没定。

**更新（2026-09-26 21:05，#138）**：决定 CI 与部署都只用 GitHub 托管 runner：仓库变量 `DEPLOY_RUNNER` 也删了，runner 组 `yzgc-deploy` 的「允许公开仓库」关回去。仓库里的工作流、文档与机器脚本在 #139 改完，见下文「运行位置」。

## 维护者机器部署（免费版的退路）

仓库原先私有时免费版配不了 `production` 的审批人，部署 job 在「production 环境保护」核对处失败关闭，正式环境只能从维护者机器部署。2026-09-27 起 `production` 有 required reviewers（2026-10-02 只读核对 `gh api repos/<仓库>/environments/production`），`DEPLOY_PRODUCTION_ENABLED` 已打开，正式部署照常走 `deploy-production.yml`：开关关闭时部署 job **跳过**；环境保护被删掉或审批人被清空时，它仍在「production 环境保护」核对处**失败关闭**，这是正确行为，不得放宽。build job 都会产出镜像归档（正式保留 30 天，预发布保留 7 天，过期要重新运行工作流）。GitHub 计划让部署 job 按设计失败关闭时（例如仓库改回私有、免费版配不了 required reviewers），或 `preview` 的部署 job 拿不到 secrets 时，改用 `scripts/deploy-manual.mjs` 从维护者机器部署；环境保护被删掉、审批人被清空时，先查清原因、恢复保护再重跑工作流，不改用本脚本。谁可以运行见 [AGENTS](../../AGENTS.md) §3 与 [RELEASES](../conventions/RELEASES.md)「授权门禁」。步骤与 CI 的 deploy job 一一对应，**一切部署物料取自 tag 指向的提交**，不取当前工作区：

1. 进程环境里的 `DEPLOY_TARGET_ENVIRONMENT` 必须等于 `--environment`（对应 CI 的环境哨兵，防止导出的是另一个环境的密钥）；仓库取自 `origin` 远端。
2. `git archive <提交> deploy scripts package.json` 解到临时目录，用该 tag 物料里的 release-policy 及环境契约核对版本/分支/来源；rc 只能进 preview，正式只能进 production。再调用其中的 `ssh-config`，严格核对 `DEPLOY_SSH_HOST/PORT/USER` 与该环境模板及跳板，生成共享 SSH/SCP 配置；任何不符在连接/上传前拒绝，不能用旧源 fallback。
3. 正式环境先核对批准评论：`--acceptance` 必须是本仓库 issue 或 PR 里的一条评论链接（评论确实在链接写的那个编号下），作者是仓库管理员，**没有被编辑过**（按 GraphQL `IssueComment.lastEditedAt` 判断，表情回应不算编辑；有写权限的人能改别人的评论而作者不变，编辑过就请重新发一条）、没有被折叠隐藏（`isMinimized`），发在预发布部署成功之后，并且**整条评论只有一行** `批准发布 vX.Y.Z`（CRLF 当作 LF，末尾的空格、制表符与换行不算，别的一个字符都不能多：`v` 不能省，不能加句号，不能用全角空格，前面不能有缩进或空行，不能加粗、放进引用、代码块或 HTML，不能再写一句试用结论，「暂不批准发布」、只写 rc 的都不算）。这是白名单：脚本不去推测 GitHub 怎么渲染 Markdown 与 HTML，#69 第一轮审查找出了十几种页面上看不到、或和别的字连在一起，却能被逐行规则接受的写法。试用结论、验收记录（[RELEASE-ACCEPTANCE-TEMPLATE](RELEASE-ACCEPTANCE-TEMPLATE.md)）写在别的评论里，批准另发一条只写这一行的新评论；再重做证据 job 的三项核对（同一提交上有同版本的 rc tag、`preview` 有 payload.tag 为这些 rc 之一且最新状态 `success` 的部署记录、`https://prev.yangtzeu.work/release.json` 就是这个提交的 rc 版本）。都在下载之前。
4. 找到这个 tag 的 push 触发的 `deploy-<environment>.yml` 运行（tag 名与提交都要对上、build job 成功；有 `cdn-upload` job 的运行还要它成功，否则镜像里的页面可能引用 CDN 上还没有的文件，见上文「静态资源 CDN」），用 `gh run download` 取镜像归档，**先在本机流式核对 sha256**；从不在本机或目标机构建镜像。
5. 用该物料的 render 生成 0600 临时 env；应用密钥只经 render 子进程环境注入、不进 argv，其它子进程不继承；使用同一 `process.execPath`。SSH/SCP 使用 `-F <本次生成配置>` 与 `yzgc-target`，不再用缺少跳板策略的 `-F none`；known_hosts 与专用 key 由操作者提供，双端严格验证，结束/出错/中断清理临时目录。
6. 写 GitHub 部署记录（payload 键与 CI 相同，正式另有 `preview_tags`，另加 `deployed_from: "maintainer"` 与批准链接；与两条部署工作流一样用 `required_contexts=["verify (required check)"]`：GitHub 默认要求提交上的全部检查都已通过，会把正在运行或已失败的部署 job 也算进去而一直返回 409，`v0.1.0-rc.1` 首次部署时实测；与工作流一样显式 `-F auto_merge=false`，不让 GitHub 去合并默认分支，状态一律 `-F auto_inactive=false`，见上文「证据链」第 2 条），把这份物料里的 compose 与 `deploy-stack.sh` / `rollback-stack.sh` 分发到同样的远端路径，运行同样参数的 `deploy-stack.sh`，按结果把记录置为 `success` / `failure`。

`--dry-run` 做完 Git/GitHub 证据读取、下载及临时渲染后停下，不连部署目标、不写部署记录；它**不是纯本地只读检查**，仍会联网和写临时物料，本次文档任务没有执行。脚本不创建/移动 tag、不构成人工试用或批准。`tests/tooling/deploy-manual.test.ts` 的隔离编排/批准用例不等于真实 ProxyJump、目标部署或当前整个集成历史通过。

## 运行位置

CI 与部署只用 GitHub 托管 runner（#139）：所有工作流的每个 job 都写 `runs-on: ubuntu-latest`。

- 托管 runner 每个 job 一台新虚拟机，job 结束即销毁：前一个 job（包括别人分支上的 job）改不到后一个 job 的文件系统、工具和本地缓存，部署 job 也一样；Actions 缓存（setup-node 的 `cache: pnpm`、`actions/cache`）不随虚拟机销毁，按 GitHub 的分支作用域在多次运行之间共享，从缓存装进来的包仍按锁文件 integrity 核对。仓库公开（2026-09-26 17:49）以后托管 runner 不计分钟，免费版最多 20 个 job 同时跑。
- 部署用的密钥只经 GitHub Environment 进 job：`preview` 只放行 `v*.*.*-rc.*` 形状的 tag（见上文「平台能力实测」的 2026-09-26 更新），`static-cdn` 的凭据范围见上文「静态资源 CDN」，环境保护的当前状态需由父级核验；`production` 的密钥只经 `production` Environment 进 job（2026-10-02 只读核对：它有 required reviewers 与自定义部署分支规则，2026-09-27 建；`v0.1.0` 的正式部署运行 36314912545 经批准后在托管 runner 上跑完）。
- **写成字面量，不读仓库变量**。原来的写法是 `${{ vars.CI_RUNNER || 'ubuntu-latest' }}` 与 `${{ vars.DEPLOY_RUNNER || 'ubuntu-latest' }}`，#139 改掉，理由：两个变量已经删了（#138），留着这种写法只会让人以为还能切回去；改仓库变量不经 PR 与审查，也不进 git 历史，设一个变量就能把带部署私钥的 job 送到别的机器上，写成字面量后换 runner 必须改工作流、经过审查；原来的 runner 组 `yzgc-deploy` 已经不允许公开仓库，设回去 job 也只会排队。`tests/tooling/hosted-runners.test.ts` 核对 `.github/workflows/` 下每个工作流的每个 job 都是 `runs-on: ubuntu-latest`，也没有残留 `vars.CI_RUNNER`、`vars.DEPLOY_RUNNER` 和旧的 runner 标签。
- 托管 runner 出问题时等 GitHub 恢复后重跑，不再有切到别的机器的退路。以后真要用自托管 runner，先开 issue，重新论证隔离、凭据与公开仓库 fork PR 的边界，再改工作流和上面这条测试；不要靠加标签或设变量切过去。

`historical`：仓库还私有时，免费版每月 2000 分钟的托管额度用完（2026-09-25 所有 job 报 `The job was not started because recent account payments have failed or your spending limit needs to be increased`），CI 改到维护者家里的机器 crosery-arch 上的常驻 incus 容器里跑（#93，后来加到 4 个实例，#124），部署 job 跑在同一台机器上每个 job 一个的一次性容器里（#97）。2026-09-26 17:49 仓库公开后 CI 回到托管 runner；`v0.1.0-rc.8` 在一次性 runner 上两次失败后，21:05 决定部署也不再用家里的 runner（#138）。机器上的脚本 `deploy/runner/` 已在 #139 删除，原文在 git 历史里（`git show 458999f:deploy/runner/<文件>`），当时的做法、隔离边界与实测记在 `notes/2026-09-26/crosery/` 的 `task_93_self_hosted_runner.md`、`task_97_deploy_jit_runner.md`、`task_124_ci_throughput.md`；宿主机上的容器、服务、JIT 令牌与 GitHub 上的 runner 注册要手工清理，从 #139 拆到 #187 跟进。

### 构建下载源（#104）

工作流与 Dockerfile 可以经三个仓库变量把下面这些下载换到别的源，**仓库变量没设就是官方源**。现在三个变量都没设（2026-10-02 `gh variable list` 只有两个部署开关），CI 与部署都在托管 runner 上走官方源。托管 runner 不用设：设了会让所有 job 都绕到那个源，better-sqlite3 预编译包还要多信一个源（见下文「例外」）。机制留着不删：工作流里的写法与官方回落由 `tests/tooling/build-mirrors.test.ts` 核对，在国内的机器上本机 `docker build` 也能用同名 build arg 换源。

`historical`：#104 是给家里的自托管 runner 加的。那台机器连 GitHub、`registry.npmjs.org`、`deb.debian.org` 只有几十到两百 KB/s，`v0.1.0-rc.7` 的预发布部署（运行 36216674208）一共 56 分钟；换成下表的国内镜像后，server 镜像构建从 1847 秒降到 80 秒（2026-09-26 在那台机器上实测）。当时还用 `deploy/runner/container-setup.sh` 把 Node 22 预置进 runner 的工具缓存，省掉 setup-node 的下载；runner 与脚本已于 #139 退役，托管 runner 上 setup-node 照常从 `github.com/actions/node-versions` 取。

| 下载 | 在哪 | 不设变量（官方） | 设了变量 | 校验 |
|---|---|---|---|---|
| npm 包 | runner 上的 `pnpm install`、三个 Dockerfile 的构建阶段 | `registry.npmjs.org` | `NPM_REGISTRY` | 锁文件里每个包的 integrity |
| pnpm 9.15.9（corepack） | server、web 镜像的构建阶段 | 同上 | `NPM_REGISTRY`（`COREPACK_NPM_REGISTRY`） | corepack 用自带的 npm 公钥核对 npm 的发布签名 |
| pnpm 11.24.0（`npm pack`） | forum 镜像的构建阶段、ci 的 forum job | 同上 | `NPM_REGISTRY` | 写死的官方 sha512（Dockerfile 与 ci.yml 的 `FORUM_PNPM_INTEGRITY`） |
| pnpm/action-setup 的引导版 pnpm（`npm ci`） | core、env-contract、两条部署工作流的 build job | 同上 | `NPM_REGISTRY` | action 自带的锁文件 |
| pnpm 9.15.9（action-setup 的 `self-update`） | 同上 | 同上 | **不换源**：这些 job 故意不设 `pnpm_config_registry` | 只有源自己给的 integrity，所以留在官方源 |
| Debian 包（`apt-get`） | server 镜像的构建阶段 | `deb.debian.org` | `DEBIAN_MIRROR` | apt 按 `debian-archive-keyring` 核对 InRelease 签名 |
| better-sqlite3 预编译包 | runner 上的 `pnpm install`、server 镜像的构建阶段 | GitHub releases | `BETTER_SQLITE3_BINARY_HOST` | 不核对哈希，只靠 https，见下文；只用托管 runner 之后这套变量还要不要，在 #188 评估 |

仓库变量（Settings → Secrets and variables → Actions → Variables，仓库级，不是密钥）：

| 名称 | 可用的国内镜像（#104 时家里 runner 的取值） | 不设时 |
|---|---|---|
| `NPM_REGISTRY` | `https://registry.npmmirror.com` | `https://registry.npmjs.org` |
| `DEBIAN_MIRROR` | `http://mirrors.ustc.edu.cn/debian` | `deb.debian.org`（镜像自带的源） |
| `BETTER_SQLITE3_BINARY_HOST` | `https://registry.npmmirror.com/-/binary/better-sqlite3` | GitHub releases |

- **怎么接进去**：`ci.yml` 的 docker job 与两条部署工作流的 build job 以同名 build arg 传给 Dockerfile（`DEBIAN_MIRROR`、`BETTER_SQLITE3_BINARY_HOST` 只有 server 用）；装依赖的 job 设 `npm_config_registry`（npm 与 pnpm 9 读它）、`pnpm_config_registry`（只在 forum job，pnpm 11 不读 `npm_config_*`，`scripts/forum.mjs` 把它转给论坛的 pnpm）、`npm_config_better_sqlite3_binary_host`（prebuild-install 7.1.3 按 `npm_config_<包名>_binary_host` 取下载地址）。两个 pnpm 版本读哪个变量是 2026-09-26 用 `pnpm config get registry` 实测的。
- **只在构建阶段**：三个参数只在 Dockerfile 的 builder 阶段声明，运行阶段是新的 `FROM`，不继承 ARG 和 ENV；`tests/tooling/build-mirrors.test.ts` 核对这一点，并核对工作流里每处 `vars.*` 都带官方回落值。
- **格式**：`NPM_REGISTRY` 必须是 `https://`、不带结尾 `/`（corepack 直接拼 `<源>/<包名>`）；`DEBIAN_MIRROR` 必须是 `http://`、不带结尾 `/`：slim 镜像在装 ca-certificates 之前 apt 走不了 https（2026-09-26 在 `node:26-bookworm-slim` 里实测：`Certificate verification failed`，而 `apt-get update` 仍以 0 退出），Debian 包的完整性本来就靠签名而不是 TLS。`BETTER_SQLITE3_BINARY_HOST` 设了就必须是 `https://`、不带结尾 `/`：预编译包不核对哈希（见下文），传输途中不被换包只能靠 TLS。`DEBIAN_MIRROR` 与 `BETTER_SQLITE3_BINARY_HOST` 还只许字母、数字和 `.:/_-`（前者要写进 sed，后者不许带 `@` 用户名段或 `?`、`#`）。不合格时 server 构建阶段在第一条 RUN 就失败，不会悄悄回到官方源；基础镜像哪天换了 apt 源的写法，改写后找不到镜像那一行也会失败。runner 上的 `pnpm install` 同样会下载这个预编译包，所以 ci 的 core job 与两条部署工作流的 build job 在检出之后的第一步「核对 better-sqlite3 预编译包地址」用同一条 case 核对 `npm_config_better_sqlite3_binary_host`，不合格时在任何下载之前失败。`tests/tooling/build-mirrors.test.ts` 实跑那条 RUN 与这一步核对这些拒绝，核对三处 job 的写法与 Dockerfile 逐字相同，并核对上表的国内镜像取值能通过。
- **为什么换源不降低完整性**：npmmirror（阿里云维护的 npm 同步源）与中科大 Debian 镜像只是转发。npm 包的内容由锁文件里的 sha512 决定，镜像给不了别的内容。corepack 核对的是 npm 官方的发布签名，镜像源的元数据里带的就是官方签名：2026-09-26 对比 `pnpm@9.15.9`、`pnpm@11.24.0` 在两个源上的 `dist.integrity` 与 `dist.signatures`，逐字相同；本机用 `COREPACK_NPM_REGISTRY=https://registry.npmmirror.com` 装 pnpm 9.15.9 通过，换一把不相干的公钥（`COREPACK_INTEGRITY_KEYS`）时 corepack 报 `The package was not signed by any trusted keys` 拒绝，说明签名核对在镜像源下照常执行。`COREPACK_INTEGRITY_KEYS` 不设空、不关签名。Debian 包由 InRelease 签名链保护，镜像改不了。
- **例外：better-sqlite3 预编译包**。prebuild-install 只按地址下载 tar 包，不核对任何哈希，官方源也是这样；换成 npmmirror 等于从「信 GitHub 上的发布」换成「信 npmmirror 的同步」。2026-09-26 取 `v11.10.0` 的 `node-v127-linux-x64` 包，两边 sha256 都是 `ea6a09d12d43cca31782ab0e09ecf442b8e2a49f5a02b219f5f117a6601ed306`。不愿意信它就不设这个变量（回到 GitHub releases），或者以后改成从源码编译（构建阶段已经装了 python3、make、g++）。
- **生效条件**：仓库变量设好后下一次运行即生效，删掉即回到官方源。

### 下载镜像归档（#99）

deploy job 不用 `actions/download-artifact`，改用 `scripts/fetch-artifact.mjs`：同一地址并发 16 段 Range 请求。下载地址约 1 分钟过期，每段重试时重新取；一段连续 60 秒没收到数据（等响应头或下一块数据；连接卡住不报错，#111）也算失败，断开后重新取地址重试，可用 `--idle-seconds`（1–600）调整，只限空闲时长、不限一段的总时长；查 artifact 列表的 API 请求也限这么久，超时直接失败；只核对总字节数与 zip 的 CRC，归档内容仍由目标机 `sha256sum -c` 核对。job 权限因此多一个 `actions: read`。`historical`：加它时部署跑在家里的自托管 runner 上，单连接从 GitHub 的存储下载只有 40–220KB/s，163MB 要 15–60 分钟（`v0.1.0-rc.6` 实测），并发 16 段约 6.6MB/s；那台 runner 已于 #139 退役，托管 runner 上照常用它。

## 明确不做的事

- 任何工作流都不自动创建/移动/删除 tag，不自动升级 `package.json` 版本，不写放行状态；发布 tag 在授权后手工创建。
- 不从 `pull_request_target` 触发，不给 fork/PR 构建授予部署 secrets；不用自托管 runner，所有 job 只跑在 GitHub 托管 runner 上（见上文「运行位置」）。
- 不把 `.tools`、真实数据库、`.env`、SSH 材料、内部文档或浏览器状态打进镜像、缓存或日志。
- 机器 PASS（`pnpm verify`、CI 全绿）不构成人工验收记录，也不授权任何部署或发版动作。
- 不把 `stage` 分支的推送当作任何环境的部署：正式部署必须能追到同一提交的 rc tag、成功的预发布部署记录与人工试用结论。

## 双工具链

核心按根 manifest/锁文件使用 Node 22 + pnpm 9.15.9；论坛按独立 manifest/锁文件使用 Node ≥26 + pnpm 11.24.0；CLI 发布物料由固定 digest 的 Linux 构建容器独立交叉编译，不复用 Node 原生依赖。分别安装、分别运行现有测试，避免用一套 Node 运行另一 ABI 的原生 SQLite 模块。CI 使用临时测试库和虚构数据；线上目标为 Linux，不上传 Mac 原生依赖。

## 官方依据

核对日期：2026-09-13。平台行为依据（不代表远程设置已完成）：

- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax — 事件/ref 过滤、权限与并发。
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments — 环境保护、秘密放行、自动创建环境及私有仓库计划限制（2026-09-27 复核：引用不存在的 Environment 会自动创建，新建的没有保护规则和 secrets）。
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments — job 的 `environment.deployment: false`（2026-09-27 核对：wait timer 与 required reviewers 照样生效，自定义保护规则会让 job 失败；没写 deployment branches and tags 规则，见「静态资源 CDN」第 3 步）。
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets — 分支保护。
