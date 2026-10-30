# 首场内部个人赛演练矩阵

> GitHub #276 的有限后台验收矩阵、真实路由闭环和浏览器接力入口；测试通过不等于未知组合、真实 GitLab 或浏览器已验收。

状态：`current` · 更新：2026-10-27 · 适用：个人内部贡献赛；来源：[比赛合同](../../plan/COMPETITION-APP.md)、[接口契约](endpoint-contracts.md)、`tests/server/competition*.test.ts`、`scripts/contest-rehearsal*.mts`。

## seam 与计数

使用真实 `buildApp/inject`、同实例 SQLite、真实 GitLab HTTP Adapter。只替换外部 HTTP、时间；故障注入使用本次隔离库的 SQLite trigger，不复制 handler 或计分算法。并发是单 server 实例的重叠请求，不代表多进程协调。所有账号、贡献、邮箱均为合成数据，不读 `.env` 或业务库、不发邮件、不触发实际支付。

下表把操作映射到有限等价类，不做身份×资源×时间的无穷笛卡尔积。每行是一组业务断言，不等于一个 `it`；参数化用例按执行实例计数。`R`=readiness、`G`=candidates、`S`=signups、`E`=scores、`P`=prizes、`U`=public、`W`=site、`L`=rehearsal、`I`=identity-boundaries，均为 `tests/server/competition-<名称>.test.ts`。

首次完整命令实际 **297 用例：289通过、8失败、0跳过**（22文件）：当时3项身份集成失败，另5项受loopback/tsx IPC `EPERM`影响。#271合入隔离integration checkout后，候选/演练/readiness/身份边界4文件扩为**74例全过**；这项新证据收口I09–I11，不把5项网络/浏览器未验收改写为通过。

## 有限矩阵（54组）

