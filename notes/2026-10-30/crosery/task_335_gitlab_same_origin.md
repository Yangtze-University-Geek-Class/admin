# task/335/gitlab_same_origin · crosery · 2026-10-30

负责人：crosery

## 10:47:08 +08:00 · 开工 · #335 · 从 gitlab/stage 14e46e6d20f3 建 task/335/gitlab_same_origin

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 335 gitlab_same_origin：建分支与 worktree .claude/worktrees/task-335，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 12:33:30 +08:00 · 提交 · #335 · 57ec8fb0 OIDC 客户端钉住 sector

- 执行者：agent-claude-t335（Claude Code，claude-opus-5-5）
- 做了什么：oauth_clients 加 sector_id；oidc.js 加 client add --sector、add-redirect、remove-redirect；客户端元数据带 sector_identifier_uri；同步核对 GITLAB_OIDC_SECTOR；server 与 console 文档跟着改
- 结果：tests/server 的 oidc、gitlab-sync、competition-candidates 加 tests/console、tests/web 共 7 个文件：改前 5 个失败 182 个通过，改后 187 个全过；server、web、console 类型检查通过

## 12:33:30 +08:00 · 提交 · #335 · 71295502 正式 GitLab 搬到 /gitlab，仓库不再写子域名

- 执行者：agent-claude-t335（Claude Code，claude-opus-5-5）
- 做了什么：env 与 compose、production-path.py、cutover.sh 的 *-production-path、香港接收器 production-*、move-path.sh、gitlab-cutover 三个步骤、子域名登记门禁、中性值替换、同构清单 P-0014、docs/changes/335.json 与文档；文档核对：docs/services/web/ 不用改——只把 mock-api.ts 样板数据里的 GitLab 地址换成中性值，官网的接口、页面和链接逻辑都没变
- 结果：改前→改后：env-isolation 6 失败→1 失败（剩下的是 deploy/hotfix/windows.json 3 处超过登记的 1 处，基线 14e46e6d 就有）；deployment-environment 4→0；task-worktree 2→0；gitlab-cutover 7→0（31 个）；gitlab-preview 7→0（23 个）；gitlab-move-path 13→0（14 个）；install-host 1→0（12 个）。actionlint 与 shellcheck 通过；check-architecture、check-doc-sync（--base gitlab/stage）通过
- 下一步：交给 lead 审查；note check 被 notes/2026-10-29/crosery/task_308_stage_close.md 首条不是开工拦下（基线就有），env-isolation 被 windows.json 拦下，两项都不是本分支造成
