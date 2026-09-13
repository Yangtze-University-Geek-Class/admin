# Rating 评分

> 星级评分输入

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/rating) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/rating.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/rating.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Rating 评分

## 基础用法

### 半星评分

支持 `precision="0.5"` 半星评分。半星会从左侧填充。

官方示例：`RatingBasicDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const score = ref(3.5)
</script>

<template>
  <TxRating v-model="score" :precision="0.5" show-text />
</template>
```

## 样式定制

通过 `filled-color`、`empty-color`、`hover-color`、`text-color`、`size` 与 `gap` 调整视觉样式。下面包含橙色、绿色只读与紫色紧凑三种外观。

官方示例：`RatingStyleDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const warmScore = ref(4)
const greenScore = ref(3.5)
const violetScore = ref(2.5)
</script>

<template>
  <!-- Orange / large -->
  <TxRating
    v-model="warmScore"
    :size="30"
    :gap="8"
    :precision="0.5"
    filled-color="#f97316"
    empty-color="rgba(249, 115, 22, 0.2)"
    hover-color="#fb923c"
    text-color="#f97316"
    show-text
  />

  <!-- Green / readonly with a custom #text slot -->
  <TxRating
    v-model="greenScore"
    :size="22"
    :gap="5"
    :precision="0.5"
    readonly
    show-text
    filled-color="#22c55e"
    empty-color="rgba(34, 197, 94, 0.18)"
    text-color="#22c55e"
  >
    <template #text="{ value, max }">
      {{ value }} / {{ max }} readonly
    </template>
  </TxRating>

  <!-- Violet / compact -->
  <TxRating
    v-model="violetScore"
    :precision="0.5"
    :size="18"
    filled-color="#a78bfa"
    empty-color="rgba(167, 139, 250, 0.2)"
    hover-color="#c4b5fd"
    text-color="#a78bfa"
    show-text
  />
</template>
```

## 自定义图标

`icon` 可以统一设置图标；也可以分别使用 `filled-icon`、`empty-icon`、`half-icon` 控制填充、空态与半星图标。支持内置图标、Iconify class 与 emoji，包括爱心、钻石和表情等。

官方示例：`RatingIconDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const diamond = ref(3)
const hearts = ref(4.5)
const faces = ref(2.5)
</script>

<template>
  <!-- Single emoji icon -->
  <TxRating
    v-model="diamond"
    icon="💎"
    :size="26"
    filled-color="#38bdf8"
    empty-color="rgba(56, 189, 248, 0.2)"
    hover-color="#7dd3fc"
    text-color="#38bdf8"
    show-text
  />

  <!-- Iconify class icon -->
  <TxRating
    v-model="hearts"
    :precision="0.5"
    :size="28"
    icon="i-carbon-favorite-filled"
    filled-color="#f43f5e"
    empty-color="rgba(244, 63, 94, 0.18)"
    hover-color="#fb7185"
    text-color="#f43f5e"
    show-text
  />

  <!-- Separate filled / empty icons -->
  <TxRating
    v-model="faces"
    :precision="0.5"
    :size="26"
    filled-icon="😍"
    empty-icon="😶"
    filled-color="#f59e0b"
    empty-color="rgba(148, 163, 184, 0.5)"
    hover-color="#fbbf24"
    text-color="#f59e0b"
    show-text
  />
</template>
```

## 点击动画

默认点击星级会触发更明显的 bounce + glow + ripple 动画；通过 `:animated="false"` 关闭。

官方示例：`RatingAnimationDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const animated = ref(2)
const heart = ref(3)
const still = ref(2)
</script>

<template>
  <!-- Default bounce + glow + ripple -->
  <TxRating v-model="animated" :precision="0.5" :size="28" :gap="6" show-text />

  <!-- Heart pop -->
  <TxRating
    v-model="heart"
    icon="i-carbon-favorite-filled"
    :size="30"
    :gap="7"
    filled-color="#f43f5e"
    empty-color="rgba(244, 63, 94, 0.18)"
    hover-color="#fb7185"
    text-color="#f43f5e"
    show-text
  />

  <!-- Animation off -->
  <TxRating v-model="still" :animated="false" filled-color="#a78bfa" show-text />
</template>
```

## 交互契约

Rating 会将星级组暴露为 radio group。`disabled` 与 `readonly` 都会阻止评分更新；`readonly` 是只展示模式，会移除星级按钮交互入口但保留评分展示。

## API

