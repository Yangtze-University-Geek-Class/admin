# 理念总览

> Tuffex 是什么、背后的三块理念版图，以及完整组件索引

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/index.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/index.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

# 理念总览

## Tuffex Components 组件库

Tuffex（`@talex-touch/tuffex`）是服务 Talex Touch 生态的 Vue 3 组件库：同一套组件覆盖桌面端 CoreBox、插件 Surface 与本文档站。组件按套件划分——**基础**承载日常界面主体、**进阶**承载高级交互与视觉表达、**AI** 承载 AI 原生界面、**数据**承载可视化与独立图表包——侧边栏顶部的套件切换在这四个组件套件之外，另设「理念」作为第五个纯文档页签；点哪个页签就直接进入该套件的总览页。

- 交互标本：每个套件页开头都有一块组件预览——《[基础套件](./base-suite.md)》《[进阶套件](./pro-suite.md)》《[AI 套件](./ai-suite.md)》《[数据套件](./data-suite.md)》——每个格子都是可交互的真实组件，点名称直达文档。
- 分套件引入：`@talex-touch/tuffex/base`、`/pro`、`/ai` 三个分类入口按需加载；图表族在独立包 `@talex-touch/tuffex-charts`。

## 安装与引入

三种引入形态——按组件、按套件入口、或根入口——以及各自需要的样式文件。从《[安装与引入](./installation.md)》开始。

## Design Foundations 设计基础

组件视觉的最底层是一组 `--tx-*` design token：字体栈与字号字重体系、明暗双主题下的颜色语义（主色、成功/警告/危险、文本与填充分层）。组件不各自定义视觉，而是统一消费这层变量——改主题就是改 token，业务侧自定义也应落在同一层。完整清单见《[Design Foundations 设计基础](./foundations.md)》。

## 主题定制

设计基础列出的是 token 清单，《[主题定制](./theming.md)》讲的是怎么覆盖它们：全局 token、深色与高对比度选择器、AI 套件自带的 `--tx-bui-*` 层，以及约三百个可以只改一个组件或一棵子树的组件变量。

## 图标体系

`TxIcon` 自己判断一个图标字符串**是什么**，而不需要调用方声明——Iconify class、七个内置字形之一、emoji，或显式的 URL / 文件来源。《[图标体系](./icons.md)》讲清这套解析顺序，以及应用如何教组件从自己的存储里加载图标。

## 无障碍

`:focus-visible` 上的焦点环、`prefers-reduced-motion` 处理、高对比度调色板，以及组件共用的 ARIA 约定——同时坦白说明覆盖到哪里为止。见《[无障碍](./accessibility.md)》。

## Utils 工具函数

与组件配套的公开工具函数，从根入口与 `./utils` 子路径导出：`nextZIndex` 统一浮层层级、`toast` 轻提示、对话框编排、环境守卫（`hasWindow` 等）、触感反馈与动画辅助。组件内部走的也是这一层，业务侧复用同一入口即可保证行为一致。完整 API 见《[Utils 工具函数](./utils.md)》。

## 组合工作台 Demo

这一组 Demo 用真实后台片段校验组件组合：搜索输入、开关、按钮、状态徽标、进度条与可选择表格会在同一个响应式面板里协同工作。

官方示例：`ComponentsWorkflowPanelDemo`（完整源码见本页末尾）

```vue
<script setup lang="ts">
import { ref } from 'vue'

const query = ref('')
const selectedKeys = ref([1])
const automationEnabled = ref(true)

const columns = [
  { key: 'task', title: '任务' },
  { key: 'owner', title: '负责人' },
  { key: 'status', title: '状态' },
]
const rows = [
  { id: 1, task: '发布说明', owner: 'Ivy', status: '审阅中' },
  { id: 2, task: '灰度放量', owner: 'Long', status: '进行中' },
]
</script>

<template>
  <section class="workflow-panel">
    <header>
      <h3>发布工作台</h3>
      <TxButton variant="primary" size="sm" icon="i-carbon-rocket">发布</TxButton>
    </header>
    <TuffInput v-model="query" placeholder="搜索任务" prefix-icon="i-carbon-search" clearable />
    <TuffSwitch v-model="automationEnabled" />
    <TxProgressBar :percentage="84" status="success" show-text />
    <TxStatusBadge text="审阅中" status="warning" />
    <TxDataTable v-model:selected-keys="selectedKeys" :columns="columns" :data="rows" row-key="id" selectable />
  </section>
</template>
```

