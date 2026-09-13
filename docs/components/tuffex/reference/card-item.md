# CardItem 卡片项

> 紧凑列表行，支持可选头像媒体、文本、右侧操作、激活态和显式点击行为。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/card-item) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/card-item.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/card-item.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# CardItem 卡片项

## 基础用法

`right` 插槽适合放开关、箭头、元信息或状态文本。默认情况下，整行不会派发点击事件。

官方示例：`CardItemCardItemDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const enabled = ref(true)
</script>

<template>
  <TxCardItem title="启用同步" description="右侧插槽可以组合控件。" icon-class="i-carbon-settings">
    <template #right>
      <TxSwitch v-model="enabled" />
      <i class="i-carbon-chevron-right" />
    </template>
  </TxCardItem>
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `role` | `string` | `undefined` | 仅在 `clickable=true` 时应用到根节点的 ARIA role。需要明确语义时传入 `button`、`menuitem` 或 `option`。 |
| `title` | `string` | `''` | 未使用 `title` 插槽时的主标题，单行显示。 |
| `subtitle` | `string` | `''` | 标题下方的副标题，单行显示。 |
| `description` | `string` | `''` | 顶部行下方的辅助描述。 |
| `iconClass` | `string` | `''` | 未提供头像图片时渲染到头像区域的图标 class。 |
| `avatarText` | `string` | `''` | 未提供图片或图标时渲染到头像区域的文本。 |
| `avatarUrl` | `string` | `''` | 头像图片 URL，优先级高于图标和文本头像。 |
| `avatarSize` | `number` | `36` | 头像盒子的像素尺寸。 |
| `avatarShape` | `'circle' \| 'rounded'` | `'circle'` | 头像圆角样式。`rounded` 使用 12px 圆角。 |
| `clickable` | `boolean` | `false` | 开启指针样式、焦点能力，以及鼠标 / Enter 激活。 |
| `active` | `boolean` | `false` | 应用选中视觉态。 |
| `disabled` | `boolean` | `false` | 禁用焦点和点击 / 键盘激活。 |

### Slots

| 插槽名 | Props | 说明 |
|------|-------|------|
| `avatar` | - | 替换生成的图片 / 图标 / 文本头像区域。 |
| `title` | - | 替换主标题内容。 |
| `subtitle` | - | 替换副标题内容。 |
| `description` | - | 替换辅助描述内容。 |
| `right` | - | 在顶部行右侧渲染操作或尾随元信息。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `click` | `MouseEvent` | `clickable=true` 且未禁用时由鼠标点击派发。Enter 激活在运行时复用同一事件通道。 |

## 交互契约

- `align="center"` 让行内各列对齐到同一条中线，这正是单行列表项需要的：左侧更高的一列（折叠箭头、复选框、头像）否则会把文字顶到行的上边。默认仍是 `start`，因为多行文字的卡片应当与媒体列顶部对齐。

- 未提供 `avatar` 插槽、`avatarUrl`、`iconClass`、`avatarText` 时，左侧媒体列会被省略。
- 生成头像优先级为 `avatarUrl`、`iconClass`、`avatarText`。
- 只有 `clickable=true` 且 `disabled=false` 时才会应用 `tabindex="0"`。
- `role` 也只会在 `clickable=true` 时应用；组件没有隐式默认 role。
- `disabled=true` 会添加禁用 class、移除焦点能力，并阻止鼠标和 Enter 激活。
- hover 底色读 `--tx-card-item-hover-bg`，选中底色读 `--tx-card-item-active-bg`；两者的默认值分别是 `--tx-bg-color-overlay` 的 18% 与 `--tx-color-primary` 的 8%，未覆写时渲染结果与以往逐像素一致。边框色不参与覆写，仍由 `--tx-border-color-light` / `--tx-color-primary` 决定。
- `title` 与 `subtitle` 使用单行省略；`description` 可以换行。
- 悬停 `active` 行时会加深其强调色，而不是替换成中性的悬停底色：悬停规则本身优先级高于激活规则，此前选中行在指针下会丢失高亮。

## 最佳实践

- 只有整行本身会执行操作时才设置 `clickable=true`。如果只有右侧插槽可交互，整行保持非 clickable。
- 行落在深色半透明面板上时覆写 `--tx-card-item-hover-bg`。默认公式把 `--tx-bg-color-overlay` 铺 18%，而暗色主题下该 token 本身是 `#1d1e1f`——深色叠深色，hover 会看不见。指向宿主自己的语义表面色，不要用 `:deep` 去改组件的规则。
- 可点击行不在语义化列表或菜单内部时，显式传入合适的 `role`。
- 复杂媒体使用 `avatar` 插槽；简单媒体使用 `avatarUrl`、`iconClass` 或 `avatarText`。
- `right` 插槽保持紧凑，过长控件会挤压标题区域。
- 避免把行导航和开关切换绑定到同一个点击目标。行点击和右侧控件应保持职责分离。


## 审阅说明

- 已核对 `packages/tuffex/packages/components/src/card-item/src/TxCardItem.vue`、`types.ts` 与 `card-item.test.ts`。
- **实测覆盖:** `card-item.test.ts` 覆盖文本和图标渲染、头像 CSS 变量、图片优先于图标/文本、命名插槽、可点击行的鼠标/Enter 事件、禁用阻断、无左侧媒体布局，以及 hover / 选中底色的两个覆写变量与其默认公式未变。
- 可访问性说明：可点击行具备焦点能力，但没有隐式 role。应按外层交互模式传入对应语义 role，并让 `right` 中的交互控件避开整行点击目标。

## Source

- Component source: `packages/tuffex/packages/components/src/card-item/src/TxCardItem.vue`.
- Types: `packages/tuffex/packages/components/src/card-item/src/types.ts` exports `CardItemProps` and `CardItemAvatarShape`.
- Coverage: `packages/tuffex/packages/components/src/card-item/__tests__/card-item.test.ts` verifies generated media, slots, keyboard activation, disabled state, and layout fallbacks.

## 离线完整示例源码

- [CardItemCardItemDemo](../snapshot/apps/nexus/app/components/content/demos/CardItemCardItemDemo.vue.txt)

## 离线类型与实现参考

- [card-item/index.ts](../snapshot/packages/tuffex/packages/components/src/card-item/index.ts.txt)
- [src/TxCardItem.vue](../snapshot/packages/tuffex/packages/components/src/card-item/src/TxCardItem.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/card-item/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
