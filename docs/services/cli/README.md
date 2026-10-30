# CLI 服务合同（`app/cli`）

> 极客班命令行 `geek`（Rust）：设备码登录、论坛/比赛/代码仓库只读与写操作、给 Claude Code/Codex/omp 装一份极客班技能（#277）。独立工具链，不进 Node 工作区；产物不单独成镜像，随 `app/web` 镜像的 `/cli/` 路径分发。

状态：`current` · 更新：2026-10-30 · 源码：`app/cli/` · 产物：`dist/cli/`（随环境镜像 `yzgc-production/web` 或 `yzgc-preview/web` 的 `/cli/` 路径分发）；本合同不证明某个已发布镜像实际含 CLI。

## 源码地图

| 路径 | 职责 |
|---|---|
| `app/cli/Cargo.toml` | Rust 包名/版本、依赖及 release profile；5 个发布目标由 `scripts/cli-dist.mjs` 定义，不进入 Node/pnpm 工作区 |
| `app/cli/build.rs` | 编译期把极客娘抠图（`app/web/sites/portal/assets/mascot/geek-girl.webp`，缺失时退到 `app/cli/assets/boot-mascot.webp`）转成盲文点阵常量，写进 `$OUT_DIR/mascot_braille.rs`；源图缺失或读不出时输出空数组，不让构建失败 |
| `app/cli/src/config.rs` | 源站优先级 `--env production\|preview` > `GEEK_ORIGIN` > 默认正式 `https://yangtzeu.work`；预发布为 `https://prev.yangtzeu.work`，每次调用独立选择 |
| `app/cli/src/token_store.rs` | `GEEK_TOKEN` 优先、不落盘；其次系统 keyring，失败退 `dirs::config_dir()/geek/credentials`（Unix 0600）。macOS 实际路径为 `~/Library/Application Support/geek/credentials`，Linux 为 `$XDG_CONFIG_HOME/geek/credentials`（未设时 `~/.config/geek/credentials`）；`GEEK_NO_KEYRING=1` 跳过 keyring |
| `app/cli/src/api.rs` | HTTP 封装：状态码 → 退出码映射，`email_required`/`profile_required` 的提示语 |
| `app/cli/src/output.rs` | `--json` 与人读两种输出的统一出口（`{ ok, data }` / `{ ok:false, error:{code,message,retry_after?} }`） |
| `app/cli/src/commands/` | `login`（RFC 8628 设备码）、`logout`（调 `/auth/device/revoke`）、`whoami`、`status`（本机登录状态）、`forum`（list/show/post/reply）、`comp`（list/show/mine/signup/ladder/plaza；给人看的输出里状态换成中文，含 #278 的「规划中」，`--json` 仍是接口原值）、`team`（create/apply）、`repo`（list）、`apply`（status）、`skill`（install） |
| `app/cli/src/ui/login_anim.rs` | 登录动画（见下文「登录动画」），behind `LoginAnimation` trait；非 TTY/`NO_COLOR`/`--json` 时用 `NullAnimation`，什么都不画 |
| `app/cli/src/ui/braille.rs` | 运行时把头像转成盲文点阵（kitty/iTerm2 图像协议不可用时的退路） |
| `app/cli/skills/geek/SKILL.md` | 内嵌进二进制（`include_str!`）；`geek skill install` 按 harness 默认目录或显式目录覆盖安装，已有技能不覆盖（见下文「技能安装」） |
| `app/cli/tests/skill_install.rs` | 通过真实 `geek skill install` 命令、隔离 HOME 验证目录解析、OMP profile 优先级、幂等、自定义技能及符号链接保护；不访问业务 API |
| `app/cli/tests/device_protocol.rs` | 合成 loopback HTTP 与真实 CLI，覆盖设备码、pending/denied/expired、资料、吊销后401、吊销失败与非TTY验证码；不连接真实账号 |
| `app/cli/tests/offline_credentials.rs`、`app/cli/src/test_env.rs` | 离线失败退出码与环境变量测试的独立进程隔离；不共享 HOME、环境变量或钥匙串 |

模块与服务端的桥接在 `app/server`：`app/server/src/middleware/bearer-auth.ts`（见 [server 合同](../server/README.md)）。

## 迁移与包元数据

