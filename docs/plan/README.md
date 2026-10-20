# plan/

> 计划与现状盘点，**有保质期**。落地后应删除或压缩成结论，不要长期堆积。

状态：`current`（目录说明）· 更新：2026-10-20

| 文件 | 性质 | 状态 |
|---|---|---|
| [`UNIFIED-LOGIN.md`](./UNIFIED-LOGIN.md) | 方案：统一登录的账号、登录页、个人资料、接口、表与跨业务对齐（含方案草图） | `accepted`（#237，未实施） |
| [`REFACTOR.md`](./REFACTOR.md) | 盘点：拆分前旧路径、页面清单、API 全表、共享面 | `historical`（`next` 分支时代，含 `.en.md` 概要） |
| [`WEB-SPLIT.md`](./WEB-SPLIT.md) | 方案：三端拆分的目标结构、边界规则、执行计划 | `historical`（已执行，记录当时决策） |
| [`CONSOLE-PERMISSION-TREE.md`](./CONSOLE-PERMISSION-TREE.md) | 结论：控制台只读权限树，当前契约迁回 console 服务文档 | `historical`（#176） |
| [`COMPETITION-APP.md`](./COMPETITION-APP.md) | 方案：比赛应用的报名、组队与我的参赛（含方案草图） | `accepted`（#239，未实施） |

`REFACTOR.md` 与 `WEB-SPLIT.md` 是重构期间的工作文档，不是长期依据。其中的旧路径、分支名（`next`）、部署模型和完成声明只作追溯：稳定下来的设计已迁到 [architecture/](../architecture/ARCHITECTURE.md) 与 [services/](../services/README.md)，分支与发布模型以 [BRANCHING](../conventions/BRANCHING.md)、[RELEASES](../conventions/RELEASES.md) 为准。权限树计划已压缩为实施结论，实时契约见 [console 服务合同](../services/console/README.md#只读权限树)。`COMPETITION-APP.md` 是 #239 已采纳、尚未实施的方案，参赛者按 ADR-0005 的极客班统一账号识别；落地后压缩为实施结论，现行契约迁回 [services/](../services/README.md)。
