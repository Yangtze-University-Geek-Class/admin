# yzgc-admin

GitHub 组织管理后台 + 公开邀请页，给 Yangtze-University-Geek-Class 用。

## 功能

- 公开邀请页 `/`：访客填 GitHub 用户名或邮箱 → Cloudflare Turnstile + IP 频率限制 → 自动 invite 到组织
- 管理后台 `/admin`：用 GitHub OAuth 登录，仅 admin login 可进
  - 总览 / 成员 / 邀请（pending + 历史）/ 团队 / 仓库 / 仓库详情 / 活动流 / 安全 / 组织资料 / 操作日志

## 技术栈

- Server: Fastify + Octokit + better-sqlite3
- Web: Vite + React + Tailwind
- Reverse proxy: nginx + certbot
- Process: systemd

## 本地开发

```bash
cp .env.example .env  # 填好 OAuth, SESSION_SECRET (openssl rand -base64 32), ENCRYPTION_KEY (openssl rand -base64 32)
pnpm install
pnpm dev  # server 在 3000, web 在 5173
```

## 部署到服务器

```bash
ssh root@server "mkdir -p /opt/yzgc-admin"
rsync -avz --exclude node_modules --exclude dist --exclude data --exclude .env ./ root@server:/opt/yzgc-admin/
ssh root@server "scp .env root@server:/opt/yzgc-admin/.env"  # 或者手动 vi
ssh root@server "cd /opt/yzgc-admin && bash deploy/setup.sh"
```