| ID | 实际操作、组合与预期 | 入口 | 本次结果 |
|---|---|---|---|
| I01 | 访客报名401，不写记录 | R/I01 | 通过 |
| I02 | 注册用户报名403 | R/I02 | 通过 |
| I03 | 有效成员报名200 | R/I03 | 通过 |
| I04 | 往届默认无报名写权限403 | R/I04 | 通过 |
| I05 | 已过期会话401 | R/I05 | 通过 |
| I06 | 停用账号旧会话401 | R/I06 | 通过 |
| I07 | 往届显式授予报名节点后200 | R/I07 | 通过 |
| I08 | 请求前成员组已到期403 | R/I08 | 通过 |
| I09 | `expires_at === now` 会话401，不得报名 | I/I09 | 通过（#271隔离集成） |
| I10 | 预热权限cache后成员组到期403 | I/I10 | 通过（#271隔离集成） |
| I11 | 停用或远端OIDC失配的审核人标签不得计分 | G/I11及远端身份用例 | 通过（#271+#276隔离集成） |
| R01 | 本人报名携带他人account_id拒400，不代办 | R/R01 | 通过 |
| R02 | 个人赛建队409；公开队伍enabled=false/空列表 | R/R02、U、L/L02 | 通过 |
| R03 | 错比赛的积分id不可撤销404 | R/R03 | 通过 |
| R04 | manage/review/redeem仅部门scope不能升全局权限 | R/R04三实例 | 通过 |
| R05 | 审核人不能手工给自己加分或撤自己扣分403 | R前两例 | 通过 |
| R06 | 贡献审核/规则/官网/核销的权限与step-up分离 | G、P、W | 通过 |
| T01 | 筹备且开始前1ms拒competition_planning | R/T01 | 通过 |
| T02 | 筹备标记在开始精确时刻不再阻止报名 | R/T02 | 通过 |
| T03 | 非筹备、开始前但已开放且未截止可报名 | R/T03 | 通过 |
| T04 | 报名截止精确时刻允许 | R/T04 | 通过 |
| T05 | 截止后1ms拒signup_closed | R/T05 | 通过 |
| T06 | 结束精确时刻但报名已截止，拒报名 | R/T06 | 通过 |
| T07 | 结束后1ms拒报名 | R/T07 | 通过 |
| T08 | 设置未开放拒signup_not_enabled | R/T08 | 通过 |
| T09 | 截止=结束，最后1ms允许/下一ms拒；只能结束后定榜 | R/T09 | 通过 |
| B01 | 报名/改备注/取消/重新报名幂等，保留历史 | S | 通过 |
| B02 | 名单/CSV权限、取消记录、注入转义；设置/类型/删除约束 | S、competitions | 通过 |
| B03 | 既有团队功能附近回归：申请/邀请/归属/满员/转让/确认/解散 | S | 通过；非首场主流程 |
| G01 | 只读配置项目；MR、Issue、closed_by全分页 | G/G01 | 通过 |
| G02 | 真实HTTP Adapter超时不计分、不误撤分 | G/G02 | 通过 |
| G03 | 十页仍有下一页、循环游标不得接受截断结果 | G分页用例 | 通过 |
| G04 | 300请求预算耗尽不得落半轮结果 | G/G04 | 通过 |
| G05 | 非merged MR/坏编号/窗外/未知映射/未报名过滤 | G/G05 | 通过 |
| G06 | HTTP等候时取消报名/改项目/审核驳回或接受/定榜，重查当前状态 | G/G06四实例及定榜竞态 | 通过 |
| G07 | 有用及两档各唯一；非作者且有权限的标签事件才计分 | G标签权限例 | 通过 |
| G08 | 429/500/后页失败/部分结果整轮不写、不误撤旧分 | G故障例 | 通过 |
| G09 | 标签撤销仅撤标签自动分；控制台确认不受影响；改两档不重算 | G撤销例 | 通过 |
| E01 | 两档18格/大一大二权重/扣分不乘系数/记录快照不重算 | rubric、E、U | 通过 |
| E02 | 北京周界每人一般×边缘仅1条；撤销后新条可计、旧零分不重算 | G、E | 通过 |
| E03 | 重复记录、重复接受/驳回/撤销拒409；跨人自审拒403 | G、E | 通过 |
| C01 | 并发报名、同贡献计分、收集+重复审核各最多一次 | R/C01–C02、G/G07 | 通过 |
| C02 | 并发定榜/核销各一次，重复不重复发奖 | R/C03 | 通过 |
| A01 | 报名、取消审计失败500且回滚；重试恢复 | R | 通过 |
| A02 | 积分、标签自动记分、接受/驳回、定榜、核销审计失败回滚 | R/A、G/G08 | 通过 |
| F01 | 零分也上榜；定榜前并列1,1,3，后严格名次两榜一致 | E、P、R冻结例 | 通过 |
| F02 | 定榜后积分/候选/规则/报名/设置冻结，延长日期不能绕过 | P、R、G | 通过 |
| P01 | 奖励可选；仅正分按名次给奖；未核销可撤定榜、已核销不可撤 | P | 通过 |
| P02 | 兑奖码仅本人有明文；他人/公开/控制台/审计无明文 | P、U、L | 通过 |
| P03 | 查码归一化、权限、过期step-up、重复核销409、猜码20次限流 | P | 通过 |
| U01 | 公开响应及解码游标不泄露姓名/邮箱/account_id；分页不重漏 | U、R游标例 | 通过 |
| U02 | 预热公开cache后报名/取消即时刷新；CORS/404/限流/SDK错误 | R/P01、U、SDK | 通过 |
| W01 | 坏包/错比赛/权限/签名过期/上传预览发布回滚下线/清理 | W | 通过，inject非浏览器 |
| L01 | 真OAuth路由→报名→贡献→审核→榜→定榜→本人领奖→核销→重启 | L/L01–L02、CLI smoke | 通过，inject非网络 |

54组后台有限矩阵在#271+#276隔离集成中通过；以下4组环境接力**未覆盖**，不混成PASS：

| ID | 交父级验收的有限范围 | 原因 |
|---|---|---|
| X01 | loopback监听、静态入口和真实HTTP cookie往返 | sandbox监听EPERM |
| X02 | 桌面1440×900、手机390×844真实角色操作与截图/对齐 | 父级负责浏览器 |
| X03 | 站点工具5例网络/上游转发错误、发布官网真实sandbox SDK | loopback/tsx IPC受限 |
| X04 | 真实GitLab实例上的OIDC映射、撤权与管理员API响应 | 隔离测试只模拟真实`/users/:id` HTTP形状，不读线上 |

## 复跑

从本task worktree运行（Node22、pnpm9，workers≤2）：

```sh
export PATH=.tools/node/bin:$PATH
pnpm exec vitest run tests/server/competition*.test.ts tests/tooling/contest-*.test.ts tests/console/competition*.test.ts tests/web/*competition*.test.* tests/web/contest-site.test.ts tests/web/portal-team-plaza.test.ts --maxWorkers=2
pnpm exec tsc -p app/server/tsconfig.json --noEmit
pnpm exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --esModuleInterop --skipLibCheck --types node scripts/contest-rehearsal.mts
node --import ./app/server/node_modules/tsx/dist/loader.mjs scripts/contest-rehearsal.mts --smoke
node scripts/contest-score-sim.mjs --seed 278 --contests 5000
```

