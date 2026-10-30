# task/306/keep_version_011 · crosery · 2026-10-28

负责人：crosery

## 15:03:52 +08:00 · 开工 · #306 · task/306 续：hotfix 沿用 0.1.1，包版本号回到 0.1.1

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：所有者 2026-10-28 15:01 原话：「[已脱敏]」。MR !49（331c0b5a）已把包版本升到 0.1.2，而发布流水线的 release-policy 要求 tag 的 X.Y.Z 等于该提交 package.json 的 version，所以本 task 把 package.json 与 app/{server,web,console}/package.json 的版本改回 0.1.1。已向所有者说明：不另发新版本号时，正式 tag 与 evidence 作业（同提交需要 rc 预发布部署）仍然要走，v0.1.1 的移动由所有者此条决定授权。从 stage 331c0b5a 新建 task/306/keep_version_011 与 worktree。
- 结果：worktree 已建；包版本已改回 0.1.1

## 15:05:07 +08:00 · 开发 · #306 · 文档核对：server 服务文档

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：文档核对：docs/services/server/ 不用改——app/server 只有 package.json 的版本号 0.1.2 改回 0.1.1（回到 MR !49 之前的值），行为与接口都没变。
- 结果：docs/services/server/ 内容已核对无需改动

## 15:05:07 +08:00 · 开发 · #306 · 文档核对：web 服务文档

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：文档核对：docs/services/web/ 不用改——app/web 只有 package.json 的版本号 0.1.2 改回 0.1.1（回到 MR !49 之前的值），行为与接口都没变。
- 结果：docs/services/web/ 内容已核对无需改动

## 15:05:07 +08:00 · 开发 · #306 · 文档核对：console 服务文档

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：文档核对：docs/services/console/ 不用改——app/console 只有 package.json 的版本号 0.1.2 改回 0.1.1（回到 MR !49 之前的值），行为与接口都没变。
- 结果：docs/services/console/ 内容已核对无需改动

## 15:14:21 +08:00 · 方案 · #306 · 执行所有者确认的同版本 hotfix，纠正此前 rc 路径

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，gpt-6-astra）
- 做了什么：所有者 15:01 已明确要求 [已脱敏]。此前本链开工记录写仍要 rc 与授权移动 tag，不是用户决定，现纠正：不发 rc，不创建新版本 tag，不移动已有 v0.1.1；将同名版本作为发布锚点，以 main 的明确修复 SHA 构建热修订，release.json 记录真实 SHA。补充受控 hotfix 入口，不删除常规发布门禁，不临时解除保护。MR !49 曾误先合入 stage，该事实保留，不改写历史；当前 main 仍94140632、stage331c0b5a，差异仅已审修复。原记录所称复核通过是作者验证，不是独立审查人重新通过；发布前再次核对。
- 结果：子 agent 只实现发布入口/测试/对应规范；主 agent 核对真实数据、Google配置和最终整合，尚未触发发布

## 15:30:02 +08:00 · 阻塞 · #307 · Google 正式开放受 Branding 配置阻塞

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：真实核对 Google Auth Platform：生产客户端已新建，回调只有 https://yangtzeu.work/auth/google/callback；production 环境 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 已由 GitHub Environment secret 加密写入并回读名称与更新时间。旧密钥已停用，新密钥已启用，值不写入记录。Audience 显示 Testing，仅 1 个测试用户；Publish app 按钮禁用，原因是 Branding 页面未完整配置，隐私政策链接为空。另发现原单的接口路径写错：生产应核对 GET /auth/providers。
- 结果：代码已具备 Google 登录；正式用户开放需要所有者补充公开隐私政策 URL 并完成 Google Branding 配置，这一步不能用不存在的路径代替。

