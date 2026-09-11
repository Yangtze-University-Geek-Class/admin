# 技术栈与版本基线

> 本文确定重构后采用的技术栈与版本，以及各框架的**用法要点**（不是教程，是"在本项目里该怎么用"）。
> 版本号与迁移结论均来自各项目官方文档（2026-09-12 核对），来源 URL 逐节列出。
> English: [STACK.en.md](./STACK.en.md)

---

## 1. 现状与目标

### 1.1 现状（`web/package.json` 实测）

| 包 | 现版本 | 当前稳定版 | 差距 |
|---|---|---|---|
| React / react-dom | `^18.3.1` | **19.3**（2026-09-09） | 大版本 |
| Vite | `^6.0.7` | **8.3.0**（8.0 = 2026-03-12） | 跨 2 个大版本 |
| `react-router-dom` | `^7.1.1` | **`react-router` 8.3.1** | 包已被删除 |
| `@tanstack/react-query` | `^5.62.11` | **5.102.8** | 同大版本内 |
| Tailwind CSS | `^3.4.17` | **4.3.3**（4.0 = 2025-01-22） | 大版本 |
| TypeScript | `^5.7.2` | **7.0.2**（6.0 = 2026-03-23） | 跨 2 个大版本 |
| Node（构建） | `engines: >=18` | — | 见 §2 |

### 1.2 三个硬耦合（决定必须成组升级）

1. **React Router 8 强制 React ≥ 19.2.7 与 Node ≥ 22.22** → React 19 与 RR8 必须打包升级。
2. **Vite 8 要求 Node ≥ 20.19 / 22.12**。
3. **Tailwind 升级工具要求 Node ≥ 20**。

项目 root `engines.node: ">=18"` 与三者全部冲突。**先把 Node 基线抬到 22 LTS 是前置项。**

注意生产服务器（`103.117.123.226`）当前跑 **Node 20.20.2**。升级前需确认服务器 Node 版本满足新基线，否则构建产物与运行时会脱节。

### 1.3 无阻碍项

`@tanstack/react-query` 的 peer 范围是 `react: ^18 || ^19`，**不阻塞 React 升级**，同版本内滚动即可。不要顺手重写数据层。

---

## 2. 目标版本组合

| 包 | 目标 | 动作 |
|---|---|---|
| Node（构建 + 运行） | **22 LTS** | 前置项，含服务器与 CI |
| React / react-dom | **19.3** | 大版本升级 + ref 类型修正 |
| `@types/react` / `@types/react-dom` | **19.x** | 随 React |
| `react-router`（去 `-dom`） | **8.3.1** | 删包 + 全量改导入路径，**保持 Declarative 模式** |
| Vite | **8.3.0** | 先读 v7 再读 v8 迁移指南 |
| `@vitejs/plugin-react` | **v6** | Oxc 版 React Refresh，不再依赖 Babel |
| Tailwind CSS | **4.3.3** | `@theme inline` 改写令牌；删 postcss / autoprefixer / config |
| `@tanstack/react-query` | **5.102.8** | 滚动升级 |
| TypeScript | **6.0.x → 7.0.2** | 两步走，不要跳过 6.0 |
| 组件基座 | **shadcn/ui（radix base）** | 见 [DESIGN.md](./DESIGN.md) §4 |

### 2.1 升级顺序

依赖关系决定顺序不可颠倒：

```
0. Node 22（本地 + 服务器）
1. TypeScript 5.7 → 6.0        ← 先拿到新默认值与硬错误清单
2. Tailwind 3.4 → 4.3          ← 独立，可与其他并行
3. React 18 → 19.3  ⟺  react-router 7 → 8   ← 必须同一次
4. Vite 6 → 7 → 8              ← 入口拆多 HTML 与三站拆分合并做
5. TypeScript 6.0 → 7.0.2
```

第 1 步先行是因为 TS 6.0 会把一大批隐式问题变成显式错误；等升完框架再处理，排查成本翻倍。

---

## 3. 各框架用法要点

### 3.1 React 19

**本项目真正用得上的：**

| 特性 | 用在哪 |
|---|---|
| `<ViewTransition>` | 官网首页与论坛列表的切页动画，零额外依赖 |
| `<Context>` 直接当 Provider | `ConfirmProvider` 等简化 |
| `use(Context)` | 可在 early return 之后调用（`useContext` 不行） |
| ref 作为 prop | 不再需要 `forwardRef` |