评分模拟复用既有rubric和固定种子，不能代替路由闭环或作为调规则授权。

## 验证快照（2026-10-27）

- 首次比赛回归完整命令：22文件297例，289通过/8失败/0跳过，另3个监听异常；日志 `/private/tmp/276-final.log`，JSON `/private/tmp/276-final-results.json`。当时8个失败为3个身份缺陷与5个环境失败，未删断言；身份项以后续隔离集成结果为准。
- #271+#276隔离集成红→绿：同一4文件先为55例54过1失败（演练候选`created=0`），合并后扩为74例全过；日志 `competition-merge-red-codex.log`、`competition-merge-green.log`。候选40例同时保留两方业务案例：远端OIDC异步核验与预算、完整分页/坏事件拒绝/明确remove，以及整轮原子事务和等待竞态重查。
- 隔离集成全部server比赛回归：11文件157例全过；类型检查、fixture严格类型检查、`git diff --check`与CLI smoke通过，闭环结果仍为2名选手、2条候选、350/18分、2份奖励、1次核销。
- 邻域 `tests/server/bearer-auth.test.ts`、`tests/server/legacy-database.test.ts`：21例全过；使用合成旧库验证升级/重启，不是读取线上数据库。
- `pnpm typecheck`、`pnpm build`、fixture严格类型检查通过；真实路由CLI smoke验证350/18分、2奖项、1核销和重启持久化通过。构建不等于浏览器已通过。
- `pnpm verify`真实退出1，停在既有 `notes/2026-10-24/crosery/task_276_forum_image_scan.md:47`「收尾后继续记录」；本次未改旧notes或checker。verify后续全库测试与论坛验证未运行，比赛回归、核心构建和类型检查已独立执行。

## loopback浏览器接力

先构建现有前端 `pnpm --filter @yzgc/web build && pnpm --filter @yzgc/console build`，再在允许监听的环境运行：

```sh
node --import ./app/server/node_modules/tsx/dist/loader.mjs scripts/contest-rehearsal.mts --serve --port 5198
# 仅看已完成的冻结/兑奖状态：追加 --completed
```

只绑定127.0.0.1。每次自建临时文件库与随机密钥；退出只删除本次mkdtemp目录，不接触其他实例。生产buildApp不注册`/__rehearsal/*`。

1. 打开 `http://127.0.0.1:5198/__rehearsal/status` 取得本次随机比赛id、门户/控制台链接和5个角色登录地址。角色入口内部经过真实OAuth发起/回调，不预填伪造sid；只模拟外部OAuth HTTP。
2. 分别访问`/__rehearsal/login/alice`、`/bob`（全路径前缀相同），在门户本场报名；检查个人赛无组队。用独立浏览器上下文或顺序切角色，不能混用Cookie。
3. `curl -X POST http://127.0.0.1:5198/__rehearsal/contribute`让模拟GitLab出现2贡献。登录reviewer，控制台本场收集，看到2pending；Alice MR选critical/core、Bob Issue选normal/business并确认。
4. 门户与公开榜应为350、18。reviewer只有审核权，没有定榜/核销权；owner只有通过站长权限才能做全部管理。
5. 在初始化10分钟内`curl -X POST http://127.0.0.1:5198/__rehearsal/end`，或重新登录owner在真实控制台改结束时间（helper也走owner真实PATCH）；owner定榜。
6. Alice登录本人结果看兑奖码；Bob看不到Alice码；redeemer登录凭Alice码查找、核销，再核销409；owner撤定榜409。禁止把兑奖码写入截图公开区或日志。
7. `--completed`模式先经同一真实闭环与重启，再提供冻结结果供截图；它不是人工验收记录。交父级分别记桌面/手机、URL、接口状态与截图，不能用本页旧截图代替。

## 修复与集成边界

本次修复：收集分页/外部失败整轮原子性、等待期间竞态、自审/自撤扣分、门户审计回滚与公开缓存、定榜名单/设置冻结、两榜冻结名次、人员游标隐私。没有改基础分、系数、防刷、奖项规则或新增依赖/数据库结构。

I09/I10由#271身份实现修复；I11冲突收口后，`competition-candidates`把项目/MR/Issue/标签事件和远端OIDC核验全部放在事务外形成快照，再在单个同步SQLite事务中重读比赛、项目、报名、候选与审核权后应用。`GitlabReader.accountForGitlabUser`兼容同步/异步适配器；本task不复制身份实现、不修改#271源码。task/276单独基线仍会保留5个#271身份断言红灯，验收以隔离integration的74/74为准；真实GitLab与浏览器仍须父级验收。
