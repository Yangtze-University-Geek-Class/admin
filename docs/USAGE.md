# 使用指南

线上：https://github.yangtzeu.work/

## 官网视觉样板

主站 `https://yangtzeu.work/` 当前包含新版首页视觉样板与“极客娘”看板娘模块：

- 官网、论坛和管理后台统一使用柔和校徽蓝白主题，不提供深色主题或皮肤切换。
- 首页末尾的看板娘实验区可切换 8 套姿势并点击角色查看对话。
- 主站看板娘位于右下角；论坛看板娘常驻左下角，并按首页、分类、帖子、归档和管理页面切换姿势与对话。
- 主站背景包含低对比代码流、星点和六边形动态装饰；已遵循 reduced-motion 设置，不干扰主要内容。
- 方向、文章和论坛热帖目前使用静态样板数据，后续确认设计后再接现有 API。

### 开发环境总控

执行 `pnpm dev` 或 `pnpm --filter @yzgc/web dev` 时，页面右上角显示 `DEV CONTROL`：

- 站点：在官网、论坛、管理后台之间切换，不依赖生产域名。
- 数据：`样板数据` 拦截前端 API 请求并返回本地 mock，可直接浏览受登录和权限保护的页面；`真实 API` 继续走 Vite proxy 到 3000 端口。
- 页面：提供当前站点常用页面快捷入口。
- 开发环境默认使用样板数据；生产构建强制使用真实 API，不显示总控，也不接受 query/localStorage 覆盖。

前端统一配置位于 `web/src/config/app.config.json`，包括域名、站点主题、开发/生产策略、功能开关、官网 Hero 文案和看板娘尺寸/姿势/对话。

本文档按 3 个角色组织：组织 admin / 普通成员 / 外部访客。

---

## 通用：登录与切换组织

1. 打开首页 → 点"使用 GitHub 登录"
2. GitHub 跳出 OAuth 授权页 → 点 Authorize
3. 自动跳到 `/admin`，看到你的所有组织列表
4. 进入某个组织后，左侧 sidebar 顶部有"全部组织"按钮可返回，下拉框可切换其它 org

权限自动按你在该 org 内的角色判定：org admin 看到全部 nav，member 只看到只读项。

---

## 组织 admin 视角

### 总览

`/admin/<org>` 进入即看到组织头像 / 名称 / plan / 成员数 / 仓库数 / 待处理邀请 / 活跃邀请链接。

### 成员

`/admin/<org>/members`

- 升降级（admin ↔ member）：右侧"升为 admin / 降为 member"按钮
- 移除：右侧红色"移除"按钮，弹自定义确认框
- 不能移除自己

### 邀请（pending 邀请管理）

`/admin/<org>/invitations`

显示 GitHub 上 pending 的 invitation，可一键取消。下方是本系统通过公开页 / 邀请链接发出的历史记录（含 IP、UA、状态、错误信息）。

### 邀请链接（推荐用法）

`/admin/<org>/invite-links`

生成临时链接给学生 / 新成员：

- **有效期（小时）**：1 ~ 8760
- **最大使用次数**：1 ~ 1000
- **备注**：方便区分（如 "2024 级新生群"）
- **自动加入 team**：可选；选了之后访客通过链接加入会自动归到该 team

生成后复制 URL（类似 `https://github.yangtzeu.work/join/<token>`）发到群里。

每条链接可：禁用 / 启用 / 删除。删除不影响已发出的 GitHub invitation。

### 团队

`/admin/<org>/teams`

- 新建团队：name + description + privacy（closed = 组织内可见 / secret = 仅成员可见）
- 删除团队：弹确认，提示会影响的成员数 + 仓库数

### 仓库

`/admin/<org>/repos`

列表显示所有仓库。admin 看到右上"新建仓库"按钮。点进单个仓库进入 5 个 tab：

#### Code

- 顶部分支切换器（含 `protected` 标识）
- 面包屑导航
- 点目录进入，点文件查看内容（>1MB 显示提示，>30000 行 diff 截断）

#### Commits

- 列表展示 commit message 一行 + 作者头像 + sha
- 点击进入 commit detail：完整 message + stats + 每个文件的 diff（按 `+绿 / -红 / @@蓝` 配色）

#### Issues

state 切换 open/closed/all，列表项点击跳转到 GitHub。

#### PRs

同 issues，多了 head → base 分支、merged 状态。

#### 设置（admin only）

- 分支列表 + protection 状态
- 协作者增删 + 改权限（pull / triage / push / maintain / admin）
- Webhooks 列表
- 危险区：删除仓库（弹"我已了解，删除"确认）

