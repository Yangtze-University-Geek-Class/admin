# geek_main

长江大学极客班的统一项目入口。现有产品代码名为 `yzgc-admin`；保留 `@yzgc/web`、`@yzgc/server` 包名，以避免无收益的接口改名。

严格 monorepo：`app/server`（Fastify + SQLite 核心后端）、`app/web`（portal + admin，React/Vite）、`app/forum`（直接采用的 MIT 许可 Tuff Forum 原代码，Nuxt/Vue/TuffEx，独立工具链与锁文件）。旧 React/Fastify 论坛已退出活动代码和构建，旧业务数据库不删除、不自动导入。

**当前论坛前端不包含真实后端或认证。** 本机发现私有快照目录时只读显示极客班论坛归档（无登录、不可写）；否则为上游示例，示例身份不是 GitHub 登录，内容只保存于当前浏览器。公开宣传页 → 登录后内部 Hub → 论坛/组织管理/扩展服务是目标结构；统一内部认证、服务接入和 3D Hub 尚未落地，不能把这次原仓接入称为完整生产社区。

## 从哪里开始

| 需要做什么 | 入口 |
|---|---|
| 阅读全部规范与 app ↔ docs ↔ 规范地图 | [docs/README.md](docs/README.md) |
| Agent 接手项目：先确认分支，再读规范 | [AGENTS.md](AGENTS.md)、[AGENT-START](docs/conventions/AGENT-START.md) |
| 确认分支模型与不变量 | [BRANCHING](docs/conventions/BRANCHING.md) |
| 审查 diff / 开 MR 前 | [CODE-REVIEW](docs/conventions/CODE-REVIEW.md)、[PULL-REQUESTS](docs/conventions/PULL-REQUESTS.md) |
| 发布与人工验收（打 tag 发版：`vX.Y.Z-rc.N` 预发布，`vX.Y.Z` 正式） | [RELEASES](docs/conventions/RELEASES.md) |
| 了解服务边界与源码位置 | [server](docs/services/server/README.md)、[web](docs/services/web/README.md)、[forum](docs/services/forum/README.md) |
| 了解真实架构与数据归属 | [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) |
| 了解实际技术栈，不混淆升级提议 | [STACK.md](docs/design/STACK.md) |
| 操作部署环境（两套 Docker 栈） | [DEPLOY.md](docs/ops/DEPLOY.md)、[ENVIRONMENTS](docs/ops/ENVIRONMENTS.md) |
| 查 CI/CD 工作流与部署开关 | [CICD](docs/ops/CICD.md) |
| 本机启动核心预览和原仓论坛 | [LOCAL-PREVIEW.md](docs/ops/LOCAL-PREVIEW.md)、[TUFF-FORUM.md](docs/ops/TUFF-FORUM.md) |
| 已拉取的论坛原始数据与本地核验 | [FORUM-DATA-CAPTURE](docs/ops/FORUM-DATA-CAPTURE.md) |

## 目录边界

```text
geek_main/
  AGENTS.md                          唯一 agent 入口（硬门禁 + 任务映射）
  app/
    server/                          @yzgc/server，Fastify + SQLite（含 Dockerfile）
    web/                             @yzgc/web，Vite 的 portal/admin 两端 + shared（含 Dockerfile）
    forum/                           @yzgc/forum，Tuff Forum 原仓，独立工具链/锁文件（含 Dockerfile）
  deploy/
    env/.env.production|preview      入库配置模板：地址端口域名写真实值，密钥留空
    compose/                         两套栈的 compose 文件
    nginx/                           宿主 nginx server block（TLS 由宿主机终止）
    remote/                          目标机部署与回滚脚本
    environments.json                环境身份契约（域名、GitHub environment）
  data/                              本地运行数据（gitignore）
  docs/                              全部规范、服务合同、架构、运维与决策
  scripts/                           统一检查、文档生成与发布规划
  tests/                             隔离回归（vitest + playwright）
```

## 分支

长期分支只有两条：`main`（正式 = 稳定版，只能由 `stage` 合入）与 `stage`（预发布 = 动态版）。开发从 `stage` 拉 `task/<issue>/<slug>`，MR 合并后**立即删除**（`branch-hygiene.yml` 自动完成这一步，残留分支每周巡检告警）；`dev/<github-username>` 是个人自由分支（分支名一律不用 `-`，只用 `/` 分层），不部署、也不作为进入 `stage` 的凭据。**任何操作前先确认当前分支**：`git branch --show-current`。完整规则（含两条不变量）见 [BRANCHING](docs/conventions/BRANCHING.md)。

## 开发与验收

