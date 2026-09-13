# Shared 前端模块合同

> 共享 UI、网络、渲染和配置，不反向依赖站点。

状态：`current` · 更新：2026-09-13

后续新增或迁移的 UI 遵循 [Tuffex 使用政策](../components/tuffex/USAGE-POLICY.md)。下面的 React 适配器说明只描述本模块的既有状态，不作为新方向的平行组件选型。Vue/Tuffex 适配器保持轻量，业务组合归所属模块。

shared/lib 提供网络、URL、Markdown、配置和挂载；shared/ui 提供真正共享交互；shared/styles 提供基础样式/令牌。端专属业务留在 sites。

本层仅属于尚未迁移的 React portal/admin。新论坛 `modules/forum` 使用原仓 TuffEx/Vue，不导入这里的 React 实现。核心论坛入口在开发态指向本机 3456 独立服务；旧 `/sites/forum/*` 只作为迁移跳转，不恢复旧页面。

API wrapper 正确合并 Headers，不覆盖 FormData；ApiError 区分状态、机器码、用户信息和 request_id。解析失败不捕获自己抛出的业务异常，204 不解析 JSON。Mock 仅开发动态加载，未知接口报错、写操作只读，不伪装成功。

query key 遵循本模块资源前缀，包含 queryFn 可变参数，失效前缀与读取保持一致。当前保留既有 key 形状，不声称已经全量迁移到工厂；有行为依据和回归覆盖后才改变缓存标识。Modal 为统一模态原语，利用平台 dialog 的顶层、背景 inert 和焦点约束。ConfirmProvider 排队确认，聚焦取消，没有全局 Enter 确认。Select 内部封装平台行为；NumberInput 保留编辑中间态。

Markdown 只通过 marked + DOMPurify 单一入口；图片预览与复制共用适配。组件单测和浏览器验证分别记录；不能从源码或外观宣称已通过 WCAG，对比度、放大和阅读器需独立测量。
