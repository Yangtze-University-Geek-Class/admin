# forum.yangtzeu.work 子站接入步骤

需要你做的一件事：去 DNSPod 加 A 记录。剩下我会自动跑完。

## 1. DNS · 你来操作

DNSPod 控制台 → yangtzeu.work → 添加记录：

| 主机记录 | 记录类型 | 记录值              | TTL |
| -------- | -------- | ------------------- | --- |
| forum    | A        | 103.117.123.226     | 600 |

加完后用 `dig +short forum.yangtzeu.work` 看到 `103.117.123.226` 即生效。

## 2. 签证书 + 拉起子站 · DNS 生效后服务器跑

```bash
sshpass -p 'YZjkb2024' ssh -p 22000 root@103.117.123.226 '
certbot certonly --webroot -w /var/www/html \
  -d forum.yangtzeu.work \
  --email crosery@yangtzeu.work --agree-tos --no-eff-email --non-interactive
'
```

## 3. 加 nginx server block · 我自动

证书出来后我会自动编辑 `/etc/nginx/nginx.conf` 加上 `forum.yangtzeu.work :443` server block，
proxy 到 `127.0.0.1:3000`。前端 SPA 通过 `detectSite()` 检测 host=forum.yangtzeu.work 时自动渲染论坛 UI 和论坛主题。
