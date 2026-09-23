---
name: code-review
description: "geek_main 仓库级代码审查。当任何 MR/PR 要进入 stage 或 main、需要合并前自查，或用户说「审查这次改动 / review 这个 diff / 看看这个分支能不能合」时使用。"
---

# 代码审查（geek_main 仓库级）

规则正文归 [`docs/conventions/CODE-REVIEW.md`](../../../docs/conventions/CODE-REVIEW.md)：看什么、怎么判、写在哪，一律以它为准。本 skill 只补三样东西：审查入口与前置、逐项核对的**可执行命令**、审查记录模板。冲突时以规范文档为准，不在这里复制它的正文。

## 何时使用

- 任何要合入 `stage` 的 MR（含文档、脚本、配置）。
- 任何要合入 `main` 的操作（`main` 只收 `stage`，这次审查是对当下 `stage` 的第二道复核）。
- Dockerfile、compose、`.env` 契约、`deploy/remote/*.sh` 的变更，以及任何触及认证、授权、密钥、数据库 schema 的改动。
- 用户要求「审查这次改动 / review 这个 diff / 看看这个分支能不能合」。

不适用：只需要解释代码、写测试、修 bug 的请求——先把活干完，再走本审查。纯历史材料、注释错字这类改动不必逐项过清单，但结论仍要写进 MR（写「无需逐项审查 + 理由」）。

## 前置（缺一不可）

1. 确认分支与工作区：`git branch --show-current`、`git status --short`。不在 `task/<issue>/<slug>` 或 `stage` 上就停下来说明现状，不自行切换。
2. 读根 [`AGENTS.md`](../../../AGENTS.md) 的硬门禁，再读 [`docs/conventions/CODE-REVIEW.md`](../../../docs/conventions/CODE-REVIEW.md)（审查清单与结论定义）与 [`docs/conventions/BRANCHING.md`](../../../docs/conventions/BRANCHING.md)（分支不变量）。
3. 明确审查目标：合进 `stage` 还是 `main`、来自哪条分支、被审查的 commit SHA。
4. 被审查的 diff 没读完、验证证据没看到之前，不给结论。

## 取 diff（精确命令）

本地分支 / 已推送的分支：

```bash
git fetch origin
git branch --show-current
git diff --merge-base origin/stage...HEAD --stat   # 先看范围
git log --oneline --no-merges origin/stage..HEAD   # 提交信息是否合规
git diff --merge-base origin/stage...HEAD          # 完整 diff
git diff                                           # 未提交改动同样要算进来
git status --short
```

- 基线由目标分支决定：合进 `stage` 用 `origin/stage`，合进 `main` 用 `origin/main`。
- 必须用三点 `...`（对 merge-base 比较）。两点 diff 会把目标分支上别人的提交算进本次改动，结论直接失真。
- 基线解析不了或 diff 为空，在这里停下来说清楚，不要往下走。

MR/PR 场景（GitHub）：

```bash
gh pr view <N> --json number,title,baseRefName,headRefName,mergeStateStatus,files
gh pr diff <N>
gh pr checkout <N>   # 需要跑脚本或看完整仓库上下文时
```

- 先核对 `baseRefName`：base 写错（例如 task 分支直接以 `main` 为 base）本身就是阻塞项。
- 结论要写回 MR；`gh pr comment` 是对外可见动作，执行前先确认。

## 逐项核对的可执行动作

清单条目与严重度定义见 CODE-REVIEW.md；这里只给每项对应的命令与看什么。