- 现行 CLI 是 `app/cli` 的 RFC 8628 设备授权实现，Rust/Cargo 与核心 Node22/pnpm9、论坛 Node26/pnpm11 分开；不要拿旧 `../geek_cli` 的 GitHub Device OAuth 实现或锁文件覆盖它。
- 当前 Cargo 包 `geek-cli` 的版本为 `0.1.0`，分发器读取该字段，不从根应用发布版本推算；迁移不自行升号。Cargo `repository` 跟着 GitLab 搬到正式入口的路径（#335）：`<正式 GITLAB_URL>/geek/admin`，旧主机只做 301；仅改元数据，不改变 CLI 行为或依赖。
- token 按 origin 分开存，网页域名未变不等于设备授权已验；用预发布 token 不代表后续无 `--env` 的命令仍选预发布。迁移验收所有命令都显式 `--env preview`，不读取/复制个人凭据文件，也不把 token 写进命令行或报告。
- 同版本镜像的 `/cli/install.sh`、`latest.json`、目标二进制和 `.sha256` 必须相互对应；CLI 版本号不是二进制缓存键，同一 `0.1.0` 重新构建时内容不同就必须得到不同的摘要文件名，不能覆盖旧文件或继续复用已缓存一年的旧 URL。先核对已发布物料再验安装、允许/拒绝/过期/撤销及真实 harness 技能加载。Arch 迁移不改变 CLI 服务端权限或自动补齐 CI 缺少的跨平台产物。


## 契约：身份与权限

- **登录**：RFC 8628 设备码授权，`client_id=geek-cli`，`scope=openid profile forum apply competition repo`；复用服务端既有的 `/auth/device/code`、`/auth/device/token`、`/auth/device/userinfo` 三个端点（见 [API](../../architecture/API.md)「geek 命令行令牌」）。
- **令牌 = 会话**：服务端 `bearer-auth.ts` 把 `Authorization: Bearer <token>` 换成和 cookie 会话同形的 `req.session`，下游所有既有的权限中间件（`requireAuth`、`requirePermission`、`requireCompetitionAccess`、论坛的 `forumViewer`/`requireWriter`）不用改。一个请求同时带 cookie 和 Bearer 是 400 `mixed_credentials`。
- **三道独立的闸**：
  1. **scope**（粗粒度，按 URL 前缀）：`forum`→`/api/forum/*`，`apply`→`/api/teams/*`、`/api/me/applications`，`competition`→`/api/competitions/*`、`/api/me/competitions`，`repo`→`/api/public/gitlab/*`；没申请对应 scope 是 403 `insufficient_scope`。
  2. **默认拒绝**：令牌只认上面四类 scope 接口、`/auth/device/userinfo`、`/auth/device/revoke`、`/api/public/*` 的 GET/HEAD 和 `GET /api/console/me`；控制台、账号页、`/auth/me`、OIDC 这些带令牌一律 403 `cli_not_allowed`（退出码 4）——令牌放在终端和 agent 的环境变量里，泄露的面比浏览器会话大，不能拿它改账号或做管理操作。令牌挂出的会话 `created_at` 固定为 0，永远不算「刚登录过」，过不了任何 step-up（改密码、绑邮箱这类需要「刚登录过」的操作本来就不在上面的允许列表里，这是双重保险）。
  3. **权限节点**（细粒度，和网页一样）：有 scope 不代表有权限，比如注册用户有 `forum` scope 也能发 `POST /api/forum/topics`，但权限节点 `forum.topic.create` 不够照样被 `requireWriter` 拒绝（403 `forbidden`，`activity_events` 记一条 `http.forbidden`，CLI 侧退出码 4）——这是 acceptance #3「注册用户发帖被权限拒绝、错误可读」的来源。
