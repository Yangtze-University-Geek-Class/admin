# Tuffex 组件与指南索引

> 按官方分类检索中文文档；每页包含 API、示例和固定版本源码链接。

状态：`reference-snapshot` · 171 篇 · 源码包 0.6.0 · 提交 `8e37c8ca7f598b12f39a2384573dc8e03b20e843`

先读 [AI-GUIDE](AI-GUIDE.md) 和 [使用政策](USAGE-POLICY.md)。本索引不宣称所有上游能力已审阅或适配到本项目。

## Advanced

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [CodeEditor 代码编辑器](./reference/code-editor.md) | 基于 CodeMirror 的 JSON/YAML 编辑器，同时提供轻量 TOML、INI、JavaScript 编辑能力，支持格式化、校验、搜索、折叠和 toolbar 插槽。 | pro | reviewed |
| [CommandPalette 命令面板](./reference/command-palette.md) | 用于全局快捷指令、插件入口和搜索动作的命令面板。 | pro | reviewed |
| [MarkdownEditor](./reference/markdown-editor.md) | 带净化、工具栏和 WYSIWYG/source/preview 模式的 Markdown 编辑器。 | pro | reviewed |
| [SearchPanel 内联搜索面板](./reference/search-panel.md) | 卡片式内联搜索：输入框、实时结果与空态合为一体。 | pro | reviewed |
| [VersionCapsule 版本胶囊](./reference/version-capsule.md) | 分段式版本胶囊：左半下载构建，右半打开历史。 | pro | reviewed |
| [VirtualList 虚拟列表](./reference/virtual-list.md) | 固定行高虚拟列表，用更少 DOM 渲染长数据集，并提供命令式滚动方法。 | pro | reviewed |

## AiAgent

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [AgentTrace 智能体轨迹](./reference/agent-trace.md) | 可展开的智能体轨迹，覆盖步骤、推理、检索、工具四种形态。 | ai | reviewed |
| [Agents 智能体列表](./reference/agents.md) | 可选择的智能体列表，支持启用/禁用分组、loading 骨架、空态、选中态和 badge。 | ai | reviewed |
| [ApprovalCard 澄清问卷卡](./reference/approval-card.md) | 智能体动手前的逐题走查：单选、多选、自由作答，带分页与提交态。 | ai | reviewed |
| [TaskRows 任务行](./reference/task-rows.md) | 智能体任务状态行：环形序号、状态药丸、可展开的执行明细。 | ai | reviewed |
| [Tool Call Card](./reference/tool-call-card.md) | 工具调用的状态卡片，运行日志自动跟随尾部，结果区可由宿主接管。 | ai | reviewed |
| [ToolChips 工具调用流](./reference/tool-chips.md) | 一次智能体运行的紧凑行流：逐行可展开的工具调用，末尾是文件差分 chip。 | ai | reviewed |
| [Tool Confirmation](./reference/tool-confirmation.md) | 工具调用前的授权卡片，带风险等级与「本次会话记住」。 | ai | reviewed |
| [WorkingIndicator 工作指示器](./reference/working-indicator.md) | 长任务进行中的行内指示器：像素格 + 微光标签 + 实时计时。 | ai | reviewed |

## AiChat

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [Attachment Tray](./reference/attachment-tray.md) | 消息附件区，图片走网格与预览器，文件走胶囊，可选上传进度与移除。 | ai | reviewed |
| [Chat 消息列表](./reference/chat.md) | 支持 Markdown、图片附件、消息入场动画与图片点击事件的 AI 消息列表。 | ai | reviewed |
| [ChatComposer 消息输入](./reference/chat-composer.md) | AI 消息输入、附件 chip、键盘发送和自定义工具栏。 | 见文档 | reviewed |
| [Conversation Stream](./reference/conversation-stream.md) | 虚拟滚动的会话流，自动吸底并向上翻取历史。 | ai | reviewed |
| [Message Actions](./reference/message-actions.md) | 消息下方的操作条，内置复制与重新生成，方向键在按钮间移动。 | ai | reviewed |
| [PromptBar 提示条](./reference/prompt-bar.md) | 紧凑的对话输入条：@ 数据源、/ 命令、模型选择、听写与附件都内联在输入框里。 | ai | reviewed |
| [Suggestion Chips](./reference/suggestion-chips.md) | 横向排列的提问建议胶囊，供用户一键发起后续对话。 | ai | reviewed |
| [TypingIndicator 打字中](./reference/typing-indicator.md) | 用于聊天界面的内联打字中与加载状态。 | 见文档 | reviewed |

