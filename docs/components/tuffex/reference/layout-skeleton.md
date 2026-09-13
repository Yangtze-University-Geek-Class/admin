# LayoutSkeleton 布局骨架

> 布局级骨架占位

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/layout-skeleton) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/layout-skeleton.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/layout-skeleton.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# LayoutSkeleton 布局骨架

## 基础用法

### 布局占位
容器决定骨架尺寸。
官方示例：`LayoutSkeletonLayoutPlaceholderDemo`（完整源码见本页末尾）

```vue
<template>
  <div style="height: 240px;">
    <TxLayoutSkeleton />
  </div>
</template>
```

### 面板占位
布局骨架搭配卡片容器使用。
官方示例：`LayoutSkeletonPanelPlaceholderDemo`（完整源码见本页末尾）

```vue
<template>
  <TxCard>
    <TxLayoutSkeleton />
  </TxCard>
</template>
```

## API

### Props
```yaml
rows:
  - name: '—'
    type: '-'
    default: '-'
    description: '无额外 props，尺寸由容器决定'
```

### Events

`TxLayoutSkeleton` 不会 emit 自定义事件。

### Slots

`TxLayoutSkeleton` 不暴露插槽。组件始终渲染下方记录的固定布局骨架。

## 交互契约

- `TxLayoutSkeleton` 无 props、events 或 slots。
- 组件固定渲染 header、6 个 sidebar item 与 8 条内容行。
- 内容行宽度是确定性的，不依赖运行时随机数。
- 根节点是 `aria-hidden="true"`，装饰性骨架不进入无障碍树。页面/面板的加载态应由宿主播报（例如区域上的 `aria-busy`），就绪后再切换到真实内容。

## 最佳实践

- 外层容器必须给出明确高度；组件只填满 `width: 100%` 与 `height: 100%`，不会替页面决定尺寸。
- 页面、面板、侧边摘要和详情栏加载时，如果最终布局形状稳定，可以使用它保持结构预期。
- 不要把它当作表格行占位。表格主体应使用 `TxSkeleton`、行级占位或 `TxDataTable loading`。
- 保持文档、SSR、hydration 与视觉测试的确定性；内容行宽度刻意使用固定序列，而不是运行时随机数。

## 审阅说明

- 已对照 `packages/tuffex/packages/components/src/layout-skeleton/src/TxLayoutSkeleton.vue` 与 `layout-skeleton.test.ts` 核对。
- **实测覆盖:** 固定骨架结构、装饰性 `aria-hidden` 根节点、6 个 sidebar item、8 条内容行、确定性内容宽度和 install 注册。
- API 说明：该组件有意不提供 props。尺寸、比例和位置必须由父容器决定。
- 渲染说明：内容行宽度是固定值，不使用随机数，因此 SSR、hydration、文档快照和视觉测试保持稳定。

## Source

- Component source: `packages/tuffex/packages/components/src/layout-skeleton/src/TxLayoutSkeleton.vue`.
- Types: `packages/tuffex/packages/components/src/layout-skeleton/index.ts` exports `TxLayoutSkeletonInstance`.
- Coverage: `packages/tuffex/packages/components/src/layout-skeleton/__tests__/layout-skeleton.test.ts` verifies fixed scaffold counts, deterministic content widths, and install registration.

## 离线完整示例源码

- [LayoutSkeletonLayoutPlaceholderDemo](../snapshot/apps/nexus/app/components/content/demos/LayoutSkeletonLayoutPlaceholderDemo.vue.txt)
- [LayoutSkeletonPanelPlaceholderDemo](../snapshot/apps/nexus/app/components/content/demos/LayoutSkeletonPanelPlaceholderDemo.vue.txt)

## 离线类型与实现参考

- [layout-skeleton/index.ts](../snapshot/packages/tuffex/packages/components/src/layout-skeleton/index.ts.txt)
- [src/TxLayoutSkeleton.vue](../snapshot/packages/tuffex/packages/components/src/layout-skeleton/src/TxLayoutSkeleton.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
