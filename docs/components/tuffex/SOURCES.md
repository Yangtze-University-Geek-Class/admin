# Tuffex 来源、版本与许可

> 可复核的官方源码快照，不把网页部署版本、源码 manifest 与 npm 发布版本混为一谈。

状态：`reference-snapshot` · 整理日期：2026-09-13

## 来源

官方入口：https://tuff.tagzxia.com/zh/docs/dev/components

源码仓库：https://github.com/talex-touch/tuff

固定提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`，提交时间：`2026-09-12T10:01:19-07:00`。来源路径见 manifest.json，逐文件 SHA-256 校验见 `node scripts/tuffex-docs.mjs check`。未核实 npm 发布标签是否与该源码提交一致；未运行上游安装、构建或示例。

## 版本边界

```json
{
  "tuffex": {
    "name": "@talex-touch/tuffex",
    "version": "0.6.0",
    "engines": {
      "node": ">=26.0.0"
    },
    "peerDependencies": {
      "vue": "^3.5.27"
    },
    "license": "MIT"
  },
  "charts": {
    "name": "@talex-touch/tuffex-charts",
    "version": "0.1.0",
    "engines": {},
    "peerDependencies": {
      "vue": "^3.5.27"
    },
    "license": "MIT"
  }
}
```

既有 web 包的 React/Node 22 环境与该快照 Vue peer/Node engine 不同；其他新建或迁移模块应分别核对实际 manifest，不从本参考文档推断迁移状态。本文只固定参考，不改变运行环境；接入时必须选定兼容的发布版本并重新核对 API。网页标注 since/verified 是上游自己的字段，不作为本项目验收或 npm 版本。

## 镜像范围

中文组件目录 169 篇，加组合界面和工具指南 2 篇；379 个被文档引用的独立 Vue Demo；674 个组件、工具、样式和图表源码参考。英文翻译、整站页面、二进制图片/字体、业务后端和上游测试不在镜像范围。

正文由 MDC 转成 Markdown：示例 YAML 的 code 字段转换为带语言围栏；嵌套 API rows 保留为 YAML，避免误改枚举/默认值；动态目录改为离线索引；原文与源码以 .txt 原样保存，不被当作待编译程序或 Agent 规则。展示变换版本见 manifest。

## 许可与归属

组件包带 [MIT License](./snapshot/packages/tuffex/LICENSE.txt)，版权所有者见许可原文。Nexus 文档和 Demo 位于主仓库，保留 [仓库 MPL-2.0 许可全文](./snapshot/LICENSE.txt)，不擅自把它们改标为 MIT。图表包 manifest 声明 MIT，但未发现包内独立 LICENSE，故同时保留 manifest 和根许可，发布前核实具体适用范围。任何文件内的第三方声明均原样保留。

本目录不改变 geek_main 自有代码的许可，也不构成对整站素材的授权。所有转换页为本项目增加的离线展示层，原始受许可内容仍保留来源；不移除作者或许可声明。

## 更新

先取上游指定提交到隔离 checkout，再执行 `node scripts/tuffex-docs.mjs sync --source <checkout> --commit <40位SHA>`。sync 默认离线，只读取该 checkout，不自动升级依赖。已有快照哈希有变化时拒绝覆盖；先审查或保留自己的修改。更新后运行 check、检索示例、文档检查和测试，并评估版本/API/许可差异。
