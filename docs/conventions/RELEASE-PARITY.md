# 预发布到正式的同构与无损迁移规范

> 对齐的是接口和表结构，数据只对齐格式；预发布上做过的每一件事，正式都有对应动作；地址、端口、签发者只来自各环境自己的 env 文件；发版前同构清单清零，发版后烟测通过。

状态：`current` · 更新：2026-10-30 · 依据：所有者 2026-10-28 19:11 的指令（原话在 GitLab #309 正文的确认依据），以及 19:43 的补充：对齐的本质是接口对齐、数据库表对齐，数据不对齐、只对齐格式，并清理没有任何页面调用的死接口。分支与发布流程见 [BRANCHING](BRANCHING.md)、[RELEASES](RELEASES.md)，环境变量契约见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)。

## 为什么要有这份规范

2026-10-28 的三类事故有同一个原因：事情在预发布做了，但不在提交里，也没有地方记账。

| 事故 | 在预发布做了什么 | 正式缺什么 |
|---|---|---|
| 正式的 GitLab 登录跳到预发布 | `deploy/gitlab/gitlab-oidc.rb` 写死预发布签发者 | 片段里的域名没人翻成正式，仓库和 CI 没有检查 |
| 内部赛事官网在正式 404 | 官网的站点记录只建在预发布的库里 | 正式也要有这条记录，发正式时没人确认 |
| 新 CDN 在正式从不生效 | 预发布前置 Caddy 的 CSP 改过 | 正式的 CSP 在宿主上，不在仓库里 |

预发布是 `stage`，建立在 `main` 基线之上；预发布验证通过的路径，正式要原样再走一遍。要做到这一点，需要三样东西：环境之间的值严格隔离、预发布做过的事有账、发版前后有核对。

## 对齐什么，不对齐什么

| 对象 | 对齐方式 |
|---|---|
| 接口 | 对齐。路由、请求与响应的格式、权限由同一份代码带到两个环境；发版后 `compare` 比公开 JSON 接口的键和值类型。没有任何页面调用的接口不留（第九节） |
| 数据库表 | 对齐。表、列、索引、外键由同一套幂等迁移建出，正式先在备份副本上演练（第四节） |
| 数据 | 不对齐，只对齐格式。用户、帖子、报名、赛事站点内容等记录的内容是各环境自己的，不复制、不同步、不拿预发布的行或数据库文件去覆盖正式；对齐的是字段形状、枚举取值和 JSON 结构 |

代码要求必须存在的记录（例如 OIDC 客户端、赛事官网的站点记录）也是各环境自己写：同一条命令、同样的字段形状，值取该环境自己的（回调地址、密钥、标题）。

## 一、三份 env：正式、预发布、本机

| 文件 | 用途 | 值 |
|---|---|---|
| `deploy/env/.env.production` | 正式栈 | 正式的域名、端口、栈目录、镜像仓库 |
| `deploy/env/.env.preview` | 预发布栈 | 预发布的域名、端口、栈目录、镜像仓库 |
| `deploy/env/.env.dev` | 本机调试 | 回环地址、`.tools/local-preview` 下的数据；`GITLAB_SYNC=off`、`MAIL_RECIPIENTS=allowlist` |

三份文件都入库，键集完全一致，密钥一律留空（正式与预发布由 CI/CD 从各自的 GitHub 环境 secrets 渲染，本机由操作者在 shell 或仓库根 `.env` 里补，不写进文件）。`.env.dev` 只保留回环地址、公开发件地址和共用 CDN 地址，不放真实密钥、账号或个人信息；本机 GitLab 使用回环基址且同步关闭，不连接正式 GitLab。

正式与预发布除环境身份、栈路径/端口、`GITLAB_SYNC` 与独立 GitLab 的 `GITLAB_URL`、`GITLAB_OIDC_CLIENT`、`GITLAB_STACK_ROOT`、`GITLAB_HTTP_BIND`、`GITLAB_DOCKER_SUBNET`、`GITLAB_DOCKER_GATEWAY` 外，值必须相同。每个 GitLab 只有本环境一个同步写者；两个实例的URL、目录、绑定和子网不得相同。差异键在 `scripts/check-env-isolation.mjs` 的 `PER_ENVIRONMENT_KEYS` 登记，具体值与原因见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)。新增差异须同样说明，不能绕过隔离检查。

