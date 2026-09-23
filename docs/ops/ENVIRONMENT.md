# 开发环境配置模板

> 仅包含占位符；已有环境文件不由代码规范化任务读取或覆盖。

状态：`current` · 更新：2026-09-23 · 本机开发专用；**部署**环境的字段契约见 [ENVIRONMENTS](ENVIRONMENTS.md)

只做 UI 预览使用根 `pnpm dev:web`，无需以下配置。需要真实本地后端时，由操作者在仓库根创建自己的 `.env`，使用本地专用 OAuth 应用和数据库，不能复制生产凭据或数据。

```dotenv
NODE_ENV=development
PUBLIC_ORIGIN=http://localhost:5173
SITE_ORIGIN=http://localhost:5173
PORT=3000
OAUTH_CLIENT_ID=REPLACE_WITH_LOCAL_CLIENT_ID
OAUTH_CLIENT_SECRET=REPLACE_WITH_LOCAL_CLIENT_SECRET
SESSION_SECRET=REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
ENCRYPTION_KEY=REPLACE_WITH_BASE64_OF_32_RANDOM_BYTES
DB_PATH=./data/local/data.db
FORUM_DB_PATH=./data/local/forum.db
FORUM_UPLOAD_DIR=./data/local/forum-uploads
POW_DIFFICULTY=3
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
COOKIE_DOMAIN=
ALLOWED_ORGS=
# 可不设，默认 Yangtze-University-Geek-Class
CONSOLE_ORG=Yangtze-University-Geek-Class
```

这些占位值不能直接用于运行，密钥必须满足实际尺寸校验。生产须使用 HTTPS 并明确三个域名，前后端公开 host 一致，配置 Cookie Domain 前确认子域信任范围。详见 [部署规范](DEPLOY.md)。

论坛本机预览不读根 `.env`，`scripts/forum.mjs` 只转发这些 shell 变量：`GEEK_FORUM_CONTENT_DIR`（只读快照目录，占位 `./.tools/forum-runtime/REPLACE_WITH_SNAPSHOT`，相对仓库根；未设置时自动发现）、`GEEK_FORUM_SOURCE=demo`（强制示例种子）、`FORUM_NODE`、`FORUM_PNPM`、`TUFF_FORUM_CHROME`（工具路径）、`TUFF_FORUM_URL`（CDP 套件目标，默认 127.0.0.1:3456），以及仅用于构建元数据展示的 `GEEK_DEPLOYMENT_ENVIRONMENT`、`GEEK_RELEASE_VERSION`、`GEEK_RELEASE_COMMIT`。说明见 [TUFF-FORUM](TUFF-FORUM.md)。

测试不使用此文件：测试程序显式创建两个内存数据库、临时上传目录与模拟外部客户端。工具限制读取的敏感路径保持不动，不使用其他读取方式绕过限制。
