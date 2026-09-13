# 安装与引入

> 安装 Tuffex，以及三种引入方式各自的适用场景

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/installation) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/installation.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/installation.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.4.0`，syncStatus=`reviewed`，verified=`false`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

## 安装

Tuffex 的包名是 `@talex-touch/tuffex`。Vue 3 是 peer dependency，Vue 版本由应用自己决定。

```bash
# pnpm（推荐）
pnpm add @talex-touch/tuffex

# npm
npm install @talex-touch/tuffex

# yarn
yarn add @talex-touch/tuffex
```

图表族是**独立的包**，装 Tuffex 不会顺带装上它：

```bash
pnpm add @talex-touch/tuffex-charts
```

## 三种引入方式

包对外暴露一个根入口、三个套件入口，以及每个组件各自的子路径。选哪一种只影响打包体积，不影响功能——三种方式拿到的是同一个组件。

| 方式 | 引入路径 | 适用场景 |
|------|----------|----------|
| 按组件 | `@talex-touch/tuffex/button` | 新代码。只打包你点名的组件。 |
| 按套件 | `@talex-touch/tuffex/base` | 某个页面大量使用同一套件。 |
| 根入口 | `@talex-touch/tuffex` | 仅用于迁移，会拉入整个组件库。 |

### 按组件引入（推荐）

```typescript
import { createApp } from 'vue'
import TxButton from '@talex-touch/tuffex/button'
import TxSwitch from '@talex-touch/tuffex/switch'
import '@talex-touch/tuffex/base.css'
import '@talex-touch/tuffex/button/style.css'
import '@talex-touch/tuffex/switch/style.css'

const app = createApp(App)
app.use(TxButton)
app.use(TxSwitch)
```

### 按套件引入

`base`、`pro`、`ai` 三个入口与侧边栏的套件页签一一对应，并且是对组件库的**精确划分**：每个组件只属于一个入口，入口之间没有重叠——这条约束由 `suite-barrels` 测试每次运行时校验，组件不会悄悄从自己的入口里漏掉。

```typescript
import TuffBase from '@talex-touch/tuffex/base'
import '@talex-touch/tuffex/base.css'

app.use(TuffBase)
```

可视化组件（SparkChart、AllocationBar、DiffTable、SignalMeter）在文档里归入《[数据套件](./data-suite.md)》，但运行时仍从 `pro` 入口引入：套件拆分是文档层面的组织方式，运行时入口始终是 `base` / `pro` / `ai`。

### 根入口（迁移用）

```typescript
import TuffUI from '@talex-touch/tuffex'
import '@talex-touch/tuffex/style.css'

app.use(TuffUI)
```

只在「应用已经默认全部组件样式都在」的历史代码里这么用，新页面不要走这条路。

## 样式

样式不会由 JavaScript 自动注入，需要显式引入。

| 样式文件 | 内容 | 是否必需 |
|----------|------|----------|
| `@talex-touch/tuffex/base.css` | `--tx-*` 变量、重置样式、主题选择器 | 必需，且只引一次 |
| `@talex-touch/tuffex/<name>/style.css` | 单个组件的 CSS | 引入了哪个组件就引哪个 |
| `@talex-touch/tuffex/style.css` | 全部组件的 CSS | 仅根入口迁移场景 |

`base.css` 定义了组件读取的全部 design token，所以它是唯一不可省略的引入。它往页面上放了什么、以及如何覆盖，见《[主题定制](./theming.md)》。

## 工具函数

组件内部使用的那层工具函数，从根入口和 `./utils` 子路径同时导出：

```typescript
import { nextZIndex, toast } from '@talex-touch/tuffex/utils'
```

完整 API 见《[Utils 工具函数](./utils.md)》。

## 源码

- 入口映射：`packages/tuffex/package.json` 的 `exports` —— `.`、`./utils`、`./base.css`、`./style.css`、`./*`、`./*/style.css`。
- 套件入口：`packages/tuffex/packages/components/src/{base,pro,ai}/index.ts`。
- **实测覆盖：** `packages/tuffex/packages/components/src/__tests__/suite-barrels.test.ts` 校验三个入口精确划分 `components.ts`；`global-install.test.ts` 覆盖根入口安装路径。

## 离线完整示例源码

此页没有引用独立 Demo；正文中的代码块保持原样。

## 离线类型与实现参考

本页是跨组件/概念说明；先按具体组件查询 catalog.json，再按 SOURCE 清单核对；不要从名称猜导出。

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
