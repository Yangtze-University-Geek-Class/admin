# CodeEditor 代码编辑器

> 基于 CodeMirror 的 JSON/YAML 编辑器，同时提供轻量 TOML、INI、JavaScript 编辑能力，支持格式化、校验、搜索、折叠和 toolbar 插槽。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/code-editor) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/code-editor.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/code-editor.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# CodeEditor 代码编辑器

## 基础用法

通过 `language` 选择 CodeMirror 语言能力。JSON 和 YAML 具备 formatter / linter；其它语言提供高亮和基础编辑体验。

官方示例：`CodeEditorCodeEditorDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const jsonValue = ref('{"name":"Tuffex","version":1}')
const yamlValue = ref('name: Tuffex\nversion: 1\n')
</script>

<template>
  <TxCodeEditor v-model="jsonValue" language="json" />
  <TxCodeEditor v-model="yamlValue" language="yaml" />
</template>
```

## Toolbar 插槽

通过 `toolbar` slot 把编辑器方法接到自定义控件上。`TxCodeEditorToolbar` 提供标准 action button 布局。

官方示例：`CodeEditorToolbarDemo`（完整源码见本页末尾）

```vue
<template>
  <TxCodeEditor v-model="value" language="json">
    <template #toolbar="{ format, openSearch, foldAll, unfoldAll, copy }">
      <TxCodeEditorToolbar
        :actions="toolbarActions"
        @action="(key) => runEditorAction(key, { format, openSearch, foldAll, unfoldAll, copy })"
      />
    </template>
  </TxCodeEditor>
</template>
```

## API

### Props

#### TxCodeEditor

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `modelValue` | `string` | `''` | 编辑器文档字符串，用于 `v-model`。 |
| `language` | `'json' \| 'yaml' \| 'toml' \| 'ini' \| 'javascript' \| 'js'` | `'json'` | 语言模式。`js` 会规范化为 `javascript`。 |
| `theme` | `'auto' \| 'light' \| 'dark' \| 'github' \| 'dracula' \| 'monokai'` | `'auto'` | 编辑器配色。`auto` 跟随 document 主题标记。 |
| `readOnly` | `boolean` | `false` | 使 CodeMirror 文档不可编辑，并禁用格式化。 |
| `lineNumbers` | `boolean` | `true` | 显示行号和当前行 gutter 高亮。 |
| `lineWrapping` | `boolean` | `false` | 启用 CodeMirror 自动换行。 |
| `placeholder` | `string` | `''` | placeholder 扩展文本。 |
| `tabSize` | `number` | `2` | 缩进宽度。非法值规范化为 `2`；有效值会四舍五入。 |
| `formatOnBlur` | `boolean` | `false` | blur 后执行 `format()`。 |
| `formatOnInit` | `boolean` | `false` | 运行时编辑器挂载后执行一次 `format()`。 |
| `lint` | `boolean` | `true` | 在当前语言有 linter 时启用 lint gutter 和诊断。 |
| `search` | `boolean` | `true` | 启用搜索扩展和搜索 keymap。 |
| `completion` | `boolean` | `true` | 启用自动补全、close brackets 和相关 keymap。 |
| `extensions` | `Extension[]` | `[]` | 追加到内置能力之后的 CodeMirror 扩展。 |

#### TxCodeEditorToolbar

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `actions` | `CodeEditorToolbarAction[]` | 内置 actions | 工具栏动作。为空时使用内置 `format`、`search`、`foldAll`、`unfoldAll`、`copy`。 |
| `compact` | `boolean` | `false` | 减少 action 按钮 padding。 |

### Data Models

#### CodeEditorToolbarAction

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | `'format' \| 'search' \| 'foldAll' \| 'unfoldAll' \| 'copy'` | toolbar 派发的动作 id。 |
| `label` | `string` | 可选可见文案。未提供时回退到内置英文文案。 |
| `icon` | `TxIconSource \| string` | 可选 `TxIcon` source 或 icon name。 |
| `active` | `boolean` | 应用 active 样式。 |
| `disabled` | `boolean` | 禁用按钮并阻止 `action`。 |
| `shortcut` | `string` | 可选快捷键文本，显示在 label 后方。 |