**必须做的类型修正：**

- `useRef` **现在必须传参**（`useRef<T>(null)`）。
- ref 回调**不得隐式 return**：`ref={el => (x = el)}` 要改成块体 `{ ...; }`。
- 官方 codemod：`npx codemod@latest react/19/migration-recipe`、`npx types-react-codemod@latest preset-19 ./web/src`。

**不用管：** RSC / Server Actions 对纯 SPA 是 opt-in，三站不引入。

**职责冲突警告：** Actions / `useOptimistic` 与 TanStack Query 的乐观更新会争抢同一交互的回滚语义。**一个交互只用一套**，本项目沿用 Query 的 `onMutate`。

### 3.2 Vite 8

Vite 8 用 **Rolldown + Oxc** 取代 esbuild + Rollup，是 Vite 2 以来最大的架构变更。对本项目的影响：

**多入口（三站拆分的关键）：**

```ts
// vite.config.ts
build: {
  rolldownOptions: {                      // 注意：不再是 rollupOptions
    input: {
      portal: resolve(import.meta.dirname, "sites/portal/index.html"),
      forum:  resolve(import.meta.dirname, "sites/forum/index.html"),
      admin:  resolve(import.meta.dirname, "sites/admin/index.html"),
    },
  },
}
```

**产物路径按文件解析后的 id，不听 input 对象的 key。** 即 `sites/portal/index.html` 稳定产出 `dist/sites/portal/index.html` —— 可直接映射到 nginx 的分站 root，这是三站拆分能干净落地的原因。

**代码分割：** `manualChunks` 的对象形式**已删除**、函数形式已废弃，改用：

```ts
output: { codeSplitting: { groups: [ { test: /node_modules/, name: "vendor" } ] } }
```

**顺带解决一个现存问题：** 仓库 `tsconfig.json` 有 `paths: { "@/*": ["src/*"] }`，但 `vite.config.ts` **没有任何 alias**，即 `@/` 目前在运行时并不生效。Vite 8 新增 `resolve.tsconfigPaths: true`，打开即可，无需引入 `vite-tsconfig-paths`。

**其他迁移点：** `commonjsOptions` 变 no-op；CJS default 导入语义统一（本项目依赖含 marked / highlight.js / dompurify，需回归验证）；`plugin-legacy` 不再支持降到 ES5；`output.format: 'system'|'amd'` 移除。

**发版注意：** 旧 chunk 404 要接 `vite:preloadError`，并给 HTML 设 `Cache-Control: no-cache`（`deploy/nginx` 已有先例）。

浏览器基线：Chrome/Edge 111、Firefox 114/128、Safari 16.4。对大学生用户群体足够，**不需要 plugin-legacy**。

### 3.3 React Router 8

**v7 引入的三种模式，本项目留在 Declarative：**

| 模式 | 用法 | 本项目 |
|---|---|---|
| Declarative | `<BrowserRouter>` + `<Routes>` | ✅ **当前就是，继续用** |
| Data | `createBrowserRouter` + loader/action | ❌ 与 TanStack Query 争抢数据职责 |
| Framework | Vite 插件 + `routes.ts` + Route Modules | ❌ 收益小于迁移成本 |

官方判据明确把"**已有自己的数据层抽象**"归到 Declarative。本项目是 `BrowserRouter` + TanStack Query 承担全部数据/缓存/pending + 自建 `lib/api.ts` 抽象 —— 完全符合。

**v8 的破坏性变更（对本项目只有一条）：**

`react-router-dom` **被删除**。DOM 专有 API 从 `react-router/dom` 导入，其余一律从 `react-router` 导入。

仓库现有 **39 个文件**从 `react-router-dom` 导入（`pages/admin` 与 `pages/forum` 居多）。一次性批量替换后立刻 `tsc -b` 验证。

**顺带可用：** v8 的 `href()` / `generatePath()` 已按 RFC 3986 路径段规则编码，`$ & + , ; = : @` 不再被错误转义。三站用动态路径参数时值得复用。

### 3.4 TanStack Query 5

**必须写进代码规范的默认值：**

| 项 | 默认值 | 含义 |
|---|---|---|
| `staleTime` | `0` | 缓存数据一律视为过期，mount / 聚焦 / 重连都会后台重取 |
| `gcTime` | 5 分钟 | v5 由 `cacheTime` 改名 |
| `retry` | 3 次 + 指数退避 | 失败查询静默重试 |

