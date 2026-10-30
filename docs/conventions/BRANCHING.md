# 分支模型规范

> 只有 `main`（正式）与 `stage`（预发布）两条长期分支；task 分支合并后必须立即删除，任何操作前先确认当前分支。

状态：`current` · 更新：2026-10-30 · 依据：2026-09-23 确定分支模型；2026-09-24 改为打 tag 发版；2026-09-26 起 worktree 做完即清、推送前检查；所有者 2026-10-30 07:43 在会话中批准：清理 PR 与 issue，GitHub 与 GitLab 自动同步。

## 第负一步：先确认分支

**任何提交、推送、切分支、改文件之前，先跑 `git branch --show-current` 确认自己在哪条分支上。** Agent 进入仓库的第一件事就是确认分支并阅读规范（见 [AGENT-START](AGENT-START.md)）。不在预期分支上时停止操作并说明，不能靠 `git checkout .`、`reset --hard` 或清理工作区来自行纠正。

## 长期分支

| 分支 | 角色 | 生命周期 | 在这条分支的提交上打的发布 tag |
|---|---|---|---|
| `main` | 正式稳定版，只能由 `stage` 合入（发版时快进到被验收的 rc 提交） | 长期 | `vX.Y.Z` → 正式栈 `/opt/yzgc/production` → `https://yangtzeu.work` |
| `stage` | 动态更新版，集成分支 | 长期 | `vX.Y.Z-rc.N` → 预发布栈 `/opt/yzgc/preview` → `https://prev.yangtzeu.work` |

**推送分支不部署。** push `stage` / `main` 只跑 CI；部署只由发布 tag 触发，规则见 [RELEASES](RELEASES.md)。

除这两条以外，**不允许存在第三条长期分支**。历史上使用过的 `next` 已退役（本地已改名），不得再把 `next`、`develop`、`release` 等当作集成分支；`documentation`/`feature` 等旧命名同样不再有效。

## 短生命周期分支

| 分支 | 来源与去向 | 规则 |
|---|---|---|
| `task/<issue>/<slug>` | 从 `stage` 拉出 → MR 回 `stage`，正文写 `Closes #<issue>`；P0 hotfix 与部分晋升窗口内例外，从最新 `main` 拉出 → MR 进 `main`，合并后立刻合回 `stage` | **极短**：MR 合并后必须立即删除，禁止残留死分支。`branch-hygiene.yml` 会在 PR 合并后自动删除，也可以手工 `git push origin --delete` |
| `dev/<github-username>` | 个人自由开发区，内容随意 | 个人自行维护；**不得作为任何提交进入 `stage` 的凭据**，也不部署（只在 `ci.yml` 里跑机器验证） |

- 一次任务一条 task 分支；一个 task 分支只对应一个 issue，并且**在自己的 git worktree 里开发**（见下节）。进 `stage` 只用 merge commit（GitHub 的「Create a merge commit」，命令行 `gh pr merge <PR> --merge`），分支本身必须在合并后删除。原因：文档同步检查在 `stage` 上按第一父链的时间比较模块与文档（[docs/README](../README.md)「文档跟着模块改」），一个 PR 只进来一个合并提交，模块和文档同时到；rebase 合并会把 PR 的提交逐个接到第一父链上，模块提交排在文档提交后面就不通过；squash 会把审查和执行记录里引用的提交 SHA 从 `stage` 的历史里抹掉。仓库设置里关掉 squash 与 rebase 需要仓库 admin 权限，关掉之前靠合并的人照这条做。
- `dev/<github-username>` 是个人实验区：可以自由提交、可以 force-push 自己的分支，但把内容送上 `stage` 的唯一合法路径是「从 `stage` 拉一条干净的 `task/<issue>/<slug>`，重新提交或 cherry-pick 经过审查的改动」。`dev/**` 的提交历史、分支名和 CI 绿标都不是审查凭据。
- 禁止把 `dev/**`、`task/**` 直接合并进 `main`。

## 命名规则：只用 `/` 分层，不用 `-`

