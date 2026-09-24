# ADR-0004：审查机器人作为独立部署目标跑在 crosery-arch

> 组织审查机器人（`app/bot`）不进 preview/production 两套栈，单独部署在另一台机器 crosery-arch 上：用 Docker 运行，每个 PR 任务开一台临时 VM。本文说明为什么开这个例外，以及部署、配置、密钥、网络和授权怎么安排。

状态：`proposed` · 更新：2026-09-25 · 适用：`app/bot` 与它在 crosery-arch 上的部署；依据 [#38](https://github.com/Yangtze-University-Geek-Class/admin/issues/38) 及其子 issue #44–#52。

## 背景

所有者 2026-09-24 要求：组织里每个仓库的每个 PR 都由机器人审查，机器人按分配规则接手 issue，并能自己开修复 PR；每个任务在沙箱 VM 里跑，结束即销毁。2026-09-25 补充：issue 不开 VM，只有 PR 相关的工作开 VM。规则见 [TRACKING](../conventions/TRACKING.md) §6。

现行模型是：同一套 compose 模板在同一台机器上跑两套栈（[ADR-0001](0001-modular-monolith.md)、[DEPLOY](../ops/DEPLOY.md)）；环境变量只走 `deploy/env/.env.production|preview`（[AGENTS](../../AGENTS.md) §3）。机器人放不进这个模型，原因有三：

- **安全隔离**。机器人要检出并执行别人 PR 里的不可信代码，还持有机器账号令牌和模型网关密钥。这些不能和正式环境的数据库、OAuth 密钥放在同一台机器上。
- **不同主机**。每个任务都要开 KVM 虚拟机。crosery-arch 有 `/dev/kvm`（AMD 8845H，开了嵌套虚拟化），正式站那台机器没有核对过。
- **不同的发布节奏**。机器人不对外服务，不跟官网的 `vX.Y.Z` 发版走。

[MODULAR-DEVELOPMENT](../conventions/MODULAR-DEVELOPMENT.md)「拆分尺度」写明：出现不同部署周期、安全隔离需求时，才评估独立服务。本例正是这种情况。

## 决策

标「待所有者定」的项给出推荐做法；所有者在审查本 ADR 时定下来，再把状态改成 `accepted`。

### 1. 为什么开例外

理由见「背景」。例外只针对 `app/bot` 这一个服务，不改变 web/server/forum 的交付方式。

### 2. 部署目标

| 项 | 值 |
|---|---|
| 主机 | crosery-arch：所有者家里的 Arch Linux 笔记本，经 NetBird 组网访问，没有入站端口 |
| 栈根 | `/opt/yzgc/bot` |
| compose 项目 | `yzgc-bot` |
| 镜像 | `yzgc-bot/bot:<sha12>`，与 `yzgc-preview/*`、`yzgc-production/*` 分开 |
| 运行方式 | 只用 Docker compose；同一个镜像按角色起几个容器（调度、VM 执行、模型代理、GitHub 写入），不用 systemd、pm2 或手工 node 进程 |

### 3. 非密配置

- 新增第三份模板 `deploy/env/.env.bot`。它只写非密值：栈根、compose 项目名、`IMAGE_TAG`、轮询间隔、静默窗口、等回复的天数、VM 规格、网关地址、上报的控制台 origin。
- `scripts/deployment-environment.mjs` 给它单独写一套字段白名单和校验；不把 bot 加进 `ENVIRONMENTS`、`IMAGE_SERVICES` 和 `deploy/environments.json`，否则两套栈的部署归档也会被要求带上 bot 镜像。
- AGENTS §3 写明这个例外：只有 `.env.bot`，而且要等本 ADR `accepted` 后才能入库。
- 否决的方案：把配置值写死在 compose 文件里。这样做值就分散了，也没有契约校验。

### 4. 密钥

| 密钥 | 用途 | 挂给哪个容器 |
|---|---|---|
| `GEEK_BOT_MODEL_API_KEY` | 模型网关密钥 | 模型代理 |
| `BOT_GITHUB_READ_TOKEN` | 机器账号只读令牌，用于轮询 | 调度 |
| `BOT_GITHUB_WRITE_TOKEN` | 机器账号读写令牌，用于评论、推送、开 PR | GitHub 写入 |
| `BOT_INGEST_TOKEN` | 向控制台上报时的 Bearer 令牌，值与目标环境 server 的同名密钥相同 | GitHub 写入（兼上报） |
| incus 客户端证书与私钥 | 只能操作 `yzgc-bot` 项目 | VM 执行 |

- 存放：crosery-arch 的 `/root/.agents/crosery/credentials/<名字>`。目录 0700，文件 0600，一个密钥一个文件，与所有者 Mac 上的布局一致。值由所有者自己放，不经过聊天、仓库或 CI。
- 注入：compose 的 `secrets:` 以只读文件挂进对应容器。不走环境变量，不进镜像、VM、日志、issue 或 PR。
- 轮换：替换文件后执行 `docker compose up -d` 重建容器。GitHub 令牌设置不超过 90 天的有效期。
- 不用 GitHub Environments：组织是免费计划，私有仓库建不了 Environments（见 [CICD](../ops/CICD.md)「平台能力实测」），也就没有环境级 secrets。
- 现有的密钥名检查（`SECRET_KEY_RE`）认不出 `*_API_KEY` 结尾的名字，由 #51 收紧这条检查。

### 5. 镜像构建与分发

- 在 GitHub 托管 runner 上构建（`ci.yml` 的 docker job 加 bot 镜像），构建产物是 `docker save` 归档加 `.sha256`。crosery-arch 直连 Docker Hub 超时，不在它上面构建。
- **待所有者定**：推荐由维护者用 `gh run download` 取下归档，经 NetBird 复制到 crosery-arch。这样 crosery-arch 上不需要能读 Actions 的令牌。备选是推到 ghcr.io 再由 crosery-arch 拉取，但这背离「镜像不推 registry」的现有约定。
- 不在 crosery-arch 上装 GitHub 自托管 runner：CICD 规范禁止在持有凭据的机器上跑不可信 PR。

### 6. 上线、授权与回滚

- 机器人不跟 `vX.Y.Z-rc.N` / `vX.Y.Z` 发版，这两类 tag 只部署两套栈。
- **待所有者定**：推荐只从 `stage` 上 CI 通过的提交部署。所有者按提交 SHA 授权一次上线，维护者在 crosery-arch 执行仓库里的 `deploy/remote/deploy-bot.sh`：校验 sha256，`docker load`，`compose up`，健康检查；失败就切回上一版，并写一行部署记录。
- 没有从 GitHub 到 crosery-arch 的推送通道，所以不存在自动部署；也不设部署开关。
- 回滚：`deploy-bot.sh --to <sha12|previous>`，只在本机已有的 `yzgc-bot/bot:*` 镜像里找，保留最近 3 个。

### 7. VM

- 用 incus 管理 qemu/KVM 虚拟机（Arch extra 仓库有 incus 包）。
- 受限项目 `yzgc-bot` 的配额：最多 1 台实例，只允许 VM，1 vCPU、2 GiB 内存，磁盘上限 20 GiB，只能用指定镜像源。规格依据是 #38 的实测：限 1 核、2 GiB 时 admin 的 `pnpm verify` 通过，用时 179 秒，内存峰值 1.36 GB。在真实 VM 里的数字由 #48 核实。
- 容器通过 incus 的 HTTPS 接口（只监听 `127.0.0.1`）控制 VM，用一张只能操作 `yzgc-bot` 项目的受限证书。不把 incus 的 unix socket 挂进容器，因为拿到这个 socket 就等于拿到宿主 root。
- 两条通道：
  - **PR 通道**：审查、开修复 PR、机器人自己 PR 的返工。每个任务一台新 VM，结束即销毁；同一时间 1 台。
  - **issue 通道**：受理、追问、判断回复、关闭、改写重开。不开 VM，在容器里跑 omp，只给只读工具，不能执行代码。
- VM 里没有 GitHub 令牌和网关密钥。代码由宿主取好送进去；修复产出的改动由宿主推送。

### 8. VM 网络

- 专用网桥 `incusbr-bot`，固定 `10.199.0.1/24`，不开 IPv6。
- 允许：DNS、宿主上的模型代理端口、公网 443（GitHub、npm 源）。
- 禁止：宿主上的其它服务端口，以及家庭局域网、NetBird、tailscale 三个网段。具体端口和网段写在主机运维文档里（#48）。
- 宿主的 FORWARD 默认是 DROP（iptables 规则开机恢复，Docker 也会设 DROP），要为网桥持久放行。网络 ACL 能不能管住「VM 到宿主」这个方向，装好后实测，管不住就加宿主 INPUT 规则。

### 9. 状态怎么送到控制台

- 控制台后端在另一台机器上，不在 NetBird 里；crosery-arch 没有入站端口。所以由机器人主动出站，用 HTTPS 调 `app/server` 的 `/api/bot/*`（Bearer `BOT_INGEST_TOKEN`，接口见 #45）。心跳每 3 秒以内一次，日志每 2 秒以内一批，控制台每 3 秒轮询，端到端延迟不超过 10 秒。
- **待所有者定**：推荐只上报 production。机器人操作的是真实的 GitHub 组织，状态只应有一份；preview 的控制台页显示「未接入」。
- 以哪边为准：
  - 队列和历史以机器人为准，存在机器人自己的数据卷里；server 只存一份镜像，并充当命令邮箱。
  - 模型池以 server 为准，控制台修改，机器人按版本读取。
- 控制台不可达时，机器人照常工作，用最后一次拿到的模型池；状态和日志在本地缓存（有上限），恢复后按序号补发。

### 10. GitHub 身份与权限

- 身份：所有者注册的机器账号，加入组织（GitHub App 的 `[bot]` 身份不能被分配 issue）。
- 仓库角色（所有者 2026-09-25 同意）：admin 给 Write；hospital-scorad、geekrouter、geek-cli、.github 给 Triage（打标签、关 issue 需要，推不了代码）。
- 令牌：fine-grained PAT，资源所有者选本组织，只选这 5 个仓库。
  - 写令牌：Metadata 读，Contents、Issues、Pull requests 读写。
  - 读令牌：以上全部只读。
  - 都不给 Workflows、Actions、Administration。不给 Workflows 权限，GitHub 会拒绝推送含 `.github/workflows/**` 改动的提交。
- 免费计划没有分支保护和 rulesets（接口返回 403），GitHub 不会拦截推 `main`、`stage` 或 tag，而推 `vX.Y.Z` tag 会直接触发部署。挡住这些的只有机器人自己的写入白名单（#50）：只推 `task/<n>/<slug>`，不带 tag，不强推；review 只发 `COMMENT`；不合并、不批准、不改别人的 PR 正文。

### 11. 可用模型与思考档位

- 以 crosery 模型目录 `~/.agents/crosery/catalog.json` 为准。它只由 `sync.mjs` 一个实现生成；机器人是它的一个新使用方，只读这个文件，不自己请求网关的 `/v1/models`，不另建第二份模型表。
- 思考档位只能选该模型在目录里声明的档位。
- 机器人在心跳里把可用模型和档位报给 server，控制台编辑模型池时只能在这个范围里选。
- **待所有者定**：crosery-arch 上的目录从哪来。推荐在 crosery-arch 上也按 `~/.agents/crosery` 的布局运行同一份 `sync.mjs`，这是所有者共享层的部署，不属于 yzgc 的栈，挂载进 bot 容器只读使用。备选是由 Mac 定期推一份只读副本过去。

### 12. 主机改动

crosery-arch 当前没有 incus 和 compose 插件，要装包就得先全量升级（同步库停在 2026-08-23）。此外 FORWARD 是 DROP，btrfs 设备未分配空间只剩 7.97 GiB，CPU 温度 94°C。需要的 12 项改动逐条列在 #48，**每一项都要所有者批准后才执行**，执行结果贴回 #48。

## 后果

- 部署目标从两个变成三个。第三个在另一台机器上，没有 GitHub 审批门禁，也没有部署记录 API；它的授权和记录只靠所有者按提交授权，以及 `deploy-bot.sh` 写在本机的部署记录。
- 多一份配置模板和一套校验；AGENTS §3、[DEPLOY](../ops/DEPLOY.md)、[ENVIRONMENTS](../ops/ENVIRONMENTS.md)、[CICD](../ops/CICD.md) 要各写一段。
- crosery-arch 是笔记本，走 Wi-Fi，还跑着别的服务，不能当作有服务等级保证的机器。机器人要在重启后能恢复队列；它不可用时，只是 PR 没人自动审，不影响官网和论坛。
- 残余风险：
  - 写入白名单有漏洞时，GitHub 端没有第二道防线；
  - VM 逃逸会直接暴露宿主；
  - `BOT_INGEST_TOKEN` 泄露后可以伪造控制台上的机器人状态，但拿不到任何 GitHub 权限。

## 重新评估条件

- 队列长期积压（例如等待超过 1 小时成为常态）：评估并发 VM 或换机器。
- GitHub 升级到能用分支保护、rulesets、Environments 的计划：把「不推 `main`/`stage`/tag」和部署密钥移到服务端强制。
- GitHub App 能被分配为 issue 负责人：评估用 App 替代机器账号。
- crosery-arch 不可用、温度或磁盘长期告警：迁到专门的服务器。

## 实施状态

截至 2026-09-25 都**未实施**：没有 `app/bot` 代码、`.env.bot`、compose、部署脚本，crosery-arch 上也没做任何改动。实施分在：#44（本 ADR 与规范）、#45（server 接口）、#46（控制台页面）、#47（调度）、#48（主机与 VM）、#49（VM 里跑 omp）、#50（GitHub 写入与上报）、#51（上线与机器账号）、#52（组织默认规范与标签）。
