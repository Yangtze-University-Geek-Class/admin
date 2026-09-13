# Chat 消息列表

> 支持 Markdown、图片附件、消息入场动画与图片点击事件的 AI 消息列表。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/chat) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/chat.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/chat.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Chat 消息列表

## 基础用法

### ChatList
官方示例：`ChatChatListDemo`（完整源码见本页末尾）

````vue
<script setup lang="ts">
import type { ChatMessageModel } from '@talex-touch/tuffex/chat'
import { ref } from 'vue'

const messages = ref<ChatMessageModel[]>([
  { id: 'system-1', role: 'system', content: 'Markdown 已启用。', createdAt: 1_705_000_000_000 },
  {
    id: 'user-1',
    role: 'user',
    content: '请审阅这张发布封面。',
    attachments: [{ type: 'image', url: '/cover.svg', name: 'cover.svg' }],
  },
  { id: 'assistant-1', role: 'assistant', content: '可以进入发布说明。\n\n```ts\nconst status = "ready"\n```' },
])
</script>

<template>
  <TxChatList :messages="messages" :markdown="true" @image-click="console.log" />
</template>
````

## 交互契约

- `TxChatList` 保持 `messages` 顺序，并用稳定 `id` 渲染每条消息。
- `markdown` 默认是 `true`，正文交给 `TxMarkdownView`；设为 `false` 时渲染纯文本。
- `stagger` 默认是 `true`，列表会用 `TxStagger` 包裹消息行；虚拟列表或频繁重排的记录应关闭。
- `createdAt` 只在挂载后格式化，避免 SSR 与客户端时间不一致。
- 图片附件以原生 `button type="button"` 缩略图渲染，图片使用 lazy loading。
- `imageClick` 始终包含 `{ url, name, messageId }`，宿主可据此打开预览、下载或审计来源消息。

## API

### Data Models

#### ChatMessageModel

| 字段 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `id` | `string` | 必填 | `TxChatList` 使用的消息稳定 key。 |
| `role` | `'user' \| 'assistant' \| 'system'` | 必填 | 消息角色与行对齐方式。 |
| `content` | `string` | 必填 | Markdown 或纯文本正文。 |
| `createdAt` | `number` | - | epoch 时间戳，挂载后渲染为 `HH:mm`。 |
| `avatarUrl` | `string` | - | 当前行头像图片。 |
| `attachments` | `ChatMessageAttachment[]` | - | 以缩略图渲染的图片附件。 |

#### ChatMessageAttachment

| 字段 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `type` | `'image'` | 必填 | 当前附件类型。 |
| `url` | `string` | 必填 | 缩略图和点击 payload 使用的图片地址。 |
| `name` | `string` | - | 图片 alt 文本和点击 payload 标签。 |

### Props

#### TxChatList

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `messages` | `ChatMessageModel[]` | 必填 | 对话消息数组，按数组顺序渲染。 |
| `markdown` | `boolean` | `true` | 使用 `TxMarkdownView` 渲染消息正文。 |
| `stagger` | `boolean` | `true` | 用 `TxStagger` 播放消息入场动画。 |

#### TxChatMessage

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `message` | `ChatMessageModel` | 必填 | 单条消息数据。 |
| `markdown` | `boolean` | `true` | 以 Markdown 或纯文本渲染正文。 |

### Events

#### TxChatList

| 事件名 | 参数 | 说明 |
|------|------|------|
| `imageClick` | `{ url: string, name?: string, messageId: string }` | 图片附件缩略图点击时，从 `TxChatMessage` 透传发出。 |

#### TxChatMessage

| 事件名 | 参数 | 说明 |
|------|------|------|
| `imageClick` | `{ url: string, name?: string, messageId: string }` | 图片附件缩略图点击时发出。 |

### Slots

#### TxChatList

不暴露公开插槽；需要改写单行渲染时，直接使用 `TxChatMessage` 的插槽。

#### TxChatMessage

