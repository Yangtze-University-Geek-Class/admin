# StatCard 指标卡片

> 用于展示核心数字、趋势洞察与进度摘要的指标卡片。

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/stat-card) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/stat-card.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/stat-card.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# StatCard 指标卡片

## 基础用法

### 默认样式

基础卡片布局，不包含趋势和进度增强。

官方示例：`StatCardDefaultVariantDemo`（完整源码见本页末尾）

```vue
<template>
  <TxStatCard
    :value="2847"
    label="插件总数"
    icon-class="i-carbon-download text-6xl text-[var(--tx-color-primary)]"
    clickable
  />
</template>
```

### 趋势样式

通过 `insight` 展示变化趋势和对比信息。

官方示例：`StatCardInsightVariantDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const activeUsers = ref(18200)
const activeInsight = ref({
  from: 16800,
  to: activeUsers.value,
  type: 'delta',
  color: 'success',
  iconClass: 'i-carbon-growth',
})

const resourceLoad = ref(42)
const resourceInsight = ref({
  from: 35,
  to: resourceLoad.value,
  type: 'percent',
  color: 'danger',
  iconClass: 'i-carbon-arrow-up-right',
  precision: 1,
})

function bump() {
  const nextUsers = Math.floor(Math.random() * 8000) + 14000
  const nextLoad = Math.floor(Math.random() * 50) + 30

  activeInsight.value = {
    ...activeInsight.value,
    from: activeUsers.value,
    to: nextUsers,
  }
  activeUsers.value = nextUsers

  resourceInsight.value = {
    ...resourceInsight.value,
    from: resourceLoad.value,
    to: nextLoad,
  }
  resourceLoad.value = nextLoad
}
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 12px;">
    <div style="display: flex; gap: 8px;">
      <TxButton @click="bump">
        随机刷新
      </TxButton>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
      <TxStatCard
        :value="activeUsers"
        label="活跃用户"
        icon-class="i-carbon-task text-6xl text-[var(--tx-color-success)]"
        :insight="activeInsight"
      />
      <TxStatCard
        :value="resourceLoad"
        label="资源负载"
        icon-class="i-carbon-chip text-6xl text-[var(--tx-color-warning)]"
        :insight="resourceInsight"
      >
        <template #value>
          <div style="display: flex; align-items: baseline; gap: 6px;">
            <TxTextMorph :text="resourceLoad" />
            <span style="font-size: 16px;">%</span>
          </div>
        </template>
      </TxStatCard>
    </div>
  </div>
</template>
```

### 进度样式

使用 `progress` 切换为进度卡片，并支持 `Shuffle` 动态刷新。

官方示例：`StatCardProgressVariantDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'

const healthProgress = ref(78)
const healthDelay = ref(2)

const healthStatus = computed(() => {
  if (healthProgress.value > 85) {
    return '已同步'
  }
  return '同步中'
})

const healthMeta = computed(() => `${healthStatus.value} · 上次同步：${healthDelay.value}s 前 (v2.4.0)`)

function bump() {
  healthProgress.value = Math.floor(Math.random() * 50) + 40
  healthDelay.value = Math.floor(Math.random() * 16) + 2
}
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 12px;">
    <div style="display: flex; gap: 8px;">
      <TxButton @click="bump">
        随机刷新
      </TxButton>
    </div>

    <TxStatCard
      variant="progress"
      :value="healthProgress"
      label="云同步"
      :meta="healthMeta"
      :progress="healthProgress"
      icon-class="i-carbon-cloud text-[var(--tx-color-primary)]"
    >
      <template #value>
        <div style="display: flex; align-items: baseline; gap: 6px;">
          <TxTextMorph :text="healthProgress" />
          <span style="font-size: 16px;">%</span>
        </div>
      </template>
    </TxStatCard>
  </div>
</template>
```

### 后台运营面板

`TxStatCard` 可与 `TxStatusBadge`、`TxProgressBar` 组合成后台首屏状态区，适合展示 API 可用率、待处理队列和告警数量。

官方示例：`ComponentsOperationsStatusDemo`（完整源码见本页末尾）

