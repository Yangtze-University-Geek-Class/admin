# Timeline 时间线

> 用于展示事件流

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/timeline) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/timeline.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/timeline.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Timeline 时间线

## 基础用法
### 时间线
展示近期动态。
官方示例：`TimelineTimelineDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTimeline>
    <TxTimelineItem title="设计阶段" time="09:30" color="primary" />
    <TxTimelineItem title="开发构建" time="12:00" color="success" />
    <TxTimelineItem title="上线发布" time="16:10" color="warning" />
  </TxTimeline>
</template>
```

## 后台审计流程

`TxTimeline` 适合展示授权、发布、同步等后台任务的事件流。当前步骤用 `active` 突出，颜色只表达语义辅助；关键状态仍应写进 `title` 或默认插槽，保证可读性和无障碍体验。

官方示例：`ComponentsPermissionOrchestrationDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTimeline>
    <TxTimelineItem title="选择权限域" time="09:30" color="primary">
      release
    </TxTimelineItem>
    <TxTimelineItem title="分配资源" time="10:20" color="success" active>
      docs + notes
    </TxTimelineItem>
    <TxTimelineItem title="等待复核" time="11:05" color="warning">
      security review
    </TxTimelineItem>
  </TxTimeline>
</template>
```

## API
### Props
```yaml
rows:
  - name: layout
    type: "'vertical' | 'horizontal'"
    default: "'vertical'"
    description: 布局方向
```

### TxTimelineItem Props
```yaml
rows:
  - name: title
    type: string
    default: '-'
    description: 条目标题
  - name: time
    type: string
    default: '-'
    description: 时间文本
  - name: color
    type: "'default' | 'primary' | 'success' | 'warning' | 'error'"
    default: "'default'"
    description: 节点颜色
  - name: icon
    type: string
    default: '-'
    description: 节点图标
  - name: active
    type: boolean
    default: 'false'
    description: 高亮当前事件节点
```

### Slots

| 组件 | 插槽 | 参数 | 说明 |
|------|------|------|------|
| `TxTimeline` | `default` | - | 时间线条目。 |
| `TxTimelineItem` | `default` | - | 渲染在标题/时间下方的事件说明。 |

### Events

`TxTimeline` 和 `TxTimelineItem` 不触发事件。

## 交互契约

- `TxTimeline` 暴露 `role="list"`，每个 `TxTimelineItem` 暴露 `role="listitem"`。
- `active` 会同时作用于条目和节点圆点，用于突出当前事件。
- `layout="horizontal"` 会通过 provide/inject 同步到子项，切换为横向事件流布局。


## 最佳实践

- 稳定状态应写进 `title` 或默认插槽，`color` 只作为视觉辅助。
- 步骤流里只标记一个当前事件为 `active`。
- 短里程碑序列可使用 `layout="horizontal"`；审计日志和长历史保持纵向。
- `time` 保持简短，并在同一条时间线中使用一致格式。
- 谨慎使用 `icon`；密集时间线只给异常或关键状态加图标更易读。

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/timeline/src/TxTimeline.vue` 确认 `role="list"`、纵向/横向布局 class 解析，以及传给子项的上下文。
- 条目源码:`packages/tuffex/packages/components/src/timeline/src/TxTimelineItem.vue` 确认 `role="listitem"`、title/time/默认插槽渲染、可选图标渲染、语义节点颜色 class、active 条目/节点 class 和注入布局 class。
- 类型契约:`packages/tuffex/packages/components/src/timeline/src/types.ts` 定义布局与条目颜色联合类型，以及组件 prop 契约。
- **实测覆盖:** `packages/tuffex/packages/components/src/timeline/__tests__/timeline.test.ts` 覆盖列表语义、默认纵向布局、横向布局注入、title/time/默认插槽/图标渲染、语义颜色 class 和 active 条目/节点状态。
- 建议：使用 `active` 标记当前事件，`color` 只使用 `'default' | 'primary' | 'success' | 'warning' | 'error'`，不要传入未定义语义色。

## Source

## 离线完整示例源码

- [TimelineTimelineDemo](../snapshot/apps/nexus/app/components/content/demos/TimelineTimelineDemo.vue.txt)
- [ComponentsPermissionOrchestrationDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsPermissionOrchestrationDemo.vue.txt)

## 离线类型与实现参考

- [timeline/index.ts](../snapshot/packages/tuffex/packages/components/src/timeline/index.ts.txt)
- [src/TxTimeline.vue](../snapshot/packages/tuffex/packages/components/src/timeline/src/TxTimeline.vue.txt)
- [src/TxTimelineItem.vue](../snapshot/packages/tuffex/packages/components/src/timeline/src/TxTimelineItem.vue.txt)
- [src/index.ts](../snapshot/packages/tuffex/packages/components/src/timeline/src/index.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/timeline/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
