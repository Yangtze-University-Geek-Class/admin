# 本机核心预览与独立论坛

> 本机起官网、核心后端与论坛；启动时给出 GitHub OAuth 应用的两项凭据就走真实 GitHub 登录（数据留在 `.tools/local-preview/`），不给就是隔离的内存模式。

状态：`current` · 更新：2026-09-25

## 地址

| 模块 | 本机地址 | 数据 |
|---|---|---|
| 宣传主页 | http://127.0.0.1:5173/sites/portal/ | 核心前端。打开 `http://127.0.0.1:5173/` 时，GitHub 登录模式跳到 `/sites/portal/?__data=live`，隔离模式跳到 `?__data=mock` |
| 极客班控制台 | http://127.0.0.1:5186/console（`pnpm dev:console`） | 默认连 3000 上的本机后端（`live`），后端没起时请求失败；`?__data=mock` 切到只读样板数据（记在本标签页，给自动化测试用，`?__persona=` 切换样板身份），`?__data=live` 切回。5173 上的 `/console`、`/admin`、`/signin`、`/sites/admin/*` 在开发态 302 到这里，查询参数保留 |
| 新论坛 | http://127.0.0.1:3456/ | 发现 `.tools/forum-runtime/<快照>/` 时显示极客班论坛内容（快照模式），否则为原仓浏览器 localStorage 演示；`GEEK_FORUM_SOURCE=demo` 强制示例，`GEEK_FORUM_SOURCE=site` 显示和镜像一样的极客班论坛（见 [TUFF-FORUM](TUFF-FORUM.md)）。Nuxt 开发服务器把 `/auth`、`/api/public/org`、`/api/forum` 转给 3000（`app/forum/nuxt.config.ts` 的 `nitro.devProxy`），所以论坛能读 `/auth/me`，`site` 模式下读写论坛后端 |
| 核心 API | http://127.0.0.1:3000/healthz | 隔离模式为内存库；GitHub 登录模式为 `.tools/local-preview/core.db` |

5173 上的 `/forum/<路径>?<参数>` 302 到 `http://127.0.0.1:3456/<路径>?<参数>`（去掉 `/forum` 前缀、保留参数，`app/web/vite.config.ts`），登录后回到论坛原页面靠的就是这一条；旧 `/sites/forum/*` 转到论坛首页。核心 `/api/forum/*` 返回 410，不再支持旧本地注册、上传、发帖。生产新论坛缺少真实服务时不自动开放演示。

## 管理进程

```bash
node scripts/local-preview.mjs start
node scripts/local-preview.mjs status
node scripts/local-preview.mjs stop
node scripts/forum.mjs start
node scripts/forum.mjs status
node scripts/forum.mjs stop
```

根 `pnpm preview:local` 启动两者（控制台另用 `pnpm dev:console` 启动）。`local-preview.mjs start` 需要先 `pnpm build`（读 `app/server/dist/`）。核心选择项目 Node 22；论坛选择 Node >=26 和独立 pnpm 11。两者均核对本任务实例标识，不因端口占用停止无关进程。端口仅绑定回环，不开放局域网/公网，没有开机自启。

核心日志在 `.tools/local-preview/preview.log`，论坛日志在 `.tools/tuff-forum/dev.log`；目录属于本机缓存，不入库。已有 4173 等服务不因本任务停止。

## 两种模式

`local-preview.mjs start` 按调用它时的环境变量选模式：

| 模式 | 条件 | 核心库与密钥 | GitHub |
|---|---|---|---|
| 隔离模式 | 环境里没有同时给出 `OAUTH_CLIENT_ID` 与 `OAUTH_CLIENT_SECRET` | 内存库；`SESSION_SECRET`、`ENCRYPTION_KEY` 每次启动随机生成 | 不连：`/auth/github`、`/auth/callback` 返回 503 `local_preview_external_disabled`（说明要在环境里提供这两项），核心对 GitHub 的请求与 Octokit 一律 503 |
| GitHub 登录模式 | 两项都给出 | `.tools/local-preview/core.db`；会话与加密密钥首次启动时随机生成，存 `.tools/local-preview/keys.json`（权限 0600），重启后旧会话仍能解密 | 真实 OAuth：`/auth/github` → GitHub → `/auth/callback`。预览不设 `CONSOLE_ORG`，用默认的 `Yangtze-University-Geek-Class`，只有它的 active 成员能登录（规则见 [SECURITY](../architecture/SECURITY.md)） |

GitHub 登录模式下 `FORUM_DB_PATH` 也指向 `.tools/local-preview/forum.db`，但核心服务不打开论坛库，这个文件不会生成。`status` 与 `.tools/local-preview/runtime.json` 只记录 `database`（`memory` / `file`）与 `github_login`（布尔值），`/__local_preview` 记录 `database` 与 `external_integrations`；都不含凭据。

### 用真实 GitHub 登录启动

