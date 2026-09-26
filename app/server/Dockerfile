# @yzgc/server 运行镜像（Fastify + SQLite）。
#
# 构建上下文 = 仓库根（geek_main/），不是 app/server：
#   docker build --build-arg GEEK_DEPLOYMENT_ENVIRONMENT=production \
#     -f app/server/Dockerfile -t yzgc-production/server:<sha12> .
#   （镜像仓库按环境分开：预发布构建用 yzgc-preview/server，正式构建用 yzgc-production/server，见 docs/ops/DEPLOY.md）
#
# 镜像内必须保持仓库布局，因为 src/config.ts 用 dist/ 的相对层级推导路径：
#   REPO_ROOT = dist/config.js 的 ../../.. → 容器内必须是 /app
#   APP_ROOT  = dist/config.js 的 ../..   → 容器内必须是 /app/app
# 于是运行时关键路径固定为 /app/package.json 与 /app/app/server/dist；改动任何一个都会让配置错位。
# 服务端不读前端配置：每个环境只有一个 PUBLIC_ORIGIN，SPA 入口按路径选择（见 src/app.ts）。
# 数据库与上传目录由 env 文件给定绝对路径（DB_PATH=/data/data.db 等），
# 因此落在 /data 卷上，不依赖 REPO_ROOT 的内部目录。

# ── 构建阶段：装依赖 → 编译 TS → 裁掉 devDependencies ──
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS builder

# 下载源（#104）：维护者家里的自托管 runner 连 registry.npmjs.org、deb.debian.org、GitHub releases
# 只有几十到两百 KB/s，工作流从仓库变量传国内镜像；不传就是下面的官方默认值，本机和托管 runner 照旧。
# 三个参数只在构建阶段声明；运行阶段是新的 FROM，不继承这里的 ARG，也不继承下面的 ENV。
# 换源不关任何校验（docs/ops/CICD.md「构建下载源」）：
#   NPM_REGISTRY               pnpm 按锁文件里的 integrity 核对每个包；corepack 用自带的 npm 公钥核对
#                              pnpm 的发布签名，镜像源转发的是官方签名，伪造不了。https://，不带结尾的 /。
#   DEBIAN_MIRROR              空 = deb.debian.org。apt 照样按 debian-archive-keyring 核对 InRelease 签名。
#                              只能写 http://：slim 镜像在装 ca-certificates 之前，apt 走不了 https。
#   BETTER_SQLITE3_BINARY_HOST 空 = GitHub releases。prebuild-install 下载预编译包本来就不核对哈希
#                              （官方源也一样），换源只是换了信任的对象；能挡住传输途中被换包的只有 TLS，
#                              所以只能写 https://，不带结尾的 /。
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG DEBIAN_MIRROR=
ARG BETTER_SQLITE3_BINARY_HOST=

# pnpm 9 与 npm 读 npm_config_registry，corepack 读 COREPACK_NPM_REGISTRY；
# prebuild-install（7.1.3 的 util.js getHostMirrorUrl）读 npm_config_<包名>_binary_host，空值等于没设。
ENV CI=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    npm_config_registry=${NPM_REGISTRY} \
    COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    npm_config_better_sqlite3_binary_host=${BETTER_SQLITE3_BINARY_HOST}

