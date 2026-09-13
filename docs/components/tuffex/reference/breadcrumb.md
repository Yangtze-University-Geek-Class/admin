# Breadcrumb 面包屑

> 可访问的层级导航，支持条目图标、分隔符、href 链接与手动点击事件。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/breadcrumb) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/breadcrumb.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/breadcrumb.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Breadcrumb 面包屑

## 基础用法

官方示例：`BreadcrumbBreadcrumbTrailDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const items = [
  { label: '首页', href: '/', icon: 'i-carbon-home' },
  { label: '资料库' },
  { label: '数据' },
]

function onBreadcrumbClick(item: { label: string }, index: number) {
  console.log(item.label, index)
}
</script>

<template>
  <TxBreadcrumb :items="items" @click="onBreadcrumbClick" />
</template>
```

## 组合示例

### 原生链接与手动条目

带 `href` 的条目会渲染为链接，除非它是禁用项或当前项。没有 `href` 的条目可以发出组件 `click` 事件。

```vue
<script setup lang="ts">
const items = [
  { label: '首页', href: '/', icon: 'i-carbon-home' },
  { label: '项目' },
  { label: '当前项目' },
]

function openVirtualCrumb(item: { label: string }, index: number) {
  console.log(item.label, index)
}
</script>

<template>
  <TxBreadcrumb :items="items" @click="openVirtualCrumb" />
</template>
```

### 自定义分隔图标

```vue
<template>
  <TxBreadcrumb :items="items" separator-icon="i-carbon-chevron-right" />
</template>
```

## 交互契约

- 根节点渲染为 `nav aria-label="Breadcrumb"`，内部是有序列表。
- 每个条目都会渲染在一个 list item 中。
- 非当前、非禁用且带 `href` 的条目渲染为 `<a href="...">`，依赖原生导航。
- 当前项始终渲染为 `span`，即使提供了 `href`，并带有 `aria-current="page"`。
- 禁用项渲染为 `span`，带有 `aria-disabled="true"`，且不会发出点击事件。
- `click` 只会在非当前、非禁用且没有 `href` 的条目上发出。
- `icon` 会在条目文本前渲染一个 `TxIcon`。
- 分隔符只渲染在条目之间，并且是 `aria-hidden`。
- 默认分隔图标名是 `i-carbon-chevron-right`（TxIcon 需要 `i-` 前缀，缺前缀会解析为 `null`）。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `items` | `BreadcrumbItem[]` | 必填 | 有序面包屑条目。最后一项会被视为当前页。 |
| `separatorIcon` | `string` | `'i-carbon-chevron-right'` | 条目之间渲染的图标名。 |

### BreadcrumbItem

| 字段 | 类型 | 说明 |
|------|------|------|
| `label` | `string` | 可见面包屑文本。 |
| `href` | `string` | 非当前、启用条目的可选原生链接目标。 |
| `icon` | `string` | 可选前置 `TxIcon` 名称。 |
| `disabled` | `boolean` | 禁用交互，并用 `aria-disabled` 标记条目。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `click` | `(item: BreadcrumbItem, index: number)` | 在启用、非当前且没有 `href` 的条目上发出。 |

## Slots

`TxBreadcrumb` 不暴露插槽。标签、图标名、链接目标和禁用状态都通过 `items` 配置；条目布局需要自定义时，应在组件外组合专用导航。

## 最佳实践

- `items` 保持从最上层父级到当前页的顺序。
- 真实路由导航应提供 `href`，以保留浏览器链接语义、右键菜单和复制链接能力。
- 没有 `href` 的条目只用于需要自定义应用行为的虚拟面包屑。
- 不要期待 `href` 链接触发 `click`；路由行为应通过正常导航处理。
- 标签保持简短。面包屑用于描述层级，不应重复完整页面标题。
- 避免把当前页条目标记为 disabled；组件已经把最后一项当作当前且不可交互。

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/breadcrumb/src/TxBreadcrumb.vue` 确认语义化 `nav` / `ol` 结构、当前项判定、href 渲染、禁用保护、分隔符和手动 `click` 派发规则。
- 类型契约:`packages/tuffex/packages/components/src/breadcrumb/src/types.ts` 定义 `BreadcrumbItem`、`BreadcrumbProps` 和 `BreadcrumbEmits`。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/breadcrumb/__tests__/breadcrumb.test.ts` 覆盖导航语义、图标、分隔符、当前页非链接渲染、点击派发和禁用抑制。
- 导出入口:`packages/tuffex/packages/components/src/breadcrumb/index.ts` 重新导出 breadcrumb 源模块。

## Source

## 离线完整示例源码

- [BreadcrumbBreadcrumbTrailDemo](../snapshot/apps/nexus/app/components/content/demos/BreadcrumbBreadcrumbTrailDemo.vue.txt)

## 离线类型与实现参考

- [breadcrumb/index.ts](../snapshot/packages/tuffex/packages/components/src/breadcrumb/index.ts.txt)
- [src/TxBreadcrumb.vue](../snapshot/packages/tuffex/packages/components/src/breadcrumb/src/TxBreadcrumb.vue.txt)
- [src/index.ts](../snapshot/packages/tuffex/packages/components/src/breadcrumb/src/index.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/breadcrumb/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
