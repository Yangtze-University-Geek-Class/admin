# task/186/mobile_touch_sizing · crosery · 2026-10-02

负责人：crosery

## 20:04:35 +08:00 · 开工 · #186 · 从 origin/stage 458999fc0c60 建 task/186/mobile_touch_sizing

- 执行者：agent-claude-geek-main-1002（Claude Code，claude-opus-5-5）
- 做了什么：node scripts/task.mjs start 186 mobile_touch_sizing：建分支与 worktree .claude/worktrees/task-186，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 21:39:37 +08:00 · 开发 · #186 · 改前实测与定位：菜单栏隐藏规则失效、窗口滚出屏幕

- 执行者：agent-claude-geek-main-subagent-186（Claude Code 子代理，claude-opus-5-5）
- 做了什么：在 458999f 的生产构建（本机静态服务 5390，假 /auth/me）上用 ego-browser 量 390×844 DPR3 触屏、844×390 横屏：菜单栏各按钮、时钟、Dock、桌面图标、窗口按钮的 getBoundingClientRect 与 scrollWidth/clientWidth
- 结果：390×844：documentElement.scrollWidth=clientWidth=390，但菜单栏 scrollWidth 431；系统菜单 18×26（校徽被挤没）、前往/窗口/帮助各 31×47.6（一字一行，≤860px 的隐藏规则被 .pt-mb button 的优先级盖掉）、时钟右缘 431.4；窗口三色按钮 12×44；便签收起 30×44；Dock 64×76、图标 87.5×98 已够大。触屏点图标在模拟器里一下就开（matchMedia hover:none），但带触屏的笔记本（hover:hover）要双击，手指连点两下会打开三次。横屏 844×390 先滚桌面再开终端，窗口标题栏在 y=-66.5，关闭按钮在屏幕外

## 21:39:37 +08:00 · 提交 · #186 · 手机和触屏上菜单栏、窗口按钮做到手指尺寸，图标点一下就开

- 执行者：agent-claude-geek-main-subagent-186（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(portal): 手机和触屏上菜单栏与窗口按钮做到手指尺寸，图标点一下就开（Refs #186，父提交 458999f）；改 styles/os.css（≤860px 或 pointer:coarse 的 44px 规则、≤520px 收起前往/窗口/应用名/账号名/窗口路径、≤359px 收起时钟）、components/os/Widgets.tsx（按 pointerType 判断手指、连点只开一次、便签末行触屏文案）、Windows.tsx（窄屏把窗口滚进可见区域）、YugcOs.tsx（菜单按钮加 pt-mb-go/window/help 类名，不动入口逻辑）；新增 tests/web/portal-desktop-icons.test.tsx；同步 docs/services/web/portal.md、README.md 更新日期与 docs/design/DESIGN.md 的 44px 例外说明
- 结果：新测试先在旧代码上跑：7 项 3 项失败（触屏笔记本单击不开、连点打开 3 次、便签文案），改后 7/7 通过；pnpm exec vitest run tests/web/ 19 个文件 144 项通过；pnpm check 退出 0（文档同步 6 组通过、执行记录 44 条链路通过、typecheck 通过）；pnpm --filter @yzgc/web build 通过；全量 pnpm verify 与 e2e 未在本机跑

## 22:03:28 +08:00 · 开发 · #186 · 37ebf9e 构建的浏览器验收与证据