本项目 `main.tsx` 已显式设 `staleTime: 15_000`、`retry: false`、`refetchOnWindowFocus: false`，保持。

**`staleTime` 的两个特殊档位**（默认值 `0` 见上表）：

- `Infinity` — 不自动重取，但仍可被 `invalidateQueries` 手动失效。适合字典表、权限。
- `'static'` — **连 `invalidateQueries` 也无效**，且 `refetchOn*: 'always'` 被忽略。只用于运行期绝不变化的数据。

**queryKey 设计规则（可直接当规范用）：**

- 顶层必须是数组，必须 JSON 可序列化。
- **对象内键顺序无关**（自动哈希），**数组元素顺序有关**：`['todos', status, page]` ≠ `['todos', page, status]`。
- queryFn 中所有会变的变量都必须进 key。
- 层级资源：`['todo', 5]` / `['todo', 5, { preview: true }]`；带参列表用对象：`['todos', { type: 'done' }]`。

**本项目约定**：`['<站点>', <org>, '<资源>', { ...params }]`，集中导出一个 key 工厂，**禁止页面里手写字面量**。

**乐观更新的两条路线（官方判据）：**

- **只有一个地方展示 → 走 UI**：`useMutation` 的 `variables` + `isPending` 渲染临时条目，无回滚代码。跨组件用 `useMutationState`。
- **多处 UI 需同步 → 走缓存**：`onMutate` 里 `cancelQueries` → 快照 → 乐观写入 → 返回快照；`onError` 回滚；`onSettled` 无条件 `invalidateQueries`。

**Suspense**：`useSuspenseQuery` 保证 `data` 有值，但**不能条件启用 query、没有 `placeholderData`**。`throwOnError` 默认只在无缓存数据时抛，必须配 `QueryErrorResetBoundary`。

**版本内注意**：仓库在 `5.62.11`，升到 `5.102.x` 前**先对齐本地类型定义再照官方示例改写** —— mutation 回调签名已是新形态（`onMutate: async (variables, context)`，`onError(err, variables, onMutateResult, context)`）。

### 3.5 Tailwind CSS 4

**v4 的核心变化：引擎重写（构建快 3.78×、增量 182×）、CSS-first 配置 `@theme`、自动内容探测、自带 `@import` 处理与 vendor 前缀（可删 `postcss-import` 与 `autoprefixer`）。**

**与本项目现有主题体系直接冲突的一点，也是升级的主要工作量：**

`<alpha-value>` 占位符消失。现有 `tailwind.config.js` 里：

```js
colors: { ink: { 500: "rgb(var(--ink-500) / <alpha-value>)" } }   // v3
```

必须改为在 CSS 里声明（**必须用 `inline`**）：

```css
@theme inline {
  --color-ink-500: rgb(var(--ink-500));
}
```

为什么必须 `inline`：官方明确"**当主题变量引用其他变量时用 inline**，否则工具类引用的是主题变量本身、值解析会不符预期"。本项目正是运行时在 `<html>` 上改 `--ink-*` 的架构 —— `inline` 让产物直接输出 `rgb(var(--ink-500))`，`applyTheme()` 才能继续生效。

**其他必查的破坏性重命名：**

| v3 | v4 |
|---|---|
| `shadow-sm` → | `shadow-xs` |
| `shadow` → | `shadow-sm` |
| `rounded-sm` → | `rounded-xs` |
| `rounded` → | `rounded-sm` |
| `outline-none` → | `outline-hidden` |
| `ring` → | `ring-3`（默认色也从 `blue-500` 变 `currentColor`） |
| `blur-sm` → | `blur-xs` |
| `flex-shrink-*` / `flex-grow-*` → | `shrink-*` / `grow-*` |
| `overflow-ellipsis` → | `text-ellipsis` |
| `bg-opacity-*` 等 → | `/50` 修饰符 |

**四类会产生肉眼可见变化的，升级后必须对三站各做一轮目视校验：**

1. `border-*` / `divide-*` 默认色从 `gray-200` 变 **`currentColor`** —— 本项目大量卡片用裸 `border`/`divide`，需逐个补色。
2. `ring` 宽度 3px → 1px，颜色 → `currentColor`。
3. shadow / rounded 尺度重命名。
4. `hover` 变体只在支持 hover 的设备生效。

