# TimeseriesChart 时序图

> 时序折线与堆叠柱：标记聚簇、阈值线、刷选时间范围、tooltip 全功能。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/timeseries-chart) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/timeseries-chart.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/timeseries-chart.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.1.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# TimeseriesChart 时序图

## 基础用法

`data` 是序列数组，每条序列的 `data` 是按时间排序的 `[timestamp_ms, value]` 元组。`color` 可省略——按序列位次落到分类色板，位次固定，隐藏某条序列不会让其余序列换色。悬停出 tooltip：多序列按值降序，同名序列去重，二分查找最近采样点。

### 双序列折线

官方示例：`TimeseriesChartBasicDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { TxTimeseriesChart } from '@talex-touch/tuffex-charts'

const data = [
  { name: 'Requests', data: requests },
  { name: 'Cache hits', data: cacheHits },
]
</script>

<template>
  <TxTimeseriesChart
    :data="data"
    x-axis-name="Time"
    y-axis-name="Count"
    :x-axis-tick-format="(ts) => new Date(ts).toLocaleTimeString()"
    :tooltip-value-format="(v) => `${v} req/s`"
  />
</template>
```

## 标记与阈值

`markers` 在时间轴上画竖虚线；挤在一起的标记按可视跨度自动聚簇成一条线，标签变成「N changes」（`clusterLabel` 可换文案），悬停标记线可见每条的 `label` 与 `description`。`thresholds` 在数值轴上画水平线，y 轴范围会自动扩到覆盖阈值。

### 部署标记 + SLO 线

官方示例：`TimeseriesChartMarkersDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const markers = [
  { timestamp: t1, label: 'Deploy v2.4', description: 'Rollout to 50%.' },
  { timestamp: t2, label: 'Config change' },
  { timestamp: t2 + tiny, label: 'Alert fired' },
]
const thresholds = [
  { value: 300, label: 'SLO 300ms', color: ChartPalette.semantic('Attention') },
]
</script>

<template>
  <TxTimeseriesChart :data="data" :markers="markers" :thresholds="thresholds" />
</template>
```

## 渐变与不完整数据

`gradient` 给折线加纵向渐变填充（序列色 40% → 透明）。`incomplete` 声明 `[before, after]` 之外的数据不完整：边界外的段画成虚线，且与实线段重叠一个采样点保证连线不断。

### 渐变 + 两端虚线

官方示例：`TimeseriesChartGradientDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTimeseriesChart
    :data="data"
    gradient
    :incomplete="{ before: start + 3 * hour, after: start + 20 * hour }"
  />
</template>
```

## 柱状堆叠

`type="bar"` 下所有序列自动堆叠（同 kumo 的 `stack: 'total'`），y 轴范围按每个时间点的堆叠总量计算。

### 按天堆叠

官方示例：`TimeseriesChartBarDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTimeseriesChart type="bar" :data="data" :x-axis-tick-format="formatDay" />
</template>
```

## 刷选时间范围

监听 `time-range-change` 即自动启用横向刷选：在绘图区拖拽出选区，松手回调 `(from, to)` 毫秒时间戳并清除选区。太短的拖拽（< 3px）视为点击不触发。

### 拖拽选段

官方示例：`TimeseriesChartRangeDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTimeseriesChart :data="data" @time-range-change="(from, to) => (range = [from, to])" />
</template>
```

## 图例联动

`v-model:hidden-series` 双向绑定被隐藏的序列名数组：隐藏的序列不画、tooltip 也跳过。`highlighted-series` 高亮一条序列，其余降到 30% 不透明度。两者配合 `TxChartLegendItem` 即得可点击、可悬停高亮的图例。

### 点击隐藏 + 悬停高亮

官方示例：`TimeseriesChartLegendDemo`（完整源码见本页末尾）

```vue
<template>
  <TxChartLegendItem
    v-for="(name, i) in names"
    :key="name"
    :name="name"
    :color="ChartPalette.categoricalVar(i)"
    value=""
    :inactive="hidden.includes(name)"
    @click="toggle(name)"
    @pointerenter="highlighted = name"
    @pointerleave="highlighted = null"
  />
  <TxTimeseriesChart v-model:hidden-series="hidden" :data="data" :highlighted-series="highlighted" />
</template>
```

## 加载骨架

`loading` 用谐波波形骨架替换图表，折线与柱状两种形态共享同一条轮廓；shimmer 尊重 `prefers-reduced-motion`。

### 骨架轮播

官方示例：`TimeseriesChartLoadingDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTimeseriesChart :data="data" :type="type" :loading="loading" />
</template>
```

## API

