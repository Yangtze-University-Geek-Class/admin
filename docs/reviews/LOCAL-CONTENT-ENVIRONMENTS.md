# 本地内容接入与环境域名修正

> 阶段记录：发布域名合同和论坛环境展示已实现，真实内容投影已生成；当时数据接口未落盘，页面接入未完成。本机只读快照接入已于 2026-09-13 中午完成，见 FORUM-DATA-CAPTURE 最新状态。

状态：`historical` · 更新：2026-09-13 · 已被 [FORUM-DATA-CAPTURE](../ops/FORUM-DATA-CAPTURE.md) 的最新接入状态取代

## 用户明确的目标

预发布为 prev.yangtzeu.work，对应 prev-*；正式为 yangtzeu.work，对应 release-*。main 是唯一发布主线；人工试用和批准先于升级版本/打 tag。Mac localhost 仅为 local，不当成 preview。

## 实现范围

根 deploy/environments.json 为公开域名合同；scripts/deployment-environment.mjs 验证映射；release-policy 输出 publicOrigin/target 并拒绝 tag 与目标 origin 交叉。Nuxt public runtime metadata 和论坛 DeploymentInfo 展示当前环境、版本、commit 及两个规范域名；构建/运行声明不匹配时明确提醒。环境展示不授予部署权限。没有设置 DNS、证书、服务器、GitHub Secrets/Environments 或启用 CI/CD。

私有本地数据投影和附件转换见 [FORUM-DATA-CAPTURE](../ops/FORUM-DATA-CAPTURE.md)。其源为已校验的 frozen snapshot，不连接服务器。有效主题69、回复35、分类21，档案用户183；67主题为历史归档。18已删除主题和31已删除回复仍只保存在受限备份，不重新显示。85个去重后引用资产均有文件。投影不包含登录凭据、会话、邮件、IP、私有通知或权限授予。

## 未完成的页面接入

创建本地数据接口的 apply_text_edits 调用被工具安全检查屏蔽。随后只读确认 modules/forum/server 仍只有既有 routes 目录，未写入拟议接口，也未改用 shell、其他通道或浏览器脚本绕过。现有 store/persist 插件没有改动，页面数据仍来自上游示例及用户浏览器已有示例状态。界面增加了明确说明，不能宣称迁移已成功。（后续：2026-09-13 中午已按项目规范重新实现只读快照路由与前端接入，本段只保留当时事实。）

## 验证与边界

此报告的验证数字在实际执行后补充。常规测试使用虚构数据、临时 Git 仓库；真实投影的核对只用于用户授权的本机数据任务，不加入 CI。版本仍未升级，未创建 tag、commit、push，也未重启线上服务。工作区保留先前未提交工作。
