# Pagination 分页

> 大数据列表的分页导航

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/pagination) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/pagination.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/pagination.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`1.0.0`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# Pagination 分页

<script setup lang="ts">
import { ref } from 'vue'

const page = ref(1)
</script>

## 基础用法
### 分页导航
在多页数据间切换。
官方示例：`PaginationPaginationDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const page = ref(1)
</script>

<template>
  <TxPagination
    v-model:current-page="page"
    :total="120"
    :page-size="10"
    show-info
    show-first-last
  />
</template>
```

## API
### Props
```yaml
rows:
  - name: currentPage
    type: number
    default: '1'
    description: 当前页
  - name: pageSize
    type: number
    default: '10'
    description: 每页数量
  - name: total
    type: number
    default: '-'
    description: 总条数；省略或传 0 时改用 totalPages 计算总页数
  - name: totalPages
    type: number
    default: '-'
    description: 显式总页数；未提供 total 时使用
  - name: prevIcon
    type: string
    default: "'i-carbon-chevron-left'"
    description: 上一页图标（UnoCSS 图标类，供 TxIcon 使用）
  - name: nextIcon
    type: string
    default: "'i-carbon-chevron-right'"
    description: 下一页图标（UnoCSS 图标类，供 TxIcon 使用）
  - name: showInfo
    type: boolean
    default: 'false'
    description: 显示总量信息
  - name: showFirstLast
    type: boolean
    default: 'false'
    description: 显示首末页按钮
```

## Events
```yaml
rows:
  - name: update:currentPage
    type: '(page: number) => void'
    default: '-'
    description: v-model 当前页更新
  - name: pageChange
    type: '(page: number) => void'
    default: '-'
    description: 用户切换页码时触发
```

## Slots
```yaml
rows:
  - name: info
    type: '{ currentPage: number, totalPages: number, total?: number }'
    default: '-'
    description: 自定义页码信息区域
```

## 交互契约

- `total` 优先用于按 `pageSize` 计算总页数；未提供 `total` 时使用 `totalPages`。
- `showFirstLast` 会渲染首末页跳转按钮，边界页会禁用首/上一页或下一页/末页。
- 当前页按钮带 `aria-current="page"`，上一页/下一页/首末页按钮带可读 `aria-label`。

## 最佳实践

- 优先使用 `total + pageSize`，让界面能展示数据总数；只有后端无法返回总数时才使用 `totalPages`。
- `currentPage` 按 1 开始计数，初始化为 `1`，不要用 `0`。
- 筛选条件或搜索词变化后，如果旧页码可能越界，应把 `currentPage` 重置为 `1`。
- 分页控件应紧贴它控制的列表或表格。
- 使用 `info` 插槽输出本地化范围文案，例如“正在查看第 21–40 条，共 120 条”。


## 后台数据运维面板

分页建议紧贴表格底部，和当前筛选/选择状态共享同一组响应式数据；不要让分页脱离列表容器单独悬浮。

官方示例：`ComponentsDataOperationsDemo`（完整源码见本页末尾）

```vue
<template>
  <TxPagination
    v-model:current-page="page"
    :total="rows.length"
    :page-size="4"
    show-info
    show-first-last
  />
</template>
```

## 审阅说明

- 组件源码:`packages/tuffex/packages/components/src/pagination/src/TxPagination.vue` 确认 total/pageSize 页数计算、省略号窗口生成、边界保护、首末页控制、info 插槽参数、`aria-current` 和可读分页按钮标签。
- 类型契约:`packages/tuffex/packages/components/src/pagination/src/types.ts` 定义 `PaginationProps` 和 `PaginationEmits`。
- **实测覆盖:** Coverage: `packages/tuffex/packages/components/src/pagination/__tests__/pagination.test.ts` 覆盖 total 计算页数、省略号渲染、当前页语义、越界导航抑制、首末页控制、边界禁用状态、自定义 info 插槽参数和正文列表样式隔离。
- 建议：优先传 `total + pageSize`，只有后端只返回页数时再传 `totalPages`。

## Source

## 离线完整示例源码

- [PaginationPaginationDemo](../snapshot/apps/nexus/app/components/content/demos/PaginationPaginationDemo.vue.txt)
- [ComponentsDataOperationsDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsDataOperationsDemo.vue.txt)

## 离线类型与实现参考

- [pagination/index.ts](../snapshot/packages/tuffex/packages/components/src/pagination/index.ts.txt)
- [src/TxPagination.vue](../snapshot/packages/tuffex/packages/components/src/pagination/src/TxPagination.vue.txt)
- [src/index.ts](../snapshot/packages/tuffex/packages/components/src/pagination/src/index.ts.txt)
- [src/types.ts](../snapshot/packages/tuffex/packages/components/src/pagination/src/types.ts.txt)

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
