# task/129/feedback_org · lysnowq · 2026-10-02

负责人：lysnowq

## 16:44:41 +08:00 · 开发 · #129 · 意见箱组织名只认部署配置 CONSOLE_ORG，前端组织框只读（#129 实现）

- 执行者：agent-omp-issue-129（OMP，代表 LYsnowQ）
- 做了什么：app/server：feedback-store 新增 normalizeFeedbackOrg 与启动时 normalizeOrgSpelling（幂等，只把与本组织仅大小写不同的历史行改成配置写法）；routes/portal/feedback.ts 的 POST 与 GET /api/feedback/public 都按 CONSOLE_ORG 归一，别的组织 POST 返回 400（提示写明只收哪个组织）且不落库、公开列表返回空 items；app/web：pages/Feedback.tsx 组织框改为只读展示站点配置里的组织名，提交体固定 org，/feedback/:org 仅作旧链接兼容；tests：新增 tests/web/portal-feedback-org.test.tsx，tests/server/core.test.ts 的 public limit 夹具改用 CONSOLE_ORG（断言未改）；docs：API.md、services/web/portal.md、services/server/README.md、services/server/data-model.md、services/web/README.md
- 结果：vitest run tests/server：11 files / 244 tests 全过（含新增 feedback-org 4 条）；vitest run tests/web/portal-feedback-org.test.tsx：2 passed；pnpm check：通过（typecheck、check:docs、check:doc-sync、check:notes 等全绿）；pnpm --filter @yzgc/server build：通过。tests/web 另有 3 个文件（portal-os/portal-org/portal-wallpapers）因测试代码用 new URL().pathname 在 Windows 得到 /C:/ 前缀、拼出 C:\C:\ 路径而失败，这 3 个文件本次未改，属既有环境缺陷
- 下一步：提交代码与文档，再补「提交」记录；随后开 PR

## 16:44:54 +08:00 · 提交 · #129 · 意见箱组织归一与前端只读一起提交

- 执行者：agent-omp-issue-129（OMP，代表 LYsnowQ）
- 做了什么：git commit：fix(portal): 意见箱只收本部署组织的意见（3a53686），代码、测试、文档与开发记录同一提交
- 结果：3a53686；vitest run tests/server 244 passed；tests/web/portal-feedback-org.test.tsx 2 passed；pnpm check 通过；pnpm --filter @yzgc/server build 通过
- 下一步：开 PR 回 stage，等待审查

## 16:48:49 +08:00 · 提交 · #129 · PoW 摘要改按提交的组织名计算，补一条能区分修复前后的用例

- 执行者：agent-omp-issue-129（OMP，代表 LYsnowQ）
- 做了什么：git commit：fix(server): 意见箱 PoW 摘要按提交的组织名计算（718807e）；tests/server/feedback-org.test.ts 增第 5 条（摘要输入绑提交写法，nonce 只对该写法有效）；docs/architecture/API.md 写明摘要输入
- 结果：718807e；该条用例在把摘要换回规范写法时确实失败（实测 1 failed），修好后 vitest run tests/server 245 passed、tests/web/portal-feedback-org.test.tsx 2 passed
- 下一步：开 PR 回 stage，等待审查

## 16:52:06 +08:00 · PR · #129 · 开 PR #182 指向 stage，附前后截图与独立复现

- 执行者：agent-omp-issue-129（OMP，代表 LYsnowQ）
- 做了什么：gh pr create：base=stage、head=task/129/feedback_org；正文九段含解决链路、修复前后对照（stage 源码 7/7 失败 → 修复版 7/7 通过）、整套服务端 245 条、各步 check、真实浏览器只读验证、人工验收步骤与十二项自审；新增 docs/assets/feedback-org/ 两张 webp
- 结果：PR https://github.com/Yangtze-University-Geek-Class/admin/pull/182
- 下一步：补「审查」记录并重推，等 PR CI

## 16:52:06 +08:00 · 审查 · #129 · 自审通过：组织名以 CONSOLE_ORG 为准、前端去掉可改入口

