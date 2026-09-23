# 发布与人工验收规范

> 发版只靠打 tag：`vX.Y.Z-rc.N` 打在 `stage` 的提交上发预发布，所有者在预发布验收通过后，在同一提交上打 `vX.Y.Z` 发正式。tag 不可移动、不可删除，版本号不自动提升。

状态：`current` · 更新：2026-09-24 · 依据：项目所有者 2026-09-24 指令：「后续所有相关的 都是走发版的逻辑，通过打 tag 去发版。目前所有的发版流程是：先发预发布版，预发布版测试没啥问题的时候，再发正式版。」写法由所有者选定为 SemVer。分支规则见 [BRANCHING](BRANCHING.md)。

## 发布模型：tag 驱动

| tag | 形状 | 打在哪里 | 触发的工作流 | 部署到 | 展示版本 |
|---|---|---|---|---|---|
| 预发布 | `vX.Y.Z-rc.N`（N 从 1 开始） | `stage` 上的提交（`origin/stage` 或它的祖先） | `deploy-preview.yml` | 预发布栈 `/opt/yzgc/preview` → `https://prev.yangtzeu.work` | `X.Y.Z-rc.N@<sha12>` |
| 正式 | `vX.Y.Z` | `main` 上的提交，且这个提交上已经有同一 `X.Y.Z` 的 rc tag | `deploy-production.yml` | 正式栈 `/opt/yzgc/production` → `https://yangtzeu.work` | `X.Y.Z` |

发布 tag 的唯一正则（与 [scripts/release-policy.mjs](../../scripts/release-policy.mjs) 的 `RELEASE_TAG_RE` 逐字一致，测试核对两处相同）：

`^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.([1-9]\d*))?$`

- `X.Y.Z` 必须等于**该提交里**根 `package.json` 的 `version`（不看工作区）。
- push `stage` / `main` 只跑 CI，**不部署任何环境**。2026-09-23 至 2026-09-24 短暂使用过的「推分支即部署」模型已退役。
- 部署开关 `vars.DEPLOY_PREVIEW_ENABLED`、`vars.DEPLOY_PRODUCTION_ENABLED` 仍默认关闭：开关关闭时推 tag 只会规划和构建镜像归档，不会部署。
- 其它 tag（包括历史上的 `release-X.Y.Z` / `prev-X.Y.Z`）不触发任何部署。

## 发布流程

1. `task/<issue>/<slug>` 经 [CODE-REVIEW](CODE-REVIEW.md) 合入 `stage`。
2. 这次要发的版本号还没写进 `package.json` 时，先按下文「版本号」开一个普通 task PR 改 `version`，同样合入 `stage`。
3. 所有者授权发布这个预发布版本后，维护者在 `stage` 的提交上打 rc tag 并推送：

   ```bash
   git fetch origin --tags && git switch stage && git pull --ff-only
   git tag -a v0.2.0-rc.1 -m "v0.2.0-rc.1" <stage 上的 40 位提交 SHA>
   git push origin v0.2.0-rc.1
   ```

4. `deploy-preview.yml` 核对 tag、版本号与「提交在 `origin/stage` 上」，构建三个镜像并部署到预发布栈；部署记录的 payload 带上这个 rc tag。
5. 所有者在预发布环境实际试用这个 rc 的产物，按 [RELEASE-ACCEPTANCE-TEMPLATE](../ops/RELEASE-ACCEPTANCE-TEMPLATE.md) 记录结论。不通过就在 `stage` 上修复，打下一个 `rc.N+1`，回到第 4 步。
6. 验收通过后，维护者把 `main` 快进到被验收的那个提交（只允许快进；push `main` 只跑 CI，不部署）：

   ```bash
   git switch main && git merge --ff-only v0.2.0-rc.1 && git push origin main
   ```

7. 所有者授权正式发布后，在**同一提交**上打正式 tag 并推送：

   ```bash
   git tag -a v0.2.0 -m "v0.2.0" "v0.2.0-rc.1^{commit}"
   git push origin v0.2.0
   ```

8. `deploy-production.yml` 先跑证据 job（见下文），再构建镜像，经 `production` 环境审批后部署到正式栈。

## 授权门禁

- **打 tag 就是发版。** 创建并推送任何发布 tag，都需要所有者对**这个版本号**的明确授权。「继续」「测试都过了」「CI 全绿」都不算授权。Agent 不得自行创建或推送发布 tag。
- 打正式 tag 还需要所有者在预发布环境对**同一提交**的验收记录，放行结论写明「批准发布」。
- 代码审查结论、CI 全绿、预发布部署成功、`release-policy` 规划通过，都不构成授权。

## rc 编号