- 执行者：agent-claude-geek-main-subagent-186（Claude Code 子代理，claude-opus-5-5）
- 做了什么：pnpm --filter @yzgc/web build（HEAD 37ebf9e747a5）后用本机静态服务 5391 托管 dist（非文件路径回落 portal 入口，/auth/me 为假服务），改前用 458999f 构建（5390）与正式站 v0.1.0（d4a24749d077，portal 到 458999f 无改动）；ego-browser 一个 TaskSpace（geek #186 验收，已 finish）：390×844 DPR3 触屏、844×390 横屏、360×800、320×568、1024×768 触屏与 1280×800、1440×900 鼠标，量菜单栏、下拉菜单、启动器、Dock、桌面图标、便签、窗口按钮的 getBoundingClientRect 与 scrollWidth/clientWidth，录触屏点一下即开与鼠标单击选中双击打开的逐帧图；证据 16 个文件在 /private/tmp/geek-evidence/186/
- 结果：390×844 改前菜单栏 scrollWidth 431（窗口在前台时 470）、时钟右缘 431.4、系统菜单 18×26、前往/窗口/帮助 31×47.6、窗口按钮 12×44；改后菜单栏 45px 高 scrollWidth=clientWidth=390、时钟一行右缘 386、菜单栏按钮与下拉项、启动器行、便签收起、窗口按钮都 ≥44×44，Dock 64×76.4、图标 87.5×98.4。844×390 改后时钟右缘 840，先滚再开终端窗口标题栏在 y=53（改前 -66.5）。360 宽时钟右缘 356，320 宽时钟收起。1280×800、1440×900 鼠标下 178/232 个元素的位置尺寸样式改前改后一致，1280 截图逐像素相同，1440 去掉时钟后最大差 2/255。触屏 tap：pointerdown:touch→click:touch:1，一下打开；鼠标：单击只选中，双击打开。Chromium 模拟里合成的连点是两次 detail=1 的 click、没有 dblclick，改前改后都只跳转一次（history +1），连点只开一次只由单测证明，真机未验证

## 22:56:06 +08:00 · 返工 · #186 · 按审查 F3：最小化的窗口真正藏起来

- 执行者：agent-claude-geek-main-subagent-186（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(portal) 提交（Refs #186，父提交 7020f72）：styles/os.css 加 .pt-win[hidden] { display: none }，压过 .pt-win 的 display: flex；docs/services/web/portal.md「界面规则」补一条最小化与恢复的说明。审查发现最小化后窗口 hidden=true 但 computed display=flex、还画在原处挡着图标，从 b3c9f7c 起就这样，本 PR 把最小化按钮做成 44×44、portal.md 也写了从最小化恢复会滚回，所以在本 PR 修
- 结果：ego-browser 预查（未提交的构建，127.0.0.1:5392）：1440×900 鼠标双击「关于极客班」后点最小化，窗口 hidden=true、display=none、宽 0，菜单栏回到「桌面」，「组织架构」图标中心 elementFromPoint 命中图标；点 Dock「关于极客班」恢复为 display=flex；390×844 最小化后原按钮位置命中桌面图标，点图标恢复后标题栏 y=53。最终证据在本链路后面的验收记录里

## 22:56:43 +08:00 · 返工 · #186 · 按审查 F2：已在前台的窗口再打开一次，窄屏也滚回窗口顶上

- 执行者：agent-claude-geek-main-subagent-186（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(portal) 提交（Refs #186，父提交 eb64a68）：components/os/Windows.tsx 里把桌面滚回窗口顶上的 effect 依赖加上 win.z（openWindow 对已在前台的窗口只把 z 加一；focusWindow 不改前台窗口的 z，点窗口里面不会滚）；新增 tests/web/portal-window-scroll.test.tsx（4 项）；docs/services/web/portal.md 写明再打开也会滚回并指向单测
- 结果：新单测在去掉 win.z 的代码上 1 项失败（expected 444 to be 56），加上后 4/4 通过；ego-browser 预查（未提交的构建）：844×390 触屏先点「终端」（标题栏 y=53），把 .pt-dt 滚到底（scrollTop 444，标题栏 y=-391），再点 前往 → 终端，scrollTop 回到 0、标题栏 y=53

## 22:57:14 +08:00 · 返工 · #186 · 按审查 F1/F4/F5/F6：竖屏按钮补名字、触屏不留悬停底色、窗口标题靠左、文档数字改对

