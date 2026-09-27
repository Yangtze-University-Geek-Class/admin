# 控制台权限树实施结论

> #176 的离线参考与接入计划已落实为本地只读页签；当前契约迁回 console 服务文档。本记录不表示已合并、已发布或通过人工验收。

状态：`historical` · 更新：2026-09-28 · 适用：`app/console` 权限树接入过程。

## 当前交付与来源

- 主档：[issue #176](https://github.com/Yangtze-University-Geek-Class/admin/issues/176)；原文件级方案见 [方案记录](https://github.com/Yangtze-University-Geek-Class/admin/issues/176#issuecomment-5857178397)，后续实施授权与基线同步见 [实施记录](https://github.com/Yangtze-University-Geek-Class/admin/issues/176#issuecomment-5857520712)。负责人 `LYsnowQ`。
- 分支 `task/176/permission_tree`，独立 worktree `.claude/worktrees/task-176`。初始 `stage 9b38684cee4409a309052f4aefa3673106f5c7b0`，实施前整体快进至 `origin/stage f9da30f`，保留计划与执行记录；没有在主工作区开发。
- 经所有者授权，已保全16份任务文件后将 task 从 `f9da30f19344f04e9fc00cf991f085b477f636a6` 快进至 `origin/stage 0c32616dcfd4224c64ef13efd0d347361548d444`（含 #174 论坛状态拆分），恢复未提交实现，无冲突。15份文件哈希未变，`TESTING.md` 同时保留上游与本任务说明；下述同步轮证据覆盖新基线加本地权限树改动，不代表该功能已合入 stage。
- 页面为「成员与权限」第四页签 `/console/people?view=permissions`。当前接口、刷新/错误、来源与状态、执行边界和 Tuffex 交互只在 [console 服务合同](../services/console/README.md#只读权限树) 维护；不再保存一份重复的待实施规则。
- 实现位置：[People.vue](../../app/console/src/pages/People.vue)、[PermissionTree.vue](../../app/console/src/pages/people/PermissionTree.vue)、[permission-tree.ts](../../app/console/src/lib/permission-tree.ts)、[permission-boundaries.ts](../../app/console/src/lib/permission-boundaries.ts)。样式限于页面私有 scoped CSS，没有新增基础组件库或改变全局主题。
- 复用真实 `/me`、catalogue、departments 和现有闭包函数；不复制服务端 `computeAccess`，不新增角色、能力、写接口或真实成员模拟器，父页能力门不变。API 与安全事实仍以 [API](../architecture/API.md)、[SECURITY](../architecture/SECURITY.md) 为准。

## 验证与边界

- [展示模型回归](../../tests/console/permission-tree.test.ts) 覆盖权威结果优先、蕴含链/环、多来源唯一节点、动态包、归档/缺失部门、领航员与 member、owner/guest 固定规则和未知能力。
- 实际浏览器分别使用 DEV mock 与隔离真实 Fastify 路由。后者使用内存 SQLite、虚构 GitHub 外部响应、夹具论坛内容，禁止真实网络与邮件，不读取 `.env` 或业务库；该证据不是 OAuth 往返或部署验收。
- 前轮隔离夹具逐项比较 20 项树状态与 `/me`：owner 20 有效/0受限，captain 15/5，双部门队长8/3，自定义领航员3/0，离组队长6/2；来源无不一致警告。最终构建复核使用招新部与社区部双部门夹具，结果13/1（配置不同，不是默认固定数量）；其余四种身份结果一致。修改称号名、部门名与权限包、归档部门后重新读取，旧能力与旧来源不再当作当前结果。
- 桌面与390px：两视角、搜索保留祖先/清空恢复展开、键盘、详情焦点往返、预留能力、页面门、401回跳、失败隐藏旧树与重试、URL刷新和历史导航已实际操作。动态部门名称验证发现页头重复拼接服务端 label，已修正并在真实路由下复核。
- 逐次命令、通过/失败与未验证项以 [9月28日执行记录](../../notes/2026-09-28/lysnowq/task_176_permission_tree.md) 和 issue 最新追踪记录为准；不将类型检查、构建、mock、真实后端或人工验收互相替代。验收方法见 [TESTING](../conventions/TESTING.md)。
- 前轮针对性验证：控制台与服务端相关133项测试、相关8项 E2E、根 `check`、console 类型检查及构建通过；任免说明补齐 `roles.manage` 全局范围与现任舰长移交/卸任例外，已定点复核并在构建页面观察。该批命令输出和截图保留在所有者桌面 `权限树-176-验收-LYsnowQ-20260928015657`，不改写历史失败记录。
- 同步轮 Linux 证据：上游同一提交的 [CI 36331998281](https://github.com/Yangtze-University-Geek-Class/admin/actions/runs/36331998281) 核心928项、论坛548项通过，但不含未提交权限树或浏览器套件。本机 WSL ext4 隔离副本含任务改动，独立安装 Linux Node22.23.2/pnpm9.15.9 与 Node26.10.0/pnpm11.24.0；根 `check`、server/web/console 构建、`forum:check`（30文件548项）和 `forum:generate`（61路由）通过。原 Windows 五组 POSIX 工具失败在该 Linux 副本均通过。
- 同步轮根 `verify` 仍退出1：60文件通过、1文件失败；905项通过、1项失败、28项因无 nginx 跳过。失败为 `mail-outbox.test.ts` 批量邮件一半回退 Resend 的用例，15秒内完成38/50。独立32项邮件测试与50封逐一发送 smoke 通过，只能说明独立路径正常，未证明全套失败根因或修复。
- 同步轮 Windows 浏览器原16项用例全部通过，包括前轮四个信纸场景。仓库外启动器只预先启动同端口5179/5189的 Vite，原 baseURL、chromium 项目、单 worker、零重试、断言、超时、trace 和浏览器参数保持。直接运行原命令仍遇到 webServer 30秒启动超时；首次外部包装漏解包 CJS 默认导出导致9个 invalid URL，是验证脚本错误，不是产品回归。三次日志均保留，不能把适配后通过写成原 Windows 启动链已修复。
- 同步轮真实路由逐项核对6种身份的20项能力：owner20有效/0受限、captain15/5、招新与社区双队长13/1、自定义领航员3/0、离组队长6/2、普通舰员2/0；动态改名、改包、归档后重读通过。Origin不匹配写请求为403 `invalid_origin`，匹配为200，匿名读取为401。桌面及390px权限树15/5、详情焦点、无横向溢出和无JS错误已实测。
- 分环境诊断与完整本轮日志在桌面 `权限树-176-同步验证-LYsnowQ-20260928024421`。旧官网 trace 的 CDN 错误来自测试主动 abort，不是 CORS；headless SwiftShader 实测动画时钟夹紧导致墙钟时间变长，但旧超时具体负载未证实。Windows 论坛启动器环境的裸 `node` 探针为 ENOENT，原生 PATH 为成功；旧300秒运行原日志与适配器缺失，不据此断言唯一根因。按审查规范，根 `verify` 未通过，合并结论仍为**阻塞**。
- 所有者已授权提交、推送本任务分支并创建指向 `stage` 的 PR；邮件批量回退失败已独立交给 `Crosery` 查验落实（[issue #178](https://github.com/Yangtze-University-Geek-Class/admin/issues/178)），本任务不修改邮件功能或放宽门禁。提交、PR、审查与检查状态以 issue 最新追踪和执行记录为准；仍未合入 stage 或发布，根 `verify` 的未决失败不因拆出 issue 而消失。未做预发布/正式人工验收、真实 GitHub OAuth、读屏/对比度专项、移动真机与完整论坛浏览器套件。

## 仓库外离线参考

此前独立 HTML 均保留在所有者桌面，没有嵌入产品或移入仓库：

- 完整图谱 `极客班权限图谱-stage-9b38684.html`：4,464,893字节，SHA-256 `73e1a3fcc19d347d6e3c900d21ddc79eeca9952603a7ff01a5840a33fcf2a623`。
- 剥离树 `极客班权限树-stage-9b38684.html`：67,185字节，SHA-256 `ba6b31a0f70be2ec6c2841f035777f8f2f28a1a97871b351c8ef97e110631ec7`。
- 离线14种身份与原报告一致，搜索/展开/组合身份、390px和打印已实测，HTTP请求0、JS错误0；是固定提交的离线参考，不代表当前线上配置或授权。原交付证据见 [交付记录](https://github.com/Yangtze-University-Geek-Class/admin/issues/176#issuecomment-5857312521)。

初始计划阶段的文档同步失败与当时的规则冲突保留在该交付记录和 [9月27日执行记录](../../notes/2026-09-27/lysnowq/task_176_permission_tree.md)，不得把历史失败当作当前基线的结论，也不删除历史记录。
