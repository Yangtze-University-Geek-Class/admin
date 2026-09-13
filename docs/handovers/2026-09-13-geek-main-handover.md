# geek_main 项目完整交接文档

> 2026-09-13 上午的交接记录：论坛原仓已引入，真实数据已备份并生成展示投影，当时本地论坛仍显示上游示例（中午起已改为只读显示极客班快照，见第 6 行）；统一主站、真实论坛服务和远程 CI/CD 尚未完成。

状态：`historical`（2026-09-13 10:25 交接时点记录，不是发版验收或新的授权）  
后续更新：2026-09-13 中午起本机论坛已按 [forum 模块合同](../modules/forum.md) 的只读快照模式显示极客班归档。本文中“本地论坛仍为上游示例 / browser-demo / 仍为示例内容”的表述（摘要、第 0、6.4、7.1、8.2、12.1 节）已过时；其余未完成项不变。  
交接日期：2026-09-13  
现场只读核对时间：2026-09-13 02:25:38 UTC，即北京时间 10:25:38  
项目位置：`/Users/crosery/work_file/geek_main`  
适用范围：本轮围绕 Mac、geek_main、论坛迁移、组件库、主站规划、数据迁移和发版规范的完整交接；不涉及用户的其他项目。  
保密范围：内部交接。本文不包含密码、私钥、Token、会话值、用户正文或数据库附件；不要加入网站公开文档白名单。

## 0. 接手者必须先知道的结论

**用户对前面交付明确不满意，并要求停止当前实施、整理完整交接。不能把本文当作继续部署、打 tag、修改业务代码或操作生产数据库的授权。**

最重要的实际状态：

| 项目 | 交接时的真实状态 |
|---|---|
| Mac 项目访问 | WebCodex Mac 可读写已授权项目并运行命令；不等于任意接管整台 Mac |
| 服务器访问 | 前一阶段已通过 Mac OpenSSH 成功连接极客班服务器并拉取数据；本次交接没有重新连接生产机 |
| 本地官网、管理预览、论坛 | 5173、3000、3456 对应服务在本次只读 HTTP 探测中可访问 |
| 论坛代码 | 已直接引入 Tuff Forum 的 Nuxt/Vue/Tuffex 原仓代码，不是 React 仿写 |
| 极客班原始数据 | 三份 SQLite 快照及附件已经保存在 Mac 私有目录 |
| 极客班展示数据 | 已生成独立只读投影及规范化附件，内容文件摘要本次再次匹配 |
| 本地论坛真实帖子 | **未接通，仍为上游种子和浏览器已有示例状态** |
| 真实身份与持久化 | 新论坛没有真实登录、服务端授权或共享可写数据库 |
| 主站 Hub、服务扩展、3D 品牌设计 | **未完成** |
| Tuffex AI 文档库 | 已建立离线资料、检索、来源和完整性检查 |
| 预发布与正式域名 | 已写入配置、检查代码、规范和论坛关于页；并非已完成远程环境部署 |
| CI/CD | **只有规范、设计、离线检查和环境展示；本机仓库没有 `.github/workflows/` 目录** |
| Git 发布状态 | 工作在 `next`；大量未提交改动；本地 tag 数为 0；没有在这些任务中提交、推送或上线 |

**新发现的交接缺陷：`.gitignore:12` 的 `forum-migration/` 规则也忽略了 `scripts/forum-migration/`。迁移脚本目前真实存在，但既未跟踪又被忽略，仅克隆 Git 仓库拿不到。真实备份应继续私有保存，脚本被误忽略则需要单独修正。**

不要把以下概念混为一谈：

```text
原仓下载完成 ≠ 业务迁移完成
数据拉到本地 ≠ 数据已导入目标数据库
展示投影生成 ≠ 网页正在使用真实帖子
本地 127.0.0.1 ≠ prev.yangtzeu.work
版本/域名检查通过 ≠ CI/CD 已建成
自动测试通过 ≠ 用户人工试用通过 ≠ 获准打 tag/部署
```

## 1. 用户要求的完整演进

### 1.1 按对话先后记录

| 阶段 | 用户要求 | 实际实施与后续变化 |
|---|---|---|
| 访问验证 | 通过 WebCodex Mac 访问自己的 Mac 项目 | 确认已注册的 `geek_main` 可列目录、读文件；最初验证只读 |
| 全项目审查 | code review；分析 Agent 友好性、规范、文档、设计和技术栈 | 审阅并报告安全、数据一致性、工具检查和文档漂移问题 |
| 全面规范化 | 合理修正不合格处；参考业界做法；geek_main 为统一总入口；模块化清楚、低耦合；规范都放 docs | 进行了源码、测试、文档和模板整改，但后续论坛替换使一部分旧修复退出活动实现 |
| Mac 本地部署 | 在本机实际运行、打开看看 | 启动核心隔离预览，后来增加独立 Nuxt 论坛；没有生产上线 |
| 新产品架构与论坛迁移 | 按 Tuff Forum 规范、技巧和组件库迁移论坛；公开宣传页、登录后的内部主站、GitHub 登录及可扩展服务 | 只完成原仓前端引入和入口切换；完整业务和主站没有落地 |
| 统一组件库 | 后续开发完全依赖指定组件库；AI 易查文档保存进 docs | 建立 Tuffex 固定版本本地资料库和查询入口 |
| 全量论坛数据迁移 | 将极客班论坛数据全部迁入；询问能否通过 Mac 终端访问服务器 | SSH 成功，之后用户明确先拉取本地；完成原始备份 |
| 发布管理 | main 主代码；release-/prev- tag；人工试用后发版；预发布版本带 @commit-id；AI 先读规范 | 已编写规范和离线检查；没有实际工作流和部署通道 |
| 纠正交付 | 本地仍是参考仓库帖子；不是极客班内容；域名应按 prev.yangtzeu.work 与 yangtzeu.work 区分 | 生成展示投影、增加域名检查和关于页显示；真实帖子仍没接通 |
| 当前交接 | 用户认为完成很差，要求把全部要求、细节、结果写成交接并告知位置 | 本文；本次仅核对、整理交接和文档索引，不继续业务开发 |

### 1.2 用户明确提出的最终产品结构

```text
公开宣传主页：所有人可进入
    |
    +-- 登录入口：先支持 GitHub，保留其他认证 Provider 扩展
            |
            +-- 内部主站 / 统一总入口：必须登录
                    |
                    +-- 论坛
                    +-- GitHub 组织管理页
                    +-- 其他服务
                         使用统一接入规范，支持高度 DIY 和扩展
```

“宣传主页”和“登录后的统一总入口”是两个层次。不能拿现有公开官网当作已经完成内部 Hub，也不能自行将内部论坛改成默认公开社区。后续路径、子域分流和服务授权需围绕这棵产品树落地。

## 2. 需求清单：哪些是用户要求，哪些尚未交付

