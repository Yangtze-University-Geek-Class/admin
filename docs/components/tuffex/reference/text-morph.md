# TextMorph 文本形变

> 把字符串切成有身份的段再 diff，只让真正变化的部分动起来；数字按位值滚动，容器宽高与字符同曲线过渡，支持弹簧缓动与打断续跑。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/text-morph) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/text-morph.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/text-morph.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`2.4.14`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# TextMorph 文本形变

> 与 `TxTextTransformer` 的整串淡化不同：这里的动效单位是**字符段**，不是整个字符串。存活的段做 FLIP 位移，新增的段从最近的锚点淡入，离场的段脱离文档流后淡出，数字额外按位值纵向滚动。

## 基础用法

### TextMorph
官方示例：`TextMorphTextMorphDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'

const phrases = [
  'Hello world',
  'Hello there',
  'Goodbye there',
  'Goodbye and thanks for all the fish',
]

const index = ref(0)
const durationMs = ref(400)
const phrase = computed(() => phrases[index.value] ?? '')

function next() {
  index.value = (index.value + 1) % phrases.length
}
</script>

<template>
  <TxTextMorph :text="phrase" :duration-ms="durationMs" />
</template>
```

## 数字位值滚动

数字默认按**位值**匹配，而不是从左到右：`1,204 → 1,318` 只滚百位和十位，千位原地不动；千分位逗号跟着量级走，`999,999 → 1,000,000` 时会滑过一整组。

量级跳跃达到 3 位及以上时不再携带任何数字——那时候数字已经糊成一片，整体替换才是对的。

把 `numbers` 关掉可退回字符级形变。

### Number place value
官方示例：`TextMorphNumberPlaceValueDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const total = ref(1204)
</script>

<template>
  <!-- 1,204 -> 1,318 滚百位和十位，千位不动 -->
  <TxTextMorph :text="`$${total.toLocaleString('en')}`" />

  <!-- 直接传数字时，locale 与 decimals 负责格式化 -->
  <TxTextMorph :text="total" locale="en" :decimals="2" />
</template>
```

## 弹簧缓动

`spring` 接预设名或物理系数，来自 TuffEx 内部与 `TxLiquid`、`TxSlider` 同一套弹簧编译器，所以整库的动效语言是一致的。弹簧同时决定曲线与时长，因此设了它之后 `durationMs` 与 `easing` 都会被忽略。

### Spring presets
官方示例：`TextMorphSpringDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTextMorph text="Settling" spring="snappy" />
  <TxTextMorph text="Settling" spring="smooth" />
  <TxTextMorph text="Settling" spring="bouncy" />
  <TxTextMorph text="Settling" :spring="{ stiffness: 200, damping: 20 }" />
</template>
```

## API

### TxTextMorph Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `text` | `string \| number` | - | 要渲染的值。数字会先按 `locale` + `decimals` 格式化。 |
| `tag` | `string` | `span` | 根节点 HTML 标签。 |
| `durationMs` | `number` | `400` | 形变时长（ms）。设了 `spring` 时被忽略。 |
| `easing` | `string` | `cubic-bezier(0.19, 1, 0.22, 1)` | CSS 缓动函数。设了 `spring` 时被忽略。 |
| `spring` | `'snappy' \| 'smooth' \| 'bouncy' \| { stiffness?, damping?, mass? }` | - | 弹簧物理。同时提供曲线与时长。 |
| `scale` | `boolean` | `true` | 离场段是否带缩放。 |
| `numbers` | `boolean` | `true` | 数字按位值滚动；关闭后退回字符级形变。 |
| `decimals` | `number` | - | 小数位数。仅当 `text` 是数字时生效。 |
| `locale` | `string` | `en` | 用于分段与数字格式化。 |
| `cursorIndex` | `number` | - | 光标位置。输入框场景下把单个数字从位值匹配切成光标匹配。 |
| `disabled` | `boolean` | `false` | 跳过动画，直接写入值。 |
| `respectReducedMotion` | `boolean` | `true` | 把 `prefers-reduced-motion: reduce` 当作 `disabled`。 |
| `debug` | `boolean` | `false` | 给根节点和每个段描边，用于排查形变异常。 |

### TxTextMorph Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `animation-start` | - | 一次形变开始时触发；首帧渲染不触发。 |
| `animation-complete` | - | 形变自然走完。 |
| `animation-cancel` | - | 形变被下一次更新打断。 |

