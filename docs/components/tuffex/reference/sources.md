# Sources

> 可折叠的引用来源列表，链接是否跳转完全由宿主决定。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/sources) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/sources.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/sources.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Sources

## 基础用法

### Sources
官方示例：`SourcesSourcesDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const sources = [
  { id: 's1', url: 'https://vuejs.org/guide/introduction.html', title: 'Introduction', favicon: 'https://vuejs.org/logo.svg' },
  { id: 's2', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Clipboard' },
]

function openSource(source: { url: string }) {
  window.open(source.url, '_blank', 'noopener')
}
</script>

<template>
  <TxSources :sources="sources" @open="openSource" />
</template>
```

### 来源堆叠

`variant="stack"` 把头部的地球图标换成前几条来源的站点图标，重叠排列。折叠状态下读者就能看出引用了哪些站点，展不展开都成立。

官方示例：`AiSuiteStreamingAnswerDemo`（完整源码见本页末尾）

```vue
<template>
  <TxSources
    :sources="sources"
    variant="stack"
    :label-formatter="(n) => `${n} 个来源`"
    @open="open"
  />
</template>
```

## 交互契约

- `variant="stack"` 最多取前 3 条**能画出图标**的来源；一条都画不出时回落到地球图标，而不是留一片空白。图标加载失败后该条退出堆叠，后面的来源顶上来。
- 堆叠图标的描边色走 `--tx-sources-stack-ring`（默认取页面底色）：它的作用是在重叠处挖出缝隙，头部放在非页面底色的容器上时需要改指向。
- **链接不会自己跳转。** 点击时组件调用 `preventDefault()` 并派发 `open`，是否打开、在哪打开由宿主决定——这对沙箱环境（如 Electron 渲染进程）是刻意设计。
- `href` 仍然写在 `<a>` 上，所以「在新标签页打开」「复制链接地址」等浏览器原生右键菜单依旧可用。
- 展开态由组件自己持有，初值取 `defaultOpen`；这是非受控组件，后续改 `defaultOpen` 不生效。
- 折叠标题默认是 `Used N source(s)`，会按单复数变形；`labelFormatter` 可整体接管。
- 标题回退到域名：`title` 为空时显示 `url` 的 hostname（去掉 `www.`）；`url` 无法被 `URL` 解析时，原样显示 `url` 本身。
- 站点图标加载失败会被永久记下并停止重试该条，不会反复请求坏图。
- 图标标了 `alt=""` 与 `aria-hidden`，可访问名称由标题与域名文本承载。
- 列表是 `<ol>`，序号来自渲染顺序而非数据字段——重排 `sources` 就会重排编号。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `sources` | `AiSourceItem[]` | — | 引用列表；`AiSourceItem` 为 `{ id, url, title?, favicon? }`。必填。 |
| `labelFormatter` | `(count: number) => string` | — | 自定义折叠标题；未设时回退到 `Used N source(s)`。 |
| `defaultOpen` | `boolean` | `false` | 初始是否展开。仅在挂载时读取一次。 |
| `variant` | `'default' \| 'stack'` | `'default'` | `stack` 用重叠的站点图标替代头部的地球图标。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `open` | `(source: AiSourceItem)` | 点击某条引用时派发。默认跳转已被阻止，导航需宿主自行完成。 |

## Slots

`TxSources` 不暴露插槽。条目结构固定为序号 + 图标 + 标题 + 域名。

## 最佳实践

- 必须监听 `open`，否则点击引用不会有任何反应。
- 桌面端在外部浏览器打开，并带上 `noopener`；不要在应用窗口里直接导航走。
- `id` 用稳定标识：图标失败记录是按 `id` 存的，`id` 变化会让坏图重新尝试加载。
- 中文界面记得覆盖 `labelFormatter`，默认文案是英文且带英文复数规则。

## 离线完整示例源码

- [SourcesSourcesDemo](../snapshot/apps/nexus/app/components/content/demos/SourcesSourcesDemo.vue.txt)
- [AiSuiteStreamingAnswerDemo](../snapshot/apps/nexus/app/components/content/demos/AiSuiteStreamingAnswerDemo.vue.txt)

## 离线类型与实现参考

- [sources/index.ts](../snapshot/packages/tuffex/packages/components/src/sources/index.ts.txt)
- [src/TxSources.vue](../snapshot/packages/tuffex/packages/components/src/sources/src/TxSources.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
