# task/185/portal_direct_links · crosery · 2026-10-02

负责人：crosery

## 20:04:03 +08:00 · 开工 · #185 · 从 origin/stage 458999fc0c60 建 task/185/portal_direct_links

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 185 portal_direct_links：建分支与 worktree .claude/worktrees/task-185，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 20:27:05 +08:00 · 提交 · #185 · 桌面论坛、GitHub 入口一跳直达，去处只写在 osApps

- 执行者：agent-claude-geek-main-subagent-185（Claude Code 子代理，claude-opus-5-5）
- 做了什么：feat(portal): 桌面论坛与 GitHub 组织入口一跳直达：osApps 的 AppOpen 加 site(link=forumHome/console) 与 external(link=githubOrg)，appLink/followAppLink 解析与打开；YugcOs open() 对站外应用当场打开、不播飞行；启动器去掉与论坛应用重复的「进入论坛首页」，搜索词并进论坛应用；论坛最新窗口「3D 版块」改为直接链到 /forum-3d；JoinUs 回执「去论坛看看」取 appLinkById("forum")；/forum-3d、/github 路由与页面不动；同步 App.tsx 注释、docs/services/web/portal.md「桌面入口直达」、web README 与 DESIGN.md 更新日期；新增 tests/web/portal-os-entries.test.tsx，改 portal-os.test.ts
- 结果：Node 22.23.2：pnpm check exit 0（文档同步 6 组按 PR 核对通过、执行记录 44 条链路、typecheck 通过）；pnpm test 62 文件 945/945 通过；pnpm --filter @yzgc/web build 通过；ego-browser 本机生产构建预检：Dock 论坛落在 https://prev.yangtzeu.work/forum/、后退从往返缓存回到桌面，Dock GitHub 与终端 open github 新标签页打开 https://github.com/Yangtze-University-Geek-Class（正式证据在提交后按该提交的构建重拍）
- 下一步：按本提交构建重拍改前改后证据，写 walkthrough 与 PR 正文

## 21:06:33 +08:00 · 开发 · #185 · 按 bbf9505d9e54 的构建做浏览器走查，拍改前改后证据

- 执行者：agent-claude-geek-main-subagent-185（Claude Code 子代理，claude-opus-5-5）
- 做了什么：bbf9505d9e54 与 origin/stage 458999fc0c60 各自 pnpm --filter @yzgc/web build（改前在 /private/tmp 的临时 detached worktree 里构建，用完 git worktree remove --force）；本机静态服务按 web 容器 nginx 规则提供产物（改后 5340、改前 5341），/forum/ 302 到 https://prev.yangtzeu.work/forum/，/api 与 /auth 转给本机核心服务（5440，buildApp 真实路由、内存库、GitHub 与发信商为假实现）；ego-browser（Chromium）单个 TaskSpace，1440×900、390×844 与 844×390（CDP 模拟 DPR3 触屏，matchMedia hover:none 与 pointer:coarse 已核对命中）逐个入口点击，结束后 task.finish、服务全部停掉
- 结果：改后：1440×900 15 个入口、390×844 12 个、844×390 12 个全部一跳（论坛当前标签页落 https://prev.yangtzeu.work/forum/，GitHub 新标签页落 https://github.com/Yangtze-University-Geek-Class，官网标签页停在桌面），场景页分包请求 0 次；论坛后退均从往返缓存回到桌面、无飞行图标残留；加入我们回执去论坛看看 href=/forum/ 一跳（桌面与竖屏，真实投递，发信请求 0 次）；旧地址 /forum-3d、/github 直接打开正常、控制台无错误；减少动态效果下论坛一跳、加入我们直接进 /join-us。改前：Dock 论坛落 /forum-3d、Dock GitHub 落 /github，要再点一次。证据 12 张与 manifest、walkthrough、PR 正文在本机 /private/tmp/geek-evidence/185/（由主控上传）。未测：Safari、iOS、微信内置浏览器，预发布环境
- 下一步：主控开 PR、上传证据、安排独立审查

## 22:36:09 +08:00 · 返工 · #185 · 审查 F1：按住按键或回车不再连开多个 GitHub 组织标签页

- 执行者：agent-claude-geek-main-subagent-185（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(portal)：YugcOs.tsx 全局按键遇到 event.repeat 直接返回，回车再拦掉默认动作（Dock、便签、菜单按钮不再把每次自动重复变成点击）；Widgets.tsx 桌面图标的回车、空格只认按下去的那一次；tests/web/portal-os-entries.test.tsx 加按住 3、图标与 Dock、便签上重复回车一条；docs/services/web/portal.md「桌面入口直达」补「按住不放只算一次」
- 结果：改前在 bbf9505 的构建上复核：Dock、便签按住回车（1+4 次）各开 5 个新标签页，审查已测按住 3 开 5 个；新测试改前失败（followAppLink 被调 5 次）。改后 Node 22.23.2：tsc -p app/web 通过；vitest portal-os-entries、portal-os 2 文件 25/25 通过；ego-browser 本机预检按住 3、图标、Dock、便签上按住回车都只开 1 个新标签页
- 下一步：返工审查 S1（从论坛后退直接回到桌面）

## 22:36:47 +08:00 · 返工 · #185 · 审查 S1：从论坛后退不走往返缓存时也直接回到桌面

