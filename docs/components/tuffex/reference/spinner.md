# Spinner 加载

> 用于展示加载中的旋转指示器。通常作为更复杂 Loading 组件的基础。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/spinner) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/spinner.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/spinner.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Spinner 加载

## 基础用法

### Spinner
官方示例：`SpinnerSpinnerDemo`（完整源码见本页末尾）

```vue
<template>
  <TxSpinner />
</template>
```

## 尺寸

### Spinner sizes
官方示例：`SpinnerSpinnerSizesDemo`（完整源码见本页末尾）

```vue
<template>
  <div style="display: flex; gap: 12px; align-items: center;">
    <TxSpinner :size="12" />
    <TxSpinner :size="16" />
    <TxSpinner :size="24" />
    <TxSpinner :size="32" />
  </div>
</template>
```

## 显隐切换（v-if vs visible）

### Toggle
官方示例：`SpinnerToggleDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const showByIf = ref(true)
const visible = ref(true)
</script>

<template>
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start;">
    <div style="display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="font-weight: 600;">
          v-if (no built-in transition)
        </div>
        <TxButton size="small" @click="showByIf = !showByIf">
          Toggle
        </TxButton>
      </div>
      <div style="display: flex; align-items: center; gap: 10px; height: 28px;">
        <TxSpinner v-if="showByIf" />
        <span style="color: var(--tx-text-color-secondary);">Status: {{ showByIf ? 'mounted' : 'unmounted' }}</span>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="font-weight: 600;">
          :visible (built-in transition)
        </div>
        <TxButton size="small" @click="visible = !visible">
          Toggle
        </TxButton>
      </div>
      <div style="display: flex; align-items: center; gap: 10px; height: 28px;">
        <TxSpinner :visible="visible" />
        <span style="color: var(--tx-text-color-secondary);">Status: {{ visible ? 'mounted' : 'unmounted (after leave)' }}</span>
      </div>
    </div>
  </div>
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `size` | `number` | `16` | spinner 的宽高，单位 px；写入 `--tx-spinner-size`。 |
| `strokeWidth` | `number` | `2` | 环形线宽与 SVG fallback 线宽；写入 `--tx-spinner-stroke`。 |
| `fallback` | `boolean` | `false` | 使用 SVG fallback 旋转图形，而不是默认的 ball/ring 动效。 |
| `visible` | `boolean` | `true` | 通过内置 `tx-spinner-visibility` 过渡控制显示或隐藏。 |
| `label` | `string` | `'Loading'` | 状态区域的可访问名称，读屏在 spinner 出现时播报；本地化时覆盖此值。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| - | - | 没有组件自定义事件，通过 `visible` prop 控制显隐。 |

### Slots

| 插槽名 | Props | 说明 |
|------|-------|------|
| - | - | `TxSpinner` 没有插槽；需要状态文案时在 spinner 外部组合文本。 |

## 交互契约

- `visible=false` 时，离场过渡结束后不渲染 spinner。
- 可见根节点是 inline-flex `span`，带 `aria-busy="true"` 与 `aria-live="polite"`。
- 默认模式渲染 ball/ring 动效；`fallback=true` 渲染 SVG circle，并复用 `size` 与 `strokeWidth`。
- 组件根节点默认使用次要文本色（`--tx-text-color-secondary`）；如需着色，请直接在 `TxSpinner` 元素上设置 `color`（父级的 `color` 不会穿透根节点自身的声明）。

## 后台行内等待

`TxSpinner` 用于按钮、行内状态或遮罩内部的短等待。已知进度请优先使用 `TxProgressBar`；整块首屏加载请使用 `TxLoadingState`；只有在等待时间短且不需要百分比时使用 Spinner。

官方示例：`ComponentsFeedbackTaskCenterDemo`（完整源码见本页末尾）

```vue
<template>
  <span class="inline-flex items-center gap-2">
    <TxSpinner :size="14" />
    行内等待
  </span>
</template>
```

## 最佳实践

- Spinner 只表达不确定等待；一旦有数值或阶段进度，切换为 `TxProgressBar`。
- 行内 spinner 要把文案放在图标旁边；spinner 自身只表达 busy，不表达完成结果。
- 需要内置进出场过渡时使用 `visible`；挂载时机由宿主管理时再使用 `v-if`。
- 只有在 CSS ball 动效不适合受限表面时才使用 `fallback=true`。

## 审阅说明

- **可访问性说明:** 可见根节点带 `aria-busy="true"` 与 `aria-live="polite"`，但 spinner 本身没有可读标签或完成播报。超过瞬时行内等待时，需要在旁边组合状态文案。
- **实测覆盖:** `spinner.test.ts` 覆盖默认可访问性属性、默认与 SVG fallback 分支、`size`/`strokeWidth` 的 CSS 变量映射，以及 `visible=false` 时不渲染。

## Source

- Component source: `packages/tuffex/packages/components/src/spinner/src/TxSpinner.vue`。
- Types: `packages/tuffex/packages/components/src/spinner/src/types.ts` 导出 `SpinnerProps`。
- Export alias: `packages/tuffex/packages/components/src/spinner/index.ts` 导出 `Spinner`、`TxSpinner`、`SpinnerProps` 与 `TxSpinnerInstance`。
- Coverage: `packages/tuffex/packages/components/src/spinner/__tests__/spinner.test.ts` 覆盖渲染分支与 prop 驱动的 CSS 变量。

## 离线完整示例源码

- [SpinnerSpinnerDemo](../snapshot/apps/nexus/app/components/content/demos/SpinnerSpinnerDemo.vue.txt)
- [SpinnerSpinnerSizesDemo](../snapshot/apps/nexus/app/components/content/demos/SpinnerSpinnerSizesDemo.vue.txt)
- [SpinnerToggleDemo](../snapshot/apps/nexus/app/components/content/demos/SpinnerToggleDemo.vue.txt)
- [ComponentsFeedbackTaskCenterDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsFeedbackTaskCenterDemo.vue.txt)

## 离线类型与实现参考

- [spinner/index.ts](../snapshot/packages/tuffex/packages/components/src/spinner/index.ts.txt)
- [src/TxSpinner.vue](../snapshot/packages/tuffex/packages/components/src/spinner/src/TxSpinner.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/spinner/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