每份文件里不得出现另外两个环境才有的值：正式文件没有预发布域名、预发布端口 18200/18201、`yzgc-preview`；预发布文件没有正式域名、端口 18100/18101、`yzgc-production`；本机文件没有任何部署栈的域名、端口和目录。

## 二、不在代码里写另一个环境的地址

地址、端口、签发者、镜像仓库这类值只有两个来源：该环境自己的 env 文件，或者 `deploy/environments.json`。代码、工作流、部署脚本需要它们时去读，不抄一份。宿主上的配置片段（例如 `deploy/gitlab/gitlab-oidc.rb`）不写域名，读宿主上的文件：GitLab 信任哪个环境，由 `/etc/gitlab/yzgc-oidc-issuer` 的内容决定，仓库里的片段对两个环境是同一份。

确需写死的位置（命令行的编译期默认源站、邮件链接白名单、各环境自己的 nginx 模板、说明性注释）登记在 `deploy/env/origin-exceptions.json`：写文件、次数上限和理由，限定单一环境的文件加 `only`。检查对没有登记的文件、超过上限的文件、登记了却已没有域名的文件都失败。新增写死位置要在同一个 PR 里登记，审查人看理由。

两项检查合在 `pnpm check:env-isolation`（`pnpm check` 包含它，CI 的 `core` 与 `branch-guard` 都会跑）。

## 三、五个同构面

提交和 tag 只能带走代码与镜像。下面五个面不在提交里，预发布动了其中任何一个，就要在同构清单里登记，正式做完才算完成。

| 面 | 例子 | 预发布做的时候 | 正式做的时候 |
|---|---|---|---|
| `schema` | 新增表、列、索引 | 随 rc 部署由服务启动时迁移；迁移幂等、只增不删 | 随正式部署同一个迁移；先按第四节在备份副本上演练。只有迁移之外还要手工步骤时才登记 |
| `data` | 迁移改变了旧行的形状；代码要求必须存在的记录（OIDC 客户端、赛事官网的站点记录）的字段形状 | 用脚本或服务自带的函数写入，记下命令和字段形状 | 对正式库执行同一条命令，值取正式自己的；先 dry-run，执行后核对记录数。不复制预发布的行，用户内容不登记 |
| `env` | 新增 env 键、新增密钥 | 先改三份模板与 ENVIRONMENTS 字段表，再配预发布的环境 secrets | 配上正式环境的同名 secrets，部署时渲染；缺必填密钥时渲染失败 |
| `host` | 前置 Caddy、nginx、CSP、`gitlab.rb` | 能进仓库的进仓库做模板；不能的把改动和备份位置写进清单 | 对正式宿主做同一改动，先备份，改完留校验输出 |
| `external` | OAuth 回调、Turnstile 域名、Google 客户端、DNS、CDN | 记下登记的位置与值的形状（不记密钥） | 对正式域名做同样的登记，所有者本人的操作写清谁在何时做 |

## 四、无损迁移流程（表结构和数据格式）

1. 设计：迁移可以重复执行，结果相同；只增不删。要删列、改语义时拆成两次发布，第一次兼容新旧，第二次清理。
2. 预发布：rc 部署后，核对迁移前后的记录数（`func:data` 的 PR 要把前后数字写进验收证据）。
3. 正式前：取一份一致备份（[BACKUP](../ops/BACKUP.md)），在备份副本上用目标镜像演练升级：断网容器、`integrity_check` ok、外键违规 0、第二次启动幂等、旧镜像能在升级后的库上启动。演练产物按 `.tools/handoff/` 的做法留证据，副本用完删除。
4. 部署：沿用既有部署链（备份、隔离恢复、镜像校验和、健康门、回滚，见 [CICD](../ops/CICD.md)），不手工改运行中的栈。
5. 部署后：核对记录数，跑第六节的烟测。
6. 修数据格式缺口（旧行缺字段、缺必需记录）：用服务自带的函数或脚本（例如 `bootstrap-owner.mjs`），先 dry-run 看结果，再带 `--apply`；不手写对正式库的 UPDATE。
7. 回滚：切回旧发布 tag 的镜像（[RELEASES](RELEASES.md)「回滚」）；库结构不兼容时停下来由人处理，不用重置数据库代替回滚。

## 五、同构清单