**分支名里一律不出现 `-`。** 层级像文件夹一样用 `/` 分隔，每一段只含小写字母与数字；一段里有多个词时用 `_` 连接。唯一实现是 [scripts/check-branch-invariants.mjs](../../scripts/check-branch-invariants.mjs) 的 `TASK_BRANCH_RE` / `DEV_BRANCH_RE`，其它文档只引用这里：

| 类型 | 形状 | 正则（与脚本逐字一致） | 例子 |
|---|---|---|---|
| 任务分支 | `task/<issue>/<slug>` | `^task\/[0-9]+\/[a-z0-9]+(?:_[a-z0-9]+)*$` | `task/12/portal_redesign`、`task/7/forum` |
| 个人分支 | `dev/<github-username>` | `^dev\/[a-z0-9]+(?:_[a-z0-9]+)*$` | `dev/alice` |

- `<issue>` 是纯数字的 issue 编号；`<slug>` 与用户名段都是 `[a-z0-9]+(?:_[a-z0-9]+)*`：不允许大写、`-`、首尾 `_` 或连续 `__`，也不允许再多一层 `/`。
- GitHub 用户名里带 `-` 的，个人分支里写成 `_`（例：`joe-smith` 写成 `dev/joe_smith`）；大写一律转小写。
- 旧写法 `task/<issue>-<slug>`、`dev-<username>`（以及 `task-…`）已**不合规**：`check-branch-invariants.mjs` 把它们归为 `task-malformed` / `personal-malformed` 并告警，pre-push 拒绝以它们为来源推 `stage`，`ci.yml` 也不再对 `dev-*` 的 push 触发。
- 迁移（2026-09-23 确定）：旧个人分支 `dev-<用户名>` 需改名为 `dev/<用户名>`，由分支所有者执行，引入本规则的提交本身不改任何本地或远端分支：本地 `git branch -m dev-<用户名> dev/<用户名>` → 推送新名 `git push -u origin dev/<用户名>` → 确认后删除旧远端 `git push origin --delete dev-<用户名>`（pre-push 对删除非长期分支放行）。Git 不允许 `dev` 与 `dev/…` 同时存在，但 `dev-<用户名>` 与 `dev/<用户名>` 可以并存。

## 不变量

以下两条必须同时成立，由脚本、CI 与本地 hook 强制：

1. **`stage` 必须包含 `main`**：`git merge-base --is-ancestor origin/main origin/stage` 为真，即 stage ≥ main。
2. **`main` 不得领先 `stage`**：任何写入 `main` 的提交都必须已经存在于 `stage`；只允许把 `stage` 合入 `main`。

本地自查：

```bash
node scripts/check-branch-invariants.mjs                    # 只读：核对两条不变量 + 分支命名卫生
node scripts/check-branch-invariants.mjs --json             # 机器可读输出
node scripts/check-branch-invariants.mjs --strict-long-lived # 把「main/stage 之外的长期分支」升级为失败
```

`--push` 模式读 git 的 pre-push 四段输入，额外断言「推 `main` 的提交必须已在 `stage`」「推 `stage` 只能来自 `stage` 自身或合规的 `task/<issue>/<slug>` 且必须已包含 `origin/main`」「不得删除远端 `main`/`stage`」，可用作本地 pre-push 守卫。首次推送新分支（远端 SHA 全 0）同样照常判定命名与不变量。同一模式还核对发布 tag：格式不对的 `v` 开头 tag、提交不在 `stage` 上的 `vX.Y.Z-rc.N`、提交不在 `main` 上的 `vX.Y.Z`、版本号与该提交 `package.json` 不一致、删除或强制移动发布 tag，都会被拒绝；正式 tag 的同一提交本地没有 rc tag 只告警（以部署工作流的证据为准）；其它 tag 只告警。规则详见 [RELEASES](RELEASES.md)。脚本只读 Git 证据：不 fetch、不改 refs、不删分支、不建提交或 tag、不连远端。

违反任一条即视为分支模型被破坏，必须先修复再继续开发；不要用 force-push 掩盖差异。

## 禁止事项