### TimeseriesChart Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `data` | `TimeseriesData[]` | — | `{ name, data: [ts, value][], color? }`；`color` 缺省按位次取分类色。 |
| `type` | `'line' \| 'bar'` | `'line'` | 柱状自动堆叠。 |
| `markers` | `TimeseriesMarker[]` | — | `{ timestamp, label?, description?, color?, lineStyle? }`。 |
| `thresholds` | `TimeseriesThreshold[]` | — | `{ value, label?, color }`，y 轴自动扩展覆盖。 |
| `xAxisName` / `yAxisName` | `string` | — | 轴名。 |
| `xAxisTickCount` / `yAxisTickCount` | `number` | `5` | 建议刻度数。 |
| `xAxisTickFormat` / `yAxisTickFormat` | `(v: number) => string` | — | 刻度格式化。 |
| `tooltipValueFormat` | `(v: number) => string` | 原值 | tooltip 数值格式化。 |
| `tooltipMode` | `'all' \| 'single'` | `'all'` | `single` 只显示离光标 y 值最近的一条。 |
| `tooltipMaxItems` | `number` | `10` | 超出折叠为「+N more」。 |
| `tooltipFollowCursor` | `'both' \| 'x'` | `'both'` | `x` 时垂直位置固定，避免抖动。 |
| `incomplete` | `{ before?, after? }` | — | 不完整周期（仅 line）。 |
| `gradient` | `boolean` | `false` | 折线渐变填充。 |
| `loading` | `boolean` | `false` | 骨架态。 |
| `highlightedSeries` | `string \| null` | — | 高亮序列，其余 30% 不透明度。 |
| `height` | `number` | `350` | 像素高度。 |
| `width` | `number` | 容器实测 | 显式宽度（SSR/测试用）。 |
| `ariaDescription` | `string` | — | 无障碍描述（svg `role="img"`）。 |
| `clusterLabel` | `(n: number) => string` | `` n => `${n} changes` `` | 聚簇标签文案。 |
| `timestampFormat` | `(ts: number) => string` | 紧凑本地化 | tooltip 时间行格式。 |

### TimeseriesChart Events

| 事件名 | 回调参数 | 说明 |
|------|------|------|
| `time-range-change` | `(from: number, to: number)` | 刷选完成。挂上即启用刷选。 |
| `update:hiddenSeries` | `(names: string[])` | `v-model:hidden-series` 写回。 |

## 与 kumo 的差异

- `enableLegendSelection` + echarts 命令式 action → `v-model:hidden-series` 声明式绑定；高亮用 `highlighted-series`。
- `tooltipBoundary`（clipping-ancestors 碰撞）简化为容器钳制 + 视口翻转。
- 刷选拖拽过程中不做选区外 30% 变淡（kumo 的 outOfBrush 瞬态），只画选区矩形。
- 建议每条序列 ≤ 5k 点：SVG 渲染在万点级会出现掉帧。

## 离线完整示例源码

- [TimeseriesChartBasicDemo](../snapshot/apps/nexus/app/components/content/demos/TimeseriesChartBasicDemo.vue.txt)
- [TimeseriesChartMarkersDemo](../snapshot/apps/nexus/app/components/content/demos/TimeseriesChartMarkersDemo.vue.txt)
- [TimeseriesChartGradientDemo](../snapshot/apps/nexus/app/components/content/demos/TimeseriesChartGradientDemo.vue.txt)
- [TimeseriesChartBarDemo](../snapshot/apps/nexus/app/components/content/demos/TimeseriesChartBarDemo.vue.txt)
- [TimeseriesChartRangeDemo](../snapshot/apps/nexus/app/components/content/demos/TimeseriesChartRangeDemo.vue.txt)
- [TimeseriesChartLegendDemo](../snapshot/apps/nexus/app/components/content/demos/TimeseriesChartLegendDemo.vue.txt)
- [TimeseriesChartLoadingDemo](../snapshot/apps/nexus/app/components/content/demos/TimeseriesChartLoadingDemo.vue.txt)

## 离线类型与实现参考

