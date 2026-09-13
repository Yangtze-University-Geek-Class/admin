# Skeleton 骨架屏

> 加载占位与结构提示

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/skeleton) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/skeleton.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/skeleton.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Skeleton 骨架屏

## Demo
### Skeleton
文本与头像混合占位
官方示例：`SkeletonSkeletonDemo`（完整源码见本页末尾）

```vue
<template>
  <TxSkeleton :loading="true" :lines="3" />
  <TxSkeleton variant="circle" :width="40" :height="40" />
</template>
```

## API

### Props
```yaml
rows:
  - name: loading
    type: 'boolean'
    default: 'true'
    description: '是否显示骨架。`false` 时渲染默认插槽。'
  - name: lines
    type: 'number'
    default: '1'
    description: '占位项数量；最小会收敛到 1。'
  - name: variant
    type: "'text' | 'rect' | 'circle'"
    default: 'text'
    description: '每个占位项的形态。'
  - name: width
    type: 'string | number'
    default: '100%'
    description: '宽度，number 会转换为 px'
  - name: height
    type: 'string | number'
    default: '12'
    description: '高度，number 会转换为 px'
  - name: radius
    type: 'string | number'
    default: '8'
    description: '非 circle 占位项圆角；number 会转换为 px。'
  - name: gap
    type: 'string | number'
    default: '10'
    description: '多行间距，number 会转换为 px'
```

### Events

`TxSkeleton`、`TxCardSkeleton` 和 `TxListItemSkeleton` 不会 emit 自定义事件。

### Slots

| 组件 | 插槽名 | 参数 | 说明 |
|------|--------|------|------|
| `TxSkeleton` | `default` | - | `loading=false` 时渲染的最终内容。 |
| `TxCardSkeleton` | - | - | 固定卡片占位，无插槽。 |
| `TxListItemSkeleton` | - | - | 固定列表行占位，无插槽。 |

### 预设组件

| 导出 | 用途 |
|------|------|
| `TxSkeleton` / `Skeleton` | 可配置文本、矩形或圆形占位。 |
| `TxCardSkeleton` / `CardSkeleton` | 固定卡片 / feed 占位，包含 icon、title、badge 和 description 区块。 |
| `TxListItemSkeleton` / `ListItemSkeleton` | 固定列表行占位，包含 icon、name、meta 和尾部 badge 区块。 |

## 交互契约

- `loading=false` 时不渲染骨架，直接渲染默认 slot。
- `lines` 最小渲染 1 行，避免空骨架。
- `variant="circle"` 固定使用圆形半径，忽略 `radius`。
- `TxSkeleton` 根节点是 `aria-hidden="true"`，装饰性 shimmer 不会被播报。加载态的播报应由宿主区域负责（例如容器上的 `aria-busy` 或 polite live region），并在 `loading=false` 时切换到真实内容。

## 后台数据运维面板

表格数据加载时，短耗时可用 `TxDataTable loading` 遮罩；长耗时或侧栏摘要建议用 `TxSkeleton` 保留结构节奏。

官方示例：`ComponentsDataOperationsDemo`（完整源码见本页末尾）

```vue
<template>
  <aside class="grid gap-3">
    <TxSkeleton :loading="true" :lines="3" height="10px" />
    <TxLayoutSkeleton />
  </aside>
</template>
```

## 组合示例
### 卡片占位
骨架屏配合卡片承载列表。
官方示例：`SkeletonCardPlaceholderDemo`（完整源码见本页末尾）

```vue
<template>
  <TxCard>
    <TxSkeleton :loading="true" :lines="2" />
  </TxCard>
</template>
```

## 最佳实践

- 骨架的宽度、高度、行数和圆角应贴近最终内容，避免 loading 阶段形成第二套布局。
- 可配置文本、矩形、头像占位用 `TxSkeleton`；固定结构刚好匹配最终界面时再用 `TxCardSkeleton` 或 `TxListItemSkeleton`。
- 把 `loading=false` 作为切换到真实内容的交接点，不要在不同分支里分别维护骨架和内容。
- 不要把骨架当作灰色装饰。如果最终内容结构未知，优先使用有文案的空态或加载态。
- 短耗时表格等待用 `TxDataTable loading`；需要保留周围结构节奏的长耗时等待再用骨架。

## 审阅说明

- 已对照 `packages/tuffex/packages/components/src/skeleton/src/types.ts`、`TxSkeleton.vue`、`TxCardSkeleton.vue`、`TxListItemSkeleton.vue` 与 `skeleton.test.ts` 核对。
- 现有测试覆盖 CSS 变量输出、number 转 px、行数最小值收敛、circle 半径归一化、装饰性 `aria-hidden` 根节点、`loading=false` slot 交接、固定预设渲染和 install 注册。
- API 说明：`TxSkeleton` 是可配置基础组件；`TxCardSkeleton` 和 `TxListItemSkeleton` 是固定形状预设，无 props、events 或 slots。
- 渲染说明：`variant="circle"` 会强制 `--tx-skeleton-radius: 999px`；调用方应同时设置匹配的 `width` 和 `height` 才能得到正圆。

## Source

- Component source: `packages/tuffex/packages/components/src/skeleton/src/TxSkeleton.vue`, `TxCardSkeleton.vue`, and `TxListItemSkeleton.vue`.
- Types: `packages/tuffex/packages/components/src/skeleton/src/types.ts` exports `SkeletonProps` and `SkeletonVariant`.
- **实测覆盖:** `packages/tuffex/packages/components/src/skeleton/__tests__/skeleton.test.ts` 验证 CSS 变量输出、number 转 px、行数最小值收敛、circle 半径、装饰性 `aria-hidden` 根节点、`loading=false` slot 交接、固定预设渲染与 install 注册。

## 离线完整示例源码

- [SkeletonSkeletonDemo](../snapshot/apps/nexus/app/components/content/demos/SkeletonSkeletonDemo.vue.txt)
- [ComponentsDataOperationsDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsDataOperationsDemo.vue.txt)
- [SkeletonCardPlaceholderDemo](../snapshot/apps/nexus/app/components/content/demos/SkeletonCardPlaceholderDemo.vue.txt)

## 离线类型与实现参考

- [skeleton/index.ts](../snapshot/packages/tuffex/packages/components/src/skeleton/index.ts.txt)
- [src/TxCardSkeleton.vue](../snapshot/packages/tuffex/packages/components/src/skeleton/src/TxCardSkeleton.vue.txt)
- [src/TxListItemSkeleton.vue](../snapshot/packages/tuffex/packages/components/src/skeleton/src/TxListItemSkeleton.vue.txt)
- [src/TxRowSkeleton.vue](../snapshot/packages/tuffex/packages/components/src/skeleton/src/TxRowSkeleton.vue.txt)
- [src/TxSkeleton.vue](../snapshot/packages/tuffex/packages/components/src/skeleton/src/TxSkeleton.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/skeleton/src/types.ts.txt)
- [src/use-deferred-loading.ts](../snapshot/packages/tuffex/packages/components/src/skeleton/src/use-deferred-loading.ts.txt)
- [src/utils.ts](../snapshot/packages/tuffex/packages/components/src/skeleton/src/utils.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
