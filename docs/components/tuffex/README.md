# Tuffex 组件库本地文档

> 官方中文文档、API、Vue 示例和类型参考，供 AI 按组件与章节离线查询。

状态：`current` · 更新：2026-09-13

官方入口：https://tuff.tagzxia.com/zh/docs/dev/components

## 阅读入口

先读 [AI 阅读指南](AI-GUIDE.md) 和 [项目使用政策](USAGE-POLICY.md)，再通过 [组件目录](COMPONENTS.md) 或 [任务映射](TASK-MAP.md) 选择需要的组件。版本、来源、许可与同步说明见 [SOURCES](SOURCES.md)。

## 本地查询

从 geek_main 根目录运行：

```bash
node scripts/tuffex-docs.mjs search "按钮"
node scripts/tuffex-docs.mjs search "TxDataTable" --json --limit 3
node scripts/tuffex-docs.mjs search "loading-variant" --text --limit 3
node scripts/tuffex-docs.mjs read button --section Props --max-lines 120
node scripts/tuffex-docs.mjs read installation --max-lines 180
node scripts/tuffex-docs.mjs check
```

查询不联网；结果包含路径，JSON 输出包含章节行号。`--text` 检索正文 API/示例并返回匹配行，默认只查轻量索引。截断时提供下一段读取命令。不要一次载入整个资料库。也可使用根 `pnpm docs:tuffex` 与 `pnpm check:tuffex-docs`。

## 内容结构

`reference/` 保存转换后的中文 Markdown；`snapshot/` 保存原始文档、完整 Demo、组件类型及实现，统一作为 .txt 参考，不参与业务编译。`catalog.json` 保存名称、标签、章节、示例和源码映射；`manifest.json` 保存固定提交、包版本和文件哈希；`llms.txt` 是简短导航。

## 实现边界

Tuffex 是 Vue 3 组件库。既有 web 包为 React，其他新建或迁移模块应各自核对 manifest；不要从参考文档推断全项目框架。此文档任务没有安装组件库、替换页面或执行论坛迁移。上游快照的源码包版本为 0.6.0，其 manifest 声明 Node >=26 和 Vue ^3.5.27；实际接入时需核对发布版本与项目运行环境。文档中的 since 字段不是 npm 包版本。

本目录是内部开发参考，不自动加入网站公开文档。更新前先审阅上游版本差异，再显式同步并运行完整性检查。