| 编号 | 必须保留的要求 | 当前状态 / 完成判据 |
|---|---|---|
| R01 | `geek_main` 是项目统一总入口 | 目录和根命令编排已有；产品级统一入口未完成 |
| R02 | 项目模块边界清楚，尽量低耦合 | 已有模块合同与核心导入检查；论坛与核心采用独立工具链 |
| R03 | docs 存项目、提交、贡献、模块开发和技术文档规范 | 已分类建立；仍有历史/当前表述需持续清理 |
| R04 | AI 进入项目第一步先完整读规范 | 已放在根 AGENTS 最前面，并链接 AGENT-START |
| R05 | 论坛按指定 Tuff Forum 开发方式全线迁移 | 原仓前端已引入；数据、认证、服务端功能和生产迁移未完成 |
| R06 | 后续新增/迁移 UI 使用真实 Tuffex 组件 | 选型已确定，论坛已接；portal/admin 仍是 React，不能声称全站统一完成 |
| R07 | AI 能方便查询对应组件 API、示例与类型 | 已有离线镜像、索引、按章节查询 |
| R08 | 宣传主页公开访问 | 现有公开官网保留，但用户提出的新视觉重构未完成 |
| R09 | 内部主站必须登录 | 未完成 Hub 与统一访问控制 |
| R10 | GitHub 认证登录并预留其他认证接口 | 核心旧 GitHub OAuth 代码保留；新论坛/Hub 的统一 Provider 尚未实现 |
| R11 | 论坛、GitHub 组织管理、额外服务统一接入且可 DIY | 目前只是不同页面/应用入口；服务 manifest/注册协议和权限接入未完成 |
| R12 | 总入口设计丰富，有 3D、游戏感，沿用上传参考风格和默认主题色 | 未完成；不可把环境标识卡片或原仓论坛布局算作交付 |
| R13 | 可用生图丰富页面，必要时使用 Mac 的 mox-image | 是允许使用的手段，不代表已生成新素材或已验证 mox-image 可用 |
| R14 | 极客班自己的论坛数据全部迁入 | 完整原始备份有了，部分展示转换有了；真正可用的新论坛迁移未完成 |
| R15 | Mac 本地直接看见真实内容 | **未完成，是用户反复指出的主要问题** |
| R16 | main 为主代码，按 tag 控制发版 | 规范/规划器有了，远程机制未建 |
| R17 | release-版本号 正式，prev-版本号 预发布 | 已编码检查；不得改成 v/preview-/pre- |
| R18 | 必须有人实际试过并批准，才升版本、打 tag 发版 | 已写规则，未建立可信远程审批链 |
| R19 | 普通更新用版本号后 @commit-id，仅用于预发布 | 当前实现采用展示版本串；见第 8 节说明具体化解释与待确认部分 |
| R20 | `prev.yangtzeu.work` 预发布；`yangtzeu.work` 正式 | 配置、检查、关于页已完成；DNS/TLS/反代/环境服务未验证完成 |
| R21 | 论坛关于页区分环境和版本 | 本地已有卡片，标记“本地开发 / 未发布”；不等于已部署 prev |

## 3. 视觉、组件与架构意图

### 3.1 原始参考来源

- 用户指定论坛仓库：`https://github.com/talex-touch/tuff-forum`。
- 用户指定组件库文档：`https://tuff.tagzxia.com/zh/docs/dev/components`。
- 用户上传蓝白二次元角色设定参考图，要求作为默认主题的视觉、风格和颜色参考。
- 用户希望总入口具有丰富设计、3D/游戏感，可 DIY 扩展，并可用生成图片增加网页表现。

参考图在本对话中出现。**没有确认它已以原始附件形式保存到 Mac 仓库，也没有确认工程中既有 mascot 图片就是该参考图。** 接手者应找回用户原图；不能把已有素材或自行想象的新角色说成严格还原参考。

“蓝白科技、轻二次元、玻璃/分层卡片、看板娘、游戏面板感”等是此前助手根据参考提出的设计解释。它们可作草案，不等于用户逐项批准的精确设计系统。具体页面构图、主题 tokens、角色资产、动效范围和移动端退化方案尚无完整成品。

### 3.2 Tuffex 与原仓不是同一件事

Tuffex 是 Vue 组件基础；Tuff Forum 是采用该库做出的论坛前端演示。用户要的是借助这些代码和组件完成自己的产品，不是长期展示他人的示例社区。

已采用的论坛基线：

```text
目录：modules/forum/
来源：talex-touch/tuff-forum
提交：37164f75c0258b65922ea2151592e1f4efce8bde
许可：MIT；保留原作者和 LICENSE
```

上游 82 个原始文件已保存来源摘要。引入阶段只有 2 个文件作集成调整；最新状态为 **4 个已登记原始文件调整**：

```text
app/layouts/default.vue
scripts/lib/cdp.mjs
nuxt.config.ts
app/pages/about.vue
```

对应 `modules/forum/UPSTREAM.json`、`ADOPTION.json` 和 `scripts/check-forum-adoption.mjs`。不要继续沿用“80 个完全不变、只有 2 处修改”来描述最新工作区，也不要重算原始摘要掩盖未登记修改。

上游技巧已保留：按组件类型 barrel 自动注册、组件库内部图标 safelist、Pinia 数据组织、确定性种子、UnoCSS 组合、类型/Lint/样式 guard 和 CDP 浏览器检查。此前日志显示注册 214 个组件、来自 149 个 barrel。

论坛当前严格沿用“不自写样式表、SFC style 块或内联 style”的规则，使用组件 props/slots 和 Uno 工具类。这是所采用工程的约束；未来若与用户的 3D/DIY 品牌目标冲突，应正式记录例外方案并取得确认，不应偷偷绕过，也不能以此取消用户的视觉要求。

## 4. 当前代码结构、技术栈与 Git 状态

### 4.1 当前结构，不是最终产品结构

```text
geek_main/
├── AGENTS.md / README.md
├── docs/
│   ├── conventions/       项目、贡献、提交、AI 首步、发布等规范
│   ├── architecture/      架构、安全、API
│   ├── modules/           模块合同
│   ├── design/            设计和实际技术栈
│   ├── components/tuffex/  AI 可查询的组件资料
│   ├── decisions/         已记录决策
│   ├── ops/               本地运行、部署、数据、CI/CD 说明
│   ├── reviews/           各阶段报告，不能混算其测试结果
│   ├── history/、plan/    历史与计划，不直接当成当前实现
│   └── handovers/         本次交接
├── modules/forum/         Nuxt/Vue/Tuffex 原仓论坛
├── web/sites/portal/      仍为 React 的公开官网
├── web/sites/admin/       仍为 React 的 GitHub 管理端
├── web/shared/            核心前端共用适配
├── server/src/
│   ├── index.ts           核心启动/监听
│   ├── app.ts             buildApp，不监听
│   ├── services.ts        核心资源生命周期
│   ├── routes/portal/、admin/
│   ├── middleware/
│   └── lib/
├── scripts/               检查、编排、发布规划、迁移工具
├── tests/                 核心隔离回归、浏览器及工具测试
├── deploy/                模板和环境合同
└── .tools/                本地运行工具、备份与私有数据，不能整体清理
```

目前是根目录统一编排的混合技术栈工作区，不是已完成 SSO 的统一平台；也不是“三个前端共用同一论坛后端”的旧架构。

### 4.2 技术栈

以下版本来自前期实际安装/运行记录、当前 manifest 及 `docs/design/STACK.md`，不是互联网最新版，也不是已核实的线上运行版本。

