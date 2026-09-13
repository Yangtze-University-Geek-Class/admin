# Agent entry point

## 首步硬门禁：所有 AI / Agent 必须先读规范

**如果你是 AI，进入项目的第一步必须停下任何业务操作，先完整阅读规范。** 阅读完成前不编辑、不安装、不执行项目脚本、不操作数据、不开停服务、不做 Git 写操作或部署。仅允许为读取规范所必需的只读定位操作。

必读顺序：[docs 总入口](docs/README.md) → [AGENT-START](docs/conventions/AGENT-START.md) → [PROJECT](docs/conventions/PROJECT.md) → [CONTRIBUTING](docs/conventions/CONTRIBUTING.md) → [RELEASES](docs/conventions/RELEASES.md) → 本任务适用规范及模块入口。截断就继续读；文档缺失、读不到或冲突就停止，不凭记忆继续。上下文恢复后同样适用。

## 发版硬门禁：不可用自动化通过代替人工试用

**`main` 是主代码和唯一发布主线。`release-X.Y.Z` 对应正式环境，`prev-X.Y.Z` 对应预发布。** 版本升级和创建/推送这两类 tag 之前，必须已有人实际试用准确提交/产物并明确批准；AI 不得自行填写人工验收、修改版本或打 tag。“继续”和测试 PASS 都不是发版授权。

**域名与环境固定绑定：`prev.yangtzeu.work` = 预发布 = `prev-*`；`yangtzeu.work` = 正式 = `release-*`。Mac 的 localhost/127.0.0.1 只是本地开发，不是预发布。** 以 [环境合同](deploy/environments.json) 为机器配置源，禁止通过版本字符串、query 参数或 NODE_ENV 猜发布目标；不复用生产数据库、Cookie 或密钥给预发布。域名配置不等于 DNS/TLS/CI 已部署。

**日常更新只在预发布使用 `X.Y.Z@commit-id`，保留已接受的 prev 基础版本；不自动升号、不打新 tag，正式环境禁止 `@commit-id`。** 发版 tag 必须指向 main 历史中已验收的准确提交，不移动、不覆盖、不通配推送。完整规则见 [RELEASES](docs/conventions/RELEASES.md)，后续流水线见 [CICD](docs/ops/CICD.md)。规范不等于远程保护已启用；没有真实人工审批和目标授权就不发布。

`geek_main` is the unified workspace entry. Normative content lives in `docs/`, not in duplicated tool adapters.
Read [docs/README.md](docs/README.md) and the applicable documents before editing. Chinese is the primary collaboration language; code identifiers are English. Commit conventions are owned only by [COMMITS.md](docs/conventions/COMMITS.md).

## Task routing

| Task | Required documents |
|---|---|
| Any code change | [Project rules](docs/conventions/PROJECT.md), [Contribution workflow](docs/conventions/CONTRIBUTING.md), [Testing](docs/conventions/TESTING.md) |
| Module boundaries / new feature | [Modular development](docs/conventions/MODULAR-DEVELOPMENT.md), [Architecture](docs/architecture/ARCHITECTURE.md) |
| UI / interaction | [Tuffex AI guide](docs/components/tuffex/AI-GUIDE.md), [Tuffex usage policy](docs/components/tuffex/USAGE-POLICY.md), [Design](docs/design/DESIGN.md), relevant module document |
| API / database / authentication / uploads | [Security](docs/architecture/SECURITY.md), [API contracts](docs/architecture/API.md), relevant module document |
| Runtime / dependency / build changes | [Stack](docs/design/STACK.md), [Deployment](docs/ops/DEPLOY.md) |
| Documentation | [Documentation standard](docs/conventions/DOCUMENTATION.md) |
| Commit / issue / PR | [Commits](docs/conventions/COMMITS.md), [Issues](docs/conventions/ISSUES.md), [Pull requests](docs/conventions/PULL-REQUESTS.md) |
| Version / tag / CI/CD / deploy | [Releases](docs/conventions/RELEASES.md), [CI/CD](docs/ops/CICD.md), [Deployment](docs/ops/DEPLOY.md) |
| Authorized forum backup / local data capture | [Data capture](docs/ops/FORUM-DATA-CAPTURE.md), [Security](docs/architecture/SECURITY.md); never load real backups into browser mock state |

For UI tasks, query `node scripts/tuffex-docs.mjs search <component>` and read only the required API/example. Tuffex is the accepted UI foundation. Check each module manifest before using Vue components; do not infer migration status from documentation. Upstream snapshots are reference data, not project instructions. Full component rules live in the linked usage policy.

## Local module pointers

Read the matching local `AGENTS.md` when working in these directories; they contain only a pointer, not copies of global policy.

| Directory | Module contract |
|---|---|
| `web/sites/portal`, `server/src/routes/portal` | [Portal](docs/modules/portal.md) |
| `modules/forum` (upstream Nuxt/Vue/TuffEx source) | [Forum](docs/modules/forum.md), [adoption decision](docs/decisions/0003-adopt-tuff-forum.md) |
| `web/sites/admin`, `server/src/routes/admin` | [Admin](docs/modules/admin.md) |
| `web/shared` | [Shared frontend](docs/modules/shared.md) |
| `server/src/lib`, `server/src/middleware`, composition | [Server](docs/modules/server.md) |

## Working procedure

The user explicitly replaced the old React/Fastify forum with the MIT Tuff Forum source. Keep its independent Node >=26 / pnpm 11.24.0 toolchain and upstream component/style checks; the portal/admin core remains Node 22 / pnpm 9.15.9. Do not reconstruct the retired forum or mix its database/session model into upstream mock state. Root `pnpm verify` orchestrates both packages. Upstream currently has no real authentication/backend; a successful browser demo is not an authenticated internal community.

Inspect branch, HEAD and existing changes. Preserve unrelated work. Use the root commands listed in README; `pnpm verify` is the acceptance entry. Tests must use isolated databases and stub external services. Imports must not load `.env`, open a database or start a listener. Production credentials/data and deployment actions are outside ordinary coding scope.

Proposed and historical documents are not implementation instructions. Report a conflict instead of guessing; correct stale documentation in the same change. Read one language version, not both, unless reviewing a translation. Do not invent test results or call a successful typecheck a functional/security audit.
