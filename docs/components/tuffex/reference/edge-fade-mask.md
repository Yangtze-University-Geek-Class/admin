# EdgeFadeMask 边缘渐隐遮罩

> 滚动容器包装器，仅在存在隐藏溢出内容时为前后边缘添加 CSS mask 渐隐。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/edge-fade-mask) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/edge-fade-mask.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/edge-fade-mask.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# EdgeFadeMask 边缘渐隐遮罩

## 纵向渐隐

边框和圆角放在外层包装上；组件内部负责滚动视口和遮罩。

官方示例：`EdgeFadeMaskVerticalDemo`（完整源码见本页末尾）

```vue
<template>
  <div style="width: 420px; border: 1px solid var(--tx-border-color); border-radius: 12px;">
    <TxEdgeFadeMask :size="32" style="height: 220px;">
      <div style="padding: 14px 16px; line-height: 1.7;">
        <!-- 长内容 -->
      </div>
    </TxEdgeFadeMask>
  </div>
</template>
```

## 横向渐隐

横向模式下，内部内容宽度需要大于视口宽度。

官方示例：`EdgeFadeMaskHorizontalDemo`（完整源码见本页末尾）

```vue
<template>
  <div style="width: 520px; border: 1px solid var(--tx-border-color); border-radius: 12px;">
    <TxEdgeFadeMask axis="horizontal" :size="40" style="height: 116px;">
      <div style="display: flex; gap: 12px; width: max-content; padding: 12px;">
        <!-- 横向卡片 -->
      </div>
    </TxEdgeFadeMask>
  </div>
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `as` | `string` | `'div'` | 外层组件渲染的根元素标签。 |
| `axis` | `'vertical' \| 'horizontal'` | `'vertical'` | 滚动和渐隐方向。 |
| `size` | `string \| number` | `24` | 每侧渐隐距离；数字转为 px，字符串原样使用。 |
| `threshold` | `number` | `1` | 判断视口是否处于滚动边界的像素阈值；负值会按 `0` 处理。 |
| `disabled` | `boolean` | `false` | 禁用滚动状态遮罩。 |
| `observeResize` | `boolean` | `true` | 浏览器支持时使用 `ResizeObserver` 观察视口和第一个子元素。 |

### Events

不触发事件。

### Slots

| 插槽名 | Props | 说明 |
|------|-------|------|
| `default` | - | 渲染在内部 viewport 中的可滚动内容。 |

## 交互契约

- 根节点渲染为配置的 `as` 标签，内部包含一个 viewport 元素。
- 纵向模式设置 `overflow-y: auto` 并隐藏横向溢出；横向模式设置 `overflow-x: auto` 并隐藏纵向溢出。
- 当组件禁用、内容不可滚动或滚动范围在 `threshold` 内时，不输出 mask。
- 滚动事件会根据 `scrollTop` 或 `scrollLeft` 更新前后渐隐。
- 生成的 mask 在纵向模式使用 `linear-gradient(to bottom, ...)`，横向模式使用 `linear-gradient(to right, ...)`。
- `observeResize=true` 时会观察 viewport 和第一个子元素；prop 变化或组件卸载时会断开 observer。

## 最佳实践

- 边框、圆角、背景等视觉框架样式放在父级包装上，让 mask 只影响滚动内容。
- 横向条带使用 `width: max-content` 或固定项宽；否则不会产生隐藏溢出，也不会显示渐隐。
- `threshold` 保持较小。它用于处理边界取整差异，不应用来隐藏大量内容。
- 打印或导出界面可禁用遮罩，因为 CSS mask 在不同输出环境中可能表现不一致。
- 不要把渐隐当作唯一的“还有内容”提示；发现性重要时，应搭配可见滚动位置、被裁切项或辅助文案。

## 审阅说明

- 已核对 `packages/tuffex/packages/components/src/edge-fade-mask/src/TxEdgeFadeMask.vue`、`types.ts` 与 `edge-fade-mask.test.ts`。
- **实测覆盖:** 配置根标签渲染、方向 class 与插槽内容、不可滚动时不输出 mask、纵向边界 mask stop、横向字符串渐隐尺寸、禁用后移除/恢复 mask，以及 `ResizeObserver` 建立与断开。
- 可访问性说明:组件只添加中性滚动 viewport 和 CSS mask;语义地标/标题应放在插槽内容中,不要把渐隐作为“还有内容”的唯一提示。

## Source

- Component source: `packages/tuffex/packages/components/src/edge-fade-mask/src/TxEdgeFadeMask.vue`。
- Types: `packages/tuffex/packages/components/src/edge-fade-mask/src/types.ts` 导出 `EdgeFadeMaskProps` 与 `EdgeFadeMaskAxis`。
- Coverage: `packages/tuffex/packages/components/src/edge-fade-mask/__tests__/edge-fade-mask.test.ts` 覆盖根标签、方向类、插槽渲染、mask 状态更新、禁用行为、字符串尺寸与 resize observer 清理。

## 离线完整示例源码

- [EdgeFadeMaskVerticalDemo](../snapshot/apps/nexus/app/components/content/demos/EdgeFadeMaskVerticalDemo.vue.txt)
- [EdgeFadeMaskHorizontalDemo](../snapshot/apps/nexus/app/components/content/demos/EdgeFadeMaskHorizontalDemo.vue.txt)

## 离线类型与实现参考

- [edge-fade-mask/index.ts](../snapshot/packages/tuffex/packages/components/src/edge-fade-mask/index.ts.txt)
- [src/TxEdgeFadeMask.vue](../snapshot/packages/tuffex/packages/components/src/edge-fade-mask/src/TxEdgeFadeMask.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/edge-fade-mask/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
