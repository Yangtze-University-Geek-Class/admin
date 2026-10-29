# task/308/duplicate_repair · crosery · 2026-10-30

负责人：crosery

## 01:37:54 +08:00 · 开工 · #308 · 正式同步提前建出的重复 GitLab 号修复

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：从 gitlab/main b57a3616 在 task-308 worktree 建 task/308/duplicate_repair（同一 #308 hotfix 窗口，窗口到 2026-11-04 13:03）。依据：gitlab-cutover sync-status（run 见 PR）核到正式同步 persisted_mode=on、48 名成员已映射；其中 6 人（github:59305952、34069…42、333767516、340657706、130495739、147501232）在 GitLab 上各有两个号：预发布同步的原号 10/8/9/7/4/5 与正式同步 10-29 15:43–16:18 建出的 42/59/45/28/13/31，主体迁移因此报冲突，签发者改接被挡住；IofStage（github:317592648）正式库没有账号。
- 结果：定修法：新增 cutover 步骤 repair-duplicates（默认演算），逐人核对后在 GitLab 解绑并封禁重复号，正式库 sub 与映射改回原号；停预发布写者前的主体演算把可最小补建的成员单独计数，解开「停写才能补建、补建前不让停写」的互锁。
- 下一步：实现、测试、文档，走 MR 合进 GitLab main 后镜像 GitHub main，再按 GITLAB.md 顺序执行改接

## 01:39:58 +08:00 · 提交 · #308 · 重复号修复步骤提交

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：提交 47b755ce：sync-control.mjs 新增 repairDuplicates 与 repair-duplicates 命令；cutover.sh 新增 repair-duplicates 步骤（演算只读挂载正式库，apply 先 systemctl start yzgc-backup@production 再读写挂载）；migrate-oidc-subjects.mjs 演算带 --provision-unmatched 时单独计「可最小补建」；stop-preview-sync 的前置演算带它；gitlab-cutover.yml 加选项；GITLAB.md 2a 与 CICD.md 表同步；docs/changes/308.json 改为本 MR 的声明。
- 结果：vitest tests/tooling/gitlab-sync-control.test.ts gitlab-cutover.test.ts oidc-subject-migration.test.ts：3 文件 64 用例通过；pnpm check 通过（文档同步、执行记录、密钥、目录、宏观对齐 #308 11 个文件、typecheck）。