## AiContext

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [ContextCards 检索片段卡](./reference/context-cards.md) | 展示 RAG 检索回来的知识块及其来源出处。 | ai | reviewed |
| [Context Indicator](./reference/context-indicator.md) | 以环形进度显示对话上下文用量的紧凑指示器。 | ai | reviewed |
| [FineTuneCard 属性检查器](./reference/fine-tune-card.md) | 紧凑的属性面板：布局分段、四个拖拽数值域、类型选择器，共用一个值对象。 | ai | reviewed |
| [InsightCards 洞察卡](./reference/insight-cards.md) | 「洞察 N ‹ ›」翻页壳：一句结论、一张卡、一条追问，内容全部由插槽提供。 | ai | reviewed |
| [RecommendationCard 建议卡](./reference/recommendation-card.md) | 带置信度的智能体建议：正文、备选抽屉、确认动作，卡片尺寸不随内容跳动。 | ai | reviewed |

## AiReasoning

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [AI Elements](./reference/ai-elements.md) | 用于 AI 对话界面的会话与消息基础组件。 | ai | reviewed |
| [Chain of Thought](./reference/chain-of-thought.md) | 多步推理与工具调用的时间线，进行中的步骤自动跟随输出。 | ai | reviewed |
| [CodeStream 流式代码块](./reference/code-stream.md) | 带文件名头部的代码块，按行显现，复制与语法高亮开箱可用。 | ai | reviewed |
| [InlineCitation 行内引用](./reference/inline-citation.md) | 嵌在正文里的来源引用胶囊，点击只派发事件，不自行跳转。 | ai | reviewed |
| [Reasoning Disclosure](./reference/reasoning-disclosure.md) | 可折叠的推理过程区域，流式输出时自动跟随文本尾部。 | ai | reviewed |
| [Sources](./reference/sources.md) | 可折叠的引用来源列表，链接是否跳转完全由宿主决定。 | ai | reviewed |
| [Stream Markdown](./reference/stream-markdown.md) | 面向流式输出的 Markdown 渲染器，尾部带光标，围栏块可按语言接管。 | ai | reviewed |
| [Thinking Orb](./reference/thinking-orb.md) | Canvas 绘制的思考指示球，同屏共相位、离屏自动停摆。 | ai | reviewed |

## AiSuite

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [AI 套件](./reference/ai-suite.md) | 源自 Beautiful UI 的 19 个 AI 原生界面组件案例集 | 见文档 | reviewed |

## BaseSuite

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [基础套件](./reference/base-suite.md) | 日常界面的主体组件：通用、表单、布局、导航、数据展示、反馈与状态占位 | 见文档 | reviewed |

## Basic

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [Avatar 头像](./reference/avatar.md) | 用户头像、身份 fallback、状态点、自定义形状和叠放头像组。 | base | reviewed |
| [Avatar Variants 头像变体](./reference/avatar-variants.md) | 基于 `TxAvatar` + `TxOutlineBorder` + `TxCornerOverlay` 的组合配方集合，用于快速拼装在线状态、角标、平台标记、系统徽章、动效等“头像变体”。 | 见文档 | reviewed |
| [Badge 徽标](./reference/badge.md) | 用于紧凑界面的内联计数、状态和圆点提示。 | base | reviewed |
| [Button 按钮](./reference/button.md) | 触感按钮与扁平按钮的核心交互 | base | reviewed |
| [Divider 分割线](./reference/divider.md) | 内容分组、行内分隔与渐变透明分割 | base | reviewed |
| [Icon 图标](./reference/icon.md) | UnoCSS 图标体系与 TuffIcon 组件 | base | reviewed |
| [IconChip 图标角标](./reference/icon-chip.md) | 承载文件类型角标、首字母方块或小图标的填充色块。 | base | reviewed |
| [Kbd](./reference/kbd.md) | 用于命令提示与菜单快捷键的键盘 token。 | base | reviewed |
| [StatusBadge 状态徽标](./reference/status-badge.md) | 状态信号与平台感知的系统反馈徽标。 | base | reviewed |
| [Tag 标签](./reference/tag.md) | 用于分类、筛选、语义状态和可移除元数据的紧凑标签。 | base | reviewed |

