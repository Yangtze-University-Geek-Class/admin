# Issue 规范

> 适用于本仓库（GitHub 平台）的所有缺陷、需求与验收。GitHub Issue 是团队的**持久记录**，不能用聊天上下文或本地笔记替代。
> English: [ISSUES.en.md](./ISSUES.en.md)

---

## 0. 铁律

- **先查重，再新建。** 绝不因为"需要一个 issue"就直接创建。
- **一个根因 / 一个用户可见症状 = 一条 issue。** 宁可漏掉模块关联，也不得把同一个问题拆成多条。
- **拿不准是否重复时，新建 issue**，并在描述里写"可能与 #N 相关"。不要让用户在两条 issue 之间做决定。
- **新 issue 默认指派 @me**（`--assignee @me`）。只有用户在本轮对话明确点名时才改派他人。
- **AI 不得**：直接 push 到 `main`、自行合并 PR、部署、删除 issue。写入者只做本地提交与草稿分支。

---

## 1. 提 issue 前的查重流程

开放 issue 数量有限，**必须完整读取开放列表**，不能只用关键词搜。

```bash
# 全部开放 issue（含标签与指派）
gh issue list --repo Yangtze-University-Geek-Class/admin \
  --state open --limit 100 \
  --json number,title,labels,assignees,updatedAt

# 标题有交集时，逐条读详情与评论再判定
gh issue view <number> --repo Yangtze-University-Geek-Class/admin --comments
```

**已关闭的也要查**，确认是否为复发（用核心症状词搜，不要用模块名）：

```bash
gh issue list --repo Yangtze-University-Geek-Class/admin \
  --state closed --search '<核心症状>' --limit 100 \
  --json number,title,labels,state,closedAt
```

### 判定锚点

锚点是**根因或用户可见症状**，不是目录、组件或"都与某类功能有关"。

**视为重复（去已有 issue 追加评论）：**

- 同一报错或崩溃路径
- 同一功能失灵
- 相同需求换说法
- 本次仅增加了日志、截图、复现路径或影响面

**必须新建：**

- 同一模块下的不同症状
- 已有 issue 已收敛到其他范围
- 仅有模块级相似，但用户受损路径不同

---

## 2. 命中重复时

追加**可辨认的增量**，不要复述原 issue 已有内容。

```bash
gh issue comment <number> --repo Yangtze-University-Geek-Class/admin --body "$(cat <<'EOF'
补充一次复现：

- 环境：<分支 / commit / 浏览器 / 站点>
- 步骤：<最小复现路径>
- 现象：<实际发生的结果>
- 新信息：<日志、影响面，以及相对已有描述的新证据>
EOF
)"
```

- **命中已关闭的 issue 且确认复发**：先 `gh issue reopen <number> --repo Yangtze-University-Geek-Class/admin`，再追加评论。保留原排查记录，不另起重复 issue。
- **issue 未指派、且按本次工作应由当前用户跟进**：`gh issue edit <number> --add-assignee @me`。
- **已指派给他人的 issue 禁止改派。**

---

## 3. 创建规范

### 3.1 标题

统一格式：

```
<模块>：<用户可见的症状或诉求>
```

模块名用 §4 的端标签同名（`portal` / `forum` / `admin` / `server` / …）。参照现有 issue 的语言习惯。

好例子：

```
forum：归档帖内链点击后回到论坛首页
admin：邀请链接删除后列表未刷新
portal：首屏大标题在桌面端折出孤字
```

坏例子（不要这样写）：

```
修复一个 bug
论坛有问题
Select 组件需要改造          ← 这是实现方案，不是用户可见症状
```

### 3.2 描述模板

```bash
gh issue create --repo Yangtze-University-Geek-Class/admin \
  --title '<模块>：<症状或诉求>' \
  --body "$(cat <<'EOF'
## 端
- 主端：<portal | forum | admin | server | shared | deploy | docs>
- 受影响端 / 不受影响端：
- 是否需多端同时改：

## 现象
<发生了什么。附上实际观察到的文本、截图描述或报错原文>

## 复现步骤
1. 打开 <URL 或路由>
2. 点击 / 输入 <操作>
3. 观察到 <结果>

## 期望
<应该是什么样>

## 环境
<分支 / commit / 站点 / 浏览器，或"线上实测">
EOF
)" \
  --label bug --label P1 --label forum --assignee @me
```

