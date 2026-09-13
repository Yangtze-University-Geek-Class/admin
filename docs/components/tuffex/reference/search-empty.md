# SearchEmpty 搜索空态

> 用于搜索无结果时的状态提示。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/search-empty) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/search-empty.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/search-empty.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# SearchEmpty 搜索空态

## 基础用法

### SearchEmpty
官方示例：`SearchEmptySearchEmptyDemo`（完整源码见本页末尾）

```vue
<template>
  <TxSearchEmpty
    title="没有匹配结果"
    description="换一个关键词、清空筛选条件，或扩大搜索范围。"
    surface="card"
    :primary-action="{ label: '重置筛选', type: 'primary', icon: 'i-carbon-reset' }"
  />
</template>
```

## API

`TxSearchEmpty` 继承 `TxEmptyState` 除 `variant` 以外的 Props、Slots 和 Events；组件内部始终传入 `variant="search-empty"`。

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `title` | `string` | `No results` | 覆盖预设搜索空态标题。 |
| `description` | `string` | `Try a different keyword or filter.` | 覆盖恢复建议文案。 |
| `icon` | `TxIconSource \| string \| null` | - | 替换搜索空态插画；传 `null` 可隐藏图标区域。 |
| `iconSize` | `number` | - | 自定义图标尺寸。 |
| `layout` | `'vertical' \| 'horizontal'` | `'vertical'` | 控制图标与内容排列方向。 |
| `align` | `'start' \| 'center' \| 'end'` | `'center'` | 控制图标、文案和操作区对齐。 |
| `size` | `'small' \| 'medium' \| 'large'` | `'medium'` | 调整间距、字号和插画尺寸。 |
| `surface` | `'plain' \| 'card'` | `'plain'` | 为筛选结果面板增加边框容器。 |
| `primaryAction` | `EmptyStateAction` | - | 渲染主恢复动作并触发 `primary`。 |
| `secondaryAction` | `EmptyStateAction` | - | 渲染次恢复动作并触发 `secondary`。 |
| `actionSize` | `TxButtonProps['size']` | `'small'` | 生成操作按钮的默认尺寸。 |
| `loading` | `boolean` | `false` | 未提供自定义图标插槽或图标 prop 时显示 spinner。 |

### Slots

| 名称 | 说明 |
|------|------|
| `icon` | 替换预设搜索空态插画。 |
| `title` | 替换解析后的标题内容。 |
| `description` | 替换解析后的说明内容。 |
| `actions` | 替换生成的主/次操作按钮。 |

### Events

| 事件名 | 说明 |
|------|------|
| `primary` | 点击生成的主操作按钮时触发。 |
| `secondary` | 点击生成的次操作按钮时触发。 |

## 后台筛选工具栏

搜索空态应直接出现在筛选结果容器里，并提供“重置/调整筛选”的动作，避免用户误以为列表仍在加载。

官方示例：`ComponentsSearchFiltersDemo`（完整源码见本页末尾）

```vue
<template>
  <TxSearchEmpty
    title="没有匹配结果"
    description="换一个关键词或筛选范围，再重新搜索。"
    surface="card"
    :primary-action="{ label: '重置筛选', type: 'primary', icon: 'i-carbon-reset' }"
  />
</template>
```

## 交互契约

- `TxSearchEmpty` 始终向 `TxEmptyState` 透传 `variant="search-empty"`。
- 组件不额外改写 `title`、`description`、`surface` 或 action 配置；显式 props 会原样透传。
- `icon`、`title`、`description`、`actions` 插槽会原样转发给 `TxEmptyState`。

## 最佳实践

- 只有查询或筛选产生无匹配结果后才使用 `TxSearchEmpty`；未筛选数据为空时使用 `TxNoData`。
- 尽量在组件附近回显失败的关键词或当前筛选条件，让用户知道系统搜索了什么。
- 筛选状态可恢复时提供重置或扩大范围动作。
- 搜索空态应留在原结果容器内，不要放到全局 toast 或脱离列表的横幅里。
- 替换整块结果面板时使用 `surface="card"`；行内筛选反馈保持 `surface="plain"`。

## Source

- Component source: `packages/tuffex/packages/components/src/search-empty/src/TxSearchEmpty.vue`。
- Base source: `packages/tuffex/packages/components/src/empty-state/src/TxEmptyState.vue`。
- Types: `packages/tuffex/packages/components/src/search-empty/src/types.ts` 导出 `SearchEmptyProps = Omit<EmptyStateProps, 'variant'>`。
- **实测覆盖:** `packages/tuffex/packages/components/src/search-empty/__tests__/search-empty.test.ts` 验证 search-empty variant 锁定、显式 props 与 action 透传、具名 slots 转发及 install 注册。



## 审阅说明

- **Wrapper contract:** `TxSearchEmpty` 始终透传 `variant="search-empty"`，并把结果文案、重置动作、surface、icon 与 slot 留给宿主控制。
- **建议:** 搜索无结果时优先使用 `TxSearchEmpty`；普通无数据场景继续使用 `TxEmptyState` 或 `TxNoData`。
- **可访问性:** 标题应说明“没有匹配结果”，动作应指向可恢复路径，例如重置筛选、调整范围或重新搜索。

## 离线完整示例源码

- [SearchEmptySearchEmptyDemo](../snapshot/apps/nexus/app/components/content/demos/SearchEmptySearchEmptyDemo.vue.txt)
- [ComponentsSearchFiltersDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsSearchFiltersDemo.vue.txt)

## 离线类型与实现参考

- [search-empty/index.ts](../snapshot/packages/tuffex/packages/components/src/search-empty/index.ts.txt)
- [src/TxSearchEmpty.vue](../snapshot/packages/tuffex/packages/components/src/search-empty/src/TxSearchEmpty.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/search-empty/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
