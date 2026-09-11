# ops/

> 运维与使用：照着做就能跑的操作手册。

| 文件 | 什么时候读 |
|---|---|
| [`DEPLOY.md`](./DEPLOY.md) | 部署、回滚、改 nginx / systemd / 证书、排查线上故障之前 |
| [`USAGE.md`](./USAGE.md) | 需要确认某个功能的预期行为，或改用户可见功能之前 |

`DEPLOY.md` 含完整的部署 runbook 与故障排查表。**部署由人执行，AI 不得自行部署**（见 `CONTRIBUTING.md` §5）。

`USAGE.md` 按角色（admin / member / 外部访客）组织，改功能时对照它确认预期行为有没有变。