> 每次形变里 `animation-complete` 与 `animation-cancel` 恰好触发其一。

## 交互契约

- 完整值以一个视觉隐藏但可读的 `[tx-morph-sr]` 节点存在；所有段元素都是 `aria-hidden`，屏幕阅读器只会读到完整值一次。
- 段元素由引擎命令式创建，因此组件样式**不是 scoped** 的，作用域由 `tx-morph-*` 属性名保证。
- 挂载后 Vue 不再渲染子节点——引擎接管了它们。首帧的纯文本只为 SSR 水合对齐。
- `prefers-reduced-motion: reduce` 或 `disabled` 下直接写入 `textContent`，并清空内部段记录，避免恢复动效后拿已移除的元素做 FLIP。
- 形变中途再次更新会读取当前动画的速度并携带进新曲线，所以高频更新不会把每条曲线都停在起步阶段。
- 根节点是 `white-space: nowrap`，换行由值里的 `\n` 生成 `<br>`；它不做软换行，也不做省略号截断。
- `cursorIndex` 只在整个值里恰好有一个数字时生效。

## 最佳实践

- 计数器、金额、进度百分比这类"同一个量在变"的值优先用它；`numbers` 的位值匹配就是为这类值写的。
- 输入框里跟随用户键入的数字要传 `cursorIndex`，否则在 `20` 前面插一位会被理解成整列重新编号。
- 需要软换行或省略号截断的文本用 `TxTextTransformer` 的 `mode="fade"`，引擎表达不了这两件事。
- 同一屏里不要放太多高频实例：每个字符都是一个带 `will-change` 的元素。
- 想让容器跟着变化就直接用它——引擎自己动画宽高，不需要再套 `TxAutoSizer`。

## Source

- Component source: `packages/tuffex/packages/components/src/text-morph/src/TxTextMorph.vue`。
- Engine: `packages/tuffex/packages/components/src/text-morph/src/engine/`，移植自 [lochie/torph](https://github.com/lochie/torph)（MIT），弹簧层换成了 TuffEx 自己的 `liquid/src/spring.ts`。
- Types: `packages/tuffex/packages/components/src/text-morph/src/types.ts` 导出 `TextMorphProps`。
- Export alias: `packages/tuffex/packages/components/src/text-morph/index.ts` 导出 `TextMorph`、`TxTextMorph`、`TextMorphProps`、`TxTextMorphInstance`，以及引擎的 `TextMorphEngine` / `MorphController`。
- Coverage: `packages/tuffex/packages/components/src/text-morph/__tests__/` 下的 `engine.test.ts` 与 `text-morph.test.ts` 覆盖分段、diff 配对、位值匹配、弹簧融合与 reduced-motion 降级。

## 离线完整示例源码

- [TextMorphTextMorphDemo](../snapshot/apps/nexus/app/components/content/demos/TextMorphTextMorphDemo.vue.txt)
- [TextMorphNumberPlaceValueDemo](../snapshot/apps/nexus/app/components/content/demos/TextMorphNumberPlaceValueDemo.vue.txt)
- [TextMorphSpringDemo](../snapshot/apps/nexus/app/components/content/demos/TextMorphSpringDemo.vue.txt)

## 离线类型与实现参考

- [text-morph/index.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/index.ts.txt)
- [src/TxTextMorph.vue](../snapshot/packages/tuffex/packages/components/src/text-morph/src/TxTextMorph.vue.txt)
- [engine/animate-group.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/animate-group.ts.txt)
- [engine/animate-number.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/animate-number.ts.txt)
- [engine/animate-text.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/animate-text.ts.txt)
- [engine/constants.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/constants.ts.txt)
- [engine/container.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/container.ts.txt)
- [engine/controller.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/controller.ts.txt)
- [engine/diff.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/diff.ts.txt)
- [engine/dom.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/dom.ts.txt)
- [engine/flip.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/flip.ts.txt)
- [engine/index.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/index.ts.txt)
- [engine/lcs.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/lcs.ts.txt)
- [engine/metrics.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/metrics.ts.txt)
- [engine/morph.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/morph.ts.txt)
- [engine/number.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/number.ts.txt)
- [engine/reduced-motion.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/reduced-motion.ts.txt)
- [engine/segment.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/segment.ts.txt)
- [engine/types.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/engine/types.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/text-morph/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
