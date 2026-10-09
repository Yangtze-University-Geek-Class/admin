# task/211/invitation_table · crosery · 2026-10-08

负责人：crosery

## 00:30:36 +08:00 · 开工 · #211 · 从 origin/stage df90b67a8c03 建 task/211/invitation_table

- 执行者：agent-omp-geek-1008（omp，crosery/gpt-6.1-sol）
- 做了什么：node scripts/task.mjs start 211 invitation_table：建分支与 worktree .claude/worktrees/task-211，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 02:44:55 +08:00 · 方案 · #211 · 共用 .ellipsis 根修法 + 邀请历史列宽/单行/行高

- 执行者：agent-omp-consoleinvitations-1008
- 做了什么：读 issue #211 全文与 15 处共用 .ellipsis 的消费方；确认服务端写的是 pending_admin（不是 issue 正文写的 pending_uncertain，各分支都查过），保留 pending 兼容。根因是省略号挂在普通内联 span 上根本不截断（layout.css 的 .ellipsis 只有 overflow/text-overflow/white-space），排版问题是它的下游症状：token 越出本格 61px 压到「结果」列、徽章折两行（60×30）、历史行高 60px 对上表 47px。
- 结果：定方案：A 在 layout.css 给 .ellipsis 补 inline-block + vertical-align:bottom + max-width:100%（一处修全 15 处消费方；B 方案 display:block 会把省略号弄丢，否掉）；邀请历史「结果」「时间」用 Tuffex 已有的按列 nowrap 机制加宽到 104/140（不是新 hack），--table-min 680→720 让加宽后的固定列总和在 390px 仍可滚在表内；token 单元格补 :title（对齐 InviteLinks.vue）；本页 scoped :deep(.tx-data-table__cell){height:47px} 统一两表行高（待接受行的 26px sm 按钮 + 10px×2 padding + 1px 边框天然就是 47px）；样板 /invitations 历史换成线上等长的 24 字符 token（旧 16 字撑不满 130px 格，issue 里写明这 bug 在预览复现不出来）；在 tests/e2e/workflows.spec.ts 加真实浏览器几何回归。不改后端、不动令牌策略、不重构其它页面。

## 02:45:08 +08:00 · 开发 · #211 · layout.css/Invitations.vue/mock/e2e 落地

- 执行者：agent-omp-consoleinvitations-1008
- 做了什么：app/console/src/styles/layout.css：.ellipsis 加 display:inline-block、vertical-align:bottom、max-width:100% 与注释（#211，15 处消费方清单）。app/console/src/pages/github/Invitations.vue：historyColumns 结果列 84→104 + nowrap、时间列 120→140 + nowrap；STATUS 补 pending_admin（待核对/warning，真实数据此前落到英文原文回退、更宽又折行），保留 pending；历史表 --table-min 680→720（固定列合计 640 + 备注 ≥80；待接受表保持 620）；token 单元格加 :title；scoped :deep(.tx-data-table__cell){height:47px}。app/console/src/mock/github.ts：/invitations 历史三条换 24 字符合成 token（sent/pending_admin/failed 各一），dev-preview-link 那组旧样板删掉。tests/e2e/workflows.spec.ts：新增 #211 用例，1440/1280/1024×900 与 390×844 逐行量渲染几何。
- 结果：改完五份文件（含两份文档）。共用 .ellipsis 的 15 处消费方逐一复核：UserCell/Audit/Overview/InviteLinks/Repos/Invitations/SettingsTab/DiffBlock/Applications——原先没有任何一处依赖旧的越界行为，SettingsTab（flex 子项）与 DiffBlock（min-width:0）在旧规则下本就不截断，新规则下按容器截断，是修正不是回归；Applications 有 scoped .cell-email{display:block} 覆盖，行为不变。pending_admin 徽章文案「待核对」在 104px 单行放得下（sm 徽章 3 字 ≈62px + 图标 + padding）。类型/构建/测试/lint 由主代理统一跑。

## 02:52:02 +08:00 · 返工 · #211 · 主代理烟测两处修正

