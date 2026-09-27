# syntax=docker/dockerfile:1.7
# @yzgc/forum 运行镜像：极客班论坛（基于 Tuff Forum 的 Nuxt 4 静态产物）+ nginx 静态托管。
#
# 构建上下文 = 仓库根（geek_main/）：
#   docker build --build-arg GEEK_DEPLOYMENT_ENVIRONMENT=production \
#     -f app/forum/Dockerfile -t yzgc-production/forum:<sha12> .
#   （镜像仓库按环境分开：预发布构建用 yzgc-preview/forum，正式构建用 yzgc-production/forum，见 docs/ops/DEPLOY.md）
#
# 论坛有自己的工具链与锁文件（pnpm 11.24.0 / Node >= 26），
# 绝不并入核心仓库的 pnpm 9 工作区：根 pnpm-workspace.yaml 只列 app/server 与 app/web，
# 本 Dockerfile 也只在 app/forum 目录里安装，两份锁文件互不干扰。
#
# 产物是纯静态站点，容器内监听 3000（= env 文件里的 FORUM_PORT）。
# 对外路径是官网域名下的 /forum：产物以 /forum/ 为 baseURL 构建，
# web 容器在转发时剥掉 /forum 前缀，因此本容器的站点根就是 .output/public。

# ── 构建阶段：独立工具链安装 → Nuxt 静态生成 ──────────────────
FROM node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS builder

# npm 源（#104）：工作流从仓库变量传国内镜像，不传就是官方源。只在构建阶段声明，运行阶段（nginx）
# 既不继承 ARG 也不继承下面的 ENV。npm 读 npm_config_registry；pnpm 11 不再读 npm_config_*，
# 只认 pnpm_config_registry，两个都要设。
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV npm_config_registry=${NPM_REGISTRY} \
    pnpm_config_registry=${NPM_REGISTRY}

# Node 26 不再随发行版提供 corepack，直接用 npm 装上游要求的 pnpm 11.24.0。
# npm 只拿「同一个源」给的 integrity 核对 tarball，源换成镜像以后，镜像说什么就是什么；
# 所以先 npm pack 下来，按写死的 sha512 核对，再从本地文件安装。这个值取自官方源
# （npm view pnpm@11.24.0 dist.integrity --registry https://registry.npmjs.org），与 ci.yml forum job 的
# FORUM_PNPM_INTEGRITY 相同，tests/tooling/build-mirrors.test.ts 核对两处一致。pnpm 包没有依赖，装的时候不再联网。
RUN set -eu; \
    case "$NPM_REGISTRY" in https://*[!/]) ;; *) echo "NPM_REGISTRY 必须是不带结尾 / 的 https:// 地址：${NPM_REGISTRY}" >&2; exit 1 ;; esac; \
    npm pack pnpm@11.24.0 --pack-destination /tmp; \
    node -e 'const [file, want] = process.argv.slice(1); const got = "sha512-" + require("node:crypto").createHash("sha512").update(require("node:fs").readFileSync(file)).digest("base64"); if (got !== want) { console.error(file + " 的 sha512 不符：期望 " + want + "，实际 " + got); process.exit(1); } console.log(file + " 的 sha512 核对通过");' \
      /tmp/pnpm-11.24.0.tgz 'sha512-vSfjRel23LC+C3oSKCF7BJqBfiGx81XJDb59xGZxiVqLwebQbCRVRQXqk+oLRfSJon7Bv7yN5qlln8oPFvoAAA=='; \
    npm install --global /tmp/pnpm-11.24.0.tgz; \
    rm -f /tmp/pnpm-11.24.0.tgz; \
    pnpm --version

WORKDIR /repo/app/forum

# 依赖层：锁文件 + pnpm 11 的 workspace 设置（allowBuilds 等写在这里）。
COPY app/forum/package.json app/forum/pnpm-workspace.yaml app/forum/pnpm-lock.yaml app/forum/.npmrc ./
RUN pnpm install --frozen-lockfile

# 生成输入：源码与静态资源逐项列出，宿主 node_modules/.nuxt/.output 绝不进上下文。
COPY app/forum/nuxt.config.ts app/forum/uno.config.ts app/forum/tsconfig.json \
     app/forum/eslint.config.mjs app/forum/wrangler.jsonc ./
