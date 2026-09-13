# 三端拆分：目标架构与执行计划

> 历史阶段记录：旧路径、版本、数量和完成声明仅供追溯。

状态：`historical` · 标注：2026-09-12

当前实施规范见 [当前架构](../architecture/ARCHITECTURE.md) 与 [模块规范](../conventions/MODULAR-DEVELOPMENT.md)，不以本文中的旧完成声明代替验收。

> 状态：**已执行**（2026-09-12，`next` 分支）。P0 缺陷、P1 骨架、P2 构建、P3 清理均已落地，
> 本文保留为决策记录与边界规则来源。新增端或调整边界前仍应先读 §3、§4。
> 现状盘点见 [REFACTOR.md](./REFACTOR.md)。

---

## 0. 「端」的定义与三层映射

**端 = 用户能独立访问的产品边界。** 数出来是 **3 个**：portal、forum、admin。其余都是共享层，不是端。

每个端横跨三层，以下是逐项实测的对应关系（不是按命名推断）：

| 端 | 前端页面 | 后端端点 | 数据库 |
|---|---|---|---|
| **portal** 官网 | 4 页：`Landing` / `Docs` / `Feedback` / `JoinByToken` | 8 个：`docs.ts`(2) + `join.ts`(3) + `feedback.ts` 公开侧(3) | `data.db` 的 `feedback` 表 |
| **forum** 论坛 | 13 页 + `ForumLayout` | 37 个：`routes/forum/*`（10 文件） | `forum.db`（**独占**，11 张表） |
| **admin** 后台 | 15 页 + `OrgLayout` | 42 个：`routes/admin/*`(37) + `auth.ts`(4) + `orgs.ts`(1) | `data.db`（6 张表） |

合计 87 个端点（8 + 37 + 42）。

### 0.1 三处真实的跨端耦合

拆分时这三处**不能**按端硬切：

| 耦合点 | 事实 | 处理 |
|---|---|---|
| **`/auth/callback`** | 同一条回调路径**同时服务 admin 登录与 forum 的 GitHub 登录/绑定**。`routes/auth.ts:35-41` 收到 code 后按 `forum_oauth_state` cookie 分派给 `handleForumGithubCallback` | 留在共享层。OAuth 是跨端基础设施，不是某一端的私有实现 |
| **feedback** | 提交口在 portal 页面**与** `FeedbackFab`（forum 与 admin 都挂载）；管理口在 admin（`routes/admin/feedback.ts`） | 公开侧归 portal，管理侧归 admin，中间的表与校验放共享层 |
| **`lib/` 基础设施** | `db` / `crypto` / `cache` / `github` / `forum-db` / `forum-auth` / `forum-permissions` 被各端路由共同 import | 留共享层，不按端切 |

### 0.2 两个数据库的真实归属

| 库 | 归属 | 说明 |
|---|---|---|
| `forum.db` | **forum 独占** | 干净的端边界，11 张表全归论坛 |
| `data.db` | **portal + admin 共用** | `feedback` 表被 portal 写入；`sessions` / `invite_links` / `invitations` / `audit_logs` / `app_state` 归 admin |

结论：**数据库按 2 个文件切是天然边界，但 `data.db` 不能被某一个端独占。**

---

## 1. 先说结论：代码已经是解耦的

我扫了 `web/src` 全部 55 个 TypeScript 文件的 import 关系，得到一个关键事实：

> **三站之间零跨站依赖。** 没有任何 `portal → forum`、`forum → admin`、`admin → portal` 的 import。

唯一的"聚合点"是 `App.tsx`——它把三棵树静态 import 进来，按 `site.kind` 选一棵渲染。所以当前的问题**不是耦合，是没有物理边界**：

| 现在的问题 | 表现 |
|---|---|
| 目录上混在一起 | `pages/` 平铺 4 个官网页面，`pages/forum/`、`pages/admin/` 各成一堆，看不出这是三个独立产品 |
| 构建上混在一起 | 单个 `index-*.js`（597 KB / gzip 180 KB），**访问官网会下载论坛和后台的全部代码** |
| 依赖上混在一起 | 一个 `package.json`，`highlight.js`（只有论坛用）和 `@noble/hashes`（只有官网用）对三站都是"自己的依赖" |
| 边界无强制 | 谁都能 `import` 任何人，误加一条跨站 import 没有任何提示 |