**其他：** 配置文件不再自动探测（要保留须显式 `@config "../../tailwind.config.js"`）；`corePlugins` / `safelist` / `separator` 不再支持；变体叠加顺序改为从左到右（`first:*:pt-0` → `*:first:pt-0`）；`!important` 由 `!flex` 改 `flex!`。

**升级步骤：**

```bash
npx @tailwindcss/upgrade          # 建议在新分支跑，人工复核 diff
pnpm add tailwindcss@latest @tailwindcss/vite@latest
# vite.config.ts 加 tailwindcss() 插件
# index.css 三行 @tailwind 换成 @import "tailwindcss"
# 主题迁到 @theme inline
# 删 postcss.config.js / postcss / autoprefixer / tailwind.config.js
```

**顺带收益：** 4.3 的 scrollbar 工具类（`scrollbar-thin`、`scrollbar-thumb-*`、`scrollbar-gutter-*`）可直接用于论坛长列表与后台宽表格，替代现有自定义 CSS。

### 3.6 TypeScript 6 → 7

**7.0 是 Go 原生移植**（构建快 7.7–11.9×，内存 −6%~−26%）。6.0 是最后一个基于 JS 的版本，定位为过渡桥。

**两个硬约束：**

1. **7.0 不提供 API**（预计 7.1 才有）。通过 peer 依赖 `import "typescript"` 的工具（典型是 typescript-eslint）必须用别名共存：
   ```json
   { "typescript": "npm:@typescript/typescript6@^6.0.2",
     "@typescript/native": "npm:typescript@^7.0.2" }
   ```
2. **7.0 采纳 6.0 的新默认值，并对 6.0 已废弃的 flag 报硬错误。** 官方口径：凡在 6.0 下能干净编译的代码，在 7.0 下应编译出相同结果。**所以先升 6.0。**

**会命中本项目的默认值变化：**

- **`types` 默认 `[]`** —— 本项目 `tsconfig.json` 未写 `types`，升级后 `vite/client` 之类的环境类型不会自动注入，需确认 `src/vite-env.d.ts` 或显式声明。
- **`noUncheckedSideEffectImports` 默认 true** —— `index.css` 里的 bare `@import "@fontsource/..."` 需验证。
- `strict` 默认 true（已显式设置）、`module` 默认 `esnext`（已是）、`moduleResolution: bundler` 不再强制要求 `module esnext`（本项目符合官方推荐组合）。

**升级路径：** `5.7 → 6.0.x → 7.0.2`，不要一步跳到 7。

---

## 4. 官方文档索引

| 工具 | 官方 URL |
|---|---|
| React 版本 | https://react.dev/versions |
| React 19 升级指南 | https://react.dev/blog/2024/04/25/react-19-upgrade-guide |
| Vite 指南 | https://vite.dev/guide/ |
| Vite 构建 | https://vite.dev/guide/build.html |
| Vite 迁移 | https://vite.dev/guide/migration |
| Rolldown 手动分割 | https://rolldown.rs/in-depth/manual-code-splitting |
| React Router 模式 | https://reactrouter.com/start/modes |
| React Router 升级 | https://reactrouter.com/upgrading/v7 |
| TanStack Query | https://tanstack.com/query/latest/docs/framework/react/overview |
| Query Keys | https://tanstack.com/query/latest/docs/framework/react/guides/query-keys |
| Query 重要默认值 | https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults |
| Tailwind v4 升级 | https://tailwindcss.com/docs/upgrade-guide |
| Tailwind 主题 | https://tailwindcss.com/docs/theme |
| TypeScript 7.0 | https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ |
| TypeScript 6.0 | https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ |

---

## 5. 未决与风险

| 项 | 说明 |
|---|---|
| 服务器 Node 版本 | 生产机当前 Node 20.20.2；新基线需 ≥ 22.12（Vite 8）与 ≥ 22.22（RR8）。**升级前必须先在服务器抬版本** |
| pnpm 版本 | 当前 `pnpm@9.15.9`，需确认与新 Node / 新 Vite 兼容 |
| 依赖回归面 | Vite 8 的 CJS default 互操作语义变化会影响 marked / highlight.js / dompurify，需逐项验证渲染结果 |
| 组件基座引入时机 | shadcn/ui 当前文档与 CLI **默认 Tailwind v4 + Base UI**；Tailwind v3 走 legacy 文档。**建议先升 Tailwind v4 再引入组件基座**，见 [DESIGN.md](./DESIGN.md) §4 |