| 范围 | 技术 |
|---|---|
| 核心运行时 | 项目隔离 Node 22.23.2；根要求 Node 22，最低 22.13；pnpm 9.15.9 |
| 核心前端 | React/React DOM 18.3.1；React Router 7；TanStack Query 5 |
| 核心构建/样式 | Vite 6.4.2；TypeScript 5；Tailwind 3；PostCSS；CSS variables |
| 核心后端 | Fastify 5；Cookie、rate-limit、static 等插件 |
| 核心存储 | SQLite WAL + better-sqlite3 11；核心使用 data.db |
| 核心身份/外部服务 | GitHub OAuth、Octokit、Cookie 会话、AES-256-GCM、邀请/反馈防护 |
| 内容/图片依赖 | marked、DOMPurify、highlight.js；sharp 0.34 仍在依赖内 |
| 新论坛工具链 | Mac Node 26.8.2；上游要求 >=26；独立 pnpm 11.24.0 |
| 新论坛框架 | Nuxt 4.5.2、Vue 3.5.42、Pinia 4.0.3 |
| 新论坛 UI/构建 | Tuffex 0.6.0、UnoCSS 66.10.2、Vite 8.2.2、Nitro 2.13.4 |
| 新论坛渲染 | `ssr: false`，SPA；generate 输出不等于动态帖子已预渲染 |
| 测试 | Vitest 3.2.7、Testing Library、jsdom、Playwright/Chromium、上游 CDP、Python unittest |
| 服务器方案 | 历史 Nginx + systemd + SQLite；新双环境部署尚未完成 |

不能把 Vue Tuffex 组件直接导入 React TSX，也不能用同名 React 仿制组件声称已采用用户指定组件库。

### 4.3 Git 基线与未提交改动

本次交接编写前现场读到：

```text
分支：next
上游：此前记录为 origin/next
HEAD：0602bb5e4b376c2842edb1edfd1faf9da73dd4ad
根 package.json version：0.1.0
本地 tag：0 个
git status --porcelain：197 个条目
其中已跟踪改动：134 条
未跟踪条目：63 条（可能是整个目录，不等于只有 63 个文件）
冲突：0
```

这个 HEAD 是一系列未提交修改之前的基线，**只 checkout 该提交不能复现本地现在的产物**。真正交接对象是当前工作区、未跟踪的 `modules/`/docs/tests、被误忽略的迁移脚本，以及另外保管的私有数据。

禁止擅自 reset、git clean -fdx、整目录覆盖、移动 tag 或在脏工作区切分支合并。当前用户要求的是交接，不是授权把全部修改提交到 main。

## 5. 最初 code review 和规范化成果：历史与现在要分开

最初审查记录扫描 105 个 TS/TSX 文件、495 处导入、91 处路由注册，并对关键问题作源码核对或隔离复现。这些是当时规模，不是当前架构统计。

| 原问题 | 当时处理/发现 | 当前交接含义 |
|---|---|---|
| SVG/伪图片同源上传风险 | 禁 SVG，真实解码和重编码，限制资源，测试残留文件 | 旧上传路由已退役；不能声称新论坛已有上传后端 |
| 论坛登录/注册缺限流 | IP/账号限制，凭据变更重新认证、轮换和撤销会话 | 旧论坛认证已退役；新论坛仍是假身份选择 |
| 邀请并发突破额度 | 原子预留、幂等尝试状态、明确失败补偿、不确定结果待核对 | 核心保留，需要后续维护和生产验证 |
| 文档 API 路径错误 | 修正根路径，公开允许列表，隔离测试真实文档非空 | 核心保留；内部交接和组件资料不得因此公开 |
| 重复软删重复扣计数 | 条件更新和事务，重复操作不二次扣减 | 旧论坛实现已退出；新后端需重新保障 |
| 归档/锁帖 API 不完整 | 统一服务端写保护，跨主题回复检查 | 新前端权限 helper 不是该能力的替代 |
| OAuth 回跳和绑定边界 | allowlist、签名状态、有效期、绑定前后会话核对、原子轮换 | 核心 OAuth 保留；旧论坛桥接已移除 |
| 头像上传后保存旧状态 | 显式传递新资料给 mutation | 属旧 React 论坛修复；新论坛资料 API 未接 |
| Enter 误确认危险操作 | 不全局确认；默认取消；排队、焦点进入/返回 | 核心 React 适配保留；Tuffex 交互仍要单独验收 |
| Select/NumberInput 交互不完整 | 平台语义适配，保留数字编辑中间态 | 核心保留，不扩建平行新组件库 |
| API wrapper 捕获自身错误 | 分离 JSON 解析和业务异常；Headers/FormData/204 | 核心共用适配保留 |
| mock 未知请求假成功、字段漂移 | 未知接口报错，核心 mock 写入只读，DTO 对齐 | 新论坛 mock 可改浏览器状态，不能混称同一种 mock |
| 回复无分页 | URL、请求和查询键同步；浏览器翻页验证 | 旧实现退出；上游列表/帖子流能力不等于真实 API 分页 |
| 移动管理端导航丢失 | 增加组织切换、导航和退出 | 核心保留 |
| 大页面职责杂糅 | 仓库详情拆 feature；曾将 ForumAdmin 拆小 | 后者退役；不继续用旧行数证明新论坛完成 |
| 边界检查漏 dynamic import/.js→.ts/alias | AST 和解析检查，反例测试 | 核心检查保留；不涵盖所有 Vue、HTTP、URL、Cookie 语义 |
| 测试复制 handler、默认触碰业务库 | buildApp/inject、内存库、外部接口模拟，旧脚本退役 | 核心可复用；论坛现有测试主要验证浏览器演示 |
| Nginx 头继承及服务 root 身份 | 修改模板，共用安全头、专用用户和只读代码 | 模板未等于目标服务器已应用 |
| 文档冲突/旧路径/设计当事实 | 单一规范源、薄工具入口、文档状态、局部指针 | 仍有残留漂移，见第 12 节 |

主要历史报告：[NORMALIZATION](../reviews/NORMALIZATION.md)。它已标为 historical，不得拿旧论坛修复和旧 48 项测试冒充当前新论坛生产保障。

本地 `.tools/retired-forum/` 保存退役的 server/web/tests；旧源码和文档压缩备份位于：

```text
.tools/backups/pre-tuff-forum-20260913-022147/
├── source.tar.gz
├── retired-source.tar.gz
├── README.txt
└── docs/
```

**替换流程的问题：原业务代码退役先于新业务接入完成，造成目前只有新界面而没有真实论坛服务的空档。不能把当前工作区直接发布去替换线上旧站。**

## 6. 数据交接：备份、投影、目标业务是三层

### 6.1 原始私有备份

```text
/Users/crosery/work_file/geek_main/.tools/forum-migration/20260913-initial/
├── transfer.tar.gz
└── source/
    ├── manifest.json
    ├── forum.sqlite
    ├── mbbs-snapshot.sqlite
    ├── mbbs-original.sqlite
    └── attachments/
        ├── legacy/
        ├── uploads/
        └── mbbs-original/
```

来源和主要统计：

| 数据 | 服务器来源 | 内容 |
|---|---|---|
| 现用论坛 | `/opt/yzgc-admin/data/forum.db` | 183 用户、87 主题、66 回复、21 分类、4 标签、4 用户组；共 13 张业务表 |
| 旧迁移快照 | `/opt/yzgc-admin/data/bbs-snapshot.db` | 164 用户、77 主题、145 posts（包括首帖）、16 分类；共 12 张业务表 |
| 原 mbbs | `/root/geek-mbbs/bbs.db` | 单独保留原始库，同类 12 表，不能因为条数相同就删 |
| 当前历史附件 | `/opt/yzgc-admin/data/legacy-resources` | 160 文件，29,817,368 字节 |
| 当前上传 | `/opt/yzgc-admin/data/forum-uploads` | 11 文件，761 字节；不应假定全是有效图片 |
| 原始附件 | `/root/geek-mbbs/resources` | 160 文件，29,817,368 字节，作为来源副本保留 |

