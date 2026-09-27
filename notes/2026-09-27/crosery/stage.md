# stage · crosery · 2026-09-27

负责人：crosery

## 04:40:32 +08:00 · 发布 · #162 · v0.1.0-rc.11 部署预发布

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：在 stage 的 4fd2a27（PR #163 合并提交）打附注 tag v0.1.0-rc.11 并推送；Deploy Preview 运行 36269151331：plan、cdn-plan、build、cdn-upload、deploy 全部 success（20:20–20:28 UTC）
- 结果：https://prev.yangtzeu.work/release.json 为 0.1.0-rc.11@4fd2a27e9f4a
- 下一步：ego 里按 PR #163 人工验收步骤验收

## 04:40:32 +08:00 · 验收 · #162 · rc.11 预发布验收 #162

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：ego-browser（TaskSpace 242），Crosery 登录，测试话题 t1002；挡掉 */api/forum/* 模拟服务端拒绝（另核对挡掉的请求不到服务端）。桌面与手机宽度看回复被拒；桌面看书签、置顶、关闭被拒与在线成功提示
- 结果：通过：回复被拒后提示在顶部居中（10004 高于抽屉 10003，elementFromPoint 取到提示），抽屉按钮可点，手机无横向滚动；书签、置顶、关闭被拒只出现失败提示；在线成功提示在请求结束后出现且状态正确，数据复原（书签 p10004，置顶 t9、t73，无关闭话题，t1002 仍 10 帖）。未查清：第一次跑时一次在线书签点击未记录到提示，重跑两次未复现。结果贴在 PR #163 评论 issuecomment-5849698284
- 下一步：动画顺滑度要在前台真实浏览器看；矮屏与游客回复框没看

## 08:45:07 +08:00 · 发布 · #164 · v0.1.0-rc.12 部署预发布

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：task.mjs finish 164 之后（pre-push 钩子要求先清理），在 stage 的 f0333b8（PR #165 合并提交）打附注 tag v0.1.0-rc.12 并推送；Deploy Preview 运行 36282826732 全部 success（00:32–00:42 UTC）
- 结果：https://prev.yangtzeu.work/release.json 为 0.1.0-rc.12@f0333b81115f
- 下一步：ego 里用失效的预发布登录验收 #164

## 08:45:07 +08:00 · 验收 · #164 · rc.12 预发布验收 #164

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：ego-browser（TaskSpace 250），用 ego 里令牌已被收回的预发布登录（rc.12 上线前没用它打开过预发布）打开 /forum/，再刷新，再开 /console；截图借 PR #165 评论框上传取地址后清空评论框
- 结果：通过：/api/forum/state 先 401 再按游客 200，没有「论坛服务暂时连不上」，一条带登录的「登录已失效」提示，右上角「用 GitHub 登录」；sid 被服务端清掉，/auth/me 回 signed_in false；刷新后不再提示；/console 跳到 /signin?return_to=/console。结果贴在 PR #165 评论。未验证：预发布上重新登录、两个标签页与写操作（只在本机 harness 验过）、目标机审计行、令牌被收回的原因
- 下一步：所有者在自己的浏览器里点登录重新授权；#166 登录跳转丢草稿
