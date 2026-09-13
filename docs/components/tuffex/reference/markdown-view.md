# MarkdownView Markdown 渲染

> 基于 GitHub-flavored Markdown 的渲染组件，支持显式 sanitize 与亮/暗主题模式。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/markdown-view) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/markdown-view.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/markdown-view.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# MarkdownView Markdown 渲染

## 基础用法

`content` 是唯一输入源字符串。组件内部已启用 GFM 与软换行。

官方示例：`MarkdownViewMarkdownViewDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const content = '# 发布说明\n\n- 新增 API 表格\n- 保持默认 sanitize'
</script>

<template>
  <TxMarkdownView :content="content" />
</template>
```

## 丰富 Markdown

表格、任务列表、引用、行内代码和 fenced code block 都会渲染到内部 `.markdown-body` 容器中。

官方示例：`MarkdownViewMarkdownDemo`（完整源码见本页末尾）

````vue
<script setup lang="ts">
const richContent = [
  '# 文档片段',
  '',
  '- [x] 已完成任务',
  '- [ ] 待处理任务',
  '',
  '| 功能 | 状态 |',
  '| --- | --- |',
  '| 表格 | 支持 |',
  '',
  '```ts',
  'export const ok = true',
  '```',
].join('\n')
</script>

<template>
  <TxMarkdownView :content="richContent" />
</template>
````

## 主题预览

外部表面已知时显式设置 `theme`；页面统一管理主题时保留 `auto`。

官方示例：`MarkdownViewLightDarkDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const richContent = [
  '## 主题预览',
  '',
  '同一段 Markdown 可以在亮色和暗色主题中保持一致结构。',
  '',
  '- sanitize 默认开启',
  '- `theme` 可以显式指定',
].join('\n')
</script>

<template>
  <div class="grid gap-4 md:grid-cols-2">
    <div style="padding: 12px; border-radius: 12px; border: 1px solid #d1d9e0; background: #fff;">
      <TxMarkdownView :content="richContent" theme="light" />
    </div>
    <div style="padding: 12px; border-radius: 12px; border: 1px solid #30363d; background: #0d1117;">
      <TxMarkdownView :content="richContent" theme="dark" />
    </div>
  </div>
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `content` | `string` | 必填 | 渲染到 `.markdown-body` 容器中的 Markdown 源字符串。 |
| `sanitize` | `boolean` | `true` | 使用 DOMPurify 清洗生成的 HTML；DOMPurify 加载期间不会输出已解析 HTML。 |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | `auto` 根据 document 的 `data-theme` / 主题 class 推导，无法识别时回退到 `light`。 |

### Slots

无插槽。渲染结果完全由 `content` 派生。

### Events

无组件事件。

## 交互契约

- Markdown 通过 `marked` 解析，并启用 `gfm: true` 与 `breaks: true`。
- `sanitize=true` 时，DOMPurify 就绪前不会提前渲染原始 HTML。
- `sanitize=false` 时，`marked` 输出会直接通过 `v-html` 写入；只适用于可信 Markdown。
- `theme="auto"` 会读取 `html` / `body` 的 `data-theme` 以及 `light` / `dark` class，并监听 `html` 的 class 与 `data-theme` 变化。
- 外层容器会带上解析后的 `light` 或 `dark` class，以及同值的 `data-theme` 属性。
- 随组件打包的 GitHub-Markdown 样式表是 *全局* 引入的，因此其中每条规则都被限定在 `:where(.tx-markdown-view, .tx-stream-md)` 下。`.markdown-body` 是一个非常通用的类名——加限定之前，只要引入本组件，宿主页面自己用该类名承载的正文也会被重新设置样式。`:where()` 不增加特异度，所以这层限定只收窄作用范围，不改变这些规则彼此之间的优先级关系。

## 最佳实践

- 用户生成、远程加载或插件提供的内容保持默认 `sanitize=true`。
- 传入短且已经标准化的 Markdown 字符串；除非明确需要 Markdown HTML，否则不要混入半转义 HTML。
- 在预览、卡片或亮/暗并排展示中显式设置 `theme`，避免被页面全局主题误导。
- `TxMarkdownView` 只负责展示；需要编辑能力时，在外部组合编辑器或 textarea。

## 审阅说明

- **安全说明:** `sanitize=true` 会等待 DOMPurify；如果 sanitizer 动态导入失败，会渲染空内容。插件、远程或用户输入 Markdown 除非已在上游可信并标准化，否则不要关闭 sanitize。
- **主题说明:** `theme="auto"` 初次会读取 `html` 与 `body` 的主题标记，但 MutationObserver 只监听 `html` 的 class 与 `data-theme`。不跟随 document root 的内嵌预览建议显式传 `theme`。
- **实测覆盖:** `markdown-view.test.ts` 覆盖 sanitizer 就绪前不渲染、清洗后渲染、`sanitize=false` 原样渲染、显式 light/dark 主题、从 document 标记推导 auto 主题、observer 更新，以及 light fallback。

## Source

- Component source: `packages/tuffex/packages/components/src/markdown-view/src/TxMarkdownView.vue`。
- Types: `packages/tuffex/packages/components/src/markdown-view/src/types.ts` 导出 `MarkdownViewProps`。
- Styles: `packages/tuffex/packages/components/src/markdown-view/src/github-markdown.css` 由组件样式导入，`TxStreamMarkdown` 也引入同一个文件。其中每条规则都限定在 `:where(.tx-markdown-view, .tx-stream-md)` 下——重新引入上游版本时请保留这层限定。
- Export alias: `packages/tuffex/packages/components/src/markdown-view/index.ts` 导出 `MarkdownView`、`TxMarkdownView`、`MarkdownViewProps` 与 `TxMarkdownViewInstance`。
- Coverage: `packages/tuffex/packages/components/src/markdown-view/__tests__/markdown-view.test.ts` 覆盖 sanitize 与主题行为。

## 离线完整示例源码

- [MarkdownViewMarkdownViewDemo](../snapshot/apps/nexus/app/components/content/demos/MarkdownViewMarkdownViewDemo.vue.txt)
- [MarkdownViewMarkdownDemo](../snapshot/apps/nexus/app/components/content/demos/MarkdownViewMarkdownDemo.vue.txt)
- [MarkdownViewLightDarkDemo](../snapshot/apps/nexus/app/components/content/demos/MarkdownViewLightDarkDemo.vue.txt)

## 离线类型与实现参考

- [markdown-view/index.ts](../snapshot/packages/tuffex/packages/components/src/markdown-view/index.ts.txt)
- [src/TxMarkdownView.vue](../snapshot/packages/tuffex/packages/components/src/markdown-view/src/TxMarkdownView.vue.txt)
- [src/github-markdown.css](../snapshot/packages/tuffex/packages/components/src/markdown-view/src/github-markdown.css.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/markdown-view/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