## Charts

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [Chart Colors 图表色板](./reference/chart-colors.md) | 分类、语义、顺序与地图色板：CSS 变量随主题自动切换，ChartPalette 提供字面值。 | 见文档 | reviewed |
| [Charts 图表](./reference/charts.md) | @talex-touch/tuffex-charts 总览：kumo 同构的 API 面，Vue 直渲 SVG，无 echarts。 | 见文档 | reviewed |
| [Custom Chart 自定义图表](./reference/custom-chart.md) | 组合式逃生舱：TxChart 容器 + 轴/网格/系列原语，自由拼装折线、面积、柱、散点与环形。 | 见文档 | reviewed |
| [Maps 地图](./reference/maps.md) | GeoJSON 地图：气泡图与分级填色图，Mercator 默认投影，缩放平移。 | 见文档 | reviewed |
| [SankeyChart 桑基图](./reference/sankey-chart.md) | d3-sankey 布局的流向图：渐变连线、节点值标签、下钻标记与插槽提示框。 | 见文档 | reviewed |
| [TimeseriesChart 时序图](./reference/timeseries-chart.md) | 时序折线与堆叠柱：标记聚簇、阈值线、刷选时间范围、tooltip 全功能。 | 见文档 | reviewed |

## Data

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [CellLink 单元格链接](./reference/cell-link.md) | 表格单元格里的链接，渲染真实 href 但从不自行导航，由宿主决定如何打开。 | base | reviewed |
| [DataTable 数据表格](./reference/data-table.md) | 轻量数据表格组件，提供排序、行选择与自定义渲染能力 | base | reviewed |
| [DotIndicator 圆点指示器](./reference/dot-indicator.md) | 裸圆点加文案的状态指示原语，用于表格单元格与汇总行。 | base | reviewed |
| [FilterChips 筛选胶囊](./reference/filter-chips.md) | 带圆点与计数的单选筛选条，可作为工具栏或标签页语义使用。 | base | reviewed |
| [ImageGallery 图片预览](./reference/image-gallery.md) | 缩略图网格与 Modal 图片预览，支持索引收敛和上一张/下一张边界导航。 | base | reviewed |
| [MarkdownView Markdown 渲染](./reference/markdown-view.md) | 基于 GitHub-flavored Markdown 的渲染组件，支持显式 sanitize 与亮/暗主题模式。 | base | reviewed |
| [SortableList 拖拽排序](./reference/sortable-list.md) | 基于 HTML5 Drag & Drop 的列表排序容器，支持稳定 ID、可选拖拽手柄和排序事件。 | base | reviewed |
| [StatCard 指标卡片](./reference/stat-card.md) | 用于展示核心数字、趋势洞察与进度摘要的指标卡片。 | base | reviewed |
| [Timeline 时间线](./reference/timeline.md) | 用于展示事件流 | base | reviewed |
| [Transfer 穿梭框](./reference/transfer.md) | 在两个列表之间移动并筛选条目 | base | reviewed |
| [Tree 树形](./reference/tree.md) | 基础树形组件，支持搜索过滤、单选/多选与展开控制。 | base | reviewed |

## DataSuite

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [数据套件](./reference/data-suite.md) | 可视化与图表：主包内的数据展示组件，以及独立的图表包 | 见文档 | reviewed |

