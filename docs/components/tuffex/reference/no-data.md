# NoData 无数据

> 用于列表、表格、图表和指标面板没有记录时的快捷空状态。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/no-data) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/no-data.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/no-data.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# NoData 无数据

## 基础用法

### NoData
官方示例：`NoDataNoDataDemo`（完整源码见本页末尾）

```vue
<template>
  <TxNoData
    surface="card"
    title="暂无记录"
    description="创建第一条记录后，表格会在这里显示数据。"
    :primary-action="{ label: '创建记录', type: 'primary' }"
  />
</template>
```

## 交互契约

- 始终向 `TxEmptyState` 透传 `variant="no-data"`。
- 不覆盖显式传入的 `title`、`description`、`surface`、`layout`、`align`、`size`、`icon` 或 action props。
- `icon`、`title`、`description`、`actions` 插槽会原样转发给 `TxEmptyState`。
- 生成按钮触发的 `primary` / `secondary` 事件来自内部 `TxEmptyState`。

## API

### Props

`TxNoData` 接收除 `variant` 以外的所有 `EmptyStateProps` 字段。

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `title` | `string` | 预设标题 | 覆盖无数据状态标题。 |
| `description` | `string` | 预设描述 | 说明数据为什么为空，或如何填充数据。 |
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

### EmptyStateAction

| 字段 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `label` | `string` | 必填 | 按钮文案。 |
| `type` | `TxButtonProps['type']` | - | 按钮语义类型，例如 `primary`。 |
| `variant` | `TxButtonProps['variant']` | - | 按钮视觉变体。 |
| `size` | `TxButtonProps['size']` | `actionSize` | 单个按钮尺寸覆盖。 |
| `disabled` | `boolean` | `false` | 禁用生成按钮。 |
| `icon` | `string` | - | 按钮图标 class。 |

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

- 数据源有效且返回零记录时使用它；网络失败或权限不足应分别使用 `TxOfflineState` / `TxPermissionState`。
- 文案要指向具体数据，例如“暂无发票”比“没有内容”更清晰。
- 只有当前用户确实能创建或导入数据时才展示操作按钮。
- 仪表盘和表格面板内建议使用 `surface="card"`，让空态区域与加载后容器一致。

## 审阅说明 / Review Notes

- **Wrapper contract:** `TxNoData` 是很薄的 `TxEmptyState` wrapper，内部始终传入 `variant="no-data"`；其它 `EmptyStateProps` 字段保持原样透传。
- **状态选择:** 只在数据源已成功加载但记录数为零时使用。连接失败、权限不足、加载中与搜索无结果都有专门 wrapper，文案和恢复动作会更准确。
- **实测覆盖:** `no-data.test.ts` 覆盖固定 variant 透传、显式 props/actions、具名 slot 与 install 注册；基础渲染和 action 事件继承自 `TxEmptyState`。

## Source

- Component source: `packages/tuffex/packages/components/src/no-data/src/TxNoData.vue`。
- Base source: `packages/tuffex/packages/components/src/empty-state/src/TxEmptyState.vue`。
- Types: `packages/tuffex/packages/components/src/no-data/src/types.ts` 导出 `NoDataProps = Omit<EmptyStateProps, 'variant'>`。
- Coverage: `packages/tuffex/packages/components/src/no-data/__tests__/no-data.test.ts` 覆盖 variant 锁定、prop 透传、slot 透传与 install 行为。

## 离线完整示例源码

- [NoDataNoDataDemo](../snapshot/apps/nexus/app/components/content/demos/NoDataNoDataDemo.vue.txt)

## 离线类型与实现参考

- [no-data/index.ts](../snapshot/packages/tuffex/packages/components/src/no-data/index.ts.txt)
- [src/TxNoData.vue](../snapshot/packages/tuffex/packages/components/src/no-data/src/TxNoData.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/no-data/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
