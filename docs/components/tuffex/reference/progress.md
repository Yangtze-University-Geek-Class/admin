# Progress 进度

> 围绕 TxProgressBar 的轻量封装，用于标准线性进度行。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/progress) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/progress.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/progress.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Progress 进度

## Demo

### 进度状态

官方示例：`ProgressProgressStatesDemo`（完整源码见本页末尾）

```vue
<template>
  <TuffProgress :percentage="40" />
  <TuffProgress :percentage="72" status="warning" />
  <TuffProgress :percentage="100" status="success" />
</template>
```

### 进度行

官方示例：`ProgressProgressRowDemo`（完整源码见本页末尾）

```vue
<template>
  <TuffProgress :percentage="60" />
  <TxStatusBadge text="进行中" status="warning" />
</template>
```

## 组合示例

### 自定义文本格式

```vue
<template>
  <TuffProgress :percentage="42" :format="value => `完成 ${value}%`" />
</template>
```

### 不确定进度

```vue
<template>
  <TuffProgress indeterminate :percentage="60" :show-text="false" />
</template>
```

未知时长任务应使用不确定状态，而不是展示虚假的百分比。

## 交互契约

- `TuffProgress` 渲染 `TxProgressBar`，自身不增加额外 wrapper DOM。
- `percentage`、`status`、`indeterminate`、`showText` 和 `format` 会直接转发。
- `strokeWidth` 会转换为类似 `"6px"` 的 CSS 高度字符串，并作为 `height` 传入。
- 文本位置固定为 `outside`。
- 底层进度条使用 `maskVariant="plain"`，轨道跟随 `TxProgressBar` 的默认样式（无描边平铺轨道、渐变填充）。
- 确定进度通过 `TxProgressBar` 暴露 `role="progressbar"` 和 `aria-valuenow`。
- 不确定进度会省略 `aria-valuenow`，并应用进度条的不确定状态类。
- 安装入口注册组件名 `TuffProgress`。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `percentage` | `number` | `0` | 转发给 `TxProgressBar` 的确定进度值。 |
| `status` | `'success' \| 'error' \| 'warning' \| ''` | `''` | 转发给 `TxProgressBar` 的视觉状态色。 |
| `strokeWidth` | `number` | `6` | 进度条像素高度。 |
| `showText` | `boolean` | `true` | 显示外部进度文本。 |
| `indeterminate` | `boolean` | `false` | 启用不确定进度模式。 |
| `format` | `(percentage: number) => string` | - | 自定义确定进度显示文本。 |

### Events

`TuffProgress` 不派发组件事件。请监听宿主任务状态变化，并通过 props 更新进度。

## Slots

`TuffProgress` 不暴露插槽。文本定制使用 `format`；布局需要自定义内容时直接使用 `TxProgressBar`。

## 最佳实践

- 简单行级进度且需要旧公共名称和紧凑 API 时使用 `TuffProgress`。
- 需要分段、tooltip、message、loading/success/error 布尔状态、动效或自定义文本位置时，直接使用 `TxProgressBar`。
- `strokeWidth` 保持克制；该封装适合行级进度，不适合英雄指标。
- 不要为未知工作展示过期百分比。使用 `indeterminate`，除非有可信数值，否则隐藏文本。
- 周围 UI 需要操作上下文时，把进度条与简短状态标签组合使用。

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/progress/src/TxProgress.vue` 确认封装直接渲染 `TxProgressBar`，并把 `strokeWidth` 映射为 `height`。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/progress/__tests__/progress.test.ts` 覆盖状态透传、自定义格式化、`strokeWidth`、隐藏文本和不确定进度 ARIA 行为。
- 导出入口:`packages/tuffex/packages/components/src/progress/index.ts` 注册公共组件名 `TuffProgress`。

## Source

## 离线完整示例源码

- [ProgressProgressStatesDemo](../snapshot/apps/nexus/app/components/content/demos/ProgressProgressStatesDemo.vue.txt)
- [ProgressProgressRowDemo](../snapshot/apps/nexus/app/components/content/demos/ProgressProgressRowDemo.vue.txt)

## 离线类型与实现参考

- [progress/index.ts](../snapshot/packages/tuffex/packages/components/src/progress/index.ts.txt)
- [src/TxProgress.vue](../snapshot/packages/tuffex/packages/components/src/progress/src/TxProgress.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/progress/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