## Effects

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [BorderBeam 流光边框](./reference/border-beam.md) | 沿元素边框游走或呼吸的光束特效包装器，适合强调卡片、按钮与搜索框。 | pro | reviewed |
| [CornerOverlay 角标覆盖层](./reference/corner-overlay.md) | 用于头像、缩略图和状态标记的角落绝对定位覆盖层。 | pro | reviewed |
| [EdgeFadeMask 边缘渐隐遮罩](./reference/edge-fade-mask.md) | 滚动容器包装器，仅在存在隐藏溢出内容时为前后边缘添加 CSS mask 渐隐。 | pro | reviewed |
| [FlipOverlay 翻转遮罩](./reference/flip-overlay.md) | 从触发源翻转展开的 3D Overlay | pro | reviewed |
| [Fusion 交融](./reference/fusion.md) | 两个插槽的 gooey 交融动效，支持 hover、click 或手动受控状态。 | pro | reviewed |
| [GlassSurface 玻璃拟态](./reference/glass-surface.md) | 带 SVG displacement、backdrop-filter 与纯色兜底路径的折射玻璃容器。 | pro | reviewed |
| [GlowText 扫光](./reference/glow-text.md) | 用于在文本或任意内容（包括图片/卡片）上叠加“高光扫过”的动效。 | pro | reviewed |
| [GradientBorder 渐变边框](./reference/gradient-border.md) | 用于强调卡片、Hero 面板和提示容器的动态渐变边框包装器。 | pro | reviewed |
| [GradualBlur 渐变模糊](./reference/gradual-blur.md) | 用于父容器或页面边缘的分层 backdrop-filter 渐变模糊，覆盖预设、hover 强度、滚动触发、响应式尺寸与 GPU 提示。 | pro | reviewed |
| [KeyframeStrokeText 关键帧描边](./reference/keyframe-stroke-text.md) | SVG 文本特效：先绘制描边，再显示填充，并在文字或字体输入变化后重新测量文本尺寸。 | pro | reviewed |
| [Liquid 液态流体](./reference/liquid.md) | 双层液态特效群组：SVG 剪影层承载 goo 融合与真实阴影，内容层保持清晰可交互。 | pro | reviewed |
| [OutlineBorder 描边容器](./reference/outline-border.md) | 为头像、缩略图、徽标和自定义 slot 内容提供 border / ring 描边与可选裁切。 | pro | reviewed |
| [Stagger 依次进入](./reference/stagger.md) | 基于子节点 index 的 TransitionGroup enter/leave 依次动画包装器。 | pro | reviewed |
| [TextMorph 文本形变](./reference/text-morph.md) | 把字符串切成有身份的段再 diff，只让真正变化的部分动起来；数字按位值滚动，容器宽高与字符同曲线过渡，支持弹簧缓动与打断续跑。 | pro | reviewed |
| [TextTransformer 文本变换](./reference/text-transformer.md) | 短文本变化组件：默认走文本形变引擎逐字 diff（数字按位值滚动），也保留原来的 fade + blur 整串交叉淡化模式，暴露 scoped text slot。 | pro | reviewed |
| [Transition 动效](./reference/transition.md) | 用于带 key 内容切换、列表动效与平滑尺寸变化的通用过渡封装。 | pro | reviewed |
| [TuffLogoStroke Logo 描边](./reference/tuff-logo-stroke.md) | Tuff Logo 的 SVG 描边动画组件，支持 once、breathe、hover 和 loop 模式。 | pro | reviewed |

## Feedback

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [Alert 警告](./reference/alert.md) | 用于上下文反馈、语义提示和可关闭通知的内联状态横幅。 | base | reviewed |
| [Dialog 对话框](./reference/dialog.md) | 关键确认与多形态对话框 | base | reviewed |
| [Drawer 抽屉](./reference/drawer.md) | 侧滑面板与表单承载 | base | reviewed |
| [LoadingOverlay 加载遮罩](./reference/loading-overlay.md) | 用于在内容区域或全屏展示加载遮罩。 | base | reviewed |
| [Modal 模态框](./reference/modal.md) | 基于 Teleport 的轻量对话框，适合短阻塞任务，支持焦点恢复、Escape/遮罩关闭和头尾插槽。 | base | reviewed |
| [Popover 弹出层](./reference/popover.md) | 直接基于 BaseAnchor 构建的语义弹出层。 | base | reviewed |
| [Progress 进度](./reference/progress.md) | 围绕 TxProgressBar 的轻量封装，用于标准线性进度行。 | base | reviewed |
| [ProgressBar 进度条](./reference/progress-bar.md) | 支持确定进度、不确定加载、分段进度与状态反馈的进度条。 | base | reviewed |
| [SelectionActions 划词工具条](./reference/selection-actions.md) | 浮在选区下方的工具条，把选中的文字交给智能体改写。 | base | reviewed |
| [Spinner 加载](./reference/spinner.md) | 用于展示加载中的旋转指示器。通常作为更复杂 Loading 组件的基础。 | base | reviewed |
| [Toast 提示](./reference/toast.md) | 轻量通知与短暂状态反馈 | base | reviewed |
| [Tooltip 提示](./reference/tooltip.md) | 轻量提示与信息层级 | base | reviewed |