凭据属于本机专用的 GitHub OAuth 应用（与预发布、正式的应用分开，见 [ENVIRONMENTS](ENVIRONMENTS.md#github-oauth-app-回调地址)）。预览的 `PUBLIC_ORIGIN` 是 `http://127.0.0.1:5173`，所以这个应用登记的 Callback URL 必须是 `http://127.0.0.1:5173/auth/callback`。

凭据从钥匙串或本机凭据库读出，只放进启动这一条命令的环境；不要 `echo`，不要写进仓库、`.env`、shell 配置或日志：

```bash
OAUTH_CLIENT_ID="$(security find-generic-password -s <存 Client ID 的条目> -w)" \
OAUTH_CLIENT_SECRET="$(security find-generic-password -s <存 Client secret 的条目> -w)" \
node scripts/local-preview.mjs start
```

`pnpm preview:local` 前面加同样两项也可以：`scripts/forum.mjs` 不转发它们，论坛进程拿不到。`start` 只把这两项（以及下文的出站代理地址）带进后台预览进程，其余环境变量一概不带；启动日志只写 GitHub 登录是否打开、是否经出站代理，不打印凭据和代理地址。已经在跑的实例不会换模式，要切换先 `stop` 再 `start`。

### 出站代理

GitHub 登录要从预览进程连 `github.com` 换 token、查用户和组织成员身份。有的机器直连 `github.com` 会超时，浏览器却能打开，因为浏览器走的是系统代理；这时登录会以 `?signin=failed` 回到原页面（核心对 GitHub 的请求 15 秒超时）。所以 `start` 按下面的顺序找代理，找到就交给预览进程：

1. 调用方环境里的 `HTTPS_PROXY`、`https_proxy`、`HTTP_PROXY`、`http_proxy`（取第一个有值的）；
2. 都没有且是 macOS 时，读 `scutil --proxy`：`HTTPSEnable` 为 1 时用 `http://<HTTPSProxy>:<HTTPSPort>`；
3. 还没有就直连。

只有 GitHub 登录模式会用它：预览进程用 undici 的 `setGlobalDispatcher(new ProxyAgent(<代理>))`，核心的 undici 请求（换 token、`/user`）与 Octokit 走的全局 `fetch` 共用这一个 dispatcher。隔离模式不连外网，代理地址即使找到也不起作用。

### 跨端口的登录

`sid` 是 host-only cookie，浏览器按主机不按端口发送：在 5173 登录后，127.0.0.1 上的 5186（控制台）和 3456（论坛）也带着同一个 `sid`，控制台经自己的 Vite 代理、论坛经 `nitro.devProxy` 读 `/auth/me`。`return_to` 只接受 `http://127.0.0.1:5173` 这一个 origin：

- 论坛的「用 GitHub 登录」在开发态指向 `http://127.0.0.1:5173/auth/github?return_to=http://127.0.0.1:5173/forum<当前路径>`，登录后经上面的 302 回到 3456 的原页面；
- 官网菜单栏的登录链接默认回 `http://127.0.0.1:5173/forum/`，即论坛首页；
- 控制台（5186）发起的登录，`return_to` 是 5186 上的地址，不被接受，回到 `http://127.0.0.1:5173/console` 再 302 到 5186 的 `/console`，原来的深链接不保留。

核心只接受 `PUBLIC_ORIGIN`（本机是 `http://127.0.0.1:5173`）发来的写请求。控制台（5186）的 Vite 代理和论坛（3456）的 `nitro.devProxy` 都把转给核心的 `Origin` 换成 5173，与线上同域时一致；否则本机控制台的保存、审核和两处的「退出」都会被 403 `invalid_origin`。两条代理只在开发服务器上，不进构建产物。

登录没成功时回跳地址带 `?signin=<原因>`，各页面怎么说明见 [SECURITY](../architecture/SECURITY.md) 与 [API](../architecture/API.md)。

**注意：GitHub 登录模式下的本机控制台操作的是真实的 GitHub 组织。** 控制台里的 GitHub 操作（邀请、移出成员、改仓库等）用的是登录者自己的 token 和组织权限，与线上控制台一样会改到真实的 `Yangtze-University-Geek-Class`；本机数据库（称号、投递、意见箱）只在 `.tools/local-preview/core.db`。

## 数据生命周期

隔离模式的内存库在核心服务重启后清空。GitHub 登录模式的 `core.db` 与 `keys.json` 在 `stop` 后保留（`stop` 的提示写明登录与数据留在 `.tools/local-preview`）；要从头来，先 `stop`，再自己删除这两个文件，脚本不替你删。

论坛示例模式的数据保存在当前浏览器，停止服务不会主动清空它，上游重置示例数据需用户明确操作；快照模式只读显示极客班归档，不写论坛状态。控制台样板数据只读；论坛示例模式允许浏览器内示例交互，没有跨设备存储。全站 GitHub 登录只让论坛和控制台知道你是谁，论坛仍没有发帖、回复的后端。

## 边界与未验证

不读取现有 `.env`、不连接业务数据库，不使用 Cloudflare 凭据；只在 GitHub 登录模式下使用调用方给的本机 OAuth 应用凭据。上游原代码和工具链说明见 [TUFF-FORUM](TUFF-FORUM.md)。真实部署按 [DEPLOY](DEPLOY.md) 单独实施：线上不是本机这几条命令的延伸，而是两套 Docker 栈（[ENVIRONMENTS](ENVIRONMENTS.md)），本机地址任何情况下都不能标成已在预发布环境试用。

**未验证**：所有者还没有用新建的本机 OAuth 应用走完一次真实的 GitHub 登录往返（授权 → 回调 → 成员校验 → 回到原页面）；目前的证据是 `tests/server/core.test.ts` 用模拟的 GitHub 响应覆盖的回调分支。组织若开启了 OAuth App 访问限制而这个应用没被批准，成员查询会被 GitHub 拒绝（403），按代码处理为 `?signin=failed`，这条路径也没有实测。
