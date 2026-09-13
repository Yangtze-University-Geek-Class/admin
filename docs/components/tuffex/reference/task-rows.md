# TaskRows 任务行

> 智能体任务状态行：环形序号、状态药丸、可展开的执行明细。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/task-rows) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/task-rows.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/task-rows.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# TaskRows 任务行

## 基础用法

### 胶囊

每行是一张独立卡片，展开时圆角从 22px 收到 14px——这是这套形态的签名动作。状态推进的时间轴由 demo 持有。

官方示例：`TaskRowsCapsulesDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTaskRows
    :rows="rows"
    :open-ids="openIds"
    done-text="已完成"
    error-text="失败"
    @update:open-ids="openIds = $event"
  />
</template>
```

### 列表

同一套行结构装进一张卡片，行之间用发丝线分隔，圆角恒为 0。

官方示例：`TaskRowsListDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTaskRows
    variant="list"
    :rows="rows"
    :default-open-ids="['verify']"
    done-text="已完成"
    pending-text="排队中"
  />
</template>
```

## 状态徽章与重放

`done` 与 `error` 画的是实心圆徽，带 `pop-in` 入场；`running` 与 `pending` 画的是 24px 环，环内可以放序号。运行中的环是**固定 28% 的弧**在整体旋转——上游注释写的「从 0 扫到 66%」在代码里并不存在，不要去实现它。

徽章和药丸都带 `:key="row.status"`。Vue 会复用同一个元素，而 `both` 填充的动画在复用元素上不会重播；换 key 强制重建，状态切换时的 `pop-in` 与 `fade-in` 才真的出现。

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `rows` | `TaskRowItem[]` | — | 任务行。必填。 |
| `variant` | `'capsules' \| 'list'` | `'capsules'` | 容器形态。 |
| `defaultOpenIds` | `string[]` | — | 交互前展开的 id。绑定 `openIds` 时忽略。 |
| `openIds` | `string[]` | — | 绑定即由宿主持有展开集合；不绑则由组件自己持有。 |
| `doneText` | `string` | `'Completed'` | `done` 行的药丸文案。 |
| `errorText` | `string` | `'Failed'` | `error` 行的药丸文案。 |
| `runningText` | `string` | — | **无默认值**：运行中的行默认不显示药丸，与上游一致。 |
| `pendingText` | `string` | — | **无默认值**：排队中的行默认不显示药丸。 |

`TaskRowItem`：`{ id, label, status, amount?, index?, statusText?, details?, retryable? }`。`status` 取 `'pending' \| 'running' \| 'done' \| 'error'`，与 `AiToolCallPart` 对齐；`details` 是 `{ label, meta? }[]`。

### Events

| 事件名 | 参数 | 说明 |
|------|------|------|
| `toggle` | `(id: string, open: boolean)` | 某行被点击时派发，携带该行 id 与切换后的状态。 |
| `update:openIds` | `(ids: string[])` | 展开集合变化时派发，可用 `v-model:open-ids`。 |

### Slots

| 插槽名 | 作用域参数 | 说明 |
|------|------|------|
| `badge` | `{ row }` | 替换徽章区（圆徽或环）。 |
| `detail` | `{ row, detail, index }` | 替换单条明细的渲染。 |
| `trailing` | `{ row }` | 在折叠按钮**之外**渲染宿主自己的控件。 |

## 交互契约

- 展开集合是受控/非受控双模：不绑 `openIds` 由组件持有，绑了就完全由宿主说了算，两种情况都会派发 `update:openIds`。
- 每行的折叠区都有自己的 id，头部按钮通过 `aria-controls` 指向它；收起时带 `inert`，把明细一并移出 Tab 序列。
- `statusText` 优先于四个按状态的文案 prop。
- 失败行的旋转箭头是「正在重试」的**指示**，不是控件——它位于折叠按钮内部，放真按钮会构成非法的嵌套交互元素。`retryable: false` 可以关掉它。需要真正的重试按钮请用 `trailing` 插槽，它渲染在折叠按钮之外。
- 明细的入场延迟走 `--tx-bui-task-rows-detail-index`，行的入场延迟走 `--tx-bui-task-rows-index`，都不是内联样式。
- 折叠区不会卸载内容：收起的行明细仍在 DOM 里，只是高度为 0。
- 减弱动效下圆角形变、旋转与入场全部停止，状态本身照常推进。

## 最佳实践

- `capsules` 用于独立浮在页面上的任务组，`list` 用于已经处在卡片里的面板——后者不会再叠一层容器阴影。
- `running` 与 `pending` 保持无药丸更接近上游观感；确实需要时再传 `runningText` / `pendingText`。
- 环内序号（`index`）用于表达「第几步」，完成后徽章会换成圆徽，序号自然消失。
- `amount` 放右对齐的量词（「12 家供应商」），它是等宽数字，流式更新时不会跳宽。
- 明细的 `meta` 用等宽数字呈现比率与计数，`label` 写清做了什么。
- 组件宽度自适应，上游的 440px 容器由宿主决定。

## Source

- Component source: `packages/tuffex/packages/components/src/task-rows/src/TxTaskRows.vue`。
- Types: `packages/tuffex/packages/components/src/task-rows/src/types.ts`。
- **实测覆盖:** `packages/tuffex/packages/components/src/task-rows/__tests__/task-rows.test.ts`（21 项）验证受控/非受控展开、`aria-controls` 一一对应、收起态 `inert`、状态切换时徽章元素真的被重建、固定 28% 弧、药丸缺省规则与 `trailing` 落在按钮之外。
- 移植自 Beautiful UI（https://www.beautifului.dev），© 2026 Shane Levine，MIT。



## 审阅说明

- **与 `TxToolCallCard` 的分工:** 那个是单次工具调用的卡片，带入参、日志、结果与重试；本组件是多行任务状态列表，带环形序号、圆角形变与明细行。数据模型不同，不要互相套用。
- **状态词汇:** 用 `'error'` 而不是上游的 `'failed'`，与 `AiToolCallPart.status` 对齐；默认药丸文案仍是 `Failed`。
- **可访问性:** 收起态加 `inert`、重试指示不做成嵌套按钮，都是有意超出上游的修正。

## 离线完整示例源码

- [TaskRowsCapsulesDemo](../snapshot/apps/nexus/app/components/content/demos/TaskRowsCapsulesDemo.vue.txt)
- [TaskRowsListDemo](../snapshot/apps/nexus/app/components/content/demos/TaskRowsListDemo.vue.txt)

## 离线类型与实现参考

- [task-rows/index.ts](../snapshot/packages/tuffex/packages/components/src/task-rows/index.ts.txt)
- [src/TxTaskRows.vue](../snapshot/packages/tuffex/packages/components/src/task-rows/src/TxTaskRows.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/task-rows/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
