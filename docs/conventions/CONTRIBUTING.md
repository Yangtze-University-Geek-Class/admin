# 贡献规范

> 本文件是贡献流程的总入口。改代码之前，先读 [AGENTS.md](../../AGENTS.md) §0 —— 它要求先停下来查 `docs/` 里对应的那篇。
> English: [CONTRIBUTING.en.md](./CONTRIBUTING.en.md)

---

## 0. 这个项目是什么

`yzgc-admin` —— 长江大学极客班（YUGC）的线上系统。**一个代码库渲染三个站点**：

| 站点 | 线上地址 | 面向 |
|---|---|---|
| 官网 portal | https://yangtzeu.work | 校内外所有人，匿名 |
| 论坛 forum | https://yangtzeu.work/forum | 注册用户 |
| 组织管理后台 admin | https://github.yangtzeu.work | 有 GitHub 组织权限的成员 |

三者共用一份前端产物与一个后端进程。站点边界、目录归属与拆分计划见 [WEB-SPLIT.md](../plan/WEB-SPLIT.md)。

---

## 1. 第一次上手

```bash
# 环境：Node 20 LTS（22 也可）、pnpm 9
# 注意：Node 24+ 本地可能装不上 better-sqlite3（原生模块编译失败）。
# 实测 20.20.2 正常。用 fnm/nvm 切到 20 即可。
git clone git@github.com:Yangtze-University-Geek-Class/admin.git
cd admin
pnpm install --frozen-lockfile

cp .env.example .env
# 填 OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET 等，见 .env.example 注释
# SESSION_SECRET=$(openssl rand -base64 32)
# ENCRYPTION_KEY=$(openssl rand -base64 32)

pnpm dev            # server :3000 + vite :5173
```

只做前端、不需要后端时：

```bash
pnpm --filter @yzgc/web dev
```

开发态默认走本地 mock 数据（`web/shared/lib/mock-api.ts`），可浏览全部页面。数据源切换见页面上的 `DEV CONTROL` 面板或 URL 参数 `?__data=live`。

**注意**：mock 层用正则尾匹配而非路径前缀（`/overview$`、`/members$`），改动任何 API 路径都要同步改 mock，否则开发态会静默返回错误数据。

---

## 2. 改代码的完整流程

```
0. 读文档          AGENTS.md §0 的对照表 → 打开对应的 docs/*.md
1. 建分支          从 main（或 next）切出 feat/xxx 或 fix/xxx
2. 改代码 + 改文档  同一次提交，映射关系见 AGENTS.md §4.7
3. 本地验证        类型检查 / 构建 / 实际操作页面
4. 提交            type(scope): 中文简述 —— 见 COMMITS.md
5. 开 PR           gh pr create —— 见 PULL-REQUESTS.md
6. Review          按 PULL-REQUESTS.md §4 的检查项
7. 合并            由人执行，不由 AI 自动合并
8. 部署            见 §5
```

第 0 步不是可选项。这个仓库已经因为跳过它积累了若干缺陷（死链、缺失的净化、与页面不匹配的 mock），全部记录在 [REFACTOR.md](../plan/REFACTOR.md) §8。

---

## 3. 三类规范

| 规范 | 文档 | 管什么 |
|---|---|---|
| 提交 | [COMMITS.md](./COMMITS.md) | commit 的 type / scope / 正文写法 |
| Issue | [ISSUES.md](./ISSUES.md) | 缺陷与需求怎么提、标签怎么打、怎么关 |
| PR | [PULL-REQUESTS.md](./PULL-REQUESTS.md) | 分支模型、PR 描述、review 检查项、合并 |
| 页面 | [DESIGN.md](../design/DESIGN.md) | 视觉与交互规范：无障碍标准、设计系统、组件约定 |
| 技术栈 | [STACK.md](../design/STACK.md) | 重构采用的目标框架与版本，及各框架的用法要点 |

---

## 4. 硬性约束（违反会被退回）

这些是 `AGENTS.md` §4 的不变量，摘要如下：

1. **Tailwind 颜色必须走 CSS 变量**，`web/{sites,shared}/**` 里禁止硬编码 hex。
2. **禁止原生 `<select>` 与 `window.confirm()`**，用 `shared` 里的 `Select` 与 `useConfirm()`。
3. **后端 admin 路由**必须同时有 `requireAuth` 与 `requireOrgRole(...)`，变更操作必须 `audit(...)`。
4. **GitHub 调用一律用登录者本人的 token**（`req.session.accessToken`）；service token 只服务于公开邀请链接流程。
5. **SQLite schema 只增不减**：只允许 `ALTER TABLE ADD COLUMN`，禁止 drop、禁止重排。
6. **改代码必须同步改文档**（`AGENTS.md` §4.7 有完整映射表）。
7. **跨站跳转走 `externalUrl()`**，禁止在站点 A 的代码里写指向站点 B 路由的站内 `Link`。

---

## 5. 部署

**AI 不得自行部署。** 部署由人执行。

```bash
ssh root@103.117.123.226 -p 22000
cd /opt/yzgc-admin
cp -a web/dist web/dist.bak-$(date +%Y%m%dT%H%M%S)   # 先备份
git fetch origin main && git merge --ff-only origin/main
pnpm --filter @yzgc/web build
systemctl restart yzgc-admin
```

回滚：

```bash
rm -rf web/dist && mv web/dist.bak-<时间戳> web/dist
git reset --hard <旧 commit>
systemctl restart yzgc-admin
```

完整 runbook（nginx、certbot、故障排查表）见 [DEPLOY.md](../ops/DEPLOY.md)。

---

## 6. 环境与权限

| 资源 | 位置 |
|---|---|
| 生产服务器 | `103.117.123.226:22000`（root） |
| 应用目录 | `/opt/yzgc-admin` |
| 数据库 | `/opt/yzgc-admin/data/{data,forum}.db`（WAL） |
| 环境变量 | `/opt/yzgc-admin/.env`（chmod 600） |
| systemd | `yzgc-admin.service` |
| 日志 | `/var/log/yzgc-admin.log`、`journalctl -u yzgc-admin` |

**凭据不进 Git。** 只登记变量名与用途（`.env.example`）。密钥、token、密码一律不写进代码、文档、日志或回复。

---

## 7. 沟通约定

- 中文沟通，结论前置。
- 不写"我接下来要…"这类预告，直接动手，做完报结果。
- 不写时间估算。
- 不用 emoji（chat、docs、commit、UI 文案均不用）。
- 报结果时写清：**改了什么、验证了什么、还有什么没验证**。

完整偏好见 `AGENTS.md` §8。

---

## 8. 遇到歧义怎么办

- **能从代码/文档/历史查到的**：自己查，不要问。
- **会影响行为、接口、依赖、数据、安全的决策**：列出证据与建议方案，等人拍板，同时继续做不依赖该决策的部分。
- **文档与代码冲突**：以代码为准，但要在同一次改动里修正文档，不要沉默地绕过。
- **不确定算不算重复 issue**：新建并标注可能相关（见 [ISSUES.md](./ISSUES.md) §0）。
