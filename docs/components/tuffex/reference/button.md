# Button 按钮

> 触感按钮与扁平按钮的核心交互

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/button) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/button.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/button.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Button 按钮

## Usage

按钮用于触发明确的动作，建议在界面里保持主次层级清晰：

- 同一界面只保留一个主按钮，避免权重冲突
- 通过 `variant` 与 `size` 传递动作层级
- 异步操作必须展示 `loading`，避免重复触发

## Variants

### Appearance

基础外观与主次层级组合。

官方示例：`ButtonVariantsDemo`（完整源码见本页末尾）

```vue
<template>
  <TxButton>默认按钮</TxButton>
  <TxButton variant="primary">Primary</TxButton>
  <TxButton variant="secondary">Secondary</TxButton>
  <TxButton variant="ghost">Ghost</TxButton>
  <TxButton variant="danger">Danger</TxButton>
  <TxButton variant="success">Success</TxButton>
  <TxButton variant="warning">Warning</TxButton>
  <TxButton variant="info">Info</TxButton>
</template>
```

### Disabled

按钮不可用状态。

官方示例：`ButtonDisabledDemo`（完整源码见本页末尾）

```vue
<template>
  <TxButton disabled>默认按钮</TxButton>
  <TxButton variant="primary" disabled>Primary</TxButton>
  <TxButton variant="secondary" disabled>Secondary</TxButton>
  <TxButton variant="ghost" disabled>Ghost</TxButton>
  <TxButton variant="danger" disabled>Danger</TxButton>
</template>
```

### Loading

点击按钮后进行数据加载操作，在按钮上显示加载状态。

官方示例：`ButtonLoadingDemo`（完整源码见本页末尾）

```vue
<script setup>
import { ref } from 'vue'

const loading = ref(false)

async function handleClick() {
  if (loading.value) return
  loading.value = true
  setTimeout(() => { loading.value = false }, 1200)
}
</script>

<template>
  <TxButton variant="primary" :loading="loading" @click="handleClick">
    {{ loading ? '加载中' : '点击加载' }}
  </TxButton>
  <TxButton variant="secondary" :loading="loading" @click="handleClick">
    {{ loading ? '加载中' : '点击加载' }}
  </TxButton>
  <TxButton circle icon="i-carbon-edit" :loading="loading" @click="handleClick" />
</template>
```

### Sizes

Button 组件提供除了默认值以外的三种尺寸，可以在不同场景下选择合适的按钮尺寸，尺寸会影响触感与密度。

官方示例：`ButtonSizesDemo`（完整源码见本页末尾）

```vue
<template>
  <TxButton size="lg">Large</TxButton>
  <TxButton size="md">Medium</TxButton>
  <TxButton size="sm">Small</TxButton>
</template>
```

### Block

在卡片或表单中使用块级按钮，用于撑满容器的主操作。

官方示例：`ButtonBlockDemo`（完整源码见本页末尾）

```vue
<template>
  <TxButton block variant="primary">Block Button</TxButton>
</template>
```

### Shapes

通过 `plain` / `round` / `circle` / `dashed` 调整形态。

官方示例：`ButtonShapesDemo`（完整源码见本页末尾）

```vue
<template>
  <TxButton dashed>Dashed</TxButton>
  <TxButton plain variant="primary">Plain</TxButton>
  <TxButton round variant="primary">Round</TxButton>
  <TxButton circle icon="i-carbon-edit" />
</template>
```

### Haptics

移动端触觉反馈需要显式开启：设置 `vibrate` 后，点击会调用设备震动，并让按钮本体按震动强度做小幅晃动；桌面端即使设备不支持震动，也会显示该视觉反馈。

官方示例：`ButtonHapticsDemo`（完整源码见本页末尾）

```vue
<template>
  <TxButton variant="primary" vibrate vibrate-type="light">轻微震动</TxButton>
  <TxButton variant="primary" vibrate vibrate-type="medium">中等震动</TxButton>
  <TxButton variant="primary" vibrate vibrate-type="heavy">重度震动</TxButton>
  <TxButton variant="danger" vibrate vibrate-type="error">错误震动</TxButton>
  <TxButton variant="secondary">默认无震动</TxButton>
</template>
```

## API

### Props