## 教程路径

- 新手先读《[Tuffex 组合界面教程](./tuffex-composition.md)》，掌握“操作区 → 状态区 → 数据区”的页面切法。
- 后台首屏建议从“运营状态面板”模式开始，再按需向下展开表格、趋势图、导航配置和详情抽屉。
- 列表页优先把关键词、范围筛选和无结果恢复设计成同一条路径，复用 `TxSearchInput`、`TxSearchSelect`、`TxSearchEmpty`。
- 数据列表建议使用 `TxDataTable` 承担主体、`TxPagination` 承担页码、`TxSkeleton` / `TxLayoutSkeleton` 承担等待态。
- 设置页与后台壳层建议使用 `TxTabs` 固定分区，`TxDropdownMenu` / `TxPopover` 放轻操作与短说明，`TxDrawer` 承载高密度配置。
- 数据区必须同时设计加载、空态和错误恢复路径，优先复用 `TxLoadingState`、`TxEmptyState`、`TxErrorState`。
- 任务反馈路径建议使用 `TxToastHost` 挂载通知、`TxTooltip` 解释动作、`TxLoadingOverlay` 阻断局部刷新、`TxSpinner` 表达行内等待。
- 权限编排路径建议用 `TxTree` 选择权限域、`TxTreeSelect` 选择归属团队、`TxTransfer` 分配资源、`TxTimeline` 展示审计进度。
- 发布配置路径建议用 `TxCascader` 选择发布范围、`TxFlatSelect` 选择包格式与发布模式、`TxSegmentedSlider` 表达风险档位、`TxSlider` 调整灰度比例、`TxTagInput` 记录短标签。
- 组件细节按下方分组查阅；侧边栏仅突出仍需关注的迁移状态，已审阅页面只在状态看板中显示 `已确认`。
- 后台页优先使用 `TxDataTable`、`TxStatusBadge`、`TxProgressBar` 与图表组件组合，避免手写一次性 SVG 或重复状态 UI。

## 迁移状态看板

- `开发中`：文档仍在完善，示例/API 可能继续调整。
- `AI 迁移`：已完成迁移，但仍建议结合源码核对。
- `已审阅`：人工审阅完成。

此处为官网动态目录/交互图库；离线组件与审阅状态见 [组件索引](../COMPONENTS.md)。

## 套件总览

每个套件都有一个总览页，承载自己那一部分的实时预览和组件清单——也就是该套件页签下的第一个条目。

| 套件 | 分组 | 组件数 | 引入入口 |
|------|------|--------|----------|
| [基础套件](./base-suite.md) | 通用 / 表单 / 布局 / 导航 / 数据展示 / 反馈 / 状态占位 | 91 | `@talex-touch/tuffex/base` |
| [进阶套件](./pro-suite.md) | 高级交互 / 视觉效果 / 底层原语 | 27 | `@talex-touch/tuffex/pro` |
| [AI 套件](./ai-suite.md) | 对话 / 智能体 / 推理与生成 / 上下文与洞察 | 29 | `@talex-touch/tuffex/ai` |
| [数据套件](./data-suite.md) | 图表 / 可视化 | 10 | `@talex-touch/tuffex/pro`（可视化）+ `@talex-touch/tuffex-charts`（图表） |

理念是第五个套件页签——纯文档性质、不对应组件入口。本页就是这个页签的总览：上半是组件库定位、设计基础与工具函数，下半是完整组件索引。