现库全表条数：

```text
forum_categories           21
forum_group_permissions    26
forum_groups                4
forum_likes                 0
forum_notifications         0
forum_posts                66
forum_sessions             48
forum_settings              0
forum_tags                  4
forum_thread_tags           0
forum_threads              87
forum_user_groups         183
forum_users               183
```

旧快照和原 mbbs 的表条数分别均为：

```text
categories          16
group_permission    99
group_user         163
groups               5
post_user           47
posts              145
settings            30
thread_tag           4
threads             77
user_message       133
user_token           3
users              164
```

这些数字包含私有记录和状态，不表示可以公开全部表。特别是 sessions、token、password、email、IP、旧消息只应留在受控原始备份/迁移策略中，不能灌入浏览器。

采集开始时间：`2026-09-12T19:03:18Z`。使用只读源连接和 SQLite online backup，经 SSH 传输；每库是一致快照，但不是跨三库停站后的原子切点。源站仍可能有后续新增，正式切换前需增量核对。

已验证载荷 334 文件：3 数据库 + 331 附件条目，载荷 62,306,089 字节；压缩包 58,030,132 字节，摘要：

```text
a5f30455530251d7d2347808632b049fcb6147d68e548e52331e3a393a835aac
```

前阶段已逐文件核验、将三库恢复到内存并检查全部表/条数和完整性；两份历史附件逐路径/摘要一致。本次交接只复核存在性、权限、大小和投影摘要，没有再次做全库恢复。

本地文件 0600、备份目录 0700，Git 忽略。`.tools/forum-migration` **不是可删除缓存**。未上传 Git、Actions artifacts 或聊天数据库附件；本文可下载副本也不带任何真实库、图片或用户正文。

### 6.2 展示投影：已经生成，但没有接页面

```text
/Users/crosery/work_file/geek_main/.tools/forum-runtime/geek-20260913/
├── content.json
├── manifest.json
├── conversion-report.json
├── asset-job.json
├── asset-index.json
└── assets/
```

结果：183 个公开资料投影、69 个有效主题、35 条有效回复、21 分类、67 个历史归档主题。18 个已删除主题、31 条已删除回复没有重新公开。

这里的 67 个归档主题是**极客班自己的旧内容**，与目前浏览器看到的 Tuff 示例社区完全不同。当前数据 87/66 与可展示数据 69/35 的差别来自删除状态，不能误报丢失，也不能复活已删内容凑数。

附件处理：160 份有效输入规范化；11 份现站上传不符合允许格式而未用于展示；去重为 129 份资产，可见内容实际引用 85 份，缺失引用记录 0。原始文件全部保留。图片已解码重编码 WebP；MD 作为文本下载；MP4 处理不等于完成全面媒体安全审计。

`content.json` 的 SHA-256，本次现场与 manifest 再次匹配：

```text
1e42f9006ff65118c25dc75dd2bde7d3ddd876f63bdf7af0868d28381e1d3fb8
```

投影 manifest 摘要：

```text
1ac1ad10843c06117c37a49e304d60afbefc9d02e0b46bde28f891998efadf57
```

### 6.3 转换规则和未覆盖项

实现位置：`scripts/forum-migration/prepare.py`、`normalize-assets.mjs`。

已实现的只读投影规则：

- 当前 `forum.sqlite` 为展示权威，不从旧 mbbs 无条件复活已删/隐藏记录；隐藏父分类递归影响子分类，分类循环报错。
- 用户、分类、主题、回复分别转为 `u<id>`、`c<id>`、`t<id>`、`p<id>`；主题正文独立为 `body-<thread-id>`。
- 旧 `#/thread/detail/N`、部分分类与 `/forum/archive/t/N` 链接按映射改写；代码围栏内保留原样。
- 附件路径改为 `/api/local-forum/assets/<hash>`；**该服务路径目前不存在，所以链接转换完成并不意味着附件可访问。**
- 投影包含 `legacyLinks`，供后续旧 URL 兼容；未完成浏览器整站旧链接跳转。
- 当前用户的邮箱、密码、会话、IP、私有通知和用户组授权不进入展示 JSON。

投影不是最终全量迁移，接手者必须处理以下缺口：

| 缺口 | 说明 |
|---|---|
| 真实身份 | 投影的 role 用于显示；`teacher`、`banned` 等被归为 member 的展示映射不能作为目标授权规则 |
| 用户私有数据 | 原始备份保留，但尚无新身份认领、密码兼容、第三方绑定或私有消息迁移方案 |
| 历史去重 | 不能直接相加两代 users/posts；原 mbbs 有 77 首帖，旧回复/点赞/消息与现库存在差异，须逐项对账 |
| 分类层级 | 源 parent_id 参与隐藏判断，但展示结果未完整承载原分类层级 |
| 精华/元数据 | 投影不是逐字段导入；例如 is_essence、content_format 等没有完整映射到目标实体 |
| HTML/Markdown | 当前历史正文虽标 html，却含大量 Markdown；需保持代码块、表格、图片、视频和安全净化，不能只改格式标志 |
| 附件完整性 | 当前 85 个引用文件存在不代表所有旧 URL、视频播放、下载头、路径编码均已浏览器验收 |
| 时间/统计 | 毫秒时间、先后顺序、首帖判断、reply_count、views 和历史计数需真实页面验证 |
| 写入与重启 | 未导入目标可写数据库，没有重启持久化和跨浏览器同步 |
| 权限/隐私 | 只读公开字段投影仍含真实成员信息；只能在用户授权范围内展示，不能随意公开部署 |
| 原始资料完整性 | 133 条旧消息、47 条旧点赞关系、用户组权限等只在原始快照保留，不应宣称已迁入新业务 |

### 6.4 为什么本地仍是示例

```text
现有启动链：
createSeed() → Pinia forum store
           → persist.client.ts 读写 tuff-forum:* localStorage
           → Nuxt 页面

现有准备链：
源库/附件 → capture/verify → prepare/normalize → 私有 content.json/assets

两条链之间没有完成真实数据 API 与前端 data adapter。
```

关键代码仍为原仓状态：

```text
modules/forum/app/stores/forum.ts
modules/forum/app/stores/session.ts
modules/forum/app/plugins/persist.client.ts
modules/forum/app/data/seed.ts
modules/forum/app/data/persist.ts
```

上轮记录称本地数据接口创建被工具安全检查拦截；能够直接核实的是：业务 API 没有落盘，前端 store/persist 没有接投影。交接没有保存完整的拦截原因对象，**不能仅据此前说明断定永久无法实现，或臆造具体权限原因**。接手应根据实际允许的接口、项目规范及明确授权处理，不能换通道规避安全限制。

清缓存只会恢复原仓种子，不能补出不存在的服务和数据接入。也不能直接把原始数据库、含私有字段的 JSON 或真实身份塞进 demo localStorage 来“看起来完成”。

### 6.5 迁移脚本被 Git 误忽略：本次新增发现

实际目录：

```text
scripts/forum-migration/
├── capture.py
├── verify.py
├── prepare.py
├── normalize-assets.mjs
├── test_capture.py
└── test_prepare.py
```

