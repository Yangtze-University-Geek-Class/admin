# stage · crosery · 2026-10-05

负责人：crosery

## 01:22:28 +08:00 · 方案 · 无 issue · 本地登录回调的主机与回跳 origin 不一致已复现

- 执行者：agent-codex-geek-main-206
- 做了什么：仅只读核对运行实例元数据和源码；用独立临时Cookie、虚构取消授权回调运行/tmp/geek-206-oauth-host-probe.mjs，不重放用户授权码或Cookie；pnpm exec vitest run tests/server/core.test.ts
- 结果：真实登录模式external_integrations=true、database=file。localhost:5206发起回调到127.0.0.1:5173，host-only state Cookie无法随回调发送，探针两次均400 invalid_state；127.0.0.1:5206 state通过302，但return_to被允许列表拒绝，回/console；127.0.0.1:5173取消回调302回/forum/。42/42既有认证测试通过；原用户响应正文不可查、Safari真机及真实OAuth成功未验证。现行portal合同要求localhost用于CDN，与LOCAL-PREVIEW的127.0.0.1入口存在冲突，未擅自改配置、源码、凭据或重启服务。
- 下一步：提交痛点、方案和最终效果候选给Crosery；未获建单确认不创建独立认证issue或task分支

## 20:15:34 +08:00 · 验收 · 无 issue · 小鸡云 CPA 加入公司 mox 渠道，仅对程耀宇开放，全部 mox 前缀别名

- 执行者：agent-omp-geek-main-05（omp，qwen3.8-flash）
- 做了什么：cpa-vps：经 CPA 管理面 PUT openai-compatibility 新建渠道 mox-aigw（base-url https://aigw.lan.mox.ktvsky.com/v1，proxy-url direct，priority 10，27 个模型全部 alias=mox-<原名>，5 个 gpt-image 加 image:true 标记）；重启 cli-proxy-api 让注册表稳定；经控制台 HTTPS API 给程耀宇 Key PATCH groups + mox-aigw（走审计 update_key）
- 结果：网关 config.yaml 1240 行持久化；/v1/models 只出 27 个 mox-* 别名、裸上游名不进注册表（58→84 恰 +26，其他 Key 按裸名也路由不到该渠道）；仅 1 把 Key 含 mox-aigw（channel-access 与 model-access 双闸一致）；实测 程耀宇 mox-gpt-5.6-terra/mox-gpt-6-astra chat 200、mox-gpt-image-2 与 mox-gpt-image-2.5-flare images 200（1246/932 KiB PNG）；极客班、伊吹请求 mox-* 一律 403 model_not_allowed、目录不可见；qwen3.8-max 等既有渠道重启后不受影响；usage_events 记录 provider=openai-compatible-mox-aigw 成功 3 条
- 下一步：待 Crosery 让程耀宇实际接入验证；公司账号 prolite 配额（gpt-5.6-luna 已 429）与 mox-gpt-image-2.5-flare 上游偶发 unsupported 报错留意复测
