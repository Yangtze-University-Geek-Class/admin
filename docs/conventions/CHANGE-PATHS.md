# 改动走哪条路：场景分流

> 一件改动先判断属于哪种场景，再照这一行的路径、检查和授权点走；对不上任何一行时停下来问所有者，不自己拼路径。

状态：`current` · 更新：2026-10-30 · 适用：所有进入 `stage`、`main`、预发布或正式环境的改动，以及正式数据与宿主操作。事实来源：[BRANCHING](BRANCHING.md)、[RELEASES](RELEASES.md)、[RELEASE-PARITY](RELEASE-PARITY.md)、`scripts/check-branch-invariants.mjs`、`scripts/hotfix-windows.mjs`、`scripts/promotion-windows.mjs`、`scripts/hotfix-sync.mjs`、`scripts/parity.mjs`。

## 怎么用这张表

1. 先看「怎么认」一列，找到唯一对得上的那一行，照那一行做。分支、tag、窗口的细节在各自规范里，这里只做分流。
2. 「机器检查」一列是硬门禁：脚本失败就按它输出的下一步处理，不改脚本、不跳过钩子、不换一条路绕开它。
3. 「默认做法」是推荐，不是唯一做法。有充分理由换一种做法时，在执行记录里写清楚为什么，审查时会看这个理由。
4. 一件事同时像两行（例如既是 P0 又要改表结构），两行的检查都要过。
5. 对不上任何一行、或者任务要求和你查到的事实冲突，停下来，把冲突和 2–3 个选项（各自的代价）一次性告诉所有者，由所有者定。别的能做的先做完，再问。

## 场景表

| 场景 | 怎么认 | 走哪条路 | 机器检查 | 谁点头 |
|---|---|---|---|---|
| 常规改动 | 新功能、普通缺陷、体验调整、文档、工具；线上没有用户被挡住 | 确认建单 → `task/<issue>/<slug>` 从 `stage` 拉 → MR 回 `stage` → `vX.Y.Z-rc.N` 预发布 → 验收 → `main` 快进到同一提交 → `vX.Y.Z` | CI `core`、`pr-contract`、`architecture-alignment`、`branch-guard`；部署工作流的 plan 与 parity | 建单、MR 审查结论、预发布验收、正式 tag |
| 线上 P0 | 正式环境整页白屏、核心功能不可用、主流程阻断、安全事故、数据损坏，且等一个常规周期的代价不能接受 | hotfix 窗口：以最新 `main` 为基线修 → MR 进 `main` → `deploy-hotfix.yml`（沿用既有正式 tag，不发 rc、不升号）→ `hotfix-sync.mjs` 合回两仓 `stage` → 关窗 | `deploy/hotfix/windows.json` 窗口 open、未过期、tag 匹配；`main` 领先 `stage` 的提交都归属窗口；`hotfix-verify`；parity；smoke | 所有者批准窗口（登记原话）、production 环境审批 |
| 预发布上已验收的一部分先上正式 | 预发布里某几项已经验收、正式急需，其余还没验收 | 依次考虑：1）功能开关，代码随常规路径进 `main`，正式先关着；2）前缀快进，想要的都在某个已验收提交之前，`main` 直接快进到它；3）部分晋升窗口，以上都不行时才用 | 窗口登记在 `deploy/promotion/windows.json`（最长 3 天）；`main` 领先 `stage` 的提交只能是登记提交（只在 `main` 上、只新增这一条，登记后除收尾字段外不能改）和 picks 经 `git cherry-pick -x` 挑来的、patch-id 一致的提交（冲突解决改了内容的不算）；窗口开着期间 excludes 不得进 `main`，快进也算；开着的窗口不能删改，标 `closed` 才解除 excludes；`node scripts/promotion-windows.mjs check` | 所有者批准窗口和 picks 清单、预发布验收、正式 tag |
| 只改配置或密钥 | env 键、开关、域名、端口、密钥，没有代码改动 | 三份 env 键集一致，值各自隔离；密钥只进环境级 secrets 与目标机 env；随一次部署生效 | `pnpm check:env-isolation`；`deploy/parity/ledger.json` 登记并在正式做完后 `done` | 生产 secrets 改动 |
| 表结构或数据格式变化 | 加表、加列、改约束、改存储格式 | 先扩后收：新旧代码都能读的结构先上，数据迁移幂等，旧列下一个版本再删；预发布先跑，正式前备份 | 迁移测试；parity 的表结构项；正式部署前的一致性备份与隔离恢复门 | 正式迁移执行 |
| 宿主与外部服务 | Caddy、CDN、OIDC 签发者、GitLab、DNS、systemd、对象存储 | 先在仓库补片段、安装或运维步骤与 CI 测试，经 `install-host.sh` 或专用工作流（如 `gitlab-cutover.yml`）执行；预发布先走，正式照原样再走一遍 | 片段不写另一个环境的地址（`origin-exceptions.json` 例外要写理由）；parity；smoke 核对响应头与登录跳转 | 宿主操作授权；默认演算，`apply` 才写 |
| 正式数据修复 | 改正式库的业务行或外部系统里的账号状态（例：2026-10-29 的重复 GitLab 号） | 写成默认演算的流水线步骤：逐条核对前置，任一条不满足整批拒绝；写前一致性备份；能重跑接续；输出不含密钥和身份值 | 步骤自己的单测（含拒绝与中途失败）；运行日志作证据 | 数据修复执行（属于已批准目标的一部分时不再单独问） |
| 回滚 | 新版本上线后出问题，要先恢复服务 | `deploy/remote/rollback-stack.sh --environment <环境> --to <sha12>` 切回本环境此前成功部署过的镜像；不动分支、不动 tag；修复再走新的 rc 或 hotfix | 脚本只在本环境仓库找镜像；结构不兼容时停下 | 回滚执行 |
| 比赛、报名等活动期间 | 有用户正在依赖的活动，例如比赛窗口内的 GitLab、积分、报名 | 活动相关路径只收 P0；需要停机的改动挑访问最少的时段，提前在论坛或官网公告；迁移前确认活动数据（积分、提交）不受影响 | 与上面对应场景相同 | 停机窗口 |
| 主代码托管不可用 | 自建 GitLab 登不上或宕机，成员改去 GitHub 提交 | 所有者同意后临时以 GitHub 为源，记下分叉点；恢复后把 GitHub 上的 issue/MR 迁回 GitLab，作者对应到本人，原帖留迁移记录；计分只在一侧算 | `hotfix-sync.mjs plan` 核对两仓；迁移脚本默认演算、按原链接去重 | 临时换源 |

