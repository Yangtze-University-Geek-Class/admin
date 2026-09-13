# Divider 分割线

> 内容分组、行内分隔与渐变透明分割

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/divider) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/divider.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/divider.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Divider 分割线

## 基础用法

### Basic Divider
水平分割线可以单独使用，也可以通过默认插槽显示文字。

官方示例：`DividerBasicDemo`（完整源码见本页末尾）

```vue
<template>
  <p>主要配置区域</p>
  <TxDivider />
  <p>高级配置区域</p>
  <TxDivider text-placement="left">高级选项</TxDivider>
  <TxDivider dashed text-placement="right">虚线分割</TxDivider>
</template>
```

## 渐变分割

### Gradient Divider
`gradient` 用于让分割线从某个区域到某个区域逐渐透明。`true` 等价于 `both`，也可以显式传入 `start`、`end`、`both`。

官方示例：`DividerGradientDemo`（完整源码见本页末尾）

```vue
<template>
  <TxDivider gradient="start" />
  <TxDivider gradient="end" />
  <TxDivider gradient />
  <TxDivider gradient text-placement="center">渐变标签</TxDivider>
</template>
```

## 垂直分割

### Vertical Divider
`direction="vertical"` 适合在标签、状态、元信息之间做行内分隔，也支持 `dashed` 和 `gradient`。

官方示例：`DividerVerticalDemo`（完整源码见本页末尾）

```vue
<template>
  <span>已发布</span>
  <TxDivider direction="vertical" />
  <span>平台团队</span>
  <TxDivider direction="vertical" dashed />
  <span>刚刚更新</span>
  <TxDivider direction="vertical" gradient />
  <span>渐变</span>
</template>
```

## API

### 属性

```yaml
rows:
  - name: direction
    description: '分割线方向'
    type: "'horizontal' | 'vertical'"
    default: "'horizontal'"
  - name: dashed
    description: '是否显示为虚线'
    type: 'boolean'
    default: 'false'
  - name: textPlacement
    description: '水平分割线文字位置'
    type: "'left' | 'center' | 'right'"
    default: "'center'"
  - name: gradient
    description: '渐变透明方向；true 等价于 both'
    type: "boolean | 'start' | 'end' | 'both'"
    default: 'false'
```

## Slots

```yaml
rows:
  - name: default
    description: '水平分割线中间的文字内容；垂直分割线不渲染插槽文字'
    type: '-'
    default: '-'
```

### Events

`TxDivider` 不派发组件事件。

## 交互契约

- 根节点使用 `role="separator"`，并根据 `direction` 设置 `aria-orientation`。
- 水平分割线默认占满容器宽度，文字只在水平模式渲染。
- `gradient="start"` 从起点透明到清晰，`gradient="end"` 从清晰到终点透明，`gradient` / `gradient="both"` 两端透明中间清晰。
- 垂直渐变使用纵向透明衰减，适合工具栏或元信息行。
- 需要 Drawer / Card / Form 内部分隔时优先使用 `TxDivider`，避免重复硬编码边框样式。

## 最佳实践

- 水平分割线用于分隔语义区块，不要给每一行都加分割线；密集表格和列表应使用行距或表格边框。
- 文字标签保持短句，只用于区块过渡；长文本应该改成真实标题而不是塞进分割线。
- 垂直分割线只用于行内元信息或工具栏，且周围文本必须已经提供上下文。

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/divider/src/TxDivider.vue` 确认 `role="separator"`、`aria-orientation`、仅水平模式渲染默认插槽文本、虚线样式和渐变模式。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/divider/__tests__/divider.test.ts` 覆盖水平文字、垂直模式忽略文字和渐变 class 模式。
- 导出入口:`packages/tuffex/packages/components/src/divider/index.ts` 使用 `withInstall` 包装组件并导出 `TxDividerInstance`。


## Source

## 离线完整示例源码

- [DividerBasicDemo](../snapshot/apps/nexus/app/components/content/demos/DividerBasicDemo.vue.txt)
- [DividerGradientDemo](../snapshot/apps/nexus/app/components/content/demos/DividerGradientDemo.vue.txt)
- [DividerVerticalDemo](../snapshot/apps/nexus/app/components/content/demos/DividerVerticalDemo.vue.txt)

## 离线类型与实现参考

- [divider/index.ts](../snapshot/packages/tuffex/packages/components/src/divider/index.ts.txt)
- [src/TxDivider.vue](../snapshot/packages/tuffex/packages/components/src/divider/src/TxDivider.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/divider/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