本次 `git check-ignore -v` 返回：

```text
.gitignore:12:forum-migration/    scripts/forum-migration/prepare.py
.gitignore:12:forum-migration/    scripts/forum-migration/capture.py
```

脚本存在、可运行，并不代表它们已进入可交付源码。下一实施阶段应精确修订 ignore 范围，让工具源码可审阅和提交，同时保留 `.tools` 下真实备份/投影的忽略。**本次交接没有修改 `.gitignore`，没有 force-add 或上传任何数据。**

## 7. 本地运行与服务器位置

### 7.1 本机入口

| 入口 | 地址 | 数据/身份 |
|---|---|---|
| 核心首页 | `http://127.0.0.1:5173/` | 跳转 `/sites/portal/?__data=mock` |
| 宣传主页 | `http://127.0.0.1:5173/sites/portal/` | 现有官网，非新的 3D Hub |
| GitHub 管理预览 | `http://127.0.0.1:5173/sites/admin/admin?__data=mock` | 只读样板，不操作真实组织 |
| 新论坛 | `http://127.0.0.1:3456/` | 上游示例 + 浏览器 localStorage |
| 论坛关于页 | `http://127.0.0.1:3456/about` | 环境/版本卡片已加，真实内容未接 |
| 核心健康检查 | `http://127.0.0.1:3000/healthz` | 核心隔离 API |
| 核心身份标记 | `http://127.0.0.1:3000/__local_preview` | `database: memory`、外部集成关闭 |
| 论坛身份标记 | `http://127.0.0.1:3456/__geek_forum` | `mode: browser-demo`、真实认证/持久化均 false |

本次现场上述 HTTP 探测均成功。关于页只做 HTTP 可达性复核，没有在本次重新运行浏览器；前阶段的桌面/手机视觉验证见第 11 节。

```text
核心 supervisor PID：28604
论坛 supervisor PID：74897
```

PID 仅是本次记录，不是后续杀进程依据；运行前先核对脚本 status 和实例身份。服务只在本机回环地址，无自动开机启动。此前另有 4173 服务，本任务始终未接管；交接时不启动、停止或改写它。

日志与运行状态：

```text
.tools/local-preview/runtime.json
.tools/local-preview/preview.log
.tools/tuff-forum/runtime.json
.tools/tuff-forum/dev.log
.tools/tuff-forum/screenshots/
modules/forum/reports/
```

核心内存数据库重启会清空；论坛 localStorage 不因进程重启清空。二者都不等于持久化的新论坛业务数据库。

### 7.2 服务器连接证据

前阶段通过 Mac 执行 OpenSSH，成功返回：

```text
SSH_CONNECTION_OK
Linux
root
GEEK_DEPLOYMENT_FOUND
FORUM_DB_FOUND
MBBS_SNAPSHOT_FOUND
```

极客班服务器目标：`root@103.117.123.226`，SSH 端口 `22000`。这是连接定位信息，不含凭据；本次不读取私钥、密码、known_hosts 正文或 `.env`。已经验证可连接并不意味着以后可无授权操作 root 服务或复制密钥进 CI。

服务器历史路径：

```text
/opt/yzgc-admin/                          当前旧站部署
/opt/yzgc-admin/data/forum.db
/opt/yzgc-admin/data/bbs-snapshot.db
/opt/yzgc-admin/data/legacy-resources/
/opt/yzgc-admin/data/forum-uploads/
/root/geek-mbbs/bbs.db
/root/geek-mbbs/resources/
```

数据采集时 `yzgc-admin` 服务为 active。每次后续服务器操作必须重新核实状态，不能将历史记录当作现在的在线事实。根目录的 `极客班-论坛与服务器梳理.md` 是历史调查材料，可能含敏感配置，不应整篇复制进聊天或新交接。

## 8. 版本、域名和 CI/CD：要求与实现边界

### 8.1 用户明确确认的规则

| 类型 | 目标域名 | 标识 |
|---|---|---|
| 正式发布 | `yangtzeu.work` | `release-版本号` |
| 预发布版本 | `prev.yangtzeu.work` | `prev-版本号` |
| 预发布普通增量 | `prev.yangtzeu.work` | 版本号后追加 `@commit-id` |
| 本地开发 | localhost / 127.0.0.1 | 不是预发布，不算正式发版 |

`main` 是主代码。升级版本和打发版 tag 前必须有人实际试用并明确批准；机器测试、AI 的“完成”或普通 commit 都不能代替这一步。AI 第一操作必须先看 docs 规范。

### 8.2 当前已经写出的代码

```text
deploy/environments.json
scripts/deployment-environment.mjs
scripts/release-policy.mjs
tests/tooling/deployment-environment.test.ts
tests/tooling/release-policy.test.ts

modules/forum/shared/deployment.ts
modules/forum/app/composables/useDeploymentInfo.ts
modules/forum/app/components/DeploymentInfo.vue
modules/forum/tests/deployment.test.ts
modules/forum/nuxt.config.ts
```

`preview` 固定映射 `https://prev.yangtzeu.work`，`production` 映射 `https://yangtzeu.work`。检查器拒绝 tag 和目标 origin 交叉、非预期地址，以及不符合当前语法的版本；发布规划器只读，本地 Git 检查后仍输出 `deploymentAuthorized: false`。

论坛关于页和顶部提醒已接环境信息。当前显示“本地开发 / 未发布”和仍为示例内容。使用公共构建变量：

```text
GEEK_DEPLOYMENT_ENVIRONMENT
GEEK_RELEASE_VERSION
GEEK_RELEASE_COMMIT
```

本地不借用根 package.json 的 0.1.0 假装已有正式 release。设置这些变量不能证明人工批准，也不是服务器访问控制。

### 8.3 前助手对规则的具体化，不要冒充全部为用户原话

当前规范/代码采用以下解释：三段 `X.Y.Z`、不带前导零；`@commit-id` 为展示串、不另创建 tag；显示 SHA 前 12 位，保存完整 40 位；发版或预发布增量必须在 main 历史上；使用已接受的 prev 基准。

用户明确说了 tag 前缀、人工试用、main 和预发布 @commit-id，但并没有逐字指定所有这些实现细节。**接手要保留原话和当前实现的区别，尤其是 @ 是否仅展示、短 SHA 长度、首次 prev 基准及日常预发布触发方式。** 现行规范是当前工程约束；若要更改解释，应与用户确认后同步代码/文档，不自行打 `prev-X.Y.Z@...` 测试 tag 或悄悄改格式。

### 8.4 尚未建成的 CI/CD

本次现场确认 `.github/workflows/` 不存在，以下均不能标为完成：

- PR/main 的真实 GitHub Actions CI 和双工具链 Linux 构建。
- 候选产物、人工试用记录及准确 commit/产物摘要绑定。
- tag 创建前验收、tag refs/main 保护和可信发布人机制。
- 预发布/正式的 secrets、审批、部署身份和环境隔离。
- 上传/激活产物、健康检查、失败回滚和部署审计。
- `prev.yangtzeu.work` 的 DNS、证书、Nginx 路由和独立实例。
- 生产域名新论坛服务切换及全套业务验收。

不能将 repo 中两个域名、一个 `environment` 字符串或 `approved=true` 当作人工审批已经启用。GitHub 私有仓库计划的具体能力需实施时重新核对官方文档，不拿旧说明当永久条件，也不得为获得功能公开私有仓库。

