# task/252/issue_pr_skills · crosery · 2026-10-18

负责人：crosery

## 01:36:05 +08:00 · 返工 · #252 · 决定不合入两个技能，只保留 check-docs 的补洞

- 执行者：agent-claude-geek-main-252（Claude Code，claude-sonnet-5-5）
- 做了什么：对照实验（omp、opencode、codex 三个 harness，deepseek 与 gemini 家族，共 160 次）没有测出技能能提高遵循度，审查建议收窄；撤回 .agents/skills 下两个技能、.claude 与 .omp 的符号链接、ISSUES 与 PULL-REQUESTS 的指针，AGENTS.md 本来就不带导航；保留 check-docs.mjs 遍历全部技能目录
- 结果：check-docs 通过 272 个文档，docs-index 与 doc-sync 通过；PR 的范围缩小为 check-docs.mjs 与执行记录，#252 的技能验收条件不再适用，关闭时在 #252 留记录说明
