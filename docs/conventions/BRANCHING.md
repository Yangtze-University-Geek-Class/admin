# 分支模型规范

> 只有 `main`（正式）与 `stage`（预发布）两条长期分支；task 分支合并后必须立即删除，任何操作前先确认当前分支。

状态：`current` · 更新：2026-09-26 · 依据：项目所有者明确指令（2026-09-23 分支模型；2026-09-24 改为打 tag 发版；2026-09-26 worktree 做完即清，推送前检查）。

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
| `task/<issue>/<slug>` | 从 `stage` 拉出 → MR 回 `stage`，正文写 `Closes #<issue>` | **极短**：MR 合并后必须立即删除，禁止残留死分支。`branch-hygiene.yml` 会在 PR 合并后自动删除，也可以手工 `git push origin --delete` |
| `dev/<github-username>` | 个人自由开发区，内容随意 | 个人自行维护；**不得作为任何提交进入 `stage` 的凭据**，也不部署（只在 `ci.yml` 里跑机器验证） |

- 一次任务一条 task 分支；一个 task 分支只对应一个 issue，并且**在自己的 git worktree 里开发**（见下节）。进 `stage` 只用 merge commit（GitHub 的「Create a merge commit」，命令行 `gh pr merge <PR> --merge`），分支本身必须在合并后删除。原因：文档同步检查在 `stage` 上按第一父链的时间比较模块与文档（[docs/README](../README.md)「文档跟着模块改」），一个 PR 只进来一个合并提交，模块和文档同时到；rebase 合并会把 PR 的提交逐个接到第一父链上，模块提交排在文档提交后面就不通过；squash 会把审查和执行记录里引用的提交 SHA 从 `stage` 的历史里抹掉。仓库设置里关掉 squash 与 rebase 要所有者操作，关掉之前靠合并的人照这条做。
- `dev/<github-username>` 是个人实验区：可以自由提交、可以 force-push 自己的分支，但把内容送上 `stage` 的唯一合法路径是「从 `stage` 拉一条干净的 `task/<issue>/<slug>`，重新提交或 cherry-pick 经过审查的改动」。`dev/**` 的提交历史、分支名和 CI 绿标都不是审查凭据。
- 禁止把 `dev/**`、`task/**` 直接合并进 `main`。

## 命名规则：只用 `/` 分层，不用 `-`

**分支名里一律不出现 `-`。** 层级像文件夹一样用 `/` 分隔，每一段只含小写字母与数字；一段里有多个词时用 `_` 连接。唯一实现是 [scripts/check-branch-invariants.mjs](../../scripts/check-branch-invariants.mjs) 的 `TASK_BRANCH_RE` / `DEV_BRANCH_RE`，其它文档只引用这里：

| 类型 | 形状 | 正则（与脚本逐字一致） | 例子 |
|---|---|---|---|
| 任务分支 | `task/<issue>/<slug>` | `^task\/[0-9]+\/[a-z0-9]+(?:_[a-z0-9]+)*$` | `task/12/portal_redesign`、`task/7/forum` |
| 个人分支 | `dev/<github-username>` | `^dev\/[a-z0-9]+(?:_[a-z0-9]+)*$` | `dev/crosery` |

- `<issue>` 是纯数字的 issue 编号；`<slug>` 与用户名段都是 `[a-z0-9]+(?:_[a-z0-9]+)*`：不允许大写、`-`、首尾 `_` 或连续 `__`，也不允许再多一层 `/`。
- GitHub 用户名里带 `-` 的，个人分支里写成 `_`（例：`joe-smith` 写成 `dev/joe_smith`）；大写一律转小写。
- 旧写法 `task/<issue>-<slug>`、`dev-<username>`（以及 `task-…`）已**不合规**：`check-branch-invariants.mjs` 把它们归为 `task-malformed` / `personal-malformed` 并告警，pre-push 拒绝以它们为来源推 `stage`，`ci.yml` 也不再对 `dev-*` 的 push 触发。
- 迁移（2026-09-23，所有者指令）：旧个人分支 `dev-crosery` 需改名为 `dev/crosery`，由分支所有者执行，引入本规则的提交本身不改任何本地或远端分支：本地 `git branch -m dev-crosery dev/crosery` → 推送新名 `git push -u origin dev/crosery` → 确认后删除旧远端 `git push origin --delete dev-crosery`（pre-push 对删除非长期分支放行）。Git 不允许 `dev` 与 `dev/…` 同时存在，但 `dev-crosery` 与 `dev/crosery` 可以并存。

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

