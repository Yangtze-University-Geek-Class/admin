# 进阶套件

> 高级交互、视觉效果与底层原语

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/pro-suite) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/pro-suite.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/pro-suite.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.3.9`，syncStatus=`reviewed`，verified=`false`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

## 套件定位

进阶套件承载重交互与视觉表达：**高级交互**是命令面板、搜索面板、双编辑器与虚拟列表这类完整交互件；**视觉效果**是玻璃拟态、流光边框、渐变模糊、文本动效与液态流体这类表达层；**底层原语**（BaseSurface、BaseAnchor、Floating、AutoSizer、ResizeBox）是其余组件搭在其上的地基，业务侧极少直接使用。全部经 `@talex-touch/tuffex/pro` 分类入口引入。数据可视化与图表族已拆至**数据**套件，见《[数据套件](./data-suite.md)》。

## 组件预览

每个格子都是可交互的真实组件，点击左上角名称进入对应组件文档。

此处为官网动态目录/交互图库；离线组件与审阅状态见 [组件索引](../COMPONENTS.md)。

## 分组一览

下面按分组列出该套件的**全部**组件，数据来自每个文档的 `category` frontmatter，新增组件会自动出现。

此处为官网动态目录/交互图库；离线组件与审阅状态见 [组件索引](../COMPONENTS.md)。

## 离线完整示例源码

此页没有引用独立 Demo；正文中的代码块保持原样。

## 离线类型与实现参考

本页是跨组件/概念说明；先按具体组件查询 catalog.json，再按 SOURCE 清单核对；不要从名称猜导出。

第三方许可与转换边界见 [SOURCES](../SOURCES.md)。示例中 Nexus 的自动导入、Tuff 前缀别名、样式类和外部素材不代表业务项目已配置，不能不经核对就复制运行。
