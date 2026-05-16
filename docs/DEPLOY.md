# 部署指南

## 前置

- 一台 Linux 服务器（Ubuntu 22.04 验证过）
- 一个域名（HTTPS 必需）
- 一个 GitHub OAuth App（在你的组织设置里创建）

## OAuth App 配置

去 `https://github.com/organizations/<org>/settings/applications/new`：

- Application name: 任意（如 `Geek Class Admin`）
- Homepage URL: `https://<你的域名>`
- Authorization callback URL: `https://<你的域名>/auth/callback`

创建后记下 Client ID + Client Secret（secret 只显示一次）。

## DNS

把你的域名 A 记录指向服务器 IP。`dig <域名> +short` 看到 IP 才算生效。

## 服务器准备

```bash
# Node 20（NodeSource）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git
sudo npm install -g pnpm@9

# 加 swap（2GB 内存机器 build 容易爆）
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
```

## 拉代码 + 配置 + build

```bash
sudo git clone git@github.com:Yangtze-University-Geek-Class/admin.git /opt/yzgc-admin
cd /opt/yzgc-admin
sudo cp .env.example .env
sudo vi .env
```

`.env` 必填：

```ini
OAUTH_CLIENT_ID=<client id>
OAUTH_CLIENT_SECRET=<client secret>
PUBLIC_ORIGIN=https://<你的域名>
PORT=3000
SESSION_SECRET=<openssl rand -base64 32 生成>
ENCRYPTION_KEY=<openssl rand -base64 32 生成>
DB_PATH=/opt/yzgc-admin/data/data.db
# 选填
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

```bash
sudo chmod 600 .env
sudo pnpm install --frozen-lockfile
sudo pnpm -r run build
```

## systemd

```bash
sudo install -m 644 deploy/yzgc-admin.service /etc/systemd/system/yzgc-admin.service
sudo mkdir -p /opt/yzgc-admin/data
sudo systemctl daemon-reload
sudo systemctl enable --now yzgc-admin
sudo systemctl status yzgc-admin
curl http://127.0.0.1:3000/healthz   # 应返回 {"ok":true,...}
```

## nginx + 证书

如果你的 nginx 已经有别的 server block 在主 `nginx.conf` 里，确认 `http {}` 块里有 `include /etc/nginx/sites-enabled/*;`，没有就加一行。

```bash
sudo install -m 644 deploy/nginx.conf /etc/nginx/sites-available/<你的域名>
sudo ln -sf /etc/nginx/sites-available/<你的域名> /etc/nginx/sites-enabled/<你的域名>

# 先把 nginx.conf 改成 80 only（去掉 443 监听），重载，让 certbot 申请证书
sudo certbot --nginx -d <你的域名> --email you@example.com --agree-tos --redirect

# 申请完装回完整 config（含 443）
sudo install -m 644 deploy/nginx.conf /etc/nginx/sites-available/<你的域名>
sudo nginx -t && sudo systemctl reload nginx
```

## 验证

```bash
curl https://<你的域名>/healthz   # {"ok":true,...}
```

浏览器打开 `https://<你的域名>/` 应看到 Landing 页。

## 升级

```bash
cd /opt/yzgc-admin
sudo git pull
sudo pnpm install --frozen-lockfile
sudo pnpm -r run build
sudo systemctl restart yzgc-admin
```

如果 better-sqlite3 因 Node major 版本变化导致 `ERR_DLOPEN_FAILED`：

```bash
cd /opt/yzgc-admin/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
sudo npm run build-release
sudo systemctl restart yzgc-admin
```

## 备份

数据库就一个 SQLite 文件：

```bash
# 每天 cron 复制一份
0 3 * * * cp /opt/yzgc-admin/data/data.db /backup/yzgc-admin/data-$(date +\%F).db
```

恢复直接覆盖回去 + 重启服务。

## 故障排查

```bash
# 日志
sudo tail -f /var/log/yzgc-admin.log
sudo journalctl -u yzgc-admin -f

# nginx 日志
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log

# 重新申请证书
sudo certbot renew --dry-run
```

| 症状 | 检查 |
|---|---|
| 启动失败 ERR_DLOPEN_FAILED | better-sqlite3 native rebuild（上面命令） |
| OAuth 跳回报 invalid_state | 服务器时钟偏差太大；同步 NTP |
| 登录后 repos 列表空 | OAuth scope 没 `repo`；改 server/src/config.ts 重 build 重登录 |
| 网页打不开 502 | yzgc-admin 服务挂了；`systemctl status` 看 |
| 网页打不开 444 / 526 | nginx 在 listen 但 server_name 没匹配；检查 `nginx -T \| grep server_name` |
