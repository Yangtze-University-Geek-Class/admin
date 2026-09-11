# yzgc-admin

Yangtze University Geek Class — 多 GitHub 组织统一管理后台。

线上：https://github.yangtzeu.work/

## 它做什么

- 用 GitHub 账号登录，自动列出你 owner / member 的所有组织
- 按 GitHub 组织角色分权：org admin 看到全功能，member 只读
- 仓库深度管理：代码浏览（按分支）、commit 历史 + diff、issues、PRs、协作者增删、新建 / 删除仓库
- 临时邀请链接：admin 生成带有效期 + 次数 + 自动加入 team 的链接，发出去任何人凭链接填用户名即可自动收到邀请
- 组织级设置同步：默认仓库权限、可创建 / fork / 删仓 / 改可见性 等开关一处管
- 团队 CRUD
- 成员管理：升降级 / 移除
- 活动流：组织最近 push / PR / issue / release
- 安全：Dependabot 警报（Pro+ 才有数据）、Audit log 状态
- 意见箱：任何人都能向某个组织提建议 / 报 bug；admin 在后台分类、回复、改状态
- 操作日志：所有 admin 操作（包括公开页提交）都入 SQLite，可审计
- 官网主站：品牌落地页，柔和校徽蓝白浅色主题 + 看板娘模块（全站唯一浅色主题，无深色模式）
- 论坛：技术讨论社区（帖子 / 分类 / 用户 / 通知 / 老师面板），与管理后台共用登录体系

## 三个站点

- 官网（portal）：https://yangtzeu.work/
- 论坛（forum）：https://forum.yangtzeu.work/
- 管理后台（admin）：https://github.yangtzeu.work/

同一个 Vite 项目按域名渲染不同站点，切换逻辑见 [docs/architecture/ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md)。

## 谁能用

- **普通用户**：去 https://github.yangtzeu.work/ 登录，自动看到你的 org 列表
- **组织 admin**：所有管理操作均可用
- **组织 member**：只读视图，看不到 admin 操作按钮
- **完全外部访客**：可访问 `/feedback/<org-login>` 提交意见，可凭 `/join/<token>` 链接申请加入

## 上手最快路径

1. 打开 https://github.yangtzeu.work/
2. 点"使用 GitHub 登录"，授权 OAuth（首次需要点 GitHub 的 Authorize）
3. 选择一个你 owner / member 的组织进入后台
4. 详细用法见 [docs/ops/USAGE.md](./docs/ops/USAGE.md)

## 技术栈

| 层 | 选择 |
|---|---|
| 反代 + HTTPS | nginx + certbot（Let's Encrypt） |
| 后端 | Node 20 + Fastify + Octokit + better-sqlite3 |
| 数据库 | SQLite（单文件，WAL 模式） |
| 前端 | Vite + React 18 + Tailwind + React Query + React Router |
| 进程 | systemd |
| 鉴权 | GitHub OAuth App（admin:org + repo + read:user + read:org + user:email） |
| 防 spam | Cloudflare Turnstile（可选）+ IP 频率限制 |

## 本地开发

```bash
cp .env.example .env
# 填好 OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET
# SESSION_SECRET=$(openssl rand -base64 32)
# ENCRYPTION_KEY=$(openssl rand -base64 32)
# PUBLIC_ORIGIN=http://localhost:5173
pnpm install
pnpm dev
```

server 跑在 `127.0.0.1:3000`，web dev server 跑在 `5173`（带 proxy 转发到后端）。

只做前端（不配 OAuth / 不起后端）也可以：

```bash
pnpm --filter @yzgc/web dev
```

页面右上角 `DEV CONTROL` 默认使用本地 mock 数据，可浏览官网 / 论坛 / 管理后台全部页面；随时切回真实 API。

## 部署

```bash
# 服务器
git clone git@github.com:Yangtze-University-Geek-Class/admin.git /opt/yzgc-admin
cd /opt/yzgc-admin
cp .env.example .env   # 填好生产值，注意 PUBLIC_ORIGIN 必须是 https
pnpm install --frozen-lockfile
pnpm -r run build
install -m 644 deploy/yzgc-admin.service /etc/systemd/system/
install -m 644 deploy/nginx.conf /etc/nginx/sites-available/<domain>
ln -s /etc/nginx/sites-available/<domain> /etc/nginx/sites-enabled/<domain>
certbot --nginx -d <domain>
systemctl daemon-reload && systemctl enable --now yzgc-admin
```

详见 [docs/ops/DEPLOY.md](./docs/ops/DEPLOY.md)。

## 文档

- 人工入口（改什么 → 看哪篇）：[docs/README.md](./docs/README.md)
- 全部文档的生成索引：[docs/INDEX.md](./docs/INDEX.md)

主要几篇：

- [USAGE.md](./docs/ops/USAGE.md) — 用户指南，含管理员 / 普通用户 / 外部访客三视角
- [DEPLOY.md](./docs/ops/DEPLOY.md) — 部署 + 运维
- [ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md) — 后端路由 / 数据库 / OAuth 流程 / 安全模型
- [CONTRIBUTING.md](./docs/conventions/CONTRIBUTING.md) — 贡献流程总入口
- [COMMITS.md](./docs/conventions/COMMITS.md) — commit 规范
- [ISSUES.md](./docs/conventions/ISSUES.md) — Issue 规范
- [PULL-REQUESTS.md](./docs/conventions/PULL-REQUESTS.md) — PR 规范
- [DESIGN.md](./docs/design/DESIGN.md) — 页面设计规范
- [STACK.md](./docs/design/STACK.md) — 技术栈与版本基线
- [WEB-SPLIT.md](./docs/plan/WEB-SPLIT.md) — 前端三站拆分方案
- [REFACTOR.md](./docs/plan/REFACTOR.md) — 前端现状盘点

## License

私有项目，仅供 Yangtze-University-Geek-Class 组织内部使用。
