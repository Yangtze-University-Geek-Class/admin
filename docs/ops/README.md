# ops/

> 运维与使用：照着做就能跑的操作手册。

状态：`current` · 更新：2026-09-23

| 文件 | 什么时候读 |
|---|---|
| [`DEPLOY.md`](./DEPLOY.md) | 部署、回滚、改 nginx / compose / 证书、排查线上故障之前（含 systemd 旧模型的历史章节） |
| [`ENVIRONMENTS.md`](./ENVIRONMENTS.md) | 改 `.env`、端口、域名、密钥注入或 DNS/TLS 前置之前 |
| [`CICD.md`](./CICD.md) | 改工作流、配 GitHub Environment / secrets / vars、开部署开关之前 |
| [`ENVIRONMENT.md`](./ENVIRONMENT.md) | 本机开发要连真实后端时，填写自己的 `.env` 之前 |
| [`LOCAL-PREVIEW.md`](./LOCAL-PREVIEW.md) | 本机启动核心预览与论坛之前 |
| [`TUFF-FORUM.md`](./TUFF-FORUM.md) | 运行/维护 `app/forum` 或选择论坛工具链之前 |
| [`FORUM-DATA-CAPTURE.md`](./FORUM-DATA-CAPTURE.md) | 查阅极客班论坛原始备份与只读投影的来源、范围与禁止操作之前 |
| [`RELEASE-ACCEPTANCE-TEMPLATE.md`](./RELEASE-ACCEPTANCE-TEMPLATE.md) | 要做人工验收记录时（空白模板，验收人填） |
| [`USAGE.md`](./USAGE.md) | 需要确认某个功能的预期行为，或改用户可见功能之前 |

`DEPLOY.md` 含完整的部署与回滚 runbook。**部署由人执行，AI 不得自行部署**（授权边界见 [PROJECT](../conventions/PROJECT.md) 与 [AGENT-START](../conventions/AGENT-START.md)）。`USAGE.md` 按角色组织，改功能时对照它确认预期行为有没有变。
