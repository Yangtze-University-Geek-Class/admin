# task/217/perf_load · crosery · 2026-10-09

负责人：crosery

## 19:49:05 +08:00 · 开工 · #217 · 从 origin/stage 1430c3cdfa71 建 task/217/perf_load

- 执行者：agent-claude-geek-217（claude，crosery/sonnet-5-5）
- 做了什么：node scripts/task.mjs start 217 perf_load：建分支与 worktree .claude/worktrees/task-217，在 issue 上留开工记录
- 结果：worktree 已建好，issue 上已留开工记录

## 20:01:41 +08:00 · 开发 · #217 · 官网首页：手机模型按需加载，去掉被 CSP 拦的远程字体

- 执行者：agent-claude-geek-217（claude，crosery/sonnet-5-5）
- 做了什么：预发布实测首页电脑端也拉 1.77MB iPhone 模型且首帧等它。desk.ts 把手机构建拆成 buildPhone/ensurePhone：手机壳层才在启动时加载，电脑端不加载，窗口变窄时按需下载并 stage.resize 重排；warmUp 只传当前隐藏的设备。base.css 删掉 cdn.jsdelivr.net 的 Maple Mono @font-face（被 CSP 拦、字体回退系统等宽栈）。顺手去掉碎石几何多余的 toNonIndexed。文档核对：portal.md 稍后随本批文档一并改
- 结果：tsc 通过；ego-browser 四种情形验证：手机直开(手机可见)、电脑(无手机)、电脑缩手机(下载 1773KB 后手机可见)、再切回电脑(笔记本可见)；未跑 e2e

## 20:13:04 +08:00 · 开发 · #217 · 论坛分包合并、模型文件开 gzip

- 执行者：agent-claude-geek-217（claude，crosery/sonnet-5-5）
- 做了什么：预发布实测论坛 70 个脚本串三层、重复下载。nuxt.config.ts 加 rolldown codeSplitting：tuffex 组件与论坛 app 代码各合成一个分包，产物脚本 70→6、请求 71→13，总体积不变。web Dockerfile 与宿主 nginx 的 preview/production 模板的 gzip_types 加 model/gltf-binary（模型 1.77MB→1.16MB）。本地用带 120–240ms 延迟和 gzip 的静态服务各测 3 次
- 结果：同样延迟下最大内容绘制 2884→1600ms、CPU 4 倍降速 3032→1216ms，首次内容绘制 2476→476ms（这是壳页面首绘）；forum:check 548 测试全过；宿主 nginx 模板需所有者重新安装才生效。文档核对：forum README 与 CICD/DEPLOY 稍后同批更新

## 20:23:54 +08:00 · 开发 · #217 · 文档同步与论坛交互卡顿排查结论

- 执行者：agent-claude-geek-217
- 做了什么：更新 portal.md、forum README、DEPLOY.md。论坛交互排查：点赞、菜单、回复弹窗均无长任务，游客 PoW 15–24ms，发评论已是乐观更新；页面 backdrop-filter 仅 4–5 处。剩余卡顿主要是 API 首字节 240–500ms 抖动，属服务端或链路，需所有者授权查服务器。文档核对：ENVIRONMENTS.md、CICD.md 不用改——gzip_types 与部署流程无关，仅随 deploy/ 日期对齐
- 结果：待跑 check
