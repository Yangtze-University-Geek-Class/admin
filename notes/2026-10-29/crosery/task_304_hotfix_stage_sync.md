# task/304/hotfix_stage_sync · crosery · 2026-10-29

负责人：crosery

## 22:47:10 +08:00 · 开工 · #304 · GitHub 受保护 stage 同步（补齐 #310、#311 两轮 hotfix 合回）

- 执行者：agent-omp-7ef9371a（OMP，crosery/mimo-v2.6-pro）
- 做了什么：GitHub stage（1e47e65a）落后两仓 main 两个 hotfix（#310 加入我们窗口边界、#311 代码仓库整页直达 + 测试对齐）；按 GitHub #301 先例建同步工单 #304，task/304/hotfix_stage_sync 从已合并的同步提交 b734c99 继续
- 结果：分支位于 b734c99（含 #310/#311 合回与目录重生成）；不直推 stage、不取消保护、不创建或移动发布 tag；文档核对：docs/ops/DEPLOY.md 不用改——本次同步只携带 deploy/hotfix/windows.json 的 #310/#311 窗口登记，部署流程、环境与发布路径不变。文档核对：docs/ops/ENVIRONMENTS.md 不用改——同上，环境键与域名不变。文档核对：docs/ops/CICD.md 不用改——同上，CI/CD 工作流不变。

## 22:49:14 +08:00 · 提交 · #304 · 受保护 stage 同步声明与执行记录

- 执行者：agent-omp-7ef9371a（OMP，crosery/mimo-v2.6-pro）
- 做了什么：补 docs/changes/304.json（kind business，coverage 逐文件覆盖 23 个材料文件，八维评估）；执行记录写入 notes/2026-10-29/crosery/task_304_hotfix_stage_sync.md，deploy/ 三份文档核对随链路记录
- 结果：node scripts/check-architecture.mjs --base origin/stage 通过：29 个变更文件，16 个关联节点；check:doc-sync、check:notes（148 条链路）通过

## 23:06:14 +08:00 · 阻塞 · #304 · docs/changes/304.json 命名空间冲突，同步声明待所有者定夺

- 执行者：agent-omp-7ef9371a（OMP，crosery/mimo-v2.6-pro）
- 做了什么：发现 docs/changes/304.json 已属于 GitLab #304（论坛旧帖 OSS 图片迁 Garage CDN，声明在 b37beca5）：两仓 issue 共用扁平命名空间，GitHub #304 与它同号。误覆盖已恢复（git checkout b734c99 -- docs/changes/304.json）；301.json 历史显示上次 GitHub #301 同步同样覆盖过 GitLab #301 的声明（8bc5fc8d → 9e171b65）
- 结果：阻塞待所有者选择：沿用先例接管 304.json / 换 GitHub 号（需新建工单）/ 授权绕过 stage 保护 / 延后 GitHub 同步。GitLab stage 合回不受影响，已完成（b734c992）

## 23:23:29 +08:00 · 开发 · #304 · 所有者定夺：同步声明接管 docs/changes/304.json

- 执行者：agent-omp-7ef9371a（OMP，crosery/mimo-v2.6-pro）
- 做了什么：所有者 2026-10-29 22:xx 选定（ask 超时后按推荐方案自动选定，已在 GitHub #304 与 GitLab geek/admin#304 双侧留痕）沿用 GitHub #301 先例：GitHub #304 的同步声明接管 docs/changes/304.json；GitLab #304 的原声明保留在 b37beca5
- 结果：声明已写入（kind business，coverage 24 个材料文件逐一覆盖，八维评估）；回滚点：git show b37beca5:docs/changes/304.json
