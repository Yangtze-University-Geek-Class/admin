# Server 基础设施合同

> 核心 portal/admin 的应用组装、资源生命周期和真实 GitHub 适配。

状态：`current` · 更新：2026-09-13

## 范围和资源

index.ts 加载配置并监听/关闭；app.ts 组装 portal/admin 核心路由，不监听；services.ts 为每个应用创建独立 data.db、缓存、核心身份和外部客户端。模块 import 不加载 .env、打开数据库或启动监听。app.close 关闭自己创建的服务，注入的服务由调用者负责。路由只取需要的服务，不把整个 service locator 传遍业务层。

论坛直接采用 `modules/forum`，不在这里注册旧论坛插件。旧 forum-* 适配器、维护脚本与专属测试已归档，服务不再打开 forum.db。配置中的旧论坛路径暂存为兼容字段，不代表还有活动数据库或上传接口。

## 依赖方向

config 验证参数，crypto 处理 AES-256-GCM，auth 管理 sid，github 查询真实组织角色，invite-reservation 管理额度/尝试状态，http-contracts 提供 Schema 工具。middleware 不导入路由，lib 不反向依赖 middleware。

核心 OAuth callback 保留签名 state、有效期和安全回跳，只签发 sid，不桥接旧 forum_sid。旧 /api/forum、/auth/forum 和上传读取返回 410；本地旧页面跳到新首页，生产缺少新论坛服务时返回 503，不以模拟成功填补后端缺口。

## 验证

核心测试只将 data.db 设为内存并拒绝意外外网；以不可用的旧论坛库路径验证服务不会尝试打开它。覆盖资源关闭、实例隔离、核心 OAuth、管理员 API、邀请并发和旧接口停用。业务数据维护和生产部署仍需独立授权。
