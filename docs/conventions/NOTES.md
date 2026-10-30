# 执行记录规范（notes/）

> 每个人、每个 agent 做的每一步，都按北京时间写进仓库里的 `notes/<日期>/<GitHub 用户名>/<链路>.md`；开发前先记开工，开发后记到收尾，链路不完整的 PR 不能合并。

状态：`current` · 更新：2026-10-28 · 适用：所有在本仓库开发的人和 agent（含委派出去的子代理），所有 `task/<issue>/<slug>` 分支。

## §1 为什么要有

issue 和 PR 的评论（[TRACKING](TRACKING.md)）记的是「这件事走到哪一步了」，给所有人看。`notes/` 记的是「谁的 agent 在什么时候做了什么、结果如何」，一条链路从开工一直记到收尾，随代码一起入库。出了问题时能按日期和人找到当时的每一步：改了什么、跑了什么命令、看到什么输出、谁做的决定。两者都要写，不能互相代替。

## §2 目录结构

```
notes/
├── INDEX.md                          生成物：按日期列出每天有哪些人的记录
└── 2026-09-26/                       北京时间的日期
    └── alice/                        负责人的 GitHub 用户名（小写）
        ├── task_91_agent_notes.md    一条链路一个文件，文件名是分支名把 / 和 - 换成 _
        └── task_87_exam_docs.md
```

- **日期**：写这条记录时的北京日期（`Asia/Shanghai`，+08:00），由脚本读系统时钟决定，不手填。一条链路跨过零点时，后面的记录落在新日期目录下的同名文件里，合起来仍是一条链路。
- **负责人**：替谁干活就写谁的 GitHub 用户名。agent 替 alice 干活，记录放在 `alice/` 下；自己动手的人写自己。
- **链路**：一个 task 分支一条链路（`task/91/agent_notes` → `task_91_agent_notes.md`）。不属于任何 task 的操作（发布、验收、打 tag、排查线上问题）记在当时所在分支的链路里，比如 `stage`、`main`。
- **执行者**：每条记录单独写，同一条链路可以有多个执行者（主 agent、子代理、人）。

## §3 格式

一个链路文件：

```markdown
# task/91/agent_notes · alice · 2026-09-26

负责人：alice

## 00:41:07 +08:00 · 开工 · #91 · 建立 notes/ 执行记录规范

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 91 agent_notes，从 stage f99df08 拉出 task/91/agent_notes 和独立 worktree
- 结果：worktree 在 .claude/worktrees/task-91
- 下一步：写 scripts/note.mjs 和规范正文

## 01:20:33 +08:00 · 提交 · #91 · 规范、脚本、CI 检查一起提交

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：docs(docs): 新增执行记录规范…；pnpm verify
- 结果：pnpm verify 通过（Tests 420 passed）
```

- 第一行 `# <分支> · <负责人> · <日期>`，第二段 `负责人：<负责人>`，都和所在目录一致。
- 每条记录的标题 `## HH:MM:SS +08:00 · <阶段> · #<issue> · <一句话>`；涉及多个 issue 写 `#87 #91`，确实没有 issue 写 `无 issue`。
- 必填三项：`执行者`、`做了什么`、`结果`；`下一步` 可选。每项一行。
- 执行者写成 `agent-<工具>-<会话>（说明）` 或 `human-<GitHub 用户名>`，例：`agent-claude-geek-main-08（Claude Code，claude-opus-5-5）`、`agent-omp-geek-main-25`、`human-alice`。
- 「结果」写能复查的东西：命令的真实输出摘要、提交 SHA、PR 号、CI 运行号、截图在 PR 里的位置。失败就写失败，没验证就写「未验证」。
- 只能往文件末尾追加，已写的记录不改不删；写错了再追加一条说明。时间只能往后走。唯一的例外是脱敏修订（下一条）。
- 不写密钥、令牌、会话、联系方式（手机号、个人邮箱）、本机家目录路径、证件号和生产数据；需要时写「已本地核对，不公开」。不写用户原文：所有者在会话里说的话，不论是否加引号，都不写进仓库。批准写成摘要：角色、北京时间、渠道、范围，由记录人用自己的话写，例如「所有者 2026-10-30 07:43 在会话中批准：按 hotfix 发布某个版本」。为什么：原文常夹带密钥、联系方式和未公开的决定；`pnpm check:privacy` 与 `note.mjs check` 会拦住「原话」「所有者说」等标签后紧跟引号或冒号的写法。
- 已写的记录若含上面列出的内容，只能做脱敏修订：把敏感片段替换成统一标记 `[已脱敏]`，标记以外的字节一个不改，替换不跨行；修订可以在末尾追加新记录。`node scripts/note.mjs check --pr` 用 `isRedactionRevision` 核对修订前后的文件：只差这些替换，外加末尾追加，才放行，夹带别的改动一律按「只能追加」拦下。为什么这样做：审计要能看出改了哪一处、改了什么，只换敏感片段才做得到；整段删改或重写就是改写历史。
- 模块改了、文档里写的事实却没变时，在「做了什么」或「结果」里写一行 `文档核对：<文档路径> 不用改——<理由>`，文档同步检查会读它（[docs/README](../README.md)「文档跟着模块改」）。

