# stage · crosery · 2026-10-27

负责人：crosery

## 02:15:35 +08:00 · 方案 · #296 · 发布正式论坛当前版本使用说明

- 执行者：agent-claude-completion-5a（Claude Code）
- 做了什么：已在GitLab建立#296；通过正式GitHub OAuth完成所有者真实登录，核对正式0.1.0论坛及控制台实际导航与置顶接口；只新增内容并置顶入口，不改旧帖或服务版本。
- 结果：正式论坛无使用说明入口；当前控制台仍为旧称号与GitHub组织模型，正文将明确与预发布新功能的区别。

## 02:25:17 +08:00 · 验收 · #296 · 正式说明总入口已发布置顶并完成真实浏览器核对

- 执行者：agent-claude-completion-5a（Claude Code）
- 做了什么：以真实所有者会话发布t1012并置顶；GET匿名state核对正文可读；Ego 1440与390两尺寸截图人工查看，手机同轮模拟并刷新后几何无越界；Markdown及截图归档GitLab#296并留关闭记录。
- 结果：POST201、pin200、pinned=true；原3置顶保持。1总入口10章节，手机inner/client/scroll=390，越界0。GitLab#296已关闭；不代表新应用版本已验收或已发布。

## 03:52:32 +08:00 · 验收 · #271 · 准备修复版真实只读身份对账

- 执行者：agent-claude-completion-5a（Claude Code）
- 做了什么：在独立容器中挂载预发布数据卷为只读、SQLite readonly，只允许GitLab用户详情GET；不启动应用、迁移、后台循环或写入接口，不输出账号与凭据
- 结果：隔离脚本已审阅，尚未执行真实只读核验；原线上栈与同步模式保持不变

## 03:54:18 +08:00 · 验收 · #271 · 修复版真实只读身份映射两轮通过

- 执行者：agent-claude-completion-5a（Claude Code）
- 做了什么：独立Node22容器读取只读数据卷与readonly SQLite，真实GET核验已存在的GitLab OIDC映射；禁止所有写方法、审计、会话签发与头像请求
- 结果：每轮7权威账号、5映射、5身份匹配、0错误；10次真实GET、0禁止操作调用。两轮均发现1有效误封、拟解封1、拟封禁0；未修改线上状态，不冒充已恢复登录

## 16:24:26 +08:00 · 推送 · #270 · 双仓同步：GitLab 的 v0.1.1-rc.21 到 rc.25 五个历史 tag 一次推到 GitHub

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：所有者 2026-10-27 16:08 指示[已脱敏]。在临时克隆（stage=02cb751c，core.hooksPath=.githooks）里：先把 GitHub 变量 DEPLOY_PREVIEW_ENABLED、DEPLOY_PRODUCTION_ENABLED 由 enabled 改成 disabled，再一次推 v0.1.1-rc.21 到 rc.25 共 5 个 tag（一次超过 3 个 tag，GitHub 不产生 push 事件），最后把两个变量恢复为 enabled。
- 结果：git ls-remote --tags 两侧 v0.1.1-rc.* 各 39 行，diff 为空；推送后 gh run list 没有新增 workflow run，deployments 最新仍是 2026-10-19；两个变量已恢复 enabled。GitHub 提示 release-tags-immutable 的创建限制被管理员绕过。没有创建、移动或删除任何 tag，只补推了 GitLab 已有的 5 个。

## 16:24:26 +08:00 · 阻塞 · #270 · GitHub stage 快进被分支保护挡住，等所有者裁决

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：核对 GitHub stage 保护：enforce_admins=true，要求 PR，必需检查 architecture-alignment、pr-contract、verify，strict，不允许强推。verify 依赖 core，而 core 的 pnpm check 在 stage 上因 K10（notes/2026-10-24/crosery/task_276_forum_image_scan.md:47 收尾后继续记录）与 docs/INDEX.md 过期一行而失败。
- 结果：GitHub stage 仍在 4beda55e，落后 GitLab stage 02cb751c 共 473 个提交，没有自己独有的提交，可快进；未改任何保护设置，未绕过。需要所有者在两条路里选一：临时关闭 enforce_admins 后快进再恢复，或先对 K10 做治理裁决再走 PR。

## 21:50:54 +08:00 · 推送 · #270 · 所有者批准后，GitHub stage 两次临时关闭 enforce_admins 快进并立即恢复

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：所有者 2026-10-27 21:4x 批准：[已脱敏]。在临时克隆里（stage 由 gitlab/stage 建出，.githooks 开启）先 DELETE enforce_admins，快进推送 stage，再 POST 恢复；共两次：02cb751c（4beda55e 之后）与合并 !34 后的 74b6d64a。脚本用 trap 保证无论推送成败都会恢复。
- 结果：两次推送都是快进、没有强推；每次结束后 enforce_admins=true，必需检查 architecture-alignment、pr-contract (PR 正文契约)、verify (required check)、strict、禁止强推与改前逐项相同；两侧 stage 都是 74b6d64adee7、main 都是 61da3fea76f6、v0.1.1-rc.* 各 39 个 tag 相同；只触发 ci.yml，没有部署 workflow。上一条阻塞记录已解除。GitHub stage 上 CI 会因历史 K10 与旧 docs/INDEX.md 失败，不是本次推送引入。
