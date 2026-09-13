# Tool Call Card

> 工具调用的状态卡片，运行日志自动跟随尾部，结果区可由宿主接管。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/tool-call-card) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/tool-call-card.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/tool-call-card.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Tool Call Card

## 基础用法

### Tool Call Card
官方示例：`ToolCallCardToolCallCardDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const toolCall = {
  type: 'tool-call',
  id: 'call-1',
  name: 'read_file',
  status: 'done',
  summary: '读取 src/main.ts',
  input: '{ "path": "src/main.ts" }',
  output: 'export function main() {}',
}
</script>

<template>
  <TxToolCallCard :tool-call="toolCall" @retry="onRetry" />
</template>
```

## 交互契约

- 展开态由组件自己持有，初值取 `defaultExpanded`；非受控，之后改这个 prop 不生效。
- 点击头部切换并派发 `toggle`，参数是切换**之后**的状态。
- `status` 有四档：`pending`、`running`、`done`、`error`，同时写在 `data-status` 上供外部定制样式。四档文案分别由 `pendingLabel` / `runningLabel` / `doneLabel` / `errorLabel` 控制，默认是英文。
- 状态文案的分支是 `default` 兜底的：`pending`、`running`、`error` 各自匹配，**其余一律显示 `doneLabel`**。
- `toolCall.logs` 每次变化都会把日志区滚到底部，像终端一样跟随尾部输出。
- `retry` 携带的是 `toolCall.id`，不是整个对象——重试通常只需要标识。
- 结果区有三层回退：宿主挂 `result` 插槽时用插槽；否则渲染 `output`；`status` 为 `error` 时渲染 `error`。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `toolCall` | `AiToolCallPart` | — | 工具调用数据：`{ type, id, name, status, summary?, input?, output?, error?, logs? }`。必填。 |
| `defaultExpanded` | `boolean` | `false` | 初始是否展开。仅在挂载时读取一次。 |
| `retryLabel` | `string` | `'Retry'` | 重试按钮文案。 |
| `pendingLabel` | `string` | `'Queued'` | `pending` 状态文案。 |
| `runningLabel` | `string` | `'Running'` | `running` 状态文案。 |
| `doneLabel` | `string` | `'Done'` | `done`（及未匹配状态）文案。 |
| `errorLabel` | `string` | `'Failed'` | `error` 状态文案。 |
| `inputLabel` | `string` | `'Input'` | 入参区标题。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `retry` | `(id: string)` | 点击重试时派发，携带 `toolCall.id`。 |
| `toggle` | `(expanded: boolean)` | 头部被点击时派发，携带切换后的展开状态。 |

## Slots

| 插槽名 | 作用域参数 | 说明 |
|------|------|------|
| `summary` | `{ toolCall }` | 覆盖折叠头部的摘要文本。 |
| `result` | `{ toolCall }` | 结果区的挂载点，供宿主渲染自己的组件（例如 widget）。设置后 `output` 不再直接渲染。 |
| `icon` | `{ status }` | 覆盖状态图标。 |

## 最佳实践

- 用 `result` 插槽承载结构化结果（表格、图表、widget），把 `output` 留作没有挂载 widget 时的纯文本回退。
- 只在 `status` 为 `error` 时提供重试入口，并在收到 `retry` 后把状态改回 `running`，否则用户会连点。
- 日志按行追加而不是整段替换，跟随尾部的效果才连贯。
- 非英文界面要把六个文案 prop 一起覆盖，只改其中几个会出现中英混排。
- `summary` 写清「做了什么」而不是重复工具名——折叠态是用户唯一能扫读的信息。

## 离线完整示例源码

- [ToolCallCardToolCallCardDemo](../snapshot/apps/nexus/app/components/content/demos/ToolCallCardToolCallCardDemo.vue.txt)

## 离线类型与实现参考

- [tool-call-card/index.ts](../snapshot/packages/tuffex/packages/components/src/tool-call-card/index.ts.txt)
- [src/TxToolCallCard.vue](../snapshot/packages/tuffex/packages/components/src/tool-call-card/src/TxToolCallCard.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