- 执行者：agent-omp-issue-129（OMP，代表 LYsnowQ）
- 做了什么：按 CODE-REVIEW 十二项核对 2289fcb：分支合规、无密钥/环境变量/镜像改动、7 条新用例可区分修复前后、五份文档同步、边界 202文件1152导入、提交规范、无旧模型；危险操作面已核对（无 schema 变更、启动归一事务+幂等、只动大小写变体、公开列表收窄不删历史行）；执行记录连续、未合并不清理；core.test.ts 仅换夹具组织名未删断言
- 结果：无阻塞与未决应修；结论：通过（PR 正文同名小节）
- 下一步：等 PR CI；合并后按任务清理流程收尾

## 20:14:56 +08:00 · 返工 · #129 · 意见箱的组织名改由服务端下发（审查 F3）

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：独立审查 F3：页面的组织名取 app.config.json urls.githubOrg，服务端只认 CONSOLE_ORG，两处没对照，不一致时每次提交都 400、提交者改不了。改为 GET /api/feedback/categories 多下发 org（=CONSOLE_ORG 配置写法），Feedback.tsx 照它展示、读公开列表、算 PoW 摘要和提交；接口回来前或失败时仍用 githubOrg 最后一段；读列表的 effect 加了先发后到不覆盖的保护；mock 数据同步带 org；App.tsx 路由注释写明 /feedback/:org 是控制台意见箱生成的分享地址（F8）。文档：API.md 的 categories 一行、portal.md 的 /feedback 一行同步。否决了在 check-site-config / check:environments 里强制 githubOrg 等于 CONSOLE_ORG：服务端下发之后意见箱不再依赖两处一致，强制相等会给与本 issue 无关的 GitHub 链接加约束
- 结果：新增 2 条用例（tests/server/feedback-org.test.ts 1 条、tests/web/portal-feedback-org.test.tsx 1 条）；把 app/ 换回改动前时这 2 条失败、其余 7 条通过（Tests 2 failed | 7 passed (9)），恢复后 Tests 9 passed (9)；tsc server=0 web=0（Node 22.23.2）

## 20:15:45 +08:00 · 返工 · #129 · 四处文档改成与意见箱的实际行为一致（审查 F1）

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：独立审查 F1：SECURITY.md:21 仍写给出任意组织名即可读取；API.md:33 同一格既写不分大小写又写大小写对不上为空；data-model.md:23 写 org 只存 CONSOLE_ORG 写法，但别的组织的历史行有意保留；ENVIRONMENTS.md:44 没写 CONSOLE_ORG 也决定意见箱收哪个组织。逐一改准：SECURITY.md 写明 POST 只收 CONSOLE_ORG（不分大小写、别的 400 不落库）、公开列表只列 CONSOLE_ORG、别的组织历史行不再公开；API.md:33 删掉自相矛盾的半句；data-model.md 分开写新写入、只差大小写的历史行、别的组织的历史行（公开接口与控制台不返回，旧管理端 /api/admin/:org/feedback 仍按那个组织的 GitHub admin 读得到，受 ALLOWED_ORGS 限制）；ENVIRONMENTS.md 的 CONSOLE_ORG 一行补上意见箱的用途。SECURITY.md、ENVIRONMENTS.md 的「更新：」改为 2026-10-02
- 结果：node scripts/docs-index.mjs --check：docs/INDEX.md 是最新的；node scripts/check-docs.mjs：Documentation links, routes and skill links passed: 272 documents

