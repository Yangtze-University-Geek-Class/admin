# Transfer 穿梭框

> 在两个列表之间移动并筛选条目

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/transfer) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/transfer.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/transfer.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Transfer 穿梭框

## 基础用法

### 可筛选穿梭
开启 `filterable` 后，左右列表都会显示筛选输入框。`emptyText` 可用于本地化空态文案。

官方示例：`TransferTransferDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const selected = ref<Array<string | number>>(['release'])
const data = [
  { key: 'release', label: '正式通道' },
  { key: 'beta', label: 'Beta 通道' },
  { key: 'snapshot', label: '快照通道' },
  { key: 'internal', label: '内部灰度', disabled: true },
]
</script>

<template>
  <TxTransfer
    v-model="selected"
    :data="data"
    :titles="['可选渠道', '已选择']"
    filterable
    filter-placeholder="筛选渠道"
    empty-text="暂无数据"
    add-aria-label="添加选中渠道"
    remove-aria-label="移除选中渠道"
  />
</template>
```

### 优先级排序
`orderable` 把目标面板变成有序列表：每行显示名次，并带上移 / 下移。名次读自 `modelValue`，筛选时也不会串位；此时目标顺序就是 `modelValue` 顺序，`targetOrder` 不再参与。`maxHeight` 给面板封顶，长列表在列表内部滚动，而不是把外层弹窗撑开；`minHeight` 是与之对应的下限，放进紧凑容器时需要调低它。

官方示例：`TransferOrderableDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const selected = ref<Array<string | number>>(['gpt-1', 'gpt-3', 'gpt-2'])
const data = [
  { key: 'gpt-1', label: '主模型 · 高质量' },
  { key: 'gpt-2', label: '备用模型 · 均衡' },
  { key: 'gpt-3', label: '快速模型 · 低延迟' },
  { key: 'gpt-4', label: '长上下文模型' },
]
</script>

<template>
  <TxTransfer
    v-model="selected"
    :data="data"
    :titles="['可用模型', '调用顺序']"
    :empty-text="['没有更多模型', '还没有排序，先加一个模型']"
    :max-height="260"
    filterable
    orderable
    target-order="push"
    move-up-aria-label="上移一位"
    move-down-aria-label="下移一位"
  />
</template>
```

## 权限资源授权

后台授权场景里，`TxTransfer` 只负责“可分配资源 ↔ 已授权资源”的受控移动；权限域由 `TxTree` 选择，归属团队由 `TxTreeSelect` 选择，审计进度由 `TxTimeline` 呈现，这样每个组件职责都更清晰。

官方示例：`ComponentsPermissionOrchestrationDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const assignedKeys = ref<Array<string | number>>(['read-docs', 'publish-notes'])
const resources = [
  { key: 'read-docs', label: '读取文档' },
  { key: 'publish-notes', label: '发布日志' },
  { key: 'manage-assets', label: '管理资源' },
  { key: 'rotate-keys', label: '轮换密钥', disabled: true },
  { key: 'view-billing', label: '查看账单' },
]
</script>

<template>
  <TxTransfer
    v-model="assignedKeys"
    :data="resources"
    :titles="['可分配资源', '已授权']"
    filterable
    filter-placeholder="筛选资源"
    empty-text="暂无资源"
    add-aria-label="添加选中资源"
    remove-aria-label="移除选中资源"
  />
</template>
```

## API

### Props

```yaml
rows:
  - name: modelValue
    type: "Array<string | number>"
    default: "[]"
    description: 目标列表中的条目 key
  - name: data
    type: TransferItem[]
    default: "[]"
    description: 全量条目列表，包含 key、label 和可选 disabled
  - name: titles
    type: "[string, string]"
    default: "['Source', 'Target']"
    description: 左右面板标题
  - name: filterable
    type: boolean
    default: false
    description: 是否显示筛选输入
  - name: filterPlaceholder
    type: string
    default: "''"
    description: 筛选输入占位文案
  - name: emptyText
    type: "string | [string, string]"
    default: "'No data'"
    description: 列表为空时的展示文案；传元组则左右面板各用一条
  - name: maxHeight
    type: "string | number"
    default: "'320px'"
    description: 面板高度上限，数字按 px 处理；也可直接设 --tx-transfer-max-height
  - name: minHeight
    type: "string | number"
    default: "'240px'"
    description: 面板高度下限；数字按 px 处理，也可直接设 --tx-transfer-min-height
  - name: addAriaLabel
    type: string
    default: "'Move selected items to target'"
    description: 添加按钮的无障碍标签
  - name: removeAriaLabel
    type: string
    default: "'Move selected items to source'"
    description: 移除按钮的无障碍标签
  - name: selectAllAriaLabel
    type: string
    default: "'Select all'"
    description: 面板全选框的无障碍标签，渲染时会拼上面板标题
  - name: moveUpAriaLabel
    type: string
    default: "'Move item up'"
    description: 上移按钮的无障碍标签，渲染时会拼上条目文本
  - name: moveDownAriaLabel
    type: string
    default: "'Move item down'"
    description: 下移按钮的无障碍标签，渲染时会拼上条目文本
  - name: targetOrder
    type: "'original' | 'push'"
    default: "'original'"
    description: 目标列表按原始 data 顺序或追加顺序排序；`orderable` 打开后不再生效
  - name: orderable
    type: boolean
    default: false
    description: 目标面板显示名次与上移/下移按钮，顺序即 modelValue 顺序
```

## Events

| 事件 | 参数 | 说明 |
|------|------|------|
| `update:modelValue` | `Array<string \| number>` | 已选 key 更新 |
| `change` | `Array<string \| number>` | 已选 key 变化 |

## Slots

