# @yzgc/server 运行镜像（Fastify + SQLite）。
#
# 构建上下文 = 仓库根（geek_main/），不是 app/server：
#   docker build --build-arg GEEK_DEPLOYMENT_ENVIRONMENT=production \
#     -f app/server/Dockerfile -t yzgc/server:<sha12> .
#
# 镜像内必须保持仓库布局，因为 src/config.ts 用 dist/ 的相对层级推导路径：
#   REPO_ROOT = dist/config.js 的 ../../.. → 容器内必须是 /app
#   APP_ROOT  = dist/config.js 的 ../..   → 容器内必须是 /app/app
# 于是运行时关键路径固定为 /app/package.json 与 /app/app/server/dist；改动任何一个都会让配置错位。
# 服务端不读前端配置：每个环境只有一个 PUBLIC_ORIGIN，SPA 入口按路径选择（见 src/app.ts）。
# 数据库与上传目录由 env 文件给定绝对路径（DB_PATH=/data/data.db 等），
# 因此落在 /data 卷上，不依赖 REPO_ROOT 的内部目录。

# ── 构建阶段：装依赖 → 编译 TS → 裁掉 devDependencies ──
FROM node:22-bookworm-slim AS builder

ENV CI=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# better-sqlite3 / sharp 是原生模块：优先用上游预编译产物，python3 + make + g++
# 是预编译包不可用时的回退编译链（Node 22 官方镜像不含它们）。
# Debian 会淘汰旧的 point release，钉死 apt 版本号会让构建随时失败。
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@9.15.9 --activate \
 && pnpm --version

WORKDIR /repo

# 依赖层单独一层：只要锁文件不变就命中缓存。
# 根工作区成员是 app/server 与 app/web（见仓库根 pnpm-workspace.yaml），
# 两个清单都要在，否则 pnpm 无法按锁文件解析工作区。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/server/package.json app/server/package.json
COPY app/web/package.json app/web/package.json
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
FROM node:22-bookworm-slim AS runtime

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