### 8.5 环境隔离与路由残留

新要求按整站两个域名区分环境；现有 `web/shared/config/app.config.json`、`web/shared/lib/runtime.ts` 和核心 `resolveSiteEntry()` 仍保留 `forum.yangtzeu.work`、`github.yangtzeu.work` 等旧站点分流假设。**新增 environments.json 没有自动改完全站 URL、API、OAuth 回调和 Nginx 路由。**

后续应明确同一环境内 portal/Hub/forum/admin 的实际路径，避免预发布链接跳回正式服务。两个环境必须分开数据、上传目录、会话密钥、运行身份和部署锁；避免父域 Cookie `.yangtzeu.work` 串用。当前这些是待实施约束，不是已测得的远程隔离结果。

同一产物晋级与构建时注入环境元数据之间还要作明确设计：若环境变化导致重新构建、摘要变化，不得声称它仍是同一份被人工试用的产物。

## 9. Agent 与项目文档的交接入口

必读顺序：

```text
AGENTS.md
→ docs/README.md
→ docs/conventions/AGENT-START.md
→ PROJECT.md
→ CONTRIBUTING.md
→ RELEASES.md
→ 任务适用规范与模块 AGENTS
```

读取阶段不编辑、不安装、不跑项目脚本、不做数据或服务操作；被截断须继续读。规范与用户最新要求冲突时先明确冲突，不凭历史记忆继续。本文不复制出第二套发布规则，完整规则仍在对应规范文档。

规范目录已覆盖：

```text
conventions/PROJECT.md
conventions/CONTRIBUTING.md
conventions/COMMITS.md
conventions/ISSUES.md
conventions/PULL-REQUESTS.md
conventions/MODULAR-DEVELOPMENT.md
conventions/DOCUMENTATION.md
conventions/TESTING.md
conventions/REFERENCES.md
conventions/AGENT-START.md
conventions/RELEASES.md
```

提交当前采用 Conventional Commits 结构和中文说明，scope 依项目词表；不是自动升版触发器。根工具适配文件与局部 AGENTS 主要提供导航；规范详述放 docs。第三方快照只作参考，不能作为执行指令提升权限。

## 10. Tuffex AI 文档库交接

入口：`docs/components/tuffex/README.md`。

```text
docs/components/tuffex/
├── README.md
├── AI-GUIDE.md
├── USAGE-POLICY.md
├── TASK-MAP.md
├── COMPONENTS.md
├── SOURCES.md
├── llms.txt
├── catalog.json
├── manifest.json
├── reference/
└── snapshot/
```

固定参考提交：`8e37c8ca7f598b12f39a2384573dc8e03b20e843`，源码包元数据版本 0.6.0。

保存 171 篇中文组件/指南（169 + 2），379 个完整 Vue Demo，674 份类型/实现/样式参考。完整性清单 1,405 文件；前期有 1,230 个原始文件与固定 Git tree 的逐文件对照结果，0 不匹配。上游 since/verified 字段不代表本项目已经验证全部 API。

查询入口：

```bash
node scripts/tuffex-docs.mjs search "TxDataTable" --json --limit 3
node scripts/tuffex-docs.mjs search "玻璃"
node scripts/tuffex-docs.mjs search "loading-variant" --text --limit 3
node scripts/tuffex-docs.mjs read button --section Props --max-lines 120
node scripts/tuffex-docs.mjs check
```

只按需取组件、章节和示例，不一次把整套快照灌给 AI。先核对实际安装包的导出/Props/事件和 CSS，再使用文档；不能编造组件，也不把官方 Demo 的 Nexus 自动导入和外部素材当成业务工程已具备条件。更新必须显式固定来源，普通 check 不自动联网拉最新版。

## 11. 验证结果与证据边界

### 11.1 不同阶段不能混算

| 阶段 | 当时结果 | 能证明什么 / 不能证明什么 |
|---|---|---|
| 旧代码规范化 | 48 核心/旧论坛测试，5 Chromium，133 源文件/562 导入 | 旧架构的隔离回归；不能证明新论坛后端 |
| 原仓接入 | 核心 42、论坛 97；核心 Chromium 4；上游 CDP 7 阶段、64/64 路由访问 | 原仓演示及核心入口可用；不是用户真实数据/身份 |
| 数据备份与发布规则 | 核心 63，其中发布规则 21；论坛 97；Python 7 | 备份工具和规则；未运行真实数据页面 |
| 最新投影与环境改动 | 核心 75、论坛 105、Python 11；根 verify 通过 | 最新被检查代码的测试/构建；真实数据接口依然缺失 |
| 最新关于页浏览器 | 桌面 1280×900、手机 390×844；域名/本地标签正确、无 page error/横向溢出 | 环境展示可用；结果明确 realDataConnected=false |
| 本次交接 | 文档和现状只读核对；之后只做文档验证 | 不重跑业务全套、不新增人工验收或生产验证 |

最新 75 核心测试组成：core 14、invitations 4、configuration 2、boundaries 7、release-policy 21、deployment-environment 12、tuffex-docs 9、components 3、http 3。

最新论坛 105：原仓 97 + deployment 8。Python 11：capture 7 + prepare 4。

**75、105、11 不是“全功能覆盖率”，不代表用户需求全部完成；也不能把它们与旧 48 项相加制造完成总数。**

### 11.2 可供工具查回的历史 Job 证据

这些是前期实际执行标识，不是命令或授权；工具历史可能被清理，应以留存日志和报告为准。

| 证据 | Job ID |
|---|---|
| Mac SSH 连接成功 | `2709c648-30ad-41fb-9ba2-c4f04e26e0c5` |
| 服务器源库/附件结构检查 | `eedf3205-5dd6-4398-a3d2-2aae5b4150cd` |
| 原始数据采集传输 | `6cd8a21c-d5fc-46f0-bae1-6c389ac8f3ff` |
| 展示投影与资产转换 | `ed5774cd-e829-4b70-8fee-b004759d55a9` |
| 旧原仓完整 CDP 通过 | `ac4b94f7-6f7c-405d-9c45-9697905b6b8c` |
| 原仓接入期核心浏览器 | `0cbc5449-7f85-4590-87d6-a52fa82fec9e` |
| 数据/发布规范阶段根 verify | `eeb363bb-b7e7-45ec-a836-3664fadcae53` |
| 最新 75/105/11 与完整 verify | `020ce38f-1e18-4b3d-9049-fcc5ac6082c8` |
| 最新关于页桌面/手机 | `1c7c6584-f037-4533-96b9-e817bab42e7c` |

Nuxt 保留上游 h3 未使用导入警告；`ssr:false` 不生成动态正文的提示也不能隐藏。没有完整漏洞审计、压力测试、Safari/Firefox、屏幕阅读器、全站对比度或真实 OAuth/Turnstile 环境验收。

WebCodex 历史收尾仍有名称启发式 `sensitive_path_risk` 和脏工作区提示；不要说综合汇总“全绿”。`scripts/check-secrets.mjs` 和 `server/src/lib/password-policy.ts` 曾因名称被标记，不能仅凭名称认定真实泄漏或为消提示删工程代码。真实的旧文档凭据泄漏是另一件事。

## 12. 明确缺陷、风险与应纠正的说法

### 12.1 当前阻断项

