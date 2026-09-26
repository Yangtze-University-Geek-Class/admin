# task/115/lifecycle_checks · crosery · 2026-09-26

负责人：crosery

## 15:38:44 +08:00 · 开工 · #115 · 从 origin/stage 28122511456d 建 task/115/lifecycle_checks

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 115 lifecycle_checks：建分支与 worktree .claude/worktrees/task-115，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 15:48:22 +08:00 · 方案 · #115 · 文档同步检查、issue 巡检自动关闭、worktree 推送前检查的做法

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：读完门禁文档与 task.mjs、note.mjs、check-docs.mjs、pre-push、ci.yml、issue-lifecycle.yml、branch-hygiene.yml；对照表放 docs/README.md 一节由 scripts/check-doc-sync.mjs 解析；按 git log -1 的提交时间比对模块与文档、工作区改动算作现在、服务文档头「更新：」不早于模块最后改动的北京日期、浅克隆直接报错；PR 另查 base...HEAD 动了模块必须动文档；task.mjs list --check 进 pre-push；每周巡检改成 scripts/issue-sweep.mjs：PR 已合并还开着的 issue 自动关闭并留关闭记录，14 天没动静的留超期记录
- 结果：现状：app/server、app/forum 比文档新（d3f3df7 固定基础镜像 digest），web 文档头日期落后；#112 已被关闭且没有 PR，它的六处不在本 issue 范围内
- 下一步：写脚本与测试，补三份服务文档

## 16:11:15 +08:00 · 开发 · #115 · 接手上一个子代理的未提交改动，核对三份服务文档落后的原因

- 执行者：agent-claude-geek-main-subagent-115（Claude Code 子代理）
- 做了什么：会话重启后接手：读 git diff 与新文件；git log dd93912..HEAD -- app/server、55a14a6..HEAD -- app/forum、329ad3d..HEAD -- app/web 找出让模块变新的提交：d3f3df7（三个 Dockerfile 的 FROM 按 digest 固定）、b3d3d94（论坛镜像的邮箱检查扩到整个产物的文本文件）；对照 app/*/Dockerfile 的 FROM 行与第 76-82 行断言核对文档改动属实
- 结果：server、forum 文档比模块旧（d3f3df7、b3d3d94 没改文档），web 文档头「更新：2026-09-25」早于 b95e3f2 的 2026-09-26；三份文档的补充内容与 Dockerfile 一致
- 下一步：先单独提交三份文档，再提交检查脚本