1. **分支不变量**：`git merge-base --is-ancestor origin/main origin/stage` 必须成功；`git log --oneline origin/main..origin/stage` 用于确认 `stage` 领先方向；排查有没有任何 `task/**`、`dev/**` 指向 `main` 的路径；新分支名不得含 `-`（`node scripts/check-branch-invariants.mjs` 会对旧的 `dev-*`、`task/<issue>-<slug>` 告警）。
2. **是否直推 main**：MR 的目标分支、提交来源、CI 触发 ref 三处交叉验证；发现绕过 `stage` 写 `main` 的路径即阻塞。
3. **密钥是否入库**：`pnpm check:secrets` 只覆盖部分文本模式，**通过它不等于没有泄漏**，必须人眼过一遍 diff 中所有新增字符串（token、密码、会话 Cookie、SSH 私钥、`OAUTH_CLIENT_SECRET`/`SESSION_SECRET`/`ENCRYPTION_KEY`/`TURNSTILE_SECRET_KEY` 的真值）。
4. **`.env` 只允许非密值**：`deploy/env/.env.production`、`deploy/env/.env.preview` 里只许出现地址、端口、域名、路径、开关；密钥字段必须留空。字段增删要同步 `docs/ops/ENVIRONMENTS.md` 与 `deploy/environments.json`。
5. **Dockerfile 与 compose**：`dockerfile:` 是否仍指向 `app/<service>/Dockerfile`、构建上下文是否仍是仓库根、镜像 tag 语义（`<sha12>`）是否被改、健康检查是否还在、命名卷有没有被换成宿主目录。
6. **端口与卷隔离**：宿主回环 production `127.0.0.1:18100`(web)/`18101`(server 调试)、preview `18200`/`18201`，不得与宿主已占用端口（443/2568/3000/8080/8787）冲突；容器内 web 8080、server/forum 3000；两栈命名卷不得共享，也不得把命名卷换成宿主目录。
7. **测试与文档同步**：看真实验证证据（命令 + 输出），不是「本地通过」四个字；改动的 API、环境变量、命令、路径是否同步到 `docs/services/**`、`docs/architecture/API.md`、`docs/ops/ENVIRONMENTS.md`、根 `README.md`；`node scripts/docs-index.mjs --check` 与 `node scripts/check-docs.mjs` 是否通过。
8. **边界规则**：`pnpm check:boundaries`；`app/` 与 `docs/` 严格对齐（新增服务必须同时有 `docs/services/<svc>/README.md`）；站点互导、shared → 站点、路由模块互导、`lib` 反向依赖 `middleware`、论坛导入核心 React/Fastify 实现都是禁止方向。
9. **提交信息规范**：按 `docs/conventions/COMMITS.md` 的 `<type>(<scope>): <中文简述>` 检查 `git log`；一次提交一个可独立回滚的目的，不出现 `update`/`WIP`。
10. **旧模型残留**：在 diff 里扫 `next`、`feat/`/`fix/` 分支名、`release-*`/`prev-*` tag、「push `stage`/`main` 即部署」、systemd、`/opt/yzgc-admin`、宿主 3000 端口是否被当成现行模型（历史章节内须显式标注历史）。发布 tag 只能是 `vX.Y.Z-rc.N` / `vX.Y.Z`，部署只由它们触发（`docs/conventions/RELEASES.md`）。
11. **死分支**：`gh pr list --state merged --limit 20`、`git branch -r`、`git ls-remote --heads origin` 里不得残留已合并的 `task/**`，也不得有 `main`/`stage` 之外的长期分支。
12. **绕过 CI**：diff 里出现 `|| true`、`continue-on-error`、`[skip ci]`、删断言、改校验器、放宽既有校验收绿色即阻塞。
13. **危险操作**：数据库/数据目录变更是否有兼容与恢复路径，是否有删除数据、覆盖配置、顺带升级无关依赖、修改生产凭据，或「以测试通过代替人工验收」的表述。

## 输出格式

- 每条一行，四要素：`[严重度] 文件:行 — 理由（指向具体规则或真实后果）— 修法（可执行动作）`。
- 严重度只用 CODE-REVIEW.md 定义的三档：`阻塞`（破坏不变量、泄漏密钥、越权、数据不可恢复、把历史当现行规范——必须修完再合并）、`应修`（写明为何本次不修则可不阻塞）、`建议`。
- 结论只允许三种，逐字使用：**阻塞** / **有条件通过** / **通过**。不能写「基本没问题」「看起来可以」。
- **未验证项必须显式列出**（例如没跑 `pnpm test:e2e`、没在预发布验证、没验证回滚）。没验证就写「未验证」，不得写「应该没问题」。
- 审查记录必须写进 MR（描述或评论，不是聊天记录，也不写进被审查的提交本身），至少含：审查人、时间、被审查 commit SHA、逐条结论、最终结论。可直接用下面的模板：

```md
## 审查结论：有条件通过

- 审查人：<name> · 时间：<YYYY-MM-DD HH:mm>
- 被审查 commit：<sha> · 范围：`origin/stage...HEAD` · 目标分支：stage

[应修] `app/server/src/x.ts:42` — 理由… — 修法…
[建议] `app/web/y.ts:7` — 理由… — 修法…

未验证项：未运行 `pnpm test:e2e`；未做预发布人工验证。
```

## 边界

- 默认只读：不改文件、不提交、不推送、不合并、不部署。用户明确要求「按审查意见修」时才动手，改完重新出结论。
- 审查通过不等于发版授权，也不能代替 [RELEASES](../../../docs/conventions/RELEASES.md) 要求的人工试用与发布批准。