## Form

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [Cascader 级联选择](./reference/cascader.md) | 用于选择具有层级关系的数据，支持搜索、单选/多选与异步加载子节点。 | base | reviewed |
| [Checkbox 复选框](./reference/checkbox.md) | 用于布尔选择的复选框组件，支持键盘切换、可访问性标签、填充态和 SVG 勾选变体。 | base | reviewed |
| [DatePicker 日期选择](./reference/date-picker.md) | 基于 TxPicker 的日期选择器，使用 YYYY-MM-DD 模型。 | base | reviewed |
| [FileUploader 文件上传](./reference/file-uploader.md) | 受控文件选择与拖拽上传组件，支持最大数量限制、文件列表渲染和删除事件。 | base | reviewed |
| [FlatInput 扁平输入框](./reference/flat-input.md) | 低强调文本、密码与多行输入框，支持前缀内容和 Caps Lock 提示。 | base | reviewed |
| [FlatRadio 平铺选择器](./reference/flat-radio.md) | 用于 2-5 个选项的平铺选择（`TxFlatRadio` + `TxFlatRadioItem`）。提供指示器滑动动画、键盘导航和完整的 TypeScript 类型支持。 | base | reviewed |
| [FlatSelect 平铺下拉选择器](./reference/flat-select.md) | ComboBox 风格的下拉选择器（`TxFlatSelect` + `TxFlatSelectItem`）。选项覆盖触发器展开，选中项锚定在触发器位置，clip-path 动画丝滑展开/收起。 | base | reviewed |
| [Form 表单](./reference/form.md) | 面向 TuffEx 输入组件的表单容器、字段布局、校验消息与命令式校验流程。 | base | reviewed |
| [ImageUploader 图片上传](./reference/image-uploader.md) | 受控图片选择器，支持本地预览、最大数量限制、删除控件和 object URL 清理。 | base | reviewed |
| [Input 输入](./reference/input.md) | 轻量输入框与搜索态 | base | reviewed |
| [NumberInput](./reference/number-input.md) | 带步进控制、范围限制与精度归一化的数字输入。 | base | reviewed |
| [Picker 滚轮选择](./reference/picker.md) | 列式滚轮选择器，支持弹层/内联渲染、工具栏操作、禁用项和数组值归一化。 | base | reviewed |
| [Radio 单选框](./reference/radio.md) | 单选控件，支持按钮组、标准单选、卡片单选、键盘导航、禁用状态和按钮指示器动效。 | base | reviewed |
| [Rating 评分](./reference/rating.md) | 星级评分输入 | base | reviewed |
| [ScrubField 拖拽数值域](./reference/scrub-field.md) | 标签即手柄的紧凑数值输入：横向拖动、方向键步进、也能直接键入。 | base | reviewed |
| [SearchInput 搜索输入框](./reference/search-input.md) | 基于输入框的搜索组件，内置搜索图标，并在 Enter 时触发 `search` 事件。 | base | reviewed |
| [SearchSelect 搜索选择器](./reference/search-select.md) | 搜索选择器本质上是一个可搜索的 Select：输入时展开下拉面板，展示结果，点击结果项回填并关闭。 | base | reviewed |
| [SegmentedSlider 分段滑块](./reference/segmented-slider.md) | 用于在预定义的离散选项中进行选择的分段滑块组件。 | base | reviewed |
| [Select 选择器](./reference/select.md) | 基于 Popover 的原始值选择器，支持单选、多选标签、本地过滤、远程搜索、自助创建、分组、图标与描述选项和自定义下拉内容。 | base | reviewed |
| [Slider 滑块](./reference/slider.md) | 用于在区间内选择数值的滑块组件。 | base | reviewed |
| [Switch 开关](./reference/switch.md) | 轻触反馈与状态切换 | base | reviewed |
| [TagInput 标签输入](./reference/tag-input.md) | 用于快速录入标签，支持分隔符与回车确认。 | base | reviewed |
| [Textarea](./reference/textarea.md) | 带字数统计、resize 与状态样式的独立多行输入。 | base | reviewed |
| [TreeSelect 树选择器](./reference/tree-select.md) | 用于在下拉浮层中选择树形数据，支持搜索、单选/多选。 | base | reviewed |

