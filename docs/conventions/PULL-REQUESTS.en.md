# Pull Request Convention

> Applies to every Pull Request in this repository (GitHub platform).
> 中文：[PULL-REQUESTS.md](./PULL-REQUESTS.md)

---

## 0. Iron rules

- **A PR is the only merge entry point.** Never commit directly on `main`.
- **One PR, one purpose.** Test: can the title state it in one sentence, without needing "and" to join two unrelated things?
- **AI must not merge PRs on its own**, nor push to `main`. Merging is performed by a human.
- **Code + docs in the same commit** (`AGENTS.md` §4.7). If the docs did not keep up, the work is not done.

---

## 1. Branch model

```
main            ← production branch, protected, only accepts PR merges
  ├── next      ← long-running refactor branch (three-site split)
  ├── feat/*    ← features
  ├── fix/*     ← defects
  └── docs/*    ← docs only
```

| Branch | Naming | Cut from | Merges back into |
|---|---|---|---|
| Feature | `feat/<slug>` | `main` (or a long-running branch) | same as above |
| Defect | `fix/<slug>` | `main` | `main` |
| Docs | `docs/<slug>` | `main` | `main` |
| Long-running refactor | `next` | `main` | `main` (merges in stages) |

A slug is lowercase and hyphenated, and describes the change rather than a person: `feat/web-split`, `fix/forum-dead-link`, not `feat/crosery-1`.

**Before creating a branch, AI confirms the worktree is clean.** When `git status --short` prints anything, first work out who owns those changes.

---

## 2. Pre-creation self-check

```bash
# 1. Worktree state: unrelated changes must not be mixed in
git status --short

# 2. Diff against the target branch (only the directories in scope)
git diff main...HEAD --stat

# 3. It runs locally: type check + build
pnpm --filter @yzgc/web build
pnpm --filter @yzgc/server build

# 4. Confirm the files to be committed; do not `git add .`
git diff --cached --name-only
```

Run step 3 at least once. **"I did not change backend code" is no reason to skip the server build** — a shared type change affects both ends at once.

---

## 3. Creating a PR

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

### 3.1 Title

Same format as the first line of a commit: `type(scope): 中文简述`.

For the full list of type / scope values see [COMMITS.md](./COMMITS.md) §2–§3.

### 3.2 Description essentials

**The "验证" (Verification) section is mandatory, and it is the reviewer's first checkpoint.**

- Which commands you ran and what output you saw — write it as it happened.
- UI changes: attach a screenshot or state how to reproduce.
- **Anything unverified must say "未验证" (unverified) plus the reason** — do not leave it blank, and do not write "should be fine".
- Distinguish "passes locally" from "verified online".

### 3.3 Draft PR

When a change is still in progress but you need early feedback, use `--draft`:

```bash
gh pr create --draft ...
gh pr ready <number>   # switch to ready once finished
```

A draft PR **is not reviewed**; it is a notice only.

---

## 4. Review

### 4.1 Checks

| Dimension | What to check |
|---|---|
| Correctness | Does it really fix the problem? Any edge cases missed? |
| Scope | Any unrelated changes smuggled in? Any opportunistic refactor? |
| Docs | Are all the mappings in `AGENTS.md` §4.7 updated? |
| Conventions | Naming, directory placement, use of `Select`/`useConfirm`, CSS variables instead of hard-coded colour values |
| Boundaries | Any new cross-site import? Do cross-site navigations go through `externalUrl()`? |
| Security | Any secret leak, any loosened authorization, any new `dangerouslySetInnerHTML` |
| Backend | Do admin routes carry `requireAuth` + `requireOrgRole`, and do changes call `audit()`? |

For the full security checklist see `AGENTS.md` §6.

### 4.2 Comment severity

- **Blocking (request changes)**: correctness, security, convention violations.
- **Suggestion (comment)**: readability, naming, optional optimisation. Does not block the merge.

When raising a blocking comment, give the **specific location and the reason** — do not just say "this is bad". If the party asked to change it disagrees, state the reason rather than silently complying (unless it is a security item).

### 4.3 Merging

```bash
# Merge (squash by default, keeping main history tidy)
gh pr merge <number> --squash --delete-branch

# Use a merge commit when multiple commits must be preserved (long-running branch merging back into main)
gh pr merge <number> --merge
```

- Before merging, confirm CI / the build passes and all blocking comments are resolved.
- After merging, **delete the source branch** (`--delete-branch`).
- When a long-running branch (`next`) merges back into `main`, list in the PR description what it brings along.

---

## 5. PR and Issue relationship

- Use `Closes #N` to link the issues to be closed, `Refs #N` for related issues that stay open.
- **Do not copy the whole issue into the description**; write "why the change is made this way" — "what the problem is" lives in the issue.
- When one PR closes several issues, every closed issue needs its own independent acceptance comment (see [ISSUES.md](./ISSUES.md) §5.2).

---

## 6. Common reasons for rejection

These are the kinds of problems that have genuinely occurred in this repository; check them first during review:

| Rejection reason | Example |
|---|---|
| A cross-site link written as an in-site `Link` | `/docs` in `ForumHome.tsx` does not exist in the forum route tree, so clicking it lands back on the portal home page |
| Missing sanitisation | `marked.parse` in `Docs.tsx` renders straight to the DOM, while the forum side goes through DOMPurify |
| Mock diverging from the real API | The mock for `/api/docs` returns a different structure from the field names the page expects |
| Docs not synced | A new route without updating the route table in `ARCHITECTURE.md` |
| Unrelated changes smuggled in | A bug-fix PR carrying a diff that reformats the whole tree |

---

## 7. Prohibited

- Committing directly on `main`, or force-pushing to it.
- Committing after `git add .` without checking `--cached`.
- Committing build artefacts (`web/dist`, `server/dist`), `.env`, `*.db` into the repository.
- Marking something "done" without verifying it.
- Self-review and self-merge (in AI scenarios, a human performs the merge).
- One large PR containing several unrelated purposes (split it).
