# Issue Convention

> Applies to every defect, request, and acceptance check in this repository (GitHub platform). A GitHub Issue is the team's **durable record** — chat context and local notes do not replace it.
> 中文：[ISSUES.md](./ISSUES.md)

---

## 0. Iron rules

- **Search for duplicates first, create second.** Never create one just because "an issue is needed".
- **One root cause / one user-visible symptom = one issue.** Better to miss a module relationship than to split one problem into several issues.
- **When unsure whether it is a duplicate, create a new issue**, and write "may be related to #N" in the description. Do not make the user choose between two issues.
- **New issues are assigned to @me by default** (`--assignee @me`). Reassign to someone else only when the user names that person explicitly in the current conversation.
- **AI must not**: push directly to `main`, merge PRs on its own, deploy, or delete issues. Writers make local commits and draft branches only.

---

## 1. Duplicate check before filing an issue

The number of open issues is limited, so **read the full open list** — searching by keyword alone is not enough.

```bash
# All open issues (labels and assignees included)
gh issue list --repo Yangtze-University-Geek-Class/admin \
  --state open --limit 100 \
  --json number,title,labels,assignees,updatedAt

# When titles overlap, read the details and comments one by one before deciding
gh issue view <number> --repo Yangtze-University-Geek-Class/admin --comments
```

**Check closed issues too** — confirm whether this is a recurrence (search by the core symptom, not by module name):

```bash
gh issue list --repo Yangtze-University-Geek-Class/admin \
  --state closed --search '<核心症状>' --limit 100 \
  --json number,title,labels,state,closedAt
```

### Decision anchor

The anchor is the **root cause or the user-visible symptom**, not a directory, a component, or "all related to some kind of feature".

**Treat as a duplicate (comment on the existing issue):**

- The same error or crash path
- The same feature failing
- The same request, worded differently
- The new report only adds logs, screenshots, a reproduction path, or blast radius

**Must create a new issue:**

- Different symptoms under the same module
- The existing issue has settled on a different scope
- Only module-level similarity, but the user-facing damage path differs

---

## 2. When it is a duplicate

Append a **recognisable increment**; do not restate what the existing issue already says.

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

- **A closed issue matched and the recurrence is confirmed**: run `gh issue reopen <number> --repo Yangtze-University-Geek-Class/admin` first, then append the comment. Keep the original investigation record; do not open a duplicate issue.
- **The issue is unassigned and the current user should follow it up as part of this work**: `gh issue edit <number> --add-assignee @me`.
- **An issue assigned to someone else must not be reassigned.**

---

## 3. Creation rules

### 3.1 Title

Uniform format:

```
<模块>：<用户可见的症状或诉求>
```

The module name is the same as the area label in §4 (`portal` / `forum` / `admin` / `server` / …). Follow the language habits of existing issues.

Good examples:

```
forum：归档帖内链点击后回到论坛首页
admin：邀请链接删除后列表未刷新
portal：首屏大标题在桌面端折出孤字
```

Bad examples (do not write these):

```
修复一个 bug
论坛有问题
Select 组件需要改造          ← this is an implementation plan, not a user-visible symptom
```

### 3.2 Description template

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

**How to fill in the 端 (area) section**: write **which areas must implement or verify it**, not "which area's code changed". If data was fixed and needs re-verification on several areas, label all of them.

### 3.3 Labels

Every issue **must** have:

1. **Exactly one priority**: `P0` / `P1` / `P2`
2. **Exactly one type**: `bug` / `enhancement`
3. **At least one area label**

| Priority | Criterion |
|---|---|
| `P0` | Unusable in production, risk of data loss or corruption, blocks development for the whole team. Must be handled immediately |
| `P1` | Core functionality impaired but workable around, or an important feature that is already scheduled |
| `P2` | Small defects, polish, optimisation |

**When unsure, pick the lower level — an inflated P0 is prohibited.**

Area labels are listed in §4. Use several when the issue spans areas.

```bash
# Add missing labels
gh issue edit <number> --repo Yangtze-University-Geek-Class/admin --add-label P1,forum
```

---

## 4. Label system

| Area label | Coverage |
|---|---|
| `portal` | The portal site: Landing / Docs / Feedback / JoinByToken |
| `forum` | The forum site: all pages + forum backend routes |
| `admin` | The org administration console: all pages + `/api/admin/*` |
| `server` | Cross-site backend: `/api/docs`, `/api/feedback`, auth, middleware |
| `shared` | Shared by all three sites: `shared/ui`, `shared/lib`, `shared/config` |
| `deploy` | nginx, systemd, certbot, server operations |
| `docs` | `docs/`, README, AGENTS.md |

Create a label first if it does not exist (needs `repo` permission):

```bash
gh label create P0 --repo Yangtze-University-Geek-Class/admin --color B60205 --description "线上不可用/数据风险/阻断全员"
gh label create P1 --repo Yangtze-University-Geek-Class/admin --color D93F0B --description "主功能受损但可绕过，或已排期"
gh label create P2 --repo Yangtze-University-Geek-Class/admin --color FBCA04 --description "小缺陷/打磨/优化"
```

---

## 5. Handling and closing

### 5.1 State transitions

```
open ──(start work)──> assign + comment "开始"
  │
  ├─(needs more information)──> add the question label + ask in a comment, keep open
  ├─(decided against)────> add wontfix / invalid, state the reason, close
  └─(done)───────> close automatically/manually after the linked PR merges
```

### 5.2 Closing conditions

An issue can only be closed after **acceptance is done**. The criterion depends on the type:

| Type | Closing criterion |
|---|---|
| `bug` | The reproduction steps no longer trigger; if a regression test is left behind, note where it lives |
| `enhancement` | The user-visible behaviour matches the "期望" (Expectation) section of §3.2, and it has been accepted |
| `deploy` | Verified live in production, not "the build succeeded" |

**"The code changed" does not mean "done".** Before closing, comment the acceptance evidence in the issue:

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

### 5.3 Prohibited

- Closing an issue with the three characters "已修复" and no evidence.
- Closing before verifying.
- Opening a new issue when a closed one recurs, instead of reopening it.
- Using issues as a TODO list (that is what PR descriptions or planning docs are for).

---

## 6. Relationship with PRs

- Link issues from the PR description with `Closes #12` or `Refs #12`; do not copy the whole issue text.
- One PR can close several issues (one change fixed several symptoms), but **every closed issue needs its own acceptance comment**.
- Do not write the implementation plan in the issue description; the plan belongs in the PR description. An issue describes **the problem and the expectation** only.