**端**一节的填写口径：写**需要在哪些端实施或验收**，不是"改了哪端的代码"。数据修好后要在多端复验的，就都打上。

### 3.3 标签

每条 issue **必须**有：

1. **恰好一个优先级**：`P0` / `P1` / `P2`
2. **恰好一个类型**：`bug` / `enhancement`
3. **至少一个端标签**

| 优先级 | 判据 |
|---|---|
| `P0` | 线上不可用、存在数据丢失或损坏风险、阻断整个团队开发。必须立即处理 |
| `P1` | 主要功能受损但可绕过，或已明确排期的重要功能 |
| `P2` | 小缺陷、体验打磨、优化 |

**不确定时宁可低一档，禁止虚高 P0。**

端标签见 §4。跨端则多个。

```bash
# 补打标签
gh issue edit <number> --repo Yangtze-University-Geek-Class/admin --add-label P1,forum
```

---

## 4. 标签体系

| 端标签 | 覆盖范围 |
|---|---|
| `portal` | 官网站：Landing / Docs / Feedback / JoinByToken |
| `forum` | 论坛站：全部页面 + 论坛后端路由 |
| `admin` | 组织管理后台：全部页面 + `/api/admin/*` |
| `server` | 跨站点后端：`/api/docs`、`/api/feedback`、鉴权、中间件 |
| `shared` | 三站共用：`shared/ui`、`shared/lib`、`shared/config` |
| `deploy` | nginx、systemd、certbot、服务器运维 |
| `docs` | `docs/`、README、AGENTS.md |

标签不存在时先创建（需要 `repo` 权限）：

```bash
gh label create P0 --repo Yangtze-University-Geek-Class/admin --color B60205 --description "线上不可用/数据风险/阻断全员"
gh label create P1 --repo Yangtze-University-Geek-Class/admin --color D93F0B --description "主功能受损但可绕过，或已排期"
gh label create P2 --repo Yangtze-University-Geek-Class/admin --color FBCA04 --description "小缺陷/打磨/优化"
```

---

## 5. 处理与关闭

### 5.1 状态流转

```
open ──(开始处理)──> 指派 + 评论"开始"
  │
  ├─(需要更多信息)──> 加 question 标签 + 评论提问，保持 open
  ├─(确认不做)────> 加 wontfix / invalid，写清理由，关闭
  └─(完成)───────> 关联 PR 合并后自动/手动关闭
```

### 5.2 关闭条件

一条 issue 只有在**验收做完**之后才能关闭。判据按类型：

| 类型 | 关闭判据 |
|---|---|
| `bug` | 复现步骤不再触发；如果能留下回归测试，注明测试位置 |
| `enhancement` | 用户可见行为符合 §3.2 的「期望」一节，且已验收 |
| `deploy` | 线上实测通过，不是"构建成功" |

**"改了代码"不等于"完成"。** 关闭前在 issue 里评论验收证据：

```bash
gh issue comment <number> --repo Yangtze-University-Geek-Class/admin --body "$(cat <<'EOF'
验收：

- 环境：<线上 / 分支 commit>
- 验证方式：<实际操作步骤或命令>
- 结果：<观察到的输出>
- 回归：<测试位置，或"无自动化覆盖，手工验证">
EOF
)"
gh issue close <number> --repo Yangtze-University-Geek-Class/admin --reason completed
```

### 5.3 禁止

- 用"已修复"三个字关闭 issue 而不给证据。
- 未验证就关闭。
- 关闭后复发时新开一条，而不是 reopen。
- 用 issue 当 TODO 列表（那是 PR 描述或计划文档的事）。

---

## 6. 与 PR 的关系

- PR 描述里用 `Closes #12` 或 `Refs #12` 关联 issue，不要复制 issue 全文。
- 一个 PR 可以关多条 issue（同一次改动修了多个症状），但**每条被关的 issue 都要有自己的验收评论**。
- issue 描述里不要写实现方案；实现方案放 PR 描述。issue 只描述**问题和期望**。
