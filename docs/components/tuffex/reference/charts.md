# Charts 图表

> @talex-touch/tuffex-charts 总览：kumo 同构的 API 面，Vue 直渲 SVG，无 echarts。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/charts) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/charts.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/charts.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.1.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Charts 图表

## 安装与引入

图表家族在独立包 `@talex-touch/tuffex-charts` 里，API 面对标 Cloudflare kumo 的 Charts 族，但渲染层是 Vue 直出的 SVG——不依赖 echarts，也不依赖任何整图表框架，数学只用可摇树的 d3 微模块（`d3-scale` / `d3-shape` / `d3-sankey` / `d3-geo`）。

```bash
pnpm add @talex-touch/tuffex-charts
```

```ts
import { TxTimeseriesChart } from '@talex-touch/tuffex-charts'
import '@talex-touch/tuffex-charts/style.css'
```

## 可用图表

| 组件 | 板块 | 说明 |
|------|------|------|
| `TxTimeseriesChart` | [Timeseries](./timeseries-chart.md) | 时序折线/堆叠柱，标记、阈值、刷选、tooltip 全家桶。 |
| `TxBubbleMap` / `TxChoroplethMap` | [Maps](./maps.md) | GeoJSON 地图：气泡与分级填色。 |
| `TxSankeyChart` | [Sankey](./sankey-chart.md) | 桑基流向图。 |
| `TxChart` + 系列原语 | [Custom Chart](./custom-chart.md) | 组合式逃生舱：折线/面积/柱/散点/环形自由拼装。 |
| `ChartPalette` / CSS 变量 | [Colors](./chart-colors.md) | 分类、语义、顺序、地图色板，明暗自动。 |

## 分组一览

下面按分组列出该套件的**全部**组件，数据来自每个文档的 `category` frontmatter，新增组件会自动出现。

此处为官网动态目录/交互图库；离线组件与审阅状态见 [组件索引](../COMPONENTS.md)。

## 图例

`TxChartLegendItem` 提供两种图例项版式：`small` 单行（多序列图例），`large` 堆叠大数值（仪表卡单指标）。`loading` 渲染骨架占位；挂了 `click` 监听时它会渲染成原生 `button`，回车/空格开箱可用。

### 图例项

官方示例：`ChartsLegendItemsDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ChartPalette, TxChartLegendItem } from '@talex-touch/tuffex-charts'
import { ref } from 'vue'

const inactive = ref(false)
</script>

<template>
  <TxChartLegendItem name="Requests" :color="ChartPalette.categoricalVar(0)" value="1,234" @click="inactive = !inactive" />
  <TxChartLegendItem name="Errors" :color="ChartPalette.categoricalVar(2)" value="87" :inactive="inactive" />
  <TxChartLegendItem loading />
  <TxChartLegendItem variant="large" name="Latency" :color="ChartPalette.categoricalVar(3)" value="42" unit="ms" />
</template>
```

## API

### ChartLegendItem Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `variant` | `'small' \| 'large'` | `'small'` | 单行 / 堆叠大数值两种版式。 |
| `name` | `string` | — | 序列名。`loading` 时可省略。 |
| `color` | `string` | — | 色点颜色，接受任意 CSS 颜色（含 `var()`）。 |
| `value` | `string` | — | 已格式化的数值文本。 |
| `unit` | `string` | — | 数值后的单位（仅 `large`）。 |
| `inactive` | `boolean` | `false` | 半透明表示被反选。 |
| `loading` | `boolean` | `false` | 渲染骨架占位（`aria-hidden`，不可聚焦）。 |

## 与 kumo 的差异

- 没有 `echarts` 实例 prop——渲染层自研，调用方不需要也不能传 echarts。
- 没有 `isDarkMode` prop——取色全部走 `--tx-chart-*` CSS 变量，跟随宿主 `.dark` / `[data-theme='dark']` 自动切换。
- 所有 HTML 字符串 formatter 一律改为插槽（VNode），不存在 XSS 转义面。

## 离线完整示例源码

- [ChartsLegendItemsDemo](../snapshot/apps/nexus/app/components/content/demos/ChartsLegendItemsDemo.vue.txt)

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
