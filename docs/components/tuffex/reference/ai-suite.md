# AI 套件

> 源自 Beautiful UI 的 19 个 AI 原生界面组件案例集

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/ai-suite) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/ai-suite.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/ai-suite.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`true`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

## 套件分组

AI 套件在组件侧边栏分为四组：**对话**（Chat、ChatComposer、PromptBar、AttachmentTray、MessageActions、SuggestionChips、TypingIndicator、ConversationStream）、**智能体**（Agents、AgentTrace、TaskRows、ToolCallCard、ToolChips、ToolConfirmation、ApprovalCard、WorkingIndicator）、**推理与生成**（AiElements、ChainOfThought、ReasoningDisclosure、ThinkingOrb、StreamMarkdown、CodeStream、InlineCitation、Sources）、**上下文与洞察**（ContextCards、ContextIndicator、InsightCards、RecommendationCard、FineTuneCard）。全部组件可经 `@talex-touch/tuffex/ai` 分类入口按套件引入。

## 组件预览

每个格子都是可交互的真实组件，点击左上角名称进入对应组件文档。

此处为官网动态目录/交互图库；离线组件与审阅状态见 [组件索引](../COMPONENTS.md)。

## 分组一览

下面按分组列出该套件的**全部**组件，数据来自每个文档的 `category` frontmatter，新增组件会自动出现。

此处为官网动态目录/交互图库；离线组件与审阅状态见 [组件索引](../COMPONENTS.md)。

## 来源与授权

