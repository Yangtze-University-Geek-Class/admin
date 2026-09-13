# InlineCitation 行内引用

> 嵌在正文里的来源引用胶囊，点击只派发事件，不自行跳转。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/inline-citation) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/inline-citation.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/inline-citation.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# InlineCitation 行内引用

## 基础用法

### 行内引用

胶囊跟着文字排版走：18px 高、等宽字体、上移 1px 让字高与正文对齐，而不是压在基线上。

官方示例：`InlineCitationInlineCitationDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const scoop = { id: 'scoop', url: 'https://scoopdata.io/flavors/pistachio', favicon: '/scoop.svg' }
const trends = { id: 'trends', url: 'https://www.trends.google.com/trends/' }

function open(source: { url: string }) {
  window.open(source.url, '_blank', 'noopener')
}
</script>

<template>
  <p>
    开心果是增长最快的口味<TxInlineCitation :source="scoop" @open="open" />，
    同区间内核果类口味同样在上升<TxInlineCitation :source="trends" @open="open" />。
  </p>
</template>
```

### 流式回答里的引用

引用在正文流到那个位置时才落下，`pop-in` 的弹入正是为这一刻准备的。整段观感由 demo 编排，组件本身只负责渲染一枚胶囊。

官方示例：`AiSuiteStreamingAnswerDemo`（完整源码见本页末尾）

```vue
<template>
  <p>
    <span v-for="(token, i) in visible" :key="i">
      <TxInlineCitation v-if="token.cite" :source="sources[0]" @open="open" />
      <span v-else>{{ token.text }} </span>
    </span>
  </p>

  <TxSources :sources="sources" variant="stack" @open="open" />
  <TxSuggestionChips :suggestions="followUps" layout="list" @select="ask" />
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `source` | `AiSourceItem` | — | 引用目标，`{ id, url, title?, favicon? }`。必填。 |
| `label` | `string` | — | 胶囊文案。缺省时依次回落到 `source.title`、`url` 的 hostname（去掉 `www.`）。 |
| `appear` | `boolean` | `true` | 是否播放入场弹入。重渲染已定稿的答案时置 `false`，避免整段引用重弹。 |

`url` 无法被 `URL` 解析时，回落链的末端是 `url` 原文，不会渲染成空胶囊。

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `open` | `(source: AiSourceItem)` | 点击时派发。默认跳转已被阻止，导航由宿主完成。 |

### Slots

| 插槽名 | 作用域参数 | 说明 |
|------|------|------|
| `default` | `{ source, label }` | 替换胶囊文案，可放富文本。 |
| `icon` | `{ source }` | 替换前置站点图标，例如换成自绘的分类角标。 |

## 交互契约

- **链接不自行导航。** 渲染的是真实 `<a href>`，但点击会 `preventDefault` 并派发 `open`。这在 Electron 渲染进程里是必须的——正文里的引用最不该做的事就是把整个应用导航走。
- `href` 保留在 DOM 上，所以浏览器原生的「在新标签页打开」「复制链接地址」右键菜单依旧可用。
- 站点图标加载失败会被记下并停止渲染该图标，胶囊退化成纯文案而不是留一个破图占位。
- 图标标了 `alt=""` 与 `aria-hidden`，可访问名称由胶囊文案承担。
- 胶囊用 `vertical-align: middle` 加 1px 上移嵌进文字流，行高由所在段落决定，组件自己不设 `line-height`。
- 入场只在挂载时播放一次；`appear` 是渲染期决策，改它不会追加播放。

## 最佳实践

- 必须监听 `open`，否则点击引用不会有任何反应。
- 一段正文里的引用控制在 2~3 枚：胶囊比文字重，密集出现会把段落读成列表。
- `label` 留空更好——默认的域名回落让读者一眼看出来源出处，自定义文案反而容易掩盖它。
- 流式场景里给 `source.id` 用稳定标识：图标失败记录按实例持有，节点复用时靠稳定数据避免反复重试坏图。
- 需要「答案末尾的来源清单」而不是行内引用时，用 `TxSources`；两者是互补关系，常常同时出现。

## Source

- Component source: `packages/tuffex/packages/components/src/inline-citation/src/TxInlineCitation.vue`。
- Types: `packages/tuffex/packages/components/src/inline-citation/src/types.ts`。
- **实测覆盖:** `packages/tuffex/packages/components/src/inline-citation/__tests__/inline-citation.test.ts`（7 项）验证 hostname 回落与 `www.` 剥离、`label` / `title` 的优先级、URL 解析失败的兜底、点击派发 `open` 而不导航、图标失败后消失、`appear` 对入场类名的开关。
- 移植自 Beautiful UI（https://www.beautifului.dev），© 2026 Shane Levine，MIT。



## 审阅说明

- **与 `TxSources` 的分工:** `TxSources` 是答案末尾可折叠的来源清单，本组件是正文流中的单枚引用。数据类型共用 `AiSourceItem`，可以同时使用同一份来源数组。
- **已知偏差:** 上游的行内引用永远取来源数组的第 0 项，与它所在的位置无关——那是 demo 写法。这里要求显式传 `source`，每枚胶囊指向自己的来源。
- **可访问性:** 上游用 `target="_blank" rel="noreferrer"` 直接导航；这里改为事件上抛，与 `TxSources` 的既有约定保持一致。

## 离线完整示例源码

- [InlineCitationInlineCitationDemo](../snapshot/apps/nexus/app/components/content/demos/InlineCitationInlineCitationDemo.vue.txt)
- [AiSuiteStreamingAnswerDemo](../snapshot/apps/nexus/app/components/content/demos/AiSuiteStreamingAnswerDemo.vue.txt)

## 离线类型与实现参考

- [inline-citation/index.ts](../snapshot/packages/tuffex/packages/components/src/inline-citation/index.ts.txt)
- [src/TxInlineCitation.vue](../snapshot/packages/tuffex/packages/components/src/inline-citation/src/TxInlineCitation.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/inline-citation/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
