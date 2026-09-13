# SignalMeter 信号量表

> 分段强度条，用几格填充表达置信度、相关度或信号强弱。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/signal-meter) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/signal-meter.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/signal-meter.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# SignalMeter 信号量表

## 基础用法

### 四档强度

点亮格数由 `value` 决定，未点亮的格固定用发丝线色，不受 `tone` 影响。

官方示例：`SignalMeterLevelsDemo`（完整源码见本页末尾）

```vue
<template>
  <TxSignalMeter :value="3" tone="var(--tx-bui-green)" label="高置信" />
  <TxSignalMeter :value="2" tone="var(--tx-bui-orange)" label="需要复核" />
  <TxSignalMeter :value="1" tone="var(--tx-bui-red)" label="证据薄弱" />
  <TxSignalMeter :value="0" tone="var(--tx-bui-ink-3)" label="无信号" />
</template>
```

## 适用场景

- 建议卡的置信度页脚与备选列表——`TxRecommendationCard` 内部就用它。
- 检索结果的相关度：三格比一个百分比更容易横向扫读。
- 任何「强 / 中 / 弱 / 无」的离散量。连续量请用 `TxProgressBar`。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `value` | `number` | — | 点亮的格数。必填；超出 `[0, max]` 会被夹紧，小数向零取整。 |
| `max` | `number` | `3` | 总格数。 |
| `tone` | `string` | `'currentColor'` | 点亮格的颜色，任意 CSS 颜色值。默认继承父级文字色。 |
| `label` | `string` | — | 无障碍名称。不传时整条被标记 `aria-hidden`。 |
| `barHeight` | `number` | `10` | 单格高度（px）。 |
| `barWidth` | `number` | `4` | 单格宽度（px）。 |

### Events

组件没有交互，不派发任何事件。

### Slots

组件没有插槽。

## 交互契约

- 纯展示原语：没有事件、没有内部状态，`value` 变化即重绘。
- **`label` 决定无障碍语义。** 传了就渲染 `role="img"` + `aria-label`；不传就整条 `aria-hidden="true"`。后者是刻意的——三个空 `span` 被逐个念出来只是噪音，而这条量表在实际版式里总是紧挨一段可见文字。
- `value` 越界不会报错也不会溢出，一律夹紧到 `[0, max]`。
- `tone` 收的是裸 CSS 颜色字符串，**不参与主题切换**。想跟随主题就传 `var(--tx-color-success)` 这类变量，而不是十六进制值。
- 填充色过渡 300ms；`prefers-reduced-motion: reduce` 下取消过渡，保留最终颜色。

## 最佳实践

- 颜色永远不是状态的唯一载体：量表旁边要有文字标签（`高置信` / `需要复核`），并把同一段文字传给 `label`。
- 同屏内保持相同 `max`，否则「三格里的两格」和「五格里的两格」会被读成同一强度。
- 父级已有可见标签时，量表本身不传 `label`，让读屏只念一次。
- 在宿主侧把 `confidence` 这类语义值映射成 `value` + `tone`，不要在模板里散落魔数。

## Source

- Component source: `packages/tuffex/packages/components/src/signal-meter/src/TxSignalMeter.vue`。
- Types: `packages/tuffex/packages/components/src/signal-meter/src/types.ts`。
- **实测覆盖:** `packages/tuffex/packages/components/src/signal-meter/__tests__/signal-meter.test.ts`（6 项）验证格数与点亮数、受控 `value` 回路、越界夹紧、自定义 `max`、`label` 有无时的 `role` / `aria-hidden` 分支，以及 tone 与几何写进自定义属性。
- 移植自 Beautiful UI（https://www.beautifului.dev），© 2026 Shane Levine，MIT。



## 审阅说明

- **与既有徽标的分工:** `TxStatusBadge` 是五档语义 tone 的带框徽标，`TxProgressBar` 是连续进度。本组件是裸的离散格子，接受任意颜色，没有边框也没有图标——三者不要互相替代。
- **上游差异:** 上游把量表写在建议卡内部，只有 3 格且颜色硬编码。这里抽成独立原语并把格数做成 `max`，因为同一形状在检索相关度上也用得到。

## 离线完整示例源码

- [SignalMeterLevelsDemo](../snapshot/apps/nexus/app/components/content/demos/SignalMeterLevelsDemo.vue.txt)

## 离线类型与实现参考

- [signal-meter/index.ts](../snapshot/packages/tuffex/packages/components/src/signal-meter/index.ts.txt)
- [src/TxSignalMeter.vue](../snapshot/packages/tuffex/packages/components/src/signal-meter/src/TxSignalMeter.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/signal-meter/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
