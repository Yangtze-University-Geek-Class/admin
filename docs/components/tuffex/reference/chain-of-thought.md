# Chain of Thought

> 多步推理与工具调用的时间线，进行中的步骤自动跟随输出。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/chain-of-thought) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/chain-of-thought.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/chain-of-thought.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Chain of Thought

## 基础用法

### Chain of Thought
官方示例：`ChainOfThoughtChainOfThoughtDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const steps = [
  { id: '1', kind: 'thinking', title: '拆解需求', body: '先确认输入边界。', status: 'done' },
  { id: '2', kind: 'tool', title: 'read_file(src/main.ts)', status: 'done' },
  { id: '3', kind: 'thinking', title: '正在推导实现', body: '排序是瓶颈…', status: 'active' },
]
</script>

<template>
  <TxChainOfThought :steps="steps" streaming />
</template>
```

## 交互契约

- 展开态由组件自己持有，初值取 `defaultOpen`（**默认 `true`**，与 `TxReasoningDisclosure` 相反）。同为非受控：之后改 `defaultOpen` 不生效。
- 点击头部切换并派发 `toggle`，参数是切换**之后**的状态。
- 头部图标只在 `streaming` 为真**且**存在 `status === 'active'` 的步骤时换成思考球；只设 `streaming` 而没有活跃步骤不会有动效。
- 头部计数直接取 `steps.length`，不区分状态。
- 每步按 `status` 呈现三种形态：`active`（旋转指示）、`done`、`error`。`kind` 区分 `thinking` 与 `tool`，用于图标与排版。
- 任一步骤的 `body` 长度变化都会把活跃步骤的正文滚到底部——这是按正文长度串联监听的，所以流式追加文本时会持续跟随。
- `body` 可选；未提供的步骤只显示标题，适合表达纯工具调用。
- 头部是原生 `<button>`，带 `aria-expanded` 与 `aria-controls`；步骤列表是 `<ol>`，序号来自渲染顺序。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `steps` | `AiChainStep[]` | — | 步骤列表；`AiChainStep` 为 `{ id, kind: 'thinking' \| 'tool', title, body?, status: 'active' \| 'done' \| 'error' }`。必填。 |
| `streaming` | `boolean` | `false` | 是否仍在输出；需与活跃步骤同时成立才会显示思考球。 |
| `defaultOpen` | `boolean` | `true` | 初始是否展开。仅在挂载时读取一次。 |
| `label` | `string` | `'Chain of thought'` | 头部文案。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `toggle` | `(open: boolean)` | 用户点击头部时派发，携带切换后的展开状态。 |

## Slots

`TxChainOfThought` 不暴露插槽。步骤的呈现由 `kind` 与 `status` 决定；需要自定义渲染时请自行组合 `TxReasoningDisclosure` 与 `TxToolCallCard`。

## 最佳实践

- `id` 用稳定标识而非数组下标，否则步骤追加时会整列重建、丢掉滚动位置。
- 同一时刻最多保留一个 `active` 步骤。多个活跃步骤在视觉上无法区分先后，自动滚动也只会跟随其中之一。
- 步骤结束时把 `status` 从 `active` 改成 `done` 或 `error`，否则即使流式已停，旋转指示仍会留在界面上。
- 工具步骤的 `title` 写成可读的调用签名（`read_file(src/main.ts)`），比只写工具名更有信息量。
- 中文界面记得覆盖 `label`。

## 离线完整示例源码

- [ChainOfThoughtChainOfThoughtDemo](../snapshot/apps/nexus/app/components/content/demos/ChainOfThoughtChainOfThoughtDemo.vue.txt)

## 离线类型与实现参考

- [chain-of-thought/index.ts](../snapshot/packages/tuffex/packages/components/src/chain-of-thought/index.ts.txt)
- [src/TxChainOfThought.vue](../snapshot/packages/tuffex/packages/components/src/chain-of-thought/src/TxChainOfThought.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