### Events

#### TxCodeEditor

| 事件名 | 参数 | 说明 |
|------|------|------|
| `update:modelValue` | `string` | 用户编辑或格式化改变文档时派发。 |
| `change` | `string` | 为 change 监听器派发同一个文档值。 |
| `focus` | `()` | CodeMirror 视图获得焦点时派发。 |
| `blur` | `()` | CodeMirror 视图失去焦点时派发。 |
| `format` | `{ value: string; language: CodeEditorLanguage }` | 格式化成功并产生新值后派发。 |

#### TxCodeEditorToolbar

| 事件名 | 参数 | 说明 |
|------|------|------|
| `action` | `CodeEditorToolbarActionKey` | 可用 toolbar action 被点击时派发。 |

### Slots

#### TxCodeEditor

| 插槽名 | Props | 说明 |
|------|-------|------|
| `toolbar` | `{ format, openSearch, foldAll, unfoldAll, copy, getValue }` | 可选工具栏区域，运行时组件挂载后渲染在编辑器视图上方。 |

#### TxCodeEditorToolbar

| 插槽名 | Props | 说明 |
|------|-------|------|
| `leading` | - | action 组前方内容。 |
| `trailing` | - | action 组后方内容。 |

### Exposed Methods

| 方法 | 类型 | 说明 |
|------|------|------|
| `focus()` | `() => void` | 运行时挂载后聚焦 CodeMirror 视图。 |
| `blur()` | `() => void` | 运行时挂载后让编辑器 content DOM 失焦。 |
| `format()` | `() => boolean` | 格式化 JSON/YAML。只读、语言不支持、输入非法、输出未变化或运行时未挂载时返回 `false`。 |
| `openSearch()` | `() => boolean` | search 启用时打开搜索面板。 |
| `foldAll()` | `() => boolean` | 执行 CodeMirror fold-all 命令。 |
| `unfoldAll()` | `() => boolean` | 执行 CodeMirror unfold-all 命令。 |
| `copy()` | `() => Promise<boolean>` | 可用时通过 `navigator.clipboard` 复制当前内容。 |
| `getValue()` | `() => string` | 返回当前编辑器文档；运行时挂载前返回 prop 值。 |
| `getView()` | `() => EditorView \| null` | 运行时挂载后返回 CodeMirror `EditorView`。 |

## 交互契约

- `TxCodeEditor` 在挂载时动态导入运行时编辑器；导入前 exposed methods 返回安全 fallback。
- `theme="auto"` 会读取 `html` / `body` 的 `data-theme` 和 `light` / `dark` class，并监听 `html` 的 class / `data-theme` 变化。
- JSON 格式化使用 `JSON.parse` / `JSON.stringify` 和规范化后的 `tabSize`；YAML 格式化使用 `yaml` 包解析和 stringify。
- 只有 `lint=true` 且语言为 JSON/YAML 时才会加入对应诊断；TOML、INI、JavaScript 当前没有自定义 lint 诊断。
- 外部 `modelValue` 变化会替换整份编辑器文档，但不会重新派发 update/change。
- toolbar slot props 来自运行时编辑器函数；运行时组件挂载前不会渲染 toolbar。
- 编辑器内按 `Cmd/Ctrl+Shift+F` 触发 `format()`；该快捷键始终被拦截（keymap handler 恒返回 `true`），即使当前语言无格式化能力也会吞掉按键。

## 样式定制

