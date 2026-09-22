# services/

> 与 `app/` 一一对应的服务文档：每个服务一份 README（源码地图、契约、运行、验证、限制）。

状态：`current` · 更新：2026-09-23

`app/<service>` 下每一个可独立构建/部署的服务，在 `docs/services/<service>/` 下有同名的 `README.md`；模块细节放同目录子文档（如 web 的 `portal.md`、`admin.md`、`shared.md`）。**新增服务 = 新增 `app/<service>` + 新增 `docs/services/<service>/README.md`**，两处缺一即视为未完成。

| 服务 | 源码 | 文档 | 镜像 |
|---|---|---|---|
| server | `app/server/` | [server](server/README.md) | `yzgc/server:<tag>` |
| web | `app/web/` | [web](web/README.md)、[portal](web/portal.md)、[admin](web/admin.md)、[shared](web/shared.md) | `yzgc/web:<tag>` |
| forum | `app/forum/` | [forum](forum/README.md) | `yzgc/forum:<tag>` |

服务边界、依赖方向与契约变更流程见 [模块化开发规范](../conventions/MODULAR-DEVELOPMENT.md)；运行环境与部署入口见 [DEPLOY](../ops/DEPLOY.md) 与 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)。