- 执行者：agent-claude-geek-main-subagent-185（Claude Code 子代理，claude-opus-5-5）
- 做了什么：feat(portal)：YugcOs open() 在当前标签页去论坛、控制台前先 navigate('.', { replace: true, state: RESUME_DESKTOP })，Home 重新加载时读到就直接进桌面；往返缓存恢复（pageshow persisted）时清掉 state，之后刷新照常从书桌开始；GitHub 组织开新标签页不记；portal-os-entries 加一条；portal.md 补「从论坛后退直接回到桌面」与「实测」
- 结果：新测试改前失败（state 为 null）。改后 Node 22.23.2：tsc -p app/web 通过；vitest portal-os-entries、portal-os 2 文件 26/26 通过；ego-browser 本机预检：注入 unload 监听让首页进不了往返缓存（Page.backForwardCacheNotUsed：UnloadHandlerExistsInMainFrame），从论坛后退重新请求 /，250ms 时 .pt-home data-state=desktop；走往返缓存时回到桌面、history.state.usr 已清，刷新后 data-state=idle（从书桌开始）
- 下一步：返工审查 S4（新标签页的读屏提示）

## 22:37:26 +08:00 · 返工 · #185 · 审查 S4：新标签页打开的 GitHub 组织给读屏补一句

- 执行者：agent-claude-geek-main-subagent-185（Claude Code 子代理，claude-opus-5-5）
- 做了什么：feat(portal)：osApps 加 NEW_TAB_NOTE「（新标签页打开）」与 opensNewTab；Dock 的 aria-label、桌面图标、菜单栏「前往」、⌘K 结果、便签按钮里给 GitHub 组织补这句（.pt-sr 视觉隐藏）；portal-os-entries 改 GitHub 组织的读屏名称并加一条，portal-os 加 opensNewTab 断言；portal.md 补「读屏提示」
- 结果：Node 22.23.2：tsc -p app/web 通过；vitest portal-os-entries、portal-os 2 文件 27/27 通过；ego-browser 本机预检 1440×900：Dock aria-label 为「GitHub 组织（新标签页打开）」，桌面、「前往」菜单、⌘K 搜 github 的截图与 bbf9505 的截图逐像素比只差时钟与选中状态，补的文字界面上看不到
- 下一步：返工审查 S2、S3（测试写法）

## 22:38:15 +08:00 · 返工 · #185 · 审查 S2、S3：入口测试走别名导入，不再按 JSX 原文断言

- 执行者：agent-claude-geek-main-subagent-185（Claude Code 子代理，claude-opus-5-5）
- 做了什么：test(portal)：vitest.config.ts 给 react-router-dom 设别名（指向 app/web/node_modules），portal-os-entries 改成 import 'react-router-dom'；portal-os.test.ts 回执按钮改断言 appLinkById('forum') 等于论坛首页、源码只认 appLinkById("forum")，去掉匹配 Windows.tsx「3D 版块」JSX 的正则；portal-os-entries 加「论坛最新」窗口渲染后点「3D 版块」进 /forum-3d、「进入论坛首页」直达论坛首页一条；portal.md「单测」一条同步。文档核对：docs/conventions/TESTING.md 不用改——别名只改测试的导入写法，测试范围与命令没变
- 结果：Node 22.23.2：tsc -p app/web 通过；npx vitest run tests/web 19 文件 150/150 通过
- 下一步：按最后一个代码提交重新构建，重拍证据，补走查记录

## 23:10:38 +08:00 · 返工 · #185 · 按 b7ce56d8355e 的构建重做浏览器走查，重拍证据（审查 F2）

- 执行者：agent-claude-geek-main-subagent-185（Claude Code 子代理，claude-opus-5-5）
- 做了什么：b7ce56d8355e 与 origin/stage 458999fc0c60 各自 pnpm --filter @yzgc/web build（改前在临时 detached worktree 里构建，用完 git worktree remove --force）；本机静态服务改后 5340、改前 5341、改后 html no-store 5342，/forum/ 302 到预发布论坛，/api /auth 转本机核心服务 5440（内存库，GitHub 与发信商为假实现）；ego-browser 单个 TaskSpace（225）走三种尺寸的全部入口、按住按键、两种后退、回执、旧地址、减少动态效果、无障碍树，结束后 task.finish，服务全部停掉；证据图注按画面里实际有的内容重写，补横屏改前图（证据 4）与 GitHub 新标签页、回执落点、3D 版块窗口这几帧
- 结果：改后 1440×900 15 个入口、390×844 12 个、844×390 12 个全部一跳，场景页分包请求 0 次；按住 3 与 Dock、便签、图标上按住回车都是 window.open 1 次、标签页 1→2（bbf9505 上 Dock、便签各 5 个）；不走往返缓存的后退 390ms 直接显示桌面（bbf9505 上 3.5s 仍是书桌），走往返缓存时回到桌面、刷新从书桌开始；回执去论坛看看一跳（发信请求 0 次）；旧地址正常；无障碍树里 GitHub 组织带「（新标签页打开）」。证据 19 个（含 1 个 mp4）、manifest、walkthrough、PR 正文在本机 /private/tmp/geek-evidence/185/。pnpm check exit 0；pnpm test 62 文件 949/949；pnpm --filter @yzgc/web build 通过。未测：Safari、iOS、微信内置浏览器，预发布环境
- 下一步：主控把 walkthrough 发到 #185、开 PR、补「PR」「审查」记录，安排对返工增量的复核
