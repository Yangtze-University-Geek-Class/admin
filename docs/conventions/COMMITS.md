# Commit 提交规范

> Conventional Commits 结构，中文说明，一次提交一个可回滚目的。

状态：`current` · 更新：2026-09-13

## 格式

```text
<type>(<scope>): <中文简述>

为什么改；改变了什么；用什么命令验证。
```

首行不超过 72 字符，使用半角冒号，不加句末句号或 emoji。代码标识符和路径保持英文。type 为 `feat`、`fix`、`refactor`、`perf`、`docs`、`test`、`build`、`ci`、`chore`、`style`。`style` 只表示格式，不表示界面功能改动。

scope 使用 `portal`、`forum`、`admin`、`shared`、`server`、`auth`、`db`、`docs`、`deploy`、`tooling`、`deps`、`release`。按职责中心选择，不罗列全部文件。

例：`fix(forum): 防止重复删除回帖破坏统计计数`；`test(auth): 验证密码变更撤销旧会话`；`docs(tooling): 统一根目录验收入口`。

## 原子性与兼容性

一个提交对应一个可独立理解/回滚的逻辑目的。代码和其契约、测试、文档属于同一改动。机械搬迁和行为改变在条件允许时分开，但不能故意制造不可构建的中间状态。兼容性变更用 `!` 或 `BREAKING CHANGE:` 正文说明影响和迁移。

不使用 `update`、`fix bug`、`WIP` 等无信息量消息，不批量加入无关改动。旧提交不回写，不自动 squash 他人历史。Agent 不在没有明确授权时创建或推送提交。

## 提交不等于发版

Conventional Commits 只规定消息结构，不自动计算或推进本项目发布版本。`main`、人工验收、release-/prev- tag 和预发布 @SHA 的唯一约定见 [RELEASES](RELEASES.md)。禁止为了自动 changelog/semantic-release 而越过人工试用与批准。

依据：Conventional Commits 1.0.0 的消息结构；中文简述和 scope 词表是本项目约定，而不是该标准的语言要求。官方来源：https://www.conventionalcommits.org/en/v1.0.0/
