# Custom Chart 自定义图表

> 组合式逃生舱：TxChart 容器 + 轴/网格/系列原语，自由拼装折线、面积、柱、散点与环形。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/custom-chart) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/custom-chart.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/custom-chart.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.1.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Custom Chart 自定义图表

## 基础用法

kumo 的逃生舱是把原始 echarts options 透传给低层 `Chart`；这里没有 echarts，逃生舱是**组合**：`TxChart` 建立坐标系（测量容器、推导比例尺、分配色板），轴/网格/系列作为子组件挂进它的默认插槽。系列统一 accessor 取数（key 或 `(d, i) => v`），不给 `color` 时按挂载顺序取分类色。x/y 值域缺省由所有系列的数据并集推导，`xDomain`/`yDomain` 可显式覆盖。

### 柱线复合

官方示例：`CustomChartComposedDemo`（完整源码见本页末尾）

```vue
<template>
  <TxChart x-type="band" :height="280" :padding="{ top: 24, right: 24, bottom: 36, left: 56 }">
    <TxGrid y />
    <TxAxis position="bottom" />
    <TxAxis position="left" :format="(v) => `${v}k`" />
    <TxBarSeries :data="rows" x="month" y="revenue" :radius="3" />
    <TxLineSeries :data="rows" x="month" y="growth" curve="monotone" show-symbol />
  </TxChart>
</template>
```

### 环形图

官方示例：`CustomChartDonutDemo`（完整源码见本页末尾）

```vue
<template>
  <TxChart :height="260" :padding="8">
    <TxArcSeries :data="data" value="count" name="label" :inner-radius="0.65" @slice-click="onSlice" />
  </TxChart>
</template>
```

### 自定义提示框

官方示例：`CustomChartTooltipDemo`（完整源码见本页末尾）

```vue
<template>
  <TxChart :height="260">
    <TxScatterSeries :data="points" x="x" y="y" :r="(d) => d.size" />
    <template #overlay>
      <TxChartTooltip follow="x" :fixed-y="8">
        <template #default="{ pointerX }">
          <span>cursor at {{ Math.round(pointerX) }}px</span>
        </template>
      </TxChartTooltip>
    </template>
  </TxChart>
</template>
```

## 组合规则

- 系列/轴/网格必须是 `<TxChart>` 的子孙——它们通过注入的图表上下文拿比例尺，游离使用会抛错。
- 多个 `TxBarSeries`：无 `stack` 并排分道，同 `stack` 键堆叠；y 值域自动覆盖堆叠总量。
- `TxArcSeries` 不依赖坐标系，可与无轴 `TxChart` 单独使用。
- `#overlay` 插槽是 SVG 之上的 DOM 层（`pointer-events: none`），放提示框与标注。
- 深度定制可 `useChartContext()` 自写图层，或从 `TxChart` 实例的 `context` 暴露读取比例尺。

## API

### Chart Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `height` | `number` | `350` | 像素高；设 `aspectRatio` 时忽略。 |
| `aspectRatio` | `number \| string` | — | 容器宽高比。 |
| `width` | `number` | 容器实测 | 显式宽度（SSR/测试用）。 |
| `padding` | `number \| Partial<ChartPadding>` | `24` | 留给轴与标签的内边距。 |
| `xType` | `'linear' \| 'time' \| 'band'` | `'linear'` | x 比例尺类型。 |
| `xDomain` / `yDomain` | 数组 | 自动并集 | 显式值域。 |
| `yNice` | `boolean` | `true` | y 值域取整。 |
| `ariaDescription` | `string` | — | 无障碍描述。 |

### 系列 Props（共同）

| 属性名 | 类型 | 说明 |
|------|------|------|
| `data` | `T[]` | 数据行。 |
| `x` / `y` | `keyof T \| (d, i) => v` | accessor。 |
| `color` | `string` | 缺省按挂载顺序取分类色。 |

`TxLineSeries` 另有 `curve`（`linear/monotone/natural/step`）、`strokeWidth`、`showSymbol`、`dashed`；`TxAreaSeries` 有 `gradient`（默认开）与 `fillOpacity`；`TxBarSeries` 有 `stack`、`barWidth`、`radius`；`TxScatterSeries` 有 `r`（常量或 accessor）；`TxArcSeries` 用 `value/name?/color?` accessor 加 `innerRadius/padAngle/cornerRadius`，点击发 `slice-click`。

### ChartTooltip Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `open` | `boolean \| 'auto'` | `'auto'` | `'auto'` 指针在图内即显示；布尔为受控。 |
| `follow` | `'both' \| 'x'` | `'both'` | `x` 固定垂直位置。 |
| `offset` | `number` | `12` | 指针与提示框间距。 |
| `title` / `rows` / `hiddenCount` | — | — | 默认内容；插槽整体替换。 |

## 离线完整示例源码

- [CustomChartComposedDemo](../snapshot/apps/nexus/app/components/content/demos/CustomChartComposedDemo.vue.txt)
- [CustomChartDonutDemo](../snapshot/apps/nexus/app/components/content/demos/CustomChartDonutDemo.vue.txt)
- [CustomChartTooltipDemo](../snapshot/apps/nexus/app/components/content/demos/CustomChartTooltipDemo.vue.txt)

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
