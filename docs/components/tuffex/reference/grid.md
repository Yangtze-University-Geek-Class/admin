# Grid 栅格

> 结构化布局与对齐

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/grid) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/grid.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/grid.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Grid 栅格

## 基础用法

### Grid
官方示例：`GridGridDemo`（完整源码见本页末尾）

```vue
<template>
  <div style="width: 520px; padding: 16px; border: 1px solid var(--tx-border-color); border-radius: 12px;">
    <TxGrid :cols="3" :gap="12">
      <TxGridItem v-for="i in 6" :key="i">
        <div style="height: 54px; border-radius: 10px; background: var(--tx-fill-color-light, #f5f7fa); display: flex; align-items: center; justify-content: center; color: var(--tx-text-color-secondary);">
          {{ i }}
        </div>
      </TxGridItem>
    </TxGrid>
  </div>
</template>
```

最简单的网格布局：

```vue
<template>
  <TxGrid :cols="3" gap="16">
    <TxGridItem>项目 1</TxGridItem>
    <TxGridItem>项目 2</TxGridItem>
    <TxGridItem>项目 3</TxGridItem>
    <TxGridItem>项目 4</TxGridItem>
    <TxGridItem>项目 5</TxGridItem>
    <TxGridItem>项目 6</TxGridItem>
  </TxGrid>
</template>
```

## 响应式网格

### 响应式列数

```vue
<template>
  <TxGrid :cols="{ xs: 1, sm: 2, md: 3, lg: 4, xl: 5 }" gap="20">
    <TxGridItem v-for="i in 10" :key="i">
      <TxCard>项目 {{ i }}</TxCard>
    </TxGridItem>
  </TxGrid>
</template>
```

### 自适应网格

```vue
<template>
  <TxGrid min-item-width="250px" gap="24">
    <TxGridItem v-for="item in items" :key="item.id">
      <TxCard>
        <h3>{{ item.title }}</h3>
        <p>{{ item.description }}</p>
      </TxCard>
    </TxGridItem>
  </TxGrid>
</template>
```

## 网格间距

`gap` 支持三种写法：数字（转 px 的统一间距）、`{ row, col }`（行列分向）、以及按断点响应式对象。

```vue
<template>
  <!-- 统一间距：数字转 px -->
  <TxGrid :cols="3" gap="32">
    <TxGridItem v-for="i in 6" :key="i">{{ i }}</TxGridItem>
  </TxGrid>

  <!-- 行列分向 -->
  <TxGrid :cols="3" :gap="{ row: 24, col: 16 }">
    <TxGridItem v-for="i in 6" :key="i">{{ i }}</TxGridItem>
  </TxGrid>

  <!-- 按断点响应式 -->
  <TxGrid :cols="{ xs: 1, md: 2, lg: 3 }" :gap="{ xs: 16, md: 24, lg: 32 }">
    <TxGridItem v-for="i in 6" :key="i">{{ i }}</TxGridItem>
  </TxGrid>
</template>
```

## 网格项配置

### 跨列布局

```vue
<template>
  <TxGrid :cols="4" gap="16">
    <TxGridItem>普通项目</TxGridItem>
    <TxGridItem :col-span="2">跨 2 列项目</TxGridItem>
    <TxGridItem>普通项目</TxGridItem>
    <TxGridItem :col-span="3">跨 3 列项目</TxGridItem>
    <TxGridItem>普通项目</TxGridItem>
  </TxGrid>
</template>
```

### 跨行布局

```vue
<template>
  <TxGrid :cols="3" gap="16">
    <TxGridItem>项目 1</TxGridItem>
    <TxGridItem :row-span="2">跨 2 行项目</TxGridItem>
    <TxGridItem>项目 3</TxGridItem>
    <TxGridItem>项目 4</TxGridItem>
    <TxGridItem>项目 5</TxGridItem>
  </TxGrid>
</template>
```

## 对齐方式

### 网格对齐

```vue
<template>
  <TxGrid
    :cols="3"
    gap="16"
    justify="center"
    align="center"
    style="height: 400px;"
  >
    <TxGridItem v-for="i in 3" :key="i">
      项目 {{ i }}
    </TxGridItem>
  </TxGrid>
</template>
```

### 项目对齐

```vue
<template>
  <TxGrid :cols="3" gap="16">
    <TxGridItem justify-self="start">左对齐</TxGridItem>
    <TxGridItem justify-self="center">居中对齐</TxGridItem>
    <TxGridItem justify-self="end">右对齐</TxGridItem>
  </TxGrid>
</template>
```