拆分本质上是**把已经存在的边界变成文件系统上的边界**，不是重构逻辑。这也是为什么风险可控。

---

## 2. 共享面盘点（决定哪些文件留、哪些搬）

按"被哪几个站使用"分类，全部来自 import 实测：

### 站点独占 → 搬进各自目录

| 文件 | 归属 |
|---|---|
| `pages/Landing.tsx`、`Docs.tsx`、`Feedback.tsx`、`JoinByToken.tsx` | portal |
| `pages/forum/*.tsx`（14 个） | forum |
| `pages/admin/*.tsx`（16 个） | admin |
| `components/PortalHeader.tsx` | portal（唯一真正站点专属的组件） |
| `App.tsx` / `main.tsx` | 拆成三份，每站一份 |

注意 `App.tsx` 现在同时承担三件事：路由树选择、`GlobalFab` 的站点差异（portal 不挂、forum 抬高）、以及全站 Provider 挂载。拆开后每站的 `main.tsx` 各自写死自己的行为，不再需要 `detectSite()` 分支。

### 三站共享 → 进 `shared/`

| 文件 | 使用者 | 说明 |
|---|---|---|
| `components/Select.tsx` | portal + forum + admin | 替代原生 `<select>`，三站都用 |
| `components/ConfirmDialog.tsx` | forum + admin | `useConfirm()` |
| `components/Mascot.tsx` | portal + forum | 看板娘（admin 不用） |
| `components/FeedbackFab.tsx` | forum + admin | 官网不挂载 |
| `components/ImageLightbox.tsx` | forum（+ 全局挂载） | |
| `components/BackBar.tsx` | forum | 通用返回条，将来别的站也会用 |
| `components/DiffView.tsx` | admin | 通用 diff 渲染 |
| `components/NumberInput.tsx` | admin | 通用数字输入 |
| `components/DevControlCenter.tsx` | 仅开发态 | 三站共用的开发总控 |
| `lib/api.ts` | 三站 | fetch 封装 + mock 分派 |
| `lib/site.ts`、`lib/runtime.ts` | 三站 | 站点解析（拆分后逻辑会简化，见 §4） |
| `lib/themes.ts` | 三站 | 唯一浅色主题 |
| `lib/pow.ts` | portal + FeedbackFab | 防滥用 PoW |
| `lib/mock-api.ts` | 仅开发态 | |
| `lib/forum-render.ts` | forum | **建议改名 `shared/lib/markdown.ts` 并升为共享**，理由见下 |
| `config/app.config.json` + `index.ts` | 三站 | |

关于 `forum-render.ts`：它现在叫"forum"但内容是通用的 markdown 渲染（marked + DOMPurify + highlight.js）。官网 `Docs.tsx` 有净化缺口（`REFACTOR.md` §8 #4，`marked.parse` 直出未经 DOMPurify）。**把它升为共享并改名 `markdown.ts`，官网切换过去，净化缺口顺手补上，且不会产生第二份重复实现。** 这一步是拆目录和修缺陷的天然交汇点。

### CSS 也需要拆

`portal.css`（388 行）混了两件事：

- 第 1–235 行：`portal-*` 前缀，官网专属
- 第 236–386 行：`mascot-*` 前缀，**官网和论坛都用**

拆成 `sites/portal/styles.css` + `shared/styles/mascot.css`。

另外 `index.css`（318 行）目前用 `html[data-site="forum"]` 选择器做站点条件样式。拆开后每站只加载自己的样式，**这些条件选择器全部退化为无条件规则**，是净简化。

---

## 3. 目标结构

### 3.1 分层方式：横向分层，层内按端切

有两种切法，本方案选**横向**：

| | 横向（本方案） | 纵向（每个端自包含前后端） |
|---|---|---|
| 形态 | `web/sites/<端>/` + `server/src/routes/<端>/` | `app/<端>/{web,server}/` |
| 进程 | 一个 Fastify 进程，一个 Vite 构建 | 仍是同一个进程（`/auth/callback` 跨 admin 与 forum，切不开） |
| 包边界 | 一个 `package.json` | 需要 workspace 多包 + 跨包 exports |
| 边界强制 | 靠 `check-boundaries.mjs` 脚本拦跨端 import | 结构性（跨端 import 直接解析失败） |
| 端独立部署 | 不支持 | 天然支持 |
| 迁移成本 | 低（纯 `git mv`） | 中高（动包边界会连带 systemd 单元、nginx root、部署文档） |