清单是 `deploy/parity/ledger.json`，只用 `scripts/parity.mjs` 写，时间取系统时钟（北京时间），不手填。

```bash
node scripts/parity.mjs list
node scripts/parity.mjs add --surface data --title "…" --issue <编号> \
  --preview-evidence "预发布做了什么、怎么验证的" --production-action "正式要做的动作和命令" [--phase post_deploy --release <x.y.z>]
node scripts/parity.mjs done P-0010 --evidence "正式做了什么、怎么验证的"
node scripts/parity.mjs not-applicable P-0010 --reason "为什么正式不需要"
node scripts/parity.mjs waive P-0010 --by Crosery --quote "所有者的原话"
node scripts/parity.mjs check --release --version <x.y.z>
node scripts/parity.mjs check --complete
```

- 谁登记：在预发布做这件事的人或 agent，做的当时就登记，写进同一个 PR；清单条目里的 `production.action` 要具体到别人照着就能执行。
- 谁关闭：在正式做完的人，`done` 要写证据；确实不需要写 `not-applicable` 和理由；只有所有者能豁免，`waive` 必须带所有者的署名和原话，agent 不替所有者写豁免。
- 门禁：`deploy-production.yml` 与 `deploy-hotfix.yml` 的 `parity` job 运行 `check --release --version <版本>`，部署前的条目还有 `pending` 就不构建、不部署。拼错的参数、`--release` 不带 `--version` 都退出 2，不会当作通过。预发布部署不受它拦截。已写的结论不改，写错了追加一条新记录说明。
- 阶段：条目默认是部署前（`pre_deploy`）。有些事要等这次部署把正式服务起来才能做（例如 GitLab 签发者改接正式、正式构建换新 CDN 的验收），登记时加 `--phase post_deploy --release <x.y.z>`（随哪个版本部署）：`check --release --version` 对本版本的 post_deploy 条目只列出来、不拦；部署完成后做完并 `done`，再跑 `check --complete`，它要求所有条目清零。属于更早版本、仍是 `pending` 的 post_deploy 条目会拦住下一个版本的发布（hotfix 也一样），所以上一次部署后的收尾不会被悄悄跳过。阶段只决定什么时候必须做完，不决定要不要做。
- 记账靠执行者：脚本只保证登记过的条目会被核对，发现不了漏登记；漏登记由第六节的烟测兜底可见的差异，只在内部可见的差异（例如没人访问的数据）仍然是盲区，所以登记要在做事的当时完成，不留到发版前回忆。

## 六、发版烟测

`deploy/parity/smoke.json` 有两段，地址里不写域名：

- `require`：某个环境发完后必须满足的期望，包含内部赛事官网 `/c/oss-challenge-2026-1/` 返回 200 且正文含站点标题、`/release.json` 的环境名与被测环境一致。
- `mirror`：同一份提交在预发布与正式上，这些地址的状态、内容类型必须一致；`sameShape` 再要求公开 JSON 接口两边的键和值类型一致，值不比（数据各环境自己的，只比格式）；`sameBody` 只用于来自代码的静态文件，不用于读库渲染的页面；`/oidc/.well-known/openid-configuration` 要求两边的 `issuer` 各是自己的 `PUBLIC_ORIGIN/oidc`。

```bash
node scripts/parity.mjs smoke --origin <站点> --env <production|preview>
node scripts/parity.mjs compare --preview <预发布站点> --production <正式站点>
```

正式部署工作流在部署成功后自动跑 `smoke`；`deploy-production.yml` 里预发布与正式是同一个提交（证据 job 已核对），所以还会跑 `compare`。`deploy-hotfix.yml` 只跑 `smoke`：hotfix 的正式提交在 `main` 上，预发布可能在更新的提交上，不能要求两边接口格式相同。烟测失败时这次运行变红，已切换的栈不会被它回滚，按 [DEPLOY](../ops/DEPLOY.md) 的回滚步骤处理。

## 七、hotfix 同样走这里

hotfix 从 `main` 修（[RELEASES](RELEASES.md)「线上紧急缺陷（Hotfix）规约」），不因为紧急跳过同构：修复里动了五个面中的任何一个，同样登记；`deploy-hotfix.yml` 同样被 `parity` job 把关；合回 `stage` 时把清单一起带回，`stage ≥ main` 照常成立。清单里有历史欠账时，hotfix 要么先把它们做完，要么由所有者逐条豁免并留原话，不由 agent 取舍。