- 每个 `X.Y.Z` 的 rc 从 `rc.1` 开始按顺序递增，已推送的编号不复用。一次只推一个发布 tag（一次推送超过三个 tag 时 GitHub 不触发工作流）。
- 内容有任何变化都要打新的 rc。同一个 rc 需要重新部署时，手工运行 `deploy-preview.yml`：「Use workflow from」选这个 tag，输入框里也填这个 tag。不要为了重新部署而新建或移动 tag。
- 某个版本打过正式 tag 后，不能再给它打 rc。下一次发版先升 `version`。
- 正式 tag 必须和其中一个 rc 落在同一提交上，而且打正式 tag 时预发布站点必须仍在运行这个提交（证据 job 会读 `release.json`）。如果之后又有别的 rc 部署到了预发布，要么正式发布那个 rc 的提交，要么先把被验收的 rc 重新部署回预发布。

## 版本号

- `package.json` 的 `version` 何时改、改成多少，由所有者决定。修改走普通 task PR（先开 issue、经审查合入 `stage`），合入以后才能打这个版本的 rc。版本号按 SemVer 2.0.0 选择升哪一位。
- 禁止 semantic-release、版本机器人或按 commit type 推算版本的脚本；`feat`/`fix` 提交消息不是发版许可。工作流不会改版本号，也不会打 tag。

## 展示值与发布身份

- 界面显示的版本来自发布 tag 与提交：
  - 正式环境：`X.Y.Z`（禁止任何后缀）；
  - 预发布环境：`X.Y.Z-rc.N@<sha12>`（`<sha12>` 是提交 SHA 前 12 位）；
  - 本机：明确标记「本地开发 · 未发布」。
- 版本展示由受控构建以 build args 注入（`GEEK_DEPLOYMENT_ENVIRONMENT`、`GEEK_RELEASE_VERSION`、`GEEK_RELEASE_COMMIT`），不从 `NODE_ENV` 猜环境。论坛构建会校验组合（[app/forum/shared/deployment.ts](../../app/forum/shared/deployment.ts)）：`-rc.N` 只能和 `@<sha12>` 一起出现且只用于预发布，正式只能是 `X.Y.Z`，`<sha12>` 必须等于提交前 12 位。web 镜像内置的 `/release.json` 带同一个版本值。
- 镜像 tag 是提交的 `<sha12>`，部署时写入目标机 `<STACK_ROOT>/.env.<environment>` 的 `IMAGE_TAG`。镜像 tag 标识代码，发布 tag 标识一次发版。
- **镜像仓库按环境分开**：预发布用 `yzgc-preview/{server,web,forum}:<sha12>`，正式用 `yzgc-production/{server,web,forum}:<sha12>`。两套栈共用目标机的一个 Docker 守护进程，同一提交会先按预发布身份、再按正式身份各构建一次（`release.json`、版本串等构建参数不同）。如果共用一个镜像名，后装载的一方会把另一方的镜像改名覆盖，之后预发布回滚或重建容器就会跑正式构建。所以同一提交在两个环境里绝不共用镜像引用；`deploy/env` 与 compose 的契约校验、CI 和部署脚本都会核对这一点。
- 展示值只是构建身份，不是人工验收的证据，也不能当作发布凭据。

## 人工验收先于正式 tag

人工验收针对**某个 rc tag 所在提交的产物**，不是对 `stage` 整条分支的一次性放行。`production` 环境审批不能替代预发布试用。

### 验收记录至少包含

验收人、时间（ISO 8601 含时区）、目标环境（`preview` / `production`）、被验收的 rc tag、完整提交 SHA（40 位小写十六进制）、被试用产物的摘要（镜像 digest 或 `/release.json`）、试用范围与结果（实际点击或操作了什么、观察到什么）、已知问题、回滚对象、明确的放行结论（批准或不批准）、可追溯的审批记录链接。模板见 [RELEASE-ACCEPTANCE-TEMPLATE](../ops/RELEASE-ACCEPTANCE-TEMPLATE.md)。

Agent 可以整理候选改动、测试结果、差异和空白模板，**不能替验收人填写「已试用」**，不能伪造审批人或时间，不能靠 `approved=true`、环境变量或改校验器解除门禁。Git 作者名称、提交邮箱、签名或手填 JSON 都不能单独证明有人实际验收。

验收记录保存在受访问控制的审批或部署记录中（GitHub Deployment、审批工单等）。**不要为了把记录写进候选提交而制造自引用**：在候选提交之后再追加一个引用它的验收文件会产生新提交，新提交不能冒用旧验收。

## 环境与入口绑定

| 环境 | 提交所在分支 | 栈根 | 入口 | Compose 项目 |
|---|---|---|---|---|
| preview | `stage` | `/opt/yzgc/preview` | `https://prev.yangtzeu.work`（管理端 `/admin`、`/console`） | `yzgc-preview` |
| production | `main` | `/opt/yzgc/production` | `https://yangtzeu.work`（管理端 `/admin`、`/console`） | `yzgc-production` |