本套件移植自 [Beautiful UI](https://www.beautifului.dev)（Turbo 设计工作室 / Shane Levine，© 2026，MIT 协议），共 19 个面向 AI 原生界面的组件案例：聊天、推理轨迹、human-in-the-loop 审批、agent 任务状态等。移植遵循三条原则：像素级还原其视觉语言（独立 `--tx-bui-*` token 层、发丝环阴影、13px 密度体系）；组件做成纯受控原语（演示时间轴留在 demo 层）；与 tuffex 现有组件融合而非重复造轮子——重叠处以变体或组合落地，无障碍缺口按 tuffex 标准补齐。每个组件源码文件头保留 MIT 署名。

## 加载与推理状态

### 01 · 工作指示器 WorkingIndicator

像素网格加载器 + shimmer 标签 + 实时计时，用于长任务进行中。详见 [WorkingIndicator 文档](./working-indicator.md)。

官方示例：`WorkingIndicatorVariantsDemo`（完整源码见本页末尾）

```vue
<template>
  <TxWorkingIndicator label="Churning" variant="drive" />
  <TxWorkingIndicator label="Churning" variant="dots" />
  <TxWorkingIndicator label="Churning" variant="orbit" />
</template>
```

### 02 · 推理轨迹 AgentTrace

可展开的思考/搜索/编码轨迹，头部 shimmer 与完成态自动切换。详见 [AgentTrace 文档](./agent-trace.md)。

官方示例：`AgentTraceVariantsDemo`（完整源码见本页末尾）

```vue
<template>
  <TxAgentTrace variant="steps" :rows="rows" :working="working" />
</template>
```

### 06 · 任务行 TaskRows

agent 任务状态列表：环形序号、状态药丸、明细折叠，胶囊/列表两种容器。详见 [TaskRows 文档](./task-rows.md)。

官方示例：`TaskRowsCapsulesDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTaskRows :rows="rows" variant="capsules" />
</template>
```

### 17 · 流式代码块 CodeStream

agent 写代码逐行显现，文件名头部 + shiki 高亮 + 复制。详见 [CodeStream 文档](./code-stream.md)。

官方示例：`CodeStreamStreamingDemo`（完整源码见本页末尾）

```vue
<template>
  <TxCodeStream :code="code" lang="ts" filename="churn.ts" :revealed-lines="revealed" />
</template>
```

## 流式输出与聊天

### 03 · 流式回答 Streaming Text

组合案例：`TxStreamMarkdown` 逐词显影 + `TxInlineCitation` 行内引用 + `TxSources` 堆叠来源 + `TxSuggestionChips` 纵向追问。详见 [InlineCitation 文档](./inline-citation.md)。

官方示例：`AiSuiteStreamingAnswerDemo`（完整源码见本页末尾）

```vue
<template>
  <TxInlineCitation v-bind="cite" />
  <TxSources :sources="sources" variant="stack" />
  <TxSuggestionChips :suggestions="followUps" layout="list" />
</template>
```

### 07 · 聊天面板 Chat

组合案例（不新增组件）：`TxTabs` + `TxConversationStream` + `TxChainOfThought` + `TxChatComposer` 复刻上游聊天面板。

官方示例：`AiSuiteChatShowcaseDemo`（完整源码见本页末尾）

```vue
<template>
  <TxTabs v-model="tab">
    <TxConversationStream :items="messages" />
  </TxTabs>
</template>
```

### 08 · 输入条 PromptBar

@ 来源、/ 命令、模型选择器、听写状态，rounded/pill 双形态；发送键用墨色而非品牌蓝，是该设计语言的签名。详见 [PromptBar 文档](./prompt-bar.md)。

官方示例：`PromptBarPromptBarDemo`（完整源码见本页末尾）

```vue
<template>
  <TxPromptBar v-model="draft" :sources="sources" :commands="commands" :models="models" />
</template>
```

## 审批与智能动作

### 04 · 审批卡 ApprovalCard

human-in-the-loop 多问题走查：选项 + 自定义答案 + 分页圆点。详见 [ApprovalCard 文档](./approval-card.md)。

官方示例：`ApprovalCardWalkthroughDemo`（完整源码见本页末尾）

```vue
<template>
  <TxApprovalCard v-model="answers" :questions="questions" @submit="onSubmit" />
</template>
```

### 05 · 工具纸片 ToolChips

工具调用与代码编辑的紧凑纸片流，摘要行可展开。详见 [ToolChips 文档](./tool-chips.md)。

官方示例：`ToolChipsRunFlowDemo`（完整源码见本页末尾）

```vue
<template>
  <TxToolChips :rows="rows" :diffs="diffs" summary="4 tool calls, 2 messages" />
</template>
```

### 09 · 建议卡 RecommendationCard

agent 建议 + 三段置信度表（`TxSignalMeter`）+ 备选方案。详见 [RecommendationCard 文档](./recommendation-card.md)。

官方示例：`RecommendationCardConfidenceDemo`（完整源码见本页末尾）

```vue
<template>
  <TxRecommendationCard :title="title" :options="options" confidence="high" @accept="onAccept" />
</template>
```

### 19 · 划词动作 SelectionActions

选中一段文字，浮出工具条交给 agent 改写；基于 TxBaseAnchor 虚拟锚点。详见 [SelectionActions 文档](./selection-actions.md)。

官方示例：`SelectionActionsRewriteDemo`（完整源码见本页末尾）

```vue
<template>
  <TxSelectionActions :selection="selection" :actions="actions" @action="onAction" />
</template>
```

## 数据表格

### 11 · 差分表 DiffTable

AI 提案改动的扫掠动画：标红删除、展开新增，`play/reset/settle` 可控。详见 [DiffTable 文档](./diff-table.md)。

官方示例：`DiffTableDiffTableDemo`（完整源码见本页末尾）

```vue
<template>
  <TxDiffTable :columns="columns" :rows="rows" title="Proposed menu cleanup" />
</template>
```

### 12 · 记录表 Records

组合案例（不新增组件）：扩展后的 `TxDataTable`（吸顶表头 / 汇总页脚 / 选中高亮 / 三态全选）+ `TxTag` 圆点标签 + `TxDotIndicator` + `TxCellLink`。详见 [DataTable 文档](./data-table.md)。

官方示例：`DataTableRecordsDemo`（完整源码见本页末尾）

```vue
<template>
  <TxDataTable :columns="columns" :data="rows" selectable highlight-selected
    :max-height="438" scroll-x sticky-header sticky-footer sort-cycle="bi" />
</template>
```

### 13 · 过滤表 FilterTable

`TxFilterChips` 状态纸片 + `TxDataTable` 组合，计数由数据派生。详见 [FilterChips 文档](./filter-chips.md)。

官方示例：`FilterChipsFilterTableDemo`（完整源码见本页末尾）

```vue
<template>
  <TxFilterChips v-model="filter" :items="chips" />
  <TxDataTable :columns="columns" :data="visibleRows" />
</template>
```

## 检索与导航

### 10 · 上下文卡 ContextCards

RAG 检索块：正文、字符数、来源文件行，单块 `TxContextChunk` 可独立使用。详见 [ContextCards 文档](./context-cards.md)。

官方示例：`ContextCardsContextCardsDemo`（完整源码见本页末尾）

```vue
<template>
  <TxContextCards :chunks="chunks" :total="32" @open="onOpen" />
</template>
```

### 14 · 侧边导航 SidebarNav

工作区导航：组头、徽标、快捷搜索与 `/` 聚焦快捷键（上游为纯装饰，移植补齐为真功能）。详见 [SidebarNav 文档](./sidebar-nav.md)。

官方示例：`SidebarNavSidebarNavDemo`（完整源码见本页末尾）

```vue
<template>
  <TxSidebarNav v-model="active" :items="items" :groups="groups" search-hint="/" />
</template>
```

### 15 · 搜索面板 SearchPanel

命令搜索 + 实时过滤 + 空态；键盘导航按 tuffex 标准补齐（上游没有）。详见 [SearchPanel 文档](./search-panel.md)。

官方示例：`SearchPanelSearchPanelDemo`（完整源码见本页末尾）

```vue
<template>
  <TxSearchPanel v-model="query" :items="commands" @select="run" />
</template>
```

## 洞察与调节

### 16 · 洞察卡 InsightCards

分页洞察 + 自研 canvas 折线（`TxSparkChart` + `TxChartScrubber`）+ 占比条（`TxAllocationBar`）+ 指标行（`TxInsightMetric`）。详见 [InsightCards 文档](./insight-cards.md)。

官方示例：`InsightCardsInsightCardsDemo`（完整源码见本页末尾）

```vue
<template>
  <TxInsightCards v-model:active-index="page" :pages="pages" @follow-up="ask">
    <TxSparkChart :series="series" />
  </TxInsightCards>
</template>
```

### 18 · 微调卡 FineTuneCard

agent 在检查器里调整设计属性：布局分段（复用 `TxFlatRadio`）+ 可拖拽数值域 `TxScrubField` + 类型选择。详见 [FineTuneCard 文档](./fine-tune-card.md)。

官方示例：`FineTuneCardFineTuneCardDemo`（完整源码见本页末尾）

```vue
<template>
  <TxFineTuneCard v-model:values="values" :defaults="defaults" :type-options="types" />
</template>
```

## 组件索引

| BUI 案例 | tuffex 落地 | 形态 |
|---|---|---|
| 01 Loading State | [TxWorkingIndicator](./working-indicator.md) | 新组件 |
| 02 Thinking | [TxAgentTrace](./agent-trace.md) | 新组件 |
| 03 Streaming Text | [TxInlineCitation](./inline-citation.md) + [TxSources](./sources.md) `stack` + [TxSuggestionChips](./suggestion-chips.md) `list` | 新叶子 + 现有组件变体 |
| 04 Approval Card | [TxApprovalCard](./approval-card.md) | 新组件 |
| 05 Tool Chips | [TxToolChips / TxDiffChips](./tool-chips.md) | 新组件 |
| 06 Task Rows | [TxTaskRows](./task-rows.md) | 新组件 |
| 07 Chat | 本页 showcase demo | 现有组件组合 |
| 08 Prompt Bar | [TxPromptBar](./prompt-bar.md) | 新组件 |
| 09 Recommendation Card | [TxRecommendationCard](./recommendation-card.md) + [TxSignalMeter](./signal-meter.md) | 新组件 + 新原子 |
| 10 Context Cards | [TxContextCards / TxContextChunk](./context-cards.md) | 新组件 |
| 11 Diff Table | [TxDiffTable](./diff-table.md) | 新组件 |
| 12 Records Table | [TxDataTable 扩展](./data-table.md) + [TxTag](./tag.md) + [TxDotIndicator](./dot-indicator.md) + [TxCellLink](./cell-link.md) + [TxCheckbox](./checkbox.md) 三态 | 现有组件加法式扩展 + 新原语 |
| 13 Filter Table | [TxFilterChips](./filter-chips.md) + TxDataTable | 新原语 + 组合 |
| 14 Sidebar Nav | [TxSidebarNav](./sidebar-nav.md) | 新组件 |
| 15 Search | [TxSearchPanel](./search-panel.md) | 组合薄壳 |
| 16 Insight Cards | [TxInsightCards](./insight-cards.md) + [TxSparkChart](./spark-chart.md) + [TxAllocationBar](./allocation-bar.md) | 新组件族 |
| 17 Code Block | [TxCodeStream](./code-stream.md) | 新组件 |
| 18 Fine-tune Card | [TxFineTuneCard](./fine-tune-card.md) + [TxScrubField](./scrub-field.md) | 新组件 + 新原语 |
| 19 Selection Actions | [TxSelectionActions](./selection-actions.md) | 组合优先新组件 |

共享原语：[TxIconChip](./icon-chip.md)（10/14/16/18 共用图标角标）。

## 审阅说明

- 上游为自驱动 demo（内容硬编码 + 定时器时间轴）；移植后组件全部受控，时间轴仅存在于本页各 demo 内。
- reduced-motion 逐组件显式实现：只砍补间不砍状态机，延迟一并归零（相对上游全局 `*` 规则的有意偏离）。
- 高对比主题（`data-tx-contrast='high'`）下 `--tx-bui-*` 保持原值，为已知限制。
- 16 的图表区上游截图渲染为 "No data to display"，图表按规格实现、无上游视觉基线。
- 全部组件源码文件头携带 MIT 署名：Adapted from Beautiful UI, © 2026 Shane Levine, MIT。

## 离线完整示例源码

- [WorkingIndicatorVariantsDemo](../snapshot/apps/nexus/app/components/content/demos/WorkingIndicatorVariantsDemo.vue.txt)
- [AgentTraceVariantsDemo](../snapshot/apps/nexus/app/components/content/demos/AgentTraceVariantsDemo.vue.txt)
- [TaskRowsCapsulesDemo](../snapshot/apps/nexus/app/components/content/demos/TaskRowsCapsulesDemo.vue.txt)
- [CodeStreamStreamingDemo](../snapshot/apps/nexus/app/components/content/demos/CodeStreamStreamingDemo.vue.txt)
- [AiSuiteStreamingAnswerDemo](../snapshot/apps/nexus/app/components/content/demos/AiSuiteStreamingAnswerDemo.vue.txt)
- [AiSuiteChatShowcaseDemo](../snapshot/apps/nexus/app/components/content/demos/AiSuiteChatShowcaseDemo.vue.txt)
- [PromptBarPromptBarDemo](../snapshot/apps/nexus/app/components/content/demos/PromptBarPromptBarDemo.vue.txt)
- [ApprovalCardWalkthroughDemo](../snapshot/apps/nexus/app/components/content/demos/ApprovalCardWalkthroughDemo.vue.txt)
- [ToolChipsRunFlowDemo](../snapshot/apps/nexus/app/components/content/demos/ToolChipsRunFlowDemo.vue.txt)
- [RecommendationCardConfidenceDemo](../snapshot/apps/nexus/app/components/content/demos/RecommendationCardConfidenceDemo.vue.txt)
- [SelectionActionsRewriteDemo](../snapshot/apps/nexus/app/components/content/demos/SelectionActionsRewriteDemo.vue.txt)
- [DiffTableDiffTableDemo](../snapshot/apps/nexus/app/components/content/demos/DiffTableDiffTableDemo.vue.txt)
- [DataTableRecordsDemo](../snapshot/apps/nexus/app/components/content/demos/DataTableRecordsDemo.vue.txt)
- [FilterChipsFilterTableDemo](../snapshot/apps/nexus/app/components/content/demos/FilterChipsFilterTableDemo.vue.txt)
- [ContextCardsContextCardsDemo](../snapshot/apps/nexus/app/components/content/demos/ContextCardsContextCardsDemo.vue.txt)
- [SidebarNavSidebarNavDemo](../snapshot/apps/nexus/app/components/content/demos/SidebarNavSidebarNavDemo.vue.txt)
- [SearchPanelSearchPanelDemo](../snapshot/apps/nexus/app/components/content/demos/SearchPanelSearchPanelDemo.vue.txt)
- [InsightCardsInsightCardsDemo](../snapshot/apps/nexus/app/components/content/demos/InsightCardsInsightCardsDemo.vue.txt)
- [FineTuneCardFineTuneCardDemo](../snapshot/apps/nexus/app/components/content/demos/FineTuneCardFineTuneCardDemo.vue.txt)

## 离线类型与实现参考

本页是跨组件/概念说明；先按具体组件查询 catalog.json，再按 SOURCE 清单核对；不要从名称猜导出。

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
