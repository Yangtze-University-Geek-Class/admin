# syntax=docker/dockerfile:1.7
# @yzgc/forum 运行镜像：Nuxt 4 静态产物（Tuff Forum）+ nginx 静态托管。
#
# 构建上下文 = 仓库根（geek_main/）：
#   docker build --build-arg GEEK_DEPLOYMENT_ENVIRONMENT=production \
#     -f app/forum/Dockerfile -t yzgc/forum:<sha12> .
#
# 论坛有自己的工具链与锁文件（pnpm 11.24.0 / Node >= 26），
# 绝不并入核心仓库的 pnpm 9 工作区：根 pnpm-workspace.yaml 只列 app/server 与 app/web，
# 本 Dockerfile 也只在 app/forum 目录里安装，两份锁文件互不干扰。
#
# 产物是纯静态站点，容器内监听 3000（= env 文件里的 FORUM_PORT）。
# 对外路径是官网域名下的 /forum：产物以 /forum/ 为 baseURL 构建，
# web 容器在转发时剥掉 /forum 前缀，因此本容器的站点根就是 .output/public。

# ── 构建阶段：独立工具链安装 → Nuxt 静态生成 ──────────────────
FROM node:26-bookworm-slim AS builder

# Node 26 不再随发行版提供 corepack，直接用 npm 装上游要求的 pnpm 11.24.0。
RUN npm install --global pnpm@11.24.0 \
 && pnpm --version

WORKDIR /repo/app/forum

# 依赖层：锁文件 + pnpm 11 的 workspace 设置（allowBuilds 等写在这里）。
COPY app/forum/package.json app/forum/pnpm-workspace.yaml app/forum/pnpm-lock.yaml app/forum/.npmrc ./
RUN pnpm install --frozen-lockfile

# 生成输入：源码与静态资源逐项列出，宿主 node_modules/.nuxt/.output 绝不进上下文。
COPY app/forum/nuxt.config.ts app/forum/uno.config.ts app/forum/tsconfig.json \
     app/forum/eslint.config.mjs app/forum/wrangler.jsonc ./
COPY app/forum/app app/forum/app
COPY app/forum/content app/forum/content
COPY app/forum/modules app/forum/modules
COPY app/forum/public app/forum/public
COPY app/forum/server app/forum/server
COPY app/forum/shared app/forum/shared
# nuxt.config.ts 直接 import 环境身份契约（../../deploy/environments.json）。
COPY deploy/environments.json /repo/deploy/environments.json

ARG GEEK_DEPLOYMENT_ENVIRONMENT
ARG GEEK_RELEASE_VERSION=""
ARG GEEK_RELEASE_COMMIT=""

# GEEK_FORUM_SOURCE=demo 与 scripts/forum.mjs 的 check/generate 行为一致：
# 镜像里没有本地快照目录，构建固定用上游示例内容，不用机器上的私有数据。
# GEEK_FORUM_BASE_PATH=/forum/ 是路径挂载的前提（nuxt.config.ts 把它写进 app.baseURL）：
# 产物 HTML 里的资源与路由前缀都必须是 /forum/，否则浏览器会去官网根路径找论坛资源
# （见 app.config.json 的 sites.forum.basePath=/forum 与 web 容器的 /forum 反代）。
# 产物仍然落在 .output/public 根目录，不会多出 forum/ 子目录，所以容器按站点根服务。
RUN test -n "$GEEK_DEPLOYMENT_ENVIRONMENT" \
 && GEEK_FORUM_BASE_PATH=/forum/ \
    GEEK_FORUM_SOURCE=demo \
    GEEK_DEPLOYMENT_ENVIRONMENT="$GEEK_DEPLOYMENT_ENVIRONMENT" \
    GEEK_RELEASE_VERSION="$GEEK_RELEASE_VERSION" \
    GEEK_RELEASE_COMMIT="$GEEK_RELEASE_COMMIT" \
    pnpm exec nuxt generate \
 # 断言 baseURL 真的进了产物：失败信息比线上 404 好读得多。
 && grep -q '"#entry":"/forum/_nuxt/' .output/public/index.html \
 && ! grep -q 'href="/_nuxt/' .output/public/index.html

# 容器内 nginx：静态托管，SPA 回落 200.html（Nuxt ssr:false 的约定）。
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

# 端口 3000 = env 文件里的 FORUM_PORT（正式与预发布都是 3000）。
# 本站点根就是产物根：/forum 前缀由 web 容器剥掉后转发进来。
COPY <<'NGINX_SITE' /nginx-out/conf.d/10-forum.conf
server {
    listen 3000;
    server_name _;

    root /usr/share/nginx/html;
    server_tokens off;

    gzip on;
    gzip_types text/plain text/css text/javascript application/javascript application/json application/xml image/svg+xml application/wasm;
    gzip_min_length 1024;

    access_log /dev/stdout;
    error_log /dev/stderr warn;

    # 带内容哈希的产物：长缓存。
    location /_nuxt/ {
        expires 1y;
        try_files $uri =404;
        access_log off;
    }
    location ~* \.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf)$ {
        expires 7d;
        try_files $uri =404;
        access_log off;
    }
    # SPA 回落页本身不能被缓存，否则发版后客户端仍拿旧壳。
    location = /200.html {
        expires -1;
        try_files $uri =404;
    }
    location = /404.html {
        expires -1;
        try_files $uri =404;
    }

    # 预渲染过的路由（about/、categories/ …）直接命中目录里的 index.html，
    # 其余路径回落 200.html 交给客户端路由。
    location / {
        try_files $uri $uri/ /200.html;
    }
}
NGINX_SITE

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

RUN rm -rf /usr/share/nginx/html /etc/nginx/conf.d/*
COPY --from=builder /repo/app/forum/.output/public /usr/share/nginx/html
COPY --from=builder /nginx-out/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /nginx-out/conf.d/ /etc/nginx/conf.d/

# 用数字 UID：nginx 官方镜像里 nginx 用户就是 101，数字形式不依赖平台的名字解析。
USER 101:101

EXPOSE 3000

# 健康检查必须用 shell 形式（要拿 `|| exit 1` 表达失败）。
# hadolint ignore=DL3025
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:3000/200.html || exit 1

CMD ["nginx", "-g", "daemon off;"]
