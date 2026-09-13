# geek_main

长江大学极客班的统一项目入口。现有产品代码名为 `yzgc-admin`；保留 `@yzgc/web`、`@yzgc/server` 包名，以避免无收益的接口改名。

这是统一编排的模块化工作区：官网 portal 和 GitHub 组织管理 admin 保留 React/Fastify；论坛直接采用 MIT 许可的 Tuff Forum 原代码，位于 `modules/forum`，使用 Nuxt/Vue/TuffEx 独立工程。旧 React/Fastify 论坛已经退出活动代码和构建，旧业务数据库不删除、不自动导入。

**当前论坛前端不包含真实后端或认证。** 本机发现私有快照目录时只读显示极客班论坛归档（无登录、不可写）；否则为上游示例，示例身份不是 GitHub 登录，内容只保存于当前浏览器。公开宣传页 → 登录后内部 Hub → 论坛/组织管理/扩展服务是目标结构；统一内部认证、服务接入和 3D Hub 尚未落地，不能把这次原仓接入称为完整生产社区。

## 从哪里开始

| 需要做什么 | 入口 |
|---|---|
| 阅读全部项目、提交、贡献、模块化及技术文档规范 | [docs/README.md](docs/README.md) |
| Agent 接手项目：第一步先读规范，不先操作 | [AGENTS.md](AGENTS.md)、[AGENT-START](docs/conventions/AGENT-START.md) |
| 了解真实架构与数据归属 | [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) |
| 了解实际技术栈，不混淆升级提议 | [STACK.md](docs/design/STACK.md) |
| 操作部署环境 | [DEPLOY.md](docs/ops/DEPLOY.md) |
| main、人工验收、release-/prev- 与预发布 @SHA | [RELEASES](docs/conventions/RELEASES.md)、[CI/CD 设计](docs/ops/CICD.md) |
| 已拉取的论坛原始数据与本地核验 | [FORUM-DATA-CAPTURE](docs/ops/FORUM-DATA-CAPTURE.md) |
| 本机启动核心预览和原仓论坛 | [LOCAL-PREVIEW.md](docs/ops/LOCAL-PREVIEW.md)、[TUFF-FORUM.md](docs/ops/TUFF-FORUM.md) |
| 论坛代码来源、许可和替换边界 | [采用决策](docs/decisions/0003-adopt-tuff-forum.md) |

## 目录边界

```text
geek_main/
  modules/forum/                  上游 Tuff Forum 原代码，独立工具链/锁文件
  web/sites/{portal,admin}/        核心两端页面、路由和业务组件
  web/shared/                     跨端 UI、网络、渲染和配置适配
  server/src/routes/{portal,admin}/  核心 HTTP 模块与各自契约
  server/src/lib/                  数据工厂与共享业务规则
  server/src/middleware/           请求认证与安全策略
  server/src/app.ts                应用组装，可注入依赖，不监听端口
  server/src/index.ts              唯一后端启动入口
  tests/                          隔离回归、组件与工具测试
  scripts/                        统一检查与文档生成
  docs/                           全部规范、架构、模块合同、运维与决策
  deploy/                         部署模板；普通开发不执行
```

## 开发与验收

核心包使用 `.nvmrc` 指定的 Node 22（最低 22.13）和 pnpm 9.15.9；论坛按原仓使用 Node >=26 和 pnpm 11.24.0。根 `forum:*` 命令选择独立工具链，不将论坛加入旧 pnpm 9 依赖解析。新环境配置见 TUFF-FORUM；本机已准备两套运行时。切换 Node 后不能复用另一 ABI 的 SQLite 二进制。

```bash
pnpm install --frozen-lockfile
pnpm dev:web       # 前端只读 mock 预览；不需要 OAuth 或业务数据库
pnpm dev           # 前后端开发；需要人工填写本机专用 .env
pnpm check         # 运行时、边界、文档和类型检查
pnpm release:plan --help # 只读版本/来源规划，不是人工批准，不打 tag 或部署
pnpm test          # 真实应用路由、隔离 SQLite、模拟外部服务
pnpm build         # 核心 portal/admin 和 Fastify 构建
pnpm forum:install # 论坛 frozen-lockfile 独立安装
pnpm forum:check   # 原仓类型、Lint、样式约束及单测
pnpm forum:generate # 原仓 Nuxt 静态产物
pnpm verify        # 核心 check/test/build + 论坛 check/generate
pnpm test:e2e      # 核心浏览器验证
pnpm forum:verify # 原仓 CDP 验收及路由烟测
pnpm preview:local # 核心 5173/3000 + 独立论坛 3456
```

核心页面在 `http://127.0.0.1:5173/sites/portal/`、`/sites/admin/`，论坛为 `http://127.0.0.1:3456/`。旧论坛页面入口转到新论坛首页，不猜测旧帖子 ID 映射。核心 mock 是只读；`pnpm forum:start` 在本机发现 `.tools/forum-runtime/` 下的只读快照时显示极客班论坛归档（无登录、不可写、不写 localStorage），`GEEK_FORUM_SOURCE=demo` 回到原仓示例交互；两种模式界面都明确提醒其并非真实认证或跨设备存储，详见 [TUFF-FORUM](docs/ops/TUFF-FORUM.md)。

真实开发环境参照 [本地环境模板](docs/ops/ENVIRONMENT.md) 由操作者填写，不在仓库提交密钥，不连接生产数据库做测试；已有环境文件保持原样。常规测试只使用内存数据库及临时目录，不触发 GitHub、邮件或部署操作。生产部署需单独授权和发布验证，不能把本地构建通过视为线上验收。

## 文档维护

规范统一在 `docs/` 中维护。新增、移动或修改文档后运行 `pnpm docs:index`；提交前的 `pnpm check` 校验索引和相对链接。当前实现、提议和历史记录必须分开标注。中文是主要规范文本，英文伴随文档明确其范围。

私有项目；未经授权不发布内部代码、文档或凭据。所采用的 Tuff Forum 原有版权和 MIT 许可证完整保留在 `modules/forum/LICENSE`，不得以本项目私有属性删除上游声明。
