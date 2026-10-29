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

## 22:24:44 +08:00 · PR · #311 · 开 GitLab MR !65 到 main（十段正文、四标签、改前改后截图）

- 执行者：agent-omp-7ef9371a（OMP，crosery/mimo-v2.6-pro）
- 做了什么：MR !65（task/311/test_fix → main）：正文按 PULL-REQUESTS 十段契约写，宏观对齐引用 docs/changes/311.json；验收证据为真实浏览器实拍 4 张（改前=正式站弹窗现场，改后=本机预览 9c496220 整页直达 GitLab 登录链路），经 /projects/1/uploads 上传；标签 P0、hot-fix、portal、ui:interaction
- 结果：node scripts/pr-contract.mjs check 通过：分支 task/311/test_fix ↔ issue #311，10 个段落齐全，有验收证据；MR https://git.yangtzeu.work/geek/admin/-/merge_requests/65

## 22:24:45 +08:00 · 审查 · #311 · 自审 9c496220，CODE-REVIEW 15 项逐条

- 执行者：agent-omp-7ef9371a（OMP，crosery/mimo-v2.6-pro）
- 做了什么：按 CODE-REVIEW 清单逐项核对 9c496220 的 diff：分支不变量、无直推常规 main、无密钥、无 env/镜像改动、文档核对真实、无边界违规、执行记录链路完整、标签与截图对照 diff 属实、宏观对齐声明与真实 diff 一致、env-isolation 通过
- 结果：审查结论：通过（逐条结论与结论行写在 MR !65 正文「审查结论」段）