## 几条贯穿所有场景的原则

- 一个外部系统只有一个写者。预发布不写正式的 GitLab、对象存储、邮件或数据库；切换写者时先停旧的、确认停了，再开新的。为什么：2026-10-29 预发布与正式两套同步同时写同一个 GitLab，建出 6 个重复号，签发者改接因此卡住（[事故复盘](../reviews/GITLAB-INCIDENT-2026-10.md)）。
- 预发布做过的事，正式要有对应动作，并且在做的当时登记到同构清单。为什么：2026-10-28 的三起事故都是「预发布做了，但不在提交里，也没有账」（[RELEASE-PARITY](RELEASE-PARITY.md)）。
- 地址、签发者、客户端 id 只从本环境的 env 读。代码和宿主片段里出现另一个环境的域名，就是下一次事故。
- hotfix 窗口只给 P0。交互调整、新功能、成员范围调整这类「急但不是故障」的事，走常规路径或部分晋升窗口；窗口的批准摘要里写清 P0 依据。
- 窗口、豁免、例外都要登记、带过期时间，过期自动失败。没有登记的例外等于没有例外。

## 判断不了的时候

先查：对应规范、`docs/architecture/catalog/` 的业务地图、issue 正文和最后几条追踪记录、执行记录里同一链路之前怎么定的。查完仍判断不了，按上面「怎么用这张表」第 5 条问所有者。不要因为「规范没写」就选最省事的那条路，也不要因为「规范没写」就停下不做——能做的部分先做完。

## 验证

- 分支与窗口：`node scripts/check-branch-invariants.mjs`、`node scripts/promotion-windows.mjs check`、`node scripts/hotfix-sync.mjs plan`。
- 同构：`node scripts/parity.mjs check --release --version <x.y.z>`、`pnpm check:env-isolation`。
- 本文件的表格与脚本行为不一致时，以脚本和它的测试为准，并在同一个 PR 里改正本文件。