| 插槽名 | Props | 说明 |
|------|------|------|
| `avatar` | `{ message: ChatMessageModel }` | 替换头像图片/回退内容。 |
| `header` | `{ message: ChatMessageModel }` | 替换时间头部。 |
| `content` | `{ message: ChatMessageModel }` | 替换 Markdown/纯文本正文渲染。 |

### Exposed Methods

不暴露公开实例方法。

## 相关组件

- `TxChatComposer` 负责文本输入、附件、发送保护和工具栏插槽，见 [ChatComposer](./chat-composer.md)。
- `TxTypingIndicator` 负责助手输入中状态，见 [TypingIndicator](./typing-indicator.md)。
- 需要 `tool` 消息或 streaming 状态的新 AI 对话界面，优先使用 [AI Elements](./ai-elements.md)。

## 最佳实践

- 使用对话存储中的稳定消息 id，不要用数组下标作为 key。
- 在数据边界归一化远程图片 URL；`TxChatMessage` 不校验或重写附件来源。
- 虚拟列表或流式过程中会重排消息时关闭 `stagger`。
- 在宿主处理 `imageClick`，让预览、下载、analytics 和权限检查保留产品语义。
- 可信助手输出可保持 Markdown 开启；不可信内容进入消息数组前应先清洗或归一化。
- 输入框和助手 pending 状态分别参考独立的 `TxChatComposer` 与 `TxTypingIndicator` 文档；本页只覆盖对话记录渲染。

## 审阅说明

- 已人工核对 `packages/tuffex/packages/components/src/chat/src/types.ts`、`TxChatList.vue`、`TxChatMessage.vue`、`TxChatComposer.vue`、`TxTypingIndicator.vue`、`chat-composer.test.ts` 与 `typing-indicator.test.ts`。
- API 标题已统一为共享的 `Props`、`Events`、`Slots`，再用子标题区分组件，同时保留 message 数据模型。
- 已按源码确认 `TxChatList` 会透传 `imageClick`，`TxChatMessage` 发出标准化图片 payload，Markdown 默认开启，stagger 默认开启，时间戳挂载前不渲染。
- **实测覆盖:** Coverage: 当前没有专用的 `TxChatList` / `TxChatMessage` 单测；`apps/nexus/test/docs/tuffex-component-docs-coverage.test.ts` 会验证本页与 `ChatChatListDemo`，同目录的 `chat-composer.test.ts` 和 `typing-indicator.test.ts` 覆盖本页链接到的相关组件。
- `TxChatComposer` 和 `TxTypingIndicator` 位于同一源码目录，但作为相关组件链接，避免在本对话记录页面重复完整 API。

## Source

- List source: `packages/tuffex/packages/components/src/chat/src/TxChatList.vue`
- Message source: `packages/tuffex/packages/components/src/chat/src/TxChatMessage.vue`
- Types: `packages/tuffex/packages/components/src/chat/src/types.ts`
- Related sources: `packages/tuffex/packages/components/src/chat/src/TxChatComposer.vue`, `packages/tuffex/packages/components/src/chat/src/TxTypingIndicator.vue`
- Tests: `packages/tuffex/packages/components/src/chat/__tests__/chat-composer.test.ts`, `packages/tuffex/packages/components/src/chat/__tests__/typing-indicator.test.ts`

## 离线完整示例源码

- [ChatChatListDemo](../snapshot/apps/nexus/app/components/content/demos/ChatChatListDemo.vue.txt)

## 离线类型与实现参考

- [chat/index.ts](../snapshot/packages/tuffex/packages/components/src/chat/index.ts.txt)
- [src/TxChatComposer.vue](../snapshot/packages/tuffex/packages/components/src/chat/src/TxChatComposer.vue.txt)
- [src/TxChatList.vue](../snapshot/packages/tuffex/packages/components/src/chat/src/TxChatList.vue.txt)
- [src/TxChatMessage.vue](../snapshot/packages/tuffex/packages/components/src/chat/src/TxChatMessage.vue.txt)
- [src/TxTypingIndicator.vue](../snapshot/packages/tuffex/packages/components/src/chat/src/TxTypingIndicator.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/chat/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
