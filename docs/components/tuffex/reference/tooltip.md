# Tooltip 提示

> 轻量提示与信息层级

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/tooltip) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/tooltip.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/tooltip.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Tooltip 提示

## Demo
### Hover Hint

短文本提示，保持低侵入感。

官方示例：`TooltipHoverDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTooltip content="提示信息">
    <TxButton variant="ghost">Hover me</TxButton>
  </TxTooltip>
  <TxTooltip content="信息">
    <TxButton variant="ghost">Info</TxButton>
  </TxTooltip>
</template>
```

## 基础用法
```vue
<template>
  <TxTooltip content="复制成功">
    <TxButton variant="ghost">Copy</TxButton>
  </TxTooltip>
</template>
```

## Anchor 透传
```vue
<template>
  <TxTooltip
    content="底部提示"
    :anchor="{ placement: 'bottom', showArrow: true, panelBackground: 'mask' }"
  >
    <TxButton variant="ghost">Bottom</TxButton>
  </TxTooltip>
</template>
```

## Click 切换（点击外部关闭）
官方示例：`TooltipClickOutsideCloseDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTooltip
    v-model="open"
    trigger="click"
    content="点击切换，点击外部关闭"
    :anchor="{ showArrow: true }"
  >
    <TxButton variant="ghost">点击我</TxButton>
  </TxTooltip>
</template>
```

## Click 切换（点击外部不关闭）
官方示例：`TooltipClickOutsideKeepDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTooltip
    v-model="open"
    trigger="click"
    :close-on-click-outside="false"
    content="点击切换，点击外部不关闭"
    :anchor="{ showArrow: true }"
  >
    <TxButton variant="ghost">固定提示</TxButton>
  </TxTooltip>
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `modelValue` | `boolean` | `undefined` | 可选的受控打开状态，用于 `v-model`；未设置时使用内部状态。 |
| `content` | `string` | `''` | 未提供 `content` 插槽时使用的备用提示文本。 |
| `disabled` | `boolean` | `false` | 阻止打开，并在变为禁用时关闭 tooltip。 |
| `trigger` | `'hover' \| 'click' \| 'focus'` | `'hover'` | reference 包装层的触发方式。 |
| `openDelay` | `number` | 见 `layer` 预设（`hint` 为 `200`） | hover / focus 模式下的打开延迟，最小按 `0` 处理。不传时由共享延迟服务按 `layer` 取值。 |
| `closeDelay` | `number` | 见 `layer` 预设（`hint` 为 `120`） | hover / focus 模式下的关闭延迟，最小按 `0` 处理。不传时由共享延迟服务按 `layer` 取值。 |
| `maxHeight` | `number` | `320` | 面板最大高度，单位 px；`<= 0` 时不限制高度。`content` 插槽在默认 `320` 时不限制高度。 |
| `referenceFullWidth` | `boolean` | `false` | 让 reference 包装层占满 `width: 100%`。 |
| `interactive` | `boolean` | `false` | hover 模式下，鼠标进入浮层时保持 tooltip 打开。 |
| `keepAliveContent` | `boolean` | `false` | 透传给 `TxBaseAnchor`，关闭后仍保留浮层内容挂载。 |
| `closeOnClickOutside` | `boolean` | `trigger === 'click'` | 覆盖点击外部关闭行为；其次使用 anchor 配置，click 模式默认 `true`。 |
| `toggleOnReferenceClick` | `boolean` | `trigger === 'click'` | 覆盖点击 reference 切换行为；其次使用 anchor 配置，click 模式默认 `true`。 |
| `anchor` | `Partial<TooltipAnchorProps>` | `{}` | 透传给 `TxBaseAnchor` 的配置；`modelValue` / `disabled` 由 Tooltip 自身管理（请用 `v-model` / `disabled` prop 设置），不能通过 `anchor` 传入；tooltip 会先提供定位、箭头、面板和动画默认值。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `update:modelValue` | `(value: boolean) => void` | resolved 打开状态变化时触发。 |
| `open` | `() => void` | tooltip 从关闭变为打开后触发。 |
| `close` | `() => void` | tooltip 从打开变为关闭后触发。 |

### Slots

| 插槽名 | Props | 说明 |
|------|-------|------|
| `default` | - | 被 tooltip trigger span 包装的 reference 内容。 |
| `content` | `{ side: string }` | 自定义 tooltip 内容；接收 `TxBaseAnchor` 解析出的浮层方向。 |

## 交互契约

- hover / focus 触发使用 `openDelay` / `closeDelay`；click 触发把切换与点击外部关闭交给 `TxBaseAnchor`。
- `disabled=true` 会清理等待中的 timer，并强制 resolved 打开状态为 `false`。
- `interactive=true` 只影响 hover 模式；鼠标进入浮层会清理关闭 timer，离开后重新安排关闭。
- Tooltip 在浮层内容上设置 `role="tooltip"`，并暴露 `data-side` 方便按方向写样式。
- 默认 anchor 动画为 `{ type: 'boom' }`（对称的聚焦缩放开合）；通过 `anchor.animation` 覆盖后完全以覆盖值为准。

## 最佳实践

- 文案尽量短，避免多行提示。
- 与触发元素的间距保持轻盈。
- 复杂外观和动效通过 `anchor` 配置，不在 Tooltip 层重复抽象。
- Tooltip 不承载表单、长说明或批量操作；复杂内容升级为 `TxPopover` / `TxDrawer`。

## 组合示例
### 提示按钮

图标按钮搭配提示信息。

官方示例：`TooltipButtonDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTooltip content="分享">
    <TxButton icon="i-ri-share-line" circle />
  </TxTooltip>
