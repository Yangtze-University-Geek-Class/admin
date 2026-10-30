# Commit 提交规范

> Conventional Commits 结构，中文说明，一次提交一个可回滚目的。

状态：`current` · 更新：2026-10-30

## 格式

```text
<type>(<scope>): <中文简述>

为什么改；改变了什么；用什么命令验证。
```

首行不超过 72 字符，使用半角冒号，不加句末句号或 emoji。代码标识符和路径保持英文。type 为 `feat`、`fix`、`refactor`、`perf`、`docs`、`test`、`build`、`ci`、`chore`、`style`。`style` 只表示格式，不表示界面功能改动。

scope 使用 `portal`、`forum`、`admin`、`console`、`shared`、`server`、`cli`、`auth`、`db`、`docs`、`notes`、`deploy`、`tooling`、`deps`、`release`。按职责中心选择，不罗列全部文件：`portal`/`admin`/`shared` 属于 `app/web` 内部模块，`console` 指 `app/console`（控制台迁出 `app/web` 之后的提交；更早的控制台提交用的是 `admin`），`forum` 指 `app/forum`，`server` 指 `app/server`，`cli` 指 `app/cli`（geek 命令行，#277），`docs`/`deploy`/`tooling` 分别指文档、部署模板与根脚本，`notes` 指只补 `notes/` 执行记录的提交（`docs(notes): …`）。

例：`fix(forum): 防止重复删除回帖破坏统计计数`；`test(auth): 验证密码变更撤销旧会话`；`docs(tooling): 统一根目录验收入口`。

## 原子性与兼容性

一个提交对应一个可独立理解/回滚的逻辑目的。代码和其契约、测试、文档属于同一改动。机械搬迁和行为改变在条件允许时分开，但不能故意制造不可构建的中间状态。兼容性变更用 `!` 或 `BREAKING CHANGE:` 正文说明影响和迁移。

不使用 `update`、`fix bug`、`WIP` 等无信息量消息，不批量加入无关改动。旧提交不回写，不自动 squash 他人历史。Agent 不在没有明确授权时创建或推送提交。

## 隐私门禁

PR 进入 stage 前，CI 的 `branch-guard` 对 PR 范围内的每条提交核对（`node scripts/check-privacy.mjs --commits <base>..<head>`）：

- **说明**：不写用户原文，也不写「原话」「所有者说」一类引语标签后接冒号或引号的形态；不写所有者的账号名、本机家目录路径、手机号、令牌、证件号或个人邮箱。批准写成摘要：角色、北京时间、渠道、范围，由写的人用自己的话说。
- **作者与提交者邮箱**：只能是 GitHub 的 `<id>+<用户名>@users.noreply.github.com`、GitLab 的 `<用户名>@noreply.<站点>`、角色地址（`notify`、`ci`、`bot` 等，词表见脚本的 `ROLE_LOCALS`）或占位域名（`*.test`、`example.*`）。本机 `git config user.email` 设成 noreply 地址，不用工作邮箱。

- **登记放行**：文件门禁（`check:privacy`）对「个人邮箱」与「用户原话形态」逐条放行，登记在 `scripts/privacy-exceptions.json`：每条写「文件 + 精确值」或「文件 + 整行内容的摘要」，理由必写，只存摘要；不按目录整体豁免，登记过但已经不再命中的条目让门禁失败。提交说明不在登记范围内。

门禁只报提交号与类别，不回显命中的内容。尚未推送的提交命中了，改说明或改身份后重做；已经推送进远端的历史不改写（不 force-push、不 rebase 别人已推送的提交）。已有的历史命中怎么处理由所有者决定，PR 里要列出这些提交和处理结论。

## 提交不等于发版

Conventional Commits 只规定消息结构，不自动计算或推进本项目发布版本。分支模型（`main`/`stage`/`task/<issue>/<slug>`/`dev/<username>`）、人工验收与版本展示的唯一约定见 [BRANCHING](BRANCHING.md) 与 [RELEASES](RELEASES.md)。禁止为了自动 changelog/semantic-release 而越过人工试用与批准，也禁止把 `feat`/`fix` 当作自动升号或自动部署的依据。

依据：Conventional Commits 1.0.0 的消息结构；中文简述和 scope 词表是本项目约定，而不是该标准的语言要求。官方来源：https://www.conventionalcommits.org/en/v1.0.0/
