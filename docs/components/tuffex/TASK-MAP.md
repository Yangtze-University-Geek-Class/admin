# 按开发任务选择 Tuffex

> 从宣传主页、内部主站、论坛和组织管理任务定位组件，再查询准确 API。

状态：`current` · 更新：2026-09-13

以下是选型导航，不是新的组件 API 定义；具体参数、事件、插槽和导出以链接文档及源码为准。

| 任务 | 阅读路径 |
|---|---|
| 安装与组合开发 | [安装](reference/installation.md)、[组合教程](reference/tuffex-composition.md)、[开发工具](reference/tuffex-tooling.md) |
| 品牌颜色、图标和可访问性 | [设计基础](reference/foundations.md)、[主题](reference/theming.md)、[图标](reference/icons.md)、[无障碍](reference/accessibility.md) |
| 宣传页与蓝白科技视觉 | [Card](reference/card.md)、[GlassSurface](reference/glass-surface.md)、[GradientBorder](reference/gradient-border.md)、[BorderBeam](reference/border-beam.md)、[Stagger](reference/stagger.md) |
| 登录后的服务总入口 | [GridLayout](reference/grid-layout.md)、[CardItem](reference/card-item.md)、[NavBar](reference/nav-bar.md)、[SidebarNav](reference/sidebar-nav.md)、[TabBar](reference/tab-bar.md)、[CommandPalette](reference/command-palette.md) |
| 登录、资料和设置表单 | [Form](reference/form.md)、[Input](reference/input.md)、[Button](reference/button.md)、[Select](reference/select.md)、[ImageUploader](reference/image-uploader.md) |
| 论坛主题列表和搜索 | [SearchInput](reference/search-input.md)、[FilterChips](reference/filter-chips.md)、[Avatar](reference/avatar.md)、[Tag](reference/tag.md)、[Pagination](reference/pagination.md)、[VirtualList](reference/virtual-list.md) |
| 发帖、正文和附件 | [MarkdownEditor](reference/markdown-editor.md)、[MarkdownView](reference/markdown-view.md)、[ImageGallery](reference/image-gallery.md)、[FileUploader](reference/file-uploader.md) |
| 组织后台、成员和权限 | [DataTable](reference/data-table.md)、[Tree](reference/tree.md)、[TreeSelect](reference/tree-select.md)、[Transfer](reference/transfer.md)、[Drawer](reference/drawer.md)、[Timeline](reference/timeline.md) |
| 代码、差异和统计 | [CodeEditor](reference/code-editor.md)、[DiffTable](reference/diff-table.md)、[StatCard](reference/stat-card.md)、[数据套件](reference/data-suite.md) |
| 确认操作与反馈 | [Dialog](reference/dialog.md)、[Modal](reference/modal.md)、[Toast](reference/toast.md)、[Tooltip](reference/tooltip.md) |
| 加载、空态、错误和权限不足 | [LoadingState](reference/loading-state.md)、[LayoutSkeleton](reference/layout-skeleton.md)、[SearchEmpty](reference/search-empty.md)、[ErrorState](reference/error-state.md)、[PermissionState](reference/permission-state.md) |
| 未来 AI 服务和工具授权 | [AI 套件](reference/ai-suite.md)、[Chat](reference/chat.md)、[ChatComposer](reference/chat-composer.md)、[ToolConfirmation](reference/tool-confirmation.md) |

## 业务边界

公开宣传主页与内部主站的访问控制属于应用及后端逻辑，不能仅用 UI 卡片遮挡代替。Markdown、文件上传、权限和危险操作仍需执行项目安全策略。组件的使用不会自动完成这些业务约束。

缺少对应组件时先查询中文、英文名称或 Tx 名称，再评估组合；不要从菜单分类名推导不存在的包入口。