**选横向的理由**：三端共用认证、共用数据库连接、共用部署（同一个 systemd 服务、同一个端口、同一台机器），**独立部署这个收益现在用不上**。而横向已经能拿到目录隔离、独立构建产物、跨端 import 硬拦截。

#### 3.1.1 行业实测：`apps/` 的判据是「独立部署单元」，不是目录名

查了 12 个真实仓库的一手目录树，结论比预想的更明确。

**主流确实是 `apps/<app>/` + `packages/`**（turborepo / create-t3-turbo / cal.com / supabase / dub / documenso / openstatus），但**目录名不是判据**：

| 仓库 | 结构 | 说明 |
|---|---|---|
| `dubinc/dub` | `apps/web` + `packages/*` | **只有 1 个 app 却仍用 apps/**——说明 apps/ 不等于「多个应用」 |
| `twentyhq/twenty` | `packages/twenty-front` + `packages/twenty-server` | 两个应用**放在 packages/ 里**，不用 apps/ |
| `excalidraw/excalidraw` | `excalidraw-app/` 在**根目录** + `packages/*` | 应用直接在根，packages/ 全是可发布库 |
| `bluesky-social/social-app` | `src/` + `bskyweb/` | **连 workspace 都不用** |
| `documenso/documenso` | `apps/remix` 内含 Hono server **与** React Router UI | **server 与 UI 同进程同构建时放同一个 app 内** |
| `openstatusHQ/openstatus` | `apps/{checker,private-location}` 是 **Go 服务** | apps/ 是**部署单元**，不是语言单元；10 个 app 各自有 `fly.toml`/`vercel.json`/`Dockerfile` |

**真正的判据（从证据归纳）：** `apps/` 装的是**独立部署/构建产物**，`packages/` 装的是**被多个 app 复用或需单独发布的包**。触发条件是有 ≥2 个独立部署单元、且部署描述符不同。

**本项目不满足这个条件**（实测）：

```
nginx:  yangtzeu.work        → proxy_pass 127.0.0.1:3000
        github.yangtzeu.work → proxy_pass 127.0.0.1:3000
systemd: 单个 yzgc-admin.service，ExecStart=node server/dist/index.js
```

三个域名**全部指向同一个进程同一个端口**，只有一个部署单元。这不是「多 app」，是**一个 app 的三个路由面**。

最接近的结构类比是 `documenso`：他们把 Hono server 与 UI 放进同一个 `apps/remix`，正是因为两者**一起部署**。本项目同理。

**结论**：保持 `web/` + `server/` 两个包，层内按端切目录。**不引入 `apps/`，也不新建 `app/`。**

**升级路径**：横向 → 纵向是纯机械操作（把 `web/sites/x` 与 `server/src/routes/x` 挪出去加 `package.json`）。等真的需要三端独立部署时再做。

### 3.2 前端

```
web/
  sites/
    portal/
      AGENTS.md  CLAUDE.md  README.md   ← 端专属规则 + 人读说明
      index.html
      main.tsx                    ← 原 main.tsx 的官网分支，去掉 detectSite()
      App.tsx                     ← 原 PortalRoutes + Landing 等页面
      styles.css                  ← portal.css 的 portal-* 段
      components/
        PortalHeader.tsx
      pages/
        Landing.tsx  Docs.tsx  Feedback.tsx  JoinByToken.tsx
    forum/
      AGENTS.md  CLAUDE.md  README.md
      index.html
      main.tsx
      App.tsx
      pages/                      ← 原 pages/forum/ 的 14 个文件
        ForumLayout.tsx  ForumHome.tsx  ...
    admin/
      AGENTS.md  CLAUDE.md  README.md
      index.html
      main.tsx
      App.tsx
      pages/                      ← 原 pages/admin/ 的 16 个文件
        OrgLayout.tsx  MyOrgs.tsx  RepoDetail.tsx  ...
  shared/
    ui/                           ← 原 components/ 的 9 个通用组件
      Select.tsx  ConfirmDialog.tsx  NumberInput.tsx  DiffView.tsx
      BackBar.tsx  ImageLightbox.tsx  Mascot.tsx  FeedbackFab.tsx
      DevControlCenter.tsx
    lib/                          ← 原 lib/ 的 7 个文件（forum-render 改名 markdown）
      api.ts  site.ts  runtime.ts  themes.ts  pow.ts  markdown.ts  mock-api.ts
    config/
      app.config.json  index.ts
    styles/
      base.css                    ← 原 index.css
      mascot.css                  ← 从 portal.css 拆出
  vite.config.ts                  ← 多入口
  tsconfig.json
```

### 3.3 后端

`server/src` 同样按端分组，但**进程不拆**（`index.ts` 仍注册全部路由）：

```
server/src/
  index.ts                  ← 进程入口（唯一），注册三端路由 + 静态托管
  config.ts                 ← 共享配置
  lib/                      ← 共享基础设施，不按端切
    db.ts  crypto.ts  cache.ts  github.ts
    forum-db.ts  forum-auth.ts  forum-github.ts  forum-permissions.ts
    auth.ts                 ← admin OAuth（含 /auth/callback 的 forum 分派）
  middleware/               ← 共享中间件
    require-auth.ts  require-org-role.ts    ← admin 用
    require-forum-auth.ts                   ← forum 用
    pow.ts  turnstile.ts                    ← 公开表单用
  routes/
    portal/      AGENTS.md   ← docs.ts(2) + join.ts(3) + feedback.ts(3)
    forum/       AGENTS.md   ← 现 routes/forum/* 原样平移（10 文件 37 端点）
    admin/       AGENTS.md   ← 现 routes/admin/* + auth.ts + orgs.ts（42 端点）
```

**`routes/portal/feedback.ts` 与 `routes/admin/feedback.ts` 是同一个功能的两侧**：前者是公开提交入口（三端都在用），后者是后台分类与回复。改动其中一侧时要同时看另一侧，这一点写进两处 AGENTS.md。

### 3.4 存放位置：不新建 `app/`

仓库根保持 `server/` / `web/` / `docs/` / `scripts/` 不变，**不引入 `app/` 顶层目录**：

- `systemctl` 的 `ExecStart=/usr/bin/node server/dist/index.js`、nginx 的静态 root、部署文档里的全部路径都指向 `server/` 与 `web/`
- 加一层 `app/` 只是把现有路径前缀改掉，组织收益与 §3.1 的横向分层完全相同
- 若将来升级到纵向切片（每个端自包含），那时 `app/` 才有实际意义——因为它会真的装 workspace 多包

搬迁是纯位移：`git mv` + 改 import 路径为 `@shared/*` / 相对路径，**逻辑一行不改**。

### 3.5 每个端的 AGENTS.md 管什么

#### 3.5.1 加载语义（实测，不是推测）

行业惯例先要搞清一件事：**子目录的 AGENTS.md 不会被自动读进来**，各工具行为还不一致。

| 工具 | 行为 | 出处 |
|---|---|---|
| **agents.md 规范** | 「就近生效」——`The closest AGENTS.md to the edited file wins` | https://agents.md |
| **OpenAI Codex** | 从 project root **向下收集到 cwd 为止**并拼接；`We do not walk past the project root` | `openai/codex:codex-rs/core/src/agents_md.rs` |
| **Claude Code** | cwd 及其**祖先**全部加载并拼接；子目录文件**按需**——`included when Claude reads files in those subdirectories` | https://code.claude.com/docs/en/memory |
| **Gemini CLI** | 唯一**向下自动扫描**的（JIT：访问某文件时扫其目录与祖先），广度上限 `context.discoveryMaxDirs`（默认 200） | `google-gemini/gemini-cli:docs/cli/gemini-md.md` |

两个关键推论：

1. **不能指望端级文件自发进入上下文。** Codex 在 repo root 工作时不会读 `web/sites/forum/AGENTS.md`；Claude 要等到实际打开该目录下的文件才加载。**根文件必须显式指路。**
2. **工具是「拼接」而非「覆盖」。** Codex：`concatenate their contents in that order`；Claude：`concatenated into context rather than overriding each other`。所谓「就近胜出」靠的是顺序靠后 + 规范约定，**不做去重替换**。→ **端级文件必须是 delta，重复内容会双份进上下文。**

#### 3.5.2 根文件写委派表（照抄 supabase）

最贴近本项目的真实范例是 `supabase/supabase`：根 `AGENTS.md` 用 Structure 表逐条标注哪个目录有自己的 AGENTS.md，末尾再单独叮嘱一句。

它的原文：

```
| `apps/studio` | Supabase Studio/Dashboard — has its own `apps/studio/AGENTS.md` (see below) |
```

```
## Studio
Before working on anything in `apps/studio`, read `apps/studio/AGENTS.md` if it isn't
already in context — it maps Studio tasks to required skills and covers the TanStack
Start migration rules.
```

**这是弥补「Codex 不向下扫」的唯一可靠手段**，本项目照此办理：根 `AGENTS.md` 增加一节委派表，逐条指向 6 个端级文件，并对每个端写一句「动手前先读 X，若不在上下文里就主动打开」。

其他可对照的形态（都真实存在）：

| 仓库 | 形态 |
|---|---|
| `supabase/supabase` | 根做委派表 + 3 个子文件（`apps/{studio,docs,kb}/AGENTS.md`） |
| `openstatusHQ/openstatus` | 根做委派表 + 8 个子文件（`apps/*/AGENTS.md`、`packages/*/AGENTS.md`） |
| `vercel/ai` | 根 + `apps/docs/AGENTS.md`、`packages/ai/AGENTS.md` |
| `openai/codex` | 仅根文件，靠 `##` 分节（自己仓库不用嵌套） |
| `microsoft/vscode` | 仅根文件，3 行纯指针 |

#### 3.5.3 端级文件的分工

**一条硬规则：一个信息只在一处出现。** 跨端一致的写根文件，端特有的写端文件。重复即违规——因为工具拼接而非覆盖，重复会双份进上下文。

| 文件 | 只写这些（本端 delta） |
|---|---|
| `web/sites/portal/AGENTS.md` | 样式命名空间 `portal-*`、不使用 React Query 的原因、无登录态、`portal.css` 边界 |
| `web/sites/forum/AGENTS.md` | 论坛会话 `forum_sid`、`forum.db` 独占、归档只读（`is_legacy`）、权限表实际只强制 2 项 |
| `web/sites/admin/AGENTS.md` | `requireAuth` + `requireOrgRole` + `audit()` 三件套、用登录者 token 调 GitHub、`data.db` 归属 |
| `server/src/routes/portal/AGENTS.md` | 无鉴权接口的限流与 Turnstile 要求、feedback 两侧的关联 |
| `server/src/routes/forum/AGENTS.md` | `forum.db` 只增列、权限判定现状、归档只读的服务端强制点 |
| `server/src/routes/admin/AGENTS.md` | 三件套中间件、`audit()` 写入、service token 的唯一例外（公开邀请链接） |

端级文件**不写**：本端目录地图的全貌（根文件已有）、跨端不变量、全局命令（`pnpm install` / `pnpm -r run build`）、部署流程。

参照 `supabase/supabase:apps/studio/AGENTS.md` 的实际结构：首行自我定位（本端是什么、什么栈、什么端口）→ 本端专属规则分节 → 不重复根文件任何一条。

#### 3.5.4 桥接文件与格式

- **`AGENTS.md` 没有 frontmatter 约定。** agents.md 原文：`No. AGENTS.md is just standard Markdown. Use any headings you like.` frontmatter 属于 Cursor `.cursor/rules/*.mdc` 与 Claude `.claude/rules/*.md` 那两套机制，不要混进来。
- **根 `CLAUDE.md` 写 `@AGENTS.md` 是 Anthropic 官方推荐做法**（`create a CLAUDE.md that imports it so both tools read the same instructions without duplicating them`），本项目现状即符合。官方另给的替代是 `ln -s AGENTS.md CLAUDE.md`——`vercel/ai` 根目录就是这么做的（git mode `120000`），同一个仓库的 `apps/docs/CLAUDE.md` 又用 `@AGENTS.md`，两种接法都属主流。
- **端级目录同样各放一份 `CLAUDE.md`**（内容 `@AGENTS.md`）。理由：Claude 对子目录文件是**按需加载**，放一份桥接可让行为确定；`vercel/ai` 在 `apps/docs/` 就是这么做的。代价是 6 个单行文件。
- `GEMINI.md`、`.cursorrules`、`.windsurfrules`、`.clinerules`、`.github/copilot-instructions.md`、`CONVENTIONS.md` 维持现状：薄指针 + 摘要，指向根 `AGENTS.md`。端级不必为每个工具都放一份。

### 3.6 文档不散进各端

端专属设计文档放**根级 `docs/` 的子目录**，不放 `app/<端>/docs/`：

```
docs/
  INDEX.md  README.md
  conventions/  design/  architecture/  plan/  ops/     ← 跨端文档（现状）
  portal/  forum/  admin/                                ← 端专属设计文档（按需新建）
```

理由：文档集中一处，`scripts/docs-index.mjs` 才能扫全；散到各端会让索引需要多根扫描，也让「改什么读哪篇」的人工入口失效。端专属文档**确有必要时才建**，并在 `docs/README.md` 里挂链接，不预先空建。

---

## 4. 边界规则（拆分后必须成立）

| 允许 | 禁止 |
|---|---|
| `sites/*` → `shared/*` | `sites/portal` → `sites/forum`（任何形式） |
| `shared/*` → `shared/*` | `shared/*` → `sites/*`（共享层不能反向依赖站点） |
| `sites/*` 内部自由引用 | `sites/forum` → `sites/admin` |

跨站跳转一律走 `externalUrl(target, path)`。这一条现在是靠自觉的（`REFACTOR.md` §8 #1 就是违反的实例，线上死链），拆分后要有自动检查。

**强制手段建议用一个不依赖第三方包的脚本**（仓库目前无 eslint / husky / CI，加一整套 lint 链是另一件事）：

```
scripts/check-boundaries.mjs
  · 遍历 sites/ 下所有 import
  · 命中跨站路径或 shared → sites 反向依赖时 exit 1 并打印文件与行号
  · 接入方式：package.json 的 build 前置（"build": "node scripts/check-boundaries.mjs && tsc -b && vite build"）
```

这样不改依赖树、不引入新工具链，却能在构建时硬性拦住跨站 import。若将来要更细的规则（比如禁止 admin 用 `marked`），再考虑上 eslint。

---

## 5. 构建与托管

### 5.1 多入口单构建

```ts
// web/vite.config.ts
build: {
  rollupOptions: {
    input: {
      portal: resolve(__dirname, "sites/portal/index.html"),
      forum:  resolve(__dirname, "sites/forum/index.html"),
      admin:  resolve(__dirname, "sites/admin/index.html"),
    },
  },
}
```

产物：三个 HTML + 按站点切分的 entry chunk + Rollup 自动抽出的共享 chunk（React、react-query 等只出现一份）。**官网不再下载论坛与后台的代码**——这是本方案最直接的收益。

要点：`base: "/"`，所有资源走内容哈希文件名，三个 HTML 共享同一个 `/assets/` 目录（哈希不冲突）。这样无论论坛将来挂子域还是留在 `/forum` 路径，HTML 都能直接用。

### 5.2 服务端按 host/path 派发

现在 `server/src/index.ts:60-70` 的 `setNotFoundHandler` 对一切未命中路径都回同一份 `index.html`。要改成：

```
github.yangtzeu.work        → admin 的 index.html
yangtzeu.work 且 /forum 开头 → forum 的 index.html
yangtzeu.work 其余           → portal 的 index.html
```

`/api`、`/auth`、`/healthz` 前缀维持现有 404 行为不变。

---

## 6. 需要你定的三件事

### 决策 1：论坛最终挂子域还是留 `/forum` 路径？

| | 子域 `forum.yangtzeu.work` | 路径 `yangtzeu.work/forum` |
|---|---|---|
| 现状 | 配置里已声明，但 DNS / nginx / 证书都没有 | 实际在跑，靠 `basename` 兜底 |
| 拆分后 | 三站完全对等，`site.ts` 的 `portalForumFallback` 和 `basename` 都能删掉 | 保留 `basename="/forum"`，`site.ts` 的路径特判继续存在 |
| 代价 | 加 DNS A 记录 + 签证书 + nginx server block（`deploy/forum-subdomain-setup.md` 已有完整步骤） | 零成本，但站点解析逻辑永远留一个特例 |

**建议：启用子域。** 三站对等后，`lib/site.ts` 里那段路径特判可以整体删除，这是"低耦合"在代码上的直接体现。而且多入口构建方案对两种选择都兼容，所以这一步不阻塞拆分——可以拆完再定。

### 决策 2：停在"文件夹"还是升级成 workspace 包？

**已在 §3.1 定论：本方案选横向分层（文件夹），不切 workspace 包。** 理由、两种切法的对比表、以及何时该升级，都在 §3.1。决策已并入目标结构，此处不再重复。

### 决策 3：`shared/ui` 是否要再按站点细分？

`Mascot` 只被 portal + forum 用，`FeedbackFab` 只被 forum + admin 用，`DiffView` / `NumberInput` 只有 admin 用。可以进一步拆成 `shared/ui/common`（Select、ConfirmDialog）+ `shared/ui/site`，但收益很小。

**建议：不细分。** 9 个组件的量级，加一层目录只会增加跳转成本。等超过 20 个再分。

---

## 7. 执行计划（分 4 阶段，每阶段可独立验证）

| 阶段 | 内容 | 验证方式 |
|---|---|---|
| **P0 先修缺陷** | 修 `REFACTOR.md` §8 #1（论坛死链）、#4（Docs 净化缺口）。#4 与 `markdown.ts` 升共享是同一件事 | 浏览器实测论坛「使用文档」能到官网；文档站渲染正常 |
| **P1 建骨架** | 建 `sites/`、`shared/` 目录；`git mv` 全部文件；改 import 路径；加 `check-boundaries.mjs` 并接进 build | 边界脚本通过；`pnpm --filter @yzgc/web build` 成功；本地起 dev 逐页点一遍 |
| **P2 拆构建** | 三个 `index.html` + 多入口 vite 配置；`App.tsx`/`main.tsx` 拆三份；服务端按 host 派发 | 构建产物出现三个 entry；线上实测三站各自可用；对比拆分前后各站首屏 JS 体积 |
| **P3 清理** | 删 `site.ts` 的路径特判（取决于决策 1）、删 `data-site` 条件选择器、删冗余的 `detectSite()` 分支 | 全站回归；确认无残留的跨站 import 与死链 |

**P1 与 P2 之间不部署**——中间态（文件搬了但没拆构建）功能完全正常，可以放心在本地验证完再上线。

风险点：

- 搬迁期间 `dev` 和生产构建的路径别名必须同时更新，否则 `tsc -b` 会在 `allowImportingTsExtensions` / 别名解析上报错。建议用 tsconfig 的 `paths` 定义 `@shared/*`，Vite 侧同步 `resolve.alias`，只维护一处映射。
- 多入口构建下 Vite 对 HTML 的输出路径有约定，实际产出目录需要在 P2 开始时先跑一次确认，再写服务端派发逻辑。

---

## 8. 明确不做的事

- **不合并数据库。** `data.db` 与 `forum.db` 两库两连接是天然边界，合并只带来耦合。
- **不给后端加站点维度。** `/api/forum/*` 与 `/api/admin/:org/*` 前缀已经清晰，加站点参数是多余抽象。
- **不在这次拆分里统一鉴权。** 三套凭据（`sid` / `forum_sid` / Bearer PAT）合并不兼容（论坛允许无 GitHub 账号的密码用户），风险远大于收益，单独立项。
- **不引入 eslint / prettier / husky 全家桶。** 边界用脚本，格式靠现有约定。要上工具链另开一次改动并说明成本。
- **不新建 `app/` 顶层目录、不切 workspace 多包。** 理由见 §3.1 与 §3.4：三端共用认证、共用部署，独立部署的收益现在用不上；加一层 `app/` 只是改路径前缀，却要连带改 systemd 单元、nginx root 与部署文档。等到真要独立部署时再升级。
