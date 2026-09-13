# VirtualList 虚拟列表

> 固定行高虚拟列表，用更少 DOM 渲染长数据集，并提供命令式滚动方法。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/virtual-list) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/virtual-list.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/virtual-list.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# VirtualList 虚拟列表

## 基础用法

官方示例：`VirtualListVirtualListDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const items = Array.from({ length: 100 }, (_, index) => `项目 ${index + 1}`)
</script>

<template>
  <TxVirtualList :items="items" :item-height="36" height="240px">
    <template #item="{ item, index }">
      <div style="padding: 6px 12px; width: 100%;">
        {{ index + 1 }}. {{ item }}
      </div>
    </template>
  </TxVirtualList>
</template>
```

## 组合示例

### 稳定 item key

```vue
<template>
  <TxVirtualList :items="users" :item-height="44" height="360px" item-key="id">
    <template #item="{ item }">
      <UserRow :user="item" />
    </template>
  </TxVirtualList>
</template>
```

### 命令式滚动

```vue
<script setup lang="ts">
const listRef = ref()

function jumpToLatest() {
  listRef.value?.scrollToBottom()
}
</script>

<template>
  <TxButton @click="jumpToLatest">最新</TxButton>
  <TxVirtualList ref="listRef" :items="logs" :item-height="32" :height="400" />
</template>
```

## 交互契约

- `itemHeight` 必填，且每个渲染行都会被设置为该像素高度。
- 数字 `height` 会转为 px；字符串 `height` 原样应用。
- 数字、px 和纯数字字符串高度会立即解析，用于计算 viewport。`%`、`vh`、`vw`、`rem`、`em` 高度会等待真实容器高度。
- 挂载时组件读取 `clientHeight`；存在 `ResizeObserver` 时，容器尺寸变化后会更新 viewport 高度。
- `startIndex` 为 `floor(scrollTop / itemHeight) - overscan`，并限制到 `0` 以上。
- `endIndex` 基于可视 viewport 加 `overscan` 计算，并限制到 `items.length`。
- spacer 高度是 `items.length * itemHeight`；可见 items 会按 `startIndex * itemHeight` 位移。
- `itemKey` 可以是字段名或函数。字段值缺失时回退为可见项 index。
- `scroll` 在内部滚动状态更新后发出 `{ scrollTop, startIndex, endIndex }`。
- `scrollToIndex(index)` 会把负数 index 限制为 0，但不会限制超过最后一项的 index；调用方应传入有效索引。
- 容器与行都保持语义中立（无 `role`/`aria-*`）。由于 DOM 中只有可见切片，需要无障碍列表语义时应由使用方在外层补 `role="list"`/`role="listitem"` 与 `aria-setsize`/`aria-posinset`（用真实的 `items.length` 与绝对索引，而非可见切片下标）。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `items` | `T[]` | `[]` | 完整数据集。 |
| `itemHeight` | `number` | 必填 | 固定行高，单位 px。所有行都必须匹配该值。 |
| `height` | `number \| string` | `320` | 滚动容器高度，数字会转为 px。 |
| `overscan` | `number` | `4` | viewport 前后额外渲染的行数。 |
| `itemKey` | `keyof T \| (item: T, index: number) => string \| number` | `index` | 渲染行 key 解析器。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `scroll` | `{ scrollTop: number, startIndex: number, endIndex: number }` | 列表滚动后触发。 |

### Slots

| 插槽名 | Props | 说明 |
|------|------|------|
| `item` | `{ item: T, index: number }` | 每个可见项的自定义渲染。默认直接把 `item` 渲染为文本。 |

### Expose

| 方法 | 签名 | 说明 |
|------|------|------|
| `scrollToIndex` | `(index: number) => void` | 设置 scrollTop 为 `Math.max(0, index) * itemHeight`。 |
| `scrollToTop` | `() => void` | 设置 scrollTop 为 `0`。 |
| `scrollToBottom` | `() => void` | 设置 scrollTop 为 `max(0, totalHeight - viewHeight)`。 |

## 最佳实践

- 只用于固定高度行。变高内容会让滚动计算失真。
- 对象列表应提供 `itemKey` 稳定 id；只有不可变数组才适合使用 index key。
- `overscan` 保持适中。更高 overscan 会让快速滚动更平滑，但增加 DOM 工作量。
- 避免给 row 外层加垂直 margin；间距应放进固定高度行内部。
- `scroll` 适合统计或懒加载触发，不要在其中执行逐帧重逻辑。

## 审阅说明

- **viewport 说明:** 无法同步解析的 `height`（`%`、viewport 单位、`rem`、`em`）依赖挂载节点的 `clientHeight`；SSR 或隐藏容器场景应先提供具体高度，再依赖可见区间计算。
- **滚动说明:** `scrollToIndex()` 会夹取负数索引，但不会限制大于 `items.length - 1` 的索引。用户输入的跳转目标需要调用方先校验。
- **实测覆盖:** `virtual-list.test.ts` 目前覆盖固定高度下的可见项数量与暴露的 `scrollToIndex` 方法。文档已明确标出仍需人工 review 的契约：ResizeObserver、自定义 `itemKey`、overscan 与 `scroll` payload。

## Source

- Component source: `packages/tuffex/packages/components/src/virtual-list/src/TxVirtualList.vue`。
- Types: `packages/tuffex/packages/components/src/virtual-list/src/types.ts` 导出 `VirtualListProps`、`VirtualListEmits`、`VirtualListItemKey` 与 `VirtualListKey`。
- Export alias: `packages/tuffex/packages/components/src/virtual-list/index.ts` 导出 `VirtualList`、`TxVirtualList`、virtual-list 类型与 `TxVirtualListInstance`。
- Coverage: `packages/tuffex/packages/components/src/virtual-list/__tests__/virtual-list.test.ts` 覆盖可见区间渲染与命令式滚动。

## 离线完整示例源码

- [VirtualListVirtualListDemo](../snapshot/apps/nexus/app/components/content/demos/VirtualListVirtualListDemo.vue.txt)

## 离线类型与实现参考

- [virtual-list/index.ts](../snapshot/packages/tuffex/packages/components/src/virtual-list/index.ts.txt)
- [src/TxVirtualList.vue](../snapshot/packages/tuffex/packages/components/src/virtual-list/src/TxVirtualList.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/virtual-list/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