- **邮箱闸与资料闸**：业务接口统一经 `cliGate()`（`bearer-auth.ts` 一处调用 `lib/email-gate.ts` 的 `gateRefusal()`），先判没绑邮箱（403 `email_required`），再判缺姓名或年级（403 `profile_required`，#280）；`GET /auth/device/userinfo` 与 `POST /auth/device/revoke` 不算业务接口，不受这道闸限制（否则办不完这两项的账号退不出登录）。`/auth/device/userinfo` 额外带 `grade`/`grade_label`（年级展示用）——但不带 `real_name`，**命令行在任何接口下都拿不到任何账号的真实姓名，哪怕是本人**（硬约束）。CLI 侧见到 `email_required`/`profile_required` 退出码 4，`geek login`、`geek whoami`、`geek status` 会打印去哪个页面补的提示，不读取或打印姓名等个人信息之外的任何字段。
- **限额与操作记录**：命令行调用计入既有的按账号每日限额（`lib/limits.ts` 的 `cli.*` 桶）；成功的业务请求记一条 `surface:'cli'` 的 `activity_events`（动作名 `cli.<method>`，如 `cli.get`/`cli.post`），控制台「操作记录」能看到 CLI 的登录与接口调用（acceptance #6）。
- **撤销**：`geek logout` 调 `POST /auth/device/revoke`（30 次/分钟），只改 `token_expires_at`，RFC 7009 式幂等——令牌缺失、不存在、已撤销、已过期都回 200 `{ok:true}`，不回答「这个令牌是否存在过」；撤销后同一个令牌调任何接口都是 401（acceptance #6）。
- **撤销失败**：服务端未确认成功时保留本机凭据并非零退出（网络错误6、服务端错误按 API 映射），不能吞掉错误后打印「已退出」。成功后才清理本机对应源站记录；环境变量 `GEEK_TOKEN` 仍由调用者管理。
- **退出码**：0 成功，2 用法错误，3 未登录，4 被拒绝（权限/scope/邮箱闸），5 限流，6 网络错误，1 其它。

## 契约：命令范围

论坛、比赛、代码仓库、投递四类只接入**既有**端点；`GET /api/me/applications`（给 `geek apply status`）是这次唯一新开的接口，加在 `app/server/src/routes/portal/my-applications.ts`，不动既有业务规则：

| 命令 | 端点 | 说明 |
|---|---|---|
| `geek whoami` | `GET /auth/device/userinfo` + `GET /api/console/me` | 账号、公开用户名/昵称/简介/头像、部门、年级；新版公开资料优先 userinfo，邮箱或资料没补齐时仅跳过部门查询、仍展示可用公开资料并打印提示 |
| `geek status` | `GET /healthz` + `GET /auth/device/userinfo` | 不要求已登录；本机令牌来源、源站、服务端连通性、令牌是否有效 |
| `geek forum list` | `GET /api/forum/state` | 板块与话题摘要 |
| `geek forum show <topic_id>` | `GET /api/forum/topics/:topic_id/posts` | 一个话题的全部帖子（含正文），不需要登录 |
| `geek forum post` | `POST /api/forum/topics` | 受权限节点 `forum.topic.create` 约束 |
| `geek forum reply <topic_id> --content <...>` | `POST /api/forum/posts` | 受权限节点 `forum.reply.create` 约束 |
| `geek comp list` | `GET /api/public/competitions` | 公开比赛列表，不需要登录 |
| `geek comp show <id>` | `GET /api/public/competitions/:id` | 单场比赛，不需要登录 |
| `geek comp mine` | `GET /api/me/competitions` | 当前账号报名的比赛 |
| `geek comp signup <id>` | `POST /api/competitions/:id/signup` | 受权限节点 `competition.signup` 约束 |
| `geek comp ladder <id>` | `GET /api/competitions/:id/leaderboard` | 需要登录，且持有报名或组队任一权限 |
| `geek comp plaza [--competition <id>] [--kind recruiting\|seeking] [--keyword <词>]` | `GET /api/team-plaza`（#278） | 需要登录，且持有报名或组队任一权限；令牌按 `competition` scope 放行（`bearer-auth.ts` 的前缀表） |
| `geek team create <competition_id> --name <...>` | `POST /api/competitions/:id/teams` | 受权限节点 `competition.team` 约束 |
| `geek team apply` | `POST /api/teams/{id}/apply` | 报名 |
| `geek repo list` | `GET /api/public/gitlab/projects` | 公开代码仓库列表 |
| `geek apply status` | `GET /api/me/applications`（新） | 按登录邮箱匹配招新投递；没绑邮箱是空列表，只回 id/status/created_at |

## 技能安装

`geek skill install --target claude|codex|omp|all` 只把内嵌技能安装到目标目录，不需要网络、
账号令牌或本机源码，也不读取凭据文件或钥匙串（凭据损坏不影响安装）。默认 `all`，单个目标不会写入其它 harness：

| 目标 | 默认技能文件 | 配置根目录覆盖 |
|---|---|---|
| Claude Code | `~/.claude/skills/geek/SKILL.md` | `CLAUDE_CONFIG_DIR`，先去除首尾空白 |
| Codex | `~/.codex/skills/geek/SKILL.md` | `CODEX_HOME` |
| OMP | `~/.omp/agent/skills/geek/SKILL.md` | `PI_CODING_AGENT_DIR` |

