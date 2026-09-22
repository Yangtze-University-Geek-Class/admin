# 项目与协作规范

> 项目定位、授权边界、统一入口和完成定义。

状态：`current` · 更新：2026-09-23

## 身份与入口

所有 AI 进入项目第一步先确认当前分支（`git branch --show-current`），再读 [AGENT-START](AGENT-START.md) 及 docs 必读规范；未完成之前不做业务操作。分支与发布唯一规则见 [BRANCHING](BRANCHING.md) 与 [RELEASES](RELEASES.md)：只有 `main`（正式）与 `stage`（预发布）两条长期分支，人工验收先于合入 `main`，版本号不自动提升。

仓库工作区为 `geek_main`，产品和包的既有标识保持兼容（`yzgc-admin`、`@yzgc/web`、`@yzgc/server`）。所有开发与验收命令从根目录运行。三个产品服务是 `app/server`、`app/web`、`app/forum`，各自的合同见 [docs/services](../services/README.md)；`app/web/shared` 是适配层，不是独立产品。

## 变更边界

先确认分支、HEAD 和未提交改动，保留他人工作。一次改动要有可描述的目标、受影响服务、契约变化及验收方式；不能以「清理」为名混入未要求的产品改版、依赖升级或数据重置。

普通代码任务可以修改源码、测试、配置模板和文档。提交、推送、合并、发布、修改生产环境、读取真实密钥、操作业务数据库均须得到对应动作和目标的明确授权。不得把生产测试当作开发捷径。开发前先开 issue，见 [ISSUES](ISSUES.md)。

## 语言与一致性

中文协作，代码标识符用英文，用户文案以中文为主。提交消息只遵循 [COMMITS](COMMITS.md)，不存在另一套英文提交规则。UI 保持现有浅色品牌，不自动加入深色主题、SSR 或多语言框架。

## 变更完成定义

代码与契约一致；相关回归测试覆盖正确路径和失败路径；根 `pnpm verify` 通过；涉及浏览器行为时提供真实浏览器结果；文档更新与代码同行；工作区差异只包含授权范围。未完成的环境验收必须单独列出，不得标为 PASS。

类型检查、mock 预览、构建成功、浏览器通过和线上验收是不同证据，不能相互替代。既有测试失败须定位，不能通过删除断言、复制处理器、伪造返回值或固定退出码解决。

## Agent 入口与适配器

**只有根 [AGENTS.md](../../AGENTS.md) 一个 agent 入口。** 不再维护 `CLAUDE.md`、`GEMINI.md`、`CONVENTIONS.md`、`.clinerules`、`.cursorrules`、`.windsurfrules`、`.cursor/rules/*`、`.github/copilot-instructions.md` 等第二份规则来源，也不再新增模块级规则文件；其余工具适配器如仍存在，只能是指向根入口的纯跳转。

服务与模块级 `AGENTS.md` 只引用根入口与对应 `docs/services/<service>/` 文档，不复制全局规则。文档结构（`app/<service>` ↔ `docs/services/<service>` 严格对齐）见 [DOCUMENTATION](DOCUMENTATION.md) 与 [MODULAR-DEVELOPMENT](MODULAR-DEVELOPMENT.md)。