| 优先级 | 问题 | 接手要求 |
|---|---|---|
| P0 | 用户打开本地论坛仍是参考社区 | 先完成真实服务/数据适配和浏览器验收，不再以文件生成或提示条替代 |
| P0 | 新论坛无真实身份/持久化，但旧业务已退出 | 禁止直接部署替换旧站；建立功能等价和数据安全方案 |
| P0 | 真实备份在被忽略的 `.tools` 下 | 禁止整体清理；确保移交机器时以私有通道携带并核验，不进 Git |
| P0 | 迁移工具源码被 ignore | 单独修正规则并审阅，不让别人 clone 后丢脚本 |
| P1 | CI/CD 工作流实际不存在 | 不再称“已能发版”；按已确认域名和人工门禁实现 |
| P1 | 双环境只新增合同，旧前端/后端仍有独立子域假设 | 路由/API/OAuth/Cookie/部署一起核对，避免 prev 连生产 |
| P1 | 投影不是全字段业务迁移 | 原始库对账、权限/私有记录处理、去重、附件和历史链接验收 |
| P1 | 大量未提交跨任务变更 | 先确定工作区移交与分批提交策略，不能默认 HEAD 代表成品 |
| P1 | 历史部署文档含过明文服务器凭据 | 当前删除不等于历史泄漏消失；需要所有者轮换和追溯 |
| P2 | 报告“当前”状态与阶段事实混杂 | 更新语义，不复用旧数字；报告应记录确切范围 |
| P2 | `LOCAL-CONTENT-ENVIRONMENTS.md` 仍写“执行后补充数字” | 测试已跑但该报告未补齐；本交接提供已知历史证据，不假装原报告已完善 |
| P2 | “三端两库”或“原仓只有两处改动”等旧总结 | 最新是混合工作区、核心停用论坛库，已登记四处原文件变化 |
| P2 | 原始参考图/新生成资产缺少正式落盘与来源记录 | 找回用户图、确定版权/来源与可复用资源，不宣称已完成新视觉 |

### 12.2 前面交付做得不好的地方

主要问题不是“少了一段说明”，而是实施没有闭合用户体验：任务跨过代码替换、文档整理、备份、转换和环境显示，却没有完成最重要的页面真实内容接入，也没有交付可运行的发布工作流。

应明确纠正：

- “直接引入原仓”只解决前端来源，不等于完整迁移旧论坛能力。
- “全部数据已拉取”是备份保全，不能让用户期待新页面自动出现。
- “69 主题投影生成”只代表转换文件存在，尚无浏览器服务读取。
- “关于页显示两个域名”不代表 DNS、TLS、实例、数据库和 Actions 配好。
- “类型、单测、构建通过”不能替代真实用户场景和人工试用。
- 旧凭据“从当前文件删除”不代表已轮换，旧安全修复退役后不代表新实现继承保障。
- “工具拦截”必须保留真实错误信息和安全边界；不能拿无法核实的阻塞说法当永久结论。

这些是交接中应保留的缺陷，而不是需要美化为完成项的成绩。

## 13. 接手后的实施顺序与可验证完成条件

本节是待办建议，**不是本次已执行的任务，也不是发版授权**。

### 13.1 先保护并确认交接对象

完整读取规范后，核对 HEAD/分支/工作区、关键源码、原始备份摘要和被忽略脚本。先保留当前未提交工作，确认可以回到既有状态。不读取密钥正文，不把真实备份交给不可信测试运行器。

### 13.2 优先解决真实内容显示

建议先交付明确标记的、受控本地只读接入，再完成完整可写业务；只读阶段只是中间里程碑，不能代替用户的“全线迁移”。

必须有真正的数据 adapter/API，而不是手工浏览器注入。核对成员公开字段、角色展示与权限的隔离、删除/隐藏状态、内容净化、附件 allowlist、无目录遍历和 no-store。加载真实数据失败要显示错误，不能悄悄退回 Tuff 种子。

验收至少包含：实际打开极客班主题/回复、分类、搜索、分页、代码块/表格、图片/视频/下载、旧站内链；冷启动与刷新可复现；不依赖人工改 localStorage。当前快照预期为 69 有效主题/35 回复/21 分类，数量调整须有逐项说明。

### 13.3 建立真实身份与完整迁移模型

定义目标实体、原 ID 映射、版本化迁移、事务/幂等、权限和数据所有权。统一 GitHub Provider 与未来其他登录方式，不直接认领同名用户；禁止导入旧会话即视为已登录。真实写入和权限只能由服务器验证。

保留角色、组、分类层级、历史状态与重要元数据。公开内容、私有消息、凭据、已删记录分别迁移/留档并出对账，不以不公开为由默默丢数据。源备份不可变，目标副本可重建。

### 13.4 主站、服务协议和视觉

将公开宣传、登录入口、内部 Hub、论坛和 GitHub 组织管理按统一身份与服务接入规范连接。未来服务 manifest 至少明确 ID、入口、权限、启用条件和模块边界；具体字段尚是设计待办，不是当前已存在接口。

在真实 Tuffex 基础上做用户的蓝白参考主题、3D/游戏感首页、可 DIY 服务卡片及素材。交付移动/桌面效果、减少动效、键盘和性能退化方案。既有 React 核心迁移需分阶段，不因为 Vue 库已安装就声称全站完成。

### 13.5 CI/CD 与两个环境

先在 Linux 隔离构建/测试，固定完整 SHA 和产物身份；机器 CI 不带生产秘密。不让普通 commit 自动升版或打 tag。

建立人工候选试用与批准证据，再实现 `prev-* → prev.yangtzeu.work` 和 `release-* → yangtzeu.work`。设置最小权限凭据、隔离数据/进程、并发顺序、健康检查、回滚和审计。正式切换前重新获取增量并做恢复演练。

需要用户补充确认的主要事项集中一次问清：首次版本及验收人、日常 prev 更新触发方式、@ 是展示还是 tag、整站各模块最终路径、同机/异机隔离资源、身份认领与旧私有数据去留。不要重复询问已确认的组件库、两个域名、main 和人工发版要求。

### 13.6 最终验收矩阵

| 工作 | 必须看到的证据 |
|---|---|
| 数据页面 | 浏览器真实读取极客班数据；无上游示例残留混入；错误不假成功 |
| 完整迁移 | 全表/状态/引用对账、幂等重跑、附件安全、备份可恢复、增量明确 |
| 身份 | 游客不能进内部服务；GitHub 登录、退出、账户绑定/切换和角色校验通过 |
| 持久化 | 重启/新浏览器保持已授权写入，前端改 role 无法越权 |
| Hub/扩展 | 公开页与内部入口分清，论坛/组织管理/额外服务按合同接入 |
| 视觉 | 用户参考风格真实落地的桌面/手机页面和素材来源记录 |
| 预发布 | 正确域名/环境/版本，测试写入不污染生产，不能读取生产会话 |
| 正式发布 | 已人工试用准确产物；tag/SHA/摘要一致；部署和回滚有记录 |
| 工程交接 | 新人克隆拿到工具源码；私有数据另行受控传递；不能靠本机遗漏文件 |

## 14. 接手命令与边界

下列命令供接手者在完成规范阅读并确认授权后使用。除只读交接核对外，本次没有替接手者执行安装、启动、迁移或发版。

### 14.1 只读定位和状态

```bash
cd /Users/crosery/work_file/geek_main
git status --short
git branch --show-current
git rev-parse HEAD
git tag --list
git check-ignore -v scripts/forum-migration/prepare.py

node scripts/local-preview.mjs status
node scripts/forum.mjs status
```

