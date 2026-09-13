# Attachment Tray

> 消息附件区，图片走网格与预览器，文件走胶囊，可选上传进度与移除。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/attachment-tray) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/attachment-tray.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/attachment-tray.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Attachment Tray

## 基础用法

### Attachment Tray
官方示例：`AttachmentTrayAttachmentTrayDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const attachments = [
  { kind: 'image', id: 'i1', url: 'https://picsum.photos/id/1015/400/300', name: 'canyon.jpg' },
  { kind: 'file', id: 'f1', name: 'report.pdf', size: 240_000 },
  { kind: 'file', id: 'f2', name: 'uploading.zip', size: 1_200_000, uploading: true, progress: 0.4 },
]
</script>

<template>
  <TxAttachmentTray :attachments="attachments" removable @remove="onRemove" @cancel="onCancel" />
</template>
```

## 交互契约

- 附件按 `kind` 自动分流：`image` 进图片网格，`file` 进文件胶囊。两类混在同一个 `attachments` 数组里传入即可。
- `removable` 是两种模式的开关：为真时显示移除与取消上传（输入框场景），为假时整个区域只读（消息场景）。
- 三个事件各有分工：`remove` 与 `cancel` 携带附件 `id`；`open` **只由文件胶囊派发**，携带整个附件对象，「打开」具体做什么由消费方决定。
- 图片没有 `open` 事件——点击图片会打开组件内置的预览器（基于 `TxModal`），不需要宿主接线。
- 预览器只在图片之间翻页，索引会被夹在有效范围内；文件不参与翻页。
- 预览器标题优先用图片的 `name`，缺失时回退到 `previewTitle`。
- 缩略图加载失败会被按 `id` 记下并换成占位块，不会显示浏览器的破图标志，也不会反复重试。
- 上传进度由附件上的 `uploading` 与 `progress`（0~1）驱动，画成环形进度。
- 文件大小默认按 B / KB / MB 保留一位小数，`sizeFormatter` 可整体接管。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `attachments` | `AiAttachment[]` | — | 图片与文件混合的附件列表。必填。 |
| `removable` | `boolean` | `false` | 是否显示移除 / 取消上传。输入框场景为真，消息场景为假。 |
| `previewTitle` | `string` | `'Preview'` | 图片无 `name` 时的预览器标题。 |
| `previousLabel` | `string` | `'Previous image'` | 上一张按钮的可访问名称。 |
| `nextLabel` | `string` | `'Next image'` | 下一张按钮的可访问名称。 |
| `previousText` | `string` | `'Prev'` | 上一张按钮的可见文字。 |
| `nextText` | `string` | `'Next'` | 下一张按钮的可见文字。 |
| `removeLabel` | `string` | `'Remove attachment'` | 移除按钮的可访问名称。 |
| `cancelLabel` | `string` | `'Cancel upload'` | 取消上传按钮的可访问名称。 |
| `sizeFormatter` | `(bytes: number) => string` | — | 自定义文件大小文案；未设时回退到 B/KB/MB。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `remove` | `(id: string)` | 点击移除时派发。 |
| `cancel` | `(id: string)` | 点击取消上传时派发。 |
| `open` | `(attachment: AiAttachmentFile)` | **仅文件胶囊**派发；图片走内置预览器。 |

## Slots

`TxAttachmentTray` 不暴露插槽。图片网格与文件胶囊的结构是固定的。

## 最佳实践

- 输入框里传 `removable`，消息里不要传——这是区分「还能改」与「已发出」的唯一信号。
- `remove` 与 `cancel` 都只给 `id`，请自行按 `id` 从列表中剔除；组件不会自己修改 `attachments`。
- 上传中的附件同时给 `uploading: true` 与 `progress`，只给其一会让环形进度停在起点。
- 文件的 `open` 必须自己实现，否则点击文件胶囊没有任何反应。
- 非英文界面需覆盖六个文案 prop 加 `sizeFormatter`，其中 `previousText` / `nextText` 是可见文字，漏掉最显眼。

## 离线完整示例源码

- [AttachmentTrayAttachmentTrayDemo](../snapshot/apps/nexus/app/components/content/demos/AttachmentTrayAttachmentTrayDemo.vue.txt)

## 离线类型与实现参考

- [attachment-tray/index.ts](../snapshot/packages/tuffex/packages/components/src/attachment-tray/index.ts.txt)
- [src/TxAttachmentChip.vue](../snapshot/packages/tuffex/packages/components/src/attachment-tray/src/TxAttachmentChip.vue.txt)
- [src/TxAttachmentTray.vue](../snapshot/packages/tuffex/packages/components/src/attachment-tray/src/TxAttachmentTray.vue.txt)
- [src/format-size.ts](../snapshot/packages/tuffex/packages/components/src/attachment-tray/src/format-size.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/attachment-tray/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
