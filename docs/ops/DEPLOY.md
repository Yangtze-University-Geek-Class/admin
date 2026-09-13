# 部署、维护与恢复规范

> 生产发布为独立授权操作；代码模板不等于实际部署完成。

状态：`current` · 更新：2026-09-13

## 发布前置

**先遵守 [RELEASES](../conventions/RELEASES.md)：main 为主代码；release- 正式、prev- 预发布；人工试用及明确批准必须发生在版本升级/打 tag 之前。日常预发布仅使用已有基础版本@准确 commit，不影响正式版本。** tag 部署检出 tag 对应 SHA，不在目标机临时 git pull main。后续实施步骤见 [CICD](CICD.md)，当前尚未启用远程自动发布。

发布者明确目标环境、提交、回滚版本和维护窗口。使用项目 Node 22 与 pnpm 9.15.9，先在隔离环境执行 frozen-lockfile 安装与 pnpm verify，再完成相关浏览器、配置和迁移检查。不从含无关修改的工作区发布。

核心 Fastify 承载 portal/admin 两个 React 入口；论坛改为独立 modules/forum 的 Nuxt/TuffEx 原仓。核心 Node 22/pnpm 9，论坛 Node >=26/pnpm 11，分别安装锁文件。本次只启动本机原仓演示，没有生产论坛后端或统一认证，禁止把演示页面直接作为内部论坛发布。静态生成通过不等于获得上线授权，详情见 [TUFF-FORUM](TUFF-FORUM.md)。

## 正式与预发布的固定入口

正式域名为 `yangtzeu.work`，预发布域名为 `prev.yangtzeu.work`，以 [environments.json](../../deploy/environments.json) 为准。不能把本机 3456/5173 当成预发布，不能让 prev tag 更新正式域名。两个环境不共享数据库、上传目录、会话密钥或父域 Cookie；根域 Cookie 必须 host-only，不设置 Domain。旧的 github/forum 子域资料仅用于旧部署追溯，不替代本次已确认的整站环境入口；路径分流、DNS/TLS 和真实统一认证仍需发布前单独实施。

## 流水线部署布局

`deploy/remote/deploy-release.sh` 与 `deploy/remote/rollback.sh` 是当前唯一实现的目标机部署/回滚脚本，由 [CI/CD](CICD.md) 描述的 `preview.yml`/`release.yml` 的 `deploy` job 通过 SSH 调用；两者都是模板层面已落地，尚未在真实目标机验证过。部署根目录 `$DEPLOY_ROOT` 下固定布局：

```
$DEPLOY_ROOT/
├── releases/<releaseId>/   # 每个已部署产物的完整解包目录，releaseId = baseVersion-shortCommit12
├── current -> releases/<releaseId>   # 原子切换的符号链接，systemd WorkingDirectory 指向它
├── previous -> releases/<releaseId>  # 回滚目标，rollback.sh --to previous 切回这里
├── shared/
│   ├── .env    # 由维护者维护，脚本从不读取/复制/打印其内容，不随发布包分发
│   └── data    # 该环境唯一可写目录，其余部署路径保持只读
├── incoming/    # deploy job 上传产物的落点（<artifactName>.tar.gz、.sha256、对应版本的 deploy-release.sh）
└── deploy-history.log   # 部署与回滚的追加日志
```

服务名 `yzgc-admin`（正式，见 `deploy/yzgc-admin.service`）与 `yzgc-preview`（预发布，见 `deploy/yzgc-preview.service`）是两份 systemd 模板给出的默认值，均需维护者按目标机实际用户/路径/端口确认后再安装，不能直接照搬。两个服务必须完全隔离：独立系统用户、独立 `WorkingDirectory`、独立 `.env`、独立数据目录与数据库、独立会话签名密钥、独立监听端口；预发布不得复用正式环境任何一项。

目标机前置条件（脚本不自行安装、不猜测路径，见两脚本文件头注释）：已装 Node 22（>=22.13）与 pnpm 9.15.9 且 `PATH` 可见；部署用户为非 root，且 sudoers 只放行 `<部署用户> ALL=(root) NOPASSWD: /usr/bin/systemctl restart <服务名>` 这一条命令；nginx 需 `include` 本仓的 `deploy/nginx-release-metadata.conf`（暴露只读、`no-store` 的 `/release.json`）并为 `/healthz` 配反代，两环境的 `alias` 必须分别指向各自的 `current/release.json`，不能共用同一部署根目录。

回滚用 `deploy/remote/rollback.sh --environment <preview|production> --to <releaseId|previous>`：只把 `current` 符号链接切回一个已存在且通过校验的历史发布目录，不移动 tag、不修改版本号、不触碰数据库；数据库字段不兼容时脚本会停下来交由人处理，不自动重置数据库代替回滚。`--environment` 必填且不是显示标签：`releaseId` 只由 `baseVersion-shortCommit12` 组成，同一提交在 preview 与 production 完全相同，脚本用它断言目标产物与线上 `release.json` 的 `environment`、`publicOrigin`，避免把另一环境的产物切上来。回滚目标是 `deploy-release.sh` 部署过的目录，里面有 `pnpm install --prod` 生成的 `node_modules`；随包分发的 `release-bundle.mjs verify` 会整棵跳过 `node_modules`，其余文件仍逐一比对 MANIFEST。正因为 verify 不覆盖 `node_modules`，`rollback.sh` 会在切换 `current` 之前用 `pnpm install --prod --frozen-lockfile --prefer-offline` 按锁文件重建目标版本的生产依赖，重建失败即拒绝回滚；这要求目标机装有 pnpm 9.15.9 且能访问 registry。回滚前脚本还会先核对目标目录里的 `release-bundle.mjs`、`release-policy.mjs`、`deployment-environment.mjs` 非空且 sha256 与同目录 `MANIFEST.sha256` 登记值一致，再运行 verify，避免用一个被清空的校验器自证通过（`node` 执行空文件退出码为 0）；这只把信任基点提到「校验器 + 清单一致」，两者被同时改写仍无法发现，最终防线是部署时 CI 端已核对过 tar 的 sha256。

