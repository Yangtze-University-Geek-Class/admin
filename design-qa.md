# 项目地图设计验收

> 对照用户给定节点地图；真实浏览器已完成桌面、窄屏、搜索关联与影响报告验收。

状态：`current` · 更新：2026-10-18

- source visual truth path：`~/work_file/ibuki-node-map.html`；参考截图 `.tools/catalog/reference.png`，只用于本机对比，不公开其他项目拓扑。
- implementation：`docs/architecture/catalog/map.html`。
- implementation screenshot：`.tools/catalog/map-desktop.png`、`map-mobile-detail.png`、`map-mobile-nav.png`。
- viewport：1440×900 与 390×844，ego-browser TaskSpace 113。
- state：总览、搜索/钻取、节点详情、PR 影响导入及窄屏。
- full-view comparison evidence：`.tools/catalog/comparison.png`，参考与实现分别以 1440×900、浅色主题捕获后并排查看；参考的其它项目数据只留本机。
- focused region comparison evidence：工具条、左侧目录、卡片端口、连线、缩略图延续参考结构；窄屏详情独立滚动，页面宽度实测 390/390，无横向溢出。

## Findings

- 原空间 109 丢失后，用户明确要求完成剩余工作；新建 113，未接管其它空间。
- 搜索“取消投递”并按 Enter 打开流程，关联跳转到 applications 后实际显示 class_name。
- 390px 打开目录、进入通知邮件、搜索权限、关闭详情均完成；详情关闭后 inspector 不可见。
- 导入本次真实影响报告后显示“PR #257 · 报告通过”，当前视图高亮 12 个节点；篡改摘要的报告显示“不一致，请重新生成”，高亮清零。
- 缩放由 0.567901 增至 0.709877；真实指针拖动卡片位移约 60×30px，重置恢复布局。
- 最终 98 条流程生成物已 reload 后复验：精确搜索“取消投递”优先定位 flow:application.cancel，关联表详情显示 class_name；搜索 applications.review 优先定位能力节点。旧页面与新报告摘要不一致会拒绝，刷新相同来源后正常导入。
- 本机未跑 Playwright；浏览器用例由 PR CI 执行，不能把此前仅类型检查写成通过。

## Fidelity surfaces

- 字体：复用参考系统字体栈，桌面与窄屏截图已查看；长接口路径与证据路径可换行。
- 间距与布局：复用分区、节点端口、缩略图和详情框架；业务域多视图和窄屏覆盖层已实测，未发现遮挡主要操作的布局问题。
- 色彩：复用参考已有浅色令牌并默认浅色；状态改为源码收录/契约缺口/显式声明，不再标成在线。
- 图像与图标：复用给定查看器的实际图标和连线实现，没有用新绘制资产替代参考图片，也没有导入其项目数据。
- 文案：替换为本仓真实目录实体，明确源码摘要及未核验部署状态；桌面总览与窄屏详情可阅读。

## Patches made

已接入同源节点关系、业务域钻取、全局搜索、PR 影响报告导入及摘要校验、键盘操作和窄屏目录/详情；无效边不再静默跳过。

## Implementation checklist

1. 浏览器空间 113 已建立并完成验收。
2. 同视口并排比较及关键区域检查已完成。
3. 桌面、窄屏及报告拒绝路径已实测；目录补全后已复查最终生成物，最终截图入库于 `docs/reviews/257/map-desktop.png` 与 `map-mobile.png`。

final result: passed