## Foundations

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [无障碍](./reference/accessibility.md) | Tuffex 组件遵循的四条约定，以及覆盖到哪里为止 | 见文档 | reviewed |
| [设计基础](./reference/foundations.md) | 与 Tuffex variables 对齐的字体与颜色体系 | 见文档 | reviewed |
| [图标体系](./reference/icons.md) | TxIcon 如何解析 name，以及应用如何教它加载自己的图标 | 见文档 | reviewed |
| [理念总览](./reference/index.md) | Tuffex 是什么、背后的三块理念版图，以及完整组件索引 | 见文档 | reviewed |
| [安装与引入](./reference/installation.md) | 安装 Tuffex，以及三种引入方式各自的适用场景 | 见文档 | reviewed |
| [主题定制](./reference/theming.md) | 可覆盖的四个层级：从全局 token 到单个组件 | 见文档 | reviewed |
| [Utils 工具函数](./reference/utils.md) | TuffEx 通过根入口与 ./utils 子路径导出的公开工具函数 | 见文档 | reviewed |

## Guides

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [Tuffex 组合界面教程](./reference/tuffex-composition.md) | 使用 Tuffex 组件搭建可审阅、可截图验证的后台页面切片 | 见文档 | migrated |
| [TuffEx](./reference/tuffex-tooling.md) | 具有精美动画效果的现代 Vue3 组件库 | 见文档 | 未声明 |

## Layout

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [Card 卡片](./reference/card.md) | 带插槽、材质背景、加载、点击、惯性和折射模式的 surface 容器。 | base | reviewed |
| [CardItem 卡片项](./reference/card-item.md) | 紧凑列表行，支持可选头像媒体、文本、右侧操作、激活态和显式点击行为。 | base | reviewed |
| [Collapse 折叠面板](./reference/collapse.md) | 可展开内容面板，支持受控展开项、手风琴模式、语义化标题按钮和键盘友好交互。 | base | reviewed |
| [Container 容器](./reference/container.md) | 容器组件是页面布局的基础，提供灵活的布局选项与响应式支持 | base | reviewed |
| [Flex 弹性布局](./reference/flex.md) | 低层级 Flexbox 容器，显式控制方向、对齐、换行和间距。 | base | reviewed |
| [Grid 栅格](./reference/grid.md) | 结构化布局与对齐 | base | reviewed |
| [GridLayout 网格布局](./reference/grid-layout.md) | 带 auto-fit 列和可选鼠标光斑效果的响应式 CSS Grid 辅助容器。 | base | reviewed |
| [GroupBlock 分组块](./reference/group-block.md) | 用于偏好设置界面的可折叠分组容器与块状行。 | base | reviewed |
| [Scroll 滚动](./reference/scroll.md) | 基于 `@better-scroll/scroll-bar` 的当前 `TxScroll` 滚动容器，提供更一致的滚动条体验。 | base | reviewed |
| [Splitter 分割面板](./reference/splitter.md) | 双面板可拖拽布局，支持指针与键盘调整、比例夹取、吸附步进，以及水平/垂直方向。 | base | reviewed |
| [Stack 堆叠](./reference/stack.md) | 以方向为核心的一维 Flexbox 包装器，用于纵向或横向间距布局。 | base | reviewed |

## Navigation

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [Breadcrumb 面包屑](./reference/breadcrumb.md) | 可访问的层级导航，支持条目图标、分隔符、href 链接与手动点击事件。 | base | reviewed |
| [ContextMenu 右键菜单](./reference/context-menu.md) | 可右键、可坐标控制、可嵌入 Popover 的通用菜单面板。 | base | reviewed |
| [DropdownMenu 下拉菜单](./reference/dropdown-menu.md) | 基于 Popover 的下拉菜单（Windows 风格）。 | base | reviewed |
| [FlatDropdown 扁平下拉](./reference/flat-dropdown.md) | 插槽驱动的浮层下拉面板（`TxFlatDropdown`）。支持悬停 / 点击 / 手动触发，自动翻转定位，退出时带缩放与模糊动效。 | base | migrated |
| [NavBar 导航栏](./reference/nav-bar.md) | 紧凑顶部导航栏，支持标题、左右操作区、安全区占位与返回事件。 | base | reviewed |
| [Pagination 分页](./reference/pagination.md) | 大数据列表的分页导航 | base | reviewed |
| [SidebarNav 侧边导航](./reference/sidebar-nav.md) | 工作区级垂直导航：组织切换、快捷搜索、主操作与分组入口。 | base | reviewed |
| [Steps 步骤条](./reference/steps.md) | 多步骤进度展示，支持横向/纵向布局、数字或字符串步骤键、可点击头部和显式禁用状态。 | base | reviewed |
| [TabBar 底部导航](./reference/tab-bar.md) | 移动端底部 Tab 导航，支持图标、badge、fixed 定位和安全区占位。 | base | reviewed |
| [Tabs 标签页](./reference/tabs.md) | 支持多方向布局、分组导航、动态指示器和内容尺寸测量的组合式标签页。 | base | reviewed |

