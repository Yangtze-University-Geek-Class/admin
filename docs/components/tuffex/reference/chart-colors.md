# Chart Colors 图表色板

> 分类、语义、顺序与地图色板：CSS 变量随主题自动切换，ChartPalette 提供字面值。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/chart-colors) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/chart-colors.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/chart-colors.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.1.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Chart Colors 图表色板

## 双轨取色

图表组件内部**只**读 `--tx-chart-*` CSS 变量，`.dark` 或 `[data-theme='dark']` 下自动换成暗色值——所以没有 `isDarkMode` prop。`ChartPalette` 则给包外场景（周边 UI 对色、导出图片、canvas）提供十六进制字面值，函数签名与 kumo 同名同形，带 `isDark` 参数。

### 色板总览

官方示例：`ChartColorsPaletteDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ChartPalette } from '@talex-touch/tuffex-charts'

const sequential = ChartPalette.sequential('blues')
</script>

<template>
  <span
    v-for="index in 6"
    :key="index"
    :style="{ background: ChartPalette.categoricalVar(index - 1) }"
  />
</template>
```

## 三套色板

- **分类（categorical）**：6 色按序列位次轮转（模 6 回绕），第 1 位蓝 `#4290F0` 同时是全家族的锚色。暗色下只有 Yellow 换值。
- **语义（semantic）**：`Attention` / `Warning` / `Success` / `Neutral` / `Disabled` / `Skeleton`，表达状态而非序列身份；暗色下 Neutral / Disabled / Skeleton 换值。
- **顺序（sequential）**：`blues` 五档，低→高；暗色是方向反转的一套（第 4 档为暗底单独调过，不是简单镜像）。

地图另有一套 `--tx-chart-map-*`（陆地底色 + 五档分级色阶），见 [Maps](./maps.md)。

## API

### ChartPalette

| 方法 | 返回 | 说明 |
|------|------|------|
| `categorical(index, isDark?)` | `string` | 第 `index` 位分类色（模 6 回绕）。 |
| `categoricalVar(index)` | `string` | 同一位次的 `var(--tx-chart-categorical-N, #hex)` 引用，跟随主题。 |
| `semantic(name, isDark?)` | `string` | 语义色，`name` 为 `'Attention'` 等六个之一。 |
| `sequential('blues', isDark?)` | `string[]` | 顺序色板五档（每次返回新数组）。 |
| `text('primary' \| 'secondary', isDark?)` | `string` | 轴与标签文本色。 |
| `mapColors(isDark?)` | `MapColors` | `{ area, bubble, scale[] }` 地图配色。 |

### CSS 变量

| 变量 | 说明 |
|------|------|
| `--tx-chart-categorical-1..6` | 分类色板。 |
| `--tx-chart-semantic-attention/-warning/-success/-neutral/-disabled/-skeleton` | 语义色。 |
| `--tx-chart-sequential-blues-1..5` | 顺序色阶。 |
| `--tx-chart-text-primary/-secondary` | 文本色。 |
| `--tx-chart-grid-line` | 网格线（主文本色 20% 透明度）。 |
| `--tx-chart-map-area` / `--tx-chart-map-scale-1..5` | 地图陆地与分级色阶。 |

所有变量都带亮色 fallback，包可以脱离 tuffex 独立使用；宿主想换品牌色时覆盖变量即可，组件零改动。

## 离线完整示例源码

- [ChartColorsPaletteDemo](../snapshot/apps/nexus/app/components/content/demos/ChartColorsPaletteDemo.vue.txt)

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
