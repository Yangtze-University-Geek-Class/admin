# task/175/stage_gate_repair · zzdr1023 · 2026-09-27

负责人：zzdr1023

## 23:05:23 +08:00 · 开工 · #175 · 从 origin/stage 9b38684cee44 建 task/175/stage_gate_repair

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：node scripts/task.mjs start 175 stage_gate_repair：建分支与 worktree .claude/worktrees/task-175，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 23:50:08 +08:00 · 方案 · #175 · 定位：#173 留下 1 处样式违规 + 3 组文档不同步

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：在 origin/stage 9b38684 上复现：node scripts/check-doc-sync.mjs 退出码 1，报 app/web/ ↔ docs/services/web/、app/forum/ ↔ docs/services/forum/、deploy/ ↔ docs/ops/… 三组不同步；app/forum 内 node scripts/check-styles.mjs 报 preferences.vue:345 vue-style-block 1 处违规。根因：ad884aa 往 preferences.vue 加了 <style scoped>，并改了 app/web/Dockerfile（location ^~ /api/）与 deploy/nginx/{preview,production}.conf（/forum/t/<数字> 301）没同步文档、没同步 docs/services/forum 里话题链接归一的事实。
- 结果：复现证据：check-doc-sync 退出码 1（三组）、check-styles 退出码 1（1 violation，preferences.vue:345）。改动方案：把 <style scoped> 换成 UnoCSS 工具类（gap-4 max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:!h-auto），补齐 docs/services/web、docs/services/forum、docs/ops/DEPLOY.md 的对应说明。
- 下一步：先做样式修复并用真浏览器核对布局

## 23:50:31 +08:00 · 开发 · #175 · 样式：preferences.vue 的 <style scoped> 换成 UnoCSS 工具类

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：删掉 preferences.vue 末尾的 <style scoped>（含 :deep(.tx-block-input) gap 与 :deep(.tx-block-input__control) 380px/窄屏竖排）与页面根上的 .preferences-panel 钩子类；四个 TxBlockInput 改挂 class="gap-4 max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:!h-auto"。
- 结果：在 app/forum 实跑：node scripts/check-styles.mjs 输出 check-styles: clean（125 files scanned），退出码 0；--self-test 8 规则/6 反例全通过。把原文件放回去重跑同一条命令仍报 preferences.vue:345 1 violation，说明 guard 能区分修复前后。pnpm forum:check（Node 26 + pnpm 11.24.0）全绿：30 个测试文件 541 passed。
- 下一步：核对布局是否与改前一致

## 23:50:31 +08:00 · 开发 · #175 · 样式：用真浏览器核对 1280×900 与 390×844 的布局

- 执行者：agent-pi-geek-main-02（pi coding agent，dsf）
- 做了什么：用仓库自带 scripts/lib/cdp.mjs 驱动 Playwright Chromium（headless），在 forum:start 的示例种子上以 u1/talex 打开 /u/talex/preferences，量四个 .tx-block-input 的行盒/插槽/输入宽度，并截图。
- 结果：桌面 1280×900：四行 row=y/56、slot y、input 180px 与改前逐项相同（IDENTICAL）；390×844：行为列方向且行高从 56 长到 97 以容纳换行后的控件——改前那版 :deep 覆盖把控件压进固定 56px，插槽起点在行盒之外（实测 slot y 386 > row y 325+56），属于本来就溢出。gap 均为 16px（与 tuffex 默认一致）。截图：改前/改后各桌面与手机一张。
- 下一步：补齐 #173 留下的文档
