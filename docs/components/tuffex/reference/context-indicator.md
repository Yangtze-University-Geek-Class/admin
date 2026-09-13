# Context Indicator

> 以环形进度显示对话上下文用量的紧凑指示器。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/context-indicator) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/context-indicator.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/context-indicator.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Context Indicator

## 基础用法

### Context Indicator
官方示例：`ContextIndicatorContextIndicatorDemo`（完整源码见本页末尾）

```vue
<template>
  <TxContextIndicator :used-tokens="12300" :max-tokens="200000" />
  <TxContextIndicator :used-tokens="172000" :max-tokens="200000" />
  <TxContextIndicator :used-tokens="196000" :max-tokens="200000" />
</template>
```

## 交互契约

- 占比为 `usedTokens / maxTokens`，并被夹在 `0`~`1` 之间：超发不会画出超过整圈的弧。
- `maxTokens` 小于等于 `0` 时占比按 `0` 处理，不会抛错也不会出现除零。
- 配色分三档，由占比决定，写在 `data-level` 上：`ok`（≤ 80%）、`warning`（> 80%）、`danger`（> 95%）。可据此在外部做样式覆盖。
- 默认文案用紧凑记数：≥ 100 万显示 `1.2M`，≥ 1000 显示 `12.3K`，否则取整。传入 `formatter` 可完全接管这段文字。
- `title` 恒为「文字 (百分比)」，即使自定义了 `formatter`，悬停仍能看到百分比。
- 语义为 `role="meter"`，并同步 `aria-valuemin` / `aria-valuemax` / `aria-valuenow`；SVG 标记 `aria-hidden`，可访问名称由 `label` 提供。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `usedTokens` | `number` | — | 已使用的 token 数。必填。 |
| `maxTokens` | `number` | — | 上下文窗口上限。必填；≤ 0 时占比按 0 处理。 |
| `label` | `string` | `'Context usage'` | 可访问名称，写入 `aria-label`。 |
| `formatter` | `(used: number, max: number) => string` | — | 自定义环旁文字；未设时回退到内置紧凑记数。 |

### Events

`TxContextIndicator` 不派发组件事件。

## Slots

| 插槽名 | 作用域参数 | 说明 |
|------|------|------|
| `detail` | `{ ratio: number, used: number, max: number }` | 追加在文字之后，用于放百分比、剩余量或「清空上下文」入口。 |

## 最佳实践

- `maxTokens` 用模型的真实窗口值，不要写死常量——换模型时指示器才不会说谎。
- 需要本地化数字格式时用 `formatter`，不要在外部再套一层文字，否则 `title` 里的百分比会与显示值脱节。
- 只在接近上限时才提示用户（`warning` 档起），常态下这是一个背景信息，不该抢注意力。
- 若把它放进按钮或可点击区域，请在外层补充可访问名称：`role="meter"` 不会传达可点击语义。

## 离线完整示例源码

- [ContextIndicatorContextIndicatorDemo](../snapshot/apps/nexus/app/components/content/demos/ContextIndicatorContextIndicatorDemo.vue.txt)

## 离线类型与实现参考

- [context-indicator/index.ts](../snapshot/packages/tuffex/packages/components/src/context-indicator/index.ts.txt)
- [src/TxContextIndicator.vue](../snapshot/packages/tuffex/packages/components/src/context-indicator/src/TxContextIndicator.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
