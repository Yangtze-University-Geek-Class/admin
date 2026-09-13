# MarkdownEditor

> 带净化、工具栏和 WYSIWYG/source/preview 模式的 Markdown 编辑器。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/markdown-editor) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/markdown-editor.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/markdown-editor.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# MarkdownEditor

## 基础用法

### MarkdownEditor
官方示例：`MarkdownEditorMarkdownEditorDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const content = ref('## Release note\n\n- API reviewed\n- Demos verified')
</script>

<template>
  <TxMarkdownEditor
    v-model="content"
    default-mode="source"
    :toolbar-actions="['heading', 'bold', 'italic', 'bulletList', 'orderedList', 'link']"
  />
</template>
```

## 交互契约

- 提供 `mode` 时组件处于受控模式；否则用 `defaultMode` 初始化内部模式。
- 用户切换模式时会发出 `update:mode` 与 `mode-change`。
- `sanitize` 默认是 `true`；只有内容已经可信时才关闭。
- Source 模式直接编辑 Markdown；WYSIWYG 模式会在输入时把 DOM 序列化回 Markdown。
- 工具栏动作在各模式复用，但 preview 模式会禁用编辑动作。
- 模式切换器是一个切换按钮组：容器是 `role="group"`（标注 "Markdown editor mode"），每个模式按钮通过 `aria-pressed` 反映当前模式（不是 `role="tab"`，因为没有对应的 tabpanel）。
- `theme="auto"` 监听 `documentElement` 的 class / `data-theme`，无法判断时回退到 light。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `modelValue` / `v-model` | `string` | `''` | Markdown 源。 |
| `placeholder` | `string` | `''` | 编辑模式占位文本。 |
| `mode` | `'wysiwyg' \| 'source' \| 'preview'` | - | 受控编辑模式。 |
| `defaultMode` | `'wysiwyg' \| 'source' \| 'preview'` | `'wysiwyg'` | 初始内部模式。 |
| `disabled` | `boolean` | `false` | 禁用工具栏和字段。 |
| `readonly` | `boolean` | `false` | 禁止编辑但允许阅读。 |
| `sanitize` | `boolean` | `true` | 使用 DOMPurify 净化渲染 HTML。 |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | 编辑器主题。 |
| `toolbar` | `boolean` | `true` | 显示工具栏和模式切换器。 |
| `toolbarActions` | `MarkdownEditorToolbarActionKey[]` | 内置集合 | 工具栏动作顺序。 |
| `minHeight` | `string \| number` | `220` | 编辑器主体最小高度。 |
| `maxHeight` | `string \| number` | - | 编辑器主体最大高度。 |
| `linkPrompt` | `(selectedText: string) => string \| Promise<string>` | - | link 动作使用的异步 URL 提供函数。 |

### 工具栏动作

`heading`、`bold`、`italic`、`strike`、`quote`、`code`、`bulletList`、`orderedList`、`link`、`undo`、`redo`。

### Slots

不暴露公开插槽；工具栏按钮、编辑区和预览输出都是内部结构。

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `update:modelValue` | `(value: string)` | v-model 更新。 |
| `change` | `(value: string)` | Markdown 内容变化。 |
| `update:mode` | `(mode: MarkdownEditorMode)` | 受控模式更新。 |
| `mode-change` | `(mode: MarkdownEditorMode)` | 模式变化。 |
| `focus` | `()` | 编辑区域或 source 字段聚焦。 |
| `blur` | `()` | 编辑区域或 source 字段失焦。 |

### Exposed Methods

| 方法 | 说明 |
|------|------|
| `focus()` | 聚焦当前可编辑区域。 |
| `blur()` | 让当前可编辑区域失焦。 |
| `setMode(mode)` | 切换编辑模式。 |
| `getMode()` | 返回当前模式。 |
| `getValue()` | 返回当前 Markdown 源。 |
| `setValue(value)` | 设置 Markdown、发出更新并刷新渲染 HTML。 |

## 最佳实践

- 用户或 provider 生成内容保持 `sanitize=true`。
- 需要把编辑器 tab 写入路由/query 时使用受控 `mode`。
- 发布说明、评论等窄场景应限制 `toolbarActions`。
- URL 弹窗属于产品语境，使用 `linkPrompt` 注入，不要让组件自己拥有业务弹窗。

## 审阅说明

- 已人工核对 `packages/tuffex/packages/components/src/markdown-editor/src/types.ts`、`TxMarkdownEditor.vue`、`markdown-serializer.ts` 与 `markdown-editor.test.ts`。
- 默认通过 DOMPurify 开启净化；`sanitize=false` 只应作为可信内容的逃生口。
- `linkPrompt` 是收集业务 URL 的扩展点，让弹窗留在组件契约之外。

## Source

- Component source: `packages/tuffex/packages/components/src/markdown-editor/src/TxMarkdownEditor.vue`。
- Types: `packages/tuffex/packages/components/src/markdown-editor/src/types.ts`。
- Serializer: `packages/tuffex/packages/components/src/markdown-editor/src/markdown-serializer.ts`。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/markdown-editor/__tests__/markdown-editor.test.ts` 验证导出、净化后的 WYSIWYG 渲染、source 模式输入更新、非受控模式事件、`role="group"` / `aria-pressed` 模式切换器，以及富文本内容重新序列化为 Markdown。

## 离线完整示例源码

- [MarkdownEditorMarkdownEditorDemo](../snapshot/apps/nexus/app/components/content/demos/MarkdownEditorMarkdownEditorDemo.vue.txt)

## 离线类型与实现参考

- [markdown-editor/index.ts](../snapshot/packages/tuffex/packages/components/src/markdown-editor/index.ts.txt)
- [src/TxMarkdownEditor.vue](../snapshot/packages/tuffex/packages/components/src/markdown-editor/src/TxMarkdownEditor.vue.txt)
- [src/markdown-serializer.ts](../snapshot/packages/tuffex/packages/components/src/markdown-editor/src/markdown-serializer.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/markdown-editor/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
