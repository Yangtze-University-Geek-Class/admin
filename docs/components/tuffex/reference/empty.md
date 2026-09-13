# Empty 空状态

> 用于面板、筛选结果和基础占位的紧凑空状态封装。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/empty) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/empty.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/empty.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Empty 空状态

## 基础用法

### Empty
官方示例：`EmptyEmptyDemo`（完整源码见本页末尾）

```vue
<template>
  <TxEmpty title="没有匹配结果" description="调整筛选条件或清空关键字后再试。" icon-class="i-carbon-search" compact />
</template>
```

## 带操作

### Empty (action)
官方示例：`EmptyEmptyActionDemo`（完整源码见本页末尾）

```vue
<template>
  <TxEmpty title="还没有项目" description="创建第一个项目后，可以在这里统一管理。">
    <template #action>
      <TxButton type="primary">新建项目</TxButton>
    </template>
  </TxEmpty>
</template>
```

## 交互契约

- 始终用 `variant="empty"`、`surface="card"`、`layout="vertical"` 渲染内部 `TxEmptyState`。
- `compact=false` 映射为 `size="medium"`；`compact=true` 映射为 `size="small"`。
- `iconClass` 会作为内部空状态的 `icon` prop 透传。
- 插槽刻意比 `TxEmptyState` 简化：`action` 是单数，并替换内部 `actions` 插槽。
- `TxEmpty` 不发出事件；操作行为由 `action` 插槽里的控件负责。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `title` | `string` | `'Nothing here'` | 空状态主文案。 |
| `description` | `string` | `''` | 标题下方的辅助说明。 |
| `iconClass` | `string` | `'i-carbon-incomplete'` | 透传给内部 `TxEmptyState` 的图标 class。 |
| `compact` | `boolean` | `false` | 密集面板使用 small 尺寸。 |

### Events

`TxEmpty` 不派发组件事件。点击处理应放在 `action` 插槽内渲染的控件上。

## Slots

| 插槽名 | Props | 说明 |
|------|------|------|
| `icon` | - | 替换 `iconClass` 渲染的图标。 |
| `title` | - | 替换 `title` prop 内容。 |
| `description` | - | 替换 `description` prop 内容。 |
| `action` | - | 替换内部 `TxEmptyState` 的 actions 区域。 |

## 最佳实践

- 适用于列表、搜索结果或面板占位，且需要卡片表面时使用 `TxEmpty`。
- 空原因有产品语义时，优先使用更明确的 `TxNoData`、`TxNoSelection`、`TxOfflineState` 或 `TxPermissionState`。
- 侧栏、表格内部等密集区域使用 `compact`。
- 点击逻辑放在 `action` 插槽里的控件上；`TxEmpty` 不代理 action 事件。

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/empty/src/TxEmpty.vue` 确认 `TxEmptyState` 封装、强制 `variant="empty"`、`surface="card"`、`layout="vertical"`、紧凑尺寸映射和插槽重映射。
- 类型契约:`packages/tuffex/packages/components/src/empty/src/types.ts` 定义紧凑 `EmptyProps` 表面。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/empty/__tests__/empty.test.ts` 覆盖默认 prop 透传、紧凑尺寸和 wrapper 到 empty-state 的插槽映射。
- 导出入口:`packages/tuffex/packages/components/src/empty/index.ts` 导出 `Empty`、`TxEmpty`、`EmptyProps` 和 `TxEmptyInstance`。

## Source

## 离线完整示例源码

- [EmptyEmptyDemo](../snapshot/apps/nexus/app/components/content/demos/EmptyEmptyDemo.vue.txt)
- [EmptyEmptyActionDemo](../snapshot/apps/nexus/app/components/content/demos/EmptyEmptyActionDemo.vue.txt)

## 离线类型与实现参考

- [empty/index.ts](../snapshot/packages/tuffex/packages/components/src/empty/index.ts.txt)
- [src/TxEmpty.vue](../snapshot/packages/tuffex/packages/components/src/empty/src/TxEmpty.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/empty/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