- 禁止在没有已登记、未过期的 hotfix 窗口或部分晋升窗口时，直接向 `main` 提交或推送（含 agent、脚本、GitHub 网页编辑、CI 机器人）；两种窗口都要所有者的批准摘要，规则见下文对应小节。
- 禁止常规开发中把 `task/**`、`dev/**` 分支直接进 `main`；常规合并只能由 `stage` 合入 `main`。
- 禁止在新分支名里使用 `-`（见上文「命名规则」）。
- 禁止在没有经所有者确认的 issue 时开 task 分支：先按 [ISSUES](ISSUES.md) §1 完成确认与建单，不以分支流程代替建单授权。
- 禁止向 `stage` 提交未审查的内容：进入 `stage` 前必须走 [CODE-REVIEW](CODE-REVIEW.md)，MR 描述里带审查结论。
- 禁止长期保留已合并的 task 分支，禁止用分支名当版本号或发布凭据；发布凭据只有经授权后打的发布 tag。
- 禁止 force-push `main`/`stage`，禁止整分支 reset 覆盖他人提交。

## 线上紧急修复（Hotfix）规约

P0 例外（线上用户被挡住、等常规周期的代价不能接受）：修复以最新 `main` 为基线，经审查与关键路径验证后先进 `main`，以既有正式版本的 hotfix 入口上线，不发 rc、不升号、不移动既有 tag；成功验证后立即合回 `stage`。分支不变量不关闭、不跳过：窗口由 `deploy/hotfix/windows.json` 登记（见下），`branch-guard` 和本地 `pre-push` 在登记存在时放行 `main` 领先 `stage` 的提交，没有登记就照常失败；独立 `hotfix-verify` 检查真实修复 SHA，收尾时把窗口标 `closed`、恢复 `stage >= main` 并重跑常规 CI。实施合同见 [RELEASES 的 Hotfix 规约](RELEASES.md#线上紧急缺陷hotfix规约)。

**hotfix 窗口登记**（`deploy/hotfix/windows.json`，校验与判定在 `scripts/hotfix-windows.mjs`，由 `scripts/check-branch-invariants.mjs` 与 `scripts/hotfix-policy.mjs` 共用）：

- 一个 P0 issue 对应一个窗口，字段：`issue`、绑定的既有正式版本 `tag`、`status`（`open` / `closed`）、`approvedBy: 所有者`、`approvedAt` 与批准摘要 `approval`、`expiresAt`（最长到批准后 7 天）；收尾时补 `closedAt` 与 `evidence`。可选 `commits`：批准之前写的、或说明里没有引用窗口 issue 的提交 SHA。
- 登记随修复一起进 `main`（读的是 `main` 上的那一份）。`main` 领先 `stage` 的每个提交，要么说明里引用窗口 issue（`#N` 或 `task/N/`）且提交者时间在 `approvedAt` 与 `expiresAt` 之间，要么列在 `commits` 里；有一个不归属，`branch-guard` 与 `pre-push` 照常按两条硬不变量失败。窗口过了 `expiresAt` 还开着、登记格式不对、缺所有者批准摘要，同样失败。
- `deploy-hotfix` 的 `issue` 输入必须是登记里 `open`、没过期、`tag` 就是这次 tag 的窗口，否则 plan 失败；窗口在等待审批期间被关或过期，二次 plan 也会失败。
- 收尾时从 `main` 单独提交窗口 `closed` 与 `evidence`，再把这个提交合回 `stage`；只推进这次关闭登记，不把 `stage` 的未发布功能合入 `main`。

### hotfix 合并后的自动同步

`scripts/hotfix-sync.mjs`（`plan` 只读，`apply` 执行，有 `tests/tooling/hotfix-sync.test.ts`）一次做完 hotfix 合并后的收尾，任何一步不满足就停下，不强推、不覆盖：

1. 取源远端（默认 `gitlab`）和镜像远端（默认 `origin`）的 `main`、`stage`；镜像引用必须能快进到源的目标，两边分叉就停，不强推。
2. 在唯一命名的临时 task 分支和 worktree 中准备合并，不复用或删除既有分支。冲突全是生成物（`docs/INDEX.md`、`notes/INDEX.md`）时重生成；有非生成物冲突就放弃，退出码 3，任何远端引用都不改变。合并提交只含冲突取舍。项目地图（`docs/architecture/catalog/*`）也是生成物，但重生成要装好依赖，脚本不在临时 worktree 里做：遇到它就停下，在独立 worktree 里合并、`pnpm catalog:generate`、`check:catalog` 通过后合回（2026-10-30 #308 合回 stage 就是这样做的）。
3. 带 `--close-window` 时，从源 `main` 单独提交登记关闭，再把关闭提交合回 `stage`，不把未发布的 `stage` 提交带进 `main`。
4. 本地准备和祖先检查全部成功后，先推源与镜像的 `stage`，再推 `main`，正常执行 Git 钩子。
5. 带 `--preview-tag` 时，在新进 `stage` 的合并提交上打预发布 tag：合回的是 hotfix 提交打 `vX.Y.Z-hf.N`，合回的是窗口关闭登记打 `vX.Y.Z-stable.N`（规则见 [RELEASES](RELEASES.md)「发布模型」）。打 tag 是发布动作，要同时给 `--tag-approval "<所有者授权摘要>"`，摘要写进附注 tag；推送前按同一规则核对，不通过就什么都不推。跨远端推送不是事务：网络或远端保护拒绝时停止并报告已完成的步骤，不强推；只读 `plan` 可核对实际状态。重复完成的操作不生成新提交。

无人值守的触发：仓库根的 `.gitlab-ci.yml` 在 `main` 更新后跑脚本（项目变量 `HOTFIX_SYNC_ENABLED=true` 才运行，默认关闭；项目要允许 CI job token 推送）。单远端模式只同步该 GitLab 的 main/stage，不证明 GitHub 也已同步。GitHub 的 `stage` 启用必需 PR 和检查时，必须使用该平台现有的同步工单及独立 task PR，等必需检查成功后合并；不直接推送、不取消保护，不把 GitLab 同号 issue 冒充 GitHub issue。没有该保护的受控远端才按 `plan` 后 `apply` 手工同步。窗口登记只放行分支不变量，不豁免 PR、检查或审批。

GitHub 一侧的同步工单（镜像每同步一次，GitHub 上就建一张工单）：宏观声明放 `docs/changes/github/<编号>.json`，不放 `docs/changes/<编号>.json`；分支 slug 以 `github_` 开头，即 `task/<编号>/github_<slug>`。理由：GitHub 与 GitLab 的编号各自增长，同号的声明会互相覆盖（#304、#301 已经发生过，下一张同步工单会撞上 GitLab #306 的声明）。`scripts/check-architecture.mjs --forge github` 读前者；GitHub 的 `architecture-alignment` 工作流只在目标分支的检查器认 `--forge` 时才传这个参数（GitHub `stage` 还是旧检查器时见下文「首次同步」）；`task.mjs start`（`GEEK_FORGE=github`）拒绝不以 `github_` 开头的 slug，执行记录链路因此不会和 GitLab 同号的链路混在一起。

正式环境（`https://yangtzeu.work`）上线后若发生直接影响用户使用的严重故障（整页白屏、多媒体/核心流媒体无法播放、主流程阻断、安全事故等）：

1. **Issue 标记**：经所有者明确批准该紧急事项及建单后开 Issue，打上 `hot-fix`、`P0` 与模块标签。紧急处理和事后补单都遵循 [ISSUES](ISSUES.md) §1；时限与紧急程度不授予自动建单权限。
2. **基线拉取与快修上线**：紧急情况下**必须直接以最新 `origin/main` 作为基线**拉出修复分支或在独立 worktree 中快速修复并验证，以最短路径合入 `main` 部署上线消除用户影响。修复改了模块（[docs/README](../README.md)「文档跟着模块改」表里的路径），就在同一个改动里把对应文档改对；文档里的事实确实没变时，在随修复一起提交的执行记录里写文档核对。没跟文档的修复，在它上面打的发布 tag 会被部署工作流的 plan 拦下（[RELEASES](RELEASES.md) 第 3、4 步）。
3. **硬不变量合回（强制执行）**：
   - hotfix MR 合进 `main` 后立即按上一节确定同步路径：无必需 PR 的远端先 `plan` 再 `apply`；受保护的 GitHub `stage` 走同步 task PR，核对双仓 `stage >= main`。线上验收通过后再用 `--close-window <issue> --evidence "<合回 stage 的提交与线上核对>"` 准备关闭登记，保护规则不变。未要求 PR 的远端手工等价于：
     ```bash
     git switch stage && git merge --no-ff origin/main && git push origin stage
     ```
   - 关闭登记独立提交在 `main`，再合回 `stage`，写 `closedAt` 与 `evidence`（合回 stage 的提交、线上核对结果）；不把 `stage` 的未发布功能快进到 `main`。
   - 运行 `node scripts/check-branch-invariants.mjs` 确认 `stage >= main`（`git merge-base --is-ancestor origin/main origin/stage` 为真）依然成立。绝不允许生产修复仅留在 `main` 而让 `stage` 遗漏，导致后续常规迭代出现代码倒退或冲突。
   - 上面的合并提交把修复的模块改动和文档（或文档核对）一起带进 `stage`。修复没跟文档时，这个合并提交在 `stage` 上就不同步（例：`9b38684`、`7c01897`）：push `stage` 的 CI `core` 报红，在它和它之后、文档补上之前的提交上打的 rc 都会被 plan 拦下；rc tag 不能移动，只能作废编号，补好文档后再打下一个。
4. **源头根治：预发布与正式环境必须保持严格同构（环境一致性原则）**：
   - 杜绝 Hotfix 的关键在于**预发布环境必须与正式环境保持最高程度的同构**。
   - 宿主 Nginx 模板（CSP 头规则、旁路 Map、反代参数、跨域与缓存策略）、环境变量结构必须 100% 对齐，仅允许域名/端口绑定与真实环境密钥存在差异。
   - 严禁「预发布未配/未测、正式才配置」；所有改动必须在预发布真实走过完整改动路径，确保线上变更完全可控。
   - 反过来也成立：预发布做过的每一件事，正式都要有对应动作。三份 env 的隔离、代码里不写另一个环境的地址、同构清单与发版烟测由 [RELEASE-PARITY](RELEASE-PARITY.md) 规定，`pnpm check:env-isolation`、`deploy-*.yml` 的 `parity` job 与 `smoke` job 强制。

## GitHub 镜像同步

GitLab 是 issue、合并请求与编号的唯一来源；GitHub 只做代码镜像和 CI。两边的 `main`、`stage` 按下面的办法对齐，不手工对着两边推。

- **看状态**：`node scripts/github-mirror.mjs status`（加 `--fetch` 先取远端）。只读本机的两个远端跟踪引用，报告每个分支的指向（同一提交、GitHub 领先、落后或分叉）、文件树是否一致、两边独有与内容不同的文件，以及三条包含关系。缺引用时退出码为 2，不下结论。它不推送、不改分支。
- **当前的落差**：GitHub `main` 上有 #308、#310、#311 的 hotfix 提交没有合回 GitHub `stage`；GitLab `main` 比 GitHub `main` 多一个提交 `aa101771`（关闭 #308 窗口）。这些由下面的内容同步一次补齐。
- **同步 GitHub `stage`**：只同步内容，不把 GitLab 的提交带到 GitHub（所有者 2026-10-30 在会话中定：不强推任何一边，GitLab 提交里的个人邮箱不公开）。两边的 `stage` 都只经分支与合并请求进入，不直接推。
  1. 从 `origin/stage` 拉出 task 分支，新建一个合并提交：父提交是 `origin/stage` 和 `origin/main`，树取 `gitlab/stage` 的树，再加上 GitHub 独有的执行记录与本次的同步声明，作者与提交者用 noreply 地址。GitLab 的提交不进 GitHub 的历史，GitHub 原有的提交不丢也不改写。
  2. 把分支推到 GitHub，开 PR 进 GitHub `stage`，PR 正文按 [PULL-REQUESTS](PULL-REQUESTS.md) 写；必需检查通过后以 merge commit 进 GitHub `stage`。
  3. GitHub `main` 按同样办法补内容：一个父提交是 `origin/main`、树取 `gitlab/main` 的提交，它是第 1 步合并提交的父提交之一，所以 GitHub `main` 可以快进到它。
  4. 再运行 `status`：两边 `stage`、`main` 的文件树除 GitHub 独有的执行记录与同步声明外一致，才算同步完成。两边的提交号不同，这是只同步内容的结果。
  同步 PR 合并前如果 GitLab `stage` 又有了新提交，把新提交带进同步分支重做，不强推、不回退 GitLab。
- **导入 GitHub 的 issue 与 PR**：`node scripts/github-import.mjs` 默认只读演算，`--apply` 才写。规则见 [ISSUES](ISSUES.md) §5。
- **自动同步**（默认关闭，开启前要先改成按内容同步：现在的任务按提交推送，会把 GitLab 提交里的个人邮箱带到 GitHub）：`.gitlab-ci.yml` 的 `github-mirror-sync` 任务在 `stage` 或 `main` 更新后运行 `scripts/github-mirror-sync.mjs`（项目变量 `GITHUB_MIRROR_SYNC_ENABLED=true` 才运行，默认关闭）。它只靠两边的祖先关系决定动作：GitHub 落后就按上面第 1 至 3 步推同步分支、开或复用 PR，必需检查通过后合并，再把 GitLab 快进到合并后的提交；GitHub 在前就只快进 GitLab；分叉直接拒绝，不覆盖 GitHub 独有的提交；检查失败或超时都不合并。`main` 只在 `stage` 已包含它时同步。合并方式是 merge commit，需要 GitHub 仓库允许它。令牌 `GITHUB_SYNC_TOKEN` 是所有者放入的 masked 变量，AI 不读写。2026-10-30 核对：两边 `stage` 分叉（GitHub 独有 4 个提交），自动同步会拒绝，首次同步按下面的「首次同步」人工完成，之后再由自动任务接管。
- **首次同步**：GitHub `stage` 上的检查器还不导出 `FORGES`，同步 PR 只能按旧参数调用。这一次由维护者手工完成，不归自动任务：
  1. 同步分支按上面「同步 GitHub `stage`」第 1 步建：从 `origin/stage` 拉出，内容取 `gitlab/stage`，GitLab 的提交不进 GitHub 的历史。
  2. 同步 PR 带一份合成的 `docs/changes/<同步工单编号>.json`，`coverage` 覆盖整个 diff 的全部路径。理由写清这是把 GitLab `stage` 的内容整体同步过来，各项改动的业务评估仍以各自的声明为准。这份文件放在扁平目录，只为旧检查器服务；若 GitLab 上同号的 `docs/changes/<编号>.json` 已存在，就换一个工单编号，不覆盖。它能否通过，由这次 PR 的 `architecture-alignment` 结果决定，文档不预先保证。
  3. 合并后 GitHub `stage` 的检查器导出 `FORGES`，之后的同步都传 `--forge github`，读 `docs/changes/github/`。
  4. 合成的扁平声明在下一次同步里删掉。留着它，将来同号的 GitLab 声明同步过来时就会撞车。

## 部分晋升窗口：预发布里已验收的一部分先上正式

预发布（`stage`）里有几项已经验收、正式急需，其余还没验收时用。它和 hotfix 窗口是同一类东西：登记在 `main` 上、带所有者批准摘要、带过期时间，过期自动失败。场景怎么选见 [CHANGE-PATHS](CHANGE-PATHS.md)。

先按顺序排除更简单的办法，排除的理由写进登记的 `reason`：

1. 功能开关：代码随常规路径进 `main`，正式先关着。能用开关就不晋升（Mozilla uplift 规则「prefer disabling over uplifting」）。
2. 前缀快进：想要的提交都在某个已验收提交之前，`main` 直接快进到那个提交，不需要窗口。
3. 部分晋升窗口：以上都不行时才用。

登记：`deploy/promotion/windows.json` 的 `windows` 加一条，字段为 `issue`、`status`（`open`/`closed`）、`approvedBy`（字面值「所有者」）、`approvedAt`、`approval`（批准摘要）、`reason`、`expiresAt`（最长 3 天）、`stageBase`（登记时 stage 的 40 位 SHA）、`picks`（要晋升的 stage 提交，按顺序）、`excludes`（明确不晋升的 `{ sha, issue }`）。登记提交只改这一个文件、只新增这一条，说明引用窗口 issue，提交时间在 `approvedAt` 与 `expiresAt` 之间，并且只在 `main` 上（随晋升 MR 进 `main`，不先进 `stage`）。登记之后除了收尾时写的 `status`、`closedAt`、`evidence`，其他字段都不能改：要改范围，由所有者重新批准，另登记一个窗口。

做法：

1. 从最新 `main` 拉 `task/<issue>/<slug>`（和 hotfix 一样，是「task 分支从 stage 拉出」的登记例外），按顺序对每个 pick 执行 `git cherry-pick -x <sha>`，保留 `(cherry picked from commit …)` 那一行。
2. 每个 pick 的 patch-id（`git patch-id --verbatim`，空白也算内容）必须和 stage 上的原提交一致。挑的时候有冲突、解决后内容变了的，不算 pick，进不了 `main`：把它依赖的提交一起列进 picks 重新挑，或者改走常规路径。
3. MR 进 `main` 前跑 `node scripts/promotion-windows.mjs check` 与 `pnpm check`。`main` 领先 `stage` 的提交只能是这个登记提交和 picks 挑来的提交，excludes 一个都不能进 `main`：窗口开着期间，`main` 快进到 `stage` 也会把 excludes 带进来，同样被拦；`check-branch-invariants`、pre-push 和 CI 的 branch-guard 用同一个判定。登记过的窗口不能删、不能改（过期的也一样），只能标 `closed`：`main` 与 `stage` 各按自己的历史核对，历史上登记过的窗口到这一版必须还在、只改过收尾字段，标过 `closed`（写了 `closedAt` 与 `evidence`）之后才可以删；合并时丢掉窗口也算删，历史里同一个 issue 出现两版不同的登记也算改。新窗口用新的 issue 号，删掉旧窗口再用同一个号登记会被当成改登记。CI、pre-push 和 `check` 用同一个判定，`main` 快进之后照样拦。推 `main` 时另拿推送前的远端 `main` 核对一遍，强推换掉历史也拦，远端 `main` 不在本地就先 fetch；被删改的窗口按登记时那一版核对 excludes。
4. 合进 `main` 后立刻用 `hotfix-sync` 的同样办法把 `main` 合回 `stage`，恢复 stage ≥ main。
5. 在晋升后的 `main` 提交上打 `vX.Y.Z-rc.N` 发预发布、验收，再在同一提交上打 `vX.Y.Z`；验收对象是这个提交，不是 stage 的最新提交。
6. 正式核对完成后把窗口标 `closed`，写 `closedAt` 和 `evidence`；还在 excludes 里的提交挂到各自的 issue 上，下次晋升时照常走。标 `closed` 就解除了 excludes：之后 `main` 快进到 `stage` 会把它们一起带上正式，所以只在 excludes 也已经可以走常规 rc 路径时才关窗。

为什么用 SHA、cherry-pick 痕迹和 patch-id 判定，而不是看提交说明里的 `#N`：只看 `#N` 时，说明里偶然提到一个 issue 号就能通过，hotfix 窗口归属检查出过这个漏洞，现在另加了「提交者时间在批准与过期之间」。hotfix 窗口仍按 `#N` 加时间归属，因为 P0 的修复提交是批准之后才写的，事先列不出 SHA；晋升窗口挑的是 stage 上已有的提交，能按 SHA 与 patch-id 精确核对，就不靠说明。

## task worktree：一个 issue 一个工作目录

**一个 issue = 一个 `task/<issue>/<slug>` 分支 = 一个 git worktree = 一个 PR，四者生命周期相同，都跟着 issue 走**（[TRACKING](TRACKING.md) §1）：

- **开工**：先核对 issue 里的所有者确认依据，再运行 `node scripts/task.mjs start <issue> <slug>`。它先确认 issue 开着，再从最新的 stage 建分支（代码托管由 `scripts/forge.mjs` 选：本机有名为 `gitlab` 的 remote 就查 GitLab 的 issue、从 `gitlab/stage` 拉，否则查 GitHub、从 `origin/stage` 拉；`GEEK_FORGE=gitlab|github` 可强制），同时在主工作区的 `.claude/worktrees/task-<issue>` 建一个独立 worktree，并在 issue 上留一条开工记录。脚本通过不替代所有者确认。之后这件事的所有编辑、安装、构建、测试、提交都在这个 worktree 里做。
- **不碰主工作区**：主工作区（以及别的 task 的 worktree）上可能有别人的未提交改动、正在跑的预览或论坛进程；在自己的 worktree 里做，互不影响，也不用切分支、stash。
- **一个 issue 只有一个 worktree**：`start` 发现已有同号 worktree 会拒绝，直接进去继续做。不要在同一个 worktree 里做第二件事。
- **结束**：PR 合并进 `stage` 后，`branch-hygiene` 删远端分支，`issue-lifecycle` 关 issue；本机运行 `node scripts/task.mjs finish <issue>` 删 worktree 与本地分支（在主工作区运行，不要在要删的 worktree 里运行）。fork 来的 PR 合并时 `issue-lifecycle` 没有写权限（#137），issue 不会自动关，由合并的人按 [ISSUES](ISSUES.md) §1 与 [CODE-REVIEW](CODE-REVIEW.md) 第 12 项当场手工关并留「关闭」记录。`node scripts/task.mjs list` 列出每个 worktree 的 issue / PR 状态；`prune` 一次清掉所有可清理的。
- **忘了 finish 就推不上去**：`.githooks/pre-push` 在分支规则之后运行 `node scripts/task.mjs list --check`，本机只要有 PR 已合并、或 issue 已关闭（放弃）却还没 finish 的 worktree，任何推送都被拒绝，并列出是哪几个和清理命令；worktree 里还有未提交改动的也算，先弄清改动是谁的、还要不要，不替别人丢弃。主工作区自己停在已经结束的 task 分支上时，提示的是切回 `dev/<你的 GitHub 用户名>` 或 `stage`，`finish` 不删主工作区。这一项按上面同样的方式查 GitLab 或 GitHub，偶发的失败会重试一次；没有令牌、没登录、离线或超时只警告、不拦。钩子每台克隆启用一次：`pnpm hooks:enable`（`git config core.hooksPath .githooks`）；`git push --no-verify` 能跳过本地钩子，但跳过不等于收尾，worktree 照样要 finish。
- **什么时候不删**：worktree 有未提交改动、PR 还开着、或 issue 还开着且 PR 没合并时，脚本只报告原因不删除；放弃的 issue 先按 TRACKING 留「关闭」记录再关，之后就能清理。
- `.claude/worktrees/` 已被 `.gitignore` 忽略；每个 worktree 需要自己 `pnpm install --frozen-lockfile`（pnpm 的全局仓库会复用已下载的包）。

## 日常流程

```bash
pnpm hooks:enable                              # 0. 每台克隆一次：启用 pre-push（分支规则、发布 tag、该清理的 worktree）
git branch --show-current                      # 1. 确认当前在哪
# 2. 按 ISSUES.md 查证、查重，经所有者确认后开 issue，记下编号
node scripts/task.mjs start <issue> <slug>     # 3. 从最新 origin/stage 建 task/<issue>/<slug> 与 .claude/worktrees/task-<issue>
cd .claude/worktrees/task-<issue> && pnpm install --frozen-lockfile
# 4. 在 worktree 里开发、验证、提交（见 CONTRIBUTING.md），每个阶段在 issue 上留追踪记录（TRACKING.md §3）
# 5. 开 PR → stage，正文按 PULL-REQUESTS.md 的契约写（Closes #<issue>、解决链路、验收证据、人工验收步骤）
# 6. 合并后：远端分支与 issue 由 branch-hygiene / issue-lifecycle 自动处理；
cd <主工作区> && node scripts/task.mjs finish <issue>   #    本机删 worktree 与本地分支
```

发布相关（打 rc tag、验收、把 `main` 快进到被验收的提交、打正式 tag、回滚）见 [RELEASES](RELEASES.md)。发布 tag 与部署目标的绑定关系由 [deploy/environments.json](../../deploy/environments.json)、[scripts/release-policy.mjs](../../scripts/release-policy.mjs) 与 [CICD](../ops/CICD.md) 描述。