## 八、对 agent 的要求

动手前：读本文、`deploy/parity/ledger.json`（看哪些还是 `pending`）、对应环境的 env 模板。

必须做：

- 任何地址、端口、签发者、镜像仓库从 env 文件或 `deploy/environments.json` 读；改了环境相关的文件先跑 `pnpm check:env-isolation`。
- 在预发布做了不在提交里的事，当场 `parity.mjs add`；在正式做完，当场 `parity.mjs done`，两边的证据都是命令和真实输出。
- 发版或 hotfix 前跑 `parity.mjs check --release`；发版后跑 `smoke`，晋升同一提交时再跑 `compare`；输出贴进 PR 或 issue。
- 报告里把 `pending` 条目、没跑的检查、依赖所有者的动作单独列出，不写成已完成。

禁止：

- 在代码、工作流、宿主片段里写另一个环境的域名，或为了让检查通过去扩大 `origin-exceptions.json` 而不写理由。
- 预发布做了而正式没做就打正式 tag 或派发 hotfix；把「预发布没问题」当成「正式也做了」。
- 用 `waive`、`not-applicable` 绕过清单，改 `parity.mjs`、`smoke.json` 或检查脚本来换绿色。
- 把预发布的数据行或数据库文件复制到正式，或为了让两边「看起来一样」去同步用户内容。
- 手写对正式库的 UPDATE，手工改运行中的栈，或把 `.env.dev` 之外的真实密钥写进任何入库文件。
- 为了改线上登录目标机：宿主层与一次性运维操作必须有流水线路径（第十节），清单条目的 `production.action` 写的是那条路径，不是 ssh 命令。
- 替所有者决定豁免、替所有者填写验收。

## 九、死接口

死接口是服务端注册了、但没有任何调用方的路由。调用方只有这几类：页面（portal、console、forum）、CLI、`scripts/` 和 `deploy/` 里的脚本与反代配置、外部协议（OIDC、OAuth 回调、健康检查、`/release.json`）、服务端自己发出的链接（邮件、重定向）。测试和文档不算调用方，mock 不算，注释里的路径不算。

发现与清理：

1. 以 `docs/architecture/catalog/catalog.json` 的显式路由为全集，逐条在上述调用方里查。路径常由基址加相对段拼成（`/api/forum` + `/posts/${id}/like`、`/api/teams/${id}/${action}`），只搜完整路径会漏，找不到时按末尾两段再查一遍，并确认命中的文件确实被别处引用。
2. 查不到调用方的路由，连同 `contracts.ts` 的条目、`ownership.json` 的业务流程、测试、`endpoint-contracts.md`、`API.md`、`data-model.md` 里的说明一起删；表和数据不动。测试改成断言该地址返回 404。
3. 已退役、返回 410 的旧地址（例如旧论坛接口）是给旧链接的明确答复，不算死接口，不随手删；要删由所有者决定。
4. 目录由 `pnpm catalog:generate` 重新生成，不手改；清理写进当次 PR 的 `docs/changes/<issue>.json`。

## 与其它规范的关系

分支模型与 hotfix 流程见 [BRANCHING](BRANCHING.md)；发版与回滚见 [RELEASES](RELEASES.md)；env 字段契约、密钥清单见 [ENVIRONMENTS](../ops/ENVIRONMENTS.md)；部署工作流与 job 职责见 [CICD](../ops/CICD.md)；备份与演练见 [BACKUP](../ops/BACKUP.md)；审查清单见 [CODE-REVIEW](CODE-REVIEW.md) 第 15 项。实现：`scripts/check-env-isolation.mjs`、`scripts/parity.mjs`，测试在 `tests/tooling/env-isolation.test.ts`、`tests/tooling/parity.test.ts`。机器检查不证明语义正确：检查通过只说明登记过的、写出来的东西满足规则。

## 十、不靠 SSH：宿主与一次性运维也走流水线

目标机的 SSH 只在部署流水线手里。开发者没有它，也不该需要它：任何要在宿主或线上库上做的事，都要在仓库里有一条流水线路径，并且在 CI 里用假的 docker、systemctl、curl 演练过。