「提交所在分支」是发布 tag 必须打在哪条分支的提交上：rc tag 对应 `stage`，正式 tag 对应 `main`。分支本身的推送不触发部署。

两套栈同机、完全隔离：独立目录、独立 compose 项目、独立数据卷、独立端口（18100/18101 与 18200/18201）、独立密钥、独立域名（每个环境只有一个域名，管理端按路径进入）。Cookie 使用 host-only（不写 `Domain`），禁止 `.yangtzeu.work` 这种父域共享。本机 `localhost`/`127.0.0.1` 只能标为 local/未发布，绝不能标成已在预发布环境试用。配置细节见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)，部署操作见 [DEPLOY](../ops/DEPLOY.md)。

## 回滚

回滚是把某个环境切回一个**更早发布 tag 的镜像**。不移动分支，不移动、删除或重打 tag，不改版本号，不重置数据库：

1. 选定该环境此前部署成功过的发布 tag（正式环境即更早的 `vX.Y.Z`），它的镜像 tag 是 `git rev-parse "vX.Y.Z^{commit}" | cut -c1-12`，可在目标机 `<栈根>/deploy-history.log` 第 3 列核对；
2. 在目标机运行 `deploy/remote/rollback-stack.sh --environment <environment> --to <sha12|previous>`，它只在本环境的仓库 `yzgc-<environment>/…` 里找目标镜像，把 `<STACK_ROOT>/.env.<environment>` 的 `IMAGE_TAG` 切到该值并 `docker compose up -d`；另一环境同一 SHA 的镜像不能拿来回滚；
3. 数据库结构不兼容时停下来由人处理，不用重置数据库代替回滚；本环境的目标镜像已被保留策略清理时也停下来，由维护者从该 tag 在本环境的部署工作流产物重新分发，不在服务器上临时构建。

回滚之后的修复走新的 rc（必要时先升版本号），不改写已发布的 tag。同一环境同一时刻只允许一个部署任务（串行锁）；正式环境部署不得在切换过程中被新任务取消。

## tag 不可变

- 发布 tag 一经推送就不移动、不覆盖、不删除重建。打错了（提交不对、版本号不对）就打下一个 rc 或升版本，已推送的错误 tag 保留作记录。
- 本地 pre-push 守卫拒绝删除和强制移动发布 tag。GitHub 的 tag 保护（rulesets）在当前计划下不可用（见 [CICD](../ops/CICD.md)），所以这条规则目前只有本地钩子、工作流里的核对和流程约束，**没有服务端强制**。
- 历史上的 `release-X.Y.Z` / `prev-X.Y.Z` tag 只作追溯，不触发部署，也不删除重建。

## 实现与核验边界

- 发布身份由只读规划器给出：`node scripts/release-policy.mjs plan --tag <vX.Y.Z-rc.N|vX.Y.Z> --commit <40 位 SHA>`（stdout 只输出 JSON，人类可读结论走 stderr）。它核对 tag 格式、tag 指向传入的提交、`X.Y.Z` 等于该提交的 `package.json` `version`、rc 提交在 `stage` 上且该版本还没有正式 tag、正式提交在 `main` 上且同一提交有同版本的 rc tag。输出里 `deploymentAuthorized` 恒为 `false`。脚本不创建 tag、不写文件、不连服务器，也不证明人工批准。它拒绝分支名、`latest`、短 SHA 与格式错误的 tag。
- 「同一提交已在预发布成功部署」与「预发布站点现在就是这个提交」由 `deploy-production.yml` 的证据 job 读 GitHub Deployments 与 `https://prev.yangtzeu.work/release.json` 核对，见 [CICD](../ops/CICD.md)。
- 分支不变量与发布 tag 的推送规则由 `scripts/check-branch-invariants.mjs` 承担（CI 的 `branch-guard` 与本地 pre-push）；**规范不等于远程保护已启用**，GitHub 计划能力需维护者实测确认（见 [CICD](../ops/CICD.md)）。
- 机器检查（`pnpm verify`、CI 全绿、构建成功、`release-policy` 输出）**不构成**人工验收记录，也不授权任何部署或发版动作。
- 部署开关默认关闭：`DEPLOY_PREVIEW_ENABLED`、`DEPLOY_PRODUCTION_ENABLED` 只有取值 `enabled` 时才部署。
- `deploy/environments.json` 只保存环境身份（`label` / `origin` / `githubEnvironment`），发布 tag 规则只在 `scripts/release-policy.mjs` 实现。旧的 `tagPrefix` / `allowCommitSuffix` 字段已删除，不要恢复。旧发布包布局（`release-bundle` + `scripts/release-bundle.mjs`）、systemd 部署与旧目标机脚本均已删除，见 [DEPLOY](../ops/DEPLOY.md) 的历史章节。
