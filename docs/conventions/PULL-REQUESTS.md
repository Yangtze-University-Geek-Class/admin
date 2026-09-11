# PR 规范

> 适用于本仓库（GitHub 平台）的所有 Pull Request。
> English: [PULL-REQUESTS.en.md](./PULL-REQUESTS.en.md)

---

## 0. 铁律

- **PR 是唯一的合并入口。** 不在 `main` 上直接提交。
- **一次 PR 一个目的。** 判据：标题能否用一句话说清，且不需要"和"字连接两件不相干的事。
- **AI 不得自行合并 PR**，也不得 push 到 `main`。合并由人执行。
- **代码 + 文档同一次提交**（`AGENTS.md` §4.7）。文档没跟上就不算完成。

---

## 1. 分支模型

```
main            ← 生产分支，只接受 PR 合并，受保护
  ├── next      ← 长期重构分支（三站拆分）
  ├── feat/*    ← 功能
  ├── fix/*     ← 缺陷
  └── docs/*    ← 纯文档
```

| 分支 | 命名 | 从哪切 | 合回哪 |
|---|---|---|---|
| 功能 | `feat/<slug>` | `main`（或长期分支） | 同上 |
| 缺陷 | `fix/<slug>` | `main` | `main` |
| 文档 | `docs/<slug>` | `main` | `main` |
| 长期重构 | `next` | `main` | `main`（阶段性合并） |

slug 用小写连字符，描述改动而非人名：`feat/web-split`、`fix/forum-dead-link`，不是 `feat/crosery-1`。

**AI 创建分支前先确认工作树干净**，`git status --short` 有输出时先弄清那些改动属于谁。

---

## 2. 创建前自检

```bash
# 1. 工作树状态：无关改动不许混入
git status --short

# 2. 与目标分支的差异（只看本次范围的目录）
git diff main...HEAD --stat

# 3. 本地能跑通：类型检查 + 构建
pnpm --filter @yzgc/web build
pnpm --filter @yzgc/server build

# 4. 确认要提交的文件，不要 git add .
git diff --cached --name-only
```

第 3 步至少跑一次。**"我没改后端的代码"不是跳过 server build 的理由**——共享类型改动会同时影响两端。

---

## 3. 创建 PR

```bash
gh pr create --repo Yangtze-University-Geek-Class/admin \
  --base main \
  --head fix/forum-dead-link \
  --title 'fix(forum): 归档区快捷链接指向官网路由导致回到论坛首页' \
  --body "$(cat <<'EOF'
## 关联
Closes #12

## 目的
<一句话说清这个 PR 解决什么>

## 改动
<改了哪些文件、哪些函数。要点式，不要复述 diff>

## 验证
<实际跑过的命令与观察到的结果。没验证的写"未验证"并说明原因>

## 影响面
- 主端：<portal | forum | admin | server | shared | deploy | docs>
- 受影响端 / 不受影响端：
- 是否有破坏性变更：<无 / 有，说明>

## 自查
- [ ] 类型检查与构建通过
- [ ] 相关文档已同步更新（AGENTS.md §4.7）
- [ ] 无硬编码密钥、无 .env、无构建产物
- [ ] 跨站跳转走 externalUrl()，未新增跨站 import
EOF
)"
```

### 3.1 标题

与 commit 首行同格式：`type(scope): 中文简述`。

type / scope 的完整词表见 [COMMITS.md](./COMMITS.md) §2–§3。

### 3.2 描述要点

**「验证」一节是必填项，也是 review 的首要检查点。**

- 跑过什么命令、看到什么输出，如实写。
- UI 改动附截图或说明如何复现。
- **没验证的必须写明"未验证"及原因**，不要留空，也不要写"应该没问题"。
- 区分"本地通过"和"线上验证"。

### 3.3 草稿 PR

改动还在进行中但需要提前征询意见时用 `--draft`：

```bash
gh pr create --draft ...
gh pr ready <number>   # 完成后转正式
```

草稿 PR **不会被 review**，仅作公示。

---

## 4. Review

### 4.1 检查项

| 维度 | 检查什么 |
|---|---|
| 正确性 | 是否真的修好了问题？有无边界情况遗漏？ |
| 范围 | 有没有夹带无关改动？有没有顺手重构？ |
| 文档 | `AGENTS.md` §4.7 的映射是否都更新了？ |
| 约定 | 命名、目录归属、`Select`/`useConfirm` 的使用、CSS 变量而非硬编码色值 |
| 边界 | 有没有新增跨站 import？跨站跳转是否走 `externalUrl()` |
| 安全 | 有无密钥泄漏、有无放宽鉴权、有无新的 `dangerouslySetInnerHTML` |
| 后端 | admin 路由是否带 `requireAuth` + `requireOrgRole`，变更是否 `audit()` |

完整的安全清单见 `AGENTS.md` §6。

### 4.2 意见分级

- **阻断（request changes）**：正确性、安全、约定违反。
- **建议（comment）**：可读性、命名、可选优化。不阻断合并。

提出阻断意见时给出**具体位置和理由**，不要只说"这里不好"。被要求改的一方如果不同意，说明理由而不是沉默照改（除非是安全项）。

### 4.3 合并

```bash
# 合并（默认 squash，保持 main 历史整洁）
gh pr merge <number> --squash --delete-branch

# 需要保留多个提交时用 merge commit（长期分支合并回 main）
gh pr merge <number> --merge
```

- 合并前确认 CI / 构建通过，且所有阻断意见已解决。
- 合并后**删除源分支**（`--delete-branch`）。
- 长期分支（`next`）合回 `main` 时在 PR 描述里列出这次带上了哪些内容。

---

## 5. PR 与 Issue 的关系

- 用 `Closes #N` 关联要关闭的 issue，`Refs #N` 关联相关但不关闭的。
- 描述里**不要复制 issue 全文**，写"为何这样改"即可——"是什么问题"在 issue 里。
- 一个 PR 关多条 issue 时，每条被关的 issue 都要有独立验收评论（见 [ISSUES.md](./ISSUES.md) §5.2）。

---

## 6. 常见退回原因

这些是本仓库历史上真实出现过的问题类型，review 时优先查：

| 退回原因 | 例子 |
|---|---|
| 跨站链接写成了站内 `Link` | `ForumHome.tsx` 的 `/docs` 在论坛路由树里不存在，线上点回首页 |
| 净化缺失 | `Docs.tsx` 的 `marked.parse` 直出，论坛侧却走了 DOMPurify |
| mock 与真实接口不一致 | `/api/docs` 的 mock 返回结构与页面期望的字段名不同 |
| 文档未同步 | 新增路由没更新 `ARCHITECTURE.md` 的路由表 |
| 夹带无关改动 | 修 bug 的 PR 里带了格式化整棵树的 diff |

---

## 7. 禁止

- 在 `main` 上直接提交或强推。
- `git add .` 后不看 `--cached` 就提交。
- 把构建产物（`web/dist`、`server/dist`）、`.env`、`*.db` 提交进仓库。
- 未验证就标"完成"。
- 自审自合（AI 场景下由人执行合并）。
- 一个大 PR 包含多个不相关目的（拆开）。
