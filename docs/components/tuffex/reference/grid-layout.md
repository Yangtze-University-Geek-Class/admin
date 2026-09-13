# GridLayout 网格布局

> 带 auto-fit 列和可选鼠标光斑效果的响应式 CSS Grid 辅助容器。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/grid-layout) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/grid-layout.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/grid-layout.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# GridLayout 网格布局

## 基础用法

官方示例：`GridLayoutGridLayoutDemo`（完整源码见本页末尾）

```vue
<template>
  <TxGridLayout>
    <div v-for="itemIndex in 6" :key="itemIndex" class="tx-grid-layout__item" style="padding: 16px;">
      Item {{ itemIndex }}
    </div>
  </TxGridLayout>
</template>
```

## 组合示例

### 卡片网格

```vue
<template>
  <TxGridLayout min-item-width="240px" gap="16px" :max-columns="3">
    <article v-for="card in cards" :key="card.id" class="tx-grid-layout__item p-4">
      <h3>{{ card.title }}</h3>
      <p>{{ card.description }}</p>
    </article>
  </TxGridLayout>
</template>
```

### 静态网格

密集表格、虚拟列表内容，或任何不希望鼠标移动改写子节点 inline style 的网格，应关闭 `interactive`。

```vue
<template>
  <TxGridLayout :interactive="false" min-item-width="180px" gap="12px">
    <div v-for="metric in metrics" :key="metric.name" class="rounded-xl border p-3">
      {{ metric.name }}
    </div>
  </TxGridLayout>
</template>
```

## 交互契约

- 根节点是 block `div`，使用 CSS Grid 布局。
- 默认列模板为 `repeat(auto-fit, minmax(minItemWidth, 1fr))`。
- 视口宽度 `>= 1400px` 时，列模板切换为 `repeat(maxColumns, 1fr)`。
- `gap`、`minItemWidth`、`maxColumns` 会写入根节点 CSS 变量。
- 光斑效果只作用于带 `.tx-grid-layout__item` class 的后代。
- `interactive=true` 时，鼠标移动会给每个 `.tx-grid-layout__item` 更新 `--tx-grid-op`、`--tx-grid-x`、`--tx-grid-y` inline 变量。
- 鼠标离开时会把 `--tx-grid-op` 设回 `0`。
- `interactive=false` 时，鼠标移动与离开处理器会直接返回，不改写子节点样式。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `minItemWidth` | `string` | `'300px'` | auto-fit 网格列使用的最小列宽。 |
| `gap` | `string` | `'1.5rem'` | 网格项之间的 CSS gap。 |
| `maxColumns` | `number` | `4` | 宽屏（`>= 1400px`）下使用的固定列数。 |
| `interactive` | `boolean` | `true` | 为 `.tx-grid-layout__item` 子节点启用跟随鼠标的光斑变量更新。 |

### Slots

| 插槽名 | Props | 说明 |
|------|------|------|
| `default` | - | 网格项内容。需要内置卡片样式和光斑变量的子节点应添加 `.tx-grid-layout__item`。 |

### Events

不发出公开事件。

### Exposed Methods

不暴露公开实例方法。

### CSS Variables

| 变量 | 来源 | 说明 |
|------|------|------|
| `--tx-grid-gap` | `gap` | 根网格间距。 |
| `--tx-grid-min-width` | `minItemWidth` | 最小列宽。 |
| `--tx-grid-max-columns` | `maxColumns` | 宽屏列数。 |
| `--tx-grid-op` | 鼠标状态 | 每个 item 的光斑透明度。 |
| `--tx-grid-x` / `--tx-grid-y` | 鼠标状态 | 鼠标相对每个 item 的位置。 |

## 最佳实践

- `TxGridLayout` 用于重复的同级卡片；一维对齐使用 `TxFlex` 或 `TxStack`。
- 只有需要内置背景、圆角、cursor 和光斑样式时才给子节点添加 `.tx-grid-layout__item`。
- 超大网格建议关闭 `interactive`，避免每次鼠标移动都批量更新子节点样式。
- `minItemWidth` 应对应卡片真实可读最小宽度，不要把它当成间距 hack。
- 避免把交互网格嵌套进其它高频指针交互区域。

## 审阅说明

- 已人工核对 `packages/tuffex/packages/components/src/grid-layout/index.ts`、`TxGridLayout.vue` 与 `grid-layout.test.ts`。
- 光斑变量只写入带 `.tx-grid-layout__item` 的后代；普通插槽子节点不会被改写。
- `interactive=false` 会阻止指针处理器改动子节点 inline style，这对大列表或虚拟网格很重要。

## Source

- Component source: `packages/tuffex/packages/components/src/grid-layout/src/TxGridLayout.vue`。
- Types: `packages/tuffex/packages/components/src/grid-layout/index.ts`。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/grid-layout/__tests__/grid-layout.test.ts` 验证默认网格变量和插槽内容、props 驱动的变量更新，以及只在 interactive 时改写光斑变量。

## 离线完整示例源码

- [GridLayoutGridLayoutDemo](../snapshot/apps/nexus/app/components/content/demos/GridLayoutGridLayoutDemo.vue.txt)

## 离线类型与实现参考

- [grid-layout/index.ts](../snapshot/packages/tuffex/packages/components/src/grid-layout/index.ts.txt)
- [src/TxGridLayout.vue](../snapshot/packages/tuffex/packages/components/src/grid-layout/src/TxGridLayout.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
