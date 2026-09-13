# KeyframeStrokeText 关键帧描边

> SVG 文本特效：先绘制描边，再显示填充，并在文字或字体输入变化后重新测量文本尺寸。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/keyframe-stroke-text) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/keyframe-stroke-text.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/keyframe-stroke-text.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# KeyframeStrokeText 关键帧描边

## 基础用法

使用短文本，并通过 props 调整描边和填充颜色。数字 `fontSize` 会转为 px。

官方示例：`KeyframeStrokeTextKeyframeStrokeTextDemo`（完整源码见本页末尾）

```vue
<template>
  <div style="display: flex; flex-direction: column; gap: 18px;">
    <TxKeyframeStrokeText text="TuffEx" :font-size="56" />

    <TxKeyframeStrokeText
      text="Stroke + Fill"
      stroke-color="#0ea5e9"
      fill-color="#0f172a"
      :duration-ms="2400"
      :stroke-width="1.8"
      :font-size="42"
      :font-weight="600"
    />
  </div>
</template>
```

## 多语言文本

组件会测量真实渲染后的 SVG 文本，因此 CJK 文案和混合语言标签可以使用同一套 API。

官方示例：`KeyframeStrokeTextChineseDemo`（完整源码见本页末尾）

```vue
<template>
  <TxKeyframeStrokeText
    text="关键帧描边动画"
    stroke-color="#16a34a"
    fill-color="#14532d"
    :duration-ms="2600"
    :stroke-width="1.6"
    :font-size="40"
    :font-weight="700"
  />
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `text` | `string` | `''` | 渲染到所有 SVG 文本层的内容。 |
| `strokeColor` | `string` | `'#4C4CFF'` | 描边阶段（先出现的动画轮廓）的颜色；深色背景上应选高对比色，否则第一段描边动画几乎不可见。 |
| `fillColor` | `string` | `'#111827'` | 描边动画结束后延迟显现的最终文字颜色。 |
| `durationMs` | `number` | `1800` | 动画时长，单位毫秒；描边和填充动画共用。 |
| `strokeWidth` | `number` | `2` | SVG 描边宽度，同时决定 viewBox padding；数值偏大（如超过 3）会明显改变布局尺寸。 |
| `fontSize` | `string \| number` | `64` | 字号；数字转为 px，字符串原样透传。 |
| `fontWeight` | `string \| number` | `700` | SVG 字重；越大字形轮廓越粗，描边动画也越厚重。 |
| `fontFamily` | `string` | `'inherit'` | SVG 字体族。 |

### Events

不触发事件。

### Slots

不暴露插槽。文本必须来自 `text` prop，才能保持测量和可访问性结果确定。

## 交互契约

- 根节点是 `role="img"` 的 SVG。
- 非空 `text` 会同步为 `aria-label`；空文本不输出 `aria-label`，并使用 non-breaking-space 保持测量稳定。
- 挂载后，以及文本、字体或描边宽度输入变化后，组件会调用 `getBBox()` 和 `getComputedTextLength()` 重新测量。
- 浏览器提供 Font Loading API 时，`document.fonts.ready` 会触发额外一次测量。
- `strokeColor`、`fillColor`、`durationMs`、`strokeWidth`、测量出的描边长度、字号、字重和字体族都通过 CSS 变量应用。
- 在 `prefers-reduced-motion: reduce` 下会禁用动画并显示最终状态。

## 最佳实践

- 用于短文案。长句会降低可读性，也会让 SVG 测量和动画显得沉重。
- 保持外层布局宽度可预测。SVG 高度跟随 `fontSize`，viewBox 宽度跟随测量出的文本长度。
- 如果动画文本只是装饰，页面语义标题应放在组件外；`text` 只承载视觉标签本身。
- 不要在大型列表中随输入逐字重渲染该组件；每次文字或字体变化都会调度测量。
- 自定义 Web Font 需要在目标页面测试；字体加载完成后测量宽度可能再次变化。

## 审阅说明

- **可访问性说明:** 源码始终渲染 `role="img"` 的 SVG；非空 `text` 会成为可访问名称，但没有 `aria-hidden` prop。如果动画只是装饰，语义标题或标签仍应放在组件外。
- **实测覆盖:** `keyframe-stroke-text.test.ts` 覆盖可访问 SVG/文本层、CSS 变量映射、空文本 fallback、prop 变化后的重新测量，以及 install 注册。

## Source

- Component source: `packages/tuffex/packages/components/src/keyframe-stroke-text/src/TxKeyframeStrokeText.vue`。
- Types: `packages/tuffex/packages/components/src/keyframe-stroke-text/src/types.ts` 导出 `KeyframeStrokeTextProps`。
- Export alias: `packages/tuffex/packages/components/src/keyframe-stroke-text/index.ts` 导出 `KeyframeStrokeText`、`TxKeyframeStrokeText`、`KeyframeStrokeTextProps` 与 `TxKeyframeStrokeTextInstance`。
- Coverage: `packages/tuffex/packages/components/src/keyframe-stroke-text/__tests__/keyframe-stroke-text.test.ts` 覆盖基于测量的渲染与安装注册。

## 离线完整示例源码

- [KeyframeStrokeTextKeyframeStrokeTextDemo](../snapshot/apps/nexus/app/components/content/demos/KeyframeStrokeTextKeyframeStrokeTextDemo.vue.txt)
- [KeyframeStrokeTextChineseDemo](../snapshot/apps/nexus/app/components/content/demos/KeyframeStrokeTextChineseDemo.vue.txt)

## 离线类型与实现参考

- [keyframe-stroke-text/index.ts](../snapshot/packages/tuffex/packages/components/src/keyframe-stroke-text/index.ts.txt)
- [src/TxKeyframeStrokeText.vue](../snapshot/packages/tuffex/packages/components/src/keyframe-stroke-text/src/TxKeyframeStrokeText.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/keyframe-stroke-text/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