阶段只能用下面这些：

| 阶段 | 什么时候记 |
|---|---|
| 开工 | 开发前，链路的第一条（`task.mjs start` 自动写） |
| 方案 | 定位结论和打算怎么改；大改动必记 |
| 开发 | 阶段性的改动完成、重要的中间结果 |
| 提交 | 每次本地提交：提交说明和跑过的检查 |
| 推送 | 推 task 分支 |
| PR | 开 PR 或改 PR 正文 |
| 审查 | 收到审查结论（谁审的、审的哪个 SHA、结论） |
| 返工 | 按审查或验收意见改了什么 |
| 合并 | PR 合进 stage，合并提交 SHA |
| 发布 | 打 rc 或正式 tag、部署运行号 |
| 验收 | 在哪个环境按哪几步看到了什么 |
| 阻塞 | 卡住了：缺授权、缺凭据、等别人 |
| 收尾 | 链路的最后一条（`task.mjs finish` 自动写），之后不能再记（只有 §6 里的一条历史例外） |

## §4 前后必须执行

- **开发前**：`node scripts/task.mjs start <issue> <slug>` 建分支和 worktree 时写下「开工」，没有开工记录不许改代码。启动时必须带身份（见 §5），缺了直接报错。
- **开发中**：每完成上表里的一步就记一条，至少包括每次提交、开 PR、收到审查结论、每轮返工。
- **合并前**：PR 的链路里必须已经有引用本 issue 的「开工」「提交」「PR」「审查」，并且这个 PR 新增了引用本 issue 的记录（§6 的 CI 检查会拦）。审查人在审查进行中先核对已有的开工、提交、PR 记录（可用 `node scripts/note.mjs check --pr --for-review`）；审查结论给出后，作者补齐 PR 描述并补一条「审查」记录（`docs(notes): …`），推送到 task 分支，CI 变绿后方可合并。
- **开发后**：合并、发布、验收在 task 分支之外发生，照样要记（会先暂存，见 §5）；`node scripts/task.mjs finish <issue>` 删 worktree 前写下「收尾」。链路以收尾结束才算完整。
- 委派子代理时，把身份和链路交代给它；子代理自己记，执行者写它自己。
- 本规范生效前已经开工、还没合并的 task：合并 stage 之后的第一次提交前补一条「开工」，「做了什么」写明原来的开工时间和「本规范生效前开工，补记」，之后照常记。时间就是补记的时刻，不往前改。

## §5 怎么写

```bash
export GEEK_NOTES_USER=alice
export GEEK_NOTES_BY="agent-claude-geek-main-08（Claude Code，claude-opus-5-5）"

node scripts/task.mjs start 91 agent_notes          # 写「开工」
node scripts/note.mjs add --stage 提交 --issue 91 \
  --title "规范、脚本、CI 检查一起提交" \
  --did "docs(docs): …；pnpm verify" --result "pnpm verify 通过（Tests 420 passed）" \
  [--next "…"] [--chain task/87/exam_docs]
node scripts/task.mjs finish 91                      # 写「收尾」
```

