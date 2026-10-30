# task/335/stage_sync · crosery · 2026-10-30

负责人：crosery

## 17:47:58 +08:00 · 开工 · #335 · hotfix main 合回 GitLab stage

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：#335 与 #311 进 main（28a2e7a4）后跑 hotfix-sync apply --source gitlab --mirror gitlab：12 个文件冲突（6 个是生成物），脚本停下要求在独立 worktree 人工解决。从 gitlab/stage 37abf3c6 拉 task/335/stage_sync。
- 结果：需要把 gitlab/main 28a2e7a4 合进 gitlab/stage，让 stage 重新包含 main。

## 17:47:58 +08:00 · 提交 · #335 · 合并 main 进 stage

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：f556fb6a：git merge --no-ff gitlab/main。冲突按两边取并集：oidc-store.ts 的导出两边都留；windows.json 用 stage 的批准摘要格式并带上 #335 窗口；origin-exceptions.json 留 stage 的 github-entry.yml 与 main 的 Cargo.toml、gitlab.caddy；ledger.json 同时留 P-0014 与 P-0017；RELEASE-PARITY.md 用 stage 去标识的依据行、日期取 10-30；CICD.md 用 stage 的行，gitlab-cutover 行取 main 带 #335 搬家动作的版本；docs/architecture/catalog 六个生成物按合并后的源码重生成。
- 结果：check:catalog 通过（305 方法路径、69 表）。

## 17:47:58 +08:00 · 提交 · #335 · forge 认 /gitlab 子路径

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：6d67b1e6：合并带进来的子域名检查报 stage 上 forge.mjs、github-import.mjs 与两份测试还写着旧子域名。parseRemoteUrl 把 /gitlab 这一段归入地址（至少还剩组和项目两段才算），提示文字改成不写域名，测试改用 example.test，新增子路径、多级组与名叫 gitlab 的组三个样例。
- 结果：改前 task-worktree 与 github-import 测试 8 条失败（项目路径被推成 gitlab/geek/admin），改后 2 个文件 45 条通过；check-env-isolation 通过；不设覆盖变量时 task.mjs list 能从真实 GitLab 读到各 issue 的状态。

## 17:53:33 +08:00 · 审查 · #335 · 同步合并自查

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：核对 f556fb6a 相对 gitlab/stage 只带进 main 自分叉点改过的内容；冲突取两边并集，没有丢 stage 的去标识改动（RELEASE-PARITY 的 waive 用法、批准摘要格式仍是 stage 版）。pnpm check：runtime、site-config、environments、env-isolation、boundaries、docs、doc-sync、notes、secrets、privacy、catalog 通过；check-architecture 默认基线是过期的 origin/stage，改用 --base gitlab/stage 后报的是 main 上 #335 各 MR 的并集，它们进 main 时已各自对齐，hotfix 合回 stage 按 BRANCHING「hotfix 合并后的自动同步」不另开 PR；check:cli、typecheck 通过。全量测试 201 个文件 3401 条通过、13 条跳过。
- 结果：结论：可以合回 GitLab stage，合回后 stage 包含 main。

## 18:05:51 +08:00 · 提交 · #335 · 同构清单收尾与执行记录归位

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：正式部署后核对 #335：verify-accounts 41036945384 有效成员 49 全部通过、sub 不变、GitLab 账号数不变；status 41037981251 签发者读宿主文件且为正式 /oidc；新地址 302 到登录页、登录走统一登录。parity.mjs done P-0017、P-0007、P-0011（两套 GitLab 已各自独立，正式同步 on 且 49 人全映射，预发布运行中为 off）。把暂存队列里 #335 两条链路的收尾、#328 的合并与收尾按原文追加到各自文件；#328 收尾之后那条更正记录违反「收尾之后没有记录」，没有并入，更正内容已在 GitLab #328 的关闭记录里
- 结果：parity.mjs check --complete：15 条、pending 0；note.mjs check 通过

## 19:23:34 +08:00 · 提交 · #343 · 合入四项并登记 hotfix 窗口

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：把 task/333/abuse_shield、task/336/production_security_notice、task/342/contest_remove_member、task/343/unified_avatar 依次合进 stage（MR !80–!83）；冲突只在生成的目录、SECURITY.md 的两段新增、config.ts 的 import、server 服务文档与表结构测试，两边都保留；登记四个 v0.1.1 hotfix 窗口
- 结果：server 类型检查通过，tests/server/legacy-database.test.ts 9/9 通过；hotfix-windows 校验通过
- 下一步：推 GitLab stage，main 快进，派发 deploy-hotfix

## 20:21:03 +08:00 · 合并 · #343 · 四项 hotfix 上线并关闭窗口

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：GitLab main 快进到 eaa451dd；GitHub stage 经 PR #313 合回（15a81b1f），GitHub main 推 66d89152（树同 eaa451dd，加 GitHub 独有的 307 声明与记录）；派发 deploy-hotfix 41049756867（issue 343，tag v0.1.1）；四个窗口改 closed
- 结果：deploy-hotfix 全部 job 通过（含线上烟测）；正式 /release.json 为 0.1.1@66d89152，构建于 2026-10-30T12:03:56Z
- 下一步：GitHub main 收尾提交，同步 PR 合回 GitHub stage，打 v0.1.1-stable.1 发预发布

## 20:35:59 +08:00 · 提交 · #335 · 检查器在 GitHub Actions 里默认读 GitHub 声明

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：GitHub 同步 PR #315 的 core 失败：pnpm check 不传 --forge，GitHub #314 与 GitLab #314 同号，读到了 GitLab 的 docs/changes/314.json。scripts/check-architecture.mjs 不传 --forge 时按 GITHUB_ACTIONS 选平台；新增命令行用例；ARCHITECTURE-ALIGNMENT「声明格式」补一句；docs/changes/335.json 改为覆盖本次三处改动
- 结果：tests/tooling/architecture-alignment.test.ts 28/28 通过；check-architecture --base gitlab/stage 通过
- 下一步：开 MR 进 GitLab stage，审查后合入，再同步 GitHub

## 20:36:13 +08:00 · 审查 · #335 · 检查器默认平台的自查

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：逐项核对 diff：只改不传 --forge 时的默认值，传了 --forge 的调用（architecture-alignment）不变；GitLab 一侧与本机默认仍是 gitlab；GITHUB_ACTIONS 的判断与 check-branch-invariants.mjs 相同；检查器没有新增导入，目标分支单文件复制的用法不受影响；新用例覆盖两种环境
- 结果：结论：通过

## 20:49:32 +08:00 · 提交 · #335 · 补生成项目目录

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：MR !85 改了 docs/conventions/ARCHITECTURE-ALIGNMENT.md（项目目录的来源文件），合入时没有重新生成目录，stage 上 check:catalog 报过期；pnpm catalog:generate 只改指纹与该文件摘要
- 结果：pnpm check:catalog 通过

## 20:50:43 +08:00 · 审查 · #335 · 目录重新生成的自查

- 执行者：agent-claude-01d717b4（Claude Code，claude-opus-5-5）
- 做了什么：核对 diff：六个目录生成物只变指纹与 ARCHITECTURE-ALIGNMENT 的摘要，与 GitHub 同步分支上独立生成的结果逐字节相同；声明改为 docs-only 覆盖目录
- 结果：结论：通过；check:catalog、check-architecture --base gitlab/stage 通过