```yaml
rows:
  - parameter: variant
    type:
      kind: enum
      enums: [primary, secondary, ghost, danger, success, warning, info, flat, bare]
    default: "'secondary'"
    description: '视觉风格变体。未显式设置时（且未通过 `type` 推导）回退为 `secondary`。'
  - parameter: type
    type:
      kind: enum
      enums: [primary, success, warning, danger, info, text]
    default: '-'
    description: '语义 tone 别名。仅在未设置 `variant` 时用于推导视觉变体；`text` 会映射为 `ghost`。'
  - parameter: size
    type:
      kind: enum
      enums: [sm, md, lg, large, small, mini]
    default: "'md'"
    description: '按钮尺寸。`lg`/`large` 用于页面主操作，`sm`/`small`/`mini` 用于表格行内与紧凑工具条。'
  - parameter: block
    type: boolean
    default: 'false'
    description: '块级按钮，撑满父容器宽度。移动端表单提交与抽屉底部操作常用。'
  - parameter: plain
    type: boolean
    default: 'false'
    description: '是否朴素按钮'
  - parameter: dashed
    type: boolean
    default: 'false'
    description: '是否虚线按钮'
  - parameter: round
    type: boolean
    default: 'false'
    description: '是否圆角按钮'
  - parameter: circle
    type: boolean
    default: 'false'
    description: '是否圆形按钮'
  - parameter: loading
    type: boolean
    default: 'false'
    description: '是否加载中状态'
  - parameter: loading-variant
    type:
      kind: enum
      enums: [spinner, bar]
    default: "'spinner'"
    description: '加载反馈样式。`bar` 只有在同时设置 `block` 时才渲染为扫光层。'
  - parameter: disabled
    type: boolean
    default: 'false'
    description: '是否禁用状态'
  - parameter: border
    type: boolean
    default: 'true'
    description: '是否保留按钮边框颜色；`false` 会添加 borderless 状态。'
  - parameter: icon
    type: string
    default: '-'
    description: '图标类名'
  - parameter: autofocus
    type: boolean
    default: 'false'
    description: '是否默认聚焦'
  - parameter: native-type
    type:
      kind: enum
      enums: [button, submit, reset]
    default: "'button'"
    description: '原生 type 属性'
  - parameter: vibrate
    type: boolean
    default: 'false'
    description: '是否启用震动与对应的视觉晃动反馈；需显式开启'
  - parameter: vibrate-type
    type:
      kind: enum
      enums: [light, medium, heavy, bit, success, warning, error]
    default: "'light'"
    description: '震动类型'
```

### Events

```yaml
rows:
  - parameter: click
    type:
      label: '(event: MouseEvent) => void'
      snippet: |
        type ButtonClickHandler = (event: MouseEvent) => void
      language: typescript
    default: '-'
    description: '点击时触发'
```

### Slots

| 插槽名 | 说明 |
|--------|------|
| `default` | 按钮文案或自定义内联内容，渲染在可选图标 / loading spinner 之后。 |

### SplitButton Props

| 属性名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `variant` | `'primary' \| 'secondary' \| 'ghost' \| 'danger' \| 'success' \| 'warning' \| 'info'` | `primary` | 主按钮与菜单按钮共享的视觉变体。 |
| `size` | `'sm' \| 'md' \| 'lg' \| 'large' \| 'small' \| 'mini'` | `md` | 按钮密度；别名会归一化为 `sm`、`md` 或 `lg`。 |
| `disabled` | `boolean` | `false` | 同时禁用主操作和菜单触发器。 |
| `loading` | `boolean` | `false` | 显示主按钮 spinner，并禁用两个交互区域。 |
| `icon` | `string` | - | 未处于 loading 时显示在主文案前的图标类名。 |
| `menuIcon` | `string` | `i-ri-more-2-line` | 菜单触发器默认图标类名。 |
| `menuDisabled` | `boolean` | `false` | 在全局 disabled/loading 之外，仅禁用菜单触发器。 |
| `menuWidth` | `number` | `200` | 透传给 `TxPopover` 的弹层宽度。 |
| `menuPlacement` | `'top-start' \| 'top-end' \| 'bottom-start' \| 'bottom-end' \| 'right-start' \| 'right-end' \| 'left-start' \| 'left-end'` | `bottom-end` | 弹层位置。 |
| `menuOffset` | `number` | `8` | 弹层偏移像素。 |