`TxTransfer` 不提供自定义插槽。条目文本通过 `data[].label` 渲染，面板标题通过 `titles` 本地化，空态、筛选框和操作按钮文案通过 props 配置。

## 交互契约

- 每个面板头部有一个全选框，覆盖范围是**当前可见且未禁用**的行：筛选生效时只影响筛出来的那些，不会替用户勾上看不见的条目。部分选中时它报 `aria-checked="mixed"`。
- 移动条目有两条路径：勾选后按中间按钮，或直接双击一行。双击禁用行不做任何事。
- 中间按钮有边框和底色，勾选后变主色并显示待移动数量；没有勾选时禁用。纯图标、无边框的按钮夹在两个面板之间会被读成装饰，用户按了以为没反应。
- `orderable` 时目标行显示名次与上移 / 下移按钮；名次取自 `modelValue`，与筛选状态无关。

## 最佳实践

- `modelValue` 应始终由业务侧受控，并且只保存 item key，不保存完整 item 对象。
- 保持每个 `data[].key` 唯一且稳定；重复 key 会让左右列表归属不可判断。
- 目标列表需要保持原始数据顺序时使用 `targetOrder="original"`，选择顺序本身有意义时使用 `targetOrder="push"`。
- 顺序需要由用户手动调整（优先级、回退链）时开 `orderable`，并把 `targetOrder` 设为 `"push"` 表明意图；此时组件只认 `modelValue` 顺序。
- 禁用项应保留在 `data` 中展示，不要在外层过滤掉，避免用户误以为资源不存在。
- 当中间操作按钮只有图标时，必须显式提供 `addAriaLabel` 和 `removeAriaLabel`；开了 `orderable` 就再补 `moveUpAriaLabel` 和 `moveDownAriaLabel`，本地化界面还要给 `selectAllAriaLabel`。
- `filterable` 适合中大型列表；短权限列表不加双侧筛选框通常更容易扫读。
- 需要一次性搬走整批时不要自己在外面加"全选"按钮，组件头部已经有了，且它只作用于筛选后的可见行。
- 面板默认封顶 320px。放进弹窗或抽屉时用 `maxHeight` 贴合容器（如 `min(56dvh, 520px)`），保证滚动始终发生在列表内部，而不是把弹窗撑高。
- 面板同时有 240px 的下限，而且是硬下限：放进比它更矮的容器时，面板仍按自己的高度排版并溢出容器。放在紧凑位置时记得调低 `minHeight`。
- 左右空态含义不同时（"没有可选项" vs "至少选一个才能用"）给 `emptyText` 传元组，不要用同一句话糊过去。

## Source

<TuffDocSourceLink label="查看源码" />

## 审阅说明

- 组件源码：`packages/tuffex/packages/components/src/transfer/src/TxTransfer.vue` 确认左右列表派生、筛选匹配、禁用项检查、`targetOrder` 和纯图标操作按钮标签。
- 类型契约：`packages/tuffex/packages/components/src/transfer/src/types.ts` 导出 `TransferItem`、`TransferProps` 和 `TransferEmits`。
- 高度契约：面板读 `--tx-transfer-max-height`（默认 `320px`）与 `--tx-transfer-min-height`（默认 `240px`），两个 prop 只是写这两个变量。上限必须存在——没有上限时面板会随条目数一起长高，`.tx-transfer__list` 的 `overflow: auto` 永远不触发，滚动落到外层页面或弹窗上。下限原先是硬编码的，因此无法被容器压过：放进 190px 的盒子里仍按 240px 排版并溢出 50px。
- 行标签用 `overflow-wrap: anywhere` 换行，而不是 `word-break: break-all`。`break-all` 在哪个字符放不下就从哪里断，"Quick actions" 会断成 "Quick actio / ns"；`anywhere` 优先在空格处断，只有单个词实在放不下才会断进词内。
- Props 用运行时对象声明，而不是 `defineProps<TransferProps>()`。SFC 编译器只解析一次同目录的 `types.ts`，该文件变化时不会重做，因此接口上新增的 prop 会以未知属性的形式发出去——而 vitest 和构建产物 `dist` 都是正确的。
- 排序契约：`orderable` 时 `targetItems` 与 `resolveOrder` 都短路 `targetOrder='original'`。曾经只改渲染顺序、留着 `resolveOrder` 按 `data` 重排，结果每次上移/下移都被立刻排回去，表现为按钮"没反应"。名次与首/末项判定都取自未过滤的 `modelValue`，用过滤后的下标会让搜索状态下的名次和禁用态一起算错。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/transfer/__tests__/transfer.test.ts` 覆盖勾选项移动、双击单条移动与禁用行不动、全选（跳过禁用行 / 只作用于筛选结果 / 部分选中报 mixed / 再次点击清空）、自定义空态文案（含左右分别配置）、可访问操作按钮标签、`maxHeight` 与 `minHeight` 变量注入（单独设置与同时设置），以及 `orderable` 的名次渲染、上下移动、边界禁用、筛选状态下的名次与边界。
- 截图：`.codex-screenshots/nexus-transfer-permission-orchestration-demo-playwright-2026-05-28.png`。

## 离线完整示例源码

- [TransferTransferDemo](../snapshot/apps/nexus/app/components/content/demos/TransferTransferDemo.vue.txt)
- [TransferOrderableDemo](../snapshot/apps/nexus/app/components/content/demos/TransferOrderableDemo.vue.txt)
- [ComponentsPermissionOrchestrationDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsPermissionOrchestrationDemo.vue.txt)

## 离线类型与实现参考

- [transfer/index.ts](../snapshot/packages/tuffex/packages/components/src/transfer/index.ts.txt)
- [src/TxTransfer.vue](../snapshot/packages/tuffex/packages/components/src/transfer/src/TxTransfer.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/transfer/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
