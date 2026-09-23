# Portal 模块合同（`app/web/sites/portal`）

> 公开介绍、投递简历、文档、反馈和邀请落地；无独立登录态。

状态：`current` · 更新：2026-09-24

## 范围与入口

前端 `app/web/sites/portal/App.tsx`，后端 `app/server/src/routes/portal/index.ts`。路由：`/`（首页，只保留三个入口：投递简历、了解我们→论坛、组织情况→GitHub）、`/apply`（投递简历表单）、`/docs`、`/feedback`、`/join/:token`。路由只从自己的模块目录注册，不导入 admin/forum 路由。

首页与投递简历页共用「NANO · 代码窗口 × LED 点阵」视觉语言：令牌与组件在 `app/web/sites/portal/theme.css`（`.yg-page` 作用域），首页滚动舞台在 `components/ScrollStage.tsx`，LED 点阵字库与画板在 `lib/ledFont.ts`、`lib/ledBoard.ts`，滚动擦洗帧序列在 `lib/frameSequence.ts`（纯函数部分由 `tests/web/led-font.test.ts`、`frame-sequence.test.ts` 覆盖，标题子集字体缺字由 `portal-display-font.test.ts` 拦截）。首页文案、章节与素材路径在 `app.config.json > portal.stage / entries`，静态素材（透明底 NANO 立绘 webp、入口卡立绘、挥手帧序列 `wave/`）在 `app/web/public/portal/`，标题子集字体与许可在 `app/web/public/fonts/`。规范正文见 [DESIGN](../../design/DESIGN.md) 的「官网视觉语言」；文档、意见箱、邀请加入三页已迁到同一外壳（页头胶囊 + 冰白图纸 + 页脚），意见箱在未指定组织时默认本组织。

第四轮视觉方向的来历：先用生图出了四个方向的概念稿（LED 夜景、蓝图白昼、代码窗口、游戏 UI），再由「所有者视角 / 设计评论 / 可实现性」三个评审独立打分，代码窗口方向 2:1 胜出；LED 夜景被评为风险最高（与已否决的第三轮同构）。第三轮的 LED 素材与 72 帧序列已移出仓库（不再引用）。

## 数据与协议

文档 API 仅允许公开产品介绍和用户指南；内部规范、部署、安全与审查材料不在白名单。反馈写入 data.db，管理侧由服务端 admin/console 接口读取、控制台（`app/console`）页面处理；两侧通过一致数据模型协作，不互相 import 路由。

投递简历 `POST /api/portal/apply` 匿名可提交，与邀请落地共用公开表单准入（蜜罐 + PoW + 可选 Turnstile），落库 `applications` 表并写审计；接口细节见 [API](../../architecture/API.md)。前端 PoW 指纹与后端逐字一致：`apply:<姓名>:<邮箱>`（均为 trim 后取值）。

邀请链接为能力令牌。POST 校验输入、蜜罐、PoW、可选 Turnstile；原子预留额度，调用保存的加密凭据授权的邀请操作，记录 sent/failed/pending_admin。GitHub 结果未知时不自动重发。

## UI 与验收

跨端链接使用 externalUrl，Markdown 走统一净化入口，验证码共用 TurnstileWidget 生命周期。公开表单显示提交中、成功、错误和恢复入口。

验证文档非空、内部文件不可公开、并发不超额、合同错误 400、mock DTO 与页面一致；浏览器检查路由、复制/图片和表单。参见 [测试规范](../../conventions/TESTING.md)。