### SplitButton Events

| 事件名 | 参数 | 说明 |
|--------|------|------|
| `click` | `(event: MouseEvent)` | 主按钮在非 disabled / loading 状态下点击时触发。 |
| `menuOpenChange` | `(open: boolean)` | 内部 popover 打开状态变化时触发。 |

### SplitButton Slots

| 插槽名 | 参数 | 说明 |
|--------|------|------|
| `default` | - | 主操作文案。 |
| `menu` | `{ close: () => void }` | 渲染在 `TxPopover` 内的菜单内容；菜单项完成选择后应调用 `close()`。 |
| `menu-icon` | - | 替换菜单触发器默认更多图标。 |

### IconButton Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `icon` | `string` | `''` | 未提供默认插槽时，通过 `TxIcon` 渲染的图标名称。 |
| `label` | `string` | `''` | 可访问名称。纯图标操作必填。 |
| `size` | `'xs' \| 'sm' \| 'md' \| 'lg'` | `'md'` | 按钮尺寸。 |
| `shape` | `'square' \| 'circle' \| 'pill'` | `'square'` | 点击区域轮廓。 |
| `status` | `'success' \| 'warning' \| 'danger' \| 'info'` | - | 语义视觉状态色；未设置时保持中性样式。 |
| `pressed` | `boolean` | - | 持久切换态；定义后转发为 `aria-pressed`。 |
| `disabled` | `boolean` | `false` | 原生禁用态与禁用样式。 |
| `nativeType` | `'button' \| 'submit' \| 'reset'` | `'button'` | 原生 `type` 属性。 |
- `status` 会改变图标的语义颜色、悬停、按下和焦点样式；不改变行为，也不提供授权。

### IconButton Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `click` | `(event: MouseEvent)` | 启用状态下点击后触发。 |

### IconButton Slots

| 插槽名 | Props | 说明 |
|------|------|------|
| `default` | `{ hover, pressed }` | 自定义图标或动画内容。 |

### CopyButton Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `text` | `string` | `''` | 写入剪贴板的文本。 |
| `copyLabel` | `string` | `'Copy'` | 空闲状态文案和 aria-label。 |
| `copiedLabel` | `string` | `'Copied'` | 成功状态文案和 aria-label。 |
| `disabled` | `boolean` | `false` | 禁用按钮并阻止复制。 |
| `timeout` | `number` | `1400` | 复制完成状态重置延迟，单位 ms。 |
| `size` | `'sm' \| 'md'` | `'sm'` | 按钮密度。 |

### CopyButton Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `copy` | `(text: string)` | 剪贴板写入成功后触发。 |
| `error` | `(error: unknown)` | 剪贴板写入失败时触发。 |

### CopyButton Slots

| 插槽名 | Props | 说明 |
|------|------|------|
| `default` | `{ copied, copying }` | 自定义按钮文案或内容。 |

## Types
```ts
import type { TxButtonEmits, TxButtonProps, TxIconButtonProps, TxSplitButtonEmits, TxSplitButtonProps } from '@talex-touch/tuffex'

export interface ButtonProps extends TxButtonProps {}
export interface ButtonEmits extends TxButtonEmits {}
export interface SplitButtonProps extends TxSplitButtonProps {}
export interface SplitButtonEmits extends TxSplitButtonEmits {}
export interface IconButtonProps extends TxIconButtonProps {}
```

## Composition Notes

### Split Button

用于"主操作 + 更多操作"的组合按钮（例如 RUN + …）。

官方示例：`ButtonSplitDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const loading = ref(false)

async function handleRun() {
  if (loading.value)
    return
  loading.value = true
  await new Promise(resolve => setTimeout(resolve, 1200))
  loading.value = false
}
</script>

<template>
  <TxSplitButton
    variant="primary"
    size="sm"
    icon="i-ri-play-fill"
    :loading="loading"
    @click="handleRun"
  >
    RUN
    <template #menu="{ close }">
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <TxButton size="sm" plain block icon="i-ri-settings-3-line" @click="close()">
          Settings
        </TxButton>
        <TxButton size="sm" plain block icon="i-ri-folder-open-line" @click="close()">
          Open Folder
        </TxButton>
      </div>
    </template>
  </TxSplitButton>
</template>
```

### Primary + Ghost

