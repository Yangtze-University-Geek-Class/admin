# 分支模型规范

> 只有 `main`（正式）与 `stage`（预发布）两条长期分支；task 分支合并后必须立即删除，任何操作前先确认当前分支。

状态：`current` · 更新：2026-09-23 · 依据：项目所有者本次明确指令。

## 第负一步：先确认分支

**任何提交、推送、切分支、改文件之前，先跑 `git branch --show-current` 确认自己在哪条分支上。** Agent 进入仓库的第一件事就是确认分支并阅读规范（见 [AGENT-START](AGENT-START.md)）。不在预期分支上时停止操作并说明，不能靠 `git checkout .`、`reset --hard` 或清理工作区来自行纠正。

## 长期分支

| 分支 | 角色 | 生命周期 | 部署目标 |
|---|---|---|---|
| `main` | 正式稳定版，只能由 `stage` 合入 | 长期 | 正式栈 `/opt/yzgc/production` → `https://yangtzeu.work` |
| `stage` | 动态更新版，集成分支 | 长期 | 预发布栈 `/opt/yzgc/preview` → `https://prev.yangtzeu.work` |

除这两条以外，**不允许存在第三条长期分支**。历史上使用过的 `next` 已退役（本地已改名），不得再把 `next`、`develop`、`release` 等当作集成分支；`documentation`/`feature` 等旧命名同样不再有效。

## 短生命周期分支

| 分支 | 来源与去向 | 规则 |
|---|---|---|
| `task/<issue>/<slug>` | 从 `stage` 拉出 → MR 回 `stage`，正文写 `Closes #<issue>` | **极短**：MR 合并后必须立即删除，禁止残留死分支。`branch-hygiene.yml` 会在 PR 合并后自动删除，也可以手工 `git push origin --delete` |
| `dev/<github-username>` | 个人自由开发区，内容随意 | 个人自行维护；**不得作为任何提交进入 `stage` 的凭据**，也不部署（只在 `ci.yml` 里跑机器验证） |

- 一次任务一条 task 分支；一个 task 分支只对应一个 issue。合并方式默认 squash 或普通 merge，由维护者决定，但分支本身必须在合并后删除。
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
- 迁移记录（2026-09-23，所有者指令）：`dev-crosery` 改名为 `dev/crosery`。本地改名 `git branch -m dev-crosery dev/crosery`；远端新名推送与删除旧名由分支所有者自行执行（Git 不允许 `dev` 与 `dev/…` 同时存在，但 `dev-crosery` 与 `dev/crosery` 可以并存）。

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

`--push` 模式读 git 的 pre-push 四段输入，额外断言「推 `main` 的提交必须已在 `stage`」「推 `stage` 只能来自 `stage` 自身或合规的 `task/<issue>/<slug>` 且必须已包含 `origin/main`」「不得删除远端 `main`/`stage`」，可用作本地 pre-push 守卫。首次推送新分支（远端 SHA 全 0）同样照常判定命名与不变量。脚本只读 Git 证据：不 fetch、不改 refs、不删分支、不建提交、不连远端。

违反任一条即视为分支模型被破坏，必须先修复再继续开发；不要用 force-push 掩盖差异。

## 禁止事项

- 禁止直接向 `main` 提交或推送（含 agent、脚本、GitHub 网页编辑、CI 机器人）。
- 禁止 `task/**`、`dev/**` 分支直接进 `main`；禁止把 `stage` 之外的来源合入 `main`。
- 禁止在新分支名里使用 `-`（见上文「命名规则」）。
- 禁止在没有 issue 的情况下开 task 分支：开发前先在仓库开 issue，见 [ISSUES](ISSUES.md)。
- 禁止向 `stage` 提交未审查的内容：进入 `stage` 前必须走 [CODE-REVIEW](CODE-REVIEW.md)，MR 描述里带审查结论。
- 禁止长期保留已合并的 task 分支，禁止用分支名当版本号或发布凭据。
- 禁止 force-push `main`/`stage`，禁止整分支 reset 覆盖他人提交。

## 日常流程

```bash
git branch --show-current          # 1. 确认分支
# 2. 按 ISSUES.md 开 issue，记下编号
git fetch origin && git switch stage && git pull --ff-only
git switch -c task/<issue>/<slug>  # 3. 从 stage 拉 task 分支，例：task/12/portal_redesign
# 4. 开发、验证、提交（见 CONTRIBUTING.md）；提交前再确认一次分支
# 5. 开 MR → stage，正文 Closes #<issue>，写明验证命令与结果、CODE-REVIEW 结论
# 6. 合并后：git push origin --delete task/<issue>/<slug>；本地 git branch -d
#    （branch-hygiene.yml 会在 PR 合并后自动删；每周巡检只告警残留的 task/**，不自动删个人分支）
```

发布相关（把 `stage` 合入 `main`、部署、验收）见 [RELEASES](RELEASES.md)。分支与部署目标的绑定关系由 [deploy/environments.json](../../deploy/environments.json) 与 [CICD](../ops/CICD.md) 描述。
