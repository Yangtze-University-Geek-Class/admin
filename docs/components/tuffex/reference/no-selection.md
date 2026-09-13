# NoSelection 未选择

> 基于 TxEmptyState 的未选择详情面板快捷空状态，固定使用 no-selection 变体。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/no-selection) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/no-selection.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/no-selection.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# NoSelection 未选择

## 基础用法

### NoSelection
官方示例：`NoSelectionNoSelectionDemo`（完整源码见本页末尾）

```vue
<template>
  <TxNoSelection
    surface="card"
    title="未选择条目"
    description="从左侧列表选择一个项目后，这里会显示详情。"
    :primary-action="{ label: '新建项目', type: 'primary' }"
  />
</template>
```

## 交互契约

- 始终向 `TxEmptyState` 透传 `variant="no-selection"`。
- 不覆盖显式传入的 `title`、`description`、`surface`、`layout`、`align`、`size`、`icon` 或 action props。
- `icon`、`title`、`description`、`actions` 插槽会原样转发给 `TxEmptyState`。
- 生成按钮触发的 `primary` / `secondary` 事件来自内部 `TxEmptyState`。

## API

### Props

`TxNoSelection` 接收除 `variant` 以外的所有 `EmptyStateProps` 字段。

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `title` | `string` | 预设标题 | 覆盖未选择状态标题。 |
| `description` | `string` | 预设描述 | 说明下一步应该选择什么。 |
| `icon` | `TxIconSource \| string \| null` | 预设插画 | 自定义图标源/class，或传 `null` 隐藏图标区域。 |
| `iconSize` | `number` | 尺寸预设 | 自定义图标像素尺寸。 |
| `layout` | `'vertical' \| 'horizontal'` | `'vertical'` | 空状态布局。 |
| `align` | `'start' \| 'center' \| 'end'` | `'center'` | 内容对齐方式。 |
| `size` | `'small' \| 'medium' \| 'large'` | `'medium'` | 密度和插画尺寸。 |
| `surface` | `'plain' \| 'card'` | `'plain'` | 是否添加卡片边界。 |
| `primaryAction` | `EmptyStateAction` | - | 生成的主操作。 |
| `secondaryAction` | `EmptyStateAction` | - | 生成的次操作。 |
| `actionSize` | `TxButtonProps['size']` | `'small'` | 生成按钮默认尺寸。 |
| `loading` | `boolean` | `false` | 未传自定义图标时显示 spinner。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `primary` | - | 从生成的主操作转发。 |
| `secondary` | - | 从生成的次操作转发。 |

### Slots

| 插槽名 | Props | 说明 |
|------|------|------|
| `icon` | - | 替换预设插画或自定义图标。 |
| `title` | - | 替换解析后的标题。 |
| `description` | - | 替换解析后的描述。 |
| `actions` | - | 替换生成的主/次操作按钮。 |

## 最佳实践

- 当前面板有效但依赖用户选择时使用它；数据集本身为空时用 `TxNoData`。
- 与列表/表格中的可见选中提示配合，让用户知道下一步在哪里操作。
- 分栏详情区建议加 `surface="card"`，避免空区域边界不清。
- 操作文案应明确，例如“新建项目”或“打开列表”，不要只写“确定”。

## 审阅说明 / Review Notes

- **Wrapper contract:** `TxNoSelection` 始终向 `TxEmptyState` 传入 `variant="no-selection"`，并透传所有非 `variant` props 与具名 slot。
- **状态选择:** 适用于等待用户选择的详情面板或 inspector；不要用于空数据集或筛选无结果场景。
- **实测覆盖:** `no-selection.test.ts` 覆盖 variant 锁定、action prop 透传、具名 slot 透传与 install 注册。

## Source

- Component source: `packages/tuffex/packages/components/src/no-selection/src/TxNoSelection.vue`。
- Base source: `packages/tuffex/packages/components/src/empty-state/src/TxEmptyState.vue`。
- Types: `packages/tuffex/packages/components/src/no-selection/src/types.ts` 导出 `NoSelectionProps = Omit<EmptyStateProps, 'variant'>`。
- Coverage: `packages/tuffex/packages/components/src/no-selection/__tests__/no-selection.test.ts` 覆盖 wrapper 透传与 install 行为。

## 离线完整示例源码

- [NoSelectionNoSelectionDemo](../snapshot/apps/nexus/app/components/content/demos/NoSelectionNoSelectionDemo.vue.txt)

## 离线类型与实现参考

- [no-selection/index.ts](../snapshot/packages/tuffex/packages/components/src/no-selection/index.ts.txt)
- [src/TxNoSelection.vue](../snapshot/packages/tuffex/packages/components/src/no-selection/src/TxNoSelection.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/no-selection/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
