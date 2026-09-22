# 本机核心预览与独立论坛

> 保留官网和管理后台的隔离预览；论坛直接运行原仓 Nuxt/TuffEx，不再启动旧论坛。

状态：`current` · 更新：2026-09-23

## 地址

| 模块 | 本机地址 | 数据 |
|---|---|---|
| 宣传主页 | http://127.0.0.1:5173/sites/portal/ | 核心前端 |
| GitHub 管理预览 | http://127.0.0.1:5173/sites/admin/admin?__data=mock | 只读样板，不操作真实 GitHub |
| 新论坛 | http://127.0.0.1:3456/ | 发现 `.tools/forum-runtime/<快照>/` 时为极客班只读快照，否则为原仓浏览器 localStorage 演示；`GEEK_FORUM_SOURCE=demo` 强制示例（见 [TUFF-FORUM](TUFF-FORUM.md)） |
| 核心 API | http://127.0.0.1:3000/healthz | 独立内存 data.db |

旧 /sites/forum/* 和 /forum 入口转到新论坛首页。核心 /api/forum/* 返回 410，不再支持旧本地注册、上传、发帖。生产新论坛缺少真实服务时不自动开放演示。

## 管理进程

```bash
node scripts/local-preview.mjs start
node scripts/local-preview.mjs status
node scripts/local-preview.mjs stop
node scripts/forum.mjs start
node scripts/forum.mjs status
node scripts/forum.mjs stop
```

根 `pnpm preview:local` 启动两者。核心选择项目 Node 22；论坛选择 Node >=26 和独立 pnpm 11。两者均核对本任务实例标识，不因端口占用停止无关进程。端口仅绑定回环，不开放局域网/公网，没有开机自启。

核心日志在 .tools/local-preview/preview.log，论坛日志在 .tools/tuff-forum/dev.log；目录属于本机缓存。已有 4173 等服务不因本任务停止。

## 数据生命周期

核心内存数据库在核心服务重启后清空。论坛示例模式的数据保存在当前浏览器，停止服务不会主动清空它，上游重置示例数据需用户明确操作；快照模式只读显示极客班归档，不写论坛状态。两种 mock 语义不同：核心样板只读，论坛示例模式允许浏览器内示例交互，但都没有真实账号认证或跨设备存储。页面有明确提醒。

不读取现有 .env、不连接业务数据库、不使用真实 GitHub/Cloudflare 凭据。上游原代码和工具链说明见 [TUFF-FORUM](TUFF-FORUM.md)。真实部署按 [DEPLOY](DEPLOY.md) 单独实施：线上不是本机这几条命令的延伸，而是两套 Docker 栈（[ENVIRONMENTS](ENVIRONMENTS.md)），本机地址任何情况下都不能标成已在预发布环境试用。