| 变量 | 写入方 | 用途 |
|------|--------|------|
| `--tx-code-editor-bg` | 解析后的 theme | 编辑器外壳和 CodeMirror 背景。 |
| `--tx-code-editor-border` | 解析后的 theme | 外壳边框和 toolbar 分隔线颜色。 |
| `--tx-code-editor-toolbar-bg` | 解析后的 theme | toolbar 背景。 |
| `--tx-code-editor-text` | 解析后的 theme | toolbar 文本颜色。 |
| `--tx-code-editor-focus` | 解析后的 theme | focus 边框和外环颜色。 |

优先使用 `theme` prop 选择受支持配色。只有宿主主题需要微调 CodeMirror 外壳时，才建议覆盖这些变量。

## 最佳实践

- 需要校验和格式化的可编辑配置界面优先使用 JSON 或 YAML。TOML/INI/JavaScript 模式只在高亮和基础编辑足够时使用。
- 用户编辑过程中可能保留半成品或非法语法时，不要启用 `formatOnBlur`。
- 生成内容和示例使用 `readOnly`，不要用禁用表单字段伪装代码展示。
- 使用 toolbar 提升可发现性，同时保留快捷键给熟练用户。
- 自定义 `extensions` 保持局部、明确。它们追加在内置扩展之后，可能改变编辑器内部整体行为。

## 审阅说明

- 已人工核对 `packages/tuffex/packages/components/src/code-editor/src/types.ts`、`TxCodeEditor.vue`、`TxCodeEditorRuntime.vue`、`TxCodeEditorToolbar.vue`、`code-editor.test.ts` 与 `code-editor-toolbar.test.ts`。
- API 标题已统一为共享的 `Props`、`Events`、`Slots`，再用子标题区分编辑器和 toolbar，方便覆盖检查与读者定位。
- 已按源码确认客户端动态 runtime、安全的挂载前 exposed-method fallback、JSON/YAML 格式化、TOML/INI 本地 stream parser、toolbar 默认动作与 disabled action guard。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/code-editor/__tests__/code-editor.test.ts` 覆盖更新事件、JSON/YAML 格式化和 TOML/INI 语言模式；`code-editor-toolbar.test.ts` 覆盖 toolbar action 派发。
- `format()` 对只读、语言不支持、输入非法、输出未变化或 runtime 未挂载等状态有意返回 `false`，而不是抛错。

## Source

- Component source: `packages/tuffex/packages/components/src/code-editor/src/TxCodeEditor.vue`
- Runtime source: `packages/tuffex/packages/components/src/code-editor/src/TxCodeEditorRuntime.vue`
- Toolbar source: `packages/tuffex/packages/components/src/code-editor/src/TxCodeEditorToolbar.vue`
- Types: `packages/tuffex/packages/components/src/code-editor/src/types.ts`
- Tests: `packages/tuffex/packages/components/src/code-editor/__tests__/code-editor.test.ts`, `packages/tuffex/packages/components/src/code-editor/__tests__/code-editor-toolbar.test.ts`

## 离线完整示例源码

- [CodeEditorCodeEditorDemo](../snapshot/apps/nexus/app/components/content/demos/CodeEditorCodeEditorDemo.vue.txt)
- [CodeEditorToolbarDemo](../snapshot/apps/nexus/app/components/content/demos/CodeEditorToolbarDemo.vue.txt)

## 离线类型与实现参考

- [code-editor/index.ts](../snapshot/packages/tuffex/packages/components/src/code-editor/index.ts.txt)
- [src/TxCodeEditor.vue](../snapshot/packages/tuffex/packages/components/src/code-editor/src/TxCodeEditor.vue.txt)
- [src/TxCodeEditorRuntime.vue](../snapshot/packages/tuffex/packages/components/src/code-editor/src/TxCodeEditorRuntime.vue.txt)
- [src/TxCodeEditorToolbar.vue](../snapshot/packages/tuffex/packages/components/src/code-editor/src/TxCodeEditorToolbar.vue.txt)
- [src/stream-parsers.ts](../snapshot/packages/tuffex/packages/components/src/code-editor/src/stream-parsers.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/code-editor/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