# 目标写成相对 WORKDIR 的 ./<目录>：写成 app/forum/<目录> 会落到 /repo/app/forum/app/forum/<目录>，
# nuxt.config.ts 的 import './shared/deployment' 就找不到了。
COPY app/forum/app ./app
COPY app/forum/content ./content
COPY app/forum/modules ./modules
COPY app/forum/public ./public
COPY app/forum/server ./server
COPY app/forum/shared ./shared
# uno.config.ts 在加载配置时 import 这个脚本（扫描 tuffex 产物里的图标类名做 safelist）。
COPY app/forum/scripts/tuffex-icon-classes.mjs ./scripts/tuffex-icon-classes.mjs
# 生成论坛 CSP：站点策略取自宿主 nginx 模板，加上本次产物内联脚本的哈希（#78）。
COPY app/forum/scripts/csp-header.mjs ./scripts/csp-header.mjs
COPY deploy/nginx/production.conf /repo/deploy/nginx/production.conf
# nuxt.config.ts 直接 import 环境身份契约（../../deploy/environments.json）。
COPY deploy/environments.json /repo/deploy/environments.json
# nuxt.config.ts 也 import 静态资源 CDN 开关的解析（../../scripts/static-cdn-base.mjs，#146）。
COPY scripts/static-cdn-base.mjs /repo/scripts/static-cdn-base.mjs

ARG GEEK_DEPLOYMENT_ENVIRONMENT
ARG GEEK_RELEASE_VERSION=""
ARG GEEK_RELEASE_COMMIT=""
# 静态资源 CDN 开关（#146）：空 = 同源（默认）；非空只能是 scripts/static-cdn-base.mjs 里的地址，
# nuxt.config.ts 据此设 app.cdnURL=<地址>forum/。只在构建阶段声明，运行阶段不继承。
ARG STATIC_CDN_BASE=""