空目录覆盖使用默认值。相对目录基于运行命令时的 cwd；OMP 的目录覆盖不展开字面量 `~`。
OMP 18.12.6 的 `PI_CONFIG_DIR` 是 HOME 下配置目录名（默认 `.omp`）；
命名 `OMP_PROFILE`（未设置时兼容 `PI_PROFILE`）写到
`<HOME>/<配置目录名>/profiles/<profile>/agent/skills/geek`，优先于 `PI_CODING_AGENT_DIR`。
空白或 `default` profile 使用默认 agent 根目录或显式 `PI_CODING_AGENT_DIR`；
无效 profile 名称在写入前报错。安装器不修改任何全局 profile、harness 配置或其它目标的文件。

安装用 `create_new` 防止覆盖已有 `SKILL.md`、文件符号链接和并发安装；
`geek` 目录本身是符号链接时也跳过，避免写进自定义技能目录。
内容相同的已有文件同样不重写；旧 `~/.omp/skills/geek` 保持原样，不自动迁移、覆盖或删除。
成功 JSON 的 `data` 为 `{ installed: string[], skipped: string[] }`，
分别记录本次新建和保留的技能文件路径；重装时新建列表为空仍是成功，文件系统错误返回
`skill_install_failed`（退出码 1）。保留自定义技能不代表它的内容等同于内嵌版本。

局部命令回归：`cargo test --manifest-path app/cli/Cargo.toml --locked --offline --test skill_install`。
真实 harness 验收另用隔离 HOME、仓库外 cwd 运行 OMP 原生 `read skill://geek`，
不得以手工读取 Claude 目录、设置非默认 agent 目录或一次模型连通代替默认发现。
Rust 测试通过不等于已执行真实 OMP/Claude/Codex 会话；两类证据分别记录。

## 公开资料与头像消费者（GitHub #271）

`login` 与 `whoami` 优先从 `/auth/device/userinfo` 读统一公开资料：`username/display_name/bio/avatar_url`，保留 `account_id/login/scope` 等旧字段。空昵称回退登录名，不打印 real_name；`/api/console/me` 用于补部门。邮箱/资料闸为 true 时只跳过会被拒绝的部门请求，不让公开昵称与头像一起消失。`whoami --json` 新增 username/bio，人读输出增加用户名与非空简介；其 avatar_url 保留服务端字符串，可能是相对路径。

登录动画下载头像时用源站 URL 解析相对路径，公开下载不带设备 Bearer，HTTP client 不跟随跳转。拒绝空值、首尾空白、协议相对 `//`、反斜线、控制字符和 URL 凭据；接受 HTTPS，HTTP 只用于本身就是 HTTP 的本地源站且必须同源。下载失败仅不画头像，不改变登录结果/权限/业务错误退出码。此下载校验不等于 `whoami` JSON 输出 URL 的校验。

源码为 `commands/login.rs`、`whoami.rs`；定向消费者回归 `app/cli/tests/profile_consumers.rs`，服务端对应 `tests/server/public-profile-consumers.test.ts`。缺新增字段的旧版响应仍从 console/me 补昵称、无昵称再退登录名；TCP 集成测试需要独立本地监听许可，禁止监听的环境只运行编译/非网络单测并显式留未验证项。真实终端图像协议及线上登录需另按实际验收记录确认，不以本文宣称已通过。

## 登录动画（SPEC §6）

`show_letters`（truecolor 渐变画 YUGC 四个字母）→ `show_mascot`（极客娘盲文点阵，`build.rs` 编译期生成）→ `begin_waiting`/`spin`（用户码的框 + spinner，轮询期间每 120ms 推进一帧；框的边框按两行内容的显示宽度算，中文占 2 列，网址再长也对齐，#289）→ `show_welcome`（确认后头像，kitty/iTerm2 内联图像协议优先，不支持就落到运行时盲文头像，加「欢迎回来，&lt;昵称&gt;」）。非 TTY、`NO_COLOR`、`--json` 下一律不画（acceptance #4：`geek login | cat` 没有动画也没有控制字符）。

非交互且非 `--json` 的登录仍输出纯文本确认网址与用户码，避免管道或 `NO_COLOR` 模式无法确认。
`--json` 保持只输出最终结构化结果，不在 stdout 混入动画或提示。

## 分发

