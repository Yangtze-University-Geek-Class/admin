# architecture/

> 长期有效的系统设计：架构、鉴权、数据模型、安全模型。改动系统边界或数据之前先读这里。

| 文件 | 什么时候读 |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 改后端路由、DB schema、OAuth 流程、加密、防滥用之前 |
| [`SECURITY.md`](./SECURITY.md) | 涉及威胁模型、限流、验证码、可能暴露的数据之前 |

这两篇描述**当前实现**。如果发现与代码不符，以代码为准，但要在同一次改动里修正文档（`AGENTS.md` §4.7）。
