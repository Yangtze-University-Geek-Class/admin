# task/265/competition_window · crosery · 2026-10-20

负责人：crosery

## 12:10:02 +08:00 · 开工 · #265 · 从 origin/stage b51bf137626f 建 task/265/competition_window

- 执行者：agent-notion-geek（Notion AI，经 wanctl 操作公司 Mac）
- 做了什么：node scripts/task.mjs start 265 competition_window：建分支与 worktree .claude/worktrees/task-265，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 17:01:10 +08:00 · 开发 · #265 · 比赛窗口改成列表加详情：筛选、搜索、赛程与手机进出详情

- 执行者：agent-notion-geek（Notion AI，经 wanctl 操作公司 Mac）
- 做了什么：按 docs/plan/COMPETITION-APP.md「结构与呈现」重做浏览部分：新增 components/os/competitions/（CompetitionsApp、CompetitionList、CompetitionDetail）与 lib/competitionLabels.ts；Windows.tsx 改挂新组件、宽 1100，手机标题栏返回键可由窗口换成「比赛列表」（PhoneNav），带 data-no-autofocus 的输入框不抢焦点；lib/competitions.ts 加 reload 与同一屏共用的当前时间；os.css 换成 .pt-cx* 样式（矮屏窗口高度给 Dock 留出空隙）；mock-api.ts 的 demoCompetitions 换成七场五种状态的样板；单测重写为 24 条，新增 e2e tests/e2e/portal-competitions.spec.ts；portal 合同、比赛应用方案、ownership.json 与 docs/changes/265.json 同步，pnpm catalog:generate 重建 6 个生成文件
- 结果：pnpm check 退出 0（宏观对齐 #265，22 个变更文件，17 个关联节点）；e2e portal-competitions 2 条通过；portal-phone 18 条中 16 条按默认超时通过，:77 的 360×780、390×844 两条本机 20 秒内 3D 场景没加载完，E2E_TIMEOUT_SCALE=3 重跑 :77 三条通过；临时脚本查 1024×768、1280×720、1366×768、1440×900、1920×1080 与 820×1180、768×1024 都没有横向滚动，桌面窗口底边离 Dock 至少 9 像素；改前（预发布 rc.6 换同一份样板）与改后截图各拍桌面 1440×900、手机 390×844，存在 Crosery 的 gist

## 17:01:10 +08:00 · 提交 · #265 · 提交比赛窗口重做与回归测试

- 执行者：agent-notion-geek（Notion AI，经 wanctl 操作公司 Mac）
- 做了什么：提交组件、文案纯函数、数据钩子、窗口外壳、样式、开发样板、单元与 e2e 测试、portal 合同、比赛应用方案、ownership.json 与 6 个项目目录生成文件、docs/changes/265.json 与本执行记录；#263 的收尾记录另一个提交
- 结果：待 pre-push 与 CI 复核
- 下一步：推到主仓库同名分支，开 PR 回 stage，CI 全绿后以 merge commit 合并并关闭 #265

## 17:21:01 +08:00 · 推送 · #265 · 把 task/265/competition_window 推到主仓库同名分支

- 执行者：agent-notion-geek（Notion AI，经 wanctl 操作公司 Mac）
- 做了什么：git push origin task/265/competition_window:refs/heads/task/265/competition_window；fork ZZDR1023/admin-geek 对 Crosery 没有推送权限，同 #263 推主仓库同名分支，合并后由 branch-hygiene 删除
- 结果：pre-push 检查通过，远端分支指向 fa88756a

## 17:21:01 +08:00 · PR · #265 · 开 PR #266 回 stage

- 执行者：agent-notion-geek（Notion AI，经 wanctl 操作公司 Mac）
- 做了什么：gh pr create --base stage --head task/265/competition_window，标签同 #265（enhancement、P1、portal、ui:layout、ui:visual、ui:content、ui:interaction）；正文按模板 10 段，验收证据 E1–E4 是改前（rc.6 换同一份样板）与改后的桌面 1440×900、手机 390×844 截图
- 结果：https://github.com/Yangtze-University-Geek-Class/admin/pull/266；本机 pr-contract 与宏观对齐自测通过

## 17:21:02 +08:00 · 审查 · #265 · 自审 fa88756a：通过

- 执行者：agent-notion-geek（Notion AI，经 wanctl 操作公司 Mac）
- 做了什么：按 CODE-REVIEW 14 项核对 b51bf137..fa88756a（22 个文件），另查键盘焦点、手机 Esc、矮屏高度、外链属性，以及界面上没有报名、组队、人数的入口
- 结果：结论通过（自审，不是独立第三方审查）；未验证：预发布真实数据、读屏实机、Safari 与 Firefox
- 下一步：CI 全绿后以 merge commit 合并，核对 #265 关闭、远端分支删除，再 task.mjs finish 265

## 17:43:58 +08:00 · 返工 · #265 · CI e2e 手机用例的浮点误差

- 执行者：agent-notion-geek（Notion AI，经 wanctl 操作公司 Mac）
- 做了什么：PR #266 的 e2e（Playwright 报告）失败 1 条：手机 390×844 用例里「全部」筛选胶囊量出 43.99998px（boundingBox 坐标经 float32 换算，实际是 44px），其余 47 条通过。73c63ae9 把 atLeast44 改为不小于 44 - 0.01，并重建项目目录的来源摘要。
- 结果：e2e portal-competitions 2 条通过；pnpm check 退出 0。界面与样式没有改。
- 下一步：推送后等 CI 全绿，按 merge commit 合并 PR #266。

## 18:19:56 +08:00 · 收尾 · #265 · PR #266 已合并，清理 worktree

- 执行者：agent-notion-geek（Notion AI，经 wanctl 操作公司 Mac）
- 做了什么：node scripts/task.mjs finish 265：删 worktree .claude/worktrees/task-265 与本地分支 task/265/competition_window
- 结果：PR 已合并