发布包里的 `forum/public` 目前没有任何服务提供：核心 Fastify 不托管它，`server/src/app.ts` 对 `/forum`、`/forum/*` 在生产直接返回 503（`forum_service_not_ready`）。要让论坛在域名下可访问，需要由 nginx 另行把对应路径指向 `current/forum/public`（静态）或指向真实论坛服务；这一步尚未配置，也未在任何目标机验证过。发布包携带该目录只是为了让产物与提交一一对应，不代表论坛已经上线。

## 配置合同

| 配置 | 用途 |
|---|---|
| PUBLIC_ORIGIN | 管理端/OAuth 回调 origin，生产 HTTPS |
| SITE_ORIGIN | 官网 origin，生产 HTTPS |
| ADMIN_HOST、PORTAL_HOST、FORUM_HOST | 明确域名覆盖，与前端公开配置一致，不带协议或端口 |
| COOKIE_DOMAIN | 旧字段；新双环境应留空以使用 host-only，禁止 .yangtzeu.work 导致正式与预发布共享会话 |
| OAUTH_CLIENT_ID、OAUTH_CLIENT_SECRET | GitHub OAuth 配置，不在日志或仓库保存真实值 |
| SESSION_SECRET | 至少 32 字符随机值 |
| ENCRYPTION_KEY | 32 字节密钥的 base64，轮换需单独迁移方案 |
| DB_PATH | 核心持久化路径，自动测试显式为内存 |
| FORUM_DB_PATH、FORUM_UPLOAD_DIR | 旧字段仅暂存兼容；核心不打开旧论坛库或上传接口，旧数据保留 |
| TURNSTILE_SITE_KEY、TURNSTILE_SECRET_KEY | 同时配置才启用，核实站点来源 |
| POW_DIFFICULTY | 整数 0–5；生产基线 3，0 仅隔离开发 |
| ALLOWED_ORGS、PORT | 组织允许列表及回环监听端口 |

.env 由操作者提供，最小权限保存，不打印或提交。根路径解析不依赖 shell 当前目录；部署文件与原生模块需和运行时匹配。

配置示例见 [开发环境模板](ENVIRONMENT.md)。该文档只含占位符，不依赖或读取已有敏感文件。生产启动会比对后端 host 与前端公开 host；构建时只检查公开配置，不加载私有环境文件。

## 最小权限

应用使用专用 yzgc-admin 用户，不以 root 运行。代码和构建产物只读，数据和上传目录按需可写。systemd 开启 NoNewPrivileges、PrivateTmp 和文件系统保护，日志进入 journal。模板变化必须由发布者检查实际路径和服务用户权限，不能盲目覆盖已有配置。

Nginx 安全头通过公共 include 保持一致，子 location 设置缓存头时也包含安全头。已有两个不同 server block 模板不能同时启用而产生域名冲突。证书准备完成后才引用，先 nginx -t 再重载；本地代码验收不执行这些操作。

## 数据迁移和备份

极客班论坛原始数据库和附件已按独立授权拉到 Mac 私有目录，见 [FORUM-DATA-CAPTURE](FORUM-DATA-CAPTURE.md)。这是源数据保全，不是新 schema 导入，不自动替换线上库，也不放进 CI/发布产物。

新表/列尽量增量兼容，不自动删除或重排。变更前使用 SQLite 在线 backup API 或停服的一致性备份，不能只复制活动 WAL 数据库主文件并假定完整。备份同时记录密钥版本、应用版本和必要上传文件，并完成恢复演练。

新增 invite_attempts 保存邀请额度预留和结果。sent 可复用；unknown/reserved 表示需核对的外部结果，不自动重发。管理员核对 GitHub 是否已发邀请后，再通过授权维护修正状态/额度并记录审计。

旧论坛维护脚本已随源码归档，不能对新论坛 localStorage 数据使用旧数据库脚本。旧数据库/附件不自动导入或删除；迁移需独立方案、授权和可验证备份。禁止将业务数据库用于自动测试。

## 发布和回滚验收

检查 healthz、三个入口和深链接、缺失资产 404、真实 OAuth/Cookie、验证码、权限、上传、邀请结果、审计和服务重启。HTML/资产及后端必须来自同一发布版本。数据库有新字段时回滚旧程序前确认兼容，不以重置数据库代替回滚。

未执行的生产验证明确标注，不将本机的 verify PASS、模板文件或模拟测试称为线上验收。

核心 OAuth 保留签名状态和十分钟有效期；不再签发 forum_sid 或支持旧论坛绑定回调。旧论坛 API 返回 410。新论坛真实 Provider、服务器会话和权限未接入前，不能仅用前端跳转或示例用户选择保护内部服务。后续发布需验证统一认证、回跳、Cookie 范围和退出语义。

旧 deploy/setup.sh 的自动安装行为已退役。`bash deploy/setup.sh --check` 仅检查仓库模板，不修改系统服务、证书或数据。发布者按本规范准备专用用户、目录权限、证书和配置 include，再在已授权目标环境执行检查及重载；不要把旧一键命令用于本次版本。