## 基础组件

日常界面的主体组件，通过 `@talex-touch/tuffex/base` 分类入口引入。套件页见《[基础套件](./base-suite.md)》，设计基础见《[Foundations 设计基础](./foundations.md)》，工具函数见《[Utils 工具函数](./utils.md)》。

### 通用

- [Button 按钮](./button.md)
- [Icon 图标](./icon.md)
- [Avatar 头像](./avatar.md)
- [Avatar Variants 头像变体](./avatar-variants.md)
- [Tag 标签](./tag.md)
- [Badge 徽标](./badge.md)
- [StatusBadge 状态徽标](./status-badge.md)
- [IconChip 图标角标](./icon-chip.md)
- [Kbd 快捷键](./kbd.md)
- [Divider 分割线](./divider.md)

### 表单

- [Form 表单](./form.md)
- [Input 输入](./input.md)
- [FlatInput 扁平输入](./flat-input.md)
- [Textarea 多行输入](./textarea.md)
- [NumberInput 数字输入](./number-input.md)
- [SearchInput 搜索输入框](./search-input.md)
- [TagInput 标签输入](./tag-input.md)
- [ScrubField 拖拽数值域](./scrub-field.md)
- [Select 选择器](./select.md)
- [FlatSelect 扁平选择](./flat-select.md)
- [SearchSelect 搜索选择器](./search-select.md)
- [TreeSelect 树选择器](./tree-select.md)
- [Cascader 级联选择](./cascader.md)
- [Picker 滚轮选择](./picker.md)
- [DatePicker 日期选择](./date-picker.md)
- [Radio 单选框](./radio.md)
- [FlatRadio 平铺单选](./flat-radio.md)
- [Checkbox 复选框](./checkbox.md)
- [Switch 开关](./switch.md)
- [Slider 滑块](./slider.md)
- [SegmentedSlider 分段滑块](./segmented-slider.md)
- [Rating 评分](./rating.md)
- [FileUploader 文件上传](./file-uploader.md)
- [ImageUploader 图片上传](./image-uploader.md)

### 布局

- [Container 容器](./container.md)
- [Flex 弹性布局](./flex.md)
- [Grid 栅格](./grid.md)
- [GridLayout 网格布局](./grid-layout.md)
- [Stack 堆叠](./stack.md)
- [Splitter 分割面板](./splitter.md)
- [Scroll 滚动](./scroll.md)
- [Collapse 折叠](./collapse.md)
- [Card 卡片](./card.md)
- [CardItem 卡片项](./card-item.md)
- [GroupBlock 分组块](./group-block.md)

### 导航

- [Tabs 标签页](./tabs.md)
- [TabBar 底部导航](./tab-bar.md)
- [NavBar 导航栏](./nav-bar.md)
- [SidebarNav 侧边导航](./sidebar-nav.md)
- [Breadcrumb 面包屑](./breadcrumb.md)
- [Steps 步骤条](./steps.md)
- [Pagination 分页](./pagination.md)
- [DropdownMenu 下拉菜单](./dropdown-menu.md)
- [FlatDropdown 扁平下拉](./flat-dropdown.md)
- [ContextMenu 右键菜单](./context-menu.md)

### 数据展示

- [DataTable 数据表格](./data-table.md)
- [Tree 树形](./tree.md)
- [SortableList 拖拽排序](./sortable-list.md)
- [Timeline 时间线](./timeline.md)
- [Transfer 穿梭框](./transfer.md)
- [StatCard 指标卡片](./stat-card.md)
- [CellLink 单元格链接](./cell-link.md)
- [DotIndicator 圆点指示器](./dot-indicator.md)
- [FilterChips 筛选胶囊](./filter-chips.md)
- [MarkdownView Markdown 渲染](./markdown-view.md)
- [ImageGallery 图片预览](./image-gallery.md)

### 反馈