# better-sqlite3 / sharp 是原生模块：优先用上游预编译产物，python3 + make + g++
# 是预编译包不可用时的回退编译链（Node 22 官方镜像不含它们）。
# Debian 会淘汰旧的 point release，钉死 apt 版本号会让构建随时失败。
# BETTER_SQLITE3_BINARY_HOST 在这里就校验：后面 pnpm install 才用到它，格式不对要在下载之前失败。
# DEBIAN_MIRROR 先按字符白名单校验再写进 sed（分隔符是 #）；改写后文件里不许再有 deb.debian.org，
# 基础镜像哪天换了源的写法就直接失败，而不是悄悄回到官方源。
# hadolint ignore=DL3008
RUN set -eu; \
    case "$NPM_REGISTRY" in https://*[!/]) ;; *) echo "NPM_REGISTRY 必须是不带结尾 / 的 https:// 地址：${NPM_REGISTRY}" >&2; exit 1 ;; esac; \
    if [ -n "$BETTER_SQLITE3_BINARY_HOST" ]; then \
      case "$BETTER_SQLITE3_BINARY_HOST" in https://*[!/]) ;; *) echo "BETTER_SQLITE3_BINARY_HOST 必须是不带结尾 / 的 https:// 地址：${BETTER_SQLITE3_BINARY_HOST}" >&2; exit 1 ;; esac; \
      case "$BETTER_SQLITE3_BINARY_HOST" in *[!0-9A-Za-z.:/_-]*) echo "BETTER_SQLITE3_BINARY_HOST 含有不允许的字符：${BETTER_SQLITE3_BINARY_HOST}" >&2; exit 1 ;; esac; \
    fi; \
    if [ -n "$DEBIAN_MIRROR" ]; then \
      case "$DEBIAN_MIRROR" in http://*[!/]) ;; *) echo "DEBIAN_MIRROR 必须是不带结尾 / 的 http:// 地址：${DEBIAN_MIRROR}" >&2; exit 1 ;; esac; \
      case "$DEBIAN_MIRROR" in *[!0-9A-Za-z.:/_-]*) echo "DEBIAN_MIRROR 含有不允许的字符：${DEBIAN_MIRROR}" >&2; exit 1 ;; esac; \
      sources=/etc/apt/sources.list.d/debian.sources; \
      test -f "$sources"; \
      sed "s#http://deb.debian.org/debian#${DEBIAN_MIRROR}#g" "$sources" > "$sources.new"; \
      mv "$sources.new" "$sources"; \
      if grep -q 'deb\.debian\.org' "$sources"; then echo "改写后 ${sources} 里仍有 deb.debian.org" >&2; exit 1; fi; \
      grep -qxF "URIs: ${DEBIAN_MIRROR}" "$sources"; \
      grep '^URIs:' "$sources"; \
    fi; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates python3 make g++; \
    rm -rf /var/lib/apt/lists/*; \
    corepack enable; \
    corepack prepare pnpm@9.15.9 --activate; \
    pnpm --version

WORKDIR /repo

# 依赖层单独一层：只要锁文件不变就命中缓存。
# 根工作区成员是 app/server、app/web 与 app/console（见仓库根 pnpm-workspace.yaml），
# 清单都要在，否则 pnpm 无法按锁文件解析工作区。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/server/package.json app/server/package.json
COPY app/web/package.json app/web/package.json
COPY app/console/package.json app/console/package.json
RUN pnpm install --frozen-lockfile --filter @yzgc/server...

# 只复制编译需要的源码与 tsconfig：宿主的 node_modules / dist / test 脚本不进上下文。
COPY app/server/src app/server/src
COPY app/server/tsconfig.json app/server/tsconfig.json

ARG GEEK_DEPLOYMENT_ENVIRONMENT
ARG GEEK_RELEASE_VERSION
ARG GEEK_RELEASE_COMMIT

# 编译产物与环境无关；仍要求显式传入环境名，与另外两个镜像的构建参数契约一致。
RUN test -n "$GEEK_DEPLOYMENT_ENVIRONMENT" \
 && pnpm --filter @yzgc/server build \
 && pnpm install --frozen-lockfile --prod --filter @yzgc/server... --filter yzgc-admin

# ── 运行阶段：Node 22、非 root、保持仓库布局 ──────────────────
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS runtime

ENV NODE_ENV=production

# 运行阶段也保留发布身份：只为 `docker inspect` 能追溯「这个镜像对应哪次构建」，
# 静态产物与进程都不读它们（运行时的事实来源仍是 env 文件）。
ARG GEEK_DEPLOYMENT_ENVIRONMENT
ARG GEEK_RELEASE_VERSION=""
ARG GEEK_RELEASE_COMMIT=""
ENV GEEK_DEPLOYMENT_ENVIRONMENT=${GEEK_DEPLOYMENT_ENVIRONMENT} \
    GEEK_RELEASE_VERSION=${GEEK_RELEASE_VERSION} \
    GEEK_RELEASE_COMMIT=${GEEK_RELEASE_COMMIT}

WORKDIR /app

# pnpm 的符号链接是相对的（app/server/node_modules → ../../../node_modules/.pnpm），
# 两层一起复制才能在镜像里正常解析。
COPY --from=builder --chown=node:node /repo/package.json /app/package.json
COPY --from=builder --chown=node:node /repo/node_modules /app/node_modules
COPY --from=builder --chown=node:node /repo/app/server/node_modules /app/app/server/node_modules
COPY --from=builder --chown=node:node /repo/app/server/dist /app/app/server/dist

# 论坛的公开内容（#57）：分类与标签（curation.json）、公开的旧帖（published/topics.json）。
# 服务启动时读它们播种论坛（src/config.ts 的 forumContentDir = APP_ROOT/forum/content），缺了就启动失败。
# 只复制这两份公开文件，论坛的其它源码与私有快照都不进 server 镜像。
COPY --chown=node:node app/forum/content/curation.json /app/app/forum/content/curation.json
COPY --chown=node:node app/forum/content/published/topics.json /app/app/forum/content/published/topics.json

# 命名卷挂到 /data 时由镜像目录继承属主，容器内的 node 用户才能写 SQLite 与上传文件。
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# 用数字 UID：node 官方镜像里 node 用户就是 1000，数字形式不依赖平台的名字解析
# （有的平台在 runAsNonRoot 校验时无法判断命名用户是不是 root）。
USER 1000:1000

# 容器内端口，宿主暴露由 compose 的 127.0.0.1:<SERVER_BIND> 控制。
EXPOSE 3000

# 健康检查必须用 shell 形式（要拿 `|| exit 1` 表达失败）。
# hadolint ignore=DL3025
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "app/server/dist/index.js"]