## 15:30:25 +08:00 · 方案 · #306 · 生产数据对账结论：用户数据未物理丢失，登录状态需重新建立

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：在 Arch 生产栈对发布前备份 backups-keep/20261028T061720Z-3667551 与现网 data.db 做 VACUUM INTO 后隔离逐表逐行核对。旧库 44 个 GitHub 数字 id 全部能在论坛/名册覆盖；现网补齐前的生产副本仍有 40 个 id 无 identity，84 个会话缺失，其中 83 个已过期、1 个仍未过期；完整性 ok、外键 0。除启动迁移预期变化外，applications 76/76、application_reviews 159/159、invitations 52/52、role_assignments 25/25 等业务记录未丢；标题/部门/论坛种子字段有已知迁移变化，forum_posts 8 条正文按 #304 CDN 启动播种更新，不能把它们误报成用户数据丢失。
- 结果：已验证用户资料、帖子、名册、投递、申请审核等旧数据仍在；P0 的缺口是账号映射/成员权限和 1 条尚未过期的旧会话，hotfix 正是补齐映射，旧 sid 不承诺恢复，用户重新 GitHub 登录后复用原 forum_users/account 关系。

## 15:33:30 +08:00 · 开发 · #306 · 区分正常会话注销与业务数据缺失

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：补查唯一尚未过期但缺失的旧 sid 所属账号：identity_audit 有 login、link、logout 各一条，现存该账号的两条 GitHub 会话比缺失会话更早；没有把会话变化推断成用户数据物理丢失。所有旧 GitHub 数字 id 的集合大小44，论坛/名册联合覆盖44，差集0。
- 结果：会话注销不回灌；用户以正常登录恢复会话，账号/业务关联由迁移修复。仍以实际登录链路验收，不用表行数替代浏览器结果。

## 15:52:28 +08:00 · 开发 · #306 · hotfix 入口、回归和文档门禁完成

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：新增 scripts/hotfix-policy.mjs、.github/workflows/deploy-hotfix.yml、tests/tooling/hotfix-policy.test.ts；hotfix 只允许 main 手工触发，输入既有 v0.1.1、完整 main SHA、P0 issue，核对 tag 祖先/版本/线上成功部署，保留 production 审批、CDN、备份、SSH、镜像 sha256、健康门与回滚。新增部署记录 payload mode=hotfix/base_tag_commit/issue，required_contexts=hotfix-verify；复用核心与论坛验证。同步 RELEASES/BRANCHING/CICD 当前规范，更新 hosted-runners 回归。
- 结果：actionlint deploy-hotfix 通过；hotfix-policy 与 hosted-runners 48 tests passed；常规 release-policy 19、deploy-doc-sync 13 通过；原 hotfix 分支工作流仍未推送，未触发上线

## 16:13:53 +08:00 · 审查 · #306 · hotfix 双轴审查与备份反证核对

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：Standards 独立审查无明确阻塞，提出 issue 数字只是追踪字段及复制接线漂移两项；Spec 提出 issue API核验、备份等待/恢复、环境来源三项。主控逐项核验：GitLab #306 真实 opened、P0/hot-fix 标签及所有者确认正文均存在；不把 issue 数字称为授权，production required reviewers 保留。实机 backup unit Type=oneshot，systemctl start 未用 --no-block；docker-backup.py 第67-120行 check=True 完成在线快照、归档、断网恢复 verify，成功才写 receipt.restore_drill=passed，故“没有等待/恢复”的推断不成立。production/static-cdn 只新增 main 精确来源，原tag规则不改。增加构建/CDN作业与常规生产逐字一致回归，26测试通过。
- 结果：代码审查有条件通过：真实工作流、完整check/test、生产备份和浏览器验收仍须完成；未将审查替代上线。

## 16:15:47 +08:00 · 提交 · #306 · 同版本 hotfix 入口最终验证

- 执行者：agent-claude-geek-main-fece2da2（Claude Code，claude-sonnet-5-5）
- 做了什么：pnpm check 完整通过；pnpm test：176 个测试文件通过、1 个跳过，2844 个用例通过、27 个跳过（既有缺少 pwsh 的平台用例，未伪称已验证）；actionlint deploy-hotfix 通过；git diff --check 通过。相对 v0.1.1 的真实发布差异只有账号恢复及本 hotfix 交付支持，包版本最终为0.1.1，根及server/web/console版本与原正式提交相同。已读 GitLab #306：opened，P0/hot-fix 标签与所有者确认存在。
- 结果：准备提交并从 main 发布；不创建rc、不移动tag，完整检查作为受控hotfix入口再执行一次。
