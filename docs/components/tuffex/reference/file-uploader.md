# FileUploader 文件上传

> 受控文件选择与拖拽上传组件，支持最大数量限制、文件列表渲染和删除事件。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/file-uploader) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/file-uploader.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/file-uploader.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# FileUploader 文件上传

## 基础用法

官方示例：`FileUploaderFileUploaderDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const files = ref([])
</script>

<template>
  <TxFileUploader v-model="files" accept=".pdf,.png,.jpg" :max="5" />
</template>
```

## 组合示例

### 选择后上传

`add` 只包含本次新增且被接受的记录。`change` 与 `update:modelValue` 包含完整的新值。

```vue
<script setup lang="ts">
import type { FileUploaderFile } from '@talex-touch/tuffex/components'
import { ref } from 'vue'

const files = ref<FileUploaderFile[]>([])

async function uploadAdded(added: FileUploaderFile[]) {
  await Promise.all(added.map(item => uploadFile(item.file)))
}
</script>

<template>
  <TxFileUploader v-model="files" accept="image/*" :max="3" @add="uploadAdded" />
</template>
```

### 命令式打开选择器

```vue
<script setup lang="ts">
const uploader = ref<{ pick: () => void }>()
</script>

<template>
  <TxFileUploader ref="uploader" v-model="files" />
  <TxButton @click="uploader?.pick()">浏览文件</TxButton>
</template>
```

`pick()` 会遵守 `disabled=true`，禁用时不会打开 input。

## 交互契约

- 隐藏的原生 input 使用 `type="file"`，并从 props 接收 `multiple`、`accept` 与 `disabled`。
- 可见拖拽区是原生 `button type="button"`；点击它会调用 `pick()`。
- `pick()` 在禁用时不做任何事；否则点击隐藏文件 input。
- input change 中的文件会转换为带生成 id 的 `FileUploaderFile` 记录。
- 每次 input change 后都会清空原生 input 值，因此可以再次选择同一个文件。
- 新增文件数量由剩余容量限制：`max - modelValue.length`。
- 没有剩余容量时不会发出事件。
- 有效新增会依次发出 `add`、`update:modelValue`、`change`。
- 删除已有文件会先发出携带 `{ id, value }` 的 `remove`，再发出 `update:modelValue` 和 `change`。
- `allowDrop=false` 或 `disabled=true` 会阻断 drag-over 与 drop 处理。
- drag-over 只在允许拖拽时调用 `preventDefault()` 并设置 `is-dragging`；drop 会清理该状态。
- `showSize=true` 时，文件大小显示为 `B`、`KB` 或 `MB`。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `modelValue` | `FileUploaderFile[]` | `[]` | 受控的已选文件列表。 |
| `multiple` | `boolean` | `true` | 透传给原生文件 input。 |
| `accept` | `string` | `'*/*'` | 透传给原生 input 的可接受文件类型。 |
| `disabled` | `boolean` | `false` | 禁用浏览、删除与拖拽行为。 |
| `max` | `number` | `10` | 已选文件总数上限。 |
| `showSize` | `boolean` | `true` | 在列表中显示格式化文件大小。 |
| `allowDrop` | `boolean` | `true` | 启用 drag-over 和 drop 文件添加。 |
| `buttonText` | `string` | `'Choose files'` | 强调浏览标签中的文本。 |
| `dropText` | `string` | `'Drop files here'` | 拖拽区主文本。 |
| `hintText` | `string` | `'or click to browse'` | 拖拽区辅助提示。 |

### FileUploaderFile

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 生成的唯一 id，用于列表 key 和删除 payload。 |
| `name` | `string` | 原始文件名。 |
| `size` | `number` | 原始文件字节大小。 |
| `type` | `string` | 原始 MIME 类型。 |
| `file` | `File` | 原始浏览器 `File` 对象。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `update:modelValue` | `FileUploaderFile[]` | 新增或删除后的完整已选文件列表。 |
| `change` | `FileUploaderFile[]` | 新增或删除后的同一份完整列表。 |
| `add` | `FileUploaderFile[]` | 仅本次新增且被接受的文件。 |
| `remove` | `{ id: string, value: FileUploaderFile[] }` | 被删除 id 与删除后的完整列表。 |

### Slots

| 插槽名 | 参数 | 说明 |
|------|------|------|
| - | - | `TxFileUploader` 不暴露插槽。通过 `buttonText`、`dropText`、`hintText` 自定义文案；只有文件列表布局必须改造时才替换组件。 |

### Expose

| 名称 | 签名 | 说明 |
|------|------|------|
| `pick` | `() => void` | 打开原生文件选择器；禁用时不执行。 |

## 最佳实践

- 把 `FileUploaderFile.file` 当作真实上传 payload，把其它元数据留在 `modelValue` 中驱动 UI。
- 在服务端强制校验文件大小、MIME 和内容；`accept` 只是浏览器提示。
- 使用 `max` 限制 UI 选择数量，但上传前仍要校验数量上限。
- 上传副作用监听 `add`；需要完整列表时监听 `change`。
- 生成的 id 只适合当前 UI 会话，不要持久化为长期文件 id。
- 紧凑表单中如果拖拽容易造成误操作，应设置 `allowDrop=false`。

## 审阅说明

- 已对照 `packages/tuffex/packages/components/src/file-uploader/src/types.ts`、`TxFileUploader.vue` 与 `file-uploader.test.ts` 核对。
- **实测覆盖:** 原生 button 语义、禁用时阻止浏览、文件新增和 remove 事件发出。
- API 说明：`remove` 方法内部不再二次判断 disabled，但生成的删除按钮会由 prop 禁用；自定义包装时应保留该禁用守卫。
- 校验说明：`accept` 和 `max` 只是 UI 约束；后端仍需重新校验文件数量、MIME、大小和内容。

## Source

- Component source: `packages/tuffex/packages/components/src/file-uploader/src/TxFileUploader.vue`.
- Types: `packages/tuffex/packages/components/src/file-uploader/src/types.ts`.
- Coverage: `packages/tuffex/packages/components/src/file-uploader/__tests__/file-uploader.test.ts`.

## 离线完整示例源码

- [FileUploaderFileUploaderDemo](../snapshot/apps/nexus/app/components/content/demos/FileUploaderFileUploaderDemo.vue.txt)

## 离线类型与实现参考

- [file-uploader/index.ts](../snapshot/packages/tuffex/packages/components/src/file-uploader/index.ts.txt)
- [src/TxFileUploader.vue](../snapshot/packages/tuffex/packages/components/src/file-uploader/src/TxFileUploader.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/file-uploader/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