| 要做的事 | 仓库里的路径 | CI 怎么测到 |
|---|---|---|
| systemd 单元、隧道看门狗覆盖项、CDN 镜像脚本等宿主层物料 | `deploy/remote/install-host.sh`（`plan` 只读比对、`apply` 备份后覆盖并 daemon-reload、`verify` 核对一致与 systemd 状态）；`deploy-preview/production/hotfix.yml` 在栈部署成功后自动运行（物料落在 `/opt/yzgc/host-incoming-<运行编号>`，preview 与 production 同时发布互不踩；这一步失败让部署 job 变红，随后的线上烟测 job 因此被跳过：先按 `docs/ops/DEPLOY.md` 查宿主层，再在本机运行 `node scripts/parity.mjs smoke --origin <正式 origin> --env production` 补做线上核对，只读 HTTP，不需要登录目标机），镜像凭据由环境 secret `CDN_MIRROR_ACCESS_KEY_ID`、`CDN_MIRROR_SECRET_ACCESS_KEY` 经 stdin 写入 | `tests/tooling/install-host.test.ts`：临时根目录加假 systemctl，覆盖 changed/missing、备份、凭据 0600 与不回显、绝不重启服务 |
| GitLab 统一登录改接（登记客户端、搬 `sub`、换签发者与 secret、回滚） | `deploy/gitlab/cutover.sh`，由 `gitlab-cutover.yml` 手动触发（production 环境审批，缺省演算，勾 `apply` 才写） | `tests/tooling/gitlab-cutover.test.ts`：假 docker 与 curl，覆盖前置检查、备份、回滚、不回显 secret |
| GitLab 独立预发布与香港入口 | `gitlab-cutover` 的 `install-preview` 与 `edge-*`；首次受限通道由所有者单独批准，经 `install-host.sh --target edge` 安装，后续密钥只执行固定动作；预发布动作不改正式Caddy块 | `tests/tooling/gitlab-preview.test.ts`：真实CLI、临时根、失败恢复、漂移拒绝与受限命令；真实Caddy解析另验 |
| 正式 GitLab 搬到正式入口的 `/gitlab`（#335） | `gitlab-cutover` 的 `path-status`、`move-production-path`、`rollback-production-path`：`deploy/gitlab/move-path.sh` 串起 Arch 的 `cutover.sh *-production-path`（`production-path.py` 渲染 Compose、改 `gitlab.rb` 三行与地址文件，重建容器等健康）和香港接收器的 `production-*`（正式块加 `/gitlab`，旧主机换成 301）；先后各一次 GitLab 一致性备份，搬家前记账号基线，新回调先加，公网核对与账号核对（抽样 `sub` 摘要不变、没有多出不是成员号的 GitLab 账号）全过才去旧回调，任一步失败两半都恢复；只改正式库，改回调前确认正式 server 认得 sector 钉住。先经 `deploy-hotfix` 发 server，再搬家。接收器升级（`install-host.sh --target edge` 带 `--edge-production-env-file`）由所有者单独批准 | `tests/tooling/gitlab-cutover.test.ts`（假 docker、systemctl：正常、健康检查失败恢复、OIDC 更新失败、旧版本与签发者不对时拒绝、账号核对、收尾、回滚）、`tests/server/oidc.test.ts`（金值 `sub`、抽样摘要、安装的 oidc-provider 的多主机规则）、`tests/tooling/gitlab-preview.test.ts`（真实接收器 CLI、临时根、双块互不影响、失败恢复、漂移拒绝）、`tests/tooling/gitlab-move-path.test.ts`（假两半与假 curl：核对失败两半都恢复）、`tests/tooling/install-host.test.ts`；真实 Caddy 解析与真实 GitLab 另验 |
| 预发布到正式的数据格式迁移、一次性数据修复 | 先写成带演算模式的脚本放进仓库，再接进上面这类工作流 | 临时库上的测试 |

凭据的第一次生成（例如在 Garage 上建只读密钥、在 GitLab 上建访问令牌）需要对应系统的管理员权限，不在流水线里：生成后只写进 GitHub 环境 secret，之后的安装与轮换都走流水线。清单条目里要写明这一步由谁、用什么命令做。

确实只能手工的步骤（例如 DNS 控制台）在条目里写明「所有者手工」，不假装有流水线路径。紧急情况下不得不登录目标机时，事后在 issue 里记录做了什么，并补上对应的流水线路径和测试，让下一次不再需要。