主动作 + 次动作组合时使用 `primary + ghost` 保持层级清晰。

官方示例：`ButtonPrimaryGhostDemo`（完整源码见本页末尾）

```vue
<template>
  <TxButton icon="i-ri-add-line">创建项目</TxButton>
  <TxButton variant="ghost">次要操作</TxButton>
</template>
```

### Icon Button

纯图标动作按钮：`label` 提供可访问名称，`pressed` 承载持久切换态，`status` 提供语义状态色。

官方示例：`IconButtonIconButtonDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const pinned = ref(false)
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <TxIconButton
      icon="i-carbon-star"
      label="置顶工作区"
      shape="circle"
      :pressed="pinned"
      @click="pinned = !pinned"
    />
    <TxIconButton icon="i-carbon-edit" label="编辑项目" shape="square" status="info" />
    <TxIconButton icon="i-carbon-add" label="新增项目" shape="pill" size="lg" status="success" />
    <TxIconButton icon="i-carbon-warning" label="需要注意的操作" status="warning" />
    <TxIconButton icon="i-carbon-trash-can" label="删除项目" status="danger" disabled />
  </div>
</template>
```

### Copy Button

带复制完成反馈与错误事件的剪贴板按钮。

官方示例：`CopyButtonCopyButtonDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
const installCommand = 'pnpm add @talex-touch/tuffex'
</script>

<template>
  <TxCopyButton
    :text="installCommand"
    copy-label="复制安装命令"
    copied-label="已复制"
  />
</template>
```

## 交互契约

- `variant` 优先级高于语义 `type`；未设置 `variant` 时，`type="text"` 映射为 `ghost`，其它语义类型映射到对应视觉变体。
- 尺寸别名会归一化为 `sm`、`md`、`lg`；`large` 映射为 `lg`，`small` 和 `mini` 映射为 `sm`。
- `disabled` 和 `loading` 都会禁用原生 `<button>`，并阻止 `click` 事件向外 emit。
- `loadingVariant="bar"` 仅在块级按钮上可见；图标按钮和普通内联按钮使用 spinner slot 或 overlay spinner。
- 非 block、非 circle 的按钮在 loading 切换时会用尺寸 FLIP 过渡宽度变化。
- `vibrate` 默认关闭。显式开启后，点击会按解析出的震动强度触发设备震动，并让按钮播放等比幅度的小晃动；`prefers-reduced-motion: reduce` 下不晃动。
- `TxSplitButton` 在 loading 时会禁用主操作和菜单；`menuDisabled` 只额外禁用菜单触发器。
- `TxIconButton` 的 `label` 会成为 `aria-label`，纯图标按钮必须提供；`pressed` 是 boolean 时输出 `aria-pressed` 并应用激活样式；默认插槽接收 `{ hover, pressed }`。
- `TxCopyButton` 在 `disabled` 或复制进行中忽略点击；只有剪贴板写入成功后才触发 `copy`，两种剪贴板策略都失败时触发 `error`；成功后 `copiedLabel` 显示 `timeout` 毫秒后恢复。

## 最佳实践

- 每个视图或卡片只保留一个主按钮。主动作可搭配 `ghost` 或 `secondary` 表达低优先级动作。
- 只有在表单内才使用 `nativeType="submit"`；默认 `button` 用于避免意外提交表单。
- 所有异步动作都应设置 `loading`，并在成功和失败路径都清理，避免按钮卡在禁用状态。
- `circle` 优先用于纯图标动作；`block` 与 `circle` 组合时，组件会刻意保持常规文案布局。
- 全宽提交条使用 `loadingVariant="bar"`；紧凑按钮或图标按钮继续使用 spinner loading。
- `TxSplitButton` 的菜单动作完成选择后，应调用 slot 暴露的 `close()` 回调。
- `TxIconButton` 除非插槽中有可见文本，否则始终设置 `label`；`pressed` 只用于持久开关，一次性动作使用普通点击按钮。
- `TxCopyButton` 的 `copyLabel` 应明确点名复制目标；复制值很关键时处理 `error`，浏览器可能拒绝非可信手势触发的剪贴板写入。


## 审阅说明