- **五目标分发器**：`node scripts/cli-dist.mjs` 用本机 `cargo zigbuild`，`node scripts/cli-dist.mjs --container` 用固定 digest 的 `ghcr.io/rust-cross/cargo-zigbuild` 构建容器；两条路径都以 `--locked --jobs 2` 把 5 个目标（`aarch64-apple-darwin`、`x86_64-apple-darwin`、`x86_64-unknown-linux-musl`、`aarch64-unknown-linux-musl`、`x86_64-pc-windows-gnu`）编译、算 sha256，产出 `dist/cli/<version>/geek-<target>-<sha256>[.exe]` 及同名 `.sha256`、`dist/cli/{install.sh,install.ps1,latest.json}`。文件名使用完整摘要：相同内容重建 URL 稳定，不同内容 URL 必然变化；目标路径已经存在时只复用摘要一致的文件，字节不同就失败，不覆盖、不删除旧产物。`dist/` 已被 `.gitignore` 覆盖，产物不进仓库。
- **工具链只是构建依赖**：本机模式仍按约定路径读取 `.tools/zig/zig-macos-aarch64-0.13.0/zig`、`.tools/cargo/bin/cargo-zigbuild`；CI/发版模式的固定容器同时提供 Rust、Zig、cargo-zigbuild 与 macOS SDK。两者都不进入 web 运行镜像，也不新增生产依赖。`node scripts/check-cli-dist.mjs` 独立核对版本、五目标清单、内容寻址文件名、非空资产、manifest/sidecar/实际字节三方 sha256 与两个安装脚本。
- **进入 web 镜像**：`app/web/Dockerfile` 的 `cli` 阶段为 `FROM scratch AS cli`，运行阶段 `COPY --from=cli / /usr/share/nginx/html/cli/`。`ci.yml` 的 docker job 和两条部署工作流都先执行 `node scripts/cli-dist.mjs --container`、`node scripts/check-cli-dist.mjs`，再只给 web 构建传 `--build-context cli=dist/cli`；server/forum 不接收该 context。仓库根 `.dockerignore` 排除 `**/dist`，因此物料只经显式 named context 进入镜像。不传 context 的普通本机镜像构建仍可得到空 `/cli/`，不能作为发布物料验收。镜像内 nginx 的 `/cli/` 路径与缓存策略见 [web 合同](../web/README.md)。
- **安装脚本**：`dist/cli/install.sh`、`install.ps1` 默认源站生产 `https://yangtzeu.work`，`GEEK_ORIGIN` 环境变量覆盖（和 `geek` 自己的源站解析一致），镜像内 nginx 在 `/cli/` 下把脚本里的生产域名换成请求的域名（`sub_filter`，见 [web 合同](../web/README.md)），所以预发布直接 `curl -fsSL https://prev.yangtzeu.work/cli/install.sh | sh` 就从预发布装，`GEEK_ORIGIN` 仍然优先（#289）。生产安装命令（acceptance #1）：`curl -fsSL https://yangtzeu.work/cli/install.sh | sh`。两个脚本从 `latest.json` 的当前目标条目读取文件名和摘要，只接受 `geek-<当前target>-<同一sha256>[.exe]` 或旧 manifest 的精确旧文件名；版本、目标、路径、URL、文件摘要任一不合规就停止，不让 manifest 注入目录逃逸或任意下载地址。随后下载同名 `.sha256`，核对 manifest、sidecar 与实际字节一致并先试运行 `--version`，成功后才覆盖安装位置；只含 `version` 的最早 manifest 仍回退到当前目标的精确旧文件名。
- **macOS 二进制未签名**：curl 下载的文件没有 Gatekeeper 的隔离属性（quarantine，只有浏览器直接下载才会打），可以直接执行，不会跳 Gatekeeper 的「打不开」提示。
- 安装后执行 `geek --version`；二进制无法运行时脚本失败退出，不把校验和成功当成可运行证据。Windows 脚本同样检查 `$LASTEXITCODE`，真实 PowerShell 验证仍单列。

## CI 与本机检查