- [Dialog 弹窗](./dialog.md)
- [Modal 模态框](./modal.md)
- [Drawer 抽屉](./drawer.md)
- [Popover 弹出层](./popover.md)
- [Tooltip 提示](./tooltip.md)
- [Toast 提示](./toast.md)
- [Alert 提示条](./alert.md)
- [Progress 进度](./progress.md)
- [ProgressBar 进度条](./progress-bar.md)
- [Spinner 加载](./spinner.md)
- [LoadingOverlay 加载遮罩](./loading-overlay.md)
- [SelectionActions 划词工具条](./selection-actions.md)

### 状态占位

- [Empty 空状态](./empty.md)
- [EmptyState 空态引导](./empty-state.md)
- [NoData 无数据](./no-data.md)
- [NoSelection 未选择](./no-selection.md)
- [SearchEmpty 搜索空态](./search-empty.md)
- [ErrorState 错误状态](./error-state.md)
- [OfflineState 离线](./offline-state.md)
- [PermissionState 权限不足](./permission-state.md)
- [GuideState 引导状态](./guide-state.md)
- [BlankSlate 空白页](./blank-slate.md)
- [LoadingState 加载态](./loading-state.md)
- [Skeleton 骨架屏](./skeleton.md)
- [LayoutSkeleton 布局骨架](./layout-skeleton.md)

## 进阶套件

高级交互、视觉效果与底层原语，通过 `@talex-touch/tuffex/pro` 分类入口引入。套件页见《[进阶套件](./pro-suite.md)》。

### 高级交互

- [CommandPalette 命令面板](./command-palette.md)
- [SearchPanel 内联搜索面板](./search-panel.md)
- [MarkdownEditor Markdown 编辑器](./markdown-editor.md)
- [CodeEditor 代码编辑器](./code-editor.md)
- [VirtualList 虚拟列表](./virtual-list.md)
- [VersionCapsule 版本胶囊](./version-capsule.md)

### 视觉效果

- [GlassSurface 玻璃拟态](./glass-surface.md)
- [GradientBorder 渐变边框](./gradient-border.md)
- [OutlineBorder 描边容器](./outline-border.md)
- [BorderBeam 流光边框](./border-beam.md)
- [CornerOverlay 角标容器](./corner-overlay.md)
- [GradualBlur 渐变模糊](./gradual-blur.md)
- [EdgeFadeMask 边缘渐隐遮罩](./edge-fade-mask.md)
- [GlowText 扫光](./glow-text.md)
- [KeyframeStrokeText 关键帧描边](./keyframe-stroke-text.md)
- [TuffLogoStroke Logo 描边](./tuff-logo-stroke.md)
- [TextMorph 文本形变](./text-morph.md)
- [TextTransformer 文本变换](./text-transformer.md)
- [Transition 动效](./transition.md)
- [Stagger 依次进入](./stagger.md)
- [Fusion 交融](./fusion.md)
- [Liquid 液态流体](./liquid.md)
- [FlipOverlay 翻转遮罩](./flip-overlay.md)

### 底层原语

- [BaseSurface 基础表面](./base-surface.md)
- [BaseAnchor 锚点定位](./base-anchor.md)
- [Floating 浮动层](./floating.md)
- [AutoSizer 自适应尺寸](./auto-sizer.md)
- [ResizeBox 显式尺寸动画](./resize-box.md)

## AI 套件