- [axis/index.ts](../snapshot/packages/tuffex-charts/src/axis/index.ts.txt)
- [src/TxAxis.vue](../snapshot/packages/tuffex-charts/src/axis/src/TxAxis.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex-charts/src/axis/src/types.ts.txt)
- [chart-legend/index.ts](../snapshot/packages/tuffex-charts/src/chart-legend/index.ts.txt)
- [src/TxChartLegendItem.vue](../snapshot/packages/tuffex-charts/src/chart-legend/src/TxChartLegendItem.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex-charts/src/chart-legend/src/types.ts.txt)
- [chart/index.ts](../snapshot/packages/tuffex-charts/src/chart/index.ts.txt)
- [src/TxChart.vue](../snapshot/packages/tuffex-charts/src/chart/src/TxChart.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex-charts/src/chart/src/types.ts.txt)
- [core/accessor.ts](../snapshot/packages/tuffex-charts/src/core/accessor.ts.txt)
- [core/context.ts](../snapshot/packages/tuffex-charts/src/core/context.ts.txt)
- [core/scales.ts](../snapshot/packages/tuffex-charts/src/core/scales.ts.txt)
- [core/types.ts](../snapshot/packages/tuffex-charts/src/core/types.ts.txt)
- [core/uid.ts](../snapshot/packages/tuffex-charts/src/core/uid.ts.txt)
- [grid/index.ts](../snapshot/packages/tuffex-charts/src/grid/index.ts.txt)
- [src/TxGrid.vue](../snapshot/packages/tuffex-charts/src/grid/src/TxGrid.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex-charts/src/grid/src/types.ts.txt)
- [src/index.ts](../snapshot/packages/tuffex-charts/src/index.ts.txt)
- [maps/index.ts](../snapshot/packages/tuffex-charts/src/maps/index.ts.txt)
- [src/TxBubbleMap.vue](../snapshot/packages/tuffex-charts/src/maps/src/TxBubbleMap.vue.txt)
- [src/TxChoroplethMap.vue](../snapshot/packages/tuffex-charts/src/maps/src/TxChoroplethMap.vue.txt)
- [src/accessor.ts](../snapshot/packages/tuffex-charts/src/maps/src/accessor.ts.txt)
- [src/color.ts](../snapshot/packages/tuffex-charts/src/maps/src/color.ts.txt)
- [src/map-shared.scss](../snapshot/packages/tuffex-charts/src/maps/src/map-shared.scss.txt)
- [src/projection.ts](../snapshot/packages/tuffex-charts/src/maps/src/projection.ts.txt)
- [src/roam.ts](../snapshot/packages/tuffex-charts/src/maps/src/roam.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex-charts/src/maps/src/types.ts.txt)
- [src/use-map-base.ts](../snapshot/packages/tuffex-charts/src/maps/src/use-map-base.ts.txt)
- [palette/index.ts](../snapshot/packages/tuffex-charts/src/palette/index.ts.txt)
- [src/palette.ts](../snapshot/packages/tuffex-charts/src/palette/src/palette.ts.txt)
- [sankey/index.ts](../snapshot/packages/tuffex-charts/src/sankey/index.ts.txt)
- [src/TxSankeyChart.vue](../snapshot/packages/tuffex-charts/src/sankey/src/TxSankeyChart.vue.txt)
- [src/layout.ts](../snapshot/packages/tuffex-charts/src/sankey/src/layout.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex-charts/src/sankey/src/types.ts.txt)
- [series/index.ts](../snapshot/packages/tuffex-charts/src/series/index.ts.txt)
- [src/TxArcSeries.vue](../snapshot/packages/tuffex-charts/src/series/src/TxArcSeries.vue.txt)
- [src/TxAreaSeries.vue](../snapshot/packages/tuffex-charts/src/series/src/TxAreaSeries.vue.txt)
- [src/TxBarSeries.vue](../snapshot/packages/tuffex-charts/src/series/src/TxBarSeries.vue.txt)
- [src/TxLineSeries.vue](../snapshot/packages/tuffex-charts/src/series/src/TxLineSeries.vue.txt)
- [src/TxScatterSeries.vue](../snapshot/packages/tuffex-charts/src/series/src/TxScatterSeries.vue.txt)
- [src/curves.ts](../snapshot/packages/tuffex-charts/src/series/src/curves.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex-charts/src/series/src/types.ts.txt)
- [src/use-series.ts](../snapshot/packages/tuffex-charts/src/series/src/use-series.ts.txt)
- [style/index.scss](../snapshot/packages/tuffex-charts/src/style/index.scss.txt)
- [style/tokens.scss](../snapshot/packages/tuffex-charts/src/style/tokens.scss.txt)
- [timeseries/index.ts](../snapshot/packages/tuffex-charts/src/timeseries/index.ts.txt)
- [src/TxTimeseriesAnnotations.vue](../snapshot/packages/tuffex-charts/src/timeseries/src/TxTimeseriesAnnotations.vue.txt)
- [src/TxTimeseriesBrush.vue](../snapshot/packages/tuffex-charts/src/timeseries/src/TxTimeseriesBrush.vue.txt)
- [src/TxTimeseriesChart.vue](../snapshot/packages/tuffex-charts/src/timeseries/src/TxTimeseriesChart.vue.txt)
- [src/TxTimeseriesSkeleton.vue](../snapshot/packages/tuffex-charts/src/timeseries/src/TxTimeseriesSkeleton.vue.txt)
- [src/brush.ts](../snapshot/packages/tuffex-charts/src/timeseries/src/brush.ts.txt)
- [src/format.ts](../snapshot/packages/tuffex-charts/src/timeseries/src/format.ts.txt)
- [src/incomplete.ts](../snapshot/packages/tuffex-charts/src/timeseries/src/incomplete.ts.txt)
- [src/markers.ts](../snapshot/packages/tuffex-charts/src/timeseries/src/markers.ts.txt)
- [src/tooltip-data.ts](../snapshot/packages/tuffex-charts/src/timeseries/src/tooltip-data.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex-charts/src/timeseries/src/types.ts.txt)
- [tooltip/index.ts](../snapshot/packages/tuffex-charts/src/tooltip/index.ts.txt)
- [src/TxChartTooltip.vue](../snapshot/packages/tuffex-charts/src/tooltip/src/TxChartTooltip.vue.txt)
- [src/position.ts](../snapshot/packages/tuffex-charts/src/tooltip/src/position.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex-charts/src/tooltip/src/types.ts.txt)
- [utils/with-install.ts](../snapshot/packages/tuffex-charts/src/utils/with-install.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
