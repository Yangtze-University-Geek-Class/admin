# task/262/password_rule · crosery · 2026-10-23

负责人：crosery

## 13:53:21 +08:00 · 开工 · #262 · 密码最短从 15 位降到 8 位，不要求大小写和符号

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：所有者 2026-10-23 13:52：「[已脱敏]」（之前 13:36 选了[已脱敏]，看到 15 位的要求后改口）。按所有者 00:21「[已脱敏]」，从 GitLab stage 2101fe40 用 git worktree add 建 task/262/password_rule（task.mjs start 要连 GitHub，不可用），挂在 #262 下
- 结果：worktree .claude/worktrees/task-262-password，pnpm install --frozen-lockfile 通过（Node 22.23.2）
- 下一步：改服务端 password-policy、控制台 passwordRuleProblem 与提示文字、相关文档和测试

## 14:00:16 +08:00 · 提交 · #262 · 提交密码最短改成 8 位，推送前去掉了所有者原话里的真实密码

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：提交 feat(auth): 密码最短改成 8 位，不要求大小写和符号（服务端 PASSWORD_MIN_LENGTH = 8、控制台检查与提示、测试、文档、ADR-0005 第三次修订、docs/changes/262.json 按本 PR 重写、项目目录重新生成）。第一次提交时把所有者原话里举的两个密码例子原样写进了提交说明、ADR、262.json 和本链路的开工记录，那是所有者的真实密码；仓库在 GitLab 上公开，推送前把这几处换成「是所有者的真实密码，不公开」，并修订了这个还没推送的提交，开工记录里的这一处同样改了，其余内容不变
- 结果：pnpm check:runtime/site-config/environments/boundaries/docs/notes/catalog/secrets、check-doc-sync --base 2101fe40、check-architecture --base 2101fe40 通过；pnpm typecheck 通过；pnpm test 93 个文件 1532 条通过；server 与 console 构建通过；git grep -i 查不到密码例子
- 下一步：按 code-review 技能两轴审查，推到 GitLab 开 MR，合进 stage 发 rc.13

## 14:09:41 +08:00 · 审查 · #262 · 按 code-review 技能两轴审查 92f516e5（改说明后为 2b28164f，内容相同）：两轴都是有条件通过

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：规范、需求各一个只读子 agent 并行审 git diff 2101fe40 92f516e5
- 结果：需求轴：四条路径（设密码接口、账号页、注册的可选密码、密码登录）都放行 8 位以上；缺 docs/services/console/README.md:97 还写至少 15 位；262.json 兼容说明写「旧前端不会拦住正确输入」不对，没刷新的旧页面本地检查仍拦 8 到 14 位；最短取 8 是实施方的推断，要在 MR 写明。规范轴：同一处 README；开工记录写完后改过（为去掉密码），要在 MR 写明；去掉密码后的文字仍写出密码例子的长度，262.json 业务理由与测试数据的形状和其中一个例子相近，等于公开了长度与字符类型，要改；判断题：控制台三处各写死 8（Duplicated Code / Shotgun Surgery），路由里按错误码拼提示（Feature Envy，沿用旧写法不改）。两轴都确认提交说明和仓库里查不到密码原文，未推送的旧提交 9c85b35f 只在本机
- 下一步：返工：补 README、改兼容说明、去掉长度描述并修订还没推送的提交说明、测试改用 8 位边界值、控制台用一个常量

## 14:09:41 +08:00 · 返工 · #262 · 按两轴审查返工：补文档、去掉密码长度描述、测试用 8 位边界、控制台共用常量

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：修订还没推送的 92f516e5 的提交说明为 2b28164f（只改说明里描述密码例子的那几个字，改成「两个密码例子……已本地核对，不公开」）；docs/services/console/README.md:97 改至少 8 位；262.json 改兼容说明、业务理由不再写字符类型；ADR-0005 与本链路开工记录里描述密码例子长度的字一并去掉（开工记录第二次为去掉密码信息而改，其余文字不变）；服务端与控制台用例改用正好 8 位的 abcd1234 和 8 位纯字母；控制台 lib/account.ts 加 PASSWORD_MIN_LENGTH，账号页与登录页的提示用它
- 结果：pnpm check:* 八项、check-doc-sync 与 check-architecture --base 2101fe40 通过；pnpm typecheck 通过；pnpm test 93 个文件 1532 条通过；console 构建通过；git grep 查不到密码例子的长度描述与旧测试值

