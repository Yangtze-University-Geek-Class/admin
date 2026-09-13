# 版本、Tag 与人工发版规范

> main 为主代码；release- 为正式发版，prev- 为预发布发版；版本升级和打 tag 必须先有真实人工验收。

状态：`current` · 更新：2026-09-13 · 依据：项目所有者本次明确指令。

## 不可变规则

`main` 是唯一发布主线。所有发版或预发布增量选中的提交必须属于 main 历史；`next`、功能分支和 PR 合并模拟提交不直接作为发布来源。检查的是完整提交对象和 main 的祖先关系，不能靠分支名称字符串或运行工作流时的默认 HEAD 代替。

| 类型 | Git 触发/基准 | 展示版本 | 人工条件 |
|---|---|---|---|
| 正式发版 | `release-X.Y.Z` | `X.Y.Z` | 对该准确提交/产物人工试用和批准后，才能打 tag 并部署 |
| 预发布版本里程碑 | `prev-X.Y.Z` | `X.Y.Z` | 同样先人工试用和批准，不能自动生成或升级 |
| 预发布日常增量 | 已有 `prev-X.Y.Z` 基准 + main 中的准确 commit | `X.Y.Z@<commit-id>` | 不提升基础版本、不打新 tag；仅在获准的预发布流程执行 |

前缀必须逐字使用 `release-` 和 `prev-`，不能替换成 `v`、`preview-`、`pre-` 或 `releases/`。版本正文约定为无前导零的三段整数 `X.Y.Z`；`0.1.0` 可以，`01.1.0` 不可以。正式/预发布 tag 不带 `@`、额外 `-rc` 或 `+build` 后缀。

`@commit-id` 是项目的预发布展示约定，不是 SemVer/npm 版本，也不是 Git tag。默认展示完整 SHA 的前 12 位；部署记录必须同时保存完整 40 位 SHA，短 SHA 不能当作唯一发布身份。它指本次构建选中的准确末端提交，不是基准 tag 的 SHA 或执行期间又前进的分支 HEAD。生产版本绝对不能带 `@`。

## 固定环境与域名

唯一机器配置为 [deploy/environments.json](../../deploy/environments.json)。`preview` 的入口必须为 `https://prev.yangtzeu.work`，只接收 `prev-*` 里程碑或已批准基准的增量；`production` 的入口必须为 `https://yangtzeu.work`，只接收 `release-*`。本机 `localhost` / `127.0.0.1` 标为 local/未发布，绝不能标成已在 prev 环境试用。

release-policy 的输出包含 `publicOrigin` 和完整 `target`；可用 `--target-origin` 交叉核对实际目标。prev tag 配正式域名、release tag 配 prev 域名、HTTP、非标准端口和不可信域名均拒绝。检查通过仍然 `deploymentAuthorized: false`，不证明环境已经开通。

论坛“关于”页显示环境与版本，构建时须显式提供 GEEK_DEPLOYMENT_ENVIRONMENT、GEEK_RELEASE_VERSION 和 GEEK_RELEASE_COMMIT；不根据 NODE_ENV=production 判断正式/预发布。正式版本禁止 @；预发布 @ 后 12 位必须匹配完整 commit。域名与构建声明不符时显示配置错误，不视作有效发布。当前本机为未发布，未改变 package.json 版本。

## 人工验收必须在打 tag 之前

正确顺序：选定 main 中的候选提交 → 机器验证和隔离构建 → 实际运行候选产物并由人试用 → 人记录结论并明确批准环境/版本/SHA → 创建不可变 tag → tag 流水线再次核对证据与产物 → 部署。tag 后的环境审批不能替代 tag 前的人工试用。

人工验收至少记录：验收人、时间、目标环境、拟发布 tag、完整提交 SHA、被试用产物的 SHA-256、试用范围/结果、已知问题、回滚对象、明确放行结论，以及可追溯的审批记录。Agent 可以生成空白模板，不能替验收人填通过。

证明应保存在受访问控制的审批/部署记录中，绑定准确 SHA 和产物摘要。不要为了把记录写进候选提交而形成自引用：追加一个含旧 SHA 的验收文件会产生新提交，新提交不能冒用旧验收。构建产物变化或候选提交变化后，重新验证并获得对应确认。

即使 `pnpm verify`、浏览器测试全部通过，也不自动获得打 tag、修改版本、推送或部署权限。禁止用 semantic-release、版本机器人或基于 commit type 的脚本自行推进版本。

## 预发布增量的基准和顺序

日常更新固定最近一个在该提交历史上可达的、已人工接受的 `prev-X.Y.Z` 基准。流水线从可信发布记录读取已接受状态，不能只见到一个同名前缀 tag 就认定它已通过人工验收。无法唯一确定基准、基准不属于所选 main 提交历史、没有已批准基准时失败关闭。

例如已确认基准是 `prev-1.2.0`：后续两个 main commit 分别展示 `1.2.0@abcdef123456`、`1.2.0@fedcba654321`。它们不会自动变成 1.2.1，也不会生成新 prev/release tag。人对一个候选提交试用通过并批准新版本后，才可建立 `prev-1.3.0`。这些数字只是说明例子，不是本项目已发布版本。

首次尚无 prev tag 时，先由人指定候选版本，在本地/隔离验收环境按 SHA 构建和试用，再建立首个 prev tag；不能把 package.json 中既有 `0.1.0` 当成已验收的发布基准。package.json、锁文件和上游论坛包版本是包元数据，不自动充当整站发版真相。

预发布和正式版本各自禁止意外降级或复用旧号。正式推广建议使用已在预发布试用的同一提交和同一产物；有差异就重新试用，不把“上一个预发布通过”推广到未测试代码。

## Tag 和产物不可变

已发布 tag 不移动、不覆盖、不删除重建。不执行 force-push、强制 tag 更新或通配式 `git push --tags`。发现误标时停止并由维护者决定修正；回滚是部署一个已确认的历史产物，不是移动 tag 或重置数据库。

发版部署必须检出 tag 解析后的 commit，不能在服务器执行 `git pull main` 后称为 tag 发布。同一版本绑定 commit、产物摘要、工具链及数据库兼容性；不得把 Mac node_modules 或本次拉取的真实数据库打进 Linux 发布包。

## 实现与核验边界

`scripts/release-policy.mjs` 仅做离线命名、版本展示、固定目标域名和本地 Git 来源检查，不创建 tag、不改文件、不连服务器，也不证明人工批准。它的输出明确 `deploymentAuthorized: false`。后续 CI/CD 设计见 [CICD](../ops/CICD.md)，实际运维见 [DEPLOY](../ops/DEPLOY.md)。

GitHub refs 保护、审批人的真实身份和访问权限、GitHub 计划支持、环境隔离、秘密和部署适配器都必须实际配置并验收；仅靠本文件或一个可随意填写的批准字段不够。缺任何必需门禁就不发布。

外部依据（2026-09-13 核对）：https://semver.org/ 定义三段语义版本；本项目 tag 前缀和 @ 展示是自有约定。https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets 描述分支/tag 保护。完整平台接入限制见 CICD。
