# Maps 地图

> GeoJSON 地图：气泡图与分级填色图，Mercator 默认投影，缩放平移。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/maps) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/maps.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/maps.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.1.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Maps 地图

## 基础用法

两个地图组件都吃一份 `FeatureCollection` GeoJSON（包不内置地理数据，调用方自带），默认投影是纬度钳制在 ±85.05° 的 Mercator，显示窗裁掉两极空白让陆地铺满容器。容器高度默认按投影窗口的宽高比自适应，传 `height` 可固定像素高。数据用 accessor 模式取值：key 或 `(row) => value` 都行。

### 气泡图

官方示例：`MapsBubbleMapDemo`（完整源码见本页末尾）

```vue
<template>
  <TxBubbleMap
    :geo-json="world"
    :data="colos"
    lng="lon"
    lat="lat"
    value="requests"
    name="city"
    roam
    :value-format="(v) => `${v.toLocaleString()} req/s`"
  />
</template>
```

### 分级填色图

官方示例：`MapsChoroplethDemo`（完整源码见本页末尾）

```vue
<template>
  <TxChoroplethMap
    :geo-json="world"
    :data="data"
    name="country"
    value="share"
    show-legend
    :value-format="(v) => `${v}%`"
  />
</template>
```

## 投影与缩放

`projection` 接 d3-geo 投影实例（如 `geoNaturalEarth1()`），`null` 退化为裸经纬度（equirectangular）。实例会被原地 `fitExtent`，务必传稳定引用。`zoom`（默认 1.25）是自适应缩放的倍率；`roam` 开启滚轮缩放 + 拖拽平移，缩放范围被限制在 `[min(1, zoom), zoom × 8]`，气泡与描边在缩放下保持恒定像素尺寸。

## 分级色阶

分级填色是**连续**插值：值归一化后落在 `--tx-chart-map-scale-1..5` 相邻两档之间，用 CSS `color-mix(in oklab, …)` 混合——明暗主题切换时色阶自动翻转，JS 不做任何颜色解析。`colorRange` 可换整套色阶，`min`/`max` 可固定标尺范围。

## API

### 共同 Props（两个组件）

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `geoJson` | `MapGeoJson` | — | `FeatureCollection`，调用方提供。 |
| `center` | `[lng, lat]` | 自适应 | 地图中心。 |
| `zoom` | `number` | `1.25` | 自适应缩放倍率。 |
| `roam` | `boolean` | `false` | 滚轮缩放 + 拖拽平移。 |
| `projection` | `GeoProjection \| null` | 钳制 Mercator | d3-geo 投影；`null` 为裸经纬度。 |
| `showTooltip` | `boolean` | `true` | 悬停提示框。 |
| `valueFormat` | `(v: number) => string` | `toLocaleString` | 默认 tooltip 的数值格式。 |
| `aspectRatio` | `number \| string` | 投影窗口比 | 容器宽高比。 |
| `height` | `number` | — | 固定像素高，优先于 `aspectRatio`。 |
| `width` | `number` | 容器实测 | 显式宽度（SSR/测试用）。 |

### BubbleMap 专有

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `data` / `lng` / `lat` / `value` / `name?` | accessor | — | 数据行与取值器。 |
| `minRadius` / `maxRadius` | `number` | `6` / `26` | 气泡半径区间（面积正比于值，sqrt 缩放）。 |
| `bubbleSize` | `(v: number) => number` | — | 显式半径，覆盖 min/max 缩放。 |
| `bubbleColor` | `MapStyle<T, string>` | 图表蓝 | 常量或 `(row) => color`。 |
| `bubbleBorderColor` / `bubbleBorderWidth` | `MapStyle` | `'transparent'` / `0` | 描边。 |

BubbleMap 事件：`bubble-hover(row \| undefined)`、`bubble-click(row)`；插槽 `tooltip`（作用域 `{ row }`）。

### ChoroplethMap 专有

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `data` / `name` / `value` | accessor | — | 数据行；`name` 与 feature 的 `nameProperty` 连接。 |
| `nameProperty` | `string` | `'name'` | 连接用的 feature 属性；真实数据常用 ISO 码更稳。 |
| `colorRange` | `string[]` | 主题色阶 | 低→高的连续色阶。 |
| `min` / `max` | `number` | 数据极值 | 标尺范围。 |
| `noDataColor` | `string` | 陆地底色 | 无匹配数据的地区填充。 |
| `showLegend` | `boolean` | `false` | 渐变图例条。 |

ChoroplethMap 事件：`region-hover(row \| undefined)`、`region-click(row)`（都只对有数据的地区触发）；插槽 `tooltip`（作用域 `{ row, regionName, value }`）。

## 与 kumo 的差异

- `projection` 直接接 d3-geo 实例（kumo 是 `{ project, unproject }` 包装给 echarts 用）；`null` 实现为 equirectangular。
- 缩放实现为 SVG transform，气泡/描边按缩放系数反缩，视觉尺寸恒定。
- `tooltipFormatter`（HTML 字符串）→ `tooltip` 插槽。

## 离线完整示例源码

- [MapsBubbleMapDemo](../snapshot/apps/nexus/app/components/content/demos/MapsBubbleMapDemo.vue.txt)
- [MapsChoroplethDemo](../snapshot/apps/nexus/app/components/content/demos/MapsChoroplethDemo.vue.txt)

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