# GEEK_FORUM_SOURCE=site：镜像是极客班论坛自己——站名「极客班论坛」、app/forum/content/curation.json
# 里的分类和标签，加上 content/published 里公开的旧帖（去掉凭据后导出，只有首帖，作者是「极客班」）；
# 没有回复、其他用户和通知（论坛还没有后端）。不带上游示例帖子，也不读任何内容目录，
# 机器上的私有快照进不来。上游示例种子只留给 scripts/forum.mjs 的 check/generate/verify。
# GEEK_FORUM_BASE_PATH=/forum/ 是路径挂载的前提（nuxt.config.ts 把它写进 app.baseURL）：
# 产物 HTML 里的资源与路由前缀都必须是 /forum/，否则浏览器会去官网根路径找论坛资源
# （见 app.config.json 的 sites.forum.basePath=/forum 与 web 容器的 /forum 反代）。
# 产物仍然落在 .output/public 根目录，不会多出 forum/ 子目录，所以容器按站点根服务。
RUN test -n "$GEEK_DEPLOYMENT_ENVIRONMENT" \
 && GEEK_FORUM_BASE_PATH=/forum/ \
    GEEK_FORUM_SOURCE=site \
    GEEK_DEPLOYMENT_ENVIRONMENT="$GEEK_DEPLOYMENT_ENVIRONMENT" \
    GEEK_RELEASE_VERSION="$GEEK_RELEASE_VERSION" \
    GEEK_RELEASE_COMMIT="$GEEK_RELEASE_COMMIT" \
    STATIC_CDN_BASE="$STATIC_CDN_BASE" \
    pnpm exec nuxt generate \
 # 断言 baseURL 真的进了产物：失败信息比线上 404 好读得多。入口在开关打开时是 CDN 上的 <地址>forum/_nuxt/，
 # 关掉时是站内的 /forum/_nuxt/。
 && entry="${STATIC_CDN_BASE:+${STATIC_CDN_BASE}forum/_nuxt/}" \
 && grep -q "\"#entry\":\"${entry:-/forum/_nuxt/}" .output/public/index.html \
 && ! grep -q 'href="/_nuxt/' .output/public/index.html \
 # 开关打开时，头部 logo（代码里写的 public 文件）要变成 _nuxt/ 下带哈希的文件，才会随产物一起上传 CDN。
 && { test -z "$STATIC_CDN_BASE" || test -n "$(find .output/public/_nuxt -name 'logo.*.png' -print -quit)"; } \
 # 给 AI 读取的索引 llms.txt 与每篇公开旧帖的 t/<id>.md 必须随产物生成（nuxt.config.ts 的
 # nitro.prerender.routes）：机试文档 t73、t9（#87）和后来补进的现论坛帖子 t78、t84、t89（#108）；不公开的 t5、t15 没有文件。
 && test -s .output/public/llms.txt \
 && grep -q '极客班论坛' .output/public/llms.txt \
 && grep -q '极客班25级机试考核文档' .output/public/llms.txt \
 && test -s .output/public/t/t73.md \
 && test -s .output/public/t/t9.md \
 && test -s .output/public/t/t78.md \
 && test -s .output/public/t/t84.md \
 && test -s .output/public/t/t89.md \
 && ! test -e .output/public/t/t5.md \
 && ! test -e .output/public/t/t15.md \
 && test -n "$(find .output/public/published -name '*.webp' -print -quit)" \
 # 产物的文本文件里不能有邮箱地址（t73 原文里的共享账户已在导出时去掉），与 vitest 里的检查同一条规则；-I 跳过图片和字体，免得二进制字节碰巧像邮箱。
 && ! grep -rqEI '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.]+' .output/public \
 # 也不能有写出来的 API 密钥（t89 原文里的公益密钥已在导出时去掉）；前面不接字母数字和连字符，免得样式类名 task-list-… 被当成密钥。
 && ! grep -rqEI '(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}' .output/public \
 # 产物里不能有上游示例内容（示例帖子标题、示例分类）。
 && ! grep -rq 'Tuff 2.5' .output/public \
 && ! grep -rq 'CoreBox' .output/public

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

    # 兜底（#140）：本容器剥掉前缀后才收到请求，不知道外面的 /forum 和 https。万一还要发跳转，
    # 只发相对地址，由 web 容器的 proxy_redirect 补回 /forum 前缀，不会拼出 http://<Host>:3000/…。
    absolute_redirect off;

    # 压缩级别与 web 容器一致（#146）：nginx 默认是 1，论坛入口 CSS 626,718 字节经源站传 128,152 字节；6 级本机 nginx 实测 95,932。
    gzip on;
    gzip_comp_level 6;
    gzip_types text/plain text/markdown text/css text/javascript application/javascript application/json application/xml image/svg+xml application/wasm;
    gzip_min_length 1024;

    access_log /dev/stdout;
    error_log /dev/stderr warn;

    # 给 AI 读取的话题 Markdown（t/<id>.md）与索引 llms.txt，构建时逐个生成。
    # 官方 mime.types 没有 md，这里显式给出类型；charset 默认只加在 text/html 等少数类型上，
    # 因此列出两种类型。文件不存在就是 404，不回落 SPA 壳：浏览器里新发的话题没有 .md。
    location ~ \.md$ {
        types { }
        default_type text/markdown;
        charset utf-8;
        charset_types text/markdown;
        add_header X-Content-Type-Options nosniff always;
        try_files $uri =404;
    }
    location = /llms.txt {
        types { }
        default_type text/plain;
        charset utf-8;
        charset_types text/plain;
        add_header X-Content-Type-Options nosniff always;
        try_files $uri =404;
    }

    # 带内容哈希的产物：长缓存。^~：前缀命中后不再看下面的图片正则，否则 _nuxt/ 里的字体、图片只缓存 7 天（#146）。
    # 这里不写 add_header，http 层的 CSP 照样继承。
    location ^~ /_nuxt/ {
        expires 1y;
        try_files $uri =404;
        access_log off;
    }
    # _nuxt/ 里唯一不带哈希的文件：Nuxt 的新版本检查读它，文件名固定、每次构建内容都变，不缓存
    # （Nuxt 请求时带 ?<时间戳>，本来就不会命中缓存；开关打开时不读它，也不上传 CDN）。精确匹配优先于 ^~。
    location = /_nuxt/builds/latest.json {
        expires -1;
        try_files $uri =404;
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

    # 预渲染过的路由（about/、users/ …）直接取目录里的 index.html，带不带结尾斜杠都一样返回 200，
    # 其余路径（含没有 index.html 的目录）回落 200.html 交给客户端路由。不写 $uri/：它命中目录后
    # nginx 会 301 补斜杠，跳转里没有 /forum 前缀，刷新 /forum/users 就会跳出论坛（#140）。
    # 页面同样不缓存：发版后页面里的内联脚本变了，缓存里的旧页面配上新的 CSP 哈希会白屏（#78）。
    # expires 不是 add_header，http 层的 CSP 照样继承。
    location / {
        expires -1;
        try_files $uri $uri/index.html /200.html;
    }
}
NGINX_SITE

# 论坛页面的 CSP（http 层，站点里没有自己 add_header 的 location 都继承）：站点策略 + 内联脚本哈希。
# 宿主只在 /forum/ 下、上游已带 CSP 时不再叠加自己那份，见 deploy/nginx/*.conf 开头的 map。
RUN node scripts/csp-header.mjs --html .output/public --site-conf /repo/deploy/nginx/production.conf --out /nginx-out/conf.d/00-csp.conf \
 && grep -q "sha256-" /nginx-out/conf.d/00-csp.conf

# ── 运行阶段：nginx 1.31（alpine），以 nginx 用户（uid 101）运行 ──
# 版本说明：任务书建议的 1.27 已从 Docker Hub 下线（官方只维护 1.30/1.31 两条线），
# 1.31 也是本地实测配置所用的版本（nginx 1.31.6）。
FROM nginx:1.31-alpine@sha256:1ed1b0e1d7652937d6cbdaf4018c7b6fc009a7dd6c3047351e2eddda745de43f AS runtime

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