## API

### Grid Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| cols | `number \| Responsive<number>` | `0` | 列数；为 0 时不输出固定列模板 |
| rows | `number` | `0` | 行数；为 0 时不输出固定行模板 |
| gap | `GridGap` | `16` | 网格间距（数字转 px、`{ row, col }` 或按断点响应式对象） |
| minItemWidth | `string` | - | 项目最小宽度（自适应模式） |
| justify | `'start' \| 'end' \| 'center' \| 'stretch'` | `'stretch'` | 水平对齐 |
| align | `'start' \| 'end' \| 'center' \| 'stretch'` | `'stretch'` | 垂直对齐 |

### GridItem Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| colSpan | `number` | `1` | 跨列数，最小按 1 处理 |
| rowSpan | `number` | `1` | 跨行数，最小按 1 处理 |
| justifySelf | `'start' \| 'end' \| 'center' \| 'stretch'` | - | 自身水平对齐 |
| alignSelf | `'start' \| 'end' \| 'center' \| 'stretch'` | - | 自身垂直对齐 |

### 类型定义

```ts
type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

type Responsive<T> = Partial<Record<Breakpoint, T>>

type GridAlign = 'start' | 'end' | 'center' | 'stretch'

type GridGap =
  | number
  | string
  | { row?: number | string, col?: number | string }
  | Responsive<number | string>
```

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| - | - | `TxGrid` 与 `TxGridItem` 没有组件自定义事件。 |

### Slots

| 组件 | 插槽名 | Props | 说明 |
|------|--------|-------|------|
| `TxGrid` | `default` | - | 网格内容，通常放置 `TxGridItem` 子项。 |
| `TxGridItem` | `default` | - | 渲染在 grid item 包装层内部的单元格内容。 |

## 交互契约

- `minItemWidth` 优先于 `cols`，会输出 `repeat(auto-fit, minmax(..., 1fr))`。
- 响应式值按当前窗口宽度解析，断点为 `xs < 640`、`sm < 768`、`md < 1024`、`lg < 1280`、其余为 `xl`。
- `gap` 数字会转为 px；`{ row, col }` 可分别控制行列间距。
- `TxGridItem` 的 `colSpan` / `rowSpan` 最小按 1 处理。

## 最佳实践

- 已知列数的后台网格优先使用显式 `cols`；需要随容器自动排布的卡片集合优先使用 `minItemWidth`。
- `TxGridItem` 的跨列 / 跨行应保持可预测；大跨度项目要确认每个响应式断点都有足够列数。
- token 化间距优先使用数字；只有需要 `rem`、`clamp()` 等 CSS 单位时才传字符串。
- 不要把 Grid 当语义表格或有序列表使用；数据表继续使用表格组件，导航继续使用列表语义。

## 审阅说明 / Review Notes

- **响应式契约:** `TxGrid` 按 `window.innerWidth` 解析响应式 `cols` 与 `gap`；SSR/default width 从 1024 开始，因此首屏关键布局也要能接受 `md` fallback。
- **尺寸说明:** `minItemWidth` 优先于显式 `cols`，并输出 `repeat(auto-fit, minmax(..., 1fr))`。同一个 grid 中只选一种策略，避免 review 时难以判断最终列数。
- **实测覆盖:** `grid.test.ts` 覆盖固定列/行/gap、`minItemWidth` 优先级、响应式 resize 更新、resize listener 清理、`TxGridItem` span 最小值、自身对齐与 install 注册。

## Source

- Component source: `packages/tuffex/packages/components/src/grid/src/TxGrid.vue`。
- Grid item source: `packages/tuffex/packages/components/src/grid/src/TxGridItem.vue`。
- Coverage: `packages/tuffex/packages/components/src/grid/__tests__/grid.test.ts` 校验固定模板、响应式解析、监听清理与 span 最小值处理。

## 离线完整示例源码

- [GridGridDemo](../snapshot/apps/nexus/app/components/content/demos/GridGridDemo.vue.txt)

## 离线类型与实现参考

- [grid/index.ts](../snapshot/packages/tuffex/packages/components/src/grid/index.ts.txt)
- [src/TxGrid.vue](../snapshot/packages/tuffex/packages/components/src/grid/src/TxGrid.vue.txt)
- [src/TxGridItem.vue](../snapshot/packages/tuffex/packages/components/src/grid/src/TxGridItem.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/grid/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
