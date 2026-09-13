# LoadingOverlay 加载遮罩

> 用于在内容区域或全屏展示加载遮罩。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/loading-overlay) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/loading-overlay.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/loading-overlay.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# LoadingOverlay 加载遮罩

<script setup lang="ts">
import { ref } from 'vue'

const loading = ref(false)
</script>

## 容器内遮罩

### LoadingOverlay (container)
官方示例：`LoadingOverlayLoadingOverlayContainerDemo`（完整源码见本页末尾）

```vue
<template>
  <TxButton @click="loading = !loading">Toggle</TxButton>
  <TxLoadingOverlay :loading="loading" text="Loading...">
    <div style="height: 120px; display: flex; align-items: center; justify-content: center;">Content</div>
  </TxLoadingOverlay>
</template>
```

## 全屏遮罩

### LoadingOverlay (fullscreen)
官方示例：`LoadingOverlayLoadingOverlayFullscreenDemo`（完整源码见本页末尾）

```vue
<template>
  <TxButton @click="loading = !loading">Toggle</TxButton>
  <TxLoadingOverlay fullscreen :loading="loading" text="Loading..." />
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `loading` | `boolean` | `false` | 是否显示遮罩。 |
| `fullscreen` | `boolean` | `false` | 是否 teleport 到 `body` 并覆盖整个视口。 |
| `text` | `string` | `''` | 显示在 spinner 下方的可选文案。 |
| `spinnerSize` | `number` | `18` | spinner 尺寸，单位 px。 |
| `background` | `string` | `'color-mix(in srgb, var(--tx-bg-color, #fff) 70%, transparent)'` | 遮罩层使用的 CSS 背景。 |

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| - | - | 没有组件自定义事件，通过 `loading` prop 控制显隐。 |

### Slots

| 插槽名 | Props | 说明 |
|------|-------|------|
| `default` | - | `fullscreen=false` 时渲染在局部遮罩下方的内容；全屏分支不会渲染插槽内容。 |

## 交互契约

- 局部模式会把默认插槽包在 `position: relative` 容器里，仅在 `loading=true` 时渲染绝对定位遮罩。
- 全屏模式会 teleport 到 `body`、覆盖视口，并在每次打开时获取新的共享 z-index。
- `background` 写入 `--tx-loading-overlay-bg`；遮罩本身还通过 `backdrop-filter` 添加模糊与饱和度。
- `text` 可省略；省略时，遮罩卡片内只渲染 spinner。

## 后台任务遮罩

`TxLoadingOverlay` 适合阻断“某个数据容器正在刷新”的短等待，不应该替代首屏加载态。首屏加载用 `TxLoadingState`；表格局部刷新或任务队列重算时再使用遮罩，并保持底层内容可见，减少布局跳动。

官方示例：`ComponentsFeedbackTaskCenterDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { toast } from '@talex-touch/tuffex/utils'
import { ref } from 'vue'

const syncing = ref(true)

function notify() {
  toast({ id: 'nexus-task-center', title: '同步任务已排队', variant: 'warning', duration: 0 })
}
</script>

<template>
  <section class="grid gap-3">
    <TxToastHost />
    <div style="display: flex; align-items: center; gap: 10px;">
      <TxTooltip content="Tooltip 只解释当前动作。">
        <TxButton size="sm" icon="i-carbon-information" @click="notify">提示说明</TxButton>
      </TxTooltip>
      <span style="display: inline-flex; align-items: center; gap: 6px;">
        <TxSpinner :size="14" />
        行内等待
      </span>
    </div>
    <TxLoadingOverlay :loading="syncing" text="正在刷新任务队列…" :spinner-size="22">
      <section class="grid gap-2">
        <TxProgressBar :percentage="72" status="warning" />
        <TxProgressBar :percentage="96" status="success" />
      </section>
    </TxLoadingOverlay>
  </section>
</template>
```

## 最佳实践

- 刷新、保存、重算这类已有内容的短等待优先使用局部遮罩，让旧内容保持可见。
- `fullscreen` 只用于必须阻断全局操作的流程，例如启动、工作区切换或不能并行继续的危险操作。
- 遮罩文案要指向具体动作：“正在刷新任务队列…” 比通用 “Loading…” 更有用。
- 首屏内容尚不存在时不要套 `TxLoadingOverlay`；使用 `TxLoadingState` 或骨架屏组件。

## 审阅说明

- **可访问性说明:** 遮罩自带 `role="status"` 与 `aria-live="polite"`，`text` 会被读屏播报，**不需要你另行补播报**。全屏模式还会把焦点停在遮罩上并拦截 Tab，关闭时还原到原先的焦点元素。唯一没有的是模态语义（无 `aria-modal`），所以它不会被当作对话框；需要真正的模态请改用 `TxModal` 或 `TxDialog`。
- **实测覆盖:** `loading-overlay.test.ts` 覆盖局部遮罩渲染、自定义背景/spinner 尺寸/文案、关闭状态下保留插槽、全屏 teleport，以及全屏模式不渲染局部容器。

## Source

- Component source: `packages/tuffex/packages/components/src/loading-overlay/src/TxLoadingOverlay.vue`。
- Types/export: `packages/tuffex/packages/components/src/loading-overlay/index.ts` 导出 `LoadingOverlayProps`、`LoadingOverlay`、`TxLoadingOverlay` 与 `TxLoadingOverlayInstance`。
- Coverage: `packages/tuffex/packages/components/src/loading-overlay/__tests__/loading-overlay.test.ts` 覆盖局部与全屏分支。

## 离线完整示例源码

- [LoadingOverlayLoadingOverlayContainerDemo](../snapshot/apps/nexus/app/components/content/demos/LoadingOverlayLoadingOverlayContainerDemo.vue.txt)
- [LoadingOverlayLoadingOverlayFullscreenDemo](../snapshot/apps/nexus/app/components/content/demos/LoadingOverlayLoadingOverlayFullscreenDemo.vue.txt)
- [ComponentsFeedbackTaskCenterDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsFeedbackTaskCenterDemo.vue.txt)

## 离线类型与实现参考

- [loading-overlay/index.ts](../snapshot/packages/tuffex/packages/components/src/loading-overlay/index.ts.txt)
- [src/TxLoadingOverlay.vue](../snapshot/packages/tuffex/packages/components/src/loading-overlay/src/TxLoadingOverlay.vue.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
