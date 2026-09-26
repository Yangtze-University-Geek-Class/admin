# 追踪记录规范（issue 与 PR 的评论）

> 一件事从提出到关闭，每一步都以固定格式的评论留在 issue 与 PR 上；人扫一眼能看懂进展，Agent 按字段就能读出状态。

状态：`current` · 更新：2026-09-26 · 适用：所有 issue、PR 的评论，人与 Agent 都遵守。

## §1 生命周期：一件事 = 一个 issue = 一个 task 分支 = 一个 worktree = 一个 PR

```
开 issue ──▶ task.mjs start：从 stage 拉 task/<issue>/<slug> + 独立 worktree ──▶ 开 PR（Closes #<issue>）──▶ 审查 + CI ──▶ 合并进 stage
   │                                                                                                                    │
   └──────────────────────────── 每个阶段在 issue 上发一条「追踪记录」─────────────────────────────────────────────────┘
                                                                                                                         ▼
                                          自动：删远端 task 分支、关闭 issue、两边互相留言；本机：task.mjs finish 删 worktree 与本地分支
```

- **worktree 跟着 issue 走**：开工时由 `node scripts/task.mjs start` 与分支一起建，合并（或放弃关闭）后由 `node scripts/task.mjs finish` 与本地分支一起删；详见 [BRANCHING](BRANCHING.md)「task worktree」。

- **issue 是这件事的主档**：现象、复现、验收条件写在正文；之后的每一步进展写成评论，**不改写已发出的评论**（改正文只补「实施」段与链接）。
- **PR 是这次改动的证据档**：解决链路、验收证据、人工验收步骤写在正文（[PULL-REQUESTS](PULL-REQUESTS.md)）；审查与返工写成评论。
- 做完当场关，开着的 issue 只留还有人在做的事：
  - 合并后必须关（所有者 2026-09-26 定的强制规范：「完成的pr管理的issue必须清理」）：PR 合并进 `stage` 后，它 `Closes` 的 issue 必须关闭，task 分支与 worktree 必须清理。`issue-lifecycle` 工作流删除远端 task 分支、关闭 issue，并在 issue 和 PR 上各留一条「关闭」记录；本机 worktree 由开发者 `task.mjs finish` 删。GitHub 只在合进默认分支 `main` 时才按 `Closes #n` 自动关闭，所以不能依赖它；自动化没关上的（工作流失败，或者 fork 来的 PR 合并时工作流没有写权限，#137）由合并的人当场手工关闭，并照 §3 的格式留言。合并的人按 [CODE-REVIEW](CODE-REVIEW.md) 第 12 项核对。
  - 不走 PR 做完的（运维操作、决定不做、重复、被别的改动顺带解决）：做完的人当场写「关闭」记录，写明做了什么、在哪验证、或者为什么不做、被哪个 #n 取代，再关闭；不静默关闭。
  - 只剩外部等待的（等第三方处理、等别人给凭据）：关掉原 issue，把剩下的那一步开成新 issue，写明负责人和在等什么，两边 `Refs` 互相引用。例：#70 在我们这边能做的都做完后，只剩请 GitHub Support 清理 PR 旧引用里的提交，于是关掉 #70，剩下的一步开成 #114。
- **一件事做不完**：在原 issue 留「阻塞」或「拆分」记录，拆出的新 issue 用 `Refs #<原 issue>` 互相引用；不在已合并的分支上继续提交。
- 评论之外，执行者自己的每一步记在仓库的 `notes/` 里（[NOTES](NOTES.md)）：评论给所有人看进展，`notes/` 按人和时间追溯每个 agent 做过什么，两者都要写。
- 每天巡检（`issue-lifecycle` 的 `sweep`，`scripts/issue-sweep.mjs`）：关联的 PR 已经合并进 `stage`、issue 还开着的，自动关闭并留「关闭」记录（最近一次合并之后被人重开过的、还有开着的 PR 关联同一个 issue 的不关，「超期」记录里写明原因；PR 合并不到一小时的留给 `close-on-merge`）；其余开着的 issue 14 天没有任何动静，留一条「超期」记录；14 天内关闭的 issue 既没有合并的 PR 也没有「关闭」记录的，留一条「缺记录」，请关闭的人补上，不重开。

### 各个生命周期在哪里强制

| 生命周期 | 规则 | 强制在哪 | 查不到时 |
|---|---|---|---|
| issue | PR 合并后它 `Closes` 的 issue 必须关闭，自动化没关上由合并的人当场手工关；不走 PR 做完的当场写「关闭」再关；只剩外部等待的拆新 issue | 合并时 `issue-lifecycle` 的 `close-on-merge`；合并的人按 [CODE-REVIEW](CODE-REVIEW.md) 第 12 项核对；每天的 `sweep` 补关已合并的、给超期和缺记录的 issue 留记录 | 定时任务跑的是默认分支 `main` 上的工作流；`sweep` 只留记录、不重开，关不关由人决定 |
| PR | 九段正文、`Closes #<issue>` 与分支号一致、issue 开着 | `issue-lifecycle` 的 `pr-contract` | 无 |
| task 分支（远端） | 合并后立即删除 | `branch-hygiene` 合并后自动删；每周巡检 14 天没提交、没有 open PR 的残留分支，只告警 | 删分支不可逆，残留的由人确认后删 |
| task worktree（本机） | 合并或放弃后 `task.mjs finish` | `.githooks/pre-push` 运行 `node scripts/task.mjs list --check`：有该清没清的 worktree 就拒绝推送（[BRANCHING](BRANCHING.md)「task worktree」） | 钩子要每台克隆 `pnpm hooks:enable` 启用一次；gh 查不到只警告 |
| 执行记录（`notes/`） | 开工起连续记到收尾；PR 带开工、提交、PR、审查 | `pnpm check` 的 `check:notes`；CI `branch-guard` 的执行记录检查（[NOTES](NOTES.md) §6） | 收尾写在合并之后，先暂存到主工作区，随下一个 PR 入库，没有检查拦「一直不入库」 |
| 文档跟着模块改 | 模块改了，对应文档在同一个 PR 里跟着改；文档里的事实没变时，在本 task 的执行记录里写文档核对 | `pnpm check` 的 `check:doc-sync`、CI `core` 与 `branch-guard`（[docs/README](../README.md)「文档跟着模块改」） | 检查只看文档动没动，写得对不对靠审查（[CODE-REVIEW](CODE-REVIEW.md) 第 6 项） |