## 14:21:10 +08:00 · 提交 · #262 · 推送前把本机四个提交合成 8063dd20，公开历史里不留所有者密码例子的长度

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：推送前逐个提交核对时发现：92f516e5 修订后的 2b28164f 里，262.json、ADR-0005、开工记录和测试数据仍写着所有者密码例子的长度或字符类型，cd2ffb4c 的提交说明和上一条返工记录也写了长度；分支要推到公开的 GitLab，后面的提交改掉也会留在历史里。于是 git reset --soft 2101fe40，把 2b28164f、193c2b0d、cd2ffb4c、8dd786cf 合成 8063dd20（最终的代码、测试、文档与项目目录，带开工、提交两条记录），审查、返工两条记录和这一条放进下一个提交。返工记录里写出长度的三处改成不带长度的说法（这是第三次为去掉密码信息改已写的记录，其余文字不变）。审查所针对的 92f516e5 和返工的三个提交只留在本机 reflog，内容合起来就是 8063dd20
- 结果：8063dd20 与 8dd786cf 的差别只有执行记录少了审查、返工两条；pnpm check 八项、check-doc-sync 与 check-architecture --base 2101fe40 通过；pnpm typecheck 通过；pnpm test 93 个文件 1532 条通过；server 与 console 构建通过；git log -p 2101fe40..HEAD 查不到密码例子的长度、字符类型与旧测试值
- 下一步：推到 GitLab 开 MR，写 PR 记录

## 14:23:55 +08:00 · PR · #262 · 开 GitLab MR !3（task/262/password_rule → stage）

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：GitHub 账号被封期间按所有者 10:32「[已脱敏]」在 GitLab 开 MR：https://git.yangtzeu.work/geek/admin/-/merge_requests/3 ，头 9b64311c，标签 func:auth、ui:content，合并后删源分支。正文十节：写明最短 8 位是实施方按所有者例子定的、密码例子与长度不公开、推送前合成提交、执行记录为去掉密码信息改过三次；验收证据是注册页改前（rc.12）改后（本机开发服务器）桌面与手机各一张、账号页改后两张，都用 ego-browser 截。只写 Refs #262，不自动关单
- 结果：MR !3 已开，截图匿名可读（HTTP 200）
- 下一步：提交这条记录推上去，合进 stage，构建部署 rc.13

## 14:35:01 +08:00 · 合并 · #262 · MR !3 合进 GitLab stage（6f574328），删掉源分支

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：release 工作区（分离头，在 2101fe40）git merge --no-ff db1ba317，合并提交 6f574328「Merge branch 'task/262/password_rule' into stage」；从 GitLab 克隆 /tmp/geek262/gl-push 把本地 stage 指到 6f574328，启用 .githooks 后推 stage；确认 MR !3 显示已合并后，用接口删掉 GitLab 上的 task/262/password_rule。合并后又改了一次 MR !3 正文：本地 pr-contract 报「审查结论」那一行带了条件说明、「验证命令与结果」缺状态码，于是把条件挪到上一行，补上三个测试文件的运行结果和一个临时测试文件打印的接口状态码（7 位 400、8 位 200、10 位 200、用它登录 200；临时文件跑完删掉，没有提交）
- 结果：2101fe4..6f57432 快进，pre-push 通过；MR !3 state merged，merge_commit_sha 6f574328；删分支返回 204；合并提交与 db1ba317 的树相同；pr-contract 只剩有意不写 Closes #262 一项。本机 worktree 与本地分支没清理：task.mjs finish 要用 gh 查，GitHub 被封期间查不到
- 下一步：构建并部署 rc.13 到预发布

## 14:37:01 +08:00 · 发布 · #262 · 本机构建并部署预发布 rc.13（6f574328cc5c）

- 执行者：agent-claude-geek-main-8f7d12b7（Claude Code，claude-opus-5-5）
- 做了什么：按所有者 00:37 批准的「[已脱敏]」：在 6f574328 上打本地 tag v0.1.1-rc.13（没推送）；本机 docker build --platform linux/amd64 构建 server、web、forum，GEEK_RELEASE_VERSION=0.1.1-rc.13@6f574328cc5c，docker save | gzip -9 后 sha256 5a307b25…ef6ddf；部署前用 sqlite3 .backup 备份预发布库到 /root/yzgc-backups/preview-20261023-062524-2101fe40448a.db（integrity_check ok，权限改成 600）；scp 归档、校验和、deploy-stack.sh 与 preview.yml，目标机上把现有 .env.preview 只换 IMAGE_TAG 生成 incoming/.env.preview，跑 deploy-stack.sh
- 结果：部署成功：preview 6f574328cc5c，两个 healthz 都 ok；/release.json 是 0.1.1-rc.13@6f574328cc5c；/auth/providers 仍是 github、google、email；POST /api/identity/password 不带登录回 401；ego-browser 看 /signin 注册与密码登录的占位文字都是「至少 8 位」，桌面与手机横向溢出 0；users 表仍是 2 行。部署证据贴在 MR !3 评论 343。回滚用 2101fe40448a
- 下一步：所有者用验证码登录，10 分钟内在「我的账号」设 8 位以上的密码，再用邮箱加密码登录
