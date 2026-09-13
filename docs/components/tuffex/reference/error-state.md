# ErrorState 错误状态

> 错误场景的快捷空态组件，基于 TxEmptyState 的 `variant=\"error\"` 预设。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/error-state) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/error-state.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/error-state.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`2.4.7`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# ErrorState 错误状态

## 基础用法

使用默认标题和描述，搭配操作按钮。

### ErrorState (basic)
官方示例：`ErrorStateBasicDemo`（完整源码见本页末尾）

```vue
<template>
  <TxErrorState
    :primary-action="{ label: 'Retry', type: 'primary' }"
    :secondary-action="{ label: 'Go Back' }"
  />
</template>
```

## 自定义内容

通过 props 覆盖默认标题、描述，配合 `surface="card"` 呈现卡片风格。

### ErrorState (custom)
官方示例：`ErrorStateCustomDemo`（完整源码见本页末尾）

```vue
<template>
  <TxErrorState
    title="Failed to load data"
    description="The server returned error 500. Please check your network and try again."
    surface="card"
    :primary-action="{ label: 'Retry', type: 'primary' }"
  />
</template>
```

## 后台恢复状态

错误态应与加载态、空态共用一个数据容器，并提供明确恢复动作，避免只展示红色报错。

官方示例：`ComponentsRecoveryStatesDemo`（完整源码见本页末尾）

```vue
<template>
  <TxErrorState
    title="规则加载失败"
    description="服务暂时不可用，请重试或检查后台日志。"
    surface="card"
    :primary-action="{ label: '重试', type: 'primary', icon: 'i-carbon-renew' }"
    :secondary-action="{ label: '查看教程', icon: 'i-carbon-help' }"
  />
</template>
```

## API

`TxErrorState` 继承 `TxEmptyState` 除 `variant` 之外的全部 props；`variant` 始终强制为 `error`。完整基础组件契约见 [EmptyState](./empty-state.md)。

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `title` | `string` | `'Something went wrong'` | 错误标题。建议写明失败对象或操作。 |
| `description` | `string` | `'Please try again later.'` | 辅助说明和恢复建议。 |
| `icon` | `TxIconSource \| string \| null` | variant 默认值 | 自定义图标；设为 `null` 可关闭继承图标。 |
| `iconSize` | `number` | 按 `size` 派生 | 透传给 `TxEmptyState` 的图标尺寸；缺省时按 `size` 取 28 / 36 / 44（small / medium / large）。 |
| `layout` | `'vertical' \| 'horizontal'` | `'vertical'` | 布局方向。 |
| `align` | `'start' \| 'center' \| 'end'` | `'center'` | 内容对齐方式。 |
| `size` | `'small' \| 'medium' \| 'large'` | `'medium'` | 尺寸等级。 |
| `surface` | `'plain' \| 'card'` | `'plain'` | 表面样式。 |
| `primaryAction` | `EmptyStateAction` | - | 主恢复动作配置。 |
| `secondaryAction` | `EmptyStateAction` | - | 次要动作配置。 |
| `actionSize` | `TxButtonProps['size']` | `'small'` | 生成按钮的尺寸；默认沿用 `TxEmptyState` 的 `small`。 |
| `loading` | `boolean` | `false` | 透传给生成操作按钮的加载态。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `primary` | - | 点击生成的主按钮时由 `TxEmptyState` 透传。 |
| `secondary` | - | 点击生成的次按钮时由 `TxEmptyState` 透传。 |

## Slots

| 插槽 | 参数 | 说明 |
|------|------|------|
| `icon` | - | 替换继承的错误图标。 |
| `title` | - | 替换 `title` prop 的渲染。 |
| `description` | - | 替换 `description` prop 的渲染。 |
| `actions` | - | 替换自动生成的主/次操作按钮。 |

## 交互契约

- `TxErrorState` 始终向 `TxEmptyState` 透传 `variant="error"`。
- 组件不额外改写 `title`、`description`、`surface`、action 配置或插槽；显式 props 和 slots 会原样透传。
- 组件不持有重试逻辑。它只透传继承的 action 事件，或渲染自定义 `actions` 插槽，业务逻辑由宿主处理。

## 最佳实践

- `title` 应写明失败对象，例如“规则加载失败”，不要只写“出错了”。
- 始终提供恢复路径：重试、返回上级、打开日志或联系支持。
- 错误态替换一个数据面板时使用 `surface="card"`；已经位于卡片容器中时保持默认 plain surface。
- 技术细节放进日志或可展开诊断区域；默认描述应告诉用户下一步能做什么。
- 只有生成的 `primaryAction` / `secondaryAction` 无法表达恢复流程时，才使用 `actions` 插槽。

## 审阅说明

- 组件源码：`packages/tuffex/packages/components/src/error-state/src/TxErrorState.vue` 确认组件只把 props 绑定给 `TxEmptyState`，并强制 `variant="error"`。
- 类型契约：`packages/tuffex/packages/components/src/error-state/src/types.ts` 定义 `ErrorStateProps = Omit<EmptyStateProps, 'variant'>`。
- 基础 props/events：`packages/tuffex/packages/components/src/empty-state/src/types.ts` 定义继承的 props、action 结构和 `primary` / `secondary` 事件。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/error-state/__tests__/error-state.test.ts` 覆盖强制 error variant、props 透传、具名插槽透传和 install 注册。

## Source

## 离线完整示例源码

- [ErrorStateBasicDemo](../snapshot/apps/nexus/app/components/content/demos/ErrorStateBasicDemo.vue.txt)
- [ErrorStateCustomDemo](../snapshot/apps/nexus/app/components/content/demos/ErrorStateCustomDemo.vue.txt)
- [ComponentsRecoveryStatesDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsRecoveryStatesDemo.vue.txt)

## 离线类型与实现参考

- [error-state/index.ts](../snapshot/packages/tuffex/packages/components/src/error-state/index.ts.txt)
- [src/TxErrorState.vue](../snapshot/packages/tuffex/packages/components/src/error-state/src/TxErrorState.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/error-state/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