</template>
```

### Anchor 配置预设

展示通过 `anchor` 透传不同面板样式和定位。

官方示例：`TooltipIndicatorDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTooltip
    content="遮罩背景 + 箭头"
    :anchor="{ showArrow: true, panelBackground: 'mask' }"
  >
    <TxButton variant="ghost">状态详情</TxButton>
  </TxTooltip>

  <TxTooltip
    content="玻璃背景 + 右侧定位"
    :anchor="{ placement: 'right', showArrow: true, panelBackground: 'glass', panelShadow: 'medium' }"
  >
    <TxButton variant="ghost">服务状态</TxButton>
  </TxTooltip>
</template>
```

## 后台反馈中心

Tooltip 在后台任务面板中只解释一个动作或指标，不打断当前流程。若提示需要持续展示任务结果，请使用 `TxToastHost`；若需要阻断刷新中的面板，请使用 `TxLoadingOverlay`。

官方示例：`ComponentsFeedbackTaskCenterDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTooltip
    content="Tooltip 只解释当前动作。"
    :anchor="{ placement: 'bottom', showArrow: true, panelBackground: 'glass' }"
  >
    <TxButton variant="secondary">发送提示</TxButton>
  </TxTooltip>
</template>
```

## 审阅说明 / Review Notes

- **打开状态契约:** 当 `modelValue` 是 boolean 时 `TxTooltip` 受控，否则使用内部 `internalOpen`。打开/关闭会派发 `update:modelValue` 加 `open` 或 `close`；`disabled` 会阻止打开。
- **Anchor 契约:** click trigger 默认把 `closeOnClickOutside` 和 `toggleOnReferenceClick` 设为 `true`；其它 trigger 除非 props 或 `anchor` 覆盖，否则不启用这两个行为。
- **实测覆盖:** `tooltip.test.ts` 覆盖 keep-alive 默认值、boom 默认与 animation 透传、content slot 的 `side` 上下文，以及点击外部关闭覆盖行为。

## Source

- Component source: `packages/tuffex/packages/components/src/tooltip/src/TxTooltip.vue`。
- Types: `packages/tuffex/packages/components/src/tooltip/src/types.ts`。
- Coverage: `packages/tuffex/packages/components/src/tooltip/__tests__/tooltip.test.ts` 校验 keep-alive 默认值、anchor 动画透传、插槽 side 上下文与点击外部关闭行为。

## 离线完整示例源码

- [TooltipHoverDemo](../snapshot/apps/nexus/app/components/content/demos/TooltipHoverDemo.vue.txt)
- [TooltipClickOutsideCloseDemo](../snapshot/apps/nexus/app/components/content/demos/TooltipClickOutsideCloseDemo.vue.txt)
- [TooltipClickOutsideKeepDemo](../snapshot/apps/nexus/app/components/content/demos/TooltipClickOutsideKeepDemo.vue.txt)
- [TooltipButtonDemo](../snapshot/apps/nexus/app/components/content/demos/TooltipButtonDemo.vue.txt)
- [TooltipIndicatorDemo](../snapshot/apps/nexus/app/components/content/demos/TooltipIndicatorDemo.vue.txt)
- [ComponentsFeedbackTaskCenterDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsFeedbackTaskCenterDemo.vue.txt)

## 离线类型与实现参考

- [tooltip/index.ts](../snapshot/packages/tuffex/packages/components/src/tooltip/index.ts.txt)
- [src/TxTooltip.vue](../snapshot/packages/tuffex/packages/components/src/tooltip/src/TxTooltip.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/tooltip/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
