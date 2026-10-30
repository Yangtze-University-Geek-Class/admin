# 项目与协作规范

> 项目定位、授权边界、统一入口和完成定义。

状态：`current` · 更新：2026-10-27

## 身份与入口

所有 AI 进入项目第一步先确认当前分支（`git branch --show-current`），再读 [AGENT-START](AGENT-START.md) 及 docs 必读规范；未完成之前不做业务操作。分支与发布唯一规则见 [BRANCHING](BRANCHING.md) 与 [RELEASES](RELEASES.md)：只有 `main`（正式）与 `stage`（预发布）两条长期分支，发版只靠打 tag（`vX.Y.Z-rc.N` 预发布、`vX.Y.Z` 正式），人工验收先于合入 `main` 和打正式 tag，版本号不自动提升。

仓库工作区为 `geek_main`，产品和包的既有标识保持兼容（`yzgc-admin`、`@yzgc/web`、`@yzgc/server`）。所有开发与验收命令从根目录运行。五个源码应用是 `app/server`、`app/web`、`app/console`、`app/forum`、`app/cli`，各自的合同见 [docs/services](../services/README.md)；控制台产物与独立 Cargo 构建的 CLI 分发文件随 web 镜像交付，每套部署仍只有 web/server/forum 三个运行单元。`app/web/shared` 是适配层，不是独立产品。整体关系与接口、数据、权限入口见[项目目录](../architecture/catalog/README.md)。

## 变更边界

先确认分支、HEAD 和未提交改动，保留他人工作。一次改动要有可描述的目标、受影响服务、契约变化及验收方式；不能以「清理」为名混入未要求的产品改版、依赖升级或数据重置。

普通代码任务可以修改源码、测试、配置模板和文档。提交、推送、合并、打发布 tag、发布、修改生产环境、读取真实密钥、操作业务数据库均须得到对应动作和目标的明确授权。不得把生产测试当作开发捷径。开发前先由所有者确认具体事项，再按 [ISSUES](ISSUES.md) 建单；审查发现、巡检或后续跟进只形成候选，不自动拆单或恢复所有者取消的事项。

## 语言与一致性

中文协作，代码标识符用英文，用户文案以中文为主。提交消息只遵循 [COMMITS](COMMITS.md)，不存在另一套英文提交规则。UI 保持现有浅色品牌，不自动加入深色主题、SSR 或多语言框架。

## 变更完成定义

代码与契约一致；相关回归测试覆盖正确路径和失败路径；根 `pnpm verify` 通过；涉及浏览器行为时提供真实浏览器结果；文档更新与代码同行；工作区差异只包含授权范围。未完成的环境验收必须单独列出，不得标为 PASS。

类型检查、mock 预览、构建成功、浏览器通过和线上验收是不同证据，不能相互替代。既有测试失败须定位，不能通过删除断言、复制处理器、伪造返回值或固定退出码解决。

## Agent 入口与适配器

**只有根 [AGENTS.md](../../AGENTS.md) 一个 agent 入口。** 不再维护 `CLAUDE.md`、`GEMINI.md`、`CONVENTIONS.md`、`.clinerules`、`.cursorrules`、`.windsurfrules`、`.cursor/rules/*`、`.github/copilot-instructions.md` 或模块级 `AGENTS.md`，连纯跳转指针也不保留。工具通过自身加载机制或启动参数读取根入口，接入与核验见 [AGENT-ADAPTERS](AGENT-ADAPTERS.md)。

服务合同放在 `docs/services/<service>/` 并引用根入口与对应规范，不复制全局规则。文档结构（`app/<service>` ↔ `docs/services/<service>` 严格对齐）见 [DOCUMENTATION](DOCUMENTATION.md) 与 [MODULAR-DEVELOPMENT](MODULAR-DEVELOPMENT.md)。