## §2 互相引用

| 在哪 | 写什么 | 作用 |
|---|---|---|
| 分支名 | `task/<issue>/<slug>` | 分支 → issue |
| PR 正文「关联」 | `Closes #<issue>`（只关这一个）；其它相关的写 `Refs #n`、依赖写 `Depends on #n` | PR → issue；CI 的 `pr-contract` 核对与分支号一致 |
| issue 正文「实施」段 | 分支名、PR 链接、合并提交（自动回填） | issue → PR |
| 评论 | 提到别的 issue / PR / 提交一律写 `#n` 或完整 SHA，不写「上面那个」「刚才的 PR」 | 在 GitHub 上生成双向链接 |
| 提交信息 | 结尾 `Refs #<issue>` | 提交 → issue |

## §3 追踪记录的格式

每条评论第一行是**记录头**，之后是固定的二级字段。字段用 `**名字**：` 开头，一个字段一行或一个列表；没有内容的字段整行省略，不写「无」。

```markdown
<!-- yzgc:track v1 kind=<类型> stage=<阶段> -->
**<类型中文>**｜<一句话结论>

**现状**：<现在是什么样，一两句>
**证据**：
- <命令 + 真实输出摘要 / 截图 / 日志 / 链接>
**下一步**：<谁、做什么；已结束写「无，关闭」>
**引用**：#<issue> · #<PR> · <提交 SHA>
```

- 第一行的 HTML 注释对人不可见，给 Agent 和脚本解析：`kind` 取下表的英文值，`stage` 取 `triage | dev | review | merged | released | closed`。
- 第二行加粗的中文类型 + 一句话结论，是给人扫的标题行。
- 时间与作者由 GitHub 记录，不在正文里重复写。
- 证据必须是能复查的东西：命令与真实输出、截图（直接拖进评论框上传）、CI 运行链接、提交 SHA。「看起来没问题」不是证据。
- 不贴密钥、令牌、会话、生产数据、真实姓名；需要时写「已本地核对，不公开」。

| kind | 中文类型 | 什么时候发 | 发在哪 |
|---|---|---|---|
| `triage` | 受理 | 确认能复现 / 确认要做，定了优先级和范围 | issue |
| `repro` | 复现 | 补充或更新复现步骤、设备、日志 | issue |
| `plan` | 方案 | 开工前写定位结论与打算怎么改（大改动必发） | issue |
| `progress` | 进展 | 阶段性结果：分支已建、主要改动完成、卡在哪 | issue |
| `blocked` | 阻塞 | 需要人决定、缺凭据、依赖别的 issue | issue（同时 @ 相关人） |
| `review` | 审查 | 逐项审查结论（也可以写在 PR 正文「审查结论」） | PR |
| `rework` | 返工 | 审查或验收提出的问题，以及改了什么 | PR |
| `accept` | 验收 | 人工验收结果：在哪个环境、按哪几步、看到了什么 | PR 或 issue |
| `closed` | 关闭 | 合并、发布或放弃；写明合并提交或原因 | issue 与 PR 各一条 |
| `overdue` | 超期 | 巡检自动发：开着的 issue 14 天没有动静，请负责人关掉、拆出外部等待或写进展 | issue |
| `unrecorded` | 缺记录 | 巡检自动发：issue 关了，却没有合并的 PR，也没有「关闭」记录 | issue |

### 例子

```markdown
<!-- yzgc:track v1 kind=plan stage=dev -->
**方案**｜开机画面进场渐变时透出了桌面，改成不渐变并等壁纸解码

**现状**：开机画面与外层 .pt-os 同时淡入，半透明的几帧里能看到已挂好的桌面。
**证据**：
- 逐帧追踪：开机后 0.2s 内 os=0.86、boot=0.80，桌面已挂载（脚本 /tmp/p32-boot.mjs 输出）
- 慢网（壁纸延迟 2.5s）下跳过动画会露出没有壁纸的桌面
**下一步**：Claude 在 task/32/desk_boot_wallpaper 上改 Home.tsx 与 desk.css，今天提 PR
**引用**：#32
```

## §4 Agent 怎么读

- 取某个 issue 的全部记录：`gh issue view <n> --json body,comments`，只看以 `<!-- yzgc:track v1` 开头的评论；最后一条的 `kind` 与 `stage` 就是当前状态。
- 恢复上下文（新会话、压缩后）先读 issue 正文 + 最后三条追踪记录，再读关联 PR 的正文与最后一条 `review` / `rework` / `accept`，不凭记忆续做。
- 自己做完一个阶段就发一条记录；不发「收到」「在做了」这类没有字段的评论。

## §5 与其它规范的关系

issue 正文字段见 [ISSUES](ISSUES.md)，PR 正文字段与 CI 契约见 [PULL-REQUESTS](PULL-REQUESTS.md)，审查清单见 [CODE-REVIEW](CODE-REVIEW.md)，分支规则见 [BRANCHING](BRANCHING.md)，仓库内的执行记录见 [NOTES](NOTES.md)。本文件只规定评论与生命周期，不重复它们的内容。