### Props
```yaml
rows:
  - name: modelValue
    type: number
    default: '0'
    description: 通过 `v-model` 传入的当前评分。
  - name: maxStars
    type: number
    default: '5'
    description: 渲染的星级按钮数量。
  - name: precision
    type: "number | 0.5"
    default: '1'
    description: 步进精度。`0.5` 启用半星切换；其它 number 主要影响分数文本精度。
  - name: showText
    type: boolean
    default: 'false'
    description: 显示分数文本
  - name: disabled
    type: boolean
    default: 'false'
    description: 禁用星级按钮，并在根节点标记 aria-disabled。
  - name: readonly
    type: boolean
    default: 'false'
    description: 只展示模式。星级按钮禁用，根节点标记 aria-readonly。
  - name: icon
    type: "string | TxIconSource"
    default: '-'
    description: 统一设置填充层和空态层图标；状态图标未设置时使用它。
  - name: filledIcon
    type: "string | TxIconSource"
    default: 'star'
    description: 已填充图标。未设置时回退到 `icon`，再回退到 `star`。
  - name: emptyIcon
    type: "string | TxIconSource"
    default: 'star'
    description: 空态图标。未设置时回退到 `icon`，再回退到 `star`。
  - name: halfIcon
    type: "string | TxIconSource"
    default: '-'
    description: 半星图标。未设置时使用左侧裁切填充层。
  - name: filledColor
    type: string
    default: '#fbbf24'
    description: 已填充图标颜色；CSS fallback 为 `#fbbf24`。
  - name: emptyColor
    type: string
    default: '#d1d5db'
    description: 空态图标颜色；CSS fallback 为 `#d1d5db`。
  - name: hoverColor
    type: string
    default: 'filledColor'
    description: 填充层悬停颜色；回退到 `filledColor` / `#fbbf24`。
  - name: textColor
    type: string
    default: '#6b7280'
    description: 分数文本颜色；CSS fallback 为 `#6b7280`。
  - name: size
    type: "number | string"
    default: '20px'
    description: 星级图标大小。number 会转换为 px；CSS fallback 为 `20px`。
  - name: gap
    type: "number | string"
    default: '2px'
    description: 星级间距。number 会转换为 px；CSS fallback 为 `2px`。
  - name: animated
    type: boolean
    default: 'true'
    description: 选择后是否播放点击 pop / ripple 动画。
  - name: starLabel
    type: "(star: number) => string"
    default: '-'
    description: 每个星级按钮的可本地化无障碍标签，默认英文 "Rate N star(s)"。
```

### Events

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `update:modelValue` | `(value: number)` | 可交互星级点击后，带下一评分值 emit。 |
| `change` | `(value: number)` | 与 `update:modelValue` 同步触发，供 change handler 消费。 |

### Slots

| 插槽名 | 参数 | 说明 |
|--------|------|------|
| `text` | `{ value: number, max: number }` | `showText` 为 true 时，替换默认 `value / max` 文本。 |

## 最佳实践

- 只有半步反馈有业务意义时才使用 `precision="0.5"`。是否满意或粗略信心值用整星更易扫读。
- 不可输入时使用 `disabled`；展示历史评分时使用 `readonly`。两者都会阻止更新，但表达的意图不同。
- 精确数值重要时打开 `showText` 或提供自定义 `#text` 插槽，尤其是半星值。
- 只有图标集对比清晰时才分别设置 `filledIcon` / `emptyIcon` / `halfIcon`；否则使用统一 `icon` 并通过颜色区分状态。
- 密集表单、表格或对动效敏感的上下文里关闭 `animated`，避免点击 pop 动效干扰录入节奏。

## 审阅说明

- 已对照 `packages/tuffex/packages/components/src/rating/src/types.ts`、`TxRating.vue` 与 `rating.test.ts` 核对。
- 现有测试覆盖半星裁切、整星与半星重选、model/change 事件、readonly/disabled 阻断、自定义颜色/图标/尺寸、关闭动画、radio 语义和 `text` 插槽参数。
- API 说明：`precision="0.5"` 会在点击当前选中的整星时启用半星切换；其它数值 precision 主要影响评分文本精度。
- 可访问性说明：星级行是 radio group。展示历史评分用 `readonly`，不可输入状态用 `disabled`。

## Source

- Component source: `packages/tuffex/packages/components/src/rating/src/TxRating.vue`.
- Types: `packages/tuffex/packages/components/src/rating/src/types.ts` exports `RatingProps`, `RatingEmits`, and `RatingIcon`.
- **实测覆盖:** `packages/tuffex/packages/components/src/rating/__tests__/rating.test.ts` 验证半星裁切、model/change 事件、半星重选、readonly/disabled 阻断、自定义样式与图标、关闭动画、radio 语义及 `text` slot 参数。

## 离线完整示例源码

- [RatingBasicDemo](../snapshot/apps/nexus/app/components/content/demos/RatingBasicDemo.vue.txt)
- [RatingStyleDemo](../snapshot/apps/nexus/app/components/content/demos/RatingStyleDemo.vue.txt)
- [RatingIconDemo](../snapshot/apps/nexus/app/components/content/demos/RatingIconDemo.vue.txt)
- [RatingAnimationDemo](../snapshot/apps/nexus/app/components/content/demos/RatingAnimationDemo.vue.txt)

## 离线类型与实现参考

- [rating/index.ts](../snapshot/packages/tuffex/packages/components/src/rating/index.ts.txt)
- [src/TxRating.vue](../snapshot/packages/tuffex/packages/components/src/rating/src/TxRating.vue.txt)
- [src/index.ts](../snapshot/packages/tuffex/packages/components/src/rating/src/index.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/rating/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
