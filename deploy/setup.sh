#!/usr/bin/env bash
# Run as root on the server.
set -euo pipefail

APP_DIR=/opt/yzgc-admin
DOMAIN=github.yangtzeu.work

cd "$APP_DIR"

corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@9.15.9 --activate >/dev/null 2>&1 || true

pnpm install --frozen-lockfile
pnpm -r run build

install -m 644 deploy/yzgc-admin.service /etc/systemd/system/yzgc-admin.service
install -m 644 deploy/nginx.conf /etc/nginx/sites-available/${DOMAIN}
ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/${DOMAIN}

if [ ! -d /etc/letsencrypt/live/${DOMAIN} ]; then
  certbot certonly --nginx -d ${DOMAIN} --non-interactive --agree-tos --email "${LE_EMAIL:-admin@yangtzeu.work}" --redirect
fi

nginx -t
systemctl reload nginx
systemctl daemon-reload
systemctl enable yzgc-admin
systemctl restart yzgc-admin

echo "deployed. tail -f /var/log/yzgc-admin.log"
