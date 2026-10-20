# task/237/sso_plan · crosery · 2026-10-20

负责人：crosery

## 01:00:07 +08:00 · 返工 · #237 · 统一资料：头像和昵称全站一套，方案改为 accepted

- 执行者：agent-notion-geek-handoff（Notion AI，接手 Codex PR 跟进）
- 做了什么：按所有者 2026-10-19 的要求补交付 4（统一资料）：ADR 加决策 10 与资料放哪的取舍；实施规格加个人资料页 /account/profile、统一资料规则、user_profiles DDL 与回填、接口与错误码、候选 4；新增草图 profile.webp，更新 account-desktop.webp；所有者要求合并 #242，ADR 与实施规格据此改为 accepted（未实施）。
- 结果：方案共四项交付、四个候选 issue；资料归账号，读取时取、不存快照，沿用论坛的昵称规则与头像管线，不加依赖。
- 下一步：pnpm check、提交推送、等 CI；更新 PR #242 正文后合并，确认 #237 关闭，执行 task finish 237。
