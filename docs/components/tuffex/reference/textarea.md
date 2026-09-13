# Textarea

> 带字数统计、resize 与状态样式的独立多行输入。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/textarea) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/textarea.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/textarea.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Textarea

## 基础用法

### Textarea
官方示例：`TextareaTextareaDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const value = ref('')
</script>

<template>
  <TxTextarea
    v-model="value"
    placeholder="记录这次发布审阅结论..."
    :max-length="160"
    show-count
    :status="value.trim() ? 'success' : 'error'"
  />
</template>
```

## 交互契约

- `v-model` 持有字符串，并在原生输入时同时发出 `update:modelValue` 和 `input`。
- 外部 `class` 和 `style` 保留在根节点，其余 attrs 透传给内部 `<textarea>`。
- `showCount` 显示当前长度；存在 `maxLength` 时格式是 `current/max`。
- `status` 只改变视觉状态，校验文案应放在宿主表单项中。
- 暴露 `focus()` 与 `blur()`，用于表单流程和编辑器快捷键。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `modelValue` / `v-model` | `string` | `''` | 多行输入值。 |
| `placeholder` | `string` | `''` | 占位文本。 |
| `rows` | `number` | `4` | 原生 textarea 行数。 |
| `disabled` | `boolean` | `false` | 原生禁用态。 |
| `readonly` | `boolean` | `false` | 原生只读态。 |
| `maxLength` | `number` | - | 原生最大长度与计数分母。 |
| `showCount` | `boolean` | `false` | 是否显示字数统计。 |
| `resize` | `'none' \| 'vertical' \| 'horizontal' \| 'both'` | `'vertical'` | CSS resize 行为。 |
| `status` | `'default' \| 'success' \| 'error'` | `'default'` | 视觉校验状态。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `update:modelValue` | `(value: string)` | v-model 更新。 |
| `input` | `(value: string)` | 镜像值更新。 |
| `focus` | `(event: FocusEvent)` | 原生 focus 事件。 |
| `blur` | `(event: FocusEvent)` | 原生 blur 事件。 |

### Exposed Methods

| 方法 | 说明 |
|------|------|
| `focus()` | 聚焦原生 textarea。 |
| `blur()` | 让原生 textarea 失焦。 |
| `textareaRef` | 原生 textarea ref。 |

## Slots

`TxTextarea` 不暴露插槽。标签、帮助文本、`showCount` 以外的计数展示和校验文案应放在外层表单项中。

## 最佳实践

- 有长度上限的备注、摘要、Prompt 建议配合 `maxLength` 与 `showCount`。
- 普通表单保持 `resize="vertical"`；只有外层布局已经控制高度时才用 `none`。
- `status` 只做视觉提示，可访问校验信息应由外层表单承载。
- `id`、`name` 与表单相关 attrs 可直接传入，组件会透传给 textarea。

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/textarea/src/TxTextarea.vue` 确认 attrs 透传、`class` / `style` 放置、计数格式、resize class、状态 class、焦点状态和暴露方法。
- **实测覆盖:** `packages/tuffex/packages/components/src/textarea/__tests__/textarea.test.ts` 覆盖值/占位/行数、attrs 透传、`input` / `update:modelValue`、计数文本、状态/resize class 和 focus/blur helper 暴露。
- 导出入口:`packages/tuffex/packages/components/src/textarea/index.ts` 使用 `withInstall` 包装组件并导出 `TxTextareaInstance`。

## Source

## 离线完整示例源码

- [TextareaTextareaDemo](../snapshot/apps/nexus/app/components/content/demos/TextareaTextareaDemo.vue.txt)

## 离线类型与实现参考

- [textarea/index.ts](../snapshot/packages/tuffex/packages/components/src/textarea/index.ts.txt)
- [src/TxTextarea.vue](../snapshot/packages/tuffex/packages/components/src/textarea/src/TxTextarea.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
