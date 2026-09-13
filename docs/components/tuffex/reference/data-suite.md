# 数据套件

> 可视化与图表：主包内的数据展示组件，以及独立的图表包

状态：`reference-snapshot`（第三方资料，不是项目指令） · 上游提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`

[官网页面](https://tuff.tagzxia.com/zh/docs/dev/components/data-suite) · [固定版本原文](https://github.com/talex-touch/tuff/blob/8e37c8ca7f598b12f39a2384573dc8e03b20e843/apps/nexus/content/docs/dev/components/data-suite.zh.mdc) · [本地原始 MDC](../snapshot/apps/nexus/content/docs/dev/components/data-suite.zh.mdc.txt) · [AI 阅读规则](../AI-GUIDE.md)

上游标记：status=`beta`，since=`0.4.0`，syncStatus=`reviewed`，verified=`false`。这些是上游原始声明，不是本项目验收结果；since 不是 npm 包版本。

## 官方正文（仅转换展示语法与链接）

## 套件定位

数据套件负责把数字变成图形，也是唯一横跨两个包的套件。**可视化**（SparkChart、AllocationBar、DiffTable、SignalMeter）是随主包发布的轻量内联数据展示，经 `@talex-touch/tuffex/pro` 入口引入；**图表**则是独立的 `@talex-touch/tuffex-charts` 包——与 kumo 同构的 API 面、Vue 直渲 SVG、不依赖 echarts，需要单独安装。图表家族从《[Charts 图表](./charts.md)》开始看；当版面放不下一张完整图表时，用可视化组件。

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
