# Kbd

> 用于命令提示与菜单快捷键的键盘 token。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/kbd) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/kbd.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/kbd.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Kbd

## 基础用法

### Kbd
官方示例：`KbdKbdDemo`（完整源码见本页末尾）

```vue
<template>
  <span class="flex items-center gap-1">
    <TxKbd tone="primary">⌘</TxKbd>
    <TxKbd tone="primary">K</TxKbd>
  </span>
</template>
```

## 交互契约

- 根节点是 `<kbd>`，保留原生键盘提示语义。
- `size="sm"` 是默认紧凑尺寸，适合行内帮助和菜单快捷键。
- `tone="primary"` 用于突出产品主快捷键，不改变插槽文本。
- 组件没有事件，也没有内部状态。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `size` | `'sm' \| 'md'` | `'sm'` | Token 尺寸：`sm`（默认）用于行内帮助与菜单快捷键；`md` 字号更大，用于独立展示的快捷键。 |
| `tone` | `'default' \| 'primary'` | `'default'` | 视觉色调：`primary` 仅用于页面或命令的主快捷键，同屏不宜超过一组。 |

### Events

`TxKbd` 不派发组件事件。

## Slots

| 插槽名 | Props | 说明 |
|------|------|------|
| `default` | - | 键位文本，例如 `⌘`、`Ctrl` 或 `K`。 |

## 最佳实践

- 组合键建议拆成多个 `TxKbd`，不要用一个长字符串承载全部内容。
- 宿主文案应感知平台：macOS 使用 `⌘`，Windows/Linux 使用 `Ctrl`。
- `tone="primary"` 只用于页面或命令里的主快捷键。
- 快捷键应配合可见操作文案，单独出现不够可发现。

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/kbd/src/TxKbd.vue` 确认语义化 `<kbd>` 根节点、`size` / `tone` class 和仅默认插槽内容。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/kbd/__tests__/kbd.test.ts` 覆盖快捷键内容、根标签和变体 class。
- 导出入口:`packages/tuffex/packages/components/src/kbd/index.ts` 使用 `withInstall` 包装组件并导出 `TxKbdInstance`。

## Source

## 离线完整示例源码

- [KbdKbdDemo](../snapshot/apps/nexus/app/components/content/demos/KbdKbdDemo.vue.txt)

## 离线类型与实现参考

- [kbd/index.ts](../snapshot/packages/tuffex/packages/components/src/kbd/index.ts.txt)
- [src/TxKbd.vue](../snapshot/packages/tuffex/packages/components/src/kbd/src/TxKbd.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/kbd/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
