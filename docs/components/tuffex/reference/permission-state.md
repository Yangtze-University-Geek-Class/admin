# PermissionState 权限不足

> 用于权限不足、未授权访问和受限工作区的快捷空状态。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/permission-state) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/permission-state.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/permission-state.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# PermissionState 权限不足

## 基础用法

### PermissionState
官方示例：`PermissionStatePermissionStateDemo`（完整源码见本页末尾）

```vue
<template>
  <TxPermissionState
    surface="card"
    title="需要访问权限"
    description="当前账号没有查看此工作区的权限，请向管理员申请访问。"
    :primary-action="{ label: '申请权限', type: 'primary' }"
  />
</template>
```

## 交互契约

- 始终向 `TxEmptyState` 透传 `variant="permission"`。
- 不覆盖显式传入的 `title`、`description`、`surface`、`layout`、`align`、`size`、`icon` 或 action props。
- `icon`、`title`、`description`、`actions` 插槽会原样转发给 `TxEmptyState`。
- 生成按钮触发的 `primary` / `secondary` 事件来自内部 `TxEmptyState`。

## API

### Props

`TxPermissionState` 接收除 `variant` 以外的所有 `EmptyStateProps` 字段。

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `title` | `string` | 预设标题 | 覆盖权限状态标题。 |
| `description` | `string` | 预设描述 | 说明访问要求和下一步。 |
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

- 只在宿主已经确认访问被拒绝后使用；组件本身不做权限判断。
- 说明哪个资源受限，以及谁可以授权。
- 有申请流程时优先提供“申请权限”主操作；否则指向切换工作区或帮助文档。
- 用户未授权时，不要在标题或描述里泄露敏感资源细节。

## 审阅说明 / Review Notes

- **Wrapper contract:** `TxPermissionState` 锁定 `variant="permission"`，并透传其它 empty-state props 与 slot；它本身不执行权限判断。
- **安全说明:** 宿主必须先完成授权判定再渲染该组件。文案应足够泛化，避免泄露受限资源细节。
- **实测覆盖:** `permission-state.test.ts` 验证 variant 锁定、action prop 透传、slot 透传与 install 注册。

## Source

- Component source: `packages/tuffex/packages/components/src/permission-state/src/TxPermissionState.vue`。
- Base source: `packages/tuffex/packages/components/src/empty-state/src/TxEmptyState.vue`。
- Types: `packages/tuffex/packages/components/src/permission-state/src/types.ts` 导出 `PermissionStateProps = Omit<EmptyStateProps, 'variant'>`。
- Coverage: `packages/tuffex/packages/components/src/permission-state/__tests__/permission-state.test.ts` 覆盖 wrapper 透传与 install 行为。

## 离线完整示例源码

- [PermissionStatePermissionStateDemo](../snapshot/apps/nexus/app/components/content/demos/PermissionStatePermissionStateDemo.vue.txt)

## 离线类型与实现参考

- [permission-state/index.ts](../snapshot/packages/tuffex/packages/components/src/permission-state/index.ts.txt)
- [src/TxPermissionState.vue](../snapshot/packages/tuffex/packages/components/src/permission-state/src/TxPermissionState.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/permission-state/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
