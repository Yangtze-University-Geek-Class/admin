# task/145/forum_write_delta · crosery · 2026-09-27

负责人：crosery

## 00:16:15 +08:00 · 方案 · #145 · 写接口只回改动，论坛的写入全部先显示再发请求

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：先在本机量改前：限速 300 ms RTT、60 KB/s 下每种写入从点击到界面变化 1167–1474 ms，写接口回答与 /state 同为约 50KB gzip，服务端处理 1.4–2.3 ms，游客 PoW d=3 中位数 12 ms；定方案：服务端回 { changes, viewer, guestPolicy }，客户端按编号就地合并，每种写入按 key 先改本地、后台发请求、失败写回并提示；首屏去掉正文拆到 #156
- 结果：PoW 不是瓶颈，不改难度；时间都花在下载整份状态上

## 00:16:58 +08:00 · 提交 · #145 · 服务端写接口只回改动（288c5b8）

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：forum-store 加 changes()，viewer.ts 的 forumChanges 按 /state 的可见性取记录，写路由回 { changes, viewer, guestPolicy }；API、server README、data-model 同步
- 结果：tests/server/forum.test.ts 51 条通过，变异 M1–M6 都被测试抓到；写接口回答 0.8KB（gzip 0.5KB），处理 0.3–0.8 ms

## 00:16:58 +08:00 · 提交 · #145 · 论坛写入先显示再发请求（37c82a2）

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：forum-server 用 steer 按 key 管每种写入：先改本地、后台发请求、同一 key 只一个在路上、失败写回确认值并提示；applyChanges 按编号就地合并；回复用 pending: 编号先显示；新增 forum-optimistic、forum-changes 测试，likes.test.ts 的桩回答换成新形状
- 结果：forum check 通过（26 个文件、524 条）；客户端变异 C1–C11 都被测试抓到；限速下点击到界面变化 0–103 ms（改前 1167–1474 ms）

## 00:27:45 +08:00 · PR · #145 · 开 PR #157，本机量改后，拆出首屏 issue #156

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：本机限速 300 ms RTT、60 KB/s 用 ego-browser 量改后：点击到页面变化 0–103 ms（发话题仍等服务端 356 ms），写入回答 0.7–1.0KB（点赞带回整条帖子 14KB）；截了桌面与手机的回复截图；开 #156 跟进首屏正文；开 PR #157 到 stage
- 结果：github.com 从本机连不上（curl 与浏览器都超时），截图还没传上去，pr-contract 的验收证据一项暂时不过；其余本地检查通过
- 下一步：网络恢复后在 GitHub 编辑框上传 4 张截图补进 PR，等独立审查
