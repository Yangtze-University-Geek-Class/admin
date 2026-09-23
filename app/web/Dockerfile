# syntax=docker/dockerfile:1.7
# @yzgc/web 运行镜像：Vite 产物（portal + admin）+ nginx 静态托管与反代。
#
# 构建上下文 = 仓库根（geek_main/）：
#   docker build --build-arg GEEK_DEPLOYMENT_ENVIRONMENT=production \
#     --build-arg GEEK_RELEASE_VERSION=0.1.0 --build-arg GEEK_RELEASE_COMMIT=<sha> \
#     -f app/web/Dockerfile -t yzgc-production/web:<sha12> .
#   （镜像仓库按环境分开：预发布构建用 yzgc-preview/web，正式构建用 yzgc-production/web，见 docs/ops/DEPLOY.md）
#
# 容器内监听 8080（非特权端口，以 nginx 用户运行）；宿主暴露由 compose 的
# 127.0.0.1:<WEB_BIND> 控制。宿主 nginx 只做 TLS 终止与 server_name 转发。
#
# 每个环境只有一个域名，SPA 入口只按 URL 路径选择，与 Host 头无关：
#   /admin、/admin/…、/console、/console/…、/signin → sites/admin/index.html
#   其余路径                                         → sites/portal/index.html
# 规则与 app/server/src/app.ts 的 resolveSiteEntry 保持一致。镜像里不含任何域名，
# 同一个镜像在两个环境通用。
#
# 反代约定（与 app/server 路由、deploy/compose/*.yml 一致）：
#   /api/、/auth、/healthz → server:3000（Fastify）
#   /forum、/forum/        → forum:3000（Nuxt 产物以 /forum/ 为 baseURL 构建，转发时剥前缀）
# 安全头（HSTS/CSP 等）由宿主 nginx 统一加，容器不重复下发，避免同一响应带两份 CSP。

# ── 构建阶段：装依赖 → Vite 构建 → 生成 release.json 与 nginx 配置 ──
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

ARG GEEK_DEPLOYMENT_ENVIRONMENT
ARG GEEK_RELEASE_VERSION=""
ARG GEEK_RELEASE_COMMIT=""

# 前端产物与环境无关（app.config.json 不含域名），环境名只进下面的 release.json。
RUN test -n "$GEEK_DEPLOYMENT_ENVIRONMENT" \
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
# tests/tooling/web-nginx.test.ts 会从本文件抽出这三段配置，用本机 nginx 实跑路径分流。
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

    # ── 管理端 SPA 入口：路径清单与入口文件都只写在这一处 ──
    # /admin、/console 及其子路径，外加 /signin；与 app/server/src/app.ts 的
    # ADMIN_SPA_PATHS / ADMIN_SPA_ENTRY 一致。/administrator、/consoles 不匹配。
    # 必须放在下面的图片正则之前：nginx 取第一个匹配的正则，仓库名这类路径段
    # 即使以 .svg/.png 结尾，也要进管理端入口而不是 404。
    location ~ ^/(?:(?:admin|console)(?:/|$)|signin$) {
        try_files $uri /sites/admin/index.html;
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

    # 其余路径进官网（React Router 深链接）。
    location / {
        try_files $uri /sites/portal/index.html;
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
