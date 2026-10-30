# task/349/hotfix_close · crosery · 2026-10-30

负责人：crosery

## 22:02:32 +08:00 · 开工 · #349 · 从 gitlab/stage 3643fb149f3a 建 task/349/hotfix_close

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 349 hotfix_close：建分支与 worktree .claude/worktrees/task-349，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 22:17:50 +08:00 · 提交 · #349 · preview-parity 修复与门禁例外带回 GitLab

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：从搁置的 task/335/parity_upload_fix 取 260cbe8b 的两份文件（preview-parity.rb 改为复制到 runner 临时目录再上传，gitlab-cutover 测试加两条断言）；从 GitHub 3dadd29f 取 note.mjs、NOTES.md、privacy-exceptions.json；docs/changes/349.json。文档核对：docs/services/server/README.md 不用改——MR !90 只把 app/server/package.json 的 version 改回 0.1.1；文档核对：docs/services/web/README.md 不用改——同上，只改 app/web/package.json 的 version；文档核对：docs/services/console/README.md 不用改——同上，只改 app/console/package.json 的 version
- 结果：check-architecture 待关窗后复跑

## 22:18:09 +08:00 · 提交 · #349 · 部署文档核对

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：文档核对：docs/ops/DEPLOY.md 不用改——preview-parity 只改图片交给上传器的方式，部署步骤与入口不变；文档核对：docs/ops/ENVIRONMENTS.md 不用改——环境与变量不变；文档核对：docs/ops/CICD.md 不用改——工作流与 job 不变，MR !90 只登记 hotfix 窗口
- 结果：见下一次 check-doc-sync

## 22:18:32 +08:00 · 提交 · #349 · 服务文档核对

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：文档核对：docs/services/server/ 不用改——MR !90 只把 app/server/package.json 的 version 改回 0.1.1；文档核对：docs/services/web/ 不用改——只改 app/web/package.json 的 version；文档核对：docs/services/console/ 不用改——只改 app/console/package.json 的 version
- 结果：见 check-doc-sync

## 23:06:57 +08:00 · 提交 · #349 · 桶名改读 vars，关闭 #346 窗口

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：正式 deploy-hotfix 41070798501 全绿，但 build 的 STATIC_CDN_BASE 为空：桶名放在 secret 里，GitHub 把含同一字串的 CDN 地址从 cdn-plan 输出里打码丢掉，正式按同源构建。三个部署工作流改读 vars.STATIC_CDN_S3_BUCKET（已在环境 static-cdn 设好），文档跟着改；windows.json 关闭 #346 窗口并写入证据
- 结果：check-architecture、check-doc-sync 通过；gitlab-cutover 与 static-cdn-s3 测试 58 条通过

## 23:06:57 +08:00 · 审查 · #349 · 收尾自查

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：核对 diff：窗口关闭、三个工作流只换桶名来源、preview-parity 上传修复、首条例外与过期放行
- 结果：结论：通过