- `pnpm check:cli`（`scripts/check-cli.mjs`，已经在 `pnpm check` 链里）：只在这个 task 相对 base 真的改了 `app/cli` 时才跑 `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings`、`cargo test`；没改动直接跳过，没装 cargo 的人跑一次 `pnpm check` 不会因为 Rust 工具链报错。task 分支按 `origin/stage` 判断改没改，判断不出 base（不是 task 分支、本机没有 `stage`）时保守地当作「改了」。
- GitHub Actions 的 `ci.yml` 不另开一个 job：`core` job 本来就跑 `pnpm check`，ubuntu-latest 自带 Rust 工具链，`check:cli` 顺带被执行（见 [CICD](../../ops/CICD.md)）。
- `ci.yml` 的 docker job 与两条发布工作流使用同一个 `--container` 分发入口和同一个物料核对器，避免普通 Rust 单测通过但发布镜像仍缺少 `/cli/`。
- 测试里的令牌夹具只用 `gk_` 加不到 16 位的短值（例如 `gk_fixture`），不带随机串；`scripts/check-privacy.mjs` 的令牌形态规则（`gk_` 后 16 位以上）会把长的夹具当作真令牌拦下。

## 运行

```bash
# 均在仓库根；Cargo 是独立工具链，不在 pnpm-workspace.yaml
pnpm cli:build                  # 本机调试目标，locked，jobs=2
pnpm cli:test                   # 串行全测，locked，jobs=2；需 loopback
CARGO_BUILD_JOBS=2 pnpm check:cli
pnpm cli:dist                   # 全量交叉编译 + dist/cli/；先准备 zig/cargo-zigbuild
node scripts/cli-dist.mjs --container && node scripts/check-cli-dist.mjs  # Docker 可用时复现 CI/发版物料
```

## 验证命令

```bash
CARGO_BUILD_JOBS=2 pnpm check:cli # 按改动路径决定要不要跑 cargo 检查
pnpm cli:test
```

真机登录验收（本次文档任务未执行）：所有调用均显式选预发布，`--env` 优先于 `GEEK_ORIGIN`，不会记住上一次 login 的选择：

```bash
geek --env preview login
geek --env preview status --json
geek --env preview whoami --json
geek --env preview comp list --json
geek --env preview forum list --json
geek --env preview logout
```

只在获批隔离账号/环境验证允许、拒绝、过期与撤销；logout 后同一令牌访问 `GET /auth/device/userinfo` 应为 401，控制台能查到 CLI 来源记录。`status`/`whoami` 也会调用服务端，不是纯本地只读检查；测试登录/发帖/技能安装不在本次文档任务执行范围内。

## 已知限制

- **尚未进入本树的 task271 集成前置**：设备 userinfo 新增公开 `username`、`display_name`、`bio`，保留
  `sub/account_id/login/avatar_url/scope/grade_label/email_required/profile_required`，不得加入真实姓名或邮箱。
  task271 负责 canonical DTO、login/whoami 消费者与相对头像解析，昵称优先级为
  `userinfo.display_name → console.display_name → login`，头像下载不带 Bearer。
  本 task 不复制或宣称已经落地该实现；父级整合时保留本 task 登录入口的非TTY提示，再对同账号新旧资料与头像执行集成回归。

- 没有 `geek self update`：这是旧仓库（`~/work_file/geek_cli`）设计过但本次没有实现的功能，不依赖 GitHub Releases；升级就是重新跑一次安装脚本。
- Linux 的 `aarch64`/`x86_64` 都发 musl 静态二进制，没有单独的 glibc 构建；多数发行版能直接跑 musl 二进制，个别极旧的发行版未测试。
- `install.ps1` 的 manifest 选择规则与 Shell/分发核验器共用同一行为回归。有 `pwsh` 的环境（GitHub CI 的 runner、本机装了 PowerShell 7 时）里，`tests/tooling/cli-release-wiring.test.ts` 会用真实 PowerShell 解析生成的脚本并跑恶意 manifest 用例，没有 `pwsh` 就跳过；PowerShell 的转义符是反引号，不是反斜杠，生成脚本里要打印带引号的行时用单引号字符串加 `-f`（#300 修的就是 `\"` 写法导致整份脚本解析失败）。在真实 Windows 机器上下载、校验和替换二进制的完整流程仍未验证。
- 比赛、论坛、投递相关命令只接入现状端点（`GET /api/me/applications` 除外，是这次新开的）；以后这些业务扩展了新的接口，CLI 对应的子命令需要跟着扩展，不在这次范围内。
- `geek status` 的 `server_reachable`/`token_valid` 各自独立发一次 `GET /healthz`/`GET /auth/device/userinfo`，不共用缓存；高频轮询（例如 CI 里每次调用前都先跑一次 `geek status`）会在这两个接口上多打一次请求，目前没有限流以外的额外保护。