```vue
<template>
  <section class="grid gap-3" style="grid-template-columns: repeat(3, minmax(0, 1fr));">
    <TxStatCard
      variant="progress"
      value="99.9%"
      label="API 可用率"
      meta="正常"
      :progress="99"
      icon-class="i-carbon-cloud-monitoring text-[var(--tx-color-success)]"
    />
    <TxStatCard
      variant="progress"
      :value="18"
      label="待处理队列"
      meta="关注"
      :progress="64"
      icon-class="i-carbon-queued text-[var(--tx-color-warning)]"
    />
    <TxStatCard
      variant="progress"
      :value="2"
      label="告警"
      meta="阻塞"
      :progress="22"
      icon-class="i-carbon-warning-alt text-[var(--tx-color-danger)]"
    />
  </section>
</template>
```

## API

### Props

| 属性名 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `value` | `number \| string` | - | 主数值；传入 number 时会使用默认数字格式化 |
| `label` | `string` | - | 指标标签；在 insight/progress 布局中显示在顶部 |
| `iconClass` | `string` | `''` | 图标 class（UnoCSS Icones） |
| `clickable` | `boolean` | `false` | 开启 hover/press 视觉状态，不会自动添加点击行为 |
| `insight` | `StatCardInsight` | - | 指标变化对象；启用后 label 上移并渲染趋势信息 |
| `variant` | `StatCardVariant` | `'default'` | 布局变体（`default` \| `progress`） |
| `progress` | `number` | - | 进度百分比；传入即启用进度变体，进度环会裁剪到 0-100 |
| `meta` | `string` | - | 进度变体底部说明；存在 `meta` 插槽时会被覆盖 |

### StatCardInsight

| 字段 | 类型 | 默认值 | 说明 |
|------|------|---------|------|
| `from` | `number` | - | 基准值 |
| `to` | `number` | - | 当前值 |
| `type` | `'percent' \| 'delta'` | `'percent'` | 百分比变化或绝对增量 |
| `color` | `'success' \| 'danger' \| 'warning' \| 'info' \| string` | - | 自定义颜色 |
| `iconClass` | `string` | - | 指标图标 |
| `suffix` | `string` | - | 自定义后缀（默认 percent 为 `%`） |
| `precision` | `number` | - | 小数精度 |


### Slots

| 插槽 | 说明 |
|------|------|
| `value` | 自定义数值区域 |
| `label` | 自定义标题区域 |
| `meta` | 进度变体底部说明 |

## 最佳实践

- 计数类指标优先传 number，让默认格式化补充分隔符；单位或动效布局复杂时再使用 `value` 插槽。
- 绝对变化用 `insight.type="delta"`，相对变化用 `insight.type="percent"`；默认精度分别是 `0` 与 `1`。
- `variant="progress"` 只用于健康度、容量、配额、完成率等有边界的指标，不用于无限增长的总量。
- `clickable` 只提供视觉反馈。需要跳转或操作时，应由外层按钮/链接或相邻操作控件承载真实交互。

## 审阅说明

- 源码：`packages/tuffex/packages/components/src/stat-card/src/TxStatCard.vue`
- 建议：普通指标使用默认变体，增减趋势使用 `insight`，0-100 边界明确的健康度/容量使用 `variant="progress"`。
- 可访问性：组件根节点使用 `role="group"`；在 Dashboard 中应给相邻标题或上下文，避免只显示裸数字。

## Source

- Component source: `packages/tuffex/packages/components/src/stat-card/src/TxStatCard.vue`。
- Type contracts: `packages/tuffex/packages/components/src/stat-card/src/types.ts` 导出 `StatCardProps`、`StatCardInsight` 与变体类型。
- **实测覆盖:** `packages/tuffex/packages/components/src/stat-card/__tests__/stat-card.test.ts` 覆盖默认渲染、自定义 value 与 label 插槽、百分比与增量 insight、进度激活与进度环裁剪，以及自定义 progress meta 插槽。

## 离线完整示例源码

- [StatCardDefaultVariantDemo](../snapshot/apps/nexus/app/components/content/demos/StatCardDefaultVariantDemo.vue.txt)
- [StatCardInsightVariantDemo](../snapshot/apps/nexus/app/components/content/demos/StatCardInsightVariantDemo.vue.txt)
- [StatCardProgressVariantDemo](../snapshot/apps/nexus/app/components/content/demos/StatCardProgressVariantDemo.vue.txt)
- [ComponentsOperationsStatusDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsOperationsStatusDemo.vue.txt)

## 离线类型与实现参考

- [stat-card/index.ts](../snapshot/packages/tuffex/packages/components/src/stat-card/index.ts.txt)
- [src/TxStatCard.vue](../snapshot/packages/tuffex/packages/components/src/stat-card/src/TxStatCard.vue.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/stat-card/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
