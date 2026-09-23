# 发布与人工验收规范

> 分支即发布：`stage` 是预发布、`main` 是正式；人工验收与明确批准必须发生在合入 `main` 之前，版本号不自动提升。

状态：`current` · 更新：2026-09-23 · 依据：项目所有者本次明确指令。分支规则见 [BRANCHING](BRANCHING.md)。

## 发布模型：分支驱动

| 动作 | 触发 | 结果 | 前置条件 |
|---|---|---|---|
| 预发布 | `stage` 收到推送 | 构建镜像并部署到预发布栈 `/opt/yzgc/preview` → `https://prev.yangtzeu.work` | 人工验收**不建议**用于预发布本身；由 `vars.DEPLOY_PREVIEW_ENABLED` 开关控制，默认关闭 |
| 正式发布 | `stage` 合入 `main` | 构建镜像并部署到正式栈 `/opt/yzgc/production` → `https://yangtzeu.work` | ① 人工在预发布试用并明确批准；② 同一 commit 已有成功预发布部署证据；③ `vars.DEPLOY_PRODUCTION_ENABLED=enabled` 且 production 环境审批通过 |

**没有 tag 步骤。** 历史上基于 `release-X.Y.Z` / `prev-X.Y.Z` tag 与 `版本@commit-id` 的发布流程已退役：新模型用分支身份（`main`/`stage`）加 commit SHA 定位发布内容，不再创建、推送或依赖发布 tag。遗留的历史 tag 只作追溯，不移动、不覆盖、不删除重建；发现误标由维护者决定处理方式，不用改 tag 来「修正」线上内容。

## 人工验收先于合入 `main`

正确顺序：

1. `task/<issue>/<slug>` 经 [CODE-REVIEW](CODE-REVIEW.md) 合入 `stage`；
2. `stage` 部署到预发布栈，得到该 commit 的真实运行产物；
3. **人**在预发布环境实际试用该产物，记录结论并明确批准；
4. 维护者把 `stage` 合入 `main`（只允许快进或干净合并，见 [BRANCHING](BRANCHING.md) 不变量）；
5. 正式部署流水线核对证据（同一 commit 的成功预发布部署记录 + 环境审批），再部署到正式栈。

合入 `main` 之后的环境审批**不能**替代第 3 步的人工试用。人工验收不是对 `stage` 整条分支的「一次性放行」，而是对**某个具体 commit 的产物**的判断。

### 验收记录至少包含

验收人、时间（ISO 8601 含时区）、目标环境（`preview` / `production`）、完整提交 SHA（40 位小写十六进制）、被试用产物的 SHA-256、试用范围/结果（实际点击/操作了什么、观察到什么）、已知问题、回滚对象、明确的放行结论（批准/不批准）、可追溯的审批记录链接。模板见 [RELEASE-ACCEPTANCE-TEMPLATE](../ops/RELEASE-ACCEPTANCE-TEMPLATE.md)。

Agent 可以整理候选改动、测试结果、差异和空白模板，**不能替验收人填写「已试用」**，不能伪造审批人/时间，不能靠 `approved=true`、环境变量或改校验器解除门禁。Git 作者名称、提交邮箱、签名存在或手填 JSON 不能单独证明有人实际验收。

验收记录保存在受访问控制的审批/部署记录中（GitHub Deployment、审批工单等），**不要为了把记录写进候选提交而制造自引用**：在候选 commit 之后再追加一个引用该 commit 的验收文件会产生新提交，新提交不能冒用旧验收。候选内容变化后重新验证。

## 版本号与展示值

- **版本号不自动提升**：`package.json` 的 `version` 由人决定何时改，禁止 semantic-release、版本机器人或基于 commit type 的脚本自行推进版本；`feat`/`fix` 提交消息不是发版许可。
- **展示值来源**：界面上显示的版本 = 构建时读取的 `package.json` `version`（`X.Y.Z`）+ 本次构建的完整 commit SHA。展示规则：
  - 正式环境：`X.Y.Z`（**禁止** `@` 后缀）；
  - 预发布环境：`X.Y.Z@<sha12>`（SHA 前 12 位）；
  - 本机：明确标记「本地开发 · 未发布」。
