# TypingIndicator 打字中

> 用于聊天界面的内联打字中与加载状态。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/typing-indicator) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/typing-indicator.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/typing-indicator.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# TypingIndicator 打字中

### TypingIndicator

官方示例：`TypingIndicatorTypingIndicatorDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTypingIndicator />
</template>
```

## 变体

### TypingIndicator variants
官方示例：`TypingIndicatorTypingIndicatorVariantsDemo`（完整源码见本页末尾）

```vue
<template>
  <div style="display: flex; flex-direction: column; gap: 10px;">
    <div style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--tx-border-color-light); border-radius: 12px;">
      <code style="width: 90px; color: var(--tx-text-color-secondary);">dots</code>
      <TxTypingIndicator text="Typing…" />
      <TxTypingIndicator :show-text="false" />
    </div>

    <div style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--tx-border-color-light); border-radius: 12px;">
      <code style="width: 90px; color: var(--tx-text-color-secondary);">ai</code>
      <TxTypingIndicator variant="ai" text="Generating…" />
      <TxTypingIndicator variant="ai" :loader-size="32" text="32px" />
      <TxTypingIndicator variant="ai" :loader-size="24" :show-text="false" />
    </div>

    <div style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--tx-border-color-light); border-radius: 12px;">
      <code style="width: 90px; color: var(--tx-text-color-secondary);">pure</code>
      <TxTypingIndicator variant="pure" text="Loading" />
      <TxTypingIndicator variant="pure" :pure-size="12" text="12px" />
      <div style="display: inline-flex; gap: 6px; align-items: center; color: var(--tx-text-color-secondary);">
        <span style="width: 16px; height: 16px; border-radius: 4px; background: var(--tx-fill-color); display: inline-block;" />
        <TxTypingIndicator variant="pure" :pure-size="12" :show-text="false" />
        <span style="font-size: 12px;">Icon</span>
      </div>
    </div>

    <div style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--tx-border-color-light); border-radius: 12px;">
      <code style="width: 90px; color: var(--tx-text-color-secondary);">ring</code>
      <TxTypingIndicator variant="ring" :show-text="false" />
      <TxTypingIndicator variant="ring" :ring-size="14" :show-text="false" />
      <TxTypingIndicator variant="ring" :ring-size="22" :ring-thickness="3" :show-text="false" />
    </div>

    <div style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--tx-border-color-light); border-radius: 12px;">
      <code style="width: 90px; color: var(--tx-text-color-secondary);">circle-dash</code>
      <TxTypingIndicator variant="circle-dash" :show-text="false" />
      <TxTypingIndicator variant="circle-dash" :circle-dash-size="14" :show-text="false" />
      <TxTypingIndicator variant="circle-dash" :circle-dash-size="22" :circle-dash-thickness="3" :circle-dash-dash-deg="10" :circle-dash-gap-deg="10" :show-text="false" />
    </div>

    <div style="display: flex; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--tx-border-color-light); border-radius: 12px;">
      <code style="width: 90px; color: var(--tx-text-color-secondary);">bars</code>
      <TxTypingIndicator variant="bars" :show-text="false" />
      <TxTypingIndicator variant="bars" :bars-size="16" :show-text="false" />
    </div>
  </div>
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `variant` | `'dots' \| 'ai' \| 'pure' \| 'ring' \| 'circle-dash' \| 'bars'` | `'dots'` | 指示器视觉样式；`dots` 通用，`ai` 用于模型思考态，`bars`/`ring` 用于强调持续处理。 |
| `text` | `string` | `'Typing…'` | `showText` 开启时显示的状态文案，按场景改写（如「正在生成…」）。 |
| `showText` | `boolean` | `true` | 是否显示文案 |
| `size` | `number` | `6` | `dots` 变体的圆点直径（px）；随宿主字号放大时同步调大。 |
| `gap` | `number` | `5` | dots 模式间距(px) |
| `loaderSize` | `number` | `44` | ai 模式尺寸(px) |
| `pureSize` | `number` | `14` | pure 模式尺寸(px) |
| `ringSize` | `number` | `18` | ring 模式尺寸(px) |
| `ringThickness` | `number` | `2` | ring 模式线宽(px) |
| `circleDashSize` | `number` | `18` | circle-dash 模式尺寸(px) |
| `circleDashThickness` | `number` | `2` | circle-dash 模式线宽(px) |
| `circleDashDashDeg` | `number` | `12` | circle-dash 模式 dash 角度(deg) |
| `circleDashGapDeg` | `number` | `12` | circle-dash 模式 gap 角度(deg) |
| `barsSize` | `number` | `12` | bars 模式高度(px) |

### CSS Variables

| 变量 | 来源 | 说明 |
|------|------|------|
| `--tx-typing-indicator-color` | `--tx-text-color-secondary` | 指示器整体颜色。所有变体（含 dots）都从它派生，宿主使用自有 token 体系时用它一处改色。 |

## Events

`TxTypingIndicator` 不派发组件事件。它是被动的 `role="status"` 状态指示器。

## Slots

`TxTypingIndicator` 不暴露插槽。可访问状态文案使用 `text`；只有相邻 UI 已经说明等待状态时才使用 `showText=false`。

## 最佳实践

- 内联聊天行和紧凑 assistant 占位优先使用默认 `dots` 变体。
- 需要品牌化生成状态且空间充足时使用 `ai`。
- 工具栏、消息元信息行或骨架屏旁的加载状态可使用 `pure`、`ring`、`circle-dash` 或 `bars`。
- 除非其它可见标签已经描述等待操作，否则保持 `showText=true`。
- 数字尺寸 prop 都按 px 调整；同一聊天 transcript 中避免混用过多变体。

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/chat/src/TxTypingIndicator.vue` 确认 `role="status"`、`aria-live="polite"`、装饰性 loader 的 `aria-hidden`、变体 CSS 变量、AI mask 作用域 id 和可选文本渲染。
- 类型契约:`packages/tuffex/packages/components/src/chat/src/types.ts` 定义 `TypingIndicatorProps` 和所有变体尺寸 prop。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/chat/__tests__/typing-indicator.test.ts` 覆盖状态语义、dot 尺寸、隐藏文本、AI mask 尺寸、spinner 变体和 bars 渲染。
- 导出入口:`packages/tuffex/packages/components/src/chat/index.ts` 导出 `TypingIndicator`、`TxTypingIndicator` 和 `TypingIndicatorProps`。

## Source

<TuffDocSourceLink path="packages/tuffex/packages/components/src/chat/index.ts" />

## 离线完整示例源码

- [TypingIndicatorTypingIndicatorDemo](../snapshot/apps/nexus/app/components/content/demos/TypingIndicatorTypingIndicatorDemo.vue.txt)
- [TypingIndicatorTypingIndicatorVariantsDemo](../snapshot/apps/nexus/app/components/content/demos/TypingIndicatorTypingIndicatorVariantsDemo.vue.txt)

## 离线类型与实现参考

本页是跨组件/概念说明；先按具体组件查询 catalog.json，再按 SOURCE 清单核对；不要从名称猜导出。

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
