# SankeyChart 桑基图

> d3-sankey 布局的流向图：渐变连线、节点值标签、下钻标记与插槽提示框。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/sankey-chart) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/sankey-chart.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/sankey-chart.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.1.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# SankeyChart 桑基图

## 基础用法

`nodes` 是节点数组，`links` 用**节点下标**连接（`source`/`target` 是 `nodes` 的索引）。节点色优先级：`node.color` > `defaultNodeColor` > 分类色板按下标轮转。连线默认按来源色→目标色渐变，`link-color="gray"` 换成整齐的灰。任一节点带 `value` 时值标签自动开启（`showNodeValues` 可强制开关）。

### 流量分发

官方示例：`SankeyChartBasicDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const nodes = [
  { name: 'Organic', value: 5200 },
  { name: 'Referral', value: 2100 },
  { name: 'Landing', value: 8700, tooltipData: { Sessions: 8700, 'Bounce rate': '32%' } },
  { name: 'Signup', value: 2600, isDrillable: true, childCount: 4 },
]
const links = [
  { source: 0, target: 2, value: 5200 },
  { source: 1, target: 2, value: 2100 },
  { source: 2, target: 3, value: 2600, isDrillable: true },
]
</script>

<template>
  <TxSankeyChart :nodes="nodes" :links="links" @node-click="onNode" @link-click="onLink" />
</template>
```

### 行内标签与灰连线

官方示例：`SankeyChartLabelsDemo`（完整源码见本页末尾）

```vue
<template>
  <TxSankeyChart
    :nodes="nodes"
    :links="links"
    node-label-layout="inline"
    link-color="gray"
    :format-value="(v) => `${(v / 1000).toFixed(1)}k`"
  />
</template>
```

## 容错

环形连接会让 d3-sankey 抛错——组件捕获后渲染空态并在控制台给出 dev 警告，不会拖垮宿主页面。

## API

### SankeyChart Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `nodes` | `SankeyNodeData[]` | — | `{ name, color?, value?, tooltipData?, isDrillable?, childCount? }`。 |
| `links` | `SankeyLinkData[]` | — | `{ source, target, value, isDrillable? }`，下标引用节点。 |
| `height` | `number` | `400` | 像素高度。 |
| `width` | `number` | 容器实测 | 显式宽度（SSR/测试用）。 |
| `nodeWidth` | `number` | `8` | 节点条宽。 |
| `nodePadding` | `number` | `10` | 同列节点垂直间距。 |
| `showNodeValues` | `boolean \| 'auto'` | `'auto'` | `'auto'` 在任一节点有 `value` 时开启。 |
| `nodeLabelLayout` | `'stacked' \| 'inline'` | `'stacked'` | 值在名称上方 / 同行。 |
| `formatValue` | `(v: number) => string` | `toLocaleString` | 值格式化。 |
| `showTooltip` | `boolean` | `true` | 悬停提示框。 |
| `defaultNodeColor` | `string` | — | 分类色板前的兜底色。 |
| `left` / `right` | `number \| string` | `'5%'` | 布局左右留白（px 或百分比）。 |
| `linkColor` | `'gradient' \| 'gray'` | `'gradient'` | 连线填充模式。 |
| `linkOpacity` | `number` | `0.5` | 渐变连线不透明度。 |

### SankeyChart Events

| 事件名 | 回调参数 | 说明 |
|------|------|------|
| `node-click` | `(node: SankeyNodeData)` | 点击节点，回传原始数据。 |
| `link-click` | `(link: SankeyLinkData)` | 点击连线，回传原始数据。 |

### SankeyChart Slots

| 插槽名 | 作用域参数 | 说明 |
|------|------|------|
| `tooltip` | `{ params: SankeyTooltipParams }` | 整体替换提示框内容；`params.type` 为 `'node' \| 'link'`。 |

## 与 kumo 的差异

- `tooltipFormatter`（HTML 字符串 + 手工 XSS 转义）→ `tooltip` 插槽（VNode）。
- kumo 遇环形输入直接抛错；这里降级为空渲染 + dev 警告。

## 离线完整示例源码

- [SankeyChartBasicDemo](../snapshot/apps/nexus/app/components/content/demos/SankeyChartBasicDemo.vue.txt)
- [SankeyChartLabelsDemo](../snapshot/apps/nexus/app/components/content/demos/SankeyChartLabelsDemo.vue.txt)

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