## Primitives

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [AutoSizer 自适应尺寸](./reference/auto-sizer.md) | 用于让容器在内容变化时自动跟随宽/高，并带过渡动画。 | pro | reviewed |
| [BaseAnchor 锚点定位](./reference/base-anchor.md) | 基于 Floating UI 与 GSAP 的锚点定位弹出层，默认琉光面板、弹簧展开，另有位移、聚焦缩放、透明度与液态模式。 | pro | reviewed |
| [BaseSurface 基础表面层](./reference/base-surface.md) | 统一管理背景渲染策略的基础组件，支持 pure/mask/blur/glass/refraction 五种模式，并通过运动降级机制解决 backdrop-filter + transform 失效问题。 | pro | reviewed |
| [Floating 浮动层](./reference/floating.md) | 基于指针位置的视差容器，支持注册绝对定位的深度图层。 | pro | reviewed |
| [ResizeBox 显式尺寸动画](./reference/resize-box.md) | 在显式宽高目标之间过渡，并提供动画生命周期事件与可选溢出裁剪。 | pro | reviewed |

## ProSuite

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [进阶套件](./reference/pro-suite.md) | 高级交互、视觉效果与底层原语 | 见文档 | reviewed |

## Status

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [BlankSlate 空白页](./reference/blank-slate.md) | 用于首次进入、引导用户开始操作的较大空状态。 | base | reviewed |
| [Empty 空状态](./reference/empty.md) | 用于面板、筛选结果和基础占位的紧凑空状态封装。 | base | reviewed |
| [EmptyState 空态引导](./reference/empty-state.md) | 通用空态/引导组件，适用于页面为空、未选择、无权限等场景。 | base | reviewed |
| [ErrorState 错误状态](./reference/error-state.md) | 错误场景的快捷空态组件，基于 TxEmptyState 的 `variant=\"error\"` 预设。 | base | reviewed |
| [GuideState 引导状态](./reference/guide-state.md) | 基于 TxEmptyState 的引导态快捷组件，固定 guide 变体，并透传文案、操作、布局、表面和命名插槽。 | base | reviewed |
| [LayoutSkeleton 布局骨架](./reference/layout-skeleton.md) | 布局级骨架占位 | base | reviewed |
| [LoadingState 加载态](./reference/loading-state.md) | 用于加载中占位展示。 | base | reviewed |
| [NoData 无数据](./reference/no-data.md) | 用于列表、表格、图表和指标面板没有记录时的快捷空状态。 | base | reviewed |
| [NoSelection 未选择](./reference/no-selection.md) | 基于 TxEmptyState 的未选择详情面板快捷空状态，固定使用 no-selection 变体。 | base | reviewed |
| [OfflineState 离线](./reference/offline-state.md) | 用于离线和网络不可用场景的快捷空状态。 | base | reviewed |
| [PermissionState 权限不足](./reference/permission-state.md) | 用于权限不足、未授权访问和受限工作区的快捷空状态。 | base | reviewed |
| [SearchEmpty 搜索空态](./reference/search-empty.md) | 用于搜索无结果时的状态提示。 | base | reviewed |
| [Skeleton 骨架屏](./reference/skeleton.md) | 加载占位与结构提示 | base | reviewed |

## Visualization

| 文档 | 用途 | 运行时套件 | 上游同步状态 |
|---|---|---|---|
| [AllocationBar 占比条](./reference/allocation-bar.md) | 按份额分段的胶囊条 + 图例胶囊，选中哪段就检查哪段。 | pro | reviewed |
| [DiffTable 变更表格](./reference/diff-table.md) | 以变更集语义呈现 AI 提议的改动，按阶段依次标红、展开新增行。 | pro | reviewed |
| [SignalMeter 信号量表](./reference/signal-meter.md) | 分段强度条，用几格填充表达置信度、相关度或信号强弱。 | pro | reviewed |
| [SparkChart 迷你折线图](./reference/spark-chart.md) | 卡片里的静态多序列折线：canvas 绘制，配 DOM 层的游标与提示框。 | pro | reviewed |