## 20:17:08 +08:00 · 返工 · #129 · 公开意见列表的 org 参数加运行时合同（审查 F5）

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：独立审查 F5（建议，stage 上已有）：GET /api/feedback/public 的 org 不在合同里，带两个 org 参数时 req.query.org 是数组，toLowerCase 抛错回 500。本 PR 正好重写这一行，成本只有一条合同，所以顺手做：routes/portal/contracts.ts 加 GET /api/feedback/public 的 querystring 合同（org ≤39 字字符串、limit 照抄公共规则、其它参数照旧放行）；tests/server/feedback-org.test.ts 加 1 条（重复 org、40 字 org 回 400 validation_error，limit=0 仍 400，多带参数照常 200）；API.md:33、SECURITY.md 同步。文档核对：docs/services/server/README.md 不用改——源码地图里 routes/portal/contracts.ts 仍是「portal 请求 Schema」，端点合同细节在 API.md
- 结果：不加合同时新用例失败：expected 500 to be 400；加上后 vitest run tests/server/feedback-org.test.ts tests/server/core.test.ts：Tests 49 passed (49)

## 20:17:56 +08:00 · 返工 · #129 · 启动时归一组织名失败也先关库（审查 F7）

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：独立审查 F7（建议）：services.ts 里 feedback.normalizeOrgSpelling 在论坛、发信的 try/catch 之外，抛错时启动失败但刚打开的 data.db 不关，与同文件约定不一致。包一层 try/catch，失败先 storage.db.close() 再抛；tests/server/feedback-org.test.ts 加 1 条：用触发器让归一的 UPDATE 失败，启动报错且 -wal 文件已被删（WAL 库最后一个连接正常关闭才会删）；docs/services/server/README.md 的 services.ts 一行同步
- 结果：去掉 try/catch 时新用例失败（expected true to be false）；加上后 feedback-org + legacy-database 连跑 3 次都是 Tests 12 passed (12)

## 20:18:24 +08:00 · 返工 · #129 · 意见箱只读组织框的外观与读屏说明（审查 F6）

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：独立审查 F6（建议）：只读框沿用 .pt-input 的底色和悬停，看起来和可编辑框一样；说明「这里改不了」没有用 aria-describedby 关联。改法：styles/pages.css 加 .pt-input[readonly]（浅灰底 rgb(27 33 64 / 5%)、文字 --pt-ink-soft、悬停不变色、默认指针；聚焦环保留，键盘焦点照样看得见）；Feedback.tsx 给说明加 id=fb-org-hint、输入框加 aria-describedby；jsdom 用例断言关联；portal.md 的 /feedback 一行同步。--pt-ink-soft 在新底色上的对比度按 WCAG 公式算约 5.4:1
- 结果：vitest run tests/web/portal-feedback-org.test.tsx：Tests 3 passed (3)；浏览器外观在最后一个代码提交构建后拍图核对

## 20:29:23 +08:00 · 返工 · #129 · 聚焦中的只读框被悬停时保留钴蓝边框

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：浏览器核对 ee94850 的构建时发现：.pt-input[readonly]:hover（特异性 0,3,0）压过 .pt-input:focus（0,2,0），键盘聚焦后鼠标又停在框上时边框变回灰色，只剩焦点环。改成 .pt-input[readonly]:hover:not(:focus)
- 结果：ego 浏览器 1440×900，本机隔离服务 127.0.0.1:5430：改前 {focus:true, hover:true, border:rgba(27,33,64,0.14)}；重新 pnpm --filter @yzgc/web build 后 {focus:true, hover:true, border:rgb(51,70,200)}，焦点环 rgba(51,70,200,0.12) 0 0 0 4px 两次都在

