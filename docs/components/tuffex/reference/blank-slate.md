# BlankSlate 空白页

> 用于首次进入、引导用户开始操作的较大空状态。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/blank-slate) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/blank-slate.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/blank-slate.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# BlankSlate 空白页

## 基础用法

### BlankSlate
官方示例：`BlankSlateBlankSlateDemo`（完整源码见本页末尾）

```vue
<template>
  <TxBlankSlate
    title="创建第一个项目"
    description="先创建项目，用于组织文档、审阅和自动化流程。"
    :primary-action="{ label: '创建项目', type: 'primary' }"
    :secondary-action="{ label: '查看指南' }"
  />
</template>
```

## 交互契约

- 始终向 `TxEmptyState` 透传 `variant="blank-slate"`。
- 默认值面向首次引导场景：`size="large"`、`layout="vertical"`、`surface="plain"`。
- 显式传入 `size`、`layout`、`surface` 时会覆盖这些默认值。
- `icon`、`title`、`description`、`actions` 插槽会原样转发给 `TxEmptyState`。
- 生成按钮触发的 `primary` / `secondary` 事件来自内部 `TxEmptyState`。

## API

### Props

`TxBlankSlate` 接收除 `variant` 以外的所有 `EmptyStateProps` 字段。

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `title` | `string` | 预设标题 | 首次引导标题。 |
| `description` | `string` | 预设描述 | 说明第一步操作的价值。 |
| `icon` | `TxIconSource \| string \| null` | 预设插画 | 自定义图标源/class，或传 `null` 隐藏图标区域。 |
| `iconSize` | `number` | 尺寸预设 | 自定义图标像素尺寸。 |
| `layout` | `'vertical' \| 'horizontal'` | `'vertical'` | 空状态布局。 |
| `align` | `'start' \| 'center' \| 'end'` | `'center'` | 内容对齐方式。 |
| `size` | `'small' \| 'medium' \| 'large'` | `'large'` | 密度和插画尺寸。 |
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

- 首次使用或 onboarding 空态使用它；重复出现的空查询结果用 `TxNoData`。
- 文案要解释第一步的价值，不只是说明“这里没有内容”。
- 主操作保持单一且直接；次操作可用于查看指南、导入或跳过。
- 全页面空白页一般保持 `surface="plain"`，除非外层布局已经统一使用卡片容器。


## 审阅说明

- 已核对 `packages/tuffex/packages/components/src/blank-slate/src/TxBlankSlate.vue`、`types.ts` 与 `blank-slate.test.ts`。
- **实测覆盖:** `blank-slate.test.ts` 覆盖固定 `variant="blank-slate"`、首次引导默认值、显式布局覆盖、命名插槽转发与 install 注册。
- 可访问性说明：`TxBlankSlate` 将语义交给 `TxEmptyState`；第一步文案应具体，`actions` 中不要放入多个互相竞争的主操作。

## Source

- Component source: `packages/tuffex/packages/components/src/blank-slate/src/TxBlankSlate.vue`.
- Types: `packages/tuffex/packages/components/src/blank-slate/src/types.ts` exports `BlankSlateProps` as `Omit<EmptyStateProps, 'variant'>`.
- Coverage: `packages/tuffex/packages/components/src/blank-slate/__tests__/blank-slate.test.ts` verifies wrapper defaults, overrides, slot forwarding, and install registration.

## 离线完整示例源码

- [BlankSlateBlankSlateDemo](../snapshot/apps/nexus/app/components/content/demos/BlankSlateBlankSlateDemo.vue.txt)

## 离线类型与实现参考

- [blank-slate/index.ts](../snapshot/packages/tuffex/packages/components/src/blank-slate/index.ts.txt)
- [src/TxBlankSlate.vue](../snapshot/packages/tuffex/packages/components/src/blank-slate/src/TxBlankSlate.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/blank-slate/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
