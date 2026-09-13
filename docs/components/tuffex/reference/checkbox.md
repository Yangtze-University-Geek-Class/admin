# Checkbox 复选框

> 用于布尔选择的复选框组件，支持键盘切换、可访问性标签、填充态和 SVG 勾选变体。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/checkbox) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/checkbox.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/checkbox.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Checkbox 复选框

## 基础用法

点击复选框或文案即可切换状态，选中态会跟随视觉变体播放填充或勾选动画。

### Checkbox
官方示例：`CheckboxCheckboxDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const checked = ref(false)
</script>

<template>
  <TxCheckbox v-model="checked" label="选项" />
</template>
```

## 样式变体

默认 `checkmark` 会显示内部勾选标记；需要更收敛的纯填充样式时，可使用 `variant="fill"`。

### Checkbox variants
官方示例：`CheckboxCheckboxVariantsDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const fillChecked = ref(true)
const checkmarkChecked = ref(true)
</script>

<template>
  <div style="display: inline-flex; align-items: center; gap: 18px;">
    <TxCheckbox v-model="fillChecked" variant="fill" label="填充样式" />
    <TxCheckbox v-model="checkmarkChecked" variant="checkmark" label="带勾选标记" />
  </div>
</template>
```

## 文案在前

通过 `label-placement="start"` 将标签放到勾选框左侧，适合“状态文本 + 控件”的紧凑布局。

### Checkbox (label start)
官方示例：`CheckboxCheckboxLabelStartDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const checked = ref(true)
</script>

<template>
  <TxCheckbox v-model="checked" label="我在前面" label-placement="start" />
</template>
```

## 无文案

无 `label` / 无默认插槽时，必须提供 `aria-label`，保证屏幕阅读器能识别控件含义。

### Checkbox (no label)
官方示例：`CheckboxCheckboxNoLabelDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const checked = ref(false)
</script>

<template>
  <TxCheckbox v-model="checked" aria-label="勾选" />
</template>
```

## 禁用状态

`disabled` 会移除可聚焦能力，并阻止点击与键盘切换；禁用态仍会保留当前选中状态。

### Checkbox (disabled)
官方示例：`CheckboxCheckboxDisabledDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const disabledUnchecked = ref(false)
const disabledChecked = ref(true)
</script>

<template>
  <div style="display: inline-flex; align-items: center; gap: 18px;">
    <TxCheckbox v-model="disabledUnchecked" label="禁用" disabled />
    <TxCheckbox v-model="disabledChecked" label="禁用且已选中" disabled />
  </div>
</template>
```

## 加载状态

`loading` 用于选中状态需要等待服务端确认的场景：方框变成旋转环，勾选标记、横杠与填充一起让位，改由环的颜色表示状态——未选中是中性灰，已选中与部分选中都是主色——同时阻止点击与键盘切换。

### Checkbox (loading)
官方示例：`CheckboxCheckboxLoadingDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const asyncChecked = ref(false)
const committing = ref(false)
const loadingUnchecked = ref(false)
const loadingChecked = ref(true)
const loadingMixed = ref(false)

function commit(next: boolean) {
  committing.value = true
  setTimeout(() => {
    asyncChecked.value = next
    committing.value = false
  }, 1200)
}
</script>

<template>
  <div style="display: inline-flex; align-items: center; gap: 18px;">
    <TxCheckbox :model-value="asyncChecked" :loading="committing" label="异步提交" @change="commit" />
    <TxCheckbox v-model="loadingUnchecked" label="加载中 / 未选中" loading />
    <TxCheckbox v-model="loadingChecked" label="加载中 / 已选中" loading />
    <TxCheckbox v-model="loadingMixed" label="加载中 / 部分选中" indeterminate loading />
  </div>
</template>
```

## 使用插槽

默认插槽会替代 `label` 作为可见标签，适合加入说明文本、图标或强调样式。

### Checkbox (slot)
官方示例：`CheckboxCheckboxSlotDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const checked = ref(false)
</script>

<template>
  <TxCheckbox v-model="checked">
    <span>自定义标签</span>
  </TxCheckbox>
</template>
```

## API

### Props

| 属性名 | 说明 | 类型 | 默认值 |
|--------|------|------|--------|
| modelValue / v-model | 绑定的选中状态。启用时通过点击、Enter 或 Space 更新。 | `boolean` | `false` |
| disabled | 是否禁用。禁用后不可聚焦，且不会触发切换。 | `boolean` | `false` |
| loading | 异步提交中：方框变为旋转环，添加 `is-loading` 与 `aria-busy="true"`，并像 `disabled` 一样阻止切换，但不套用禁用态配色。 | `boolean` | `false` |
| label | 显示在复选框旁边的文本标签。 | `string` | - |
| labelPlacement | 标签位置：`start` 为前置，`end` 为后置。 | `'start' \| 'end'` | `'end'` |
| variant | 视觉变体：`fill` 为纯填充，`checkmark` 为内部勾选标记。 | `'checkmark' \| 'fill'` | `'checkmark'` |
| ariaLabel | 无可见 `label` / 默认插槽时使用的可访问性标签。 | `string` | - |
| indeterminate | 部分选中：所辖项目选中了一部分但不是全部。渲染横杠并上报 `aria-checked="mixed"`；此时点击会解析为「全选」而不是翻转布尔值，与原生 `indeterminate` 行为一致。 | `boolean` | `false` |