- 版本展示由受控构建注入（`GEEK_DEPLOYMENT_ENVIRONMENT`、`GEEK_RELEASE_VERSION`、`GEEK_RELEASE_COMMIT`），不从 `NODE_ENV` 猜目标环境。展示值只是构建身份，不是人工验收的证据，也不能当作发布凭据。
- 发布身份另由镜像 tag 承担：三个镜像的 tag 都是本次 commit 的 `<sha12>`，部署时写入目标机 `<STACK_ROOT>/.env.<environment>` 的 `IMAGE_TAG`。

## 环境与入口绑定

| 环境 | 分支 | 栈根 | 入口 | Compose 项目 |
|---|---|---|---|---|
| preview | `stage` | `/opt/yzgc/preview` | `https://prev.yangtzeu.work`（管理端 `/admin`、`/console`） | `yzgc-preview` |
| production | `main` | `/opt/yzgc/production` | `https://yangtzeu.work`（管理端 `/admin`、`/console`） | `yzgc-production` |

两套栈同机、完全隔离：独立目录、独立 compose 项目、独立数据卷、独立端口（18100/18101 与 18200/18201）、独立密钥、独立域名（每个环境只有一个域名，管理端按路径进入）。Cookie 使用 host-only（不写 `Domain`），禁止 `.yangtzeu.work` 这种父域共享。本机 `localhost`/`127.0.0.1` 只能标为 local/未发布，绝不能标成已在预发布环境试用。配置细节见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)，部署操作见 [DEPLOY](../ops/DEPLOY.md)。

## 回滚

回滚是把某个环境切回一个**已验证的历史镜像 tag**，不是移动分支、不是改版本号、不是重置数据库：

1. 选定该环境此前部署成功过的 `IMAGE_TAG`（历史 commit 的 `<sha12>`）；
2. 用 `deploy/remote/rollback-stack.sh` 把 `<STACK_ROOT>/.env.<environment>` 的 `IMAGE_TAG` 切到该值并 `docker compose up -d`；
3. 数据库结构不兼容时停下来由人处理，不自动重置数据库代替回滚。

同一环境同一时刻只允许一个部署任务（串行锁）；正式环境部署不得在切换过程中被新任务取消。

## 实现与核验边界

- 发布身份由只读规划器给出：`node scripts/release-policy.mjs plan --branch <main|stage> --commit <40 位 SHA>`（stdout 只输出 JSON，人类可读结论走 stderr）。分支 → 环境是唯一映射（`main` → `production`、`stage` → `preview`），镜像 tag = SHA 前 12 位；输出里 `deploymentAuthorized` 恒为 `false`。脚本不创建 tag、不写文件、不连服务器，也不证明人工批准；它只拒绝个人分支、任务分支和非分支末端的提交。
- 分支不变量与 `main` 保护由 `scripts/check-branch-invariants.mjs`（CI 的 `branch-guard` 与本地 pre-push）与仓库 refs 保护共同承担；**规范不等于远程保护已启用**，GitHub 计划能力需维护者实测确认（见 [CICD](../ops/CICD.md)）。
- 机器检查（`pnpm verify`、CI 全绿、构建成功、`release-policy` 输出）**不构成**人工验收记录，也不授权任何部署或发版动作。
- 部署开关默认关闭：`DEPLOY_PREVIEW_ENABLED`、`DEPLOY_PRODUCTION_ENABLED` 只有取值 `enabled` 时才部署。
- tag 语义已整体退役：`deploy/environments.json` 只保留环境身份（`label` / `origin` / `githubEnvironment`），旧的 `tagPrefix` / `allowCommitSuffix` 字段已删除，不要据它们恢复 tag 流程；旧发布包布局（`release-bundle` + `scripts/release-bundle.mjs`）、systemd 部署与旧目标机脚本均已删除，见 [DEPLOY](../ops/DEPLOY.md) 的历史章节。
