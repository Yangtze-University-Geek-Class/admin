# task/101/readme_status · crosery · 2026-09-26

负责人：crosery

## 12:24:27 +08:00 · 开工 · #101 · 从 origin/stage e14fa0133700 建 task/101/readme_status

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 101 readme_status：建分支与 worktree .claude/worktrees/task-101，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 12:26:05 +08:00 · 提交 · #101 · README 中英文改成实际状态

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：docs(docs): 提示块改为「预发布与正式是两套一模一样的完整服务」、全站统一登录、部署不含样板数据、论坛还不能发帖；「已有 / 没有」表、本机命令注释、部署开关一句同步改；并入 rc.6/rc.7 发布与 #100 合并、收尾的暂存记录；pnpm check
- 结果：pnpm check 退出码 0；核对依据：两套 compose 与 env 模板只差名字、域名、端口、栈目录；预发布与正式 /auth/github 都 302 到 GitHub，预发布 /auth/me 返回 {"signed_in":false}，两边 /api/public/config 相同
