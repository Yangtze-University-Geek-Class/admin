# Deployment

## Prerequisites

- Linux server (verified on Ubuntu 22.04)
- A domain name (HTTPS required)
- A GitHub OAuth App (in your org settings)

## OAuth App

Create at `https://github.com/organizations/<org>/settings/applications/new`:

- Application name: anything (e.g. `Geek Class Admin`)
- Homepage URL: `https://<your-domain>`
- Authorization callback URL: `https://<your-domain>/auth/callback`

Record the Client ID + Client Secret (secret is shown once only).

## DNS

Point your domain's A record to the server IP. `dig <domain> +short` must resolve.

## Server prep

```bash
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git
sudo npm install -g pnpm@9

# Add swap (2GB RAM is tight for builds)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
```

## Clone + configure + build

```bash
sudo git clone git@github.com:Yangtze-University-Geek-Class/admin.git /opt/yzgc-admin
cd /opt/yzgc-admin
sudo cp .env.example .env
sudo vi .env
```

Required `.env`:

```ini
OAUTH_CLIENT_ID=<client id>
OAUTH_CLIENT_SECRET=<client secret>
PUBLIC_ORIGIN=https://<your-domain>
PORT=3000
SESSION_SECRET=<openssl rand -base64 32>
ENCRYPTION_KEY=<openssl rand -base64 32>
DB_PATH=/opt/yzgc-admin/data/data.db
POW_DIFFICULTY=5
# Optional
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
curl http://127.0.0.1:3000/healthz   # expect {"ok":true,...}
```

## nginx + cert

If your `nginx.conf` already has other server blocks inline, ensure the `http {}` block has `include /etc/nginx/sites-enabled/*;`. Add the line if missing.

```bash
sudo install -m 644 deploy/nginx.conf /etc/nginx/sites-available/<domain>
sudo ln -sf /etc/nginx/sites-available/<domain> /etc/nginx/sites-enabled/<domain>

# Strip 443 listen temporarily so certbot can issue cert via HTTP-01
sudo certbot --nginx -d <domain> --email you@example.com --agree-tos --redirect

# Restore full config (with 443 + security headers)
sudo install -m 644 deploy/nginx.conf /etc/nginx/sites-available/<domain>
sudo nginx -t && sudo systemctl reload nginx
```

## Verify

```bash
curl https://<domain>/healthz   # {"ok":true,...}
```

Open the site in a browser; you should see the landing page.

## Upgrade

```bash
cd /opt/yzgc-admin
sudo git pull
sudo pnpm install --frozen-lockfile
sudo pnpm -r run build
sudo systemctl restart yzgc-admin
```

If `better-sqlite3` fails with `ERR_DLOPEN_FAILED` after a Node major bump:

```bash
cd /opt/yzgc-admin/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
sudo npm run build-release
sudo systemctl restart yzgc-admin
```

## Backup

One SQLite file. Daily cron:

```bash
0 3 * * * cp /opt/yzgc-admin/data/data.db /backup/yzgc-admin/data-$(date +\%F).db
```

Restore: overwrite and restart.

## Troubleshooting

```bash
sudo tail -f /var/log/yzgc-admin.log
sudo journalctl -u yzgc-admin -f
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
sudo certbot renew --dry-run
```

| Symptom | Check |
|---|---|
| Boot fails `ERR_DLOPEN_FAILED` | `better-sqlite3` native rebuild |
| OAuth callback `invalid_state` | Server clock drift; sync NTP |
| Repos list empty after sign-in | OAuth scope missing `repo`; edit `server/src/config.ts`, rebuild, re-sign-in |
| 502 | yzgc-admin service down; `systemctl status` |
| 444 / no server_name match | `nginx -T \| grep server_name` |
| PoW failing for users | `POW_DIFFICULTY` too high; lower in .env and restart |
