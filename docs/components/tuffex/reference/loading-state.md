# LoadingState 加载态

> 用于加载中占位展示。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/loading-state) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/loading-state.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/loading-state.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# LoadingState 加载态

## 基础用法

### LoadingState
官方示例：`LoadingStateLoadingStateDemo`（完整源码见本页末尾）

```vue
<template>
  <TxLoadingState title="正在加载插件" description="正在同步官方插件和权限..." />
</template>
```

## 后台恢复状态

加载态建议占用与空态/错误态相同的容器尺寸，避免列表区域在请求完成后跳动。

官方示例：`ComponentsRecoveryStatesDemo`（完整源码见本页末尾）

```vue
<template>
  <TxLoadingState
    title="正在加载规则"
    description="正在同步团队自动化规则，请稍等。"
    surface="card"
    size="large"
  />
</template>
```

## API

`TxLoadingState` 继承 `TxEmptyState` 除 `variant` 以外的 Props、Slots 和 Events；组件内部始终传入 `variant="loading"`。

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `title` | `string` | `Loading` | 覆盖预设加载标题。 |
| `description` | `string` | `Please wait a moment.` | 覆盖加载说明文案。 |
| `icon` | `TxIconSource \| string \| null` | - | 替换加载插画；传 `null` 可隐藏图标区域（`loading` 为 `true` 时无效，此时仍显示加载指示器）。 |
| `iconSize` | `number` | - | 自定义图标或 spinner 尺寸。 |
| `layout` | `'vertical' \| 'horizontal'` | `'vertical'` | 控制图标与内容的排列方向。 |
| `align` | `'start' \| 'center' \| 'end'` | `'center'` | 控制图标、文案和操作区对齐。 |
| `size` | `'small' \| 'medium' \| 'large'` | `'medium'` | 调整间距、字号和插画尺寸。 |
| `surface` | `'plain' \| 'card'` | `'plain'` | 为需要占位的面板增加边框容器。 |
| `primaryAction` | `EmptyStateAction` | - | 渲染主操作并触发 `primary`。 |
| `secondaryAction` | `EmptyStateAction` | - | 在主操作前渲染次操作并触发 `secondary`。 |
| `actionSize` | `TxButtonProps['size']` | `'small'` | 生成操作按钮的默认尺寸。 |
| `loading` | `boolean` | `false` | 未提供自定义图标插槽或图标 prop 时显示 spinner。 |

### Slots

| 名称 | 说明 |
|------|------|
| `icon` | 替换预设加载插画或 spinner。 |
| `title` | 替换解析后的标题内容。 |
| `description` | 替换解析后的说明内容。 |
| `actions` | 替换生成的主/次操作按钮。 |

### Events

| 事件名 | 说明 |
|------|------|
| `primary` | 点击生成的主操作按钮时触发。 |
| `secondary` | 点击生成的次操作按钮时触发。 |

## 交互契约

- `TxLoadingState` 始终向 `TxEmptyState` 透传 `variant="loading"`。
- 组件不额外改写 `title`、`description`、`loading` 或 action 配置；显式 props 会原样透传。
- `icon`、`title`、`description`、`actions` 插槽会原样转发给 `TxEmptyState`。

## 最佳实践

- `TxLoadingState` 适合首屏或整块数据面板加载，最终的空态/错误态/成功内容应占用同一块区域。
- 文案要具体说明正在加载的资源，例如“正在加载规则”或“正在同步插件”。
- 外层布局在加载时可能塌陷时，优先使用 `surface="card"` 预留容器高度。
- 只有需要 spinner 替代预设加载插画时才传 `loading`。
- 谨慎放置操作按钮；只有底层请求真的支持取消或重试时，才提供取消/重试动作。

## Source

- Component source: `packages/tuffex/packages/components/src/loading-state/src/TxLoadingState.vue`。
- Base source: `packages/tuffex/packages/components/src/empty-state/src/TxEmptyState.vue`。
- Types: `packages/tuffex/packages/components/src/loading-state/src/types.ts` 导出 `LoadingStateProps = Omit<EmptyStateProps, 'variant'>`。
- **实测覆盖:** `packages/tuffex/packages/components/src/loading-state/__tests__/loading-state.test.ts` 验证 loading variant 锁定、显式 props 与 action 透传、具名 slots 转发及 install 注册。



## 审阅说明

- **Wrapper contract:** `TxLoadingState` 锁定 `variant="loading"`；只有需要基础 spinner 插图替代默认 loading 插图时才传入 `loading`。
- **建议:** 首屏整块加载用 `TxLoadingState`，局部行内等待用 `TxSpinner` 或 `TxProgressBar loading`。
- **可访问性:** 加载说明需要写明正在加载什么，例如“正在加载规则”，不要只写“Loading”。

## 离线完整示例源码

- [LoadingStateLoadingStateDemo](../snapshot/apps/nexus/app/components/content/demos/LoadingStateLoadingStateDemo.vue.txt)
- [ComponentsRecoveryStatesDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsRecoveryStatesDemo.vue.txt)

## 离线类型与实现参考

- [loading-state/index.ts](../snapshot/packages/tuffex/packages/components/src/loading-state/index.ts.txt)
- [src/TxLoadingState.vue](../snapshot/packages/tuffex/packages/components/src/loading-state/src/TxLoadingState.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/loading-state/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