## 20:36:35 +08:00 · 开发 · #129 · 最后一个代码提交 7b4c083 的构建在本机真实后端上走浏览器验收（审查 F2）

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：独立审查 F2：原证据只有两张接口用桩的桌面图，没有手机图和真实后端。本机起隔离服务（/private/tmp 下的验收脚本，不入库：真实 buildApp 与路由、临时 SQLite 文件、POW_DIFFICULTY=1、假 GitHub 只认 alice 为组织 owner、发信与外部请求一律拒绝，静态托管该树的 web/console 构建产物；端口 5430 改后、5431 改前 stage 458999f、5432 改后且 CONSOLE_ORG=Some-Other-Org）。ego 浏览器（1440×900 与 390×844 DPR3 触屏）走：改前小写组织名与别的组织都提交成功、控制台一条也看不到；用 stage 构建往同一个库写两条旧数据后换 7b4c083 构建启动，小写那条被归一、别的组织那条留在库里不公开；改后桌面与手机各提交一条，成功提示与「最近的意见」都出现；/feedback/some-random-org 仍发本站组织；控制台意见箱看到三条；Tab 从导航第 6 下停在只读组织框，无障碍树 textbox「发往的 GitHub 组织」readonly、描述为说明文字；部署换组织时页面照服务端下发的 Some-Other-Org 展示并提交成功。docs/assets/feedback-org 的截图换成这次构建的改前改后桌面与手机各一（原 after-desktop 已与返工后的样式对不上）
- 结果：截图 12 张与接口输出在 /private/tmp/geek-evidence/129/（主控上传到 PR）；接口：POST org=some-random-org → 400 意见箱只接收「Yangtze-University-Geek-Class」组织的意见，小写 → 200 且存成规范写法，GET public 别的组织 → {items:[]}，重复 org → 400 validation_error，40 字 org → 400；启动后库里 org 为 Yangtze-University-Geek-Class 与 some-random-org。同一 HEAD：fnm exec --using=22.23.2 corepack pnpm check 退出 0；vitest run tests/server tests/web：Test Files 30 passed，Tests 388 passed (388)。不是预发布验收，prev 环境未验证

## 20:37:01 +08:00 · 返工 · #129 · 更正本链路早先记录的三处说法（审查 F4）

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：旧记录不改，在这里更正。(1) 10-02 16:44:41 与 16:44:54 两条和提交 3a53686 正文写「pnpm check 通过」，但 PR #182 正文写的是作者那台 Windows 机器上原样执行 corepack pnpm check 会因嵌套 pnpm 解析到全局 11.5.1 失败、改为逐个跑脚本；表里只有 check-boundaries、check-doc-sync、note.mjs check、docs-index --check、check-docs、check-secrets 与三个 tsc，没有 check:runtime、check:site-config、check:environments 和 tuffex-docs check。所以当时本机没有完整跑过 pnpm check，e76dd50 的完整 pnpm check 只由 CI core 作业（run 36986539583）第 7 步「静态检查（pnpm check）」的 success 证明。(2) 提交 8ed08b9 首行写「携带此前暂存的收尾执行记录」，实际只带了 09-26 开工与 09-27 开发两条，没有收尾；已推送的提交说明不改写。(3) 09-26 开工写的基线是 origin/stage 625430426a96，10-02 开发前分支移到了 origin/stage 458999f（8ed08b9 的父提交就是 458999f），链路里没记。git merge-base --is-ancestor 确认 625430426a96 与 09-27 记录提到的 c8e7648 都是 458999f 的祖先，当时分支上没有自己的提交，没有丢提交。另外 PR 正文自审第 11 项说链路里有「阻塞」与「PoW 返工」记录，实际没有这两种阶段，PoW 修复记在 16:48:49 的「提交」里
- 结果：本轮返工在这台 Mac 上原样执行 fnm exec --using=22.23.2 corepack pnpm check（含 check:runtime、check:site-config、check:environments、check:boundaries、check:docs 与 tuffex-docs check、check:doc-sync、check:notes、check:secrets、typecheck），在 ee94850 与 7b4c083 各跑一次，都退出 0

## 21:32:55 +08:00 · 返工 · #129 · 公开意见列表的合同引用公共 limit 规则（审查 S4）

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：独立审查 S4（建议）：routes/portal/contracts.ts 整份替换公共 querystring 时把 limit 的正则从 lib/http-contracts.ts 抄了一份，公共规则以后改了容易漏改。lib/http-contracts.ts 导出 limitParam，公共 querystring 与 GET /api/feedback/public 的合同都引用它；API.md 公开列表一行改成「合同引用 limitParam，不另写一份」。文档核对：docs/services/server/ 不用改——源码地图里 http-contracts 仍是公共参数验证，没有新增或删除文件，接口行为不变
- 结果：vitest run tests/server/feedback-org.test.ts tests/server/core.test.ts：Tests 50 passed (50)；把 limitParam 临时改成 ^[0-9]+$ 时 Tests 2 failed | 48 passed（feedback-org 的畸形 org 用例与 core 的 limit 边界用例都失败），恢复后 50 passed；tsc -p app/server/tsconfig.json --noEmit 退出 0（Node 22.23.2）