### Events

| 事件名 | 说明 | 回调参数 |
|--------|------|----------|
| update:modelValue | 用户切换后触发的 v-model 更新事件。 | `(value: boolean) => void` |
| change | 用户切换后触发的状态变更事件。 | `(value: boolean) => void` |

### Slots

| 插槽名 | 说明 |
|--------|------|
| default | 自定义可见标签内容；存在时会替代 `label` 展示。 |

## 最佳实践

- 优先提供可见 `label` 或默认插槽。只有图标式/无可见文案控件才使用 `ariaLabel`。
- 用 `disabled` 作为禁用状态的唯一来源；禁用后组件会退出 Tab 顺序，也不会触发 `update:modelValue` 或 `change`。
- `loading` 与 `disabled` 表达不同含义：前者是「正在提交」，后者是「不可用」。用 `disabled` 表示忙碌会让控件看起来永久不可点。
- `loading` 期间不要抢先写回 `modelValue`；让方框停在旧值上，提交成功后再更新，失败则直接撤下 loading，状态自然回到原位。
- 紧凑设置行中需要“文案在前、控件在后”时使用 `labelPlacement="start"`。


## 审阅说明

- 已核对 `packages/tuffex/packages/components/src/checkbox/src/TxCheckbox.vue` 与 `checkbox.test.ts`。
- **加载契约:** `loading` 是纯视觉与阻断状态，组件不持有异步逻辑。环的颜色仍由 `modelValue` / `indeterminate` 决定，因此它停在旧值上，表示这一次切换尚未落地。
- **加载态的已知取舍:** 已选中与部分选中在加载期间外观一致（同为主色环），这一差异由 `aria-checked="mixed"` 承担。曾试过「保留填充 + 白色环」以区分两者，但白环压在浅色页面上几乎不可见，因此改为环着色方案。
- 可访问性说明:根节点负责 `role="checkbox"`、`aria-checked` 与键盘处理;应优先提供可见标签或默认插槽,仅在没有可见文案时使用 `ariaLabel`。
- **动效降级:** 环形指示器在 `prefers-reduced-motion: reduce` 下停止旋转；缺口边框本身是静态字形，提示不会消失。
- **实测覆盖:** `checkbox.test.ts` 覆盖标签渲染、`aria-label` 回退、标签位置、默认 `checkmark` 变体与显式 `fill` / `checkmark` 变体、点击事件、禁用阻断，以及加载中阻断、`is-loading` 与 `is-disabled` 分离、部分选中在加载时仍上报 `mixed`、`aria-busy` 的出现与消失。

## Source

- Component source: `packages/tuffex/packages/components/src/checkbox/src/TxCheckbox.vue`。
- Export alias: `packages/tuffex/packages/components/src/checkbox/index.ts` 同时导出 `TuffCheckbox` 与 `TxCheckbox`。
- Coverage: `packages/tuffex/packages/components/src/checkbox/__tests__/checkbox.test.ts` 覆盖点击切换、ARIA 标签、插槽优先级、变体 class 与禁用阻断；键盘激活由原生 `<button>` 元素继承。

## 离线完整示例源码

- [CheckboxCheckboxDemo](../snapshot/apps/nexus/app/components/content/demos/CheckboxCheckboxDemo.vue.txt)
- [CheckboxCheckboxVariantsDemo](../snapshot/apps/nexus/app/components/content/demos/CheckboxCheckboxVariantsDemo.vue.txt)
- [CheckboxCheckboxLabelStartDemo](../snapshot/apps/nexus/app/components/content/demos/CheckboxCheckboxLabelStartDemo.vue.txt)
- [CheckboxCheckboxNoLabelDemo](../snapshot/apps/nexus/app/components/content/demos/CheckboxCheckboxNoLabelDemo.vue.txt)
- [CheckboxCheckboxDisabledDemo](../snapshot/apps/nexus/app/components/content/demos/CheckboxCheckboxDisabledDemo.vue.txt)
- [CheckboxCheckboxLoadingDemo](../snapshot/apps/nexus/app/components/content/demos/CheckboxCheckboxLoadingDemo.vue.txt)
- [CheckboxCheckboxSlotDemo](../snapshot/apps/nexus/app/components/content/demos/CheckboxCheckboxSlotDemo.vue.txt)

## 离线类型与实现参考

- [checkbox/index.ts](../snapshot/packages/tuffex/packages/components/src/checkbox/index.ts.txt)
- [src/TxCheckbox.vue](../snapshot/packages/tuffex/packages/components/src/checkbox/src/TxCheckbox.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
