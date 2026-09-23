# syntax=docker/dockerfile:1.7
# @yzgc/web 运行镜像：Vite 产物（portal + admin）+ nginx 静态托管与反代。
#
# 构建上下文 = 仓库根（geek_main/）：
#   docker build --build-arg GEEK_DEPLOYMENT_ENVIRONMENT=production \
#     --build-arg GEEK_RELEASE_VERSION=0.1.0 --build-arg GEEK_RELEASE_COMMIT=<sha> \
#     -f app/web/Dockerfile -t yzgc/web:<sha12> .
#
# 容器内监听 8080（非特权端口，以 nginx 用户运行）；宿主暴露由 compose 的
# 127.0.0.1:<WEB_BIND> 控制。宿主 nginx 只做 TLS 终止与 server_name 转发。
#
# SPA 入口按 host 选择，但选择依据不是 Host 头，而是宿主 nginx 注入的
# X-YZGC-Site（admin | portal）：这样镜像不需要把域名写成构建参数，
# 同一个镜像文件在不同环境的事实来源仍然是各自的宿主 nginx 配置。
# 直连容器（不带该头）时回落官网，与旧行为一致。
#
# 反代约定（与 app/server 路由、deploy/compose/*.yml 一致）：
#   /api/、/auth、/healthz → server:3000（Fastify）
#   /forum、/forum/        → forum:3000（Nuxt 产物以 /forum/ 为 baseURL 构建，转发时剥前缀）
# 安全头（HSTS/CSP 等）由宿主 nginx 统一加，容器不重复下发，避免同一响应带两份 CSP。

# ── 构建阶段：装依赖 → 渲染前端配置 → Vite 构建 → 生成 release.json 与 nginx 配置 ──
FROM node:22-bookworm-slim AS builder

ENV CI=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable \
 && corepack prepare pnpm@9.15.9 --activate \
 && pnpm --version

WORKDIR /repo

# 依赖层：只复制工作区清单（根工作区成员 = app/server, app/web）。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/server/package.json app/server/package.json
COPY app/web/package.json app/web/package.json
RUN pnpm install --frozen-lockfile --filter @yzgc/web...

# 构建输入逐项列出（不写 COPY . .）：宿主 node_modules / dist / tsbuildinfo
# 绝不能进上下文，否则会覆盖镜像里刚装好的 linux 依赖。
# scripts/ 与 app/server/src 是 @yzgc/web build 里 check-boundaries.mjs 的输入。
COPY scripts scripts
COPY app/server/src app/server/src
COPY app/server/tsconfig.json app/server/tsconfig.json
# 目录必须逐个 COPY：一条 COPY 列多个目录时，Docker 复制的是各目录的「内容」，
# sites/、shared/、public/ 会被摊平进 app/web/（app.config.json 因此找不到）。
COPY app/web/sites app/web/sites
COPY app/web/shared app/web/shared
COPY app/web/public app/web/public
COPY app/web/package.json app/web/tsconfig.json app/web/vite.config.ts app/web/postcss.config.js \
     app/web/tailwind.config.js app/web/vite-env.d.ts app/web/
# render-web-config.mjs 经 deployment-environment.mjs 读取环境身份契约与入库的环境模板
# （模板里密钥字段一律留空）。只在构建阶段使用，运行阶段不复制 deploy/。
COPY deploy/environments.json deploy/environments.json
COPY deploy/env deploy/env

ARG GEEK_DEPLOYMENT_ENVIRONMENT
ARG GEEK_RELEASE_VERSION=""
ARG GEEK_RELEASE_COMMIT=""

# app.config.json 的 host 必须与环境一致（server 在生产启动时会比对），
# 渲染脚本由仓库统一维护，此处只调用、不实现。
RUN test -n "$GEEK_DEPLOYMENT_ENVIRONMENT" \
 && test -f scripts/render-web-config.mjs \
 && node scripts/render-web-config.mjs --environment "$GEEK_DEPLOYMENT_ENVIRONMENT" \
 && pnpm --filter @yzgc/web build

# 发布身份元数据：静态文件，宿主 nginx 原样透传 /release.json。
# 取值只来自构建参数；先按字符白名单校验再拼 JSON，避免构建参数破坏 JSON 结构。
RUN set -eu; \
    case "${GEEK_DEPLOYMENT_ENVIRONMENT}" in production|preview|development) : ;; *) echo "非法环境：${GEEK_DEPLOYMENT_ENVIRONMENT}" >&2; exit 1 ;; esac; \
    if [ -n "${GEEK_RELEASE_VERSION}" ]; then case "${GEEK_RELEASE_VERSION}" in *[!0-9A-Za-z._@+-]*) echo "非法版本号：${GEEK_RELEASE_VERSION}" >&2; exit 1 ;; esac; fi; \
    if [ -n "${GEEK_RELEASE_COMMIT}" ]; then case "${GEEK_RELEASE_COMMIT}" in *[!0-9a-f]*) echo "非法 commit：${GEEK_RELEASE_COMMIT}" >&2; exit 1 ;; esac; fi; \
    mkdir -p /release; \
    printf '{\n  "environment": "%s",\n  "version": "%s",\n  "commit": "%s",\n  "builtAt": "%s"\n}\n' \
      "${GEEK_DEPLOYMENT_ENVIRONMENT}" "${GEEK_RELEASE_VERSION}" "${GEEK_RELEASE_COMMIT}" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /release/release.json; \
    cat /release/release.json

