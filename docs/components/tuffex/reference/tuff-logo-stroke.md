# TuffLogoStroke Logo 描边

> Tuff Logo 的 SVG 描边动画组件，支持 once、breathe、hover 和 loop 模式。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/tuff-logo-stroke) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/tuff-logo-stroke.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/tuff-logo-stroke.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# TuffLogoStroke Logo 描边

## 动画模式

`once` 在挂载时播放一次描边入场；`breathe` 和 `loop` 会在入场后保持轻微呼吸；`hover` 等用户悬停时才触发动画。

官方示例：`TuffLogoStrokeModesDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTuffLogoStroke :size="84" mode="once" />
  <TxTuffLogoStroke :size="84" mode="breathe" />
  <TxTuffLogoStroke :size="84" mode="hover" />
</template>
```

## 颜色与时长

当 Logo 位于特定主题表面时，可以定制描边、核心渐变、外圈光晕和动画时长。

官方示例：`TuffLogoStrokePaletteDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTuffLogoStroke
    :size="128"
    mode="breathe"
    :duration-ms="2800"
    stroke-color="#3b82f6"
    fill-start-color="#0ea5e9"
    fill-end-color="#8b5cf6"
    outer-start-color="#fb7185"
    outer-end-color="#7e22ce"
  />
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `size` | `string \| number` | `120` | SVG 宽高。数字会转换为 px。 |
| `mode` | `'once' \| 'breathe' \| 'hover' \| 'loop'` | `'once'` | 动画触发模式。`loop` 会规范化为 `breathe`。 |
| `durationMs` | `number` | `2200` | 基础动画时长，单位毫秒。 |
| `strokeColor` | `string` | `'#4C4CFF'` | 外框描边颜色。 |
| `fillStartColor` | `string` | `'#199FFE'` | 核心填充渐变起始色。 |
| `fillEndColor` | `string` | `'#810DC6'` | 核心填充渐变结束色。 |
| `outerStartColor` | `string` | `'#D73E4D'` | 外圈径向渐变起始色。 |
| `outerEndColor` | `string` | `'#7F007F'` | 外圈径向渐变结束色。 |

### Slots

无插槽。

### Events

无组件事件。

## 交互契约

- 组件渲染一个 SVG，带 `role="img"` 和默认可访问名称 `Tuff logo stroke animation`。
- `mode="loop"` 是 `mode="breathe"` 的别名；两者都会输出 breathe 状态 class。
- 渐变和滤镜 id 通过 `useId()` 生成组件实例级前缀，同屏多个 Logo 不会发生 SVG id 冲突。
- `durationMs` 会写入 `--tx-tuff-logo-duration`；breathe 模式会基于该值派生呼吸动画时长。
- 组件包含 `prefers-reduced-motion: reduce` CSS，减少动态偏好下会停止动画并展示最终描边状态。

## 最佳实践

- 闪屏、加载完成或首屏品牌露出使用 `once`。
- Logo 靠近交互入口、但不应持续吸引注意力时使用 `hover`。
- 谨慎使用 `breathe` / `loop`；重复品牌动效容易和主要 UI 反馈抢注意力。
- 自定义颜色保持贴近当前表面配色。高饱和渐变更适合安静背景。
- 不要再把 SVG 包进额外动效，除非已经验证组合后的 reduced-motion 表现。

## 审阅说明 / Review Notes

- **动效说明:** `breathe` 与 `loop` 归一化后视觉一致。只有兼容旧调用时使用 `loop`；新增示例优先写 `breathe`，因为它对应真实 class 状态。
- **SVG 说明:** 渐变和滤镜 id 通过 `useId()` 按实例生成。同屏重复 Logo 不会冲突，但快照测试应断言存在性/唯一性，不要断言具体 id 字符串。
- **实测覆盖:** `tuff-logo-stroke.test.ts` 覆盖 SVG 可访问语义、数字/字符串尺寸、CSS 时长变量、`loop` 到 `breathe` 映射、调色板透传、实例级 SVG id 与 install 注册。

## Source

- Component source: `packages/tuffex/packages/components/src/tuff-logo-stroke/src/TxTuffLogoStroke.vue`。
- Types: `packages/tuffex/packages/components/src/tuff-logo-stroke/src/types.ts` 导出 `TuffLogoStrokeProps`。
- Export alias: `packages/tuffex/packages/components/src/tuff-logo-stroke/index.ts` 导出 `TuffLogoStroke`、`TxTuffLogoStroke`、`TuffLogoStrokeProps` 与 `TxTuffLogoStrokeInstance`。
- Coverage: `packages/tuffex/packages/components/src/tuff-logo-stroke/__tests__/tuff-logo-stroke.test.ts` 覆盖模式、尺寸、调色板 props、SVG id、可访问性与 install 行为。

## 离线完整示例源码

- [TuffLogoStrokeModesDemo](../snapshot/apps/nexus/app/components/content/demos/TuffLogoStrokeModesDemo.vue.txt)
- [TuffLogoStrokePaletteDemo](../snapshot/apps/nexus/app/components/content/demos/TuffLogoStrokePaletteDemo.vue.txt)

## 离线类型与实现参考

- [tuff-logo-stroke/index.ts](../snapshot/packages/tuffex/packages/components/src/tuff-logo-stroke/index.ts.txt)
- [src/TxTuffLogoStroke.vue](../snapshot/packages/tuffex/packages/components/src/tuff-logo-stroke/src/TxTuffLogoStroke.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/tuff-logo-stroke/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