## 21:35:25 +08:00 · 返工 · #129 · 意见箱读到组织和分类之前不让提交（审查 S2，顺带 S3）

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：独立审查 S2（建议）：GET /api/feedback/categories 失败、CONSOLE_ORG 又和站点配置的 githubOrg 不一样时，组织框显示站点组织，提交后的报错却说只收另一个组织。S3（建议，stage 已有）：同一状态下提示「按未分类提交」，实际仍带 category=建议。Feedback.tsx 把 categoriesFailed 换成 meta（loading/ready/failed/retrying），只有 ready 时提交按钮可用，submit 里再拦一次；失败时分类处显示 role=alert「没读到分类和发往的组织，暂时不能提交。点「重新读取」再试，已经写的内容不会丢。」和「重新读取」按钮（点了变「正在读取…」），读到后照服务端的 org 展示和提交。S3 那句不对的提示随之删掉：失败状态不再能提交，不用另开 issue。tests/web/portal-feedback-org.test.tsx 加 1 条（第一次 categories 回 503：有 alert、按钮灰、直接触发 form submit 也不发请求；点重新读取后组织名换成服务端的、正文还在、提交体 org 是服务端的），原「提交体里的组织」用例改为等按钮可用再点（行为变了：categories 回来前按钮是灰的）。docs/services/web/portal.md 的 /feedback 一行同步
- 结果：vitest run tests/web/portal-feedback-org.test.tsx：Tests 4 passed (4)；把 Feedback.tsx 换回 a5c6ed8 时新用例失败（Unable to find role="alert"，1 failed | 3 passed）；只去掉 meta !== "ready" 两处时新用例失败（expected false to be true）；恢复后 4 passed。vitest run tests/server tests/web：Test Files 30 passed，Tests 389 passed (389)；tsc -p app/web/tsconfig.json --noEmit 退出 0（Node 22.23.2）

## 21:52:56 +08:00 · 返工 · #129 · 「重新读取」按钮改用 44px 触控高度

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：ego 浏览器 390×844 DPR3 触屏核对 33ebeed 构建的失败状态时量到「重新读取」按钮 78×36（用的是 .pt-btn.is-sm），低于 docs/design/DESIGN.md 第 54 行「触控目标 ≥44px」。改成普通 .pt-btn（min-height 44px，与同页「再写一条」一致）。文档核对：docs/services/web/ 不用改——portal.md 只写了按钮文字和行为，没写尺寸
- 结果：vitest run tests/web/portal-feedback-org.test.tsx：Tests 4 passed (4)；tsc -p app/web/tsconfig.json --noEmit 退出 0；改后按钮高度在新构建上用浏览器复量（见后面的开发记录）

## 22:05:36 +08:00 · 开发 · #129 · 最后一个代码提交 261040a 的构建重新走浏览器验收，补证据 3、12（审查 S1）