- 身份也可以用 `--user` / `--by` 传；两者都没有时拒绝写入。
- **记录落在哪**：当前 worktree 正在这条链路的 task 分支上时，直接写进这个 worktree 的 `notes/`，并重新生成 `notes/INDEX.md`，随下一次提交入库。别的情况（在 release worktree 里打 tag、在主工作区、给别的链路补记、`task.mjs finish` 写收尾）先暂存到主工作区的 `.claude/notes-pending/`（已在 `.gitignore`），下一个 `task.mjs start` 会把它并进新的 task worktree，也可以在任意 task worktree 里手动 `node scripts/note.mjs flush`。暂存的记录要随最近的一个 PR 入库，不能一直留在本机。
- 提交：记录和代码放在同一个提交里；开 PR、拿到审查结论后单独补的记录用 `docs(notes): <一句话>`。提交说明和提交作者邮箱同样受隐私门禁约束，规则见 [COMMITS](COMMITS.md)「隐私门禁」。
- 新 task 即使还没有提交，也直接写进它的 worktree。合并状态以 `origin/stage` 中是否已有该 task 的执行链路文件判定（普通合并、squash 合并一致），不能只看 HEAD 的祖先关系；「合并 / 发布 / 验收 / 收尾」始终先暂存。
- `node scripts/note.mjs index` 重新生成 `notes/INDEX.md`；`node scripts/note.mjs index --summary` 输出全部链路的一览表（负责人、链路、issue、执行者、条数、开工时间、最后一条）。

## §6 门禁

审查时 `check --pr --head` 必须给出 `task/<issue>/<slug>`；detached HEAD 下传 `HEAD`、提交 SHA 或未指定任务分支会报错，不能当作链路完整。显式 `--head stage` 保留 stage 进入 main 时不要求 task 链路的语义。

| 在哪 | 查什么 |
|---|---|
| `pnpm check`（`check:notes` → `node scripts/note.mjs check`） | 目录只能是 `<日期>/<用户名>/<链路>.md`；标题、负责人和目录一致；每条记录的标题、阶段和必填项；时间不倒退；每条链路第一条是「开工」、收尾之后没有记录；`notes/INDEX.md` 是最新的 |
| CI `branch-guard` 的「执行记录（notes/）」（task 分支进 stage 的 PR） | 上面全部，加上：这个 task 的链路存在；有引用本 issue 的「开工」「提交」「PR」「审查」；本次 PR 新增了引用本 issue 的记录；已有记录未被改写或删除（严格只追加） |
| CI `branch-guard` 的运行摘要（每次运行） | 把全部链路的一览表贴进 Actions 的运行摘要，stage 和 main 上随时能看到所有人的链路 |

检查不过就补记录，不许改检查脚本来换绿色，也不许补写没发生过的事。脚本只能核对格式和是否记了，记的内容是否属实由审查人对照提交、PR 和 CI 核对（[CODE-REVIEW](CODE-REVIEW.md)）。

### 链路顺序的历史例外

两条已经记下、不能改字节的历史记录，各经所有者批准只放过自己这一条。`scripts/note.mjs` 的 `CHAIN_ORDER_EXCEPTIONS` 是这张表，每条的五个字段（链路、文件、时刻、阶段、规则）全部相等才放过：

| 链路 | 记录 | 时刻（北京时间） | 阶段 | 规则 | 批准 |
|---|---|---|---|---|---|
| `task_276_forum_image_scan` | `notes/2026-10-24/crosery/task_276_forum_image_scan.md` | 2026-10-24 22:03:16 | 发布 | `after_closed`：收尾之后又记的那一条 | 所有者，范围只此一条（GitLab #298） |
| `task_308_stage_close` | `notes/2026-10-29/crosery/task_308_stage_close.md` | 2026-10-29 23:51:18 | 推送 | `first_entry`：链路第一条不是「开工」的那一条 | 所有者 2026-10-30 07:43 在会话中批准：清理 PR 与 issue，并完成 GitHub 与 GitLab 的同步（#308 收尾同步在其中），范围只此一条（#328） |

别的链路、同一链上的别的记录、之后新追加的任何记录仍然报错，`--pr` 模式的只追加核对不变。要加第三条例外，必须由所有者另行批准，并改这张表和本节。

## §7 与其它规范的关系

issue、PR 评论的格式见 [TRACKING](TRACKING.md)，PR 正文见 [PULL-REQUESTS](PULL-REQUESTS.md)，task 分支和 worktree 见 [BRANCHING](BRANCHING.md)。实现在 `scripts/note.mjs`，`scripts/task.mjs` 的 start / finish 调用它；测试在 `tests/tooling/notes.test.ts`。提交说明的内容与提交作者邮箱的隐私核对见 [COMMITS](COMMITS.md)。