核心包使用 `.nvmrc` 指定的 Node 22（最低 22.13）和 pnpm 9.15.9；论坛按原仓使用 Node ≥26 和 pnpm 11.24.0。根 `forum:*` 命令选择独立工具链，不将论坛加入旧 pnpm 9 依赖解析。新环境配置见 TUFF-FORUM；本机已准备两套运行时。切换 Node 后不能复用另一 ABI 的 SQLite 二进制。

```bash
pnpm install --frozen-lockfile
pnpm dev:web        # 官网只读 mock 预览；不需要 OAuth 或业务数据库
pnpm dev:console    # 极客班控制台（app/console，Vue + Tuffex），默认只读样板数据
pnpm dev            # 前后端开发；需要人工填写本机专用 .env
pnpm check          # 运行时、环境契约、边界、文档和类型检查（含控制台 vue-tsc）
pnpm check:docs     # 文档索引与相对链接
pnpm test           # 真实应用路由、隔离 SQLite、模拟外部服务
pnpm build          # 核心 portal、控制台与 Fastify 构建
pnpm forum:install  # 论坛 frozen-lockfile 独立安装
pnpm forum:check    # 原仓类型、Lint、样式约束及单测
pnpm forum:generate # 原仓 Nuxt 静态产物
pnpm verify         # 核心 check/test/build + 论坛 check/generate
pnpm test:e2e       # 官网与控制台浏览器验证
pnpm forum:verify   # 原仓 CDP 验收及路由烟测
pnpm preview:local  # 核心 5173/3000 + 独立论坛 3456
```

官网在 `http://127.0.0.1:5173/sites/portal/`，控制台在 `http://127.0.0.1:5186/console`，论坛为 `http://127.0.0.1:3456/`。旧论坛页面入口转到 `app/forum` 的新论坛首页，不猜测旧帖子 ID 映射。核心 mock 是只读；`pnpm forum:start` 在本机发现 `.tools/forum-runtime/` 下的只读快照时显示极客班论坛归档（无登录、不可写、不写 localStorage），`GEEK_FORUM_SOURCE=demo` 回到原仓示例交互；两种模式界面都明确提醒其并非真实认证或跨设备存储，详见 [TUFF-FORUM](docs/ops/TUFF-FORUM.md)。

真实开发环境参照 [本地环境模板](docs/ops/ENVIRONMENT.md) 由操作者填写，不在仓库提交密钥，不连接生产数据库做测试。常规测试只使用内存数据库及临时目录，不触发 GitHub、邮件或部署操作。生产部署需单独授权和发布验证，不能把本地构建通过视为线上验收。

## 部署入口

线上是**同机两套 Docker 栈**，由宿主 nginx 做 TLS 终止：

| 环境 | 发布 tag（提交所在分支） | 栈根 | 入口 | web 宿主端口 |
|---|---|---|---|---|
| production | `vX.Y.Z`（`main`） | `/opt/yzgc/production` | `https://yangtzeu.work` | `127.0.0.1:18100` |
| preview | `vX.Y.Z-rc.N`（`stage`） | `/opt/yzgc/preview` | `https://prev.yangtzeu.work` | `127.0.0.1:18200` |

镜像按环境分仓库：`yzgc-production/{server,web,forum}:<sha12>` 与 `yzgc-preview/{server,web,forum}:<sha12>`（两套栈共用一个 Docker 守护进程，同一提交的两次构建不能共用镜像名），镜像 tag 写入 `<栈根>/.env.<environment>` 的 `IMAGE_TAG`；回滚就是切回更早发布 tag 的镜像。字段契约与密钥注入规则见 [ENVIRONMENTS](docs/ops/ENVIRONMENTS.md)，工作流与部署开关（默认关闭）见 [CICD](docs/ops/CICD.md)。推送分支不部署：在 `stage` 的提交上打 `vX.Y.Z-rc.N` 发预发布，所有者验收通过后在同一提交上打 `vX.Y.Z` 发正式；打 tag 需要所有者授权（见 [RELEASES](docs/conventions/RELEASES.md)）。

## 文档维护

规范统一在 `docs/` 中维护。**新增服务 = 新增 `app/<service>` + 新增 `docs/services/<service>/README.md`**（硬规则）。新增、移动或修改文档后运行 `pnpm docs:index`；提交前的 `pnpm check` 校验索引和相对链接。当前实现、提议和历史记录必须分开标注（`current` / `accepted` / `proposed` / `historical`）。中文是主要规范文本，英文伴随文档明确其范围。

私有项目；未经授权不发布内部代码、文档或凭据。所采用的 Tuff Forum 原有版权和 MIT 许可证完整保留在 `app/forum/LICENSE`，不得以本项目私有属性删除上游声明。