AI 原生界面组件族，部分移植自 [Beautiful UI](https://www.beautifului.dev)（MIT），完整案例见《[AI 套件](./ai-suite.md)》，通过 `@talex-touch/tuffex/ai` 分类入口引入。

### 对话

- [Chat 消息列表](./chat.md)
- [ChatComposer 消息输入](./chat-composer.md)
- [PromptBar 提示条](./prompt-bar.md)
- [AttachmentTray 附件区](./attachment-tray.md)
- [MessageActions 消息操作条](./message-actions.md)
- [SuggestionChips 建议胶囊](./suggestion-chips.md)
- [TypingIndicator 打字中](./typing-indicator.md)
- [ConversationStream 会话流](./conversation-stream.md)

### 智能体

- [Agents 智能体列表](./agents.md)
- [AgentTrace 智能体轨迹](./agent-trace.md)
- [TaskRows 任务行](./task-rows.md)
- [ToolCallCard 工具调用卡片](./tool-call-card.md)
- [ToolChips 工具调用流](./tool-chips.md)
- [ToolConfirmation 工具授权](./tool-confirmation.md)
- [ApprovalCard 澄清问卷卡](./approval-card.md)
- [WorkingIndicator 工作指示器](./working-indicator.md)

### 推理与生成

- [AI Elements AI 对话元素](./ai-elements.md)
- [ChainOfThought 推理时间线](./chain-of-thought.md)
- [ReasoningDisclosure 推理过程](./reasoning-disclosure.md)
- [ThinkingOrb 思考指示球](./thinking-orb.md)
- [StreamMarkdown 流式 Markdown](./stream-markdown.md)
- [CodeStream 流式代码块](./code-stream.md)
- [InlineCitation 行内引用](./inline-citation.md)
- [Sources 引用来源](./sources.md)

### 上下文与洞察

- [ContextCards 检索片段卡](./context-cards.md)
- [ContextIndicator 上下文用量](./context-indicator.md)
- [InsightCards 洞察卡](./insight-cards.md)
- [RecommendationCard 建议卡](./recommendation-card.md)
- [FineTuneCard 属性检查器](./fine-tune-card.md)

## 数据

数据可视化与图表：tuffex 主包的可视化组件（经 `@talex-touch/tuffex/pro` 引入）+ 独立图表包 `@talex-touch/tuffex-charts`（kumo 同构、无 echarts）。套件页见《[数据套件](./data-suite.md)》。

### 图表

独立图表包 `@talex-touch/tuffex-charts`（kumo）的文档，与 tuffex 主包分开安装。

- [Charts 图表](./charts.md)
- [Chart Colors 图表色板](./chart-colors.md)
- [TimeseriesChart 时序图](./timeseries-chart.md)
- [Maps 地图](./maps.md)
- [SankeyChart 桑基图](./sankey-chart.md)
- [Custom Chart 自定义图表](./custom-chart.md)

### 可视化

- [SparkChart 迷你折线图](./spark-chart.md)
- [AllocationBar 占比条](./allocation-bar.md)
- [DiffTable 变更表格](./diff-table.md)
- [SignalMeter 信号量表](./signal-meter.md)

## 审阅说明

- 中心页范围：本页既是理念套件总览，也是组件文档索引；单组件 API、Props、最佳实践细节由各组件详情页承载。
- 源码注册表：`packages/tuffex/packages/components/src/components.ts` 定义文档覆盖测试使用的导出组件 slug 集合。
- Demo 注册表：`apps/nexus/app/components/content/demo-registry.ts` 把本页每个 `TuffDemoWrapper` demo 映射到独立 Vue demo 文件。
- 预览网格：`apps/nexus/app/components/docs/DocsComponentsGallery.vue` 渲染各套件页的「组件预览」网格；`suite` 为必填 prop，一次只渲染该套件那一段。
- **实测覆盖:** Coverage: `apps/nexus/test/docs/tuffex-component-docs-coverage.test.ts` 校验导出组件具备中英文文档、本地化中心页链接已文档化组件、所有 demo 引用都能解析到已注册 Vue 文件。

## 离线完整示例源码

- [ComponentsWorkflowPanelDemo](../snapshot/apps/nexus/app/components/content/demos/ComponentsWorkflowPanelDemo.vue.txt)

## 离线类型与实现参考

本页是跨组件/概念说明；先按具体组件查询 catalog.json，再按 SOURCE 清单核对；不要从名称猜导出。

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
