# task/311/test_fix · crosery · 2026-10-29

负责人：crosery

## 21:39:18 +08:00 · 开工 · #311 · 补 #311 直达行为的两份手机测试（hotfix 收尾）

- 执行者：agent-omp-7ef9371a（OMP，crosery/mimo-v2.6-pro）
- 做了什么：deploy-hotfix 运行 40873045863 在 hotfix-core 失败：tests/web/portal-phone.test.tsx「手机单击直达…」与 tests/web/portal-promo-desktop.test.tsx「宣传片被别的窗口盖住…」仍断言 #311 改掉的「代码仓库开窗口」行为；复用 .claude/worktrees/task-311 从 093efb4d 拉 task/311/test_fix
- 结果：fnm exec --using=22（Node 22.23.2）本地复现同样两个失败：TestingLibraryElementError: Unable to find an accessible element with the role dialog and name 代码仓库

## 21:40:58 +08:00 · 提交 · #311 · 两份手机测试改断言 #311 直达行为

- 执行者：agent-omp-7ef9371a（OMP，crosery/mimo-v2.6-pro）
- 做了什么：tests/web/portal-phone.test.tsx「手机单击直达…」改为断言论坛、代码仓库都 followAppLink 当前页直达、双击不重复、不开窗口；tests/web/portal-promo-desktop.test.tsx 覆盖宣传片的窗口由「代码仓库」（#311 后不再开窗口）换成 Dock 上的「加入我们」（看过宣传片时不会自动弹）；文档核对：docs/ops/DEPLOY.md 不用改——本分支携带的 deploy/ 改动只有 deploy/hotfix/windows.json 的 #311 窗口登记，部署流程、环境与发布路径不变。文档核对：docs/ops/ENVIRONMENTS.md 不用改——同上，环境键与域名不变。文档核对：docs/ops/CICD.md 不用改——同上，CI/CD 工作流不变。
- 结果：fnm exec --using=22 -- pnpm exec vitest run 两份文件：Test Files 2 passed，Tests 31 passed（Node 22.23.2）

## 21:50:59 +08:00 · 开发 · #311 · 宏观对齐声明改为本 PR 的测试改动

- 执行者：agent-omp-7ef9371a（OMP，crosery/mimo-v2.6-pro）
- 做了什么：docs/changes/311.json 重写为本 PR 的影响声明（kind engineering）：coverage 只列两份手机测试与目录生成物，verification changed、其余维度 unchanged；文档核对：docs/conventions/TESTING.md 不用改——本 PR 只把两份手机测试的断言对齐到已上线行为，测试规范与验证命令不变。
- 结果：pnpm check:architecture 待本次重跑核对；声明的 coverage 与 working tree 的 8 个变更文件（2 测试 + 6 目录生成物）一一对应