### 新建仓库

`/admin/<org>/repos/new`

- name（只允许字母数字 . _ -）
- description
- visibility：private / public（卡片式选择）
- 初始化 README
- .gitignore 模板（Node/Python/Go/...）
- License（MIT/Apache/GPL/...）

提交后跳转到该仓库详情。

### 活动流

`/admin/<org>/activity`

GitHub 组织最近 100 条事件（push / PR / issue / release / fork / star），有 actor 头像 + 一句话总结。

### 安全

`/admin/<org>/security`

- Dependabot 警报：Free plan 无 API，显示 unavailable
- Secret scanning：需要 GitHub Advanced Security
- Audit log：仅 Enterprise Cloud

### 组织资料

`/admin/<org>/org`

可编辑：display name / description / company / email / location / blog / twitter / billing 邮箱。

默认权限开关：所有成员对仓库的基础权限（none / read / write / admin）+ 8 个 bool 开关（成员可建仓库 / fork / 删仓 / 改可见性等）。

**改不了的两项**（GitHub API 限制）：组织 login 重命名、头像上传。需点链接跳 GitHub 网页改。

### 意见箱

`/admin/<org>/feedback`

公开提交链接：`/feedback/<org>`

意见列表显示分类 + 状态 + 内容 + 提交者（如果登录提交） + 联系方式（如果填）。

每条意见可：

- 改状态：open / triaged / in_progress / done / wont_do / spam
- 回复：写文字（公开展示，会显示在公开 feedback 页面）
- 删除

顶部 filter chip 按状态过滤。

### 操作日志

`/admin/<org>/logs`

所有 admin 操作 + 公开 API 关键事件（邀请提交、意见提交等）都在这里。带 IP、UA、详情 JSON。

---

## 普通成员视角

- 总览：能看
- 成员：列表能看，操作按钮不显示
- 团队：列表能看，不能新建 / 删除
- 仓库：能看，能进详情看代码 / commits / issues / PRs，但设置 tab 没有协作者增删 / 删仓
- 活动：能看
- 安全：能看
- 组织资料：能看，所有字段 disabled
- 邀请 / 邀请链接 / 操作日志 / 意见箱：nav 里直接不显示

---

## 外部访客视角

### 提交意见

`https://github.yangtzeu.work/feedback` 或 `/feedback/<org-login>`

- 填组织 login（如果 URL 没带）
- 选分类（建议 / Bug / 新功能 / 投诉 / 其他）
- 写内容（5 ~ 5000 字）
- 选填联系方式
- 通过 Cloudflare Turnstile（如果启用）后提交

提交后组织 admin 在 `/admin/<org>/feedback` 看到。

如果你登录了，submitter_login 会被记录；不登录就匿名。

### 通过邀请链接加入

管理员把 `https://github.yangtzeu.work/join/<token>` 发给你 → 打开 → 填 GitHub 用户名（或邮箱） → 提交 → 邀请会发到你的 GitHub 通知中心 → 接受即可。

如果链接已过期 / 用完 / 被禁用，页面会提示。

---

## 常见问题

### 我登录后看不到某个组织

GitHub OAuth App 在 GitHub 端有 org access 控制。如果你的组织开启了 OAuth App 限制，需要 owner 去 https://github.com/organizations/<org>/settings/oauth_application_policy 把 `Geek Class Admin` 加入白名单。

### 数据存哪？

SQLite 单文件，路径 `data/data.db`（生产 `/opt/yzgc-admin/data/data.db`）。

包含：sessions（含加密的 OAuth token）、invite_links、invitations（含历史）、audit_logs、feedback。

OAuth token 在落库前 AES-256-GCM 加密，key 来自 `ENCRYPTION_KEY` 环境变量。

### 我删了一个 invite_link，但已经接受邀请的人受影响吗？

不受影响。删除 invite_link 只删数据库里的记录，已经通过该链接发起的 GitHub invitation 仍然有效，可独立在 `/admin/<org>/invitations` 取消。

### 为什么没有主题切换？

官网、论坛和管理后台已统一为校徽蓝白浅色主题，深色主题和主题切换入口均已移除。旧浏览器中保存的深色主题 ID 会自动回退到校徽蓝白。

### 速度慢？

服务器在香港 5Mbps 出口，国内访问可能受带宽限。已优化：去掉 Google Fonts 外链、nginx gzip、静态资源 7 天缓存。如果还慢，挂代理或考虑 Cloudflare CDN。
