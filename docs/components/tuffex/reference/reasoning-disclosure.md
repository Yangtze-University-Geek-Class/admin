# Reasoning Disclosure

> 可折叠的推理过程区域，流式输出时自动跟随文本尾部。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/reasoning-disclosure) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/reasoning-disclosure.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/reasoning-disclosure.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Reasoning Disclosure

## 基础用法

### Reasoning Disclosure
官方示例：`ReasoningDisclosureReasoningDisclosureDemo`（完整源码见本页末尾）

```vue
<template>
  <TxReasoningDisclosure streaming text="正在拆解这个问题…" />

  <TxReasoningDisclosure
    :duration-ms="4200"
    default-open
    text="先确认输入边界，再挑选算法。"
  />
</template>
```

## 交互契约

- 展开状态由组件自己持有，初值取 `defaultOpen`。这是非受控组件：后续修改 `defaultOpen` 不会再改变展开状态。
- 点击头部切换展开并派发 `toggle`，参数是切换**之后**的状态。
- 头部文案随 `streaming` 切换：为真时用 `thinkingLabel`，否则用 `label`。
- 耗时只在「非流式且 `durationMs` 有值」时显示，因此流式过程中不会出现半截的时间。默认格式为 `Thought for X.Xs`，可用 `durationFormatter` 接管。
- `streaming` 为真时，`text` 每次变化都会把文本区滚到底部，让新内容始终可见；非流式时不干预用户的滚动位置。
- 头部是原生 `<button>`，带 `aria-expanded` 与指向内容区的 `aria-controls`；两个图标均为 `aria-hidden`。
- 折叠时内容区仍在 DOM 中，只是被收起——长推理文本不会因为折叠而停止占用内存。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `text` | `string` | `''` | 推理正文，按原样渲染（保留换行）。 |
| `streaming` | `boolean` | `false` | 是否仍在输出；决定头部文案、图标与自动滚动。 |
| `durationMs` | `number` | — | 思考耗时（毫秒）；仅在非流式时显示。 |
| `defaultOpen` | `boolean` | `false` | 初始是否展开。仅在挂载时读取一次。 |
| `label` | `string` | `'Reasoning'` | 结束后的头部文案。 |
| `thinkingLabel` | `string` | `'Thinking…'` | 流式过程中的头部文案。 |
| `durationFormatter` | `(ms: number) => string` | — | 自定义耗时文案；未设时回退到 `Thought for X.Xs`。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `toggle` | `(open: boolean)` | 用户点击头部时派发，携带切换后的展开状态。 |

## Slots

`TxReasoningDisclosure` 不暴露插槽。正文只接受纯文本 `text`；需要 Markdown 或富文本时，请改用 `TxStreamMarkdown` 自行组合。

## 最佳实践

- 默认保持折叠。推理过程是可选的解释信息，展开会把真正的回答挤出首屏。
- 流式结束时同时传入 `durationMs` 并把 `streaming` 置为 `false`，否则耗时永远不会出现。
- 需要跨会话记住展开状态时，请在外层自行持有并按 `key` 重建组件——改 `defaultOpen` 是无效的。
- 本地化时同时覆盖 `label`、`thinkingLabel` 与 `durationFormatter`，三者混用语言会很明显。

## 离线完整示例源码

- [ReasoningDisclosureReasoningDisclosureDemo](../snapshot/apps/nexus/app/components/content/demos/ReasoningDisclosureReasoningDisclosureDemo.vue.txt)

## 离线类型与实现参考

- [reasoning-disclosure/index.ts](../snapshot/packages/tuffex/packages/components/src/reasoning-disclosure/index.ts.txt)
- [src/TxReasoningDisclosure.vue](../snapshot/packages/tuffex/packages/components/src/reasoning-disclosure/src/TxReasoningDisclosure.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