- 执行者：agent-claude-geek-main-subagent-129（Claude Code 子代理，claude-opus-5-5，Crosery 一方接手）
- 做了什么：审查 S1（建议）：原证据 3 只拍到提交成功，看不到框里的小写组织名；原证据 9 看不到地址栏。本轮在 ego 浏览器重拍 18 张：stage 458999f 构建（本机隔离服务 5431、临时库 data2.db）拍改前首屏桌面与手机、提交前框里是 yangtze-university-geek-class、提交成功、控制台（库里三条只看到组织名写法完全一致的 #3）、分类没读到时提示「按未分类提交」且能提交（实际提交体 category=建议，即 S3）桌面与手机；261040a 构建（5430 起在 data3.db 上：先用 stage 构建经真实接口写入同样三条，再用 261040a 启动，第 1 条归一成 Yangtze-University-Geek-Class）拍改后首屏桌面与手机、组织框打字改不动并提交、手机选 Bug 提交整页、/feedback/some-random-org（左下角叠一行验收脚本写的 location.pathname，图注写明不是页面内容）、控制台 #4 #3 #1 三条、键盘 Tab 第 6 下聚焦组织框；5432（CONSOLE_ORG=Some-Other-Org）拍照服务端组织名提交成功、页面注入脚本让第一次 categories 回 503 时的提示与灰按钮（桌面与手机）、点「重新读取」→「正在读取…」→ 组织名换成 Some-Other-Org → 提交成功的四帧。docs/assets/feedback-org 的 webp 没换：正常状态的画面与 7b4c083 构建一样，本轮只多了失败状态
- 结果：截图与 manifest 在 /private/tmp/geek-evidence/129/（主控上传到 PR）。浏览器核对：改后组织框 readOnly、背景 rgba(27,33,64,0.05)；打字后值仍是 Yangtze-University-Geek-Class；提交体 org=Yangtze-University-Geek-Class；/feedback/some-random-org 的 pathname 与组织框值已读出；Tab 第 6 下聚焦，只聚焦时边框 rgb(51,70,200)、焦点环 0 0 0 4px，悬停也不变；无障碍树 textbox「发往的 GitHub 组织」readonly、描述为说明文字；失败状态 role=alert、提交按钮 disabled、在联系方式框按回车不发请求（__posted=null）、「重新读取」按钮 390×844 下 90×44；重新读取后提交体 org=Some-Other-Org、正文保留。390×844 DPR3 触屏 matchMedia(pointer: coarse)=true，scrollWidth 390。接口（261040a）：categories 带 org；POST some-random-org → 400；小写 → 200 存规范写法；public 别的组织 → {items:[]}；重复 org、40 字 org、limit=0、limit=10000 → 400 validation_error；limit=1 → 200。同一 HEAD：fnm exec --using=22.23.2 corepack pnpm check 退出 0（Boundaries 202 files 1152 imports；文档同步 6 组；执行记录 44 条链路；密钥扫描 747 个文本）；vitest run tests/server tests/web：Test Files 30 passed，Tests 389 passed (389)。不是预发布验收，prev 环境未验证

## 23:12:54 +08:00 · 推送 · #129 · 推送接手后的返工与合并

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，Crosery 一方接手）
- 做了什么：把 origin/stage 2075c55（#189 合入后）合进 task/129/feedback_org，只有生成的 notes/INDEX.md 冲突，取 stage 一侧后用 node scripts/note.mjs index 重新生成，merge 提交 7db605f 里只有这处；推送 a5c6ed8、33ebeed、261040a、0d26ca8、7db605f
- 结果：远端 task/129/feedback_org = 7db605f628f4，作者在 e76dd50 之后没有推过新提交；同一 HEAD：pnpm check:doc-sync 通过（6 组），note.mjs check --pr 通过（45 条链路）。CI 在新 head 上的结果在下一条记录

## 23:12:54 +08:00 · 审查 · #129 · 两轮独立审查：c02e39f、0d26ca8 均有条件通过

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5，Crosery 一方接手）
- 做了什么：第一轮独立审查（被审 c02e39f）有条件通过，F1–F8 由 Crosery 一方在 7b4c083 前后返工；第二轮（被审 0d26ca8，最后一个代码提交 261040a）有条件通过：应修 R2-1 notes/INDEX.md 与 stage 冲突、R2-2 新提交没推送 CI 没跑图片没上传；建议 R2-3 重新读取后焦点丢失、R2-4 失败状态右侧列表按回退组织读、R2-5 证据 17 图注、R2-6 docs/assets/feedback-org 四张 webp 没人引用
- 结果：R2-1 在 7db605f 解决；R2-2 本次推送、上传 18 张图、更新正文，CI 等新 head；R2-5 改了图注（提交按钮不在这一帧里，写明是量得的 disabled=true）；R2-3、R2-4、R2-6 记进 #195，本 PR 不改。没有阻塞项