- 禁止直接向 `main` 提交或推送（含 agent、脚本、GitHub 网页编辑、CI 机器人）。
- 禁止 `task/**`、`dev/**` 分支直接进 `main`；禁止把 `stage` 之外的来源合入 `main`。
- 禁止在新分支名里使用 `-`（见上文「命名规则」）。
- 禁止在没有 issue 的情况下开 task 分支：开发前先在仓库开 issue，见 [ISSUES](ISSUES.md)。
- 禁止向 `stage` 提交未审查的内容：进入 `stage` 前必须走 [CODE-REVIEW](CODE-REVIEW.md)，MR 描述里带审查结论。
- 禁止长期保留已合并的 task 分支，禁止用分支名当版本号或发布凭据；发布凭据只有所有者授权后打的发布 tag。
- 禁止 force-push `main`/`stage`，禁止整分支 reset 覆盖他人提交。

## task worktree：一个 issue 一个工作目录

**一个 issue = 一个 `task/<issue>/<slug>` 分支 = 一个 git worktree = 一个 PR，四者生命周期相同，都跟着 issue 走**（[TRACKING](TRACKING.md) §1）：

- **开工**：`node scripts/task.mjs start <issue> <slug>`。它先确认 issue 开着，再从最新 `origin/stage` 建分支，同时在主工作区的 `.claude/worktrees/task-<issue>` 建一个独立 worktree，并在 issue 上留一条开工记录。之后这件事的所有编辑、安装、构建、测试、提交都在这个 worktree 里做。
- **不碰主工作区**：主工作区（以及别的 task 的 worktree）上可能有别人的未提交改动、正在跑的预览或论坛进程；在自己的 worktree 里做，互不影响，也不用切分支、stash。
- **一个 issue 只有一个 worktree**：`start` 发现已有同号 worktree 会拒绝，直接进去继续做。不要在同一个 worktree 里做第二件事。
- **结束**：PR 合并进 `stage` 后，`branch-hygiene` 删远端分支，`issue-lifecycle` 关 issue；本机运行 `node scripts/task.mjs finish <issue>` 删 worktree 与本地分支（在主工作区运行，不要在要删的 worktree 里运行）。`node scripts/task.mjs list` 列出每个 worktree 的 issue / PR 状态；`prune` 一次清掉所有可清理的。
- **忘了 finish 就推不上去**：`.githooks/pre-push` 在分支规则之后运行 `node scripts/task.mjs list --check`，本机只要有 PR 已合并、或 issue 已关闭（放弃）却还没 finish 的 worktree，任何推送都被拒绝，并列出是哪几个和清理命令；worktree 里还有未提交改动的也算，先弄清改动是谁的、还要不要，不替别人丢弃。这一项要用 `gh` 查 GitHub，gh 没装、没登录、离线或超时只警告、不拦。钩子每台克隆启用一次：`pnpm hooks:enable`（`git config core.hooksPath .githooks`）；`git push --no-verify` 能跳过本地钩子，但跳过不等于收尾，worktree 照样要 finish。
- **什么时候不删**：worktree 有未提交改动、PR 还开着、或 issue 还开着且 PR 没合并时，脚本只报告原因不删除；放弃的 issue 先按 TRACKING 留「关闭」记录再关，之后就能清理。
- `.claude/worktrees/` 已被 `.gitignore` 忽略；每个 worktree 需要自己 `pnpm install --frozen-lockfile`（pnpm 的全局仓库会复用已下载的包）。

## 日常流程

```bash
pnpm hooks:enable                              # 0. 每台克隆一次：启用 pre-push（分支规则、发布 tag、该清理的 worktree）
git branch --show-current                      # 1. 确认当前在哪
# 2. 按 ISSUES.md 开 issue，记下编号
node scripts/task.mjs start <issue> <slug>     # 3. 从最新 origin/stage 建 task/<issue>/<slug> 与 .claude/worktrees/task-<issue>
cd .claude/worktrees/task-<issue> && pnpm install --frozen-lockfile
# 4. 在 worktree 里开发、验证、提交（见 CONTRIBUTING.md），每个阶段在 issue 上留追踪记录（TRACKING.md §3）
# 5. 开 PR → stage，正文按 PULL-REQUESTS.md 的契约写（Closes #<issue>、解决链路、验收证据、人工验收步骤）
# 6. 合并后：远端分支与 issue 由 branch-hygiene / issue-lifecycle 自动处理；
cd <主工作区> && node scripts/task.mjs finish <issue>   #    本机删 worktree 与本地分支
```

发布相关（打 rc tag、验收、把 `main` 快进到被验收的提交、打正式 tag、回滚）见 [RELEASES](RELEASES.md)。发布 tag 与部署目标的绑定关系由 [deploy/environments.json](../../deploy/environments.json)、[scripts/release-policy.mjs](../../scripts/release-policy.mjs) 与 [CICD](../ops/CICD.md) 描述。
