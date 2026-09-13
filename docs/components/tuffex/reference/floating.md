# Floating 浮动层

> 基于指针位置的视差容器，支持注册绝对定位的深度图层。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/floating) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/floating.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/floating.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Floating 浮动层

## 基础用法

官方示例：`FloatingFloatingDemo`（完整源码见本页末尾）

```vue
<template>
  <TxFloating class-name="stage" :sensitivity="0.55" :easing-factor="0.08">
    <TxFloatingElement class-name="status-rail" :depth="-0.06" />
    <TxFloatingElement class-name="status-panel" :depth="0.04">
      鼠标移动时，状态层会按 depth 缓动
    </TxFloatingElement>
  </TxFloating>
</template>
```

## 组合示例

### 禁用动效

```vue
<template>
  <TxFloating :disabled="prefersReducedMotion">
    <TxFloatingElement class-name="hero-card" :depth="0.08">
      内容
    </TxFloatingElement>
  </TxFloating>
</template>
```

当 `disabled` 变为 true 时，事件监听和动画帧会停止，已注册元素的 transform 会重置为零。

### 反向运动图层

```vue
<template>
  <TxFloating class-name="scene" :sensitivity="1.2">
    <TxFloatingElement class-name="background" :depth="-0.04" />
    <TxFloatingElement class-name="foreground" :depth="0.1" />
  </TxFloating>
</template>
```

负数 `depth` 会朝正数 `depth` 的反方向移动。

## 交互契约

- `TxFloating` 提供注册上下文，供子级 `TxFloatingElement` 消费。
- 容器渲染相对定位 `div`，类名包含 `tx-floating` 和可选 `className`。
- `TxFloatingElement` 渲染绝对定位 `div`，类名包含 `tx-floating-element` 和可选 `className`。
- `TxFloating` 挂载时会启动 passive `mousemove` 与 `touchmove` window 监听，除非已禁用。
- 指针坐标以 floating 容器中心为原点。
- 每帧会让已注册元素按 `easingFactor` 靠近 `pointerPosition * (depth * sensitivity / 20)`。
- `disabled=true` 会停止监听、取消当前 RAF，并把 transform 重置为 `translate3d(0px, 0px, 0)`。
- `disabled=false` 会重新启动监听与 RAF。
- `TxFloatingElement` 挂载时注册，`depth` 变化时重新注册，卸载时注销。
- 元素在 `TxFloating` 外部使用时仍会渲染，但不会动画。
- 用户开启 `prefers-reduced-motion: reduce` 时组件停止全部视差运动。
- `IntersectionObserver` 在容器移出视口时暂停 RAF 循环，重新进入时恢复。
- 容器在 capture 阶段监听 window `scroll` 与 `resize`，以在页面滚动/缩放后重新测量原点。
- 实现通过 `hasWindow()` 保护浏览器 API，避免 SSR 问题。

## API

### TxFloating Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `className` | `string` | `''` | 追加到容器上的类名。 |
| `sensitivity` | `number` | `1` | 整体位移倍率。 |
| `easingFactor` | `number` | `0.05` | 每帧靠近目标位置的比例。 |
| `disabled` | `boolean` | `false` | 停止动效并重置已注册元素 transform。 |

### TxFloatingElement Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `className` | `string` | `''` | 追加到绝对定位图层上的类名。 |
| `depth` | `number` | `1` | 位移深度。负数会朝指针反方向移动。 |

### Slots

| 组件 | 插槽名 | 说明 |
|------|------|------|
| `TxFloating` | `default` | 浮动元素和场景内容。 |
| `TxFloatingElement` | `default` | 图层内容。 |

### Events

不发出公开事件。

### Exposed Methods

不暴露公开实例方法。

## 最佳实践

- 用于装饰性视差、引导卡片或背景点缀。不要让关键布局依赖指针移动。
- 尊重 reduced-motion 设置，并把它绑定到 `disabled`。
- 图层数量保持少量；每个已注册图层都会在每帧更新。
- 使用较低 `depth` 保持动效克制。数值过大很快会让界面显得脱节。
- 通过 CSS 类提供真实静态布局位置；组件只添加 transform 偏移。
- 避免在快速移动图层中放交互控件，除非动效非常轻微。

## 审阅说明

- 已人工核对 `packages/tuffex/packages/components/src/floating/src/types.ts`、`context.ts`、`TxFloating.vue`、`TxFloatingElement.vue` 与 `floating.test.ts`。
- 浏览器监听和动画帧都经过 SSR 防护；位移动效只会在客户端挂载后存在。
- `disabled` 不只是视觉状态：它会停止监听、取消 RAF，并重置已注册元素 transform。

## Source

- Component sources: `packages/tuffex/packages/components/src/floating/src/TxFloating.vue`、`TxFloatingElement.vue` 与 `context.ts`。
- Types: `packages/tuffex/packages/components/src/floating/src/types.ts`。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/floating/__tests__/floating.test.ts` 验证缓动指针位移、disabled 监听重置、初始 disabled、depth 重新注册、卸载清理、类名 / 插槽渲染和插件安装注册。

## 离线完整示例源码

- [FloatingFloatingDemo](../snapshot/apps/nexus/app/components/content/demos/FloatingFloatingDemo.vue.txt)

## 离线类型与实现参考

- [floating/index.ts](../snapshot/packages/tuffex/packages/components/src/floating/index.ts.txt)
- [src/TxFloating.vue](../snapshot/packages/tuffex/packages/components/src/floating/src/TxFloating.vue.txt)
- [src/TxFloatingElement.vue](../snapshot/packages/tuffex/packages/components/src/floating/src/TxFloatingElement.vue.txt)
- [src/context.ts](../snapshot/packages/tuffex/packages/components/src/floating/src/context.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/floating/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