- 已核对 `packages/tuffex/packages/components/src/button/src/button.vue`、`split-button.vue`、`types.ts`、`split-button.ts` 与两个 button 测试文件。
- **实测覆盖:** `button.test.ts` 覆盖文案渲染、语义 type 映射、variant 优先级、尺寸别名、disabled/loading 点击阻断、loading bar、图标、形态 class、无边框模式与原生 type；`split-button.test.ts` 覆盖菜单渲染、主按钮点击、disabled/loading 阻断与 `menuOpenChange`。
- **实测覆盖（IconButton / CopyButton）:** `packages/tuffex/packages/components/src/button/__tests__/icon-button.test.ts` 覆盖可访问名称告警与语义状态 class；`copy-button.test.ts` 覆盖剪贴板成功、已复制视觉状态、禁用无操作和错误派发。
- 可访问性说明：原生 button 已处理基础键盘激活。图标按钮或 `circle` 按钮在图标含义不自明时，应通过外层文案或 attrs 提供可访问名称。

## Source

- Component source: `packages/tuffex/packages/components/src/button/src/button.vue` and `packages/tuffex/packages/components/src/button/src/split-button.vue`.
- Types: `packages/tuffex/packages/components/src/button/src/types.ts` and `packages/tuffex/packages/components/src/button/src/split-button.ts`.
- IconButton / CopyButton：`packages/tuffex/packages/components/src/button/src/icon-button.vue`、`copy-button.vue` 与类型文件 `icon-button.ts`；`button/index.ts` 导出可安装的 `TxIconButton`、`TxCopyButton` 及实例类型。
- Coverage: `packages/tuffex/packages/components/src/button/__tests__/button.test.ts` verifies variants, semantic type mapping, loading/disabled click suppression, icons, shapes, borderless mode, native type, and loading bar behavior. `split-button.test.ts` verifies primary click, disabled suppression, loading state, menu rendering, and `menuOpenChange`.

## 离线完整示例源码

- [ButtonVariantsDemo](../snapshot/apps/nexus/app/components/content/demos/ButtonVariantsDemo.vue.txt)
- [ButtonDisabledDemo](../snapshot/apps/nexus/app/components/content/demos/ButtonDisabledDemo.vue.txt)
- [ButtonLoadingDemo](../snapshot/apps/nexus/app/components/content/demos/ButtonLoadingDemo.vue.txt)
- [ButtonSizesDemo](../snapshot/apps/nexus/app/components/content/demos/ButtonSizesDemo.vue.txt)
- [ButtonBlockDemo](../snapshot/apps/nexus/app/components/content/demos/ButtonBlockDemo.vue.txt)
- [ButtonShapesDemo](../snapshot/apps/nexus/app/components/content/demos/ButtonShapesDemo.vue.txt)
- [ButtonHapticsDemo](../snapshot/apps/nexus/app/components/content/demos/ButtonHapticsDemo.vue.txt)
- [ButtonSplitDemo](../snapshot/apps/nexus/app/components/content/demos/ButtonSplitDemo.vue.txt)
- [ButtonPrimaryGhostDemo](../snapshot/apps/nexus/app/components/content/demos/ButtonPrimaryGhostDemo.vue.txt)
- [IconButtonIconButtonDemo](../snapshot/apps/nexus/app/components/content/demos/IconButtonIconButtonDemo.vue.txt)
- [CopyButtonCopyButtonDemo](../snapshot/apps/nexus/app/components/content/demos/CopyButtonCopyButtonDemo.vue.txt)

## 离线类型与实现参考

- [button/index.ts](../snapshot/packages/tuffex/packages/components/src/button/index.ts.txt)
- [src/button.vue](../snapshot/packages/tuffex/packages/components/src/button/src/button.vue.txt)
- [src/copy-button.vue](../snapshot/packages/tuffex/packages/components/src/button/src/copy-button.vue.txt)
- [src/icon-button.ts](../snapshot/packages/tuffex/packages/components/src/button/src/icon-button.ts.txt)
- [src/icon-button.vue](../snapshot/packages/tuffex/packages/components/src/button/src/icon-button.vue.txt)
- [src/split-button.ts](../snapshot/packages/tuffex/packages/components/src/button/src/split-button.ts.txt)
- [src/split-button.vue](../snapshot/packages/tuffex/packages/components/src/button/src/split-button.vue.txt)
- [style/index.scss](../snapshot/packages/tuffex/packages/components/src/button/src/style/index.scss.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/button/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
