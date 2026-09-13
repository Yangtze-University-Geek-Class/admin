# Thinking Orb

> Canvas 绘制的思考指示球，同屏共相位、离屏自动停摆。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/thinking-orb) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/thinking-orb.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/thinking-orb.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Thinking Orb

## 基础用法

### Thinking Orb
官方示例：`ThinkingOrbThinkingOrbDemo`（完整源码见本页末尾）

```vue
<template>
  <TxThinkingOrb />
  <TxThinkingOrb state="searching" :size="64" />
  <TxThinkingOrb state="solving" :size="20" :display-size="14" />
</template>
```

## 交互契约

- `state` 默认为 `'random'`：形态在**挂载时**掷一次，此后终生不变。要换一颗球，就重建组件（换 `key`），而不是改 prop。
- 9 种形态为 `working`、`searching`、`solving`、`listening`、`connecting`、`weaving`、`composing`、`breathing`、`shaping`。
- 所有已挂载的球共用同一个时钟（`performance.now`），因此同屏多颗球**天然同相位**，不会各转各的。
- 离屏时通过 `IntersectionObserver` 停止绘制，标签页隐藏时同样停摆——长列表里挂很多颗不会持续吃 CPU。
- 用户开启「减少动态效果」时不播放动画，改为绘制一帧有代表性的静止画面；主题切换仍会跟随。
- `size` 只接受 `20` 与 `64`：预设的几何参数是按这两个尺寸手工调过的。要显示成别的尺寸请用 `displaySize`，它只改 CSS 尺寸，不改绘制参数。
- 画布按 `devicePixelRatio` 提升分辨率，上限为 2。
- 无 canvas 环境（如 jsdom）下 `getContext('2d')` 返回空，组件保留元素但跳过绘制，不会抛错。
- 可访问名称默认按形态给出英文文案（如 `Searching…`），`label` 可覆盖。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `state` | `OrbState \| 'random'` | `'random'` | 球的形态；`'random'` 在挂载时掷一次。 |
| `size` | `20 \| 64` | `20` | 预设几何尺寸。仅这两个值经过调校。 |
| `displaySize` | `number` | 同 `size` | 实际渲染的 CSS 尺寸（px），不影响绘制参数。 |
| `speed` | `number` | `1` | 动画速度倍率。 |
| `paused` | `boolean` | `false` | 是否暂停动画。 |
| `theme` | `'auto' \| 'dark' \| 'light'` | `'auto'` | 配色主题；`auto` 跟随环境。 |
| `label` | `string` | 按形态的英文文案 | 可访问名称。 |

### Events

`TxThinkingOrb` 不派发组件事件。

## Slots

`TxThinkingOrb` 不暴露插槽。它是一个纯绘制元素，文案请放在相邻节点上。

## 最佳实践

- 想让每次思考都换一颗球，就给组件绑定与该次思考对应的 `key`；改 `state` 是没用的。
- 需要固定形态时显式传 `state`，不要依赖随机——否则截图测试与录屏每次都不一样。
- `size` 只传 `20` 或 `64`，视觉尺寸用 `displaySize` 调；直接传别的值会让预设失真。
- 中文界面记得传 `label`，默认文案是英文。
- 一次思考只挂一颗球。多颗虽然同相位，但会让「正在进行」的语义变得含糊。

## 离线完整示例源码

- [ThinkingOrbThinkingOrbDemo](../snapshot/apps/nexus/app/components/content/demos/ThinkingOrbThinkingOrbDemo.vue.txt)

## 离线类型与实现参考

- [thinking-orb/index.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/index.ts.txt)
- [src/TxThinkingOrb.vue](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/TxThinkingOrb.vue.txt)
- [engine/braid.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/engine/braid.ts.txt)
- [engine/core.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/engine/core.ts.txt)
- [engine/lattice.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/engine/lattice.ts.txt)
- [engine/morph.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/engine/morph.ts.txt)
- [engine/orbits.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/engine/orbits.ts.txt)
- [engine/profiles.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/engine/profiles.ts.txt)
- [engine/registry.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/engine/registry.ts.txt)
- [engine/ribbon.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/engine/ribbon.ts.txt)
- [engine/types.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/engine/types.ts.txt)
- [engine/web.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/engine/web.ts.txt)
- [src/presets.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/presets.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/thinking-orb/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
