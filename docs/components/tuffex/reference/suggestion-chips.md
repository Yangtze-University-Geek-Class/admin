# Suggestion Chips

> 横向排列的提问建议胶囊，供用户一键发起后续对话。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/suggestion-chips) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/suggestion-chips.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/suggestion-chips.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Suggestion Chips

## 基础用法

### Suggestion Chips
官方示例：`SuggestionChipsSuggestionChipsDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const suggestions = ref([
  { id: 'explain', text: '解释这段代码' },
  { id: 'test', text: '补充单元测试' },
  { id: 'perf', text: '还有优化空间吗？' },
])

function handleSelect(suggestion: { id: string, text: string }) {
  console.log(suggestion.id)
}
</script>

<template>
  <TxSuggestionChips :suggestions="suggestions" @select="handleSelect" />
</template>
```

### 纵向追问列表

`layout="list"` 把胶囊改成带分隔线的纵向行，行首是一枚回车折返箭头，逐行错峰浮现。这是答案定稿后收尾的形态：追问是一份可以读完的清单，而不是一条需要横向拖动的轨道。

官方示例：`AiSuiteStreamingAnswerDemo`（完整源码见本页末尾）

```vue
<template>
  <p class="text-[12px] font-medium">追问</p>
  <TxSuggestionChips :suggestions="followUps" layout="list" @select="ask" />
</template>
```

## 交互契约

- `layout="list"` 只改版式，不改数据与事件：`select` 仍然携带完整建议对象。
- 列表形态下每行按位置错峰入场（每行 90ms）；减弱动效下入场直接关闭，行本身照常显示。
- 行分隔线画在每行的下边框上，包括最后一行——这是上游的观感，与截图一致。
- `suggestions` 为空数组时整个组件不渲染，无需在外层再包一层 `v-if`。
- 每个胶囊以 `suggestion.id` 作为 `key`，请保证同一组内 `id` 唯一。
- 点击派发 `select`，参数是被点中的完整建议对象，而不是索引或 id。
- 组件不维护选中态，也不会在点击后移除建议；是否清空由消费方决定。
- 容器溢出时可横向滚动，滚动条被隐藏，两侧用渐变遮罩提示可滚动。
- 容器为 `role="list"`，胶囊为 `role="listitem"`：这会覆盖 `<button>` 的隐式语义，屏幕阅读器将其读作列表项而非按钮。若需要按钮语义，请在外层补充说明文本。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `suggestions` | `AiSuggestion[]` | — | 建议列表；`AiSuggestion` 为 `{ id: string, text: string }`。必填。 |
| `layout` | `'wrap' \| 'list'` | `'wrap'` | `list` 改为带分隔线与折返箭头的纵向行。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `select` | `(suggestion: AiSuggestion)` | 点击某个胶囊时派发，携带该建议对象。 |

## Slots

`TxSuggestionChips` 不暴露插槽。胶囊文案取自 `suggestion.text`，需要富文本时请改用自定义实现。

## 最佳实践

- 一次给出 3~5 条建议；超出屏宽虽可滚动，但被折叠的选项实际很少被点到。
- 文案写成用户会说的话（「补充单元测试」），而不是功能名（「测试生成」）。
- 点击后通常应清空或替换建议列表，避免用户重复发送同一条。
- `id` 用稳定标识而非文案本身，便于埋点统计与后续去重。

## 离线完整示例源码

- [SuggestionChipsSuggestionChipsDemo](../snapshot/apps/nexus/app/components/content/demos/SuggestionChipsSuggestionChipsDemo.vue.txt)
- [AiSuiteStreamingAnswerDemo](../snapshot/apps/nexus/app/components/content/demos/AiSuiteStreamingAnswerDemo.vue.txt)

## 离线类型与实现参考

- [suggestion-chips/index.ts](../snapshot/packages/tuffex/packages/components/src/suggestion-chips/index.ts.txt)
- [src/TxSuggestionChips.vue](../snapshot/packages/tuffex/packages/components/src/suggestion-chips/src/TxSuggestionChips.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