项目隔离 Node 22 在：

```text
.tools/node-v22.23.2-darwin-arm64/bin/node
.tools/node-v22.23.2-darwin-arm64/bin/pnpm
```

论坛 Node 前期使用 `/opt/homebrew/bin/node`，论坛包管理在 `.tools/pnpm11/package/bin/pnpm.cjs`。若 shell 没有 node/pnpm，先选已确认的本机工具链；不修改全局版本，不混用两套 node_modules/SQLite ABI。

### 14.2 原始备份核验

```bash
python3 scripts/forum-migration/verify.py \
  --snapshot .tools/forum-migration/20260913-initial \
  --archive-sha256 a5f30455530251d7d2347808632b049fcb6147d68e548e52331e3a393a835aac
```

此命令读取私有备份但只打印统计，属于授权的数据交付核验，不放进普通 CI。`immutable=1` 只用于冻结独立备份，不能用于正在写的线上 WAL 数据库。

### 14.3 测试、构建和文档

```bash
pnpm check
pnpm test
pnpm build
pnpm forum:check
pnpm forum:generate
pnpm verify
pnpm test:e2e
pnpm forum:verify

python3 -m unittest discover -s scripts/forum-migration -p 'test_*.py' -v

node scripts/docs-index.mjs
node scripts/docs-index.mjs --check
node scripts/check-docs.mjs
```

普通 CI 测试用虚构夹具；不能让其读取本机真实备份。`forum:generate` 静态输出目前仍是演示站能力，不允许直接作为正式内部社区上传。

### 14.4 管理本机服务与离线发版规划

```bash
node scripts/local-preview.mjs start
node scripts/local-preview.mjs stop
node scripts/forum.mjs start
node scripts/forum.mjs stop
pnpm preview:local

pnpm release:plan --help
pnpm check:environments
```

启停会影响本机预览，核心 stop 清空自己的内存数据；先核对实例，不广泛 pkill。发版规划器不创建 tag、不授权发布。本次未提供一键生产发布命令，因为真实审批、部署适配和新论坛后端都没有完成。

## 15. 重要文件与证据导航

| 内容 | 位置 |
|---|---|
| 根 AI 入口 | [AGENTS.md](../../AGENTS.md) |
| 规范总入口 | [docs/README.md](../README.md) |
| 当前架构 | [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) |
| 当前论坛边界 | [forum.md](../modules/forum.md) |
| 安全与未完成保障 | [SECURITY.md](../architecture/SECURITY.md) |
| 实际技术栈 | [STACK.md](../design/STACK.md) |
| UI 设计与组件选择 | [DESIGN.md](../design/DESIGN.md)、[Tuffex 政策](../components/tuffex/USAGE-POLICY.md) |
| 原仓接入决策 | [ADR-0003](../decisions/0003-adopt-tuff-forum.md) |
| 原始备份详情 | [FORUM-DATA-CAPTURE.md](../ops/FORUM-DATA-CAPTURE.md) |
| 本机服务 | [LOCAL-PREVIEW.md](../ops/LOCAL-PREVIEW.md)、[TUFF-FORUM.md](../ops/TUFF-FORUM.md) |
| 发布规则 | [RELEASES.md](../conventions/RELEASES.md) |
| CI/CD 待实现设计 | [CICD.md](../ops/CICD.md) |
| 环境机器合同 | [environments.json](../../deploy/environments.json) |
| 旧整改历史 | [NORMALIZATION.md](../reviews/NORMALIZATION.md) |
| 组件文档库验收 | [TUFFEX-DOCS.md](../reviews/TUFFEX-DOCS.md) |
| 原仓接入阶段验收 | [TUFF-FORUM-ADOPTION.md](../reviews/TUFF-FORUM-ADOPTION.md) |
| 备份与发布规范阶段 | [DATA-CAPTURE-RELEASE-RULES.md](../reviews/DATA-CAPTURE-RELEASE-RULES.md) |
| 内容/环境最新阶段 | [LOCAL-CONTENT-ENVIRONMENTS.md](../reviews/LOCAL-CONTENT-ENVIRONMENTS.md) |

旧报告是阶段证据，不是最新结论的替代。比如 TUFF-FORUM-ADOPTION 仍有当时“尚未读取旧库”的记录，后来已执行授权备份；LOCAL-CONTENT-ENVIRONMENTS 则没有把已完成测试数字补回正文。本交接明确阶段区别，没有静默重写历史结果。

## 16. 用户关键原话摘录

以下摘录保留约束来源；其余需求的完整拆解见第 1–3 节。

> geek_main里面是统一总入口，项目模块化要清晰，耦合尽量要少

> docs里面存放对应所有项目规范提交规范贡献规范以及模块化开发规范，技术文档规范等

> 我们的论坛完全运用这个的开发规范，学习里面的开发技巧用对应的组件库，然后论坛全线迁移过去。

> 宣传主页所有人可以进来，然后进入我们的内部主站需要去进行登录，支持github的认证登录，预留其他登录的可扩展接口

> 其他额外服务... 可以预留统一规范的接入接口，支持高度DIY扩展

> 总入口的页面要丰富设计，有那种3D设计游戏感

> 后面我们的项目开发完全依赖这个组件库，请你把这个组件库便于ai查询的文档放到docs里面的文件夹方便ai后续的开发。

> 把那个我们极客班的论坛数据全部迁移进来。

> 如果你可以连接的话，你先把这个数据拉到我们本地来。然后后面你帮我写个CICD，就是控制发版。

> 我们的main分支是主代码，我们发版通常是打tag去部署到服务器里面去

> release-版本号是对应的正式环境发版  
> prev-版本号是预发布环境发版

> 版本号必须严格有人试过发版才能去打tag发版更新版本号

> 其他的大部分更新都是基于commit的id在版本号后面@commit-id 代表是对应版本号的那个commit末端，这个只在预发布的时候会进行

> ai进入项目如果它是ai第一步停下任何的事情，必须严格看规范的文档，在我们的docs里面

> prev.yangtzeu.work 是预发布  
> yangtzeu.work 是发布

> 你这任务完成的非常不好，然后把我前面所说的所有内容和细节以及你的一些结果做成一个交接文档，告诉我，并告诉我位置。

## 17. 本次交接范围与最后提醒

本文基于当前对话的用户原话、前期实际工具结果、当前本机源码/规范/报告及只读状态核对形成。不是重新全仓审计，也不声称所有用户要求已交付。

本次实际只新增本交接文档、为 docs 总入口添加导航并重新生成文档索引；没有修改业务代码、迁移脚本、ignore 规则、发布规则、版本或运行服务。

交接核验已通过：文档索引一致性、278 份文档/入口的相对链接与模块指针、git diff --check、18 章及 21 项需求的结构核对。7 个关键业务/发布文件的 SHA-256 与本轮编辑前相同；分支和 HEAD 未变，本地 tag 仍为 0。Mac 文档与下载副本按字节摘要对照；业务测试数字仍保持第 11 节所述历史执行范围，不称为本轮重跑。

接手后的第一交付应由用户最新授权决定。若继续前面的迁移目标，最优先的可见结果是：**让 Mac 本地打开的新论坛确实显示极客班自己的真实内容，并有明确的数据来源和权限边界；在此之前，不再把“有文件、有截图、有测试数字”报告为迁移成功。**
