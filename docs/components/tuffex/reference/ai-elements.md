# AI Elements

> 用于 AI 对话界面的会话与消息基础组件。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/ai-elements) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/ai-elements.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/ai-elements.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# AI Elements

## 对话列表

宿主已经维护消息数组，只需要统一的对话排版时使用 `TxAiConversation`。

### AI Conversation
官方示例：`AiElementsAiConversationDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import type { AiElementMessage } from '@talex-touch/tuffex/ai-elements'
import { computed } from 'vue'

const messages = computed<AiElementMessage[]>(() => [
  { id: 'u1', role: 'user', content: '帮我总结这次发布审阅结果。', name: '你' },
  { id: 'a1', role: 'assistant', content: '已完成 **组件文档** 审阅。', name: 'Nexus AI' },
  { id: 't1', role: 'tool', content: '', name: 'Verifier', status: 'streaming' },
])
</script>

<template>
  <TxAiConversation :messages="messages" show-avatar />
</template>
```

## 交互契约

- `messages` 渲染前会被过滤：空 `content` 会被隐藏，除非 `status` 是 `pending` 或 `streaming`。
- `markdown` 默认是 `true`，消息正文会交给 `TxMarkdownView` 渲染。
- `showAvatar` 开启头像列；未提供 `message.avatar` 时显示角色/名称首字母。
- `pending` 或 `streaming` 且内容为空的消息会显示内置输入中指示器。
- `TxAiConversation` 使用 `aria-live="polite"`，追加消息时不会抢焦点。

## API

### AiElementMessage

| 字段 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `id` | `string` | 必填 | 消息稳定 key。 |
| `role` | `'user' \| 'assistant' \| 'system' \| 'tool'` | 必填 | 视觉和语义角色。 |
| `content` | `string` | 必填 | 消息文本或 Markdown 源。 |
| `createdAt` | `number \| string \| Date` | - | 宿主可选时间戳。 |
| `name` | `string` | - | 显示名称；默认回退为 You / AI / Tool / System。 |
| `avatar` | `string` | - | 开启头像时使用的图片 URL。 |
| `status` | `'pending' \| 'streaming' \| 'complete' \| 'error'` | - | 消息生命周期状态。 |

### TxAiConversation Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `messages` | `AiElementMessage[]` | 必填 | 对话数据；空 `content` 会被过滤，除非消息处于 pending 或 streaming。 |
| `markdown` | `boolean` | `true` | 使用 `TxMarkdownView` 渲染消息正文。 |
| `compact` | `boolean` | `false` | 使用更紧凑的消息间距。 |
| `emptyText` | `string` | `'No messages yet'` | 过滤后没有可渲染消息时显示的内置空状态文案。 |
| `showAvatar` | `boolean` | `false` | 为所有渲染消息显示头像列。 |

### TxAiMessage Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `message` | `AiElementMessage` | 必填 | 单条消息数据。 |
| `markdown` | `boolean` | `true` | 使用 `TxMarkdownView` 渲染正文；设为 `false` 时保留纯文本换行。 |
| `compact` | `boolean` | `false` | 使用紧凑行密度和更小头像尺寸。 |
| `showAvatar` | `boolean` | `false` | 为当前消息开启头像。 |

### Events

`TxAiConversation` 与 `TxAiMessage` 不派发组件事件。请在宿主对话 store 中更新状态，再把新的 `messages` 数组传回 `TxAiConversation`。

## Slots

### TxAiConversation

| 插槽名 | Props | 说明 |
|------|------|------|
| `empty` | - | 替换消息过滤后的内置空状态段落。 |

### TxAiMessage

| 插槽名 | Props | 说明 |
|------|------|------|
| `default` | `{ message }` | 替换消息正文区域；适合工具卡片、附件或自定义渲染器。 |
| `avatar` | `{ message }` | `showAvatar` 开启时替换头像图片或回退内容。 |

## 最佳实践

- 在宿主维护 provider 流式状态，再映射到 `status`。
- 使用对话存储里的稳定消息 id，不要使用数组下标。
- 助手输出建议保持 Markdown 开启；不可信 Markdown 应在数据边界做清洗或归一化。
- 工具卡片或附件建议用 `default` 插槽，不要把自定义 HTML 塞进 `content`。

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/ai-elements/src/TxAiConversation.vue` 确认消息过滤、polite live region、`empty` 插槽和子消息透传。
- 组件源码:`packages/tuffex/packages/components/src/ai-elements/src/TxAiMessage.vue` 确认角色标签、状态标签、Markdown/纯文本渲染、输入中指示器以及 `default` / `avatar` 插槽。
- 类型契约:`packages/tuffex/packages/components/src/ai-elements/src/types.ts` 定义 `AiElementMessage`、`AiConversationProps` 和 `AiMessageProps`。
- **实测覆盖:** Coverage: 当前没有专用的 `ai-elements` 组件单测；`apps/nexus/test/docs/tuffex-component-docs-coverage.test.ts` 会验证本页具备中英文文档，并确保 `AiElementsAiConversationDemo` 仍注册到存在的 Vue 示例。
- 导出入口:`packages/tuffex/packages/components/src/ai-elements/index.ts` 导出可安装的 `AiConversation`、`AiMessage`、`TxAiConversation` 和 `TxAiMessage`。

## Source

## 离线完整示例源码

- [AiElementsAiConversationDemo](../snapshot/apps/nexus/app/components/content/demos/AiElementsAiConversationDemo.vue.txt)

## 离线类型与实现参考

- [ai-elements/index.ts](../snapshot/packages/tuffex/packages/components/src/ai-elements/index.ts.txt)
- [src/TxAiConversation.vue](../snapshot/packages/tuffex/packages/components/src/ai-elements/src/TxAiConversation.vue.txt)
- [src/TxAiMessage.vue](../snapshot/packages/tuffex/packages/components/src/ai-elements/src/TxAiMessage.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/ai-elements/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