- 执行者：agent-claude-geek-main-subagent-186（Claude Code 子代理，claude-opus-5-5）
- 做了什么：fix(portal) 提交（Refs #186，父提交 5bad80f）：YugcOs.tsx 搜索按钮 aria-label=搜索、头像按钮 aria-label=账号 <登录名>（F1，≤520px 收起账号名后头像按钮没有名字是本 PR 带来的回退，搜索按钮 ≤860px 无名字是改前就有的）；styles/os.css 菜单栏按钮悬停底色放进 @media (hover: hover)，窄屏/触屏下搜索按钮悬停不铺 44×44 底色、只在能悬停时加深 ::before 的框（F4）；≤520px 标题栏改两列、标题靠左（F5）；DESIGN.md 菜单栏写成 45px（44px 按钮加 1px 底边），portal.md 把搜索框与登录胶囊「仍是原来的大小」改成实测的 28px 高、圆角 8px，补悬停、标题靠左、aria-label 的说明，os.css 注释同步（F6）。文档核对：docs/services/web/README.md 不用改——「更新：」已是 2026-10-02，源码地图里没有新增或改名的文件
- 结果：ego-browser 预查（未提交的构建）：390×844 DPR3 触屏、假 /auth/me 登录，Accessibility.getFullAXTree 里菜单栏按钮依次是 系统菜单 / 帮助 / 搜索 / 账号 zhangsan-yangtze-2026（改前后两个名字为空）；点搜索再按 Esc，:hover 仍为 true，但搜索按钮背景 rgba(0,0,0,0)、::before 只有白底；「关于极客班」窗口标题栏 grid-template-columns 132px 224px，标题从 x=148 开始（三色按钮右缘 142）

## 22:57:30 +08:00 · 返工 · #186 · 按审查 F7：桌面图标单测用 unmount() 卸载第一次渲染

- 执行者：agent-claude-geek-main-subagent-186（Claude Code 子代理，claude-opus-5-5）
- 做了什么：test(portal) 提交（Refs #186，父提交 5aa9141）：tests/web/portal-desktop-icons.test.tsx 的 setup() 一起返回 render 的 unmount，「没有按下事件的 click」那一项用 unmount() 卸载第一次渲染，不再用 remove() 把容器从 DOM 摘掉、留下没卸载的 React 根
- 结果：pnpm exec vitest run tests/web/portal-desktop-icons.test.tsx：7 passed (7)

## 23:37:23 +08:00 · 返工 · #186 · 返工后 42f1220 构建的验证与浏览器验收证据

- 执行者：agent-claude-geek-main-subagent-186（Claude Code 子代理，claude-opus-5-5）
- 做了什么：Node 22.23.2 下跑 pnpm exec vitest run tests/web/、pnpm test、pnpm check、pnpm --filter @yzgc/web build、git diff --check 458999f HEAD；42f1220 的 dist 与返工预查用的构建 diff -rq 相同；本机静态服务 5390（458999f 构建，取自只读 detached worktree /private/tmp/geek-before-186，用完已 git worktree remove --force）与 5391（42f1220 构建），/auth/me 为假服务；ego-browser 一个 TaskSpace（geek #186 验收，id 231，已 finish）在 390×844、844×390、360×800、320×568、1024×768 触屏与 800×600、1280×800、1440×900 鼠标下量尺寸、无障碍树名字、悬停、最小化与滚动，录触屏点一下即开与鼠标单击选中双击打开的逐帧图；证据 23 个文件与 manifest.json、pr-body.md 在 /private/tmp/geek-evidence/186/。文档核对：docs/services/web/README.md 不用改——「更新：」已是 2026-10-02，源码地图没有新增或改名的文件
- 结果：vitest tests/web/ 20 个文件 148 项通过；pnpm test 63 个文件 947 项通过；pnpm check 退出 0；build 通过；diff --check 无输出。390×844 登录态无障碍树里菜单栏按钮是 系统菜单 / 帮助 / 搜索 / 账号 zhangsan-yangtze-2026；点搜索再 Esc 后 :hover 仍为 true、按钮背景 rgba(0,0,0,0)；窗口标题栏两列 132px 224px，标题从 x=148 开始；844×390 终端在前台时滚到底（标题栏 -391）再点 前往→终端，scrollTop 回 0、标题栏 53；1440×900 最小化后 display none、九个图标都点得到，从 Dock 恢复（458999f 上 display 仍 flex、四个图标被挡）。1280×800、1440×900 鼠标下 178/232 个元素改前改后逐个一致，悬停底色都是 rgba(27,33,64,0.07)；截图 1280 有 3184 个像素差 1/255、1440 有 2810 个像素差 ≤2/255，1% 容差下都为 0（之前写的 1280 逐像素相同改正）。本机 PATH 里的 Node 26 会让 tests/web/portal-org-window.test.tsx 因 localStorage 为 undefined 失败 3 项，换成仓库要求的 Node 22 后通过，与本改动无关。git merge-tree 显示与 stage a18616a 只在生成文件 notes/INDEX.md 冲突
