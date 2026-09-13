# OutlineBorder 描边容器

> 为头像、缩略图、徽标和自定义 slot 内容提供 border / ring 描边与可选裁切。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/outline-border) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/outline-border.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/outline-border.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# OutlineBorder 描边容器

## 基础用法

头像类描边优先使用 `ring-offset`；希望描边参与布局尺寸时使用 `border`。

官方示例：`OutlineBorderBasicDemo`（完整源码见本页末尾）

```vue
<template>
  <TxOutlineBorder :ring-width="2" ring-color="var(--tx-color-primary)" :offset="2">
    <div class="avatar">TX</div>
  </TxOutlineBorder>

  <TxOutlineBorder variant="border" :border-width="2" shape="rect" :border-radius="12">
    <div class="avatar avatar--rect">UI</div>
  </TxOutlineBorder>
</template>
```

## Mask 裁切

六边形这类无法仅靠圆角表达的形状，使用 `clip-mode="mask"` 更稳定。

官方示例：`OutlineBorderMaskClipDemo`（完整源码见本页末尾）

```vue
<template>
  <TxOutlineBorder
    variant="ring"
    :ring-width="2"
    ring-color="var(--tx-color-primary)"
    clip-mode="mask"
    clip-shape="hexagon"
  >
    <div class="hex-avatar">AI</div>
  </TxOutlineBorder>
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `as` | `string` | `'div'` | 根节点标签。 |
| `variant` | `'border' \| 'ring' \| 'ring-offset' \| 'ring-inset'` | `'ring-offset'` | 描边模式。`border` 写入 CSS border；ring 系列写入 `box-shadow`。 |
| `shape` | `'circle' \| 'rect' \| 'squircle'` | `'circle'` | 默认形状，用于默认圆角和 `clipShape="auto"`。 |
| `borderRadius` | `string \| number` | - | 显式圆角。数字会转换为 px。 |
| `borderWidth` | `string \| number` | `'1px'` | border 宽度，也是 ring 宽度的回退值。 |
| `borderColor` | `string` | `'var(--tx-border-color)'` | border 颜色，也是 ring 颜色的回退值。 |
| `borderStyle` | `'solid' \| 'dashed' \| 'dotted'` | `'solid'` | `variant="border"` 使用的 CSS border 样式。 |
| `ringWidth` | `string \| number` | `borderWidth` | ring 宽度。数字会转换为 px。 |
| `ringColor` | `string` | `borderColor` | ring 颜色。 |
| `offset` | `string \| number` | `'2px'` | `variant="ring-offset"` 使用的间隔宽度。 |
| `offsetBg` | `string` | `'var(--tx-bg-color)'` | ring-offset 间隔区域的颜色。 |
| `padding` | `string \| number` | `0` | 内层 slot 包裹器的 padding。 |
| `clipMode` | `'none' \| 'overflow' \| 'clipPath' \| 'mask'` | `'overflow'` | 应用于内容层的裁切策略。 |
| `clipShape` | `'auto' \| 'circle' \| 'rounded' \| 'squircle' \| 'hexagon'` | `'auto'` | 裁切形状。`auto` 会把 `shape` 映射为 `circle`、`rounded` 或 `squircle`。 |

### Slots

| 插槽名 | Props | 说明 |
|------|-------|------|
| `default` | - | 被描边和可选裁切层包裹的内容。 |

### Events

无组件事件。

## 交互契约

- `borderRadius`、`borderWidth`、`ringWidth`、`offset`、`padding` 的数字值都会转换为 px。
- `variant="border"` 写入真实 CSS border；ring 系列使用 `box-shadow`，不改变布局尺寸。
- `clipMode="overflow"` 通过 `border-radius` 裁切；`clipPath` 写入 CSS `clip-path`；`mask` 写入内联 SVG mask data URI。
- `clipShape="rounded"`、`"squircle"` 与默认矩形场景在 `clipPath` 下会解析为 `inset(0 round var(--tx-outline-radius))`；`squircle` 的真实异形仅在 `clipMode="mask"` 下呈现。
- `ring`/`border` 描边由 `box-shadow`/CSS border 绘制，只跟随 `border-radius`；`clipShape` 只作用于内容层，因此描边不会贴合 `hexagon`/`squircle` 等异形（需要异形描边时请改用异形 `drop-shadow` 滤镜）。
- 组件没有内置尺寸；最终盒子大小由 slot 内容决定。

## 最佳实践

- 圆形或圆角头像优先使用 `overflow`，性能更低成本，也更容易排查。
- 内容表面和描边需要视觉间隔时使用 `ring-offset`。
- 为 slot 内容设置明确宽高，避免 mask 和 ring 的几何结果随内容变化。
- 只有在行内上下文中使用 `as="span"`；卡片、缩略图和列表媒体保持块级包裹更稳。

## 审阅说明

- **可访问性说明:** `TxOutlineBorder` 只是视觉包裹器；不会添加 role、label 或图片语义。alt 文本、标签、焦点行为和点击目标应放在 slot 内容或调用方传入的根节点属性上。
- **Mask 说明:** `clipMode="mask"` 只会为 `circle`、`hexagon` 和 `squircle` 输出 mask；矩形/圆角形状应使用 `overflow` 或 `clipPath`。
- **实测覆盖:** `outline-border.test.ts` 覆盖动态根节点、slot 渲染、border 样式映射、数字单位转换、默认 ring-offset 阴影、ring/inset 变体、默认 overflow 裁切、clip-path/mask 模式，以及关闭裁切。

## Source

- Component source: `packages/tuffex/packages/components/src/outline-border/src/TxOutlineBorder.vue`。
- Types: `packages/tuffex/packages/components/src/outline-border/src/types.ts` 导出 `OutlineBorderProps`、variant、shape、clip-mode 与 clip-shape 联合类型。
- Export alias: `packages/tuffex/packages/components/src/outline-border/index.ts` 导出 `OutlineBorder`、`TxOutlineBorder`、类型联合与 `TxOutlineBorderInstance`。
- Coverage: `packages/tuffex/packages/components/src/outline-border/__tests__/outline-border.test.ts` 覆盖样式、裁切策略、根节点与 slot 行为。

## 离线完整示例源码

- [OutlineBorderBasicDemo](../snapshot/apps/nexus/app/components/content/demos/OutlineBorderBasicDemo.vue.txt)
- [OutlineBorderMaskClipDemo](../snapshot/apps/nexus/app/components/content/demos/OutlineBorderMaskClipDemo.vue.txt)

## 离线类型与实现参考

- [outline-border/index.ts](../snapshot/packages/tuffex/packages/components/src/outline-border/index.ts.txt)
- [src/TxOutlineBorder.vue](../snapshot/packages/tuffex/packages/components/src/outline-border/src/TxOutlineBorder.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/outline-border/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
