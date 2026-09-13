# CornerOverlay 角标覆盖层

> 用于头像、缩略图和状态标记的角落绝对定位覆盖层。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/corner-overlay) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/corner-overlay.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/corner-overlay.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# CornerOverlay 角标覆盖层

## 基础用法

官方示例：`CornerOverlayBasicDemo`（完整源码见本页末尾）

```vue
<template>
  <TxCornerOverlay placement="bottom-right" :offset-x="-2" :offset-y="-2">
    <span class="avatar">TD</span>
    <template #overlay>
      <span class="status-dot" />
    </template>
  </TxCornerOverlay>
</template>
```

## 组合示例

### 可点击覆盖层

覆盖层默认是 `pointer-events: none`。只有覆盖层本身需要接收指针输入时，才设置 `overlayPointerEvents="auto"`。

```vue
<template>
  <TxCornerOverlay overlay-pointer-events="auto" :offset-x="-4" :offset-y="-4">
    <TxAvatar :src="avatarUrl" />
    <template #overlay>
      <button type="button" aria-label="打开资料操作">•••</button>
    </template>
  </TxCornerOverlay>
</template>
```

### CSS 偏移值

```vue
<template>
  <TxCornerOverlay offset-x="calc(100% - 12px)" offset-y="-0.25rem">
    <span>基础内容</span>
    <template #overlay>
      <TxBadge value="New" />
    </template>
  </TxCornerOverlay>
</template>
```

字符串偏移值会原样保留。数字偏移值会转换为像素。

## 交互契约

- 根节点渲染为 `position: relative` 的行内块 `span`。
- 只有存在 `overlay` 插槽时才渲染覆盖层。
- 覆盖层使用绝对定位；作为装饰时（`overlayPointerEvents="none"`，默认）标记 `aria-hidden="true"`，设为 `overlayPointerEvents="auto"` 则会暴露，使内部可聚焦控件仍可达。
- `placement` 决定写入 top/left、top/right、bottom/left 或 bottom/right 这一组 x/y inset。
- `offsetX` 控制 `left` 或 `right`；`offsetY` 控制 `top` 或 `bottom`。
- 数字偏移会转为 px，字符串偏移会原样传入样式。
- `overlayPointerEvents` 直接映射为覆盖层的 CSS `pointer-events`。
- 组件本身不添加 click、focus 或键盘行为。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `placement` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` | `'bottom-right'` | 覆盖层所在角落。 |
| `offsetX` | `string \| number` | `0` | 水平偏移；数字会转为 px。 |
| `offsetY` | `string \| number` | `0` | 垂直偏移；数字会转为 px。 |
| `overlayPointerEvents` | `'none' \| 'auto'` | `'none'` | 覆盖层的 CSS `pointer-events` 值。 |

### Slots

| 插槽名 | Props | 说明 |
|------|-------|------|
| `default` | 无 | 基础行内内容。 |
| `overlay` | 无 | 角落覆盖层内容。未提供时不会渲染覆盖层节点。 |

### Events

不发出公开事件。

### Exposed Methods

不暴露公开实例方法。

## 最佳实践

- 默认把覆盖层当作装饰内容；由于它是 `aria-hidden`，重要状态还应在附近文本或标签中表达。
- 需要角标部分超出头像或缩略图时使用负偏移。
- 只有明确需要交互覆盖层时才设置 `overlayPointerEvents="auto"`，并在插槽内提供语义化控件。
- 避免放入大块覆盖内容。该组件适合小标记，不适合弹层或菜单。
- 保持基础内容尺寸稳定；覆盖层绝对定位，不会预留布局空间。

## 审阅说明

- 已人工核对 `packages/tuffex/packages/components/src/corner-overlay/src/types.ts`、`TxCornerOverlay.vue` 与 `corner-overlay.test.ts`。
- `overlay` 插槽按需渲染，仅在装饰态（`overlayPointerEvents="none"`）下 `aria-hidden`；设为 `overlayPointerEvents="auto"` 会暴露，使内部交互控件可达。业务关键状态仍需要附近文本或外部有标签控件表达。
- `overlayPointerEvents="auto"` 只转发 CSS 指针行为；插槽内控件自行负责键盘、焦点和标签语义。

## Source

- Component source: `packages/tuffex/packages/components/src/corner-overlay/src/TxCornerOverlay.vue`。
- Types: `packages/tuffex/packages/components/src/corner-overlay/src/types.ts`。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/corner-overlay/__tests__/corner-overlay.test.ts` 验证无覆盖层渲染、`aria-hidden` 覆盖层输出、默认位置、位置到 inset 样式映射、字符串偏移和 pointer-events 转发。

## 离线完整示例源码

- [CornerOverlayBasicDemo](../snapshot/apps/nexus/app/components/content/demos/CornerOverlayBasicDemo.vue.txt)

## 离线类型与实现参考

- [corner-overlay/index.ts](../snapshot/packages/tuffex/packages/components/src/corner-overlay/index.ts.txt)
- [src/TxCornerOverlay.vue](../snapshot/packages/tuffex/packages/components/src/corner-overlay/src/TxCornerOverlay.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/corner-overlay/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
