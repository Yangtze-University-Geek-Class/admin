# stage · crosery · 2026-09-26

负责人：crosery

## 10:40:02 +08:00 · 发布 · #77 · 打 v0.1.0-rc.6 发预发布（宣传片 #77、一次性部署 runner #97）

- 执行者：agent-claude-geek-main-08（Claude Code，claude-opus-5-5）
- 做了什么：所有者授权持续发预发布（修好就发）；stage 63fa3e5 的 CI 36212068354 通过后 git tag -a v0.1.0-rc.6 63fa3e5 并推送；部署首次跑在一次性 runner 上
- 结果：tag 对象 6548d7b，指向 63fa3e5c2733；pre-push 发布 tag 规则通过；Deploy Preview 运行 36212370824，plan 在 ydeploy-0926100542-88b1 上开始
- 下一步：部署成功后装预发布宿主 nginx 新模板（CSP），核对 release.json 与宣传片
