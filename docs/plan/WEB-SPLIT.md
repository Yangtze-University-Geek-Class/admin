# 前端三站拆分：目标架构与执行计划

> 状态：**待确认**（未执行）。现状盘点见 [REFACTOR.md](./REFACTOR.md)。
> 目标：三个站点（portal / forum / admin）在目录、构建产物、依赖三层面都物理隔离，改一个站不可能碰坏另一个站。
> English: [WEB-SPLIT.en.md](./WEB-SPLIT.en.md)

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

```
web/
  sites/
    portal/
      index.html
      main.tsx                    ← 原 main.tsx 的官网分支，去掉 detectSite()
      App.tsx                     ← 原 PortalRoutes + Landing 等页面
      styles.css                  ← portal.css 的 portal-* 段
      components/
        PortalHeader.tsx
      pages/
        Landing.tsx  Docs.tsx  Feedback.tsx  JoinByToken.tsx
    forum/
      index.html
      main.tsx
      App.tsx
      pages/                      ← 原 pages/forum/ 的 14 个文件
        ForumLayout.tsx  ForumHome.tsx  ...
    admin/
      index.html
      main.tsx
      App.tsx
      pages/                      ← 原 pages/admin/ 的 16 个文件
        OrgLayout.tsx  MyOrg.tsx  RepoDetail.tsx  ...
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

搬迁是纯位移：`git mv` + 改 import 路径为 `@shared/*` / 相对路径，**逻辑一行不改**。

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

| | 方案 A：`web/sites/*` 文件夹（推荐） | 方案 B：pnpm workspace 包 |
|---|---|---|
| 结构 | 一个 `web` 包内的目录划分 | `apps/portal`、`apps/forum`、`apps/admin` + `packages/ui`、`packages/core` |
| 依赖声明 | 三站共用一个 `package.json` | 每站只声明自己用的依赖 |
| 构建 | 一次 Vite 多入口 | 三个 Vite 配置 |
| 隔离强度 | 靠边界脚本强制 | 结构性隔离（跨站 import 直接解析失败） |
| 迁移成本 | 低 | 中（共享包要处理 exports/构建产物） |
| 独立部署 | 需再改 | 天然支持 |

**建议：先做方案 A。** 它拿到 90% 的收益（目录隔离 + 独立产物 + 边界强制），成本是方案 B 的三分之一，而且**A 升级到 B 是纯机械操作**（把 `sites/x` 挪出去加 `package.json`，`shared/*` 变成 `packages/*`）。等真的需要"三站独立部署"时再升级。

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
