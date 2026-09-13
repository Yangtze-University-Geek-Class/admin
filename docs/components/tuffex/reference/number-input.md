# NumberInput

> 带步进控制、范围限制与精度归一化的数字输入。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/number-input) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/number-input.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/number-input.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# NumberInput

## 基础用法

### NumberInput
官方示例：`NumberInputNumberInputDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const percentage = ref(35)
</script>

<template>
  <TxNumberInput v-model="percentage" :min="0" :max="100" :step="5" :precision="0" />
</template>
```

## 交互契约

- 空输入会归一化为 `null`。
- 非有限数字会回退到上一个值；没有上一个值时回退为 `null`。
- `min` / `max` 会限制手输值和步进按钮结果。
- `precision` 会在范围限制后执行 `Number(value.toFixed(precision))`。
- `controls=false` 隐藏两个步进按钮，但保留原生数字输入。
- `readonly` 与 `disabled` 都会阻止步进按钮；`disabled` 还会禁用输入框。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `modelValue` / `v-model` | `number \| null` | `null` | 当前数字值。 |
| `min` | `number` | - | 最小值。 |
| `max` | `number` | - | 最大值。 |
| `step` | `number` | `1` | 步进按钮和原生输入使用的步长。 |
| `precision` | `number` | - | 归一化后的保留小数位。 |
| `placeholder` | `string` | `''` | 原生输入占位文本。 |
| `disabled` | `boolean` | `false` | 禁用输入和按钮。 |
| `readonly` | `boolean` | `false` | 输入只读并阻止步进。 |
| `controls` | `boolean` | `true` | 是否显示减少/增加按钮。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `update:modelValue` | `(value: number \| null)` | 归一化后的 v-model 更新。 |
| `change` | `(value: number \| null)` | 发送同一个归一化值。 |
| `focus` | `(event: FocusEvent)` | 原生 focus 事件。 |
| `blur` | `(event: FocusEvent)` | 原生 blur 事件，并再次归一化字段。 |

### Exposed Methods

| 方法 | 说明 |
|------|------|
| `focus()` | 聚焦原生输入。 |
| `blur()` | 让原生输入失焦。 |
| `inputRef` | 原生输入 ref。 |

## Slots

`TxNumberInput` 不暴露插槽。标签、前后缀、辅助说明和校验文案应通过相邻表单结构或外层布局完成。

## 最佳实践

- 百分比、配额、分页控制建议明确传入 `min`、`max` 与 `step`。
- 小数场景使用 `precision`，不要在消费端每次事件后重复四舍五入。
- 表格筛选等高密度区域可以隐藏 controls，让键盘输入更快。
- 在表单校验和 API 映射中，把 `null` 当作未设置状态。

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/number-input/src/TxNumberInput.vue` 确认归一化、范围限制、精度处理、attrs 透传、步进控制、焦点状态和暴露方法。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/number-input/__tests__/number-input.test.ts` 覆盖数字 attrs、归一化输入、范围限制步进、隐藏 controls 和 focus helper 暴露。
- 导出入口:`packages/tuffex/packages/components/src/number-input/index.ts` 使用 `withInstall` 包装组件并导出 `TxNumberInputInstance`。

## Source

## 离线完整示例源码

- [NumberInputNumberInputDemo](../snapshot/apps/nexus/app/components/content/demos/NumberInputNumberInputDemo.vue.txt)

## 离线类型与实现参考

- [number-input/index.ts](../snapshot/packages/tuffex/packages/components/src/number-input/index.ts.txt)
- [src/TxNumberInput.vue](../snapshot/packages/tuffex/packages/components/src/number-input/src/TxNumberInput.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
