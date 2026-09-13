# SearchSelect 搜索选择器

> 搜索选择器本质上是一个可搜索的 Select：输入时展开下拉面板，展示结果，点击结果项回填并关闭。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/search-select) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/search-select.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/search-select.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# SearchSelect 搜索选择器

## 基础用法

### SearchSelect
官方示例：`SearchSelectSearchSelectDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const value = ref<string | number>('')

const options = [
  { value: 'foo', label: 'Foo' },
  { value: 'bar', label: 'Bar' },
  { value: 'baz', label: 'Baz' },
  { value: 'disabled', label: 'Disabled', disabled: true },
]
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 10px; width: 320px;">
    <TxSearchSelect v-model="value" :options="options" placeholder="Search and pick" />
    <div style="font-size: 12px; color: var(--tx-text-color-secondary, #909399);">
      Value: {{ value }}
    </div>
  </div>
</template>
```

## 远程搜索

`remote=true` 时，将在输入变化（防抖）与 Enter 时触发 `search` 事件，你需要外部请求并将结果写回 `options`。

### SearchSelect (remote)
官方示例：`SearchSelectSearchSelectRemoteDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const value = ref<string | number>('')
const query = ref('')
const loading = ref(false)

const options = ref<Array<{ value: string, label: string }>>([])

async function onSearch(q: string) {
  query.value = q
  loading.value = true
  await new Promise(resolve => setTimeout(resolve, 220))

  const base = Array.from({ length: 18 }).map((_, i) => `Result ${i + 1}`)
  const list = base
    .filter(s => s.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 12)

  options.value = list.map(s => ({ value: s, label: s }))
  loading.value = false
}
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 10px; width: 320px;">
    <TxSearchSelect
      v-model="value"
      remote
      :loading="loading"
      :options="options"
      placeholder="Type to remote-search"
      @search="onSearch"
    />

    <div style="font-size: 12px; color: var(--tx-text-color-secondary, #909399);">
      Query: {{ query || '-' }}
    </div>
  </div>
</template>
```

## 注意事项

- 本地模式会基于 `options` 的 `label` 进行过滤，输入为空时显示全部。
- 远程模式需要在 `search` 事件中自行更新 `options`，组件不会缓存结果。
- 下拉关闭后会保留输入与面板内部状态，重新打开不会自动重置。

## 后台筛选工具栏

在 Dashboard 列表筛选中，`TxSearchSelect` 适合承载范围、类型、状态等结构化筛选；关键词仍交给 `TxSearchInput`，无结果恢复交给 `TxSearchEmpty`。

官方示例：`ComponentsSearchFiltersDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'

const query = ref('')
const selectedScope = ref<string | number>('all')
const scopeOptions = [
  { value: 'all', label: '全部' },
  { value: 'docs', label: '文档' },
  { value: 'tasks', label: '任务' },
]
const filteredRecords = computed(() => (query.value ? [] : scopeOptions))
</script>

<template>
  <section class="grid gap-3">
    <TxSearchInput v-model="query" placeholder="搜索插件 / 文档 / 任务" remote />
    <TxSearchSelect
      v-model="selectedScope"
      :options="scopeOptions"
      placeholder="筛选范围"
      panel-background="glass"
    />
    <TxSearchEmpty v-if="!filteredRecords.length" surface="card" />
  </section>
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `modelValue` | `string \| number` | `''` | 选中值（v-model） |
| `placeholder` | `string` | `'Search'` | 透传给搜索输入框的占位文本。 |
| `disabled` | `boolean` | `false` | 禁用输入框、弹层与聚焦展开，并停止发出远程 `search`。 |
| `clearable` | `boolean` | `true` | 显示输入框清除按钮，允许清空已选值。 |
| `options` | `TxSearchSelectOption[]` | `[]` | 下拉数据源 |
| `loading` | `boolean` | `false` | 在输入框后缀显示小号加载指示器，用于远程结果等待。 |
| `remote` | `boolean` | `false` | 是否远程搜索（输入触发 `search`） |
| `searchDebounce` | `number` | `200` | 远程搜索防抖（ms） |
| `dropdownMaxHeight` | `number` | `280` | 选项面板最大高度（px），超出后面板内部滚动。 |
| `dropdownOffset` | `number` | `6` | 下拉偏移 |
| `panelVariant` | `'solid' \| 'dashed' \| 'plain'` | `'solid'` | 面板边框形态（TxCard variant） |
| `panelBackground` | `'pure' \| 'mask' \| 'blur' \| 'glass' \| 'refraction'` | `'refraction'` | 面板背景（TxCard background） |
| `panelShadow` | `'none' \| 'soft' \| 'medium'` | `'soft'` | 面板阴影（TxCard shadow） |
| `panelRadius` | `number` | `18` | 面板圆角（TxCard radius） |
| `panelPadding` | `number` | `6` | 面板 padding（TxCard padding） |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `update:modelValue` | `(v: string \| number)` | v-model 更新 |
| `change` | `(v: string \| number)` | 选中变更 |
| `search` | `(q: string)` | 远程搜索 |
| `select` | `(opt: TxSearchSelectOption)` | 选择某一项 |
| `open` | - | 打开下拉 |
| `close` | - | 关闭下拉 |

### Types

```ts
export interface TxSearchSelectOption {
  value: string | number
  label: string
  disabled?: boolean
}
```

### 插槽

`TxSearchSelect` 不暴露公共插槽。输入框前缀、loading 后缀、空态和选项行都由组件内部控制，以保持键盘与 Popover 行为一致。

### 暴露方法

| 名称 | 类型 | 说明 |
|------|------|------|
| `open()` | `() => void` | 未禁用时打开选项面板。 |
| `close()` | `() => void` | 关闭选项面板。 |
| `focus()` | `() => void` | 聚焦内部 `TxInput`。 |
| `blur()` | `() => void` | 让内部 `TxInput` 失焦。 |
| `clear()` | `() => void` | 调用内部输入框清空能力。 |

## 最佳实践

- 本地模式只放小型 `options`；大型远程数据源应使用 `remote`、`searchDebounce`，并由外部写回结果。
- `label` 需要稳定且对用户可读，因为本地过滤只匹配 `option.label`。
- 如果不是从受控选项列表中选择值，不要把自由关键词搜索塞进这里；请使用 `TxSearchInput`。
- 禁用项只适合作为解释性条目；它们会展示但不可选择，不应成为唯一可用结果。

## 审阅说明

- 源码：`packages/tuffex/packages/components/src/search-select/src/TxSearchSelect.vue`
- 建议：本地小列表直接传 `options`；远程数据源使用 `remote` + `search` 事件，并由外部写回 `options`。
- 交互：禁用项会展示但不可选择；清空会同步发出 `update:modelValue` 和 `change` 的空值。
- 浮层：面板由 `TxPopover` 承载，使用 `panelBackground`、`panelShadow`、`panelRadius` 与页面表面层级对齐。


## Source

- Component source: `packages/tuffex/packages/components/src/search-select/src/TxSearchSelect.vue`.
- Types: `packages/tuffex/packages/components/src/search-select/src/types.ts`.
- **实测覆盖:** `packages/tuffex/packages/components/src/search-select/__tests__/search-select.test.ts` 验证本地过滤并选择选项、防抖远程 search 事件，以及无匹配结果时的空态渲染。

## 离线完整示例源码

- [SearchSelectSearchSelectDemo](../snapshot/apps/nexus/app/components/content/demos/SearchSelectSearchSelectDemo.vue.txt)
- [SearchSelectSearchSelectRemoteDemo](../snapshot/apps/nexus/app/components/content/demos/SearchSelectSearchSelectRemoteDemo.vue.txt)
- [ComponentsSearchFiltersDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsSearchFiltersDemo.vue.txt)

## 离线类型与实现参考

- [search-select/index.ts](../snapshot/packages/tuffex/packages/components/src/search-select/index.ts.txt)
- [src/TxSearchSelect.vue](../snapshot/packages/tuffex/packages/components/src/search-select/src/TxSearchSelect.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/search-select/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
