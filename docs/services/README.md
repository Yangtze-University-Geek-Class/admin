# services/

> 与 `app/` 一一对应的服务文档：每个服务一份 README（源码地图、契约、运行、验证、限制）。

状态：`current` · 更新：2026-10-18

`app/<service>` 下每个源码应用，在 `docs/services/<service>/` 下有同名的 `README.md`；模块细节放同目录子文档（如 web 的 `portal.md`、`shared.md`）。**新增服务 = 新增 `app/<service>` + 新增 `docs/services/<service>/README.md`**，两处缺一即视为未完成。

| 服务 | 源码 | 文档 | 镜像 |
|---|---|---|---|
| server | `app/server/` | [server](server/README.md) | `yzgc-<environment>/server:<sha12>` |
| web | `app/web/` | [web](web/README.md)、[portal](web/portal.md)、[shared](web/shared.md)、[admin（已迁出）](web/admin.md) | `yzgc-<environment>/web:<sha12>` |
| console | `app/console/` | [console](console/README.md) | 产物随 `yzgc-<environment>/web:<sha12>` 发布 |
| forum | `app/forum/` | [forum](forum/README.md) | `yzgc-<environment>/forum:<sha12>` |

服务边界、依赖方向与契约变更流程见 [模块化开发规范](../conventions/MODULAR-DEVELOPMENT.md)；运行环境与部署入口见 [DEPLOY](../ops/DEPLOY.md) 与 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)。

源码应用与运行单元不等同：控制台独立构建，但产物随 web 镜像交付。跨应用的业务、接口、数据和能力关系从[项目目录](../architecture/catalog/README.md)进入；生成物不取代服务合同中的业务规则。
