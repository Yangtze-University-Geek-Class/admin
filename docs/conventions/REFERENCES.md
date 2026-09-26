# 官方参考与本项目采用范围

> 可追溯的工程依据，不把外部建议、产品选择和已完成验收混为一谈。

状态：`current` · 核对：2026-09-13

## 适用范围

规范化所用外部事实优先查官方文档，内部约束仍以本项目 current 文档及实现为准。下表记录采用了哪些原则以及对应的仓库落点，不表示项目已通过 OWASP、WCAG 或其他认证。

| 来源 | 采用范围 | 本项目落点 |
|---|---|---|
| [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) | type、可选 scope、breaking change 的提交结构 | [COMMITS](COMMITS.md)；中文说明和 scope 词表是本项目选择 |
| [Fastify Testing](https://fastify.dev/docs/latest/Guides/Testing/) | 构造与监听分离、inject 注册真实插件/路由、关闭资源 | [测试规范](TESTING.md)、`app/server/src/app.ts`、`tests/server` |
| [Fastify Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) | 运行时 HTTP Schema 与类型声明各有职责 | [API](../architecture/API.md)、`app/server/src/routes/*/contracts.ts` |
| [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | 扩展名与内容联合检查、限制大小、随机文件名、重写图片、授权和纵深防御 | 论坛头像上传 `PUT /api/forum/me/avatar`（#57）：只收三种图片类型且以解码出的格式为准、≤2MB、解码前的像素上限、按内容哈希命名、sharp 重新编码并去掉元数据、只允许成员本人、按人限流，见 [安全模型](../architecture/SECURITY.md) 与 `app/server/src/lib/forum-avatar.ts` |
| [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) | 会话验证、有效期、身份变化后的更新以及 Cookie 范围风险 | [安全模型](../architecture/SECURITY.md)、OAuth 流程和会话撤销回归 |
| [W3C APG modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | 弹层名称、焦点进入/圈定/恢复、危险操作优先聚焦取消 | `app/web/shared/ui/Modal.tsx`、`ConfirmDialog.tsx` 和浏览器测试 |
| [TypeScript module reference](https://www.typescriptlang.org/docs/handbook/modules/reference.html) | 后端 .js 对应 TS 源文件、tsconfig paths 的真实解析 | `scripts/check-boundaries.mjs` 及跨端导入反例 |
| [Nginx headers module](https://nginx.org/en/docs/http/ngx_http_headers_module.html) | 子 location 的 add_header 与继承行为 | `deploy/nginx/production.conf`、`deploy/nginx/preview.conf`（安全头在宿主 nginx 统一下发，容器内不重复；论坛页面的 CSP 例外见 [DEPLOY](../ops/DEPLOY.md)「最小权限」）；实际部署仍需响应头验收。根目录旧 `deploy/nginx*.conf` 属退役模型 |

## 使用和维护

采用新的库、升级大版本或改变安全方案时重新核对对应官方说明；版本和默认值可能变化，不从旧研究文档推断最新版。把已采用的规则同步到唯一规范源，不在本表再定义第二套技术规则。

发生来源冲突时记录适用版本、项目约束和取舍；以测试和环境证据报告实施结果。身份服务模拟、浏览器模拟网络、真实供应商验证、生产发布是四种不同范围，不得互相代替。