- 执行者：agent-omp-consoleinvitations-1008
- 做了什么：主代理在 5186 跑 1440/1280/1024/390 烟测后反馈两点：① 「本站发出的记录」卡片的 #header（标题+条数）在我改 --table-min 那一步被整行覆盖掉了，历史卡直接从列头开始——按原样恢复该行；② 探针量整枚 .tx-status-badge 时把图标盒当独立行算，单行文字会被误报成两行——e2e 与自测改量 .tx-status-badge__text（querySelector 兜底徽章容器本身）。
- 结果：恢复行与原提交逐字一致（git diff 该文件删行只剩 4 处预期改动）；tests/e2e/workflows.spec.ts 的 badgeText/badgeHeight 取 __text 盒。timeText 正则同时放宽分隔符（渲染走浏览器 ICU，Node 侧 22 实测是 -，但断言只把折行当缺陷，时间盒高度才是）。时间列注释不再写死分隔符。e2e 里没有 ReturnType<typeof …>。重跑烟测与正式校验归主代理。

## 02:58:18 +08:00 · 返工 · #211 · 保留块布局并移除实现细节断言

- 执行者：agent-omp-geek-1008（omp，crosery/gpt-6.1-sol）
- 做了什么：实际浏览器发现 blanket inline-block 让概览 dd 的233px内容越过152px列；子代理已将截断盒限定到span.ellipsis；父代理同步两份文档并删去 display、样板token长度、日期分隔符的实现细节断言，保留截图几何、title、单行及滚动条件
- 结果：邀请页1440/1280/1024/390初轮 token越界-12px、三种徽章与时间单行、两表47px；历史标题恢复；最终共享页面抽查与正式verify/e2e待本轮完成

## 03:07:35 +08:00 · 开发 · #211 · 本地机器验证通过，两处修复入口已打开

- 执行者：agent-omp-geek-1008（omp，crosery/gpt-6.1-sol）
- 做了什么：Node22 pnpm verify；完整 pnpm test:e2e；增加390px概览dd列宽回归后 pnpm test:e2e --grep #211；Chromium实际测1440/1280/1024/390邀请页、1440/390共用页面，窄屏真实横向wheel滚动；保留浏览器验收页与本地服务
- 结果：pnpm verify通过：核心1032测试、类型/构建/边界/文档/notes通过，论坛548测试与生成通过；完整36/36浏览器测试通过，最终#211聚焦1/1通过；24字符token在格内省略/title全值，越界-12px，三类徽章与时间单行，两表47px；390px横向scrollLeft253，页面不溢出；概览组织名限定自身列，共用页面无新增越界；入口 http://127.0.0.1:5186/console/github/invitations?__data=mock&__persona=admin 与 http://127.0.0.1:3458/ 已留给所有者，只用虚构样板/示例和隔离内存后端，没有提交、推送、远程部署或真实组织/邮件写入

## 03:16:35 +08:00 · 返工 · #211 · 所有者指出两张表标题贴近边框，本地验收不通过

- 执行者：agent-omp-geek-1008（omp，crosery/gpt-6.1-sol）
- 做了什么：收到 Crosery 附图反馈：「这个验收不通过，左上角的字体和边框离得太近了」；现有 Invitations.vue 的 table-head 内边距只有4px 4px 0。保留表体padding0和格内截断，单独给两处标题增加安全留白并与首列对齐
- 结果：所有者验收未通过，原机器验证不等于设计通过；本轮核对1440/1280/1024/390两张卡片的标题边距、首列对齐、token截断、单行徽章与表内滚动后再次提供本地页面

## 03:22:47 +08:00 · 返工 · #211 · 标题内边距返工已机器复验，等待所有者再验收

- 执行者：agent-omp-geek-1008（omp，crosery/gpt-6.1-sol）
- 做了什么：Invitations.vue table-head 改为上/左右12px、下8px；为两张卡片增加标题安全边距与首列表头左缘对齐的浏览器回归；实际打开1568/1440/1280/1024/390并查看截图；pnpm test:e2e --grep #211、console typecheck、notes/docs-index/doc-sync
- 结果：聚焦浏览器1/1、console类型及文档记录检查通过；五档标题距卡片边界上/左均13px（含1px边框），首列对齐误差1px；两表仍47px行高、页面无横向溢出，旧token/单行/滚动/概览回归通过；截图 .tools/acceptance211/header-inset-<宽度>.png 已查看。机器复验不代表 Crosery 已接受新视觉，原本地验收不通过记录保留
