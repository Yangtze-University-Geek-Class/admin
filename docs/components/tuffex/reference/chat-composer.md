# ChatComposer 消息输入

> AI 消息输入、附件 chip、键盘发送和自定义工具栏。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/chat-composer) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/chat-composer.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/chat-composer.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# ChatComposer 消息输入

<script setup lang="ts">
import { ref } from 'vue'

const text = ref('')
const sent = ref<string[]>([])

function onSend(payload: { text: string }) {
  sent.value.unshift(payload.text)
  text.value = ''
}
</script>

## 基础用法

### ChatComposer
官方示例：`ChatComposerChatComposerDemo`（完整源码见本页末尾）

```vue
<template>
  <TxChatComposer v-model="text" @send="onSend" />
</template>
```

## API

### Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `modelValue` | `string` | `''` | textarea 的 `v-model` 值 |
| `placeholder` | `string` | `'Message…'` | textarea 占位文本 |
| `disabled` | `boolean` | `false` | 禁用输入、发送与附件操作 |
| `submitting` | `boolean` | `false` | 提交中状态，阻断发送 |
| `allowAttachmentWhileSubmitting` | `boolean` | `false` | 提交中仍允许附件操作 |
| `minRows` | `number` | `3` | textarea 行数 |
| `maxRows` | `number` | `6` | 预留给使用方的最大行数 |
| `sendOnEnter` | `boolean` | `true` | 启用键盘发送行为 |
| `sendOnMetaEnter` | `boolean` | `true` | 键盘发送是否需要 Meta/Ctrl+Enter |
| `allowEmptySend` | `boolean` | `false` | 文本为空时允许仅凭附件发送 |
| `sendButtonText` | `string` | `'Send'` | 默认发送按钮文本 |
| `showAttachmentButton` | `boolean` | `false` | 显示默认附件按钮 |
| `attachmentButtonText` | `string` | `'Attach'` | 默认附件按钮文本 |
| `attachments` | `ChatComposerAttachment[]` | `[]` | textarea 上方的附件 chips |

### Events

| 事件 | 参数 | 说明 |
|------|------|------|
| `update:modelValue` | `string` | textarea 输入时触发 |
| `send` | `{ text: string }` | 允许发送时触发，文本已 trim |
| `attachmentClick` | - | 允许附件操作时触发 |
| `paste` | `ClipboardEvent` | 透传 textarea paste |
| `focus` | `FocusEvent` | 透传 textarea focus |
| `blur` | `FocusEvent` | 透传 textarea blur |

### Slots

| 插槽 | 作用域 | 说明 |
|------|--------|------|
| `attachments` | `{ attachments }` | 替换默认附件 chips |
| `toolbar` | `{ send, disabled, attachmentClick }` | 替换默认操作行 |
| `toolbar-left` | `{ disabled }` | 添加到默认操作行左侧 |
| `actions` | `{ send, disabled }` | 添加到默认发送按钮前 |
| `footer` | - | 渲染在操作行下方 |

## 交互契约

- `send` payload 的 text 会先 trim。
- 文本为空时默认阻断发送；只有 `allowEmptySend=true` 且存在附件时才允许仅附件发送。
- `disabled` 与 `submitting` 会阻断发送；`disabled` 也会阻断附件操作。
- 提交中默认阻断附件操作，除非 `allowAttachmentWhileSubmitting=true`。
- `sendOnMetaEnter=true` 时键盘发送需要 Meta/Ctrl+Enter；关闭后 Enter 发送，Shift+Enter 保留换行。
- 自定义 `toolbar` 会收到可调用的 `send` / `attachmentClick`，并替换默认操作行。


## 最佳实践

- 在宿主中保持 `modelValue` 受控，只在发送处理器确认接收 payload 后清空。
- 把 `send` 视为发送意图，而不是投递成功；API 失败时宿主应保留可重试状态。
- 请求进行中使用 `submitting` 防止重复发送。
- 密集聊天输入里优先保留 Meta/Ctrl+Enter 发送，让 Enter 继续用于换行。
- `attachments` 适合作为状态 chip；上传进度、删除和重试行为应放在宿主或自定义 `attachments` 插槽中。

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/chat/src/TxChatComposer.vue` 确认受控 textarea 更新、trim 后发送 payload、仅附件发送保护、附件按钮保护、键盘发送模式、作用域 toolbar 函数和原生 textarea 事件透传。
- 类型契约:`packages/tuffex/packages/components/src/chat/src/types.ts` 定义 `ChatComposerProps`、`ChatComposerAttachment` 和 `ChatComposerEmits`。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/chat/__tests__/chat-composer.test.ts` 覆盖默认渲染、model 更新、trim 发送、键盘模式、发送阻断、仅附件发送、附件保护、作用域插槽、原生事件和安装注册。
- 导出入口:`packages/tuffex/packages/components/src/chat/index.ts` 导出 `ChatComposer`、`TxChatComposer` 和公共 composer 类型。

## Source

## 离线完整示例源码

- [ChatComposerChatComposerDemo](../snapshot/apps/nexus/app/components/content/demos/ChatComposerChatComposerDemo.vue.txt)

## 离线类型与实现参考

本页是跨组件/概念说明；先按具体组件查询 catalog.json，再按 SOURCE 清单核对；不要从名称猜导出。

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
