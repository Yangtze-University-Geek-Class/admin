# Commit 提交规范

> 本仓库统一使用 **Conventional Commits + 中文描述**。风格参照 `t-dynamic-spectrum`。
> English: [COMMITS.en.md](./COMMITS.en.md)

---

## 1. 格式

```
<type>(<scope>): <中文简述>

<正文：为什么改 / 改了什么 / 怎么验证>
```

- **首行**：`type(scope): 中文简述`，≤ 72 字符，**句尾不加句号**。
- **第二行**：空行（必须）。
- **正文**：需要解释背景时写，中文，可多段。**简单的机械改动可以没有正文。**

示例（无正文，机械改动）：

```
chore(release): 0.1.21
docs(commits): 补齐 commit 规范
deps(web): 升级 Vite 6.0.7 → 6.1.2
```

示例（有正文，需要解释）：

```
fix(forum): 归档帖内链指向老站 hash 路由，点击落到官网首页

mbbs 迁移时正文原样搬运，内链仍是老站的 `#/thread/detail/<老id>`。
新站是 BrowserRouter，没有这条路由，请求落到 `PortalRoutes` 的
`path="*" → Navigate to="/"`，读者点进去只看到官网首页。

按 `forum_threads.legacy_mbbs_id` 建映射后改写为
`/forum/archive/t/<新id>`，共 5 行 27 处。复跑脚本 0 行命中（幂等），
浏览器实测内链全部可达。
```

---

## 2. type

| type | 何时用 |
|---|---|
| `feat` | 新增用户可见的能力 |
| `fix` | 修复缺陷（**不是**"改动"，是"原来坏了"） |
| `refactor` | 重构：行为不变，结构变（拆文件、抽组件、改目录） |
| `perf` | 性能优化 |
| `docs` | 只动文档 |
| `test` | 只动测试 |
| `chore` | 构建、依赖、配置、发布等杂项 |
| `ci` | 流水线 |
| `style` | 纯格式（空格、分号、引号），不含逻辑 |

**注意**：`fix` 只用于真缺陷。改文案、调间距、换措辞用 `feat`（用户可见变化）或 `style`。用错 type 会让 `git log --grep` 失真。

---

## 3. scope

scope 是**改动落在哪块**，不是"我碰了哪些文件"。本仓库的 scope 词表：

| scope | 范围 |
|---|---|
| `portal` | 官网站（`web/sites/portal` 或现行 `web/src/pages` 的官网部分） |
| `forum` | 论坛站 |
| `admin` | 组织管理后台 |
| `shared` | 三站共用：`shared/ui`、`shared/lib`、`shared/config` |
| `server` | 后端（跨站点通用：`/api/docs`、`/api/feedback`、鉴权、中间件） |
| `db` | 数据库 schema、迁移脚本、数据修复 |
| `auth` | OAuth / 会话 / 权限 |
| `docs` | `docs/` 与根 README、AGENTS.md |
| `ci` | 流水线、构建脚本 |
| `deploy` | nginx、systemd、certbot、服务器运维 |
| `release` | 版本号与发布 |
| `deps` | 依赖升级 |

**跨多块时**：选改动重心那一块；确实对等的，拆成多个 commit（见 §5）。实在无法归类用 `shared` 或 `server`，**不要自创 scope**。

---

## 4. 正文怎么写

参照 `t-dynamic-spectrum` 的风格，正文回答三个问题，能答几个答几个：

1. **为什么改**：原来是什么行为，为什么是错的 / 不够的。附证据（报错文本、实测结果、行号）。
2. **改成什么**：具体做法。涉及取舍时说明为什么选这个而不是另一个。
3. **怎么验证**：跑过什么、看到什么结果。回归测试在哪。

写法要求：

- **中文**，全角标点。
- 代码、路径、标识符用反引号：`server/src/routes/docs.ts:10-21`。
- 可以分点，但更多时候顺段落更自然。
- 结论前置。不要"我首先…然后…最后…"的流水账。
- 长度不设限。**讲清楚比讲简短重要**，但也别把 diff 复述一遍。

---

## 5. 一次提交一件事

一个 commit = 一个可独立回滚的逻辑改动。判据：**能否用一句话说清这次提交干了什么，且这句话不需要"和"字连接两件不相干的事。**

需要拆的典型情况：

- 修 bug + 顺手重构 → 拆成 `fix(...)` 和 `refactor(...)`，refactor 在前（先让代码好改，再改行为）。
- 改 schema + 改用到 schema 的代码 → 同一次提交（否则中间状态跑不起来）。
- 加功能 + 改文档 → 同一次提交（见 `AGENTS.md` §4.7：改代码不更新文档是禁止的）。

不需要拆的：同一功能的文件级改动（组件 + 样式 + 调用点）天然是一个 commit。

---

## 6. 禁止

- `update` / `fix bug` / `修改` / `杂项` 这种无信息量的简述。
- `WIP` / `tmp` / `先存一下` 提交进主干。
- emoji（提交信息里不用，与 `AGENTS.md` §8 一致）。
- 在 `main` 上直接提交（走分支 + PR）。
- 把 `git add .` 的一堆无关改动塞进同一个 commit。
- 首行用全角冒号 `：`；用半角 `:` 分隔 type 和 scope。

---

## 7. 从旧格式迁移

本仓库 2026-09 之前用的是 `[type][author] scope: 简述`，例如：

```
[fix][crosery] forum: auto-join 成员 group on register/OAuth signup
[feat][crosery] forum: 用户组权限配置 UI
```

**新格式不再带 `[author]`**（git 本身记录了作者），改为：

```
fix(forum): 注册/OAuth 登录时自动加入成员组
feat(forum): 用户组权限配置 UI
```

旧提交不回改。新提交一律走新格式。

---

## 8. 分支与发布

- 功能分支命名：`<type>/<简述>`，如 `feat/web-split`、`fix/forum-dead-link`。
- 当前重构分支：`next`。
- 发布提交固定写法：`chore(release): <版本号>`（版本号不带 `v` 前缀，与 `t-dynamic-spectrum` 一致）。
- 打标签：`git tag -a <版本号> -m "<产品名> <版本号>"`。

---

## 9. 校验

提交前自查：

```bash
# 首行格式校验（应输出空，或只有历史遗留的旧格式）
git log --format="%s" -20 | grep -vE "^(feat|fix|refactor|perf|docs|test|chore|ci|style)\([a-z]+\): .+"

# 看这次要提交什么，确认没有夹带
git status --short
```

仓库当前**没有 commitlint / husky / CI 校验**。规范靠自觉 + code review。后续如需强制，再加 `commit-msg` 钩子；在那之前不要为了"过校验"而写假 type。