# 容器内 nginx 配置：全部静态、与环境无关，环境差异只体现为域名与证书（宿主侧）。
RUN mkdir -p /nginx-out/conf.d
COPY <<'NGINX_MAIN' /nginx-out/nginx.conf
worker_processes auto;
error_log /dev/stderr warn;
pid /tmp/nginx.pid;
events {
    worker_connections 1024;
}
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    access_log /dev/stdout;
    sendfile on;
    tcp_nopush on;
    keepalive_timeout 65;
    server_tokens off;
    client_body_temp_path /tmp/client_temp;
    proxy_temp_path /tmp/proxy_temp;
    fastcgi_temp_path /tmp/fastcgi_temp;
    uwsgi_temp_path /tmp/uwsgi_temp;
    scgi_temp_path /tmp/scgi_temp;
    include /etc/nginx/conf.d/*.conf;
}
NGINX_MAIN

COPY <<'NGINX_SITE' /nginx-out/conf.d/10-web.conf
# SPA 入口选择：宿主 nginx 为每个 server block 显式注入 X-YZGC-Site，
# 客户端自带的值会被宿主覆盖，未知值时回落官网。
map $http_x_yzgc_site $yzgc_spa_entry {
    default                  sites/portal/index.html;
    portal                   sites/portal/index.html;
    admin                    sites/admin/index.html;
}

server {
    listen 8080;
    server_name _;

    root /usr/share/nginx/html;
    server_tokens off;

    # 上传走 /api/*，与宿主 nginx 保持同一个上限，否则容器会先拒掉大包。
    client_max_body_size 6m;

    gzip on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/javascript application/json application/xml image/svg+xml application/wasm;

    access_log /dev/stdout;
    error_log /dev/stderr warn;

    # 发布身份元数据：必须实时，不能被缓存。
    location = /release.json {
        add_header Cache-Control "no-store" always;
        try_files $uri =404;
    }

    # ── 后端接口：一个都不能漏（/auth 是 OAuth 回调）──
    location /api/ {
        proxy_pass http://server:3000;
        include /etc/nginx/conf.d/90-proxy-headers.conf;
    }
    location = /auth {
        proxy_pass http://server:3000;
        include /etc/nginx/conf.d/90-proxy-headers.conf;
    }
    location /auth/ {
        proxy_pass http://server:3000;
        include /etc/nginx/conf.d/90-proxy-headers.conf;
    }
    # 健康检查：让部署脚本能从 web 入口验证「web → server」整条链路。
    location = /healthz {
        proxy_pass http://server:3000;
        include /etc/nginx/conf.d/90-proxy-headers.conf;
        access_log off;
    }

    # ── 论坛：产物以 /forum/ 为 baseURL，转发时剥掉前缀，容器内即站点根 ──
    location = /forum {
        return 308 /forum/;
    }
    location /forum/ {
        proxy_pass http://forum:3000/;
        include /etc/nginx/conf.d/90-proxy-headers.conf;
    }

    # 带内容哈希的构建产物：内容不变则文件名不变，可以长缓存。
    location /assets/ {
        expires 1y;
        try_files $uri =404;
        access_log off;
    }
    # 未哈希的图片/字体/图标：短缓存。
    location ~* \.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf)$ {
        expires 7d;
        try_files $uri =404;
        access_log off;
    }
    # SPA 入口：每次部署都换哈希，必须回源校验。
    location /sites/ {
        expires -1;
        try_files $uri =404;
    }

    # 其余路径按宿主注入的站点标识回落到对应 SPA 入口（React Router 深链接）。
    location / {
        try_files $uri /$yzgc_spa_entry;
    }
}
NGINX_SITE

COPY <<'NGINX_HEADERS' /nginx-out/conf.d/90-proxy-headers.conf
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header Connection "";
proxy_read_timeout 60s;
NGINX_HEADERS

# ── 运行阶段：nginx 1.31（alpine），以 nginx 用户（uid 101）运行 ──
# 版本说明：任务书建议的 1.27 已从 Docker Hub 下线（官方只维护 1.30/1.31 两条线），
# 1.31 也是本地实测配置所用的版本（nginx 1.31.6）。
FROM nginx:1.31-alpine AS runtime

# 运行阶段也保留发布身份：只为 `docker inspect` 能追溯「这个镜像对应哪次构建」，
# 静态产物与进程都不读它们（运行时的事实来源仍是 env 文件）。
ARG GEEK_DEPLOYMENT_ENVIRONMENT
ARG GEEK_RELEASE_VERSION=""
ARG GEEK_RELEASE_COMMIT=""
ENV GEEK_DEPLOYMENT_ENVIRONMENT=${GEEK_DEPLOYMENT_ENVIRONMENT} \
    GEEK_RELEASE_VERSION=${GEEK_RELEASE_VERSION} \
    GEEK_RELEASE_COMMIT=${GEEK_RELEASE_COMMIT}

# 官方镜像已把 /usr/share/nginx/html 设为站点根并自带 nginx 用户；内容整体替换。
RUN rm -rf /usr/share/nginx/html /etc/nginx/conf.d/*
COPY --from=builder /repo/app/web/dist /usr/share/nginx/html
COPY --from=builder /release/release.json /usr/share/nginx/html/release.json
COPY --from=builder /nginx-out/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /nginx-out/conf.d/ /etc/nginx/conf.d/

# 用数字 UID：nginx 官方镜像里 nginx 用户就是 101，数字形式不依赖平台的名字解析。
USER 101:101

EXPOSE 8080

# 健康检查必须用 shell 形式（要拿 `|| exit 1` 表达失败）。
# hadolint ignore=DL3025
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:8080/release.json || exit 1

CMD ["nginx", "-g", "daemon off;"]
