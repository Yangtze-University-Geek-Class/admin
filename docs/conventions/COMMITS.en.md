# Commit Convention

> This repository uses **Conventional Commits with Chinese descriptions**. Style follows `t-dynamic-spectrum`.
> 中文：[COMMITS.md](./COMMITS.md)

---

## 1. Format

```
<type>(<scope>): <Chinese subject>

<body: why / what / how verified>
```

- **Subject**: `type(scope): Chinese subject`, ≤ 72 chars, **no trailing period**.
- **Second line**: blank (required).
- **Body**: write it when the change needs explaining. Chinese, multiple paragraphs allowed. **Purely mechanical changes may omit the body.**

No body:

```
chore(release): 0.1.21
docs(commits): 补齐 commit 规范
deps(web): 升级 Vite 6.0.7 → 6.1.2
```

With body:

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

## 2. Type

| type | When |
|---|---|
| `feat` | New user-visible capability |
| `fix` | A defect fix (**not** "a change" — the code was broken) |
| `refactor` | Same behaviour, different structure (splitting files, extracting components, moving directories) |
| `perf` | Performance work |
| `docs` | Documentation only |
| `test` | Tests only |
| `chore` | Build, deps, config, release mechanics |
| `ci` | Pipelines |
| `style` | Pure formatting (whitespace, semicolons, quotes), no logic |

**Note**: `fix` is for real defects only. Copy tweaks, spacing adjustments, and wording changes are `feat` (if user-visible) or `style`. Misusing `fix` makes `git log --grep` useless.

---

## 3. Scope

Scope answers **which part of the system changed**, not "which files did I touch".

| scope | Area |
|---|---|
| `portal` | The public portal site |
| `forum` | The forum site |
| `admin` | The org administration console |
| `shared` | Code shared by all three sites: `shared/ui`, `shared/lib`, `shared/config` |
| `server` | Backend (cross-site: `/api/docs`, `/api/feedback`, auth, middleware) |
| `db` | Database schema, migrations, data repairs |
| `auth` | OAuth / sessions / permissions |
| `docs` | `docs/`, root README, AGENTS.md |
| `ci` | Pipelines, build scripts |
| `deploy` | nginx, systemd, certbot, server operations |
| `release` | Version numbers and publishing |
| `deps` | Dependency upgrades |

**Multiple areas**: pick the centre of gravity. If it is genuinely balanced, split into separate commits (§5). If it fits nowhere, use `shared` or `server` — **do not invent scopes**.

---

## 4. Writing the body

Answer up to three questions, in this order:

1. **Why** — what the behaviour was, why it was wrong or insufficient. Include evidence (error text, measured results, line numbers).
2. **What** — the actual change. When there was a tradeoff, say why this option over the other.
3. **Verification** — what you ran and what you saw. Where the regression test lives.

Style:

- **Chinese**, full-width punctuation.
- Backticks for code, paths, identifiers: `server/src/routes/docs.ts:10-21`.
- Bullet points are allowed but prose usually reads better.
- Conclusion first. No "first I… then I… finally I…" narration.
- Length is not capped. **Clarity beats brevity**, but do not restate the diff.

---

## 5. One commit, one change

A commit equals one independently revertible logical change. Test: **can you describe it in one sentence that needs no "and" to join two unrelated things?**

Split when:

- Bug fix + opportunistic refactor → `refactor(...)` first (make the code easy to change), then `fix(...)`.
- Schema change + code using the schema → **same** commit (the intermediate state would not run).
- Feature + docs → **same** commit (§4.7 of `AGENTS.md`: shipping code without updating docs is banned).

Do not split: file-level parts of one feature (component + styles + call site) are naturally one commit.

---

## 6. Prohibited

- Content-free subjects: `update`, `fix bug`, `修改`, `杂项`.
- `WIP` / `tmp` / `save for now` reaching the main branch.
- Emoji (consistent with `AGENTS.md` §8).
- Committing directly on `main` (branch + PR instead).
- A single commit containing an accidental `git add .` grab-bag.
- Full-width colon `：` in the subject; use a half-width `:` after type and scope.

---

## 7. Migrating from the old format

Before 2026-09 this repo used `[type][author] scope: subject`:

```
[fix][crosery] forum: auto-join 成员 group on register/OAuth signup
[feat][crosery] forum: 用户组权限配置 UI
```

**The new format drops `[author]`** (git already records authorship):

```
fix(forum): 注册/OAuth 登录时自动加入成员组
feat(forum): 用户组权限配置 UI
```

Old commits are not rewritten. New commits use the new format.

---

## 8. Branches and releases

- Feature branches: `<type>/<slug>`, e.g. `feat/web-split`, `fix/forum-dead-link`.
- Current refactor branch: `next`.
- Release commits are always `chore(release): <version>` (no `v` prefix, matching `t-dynamic-spectrum`).
- Tagging: `git tag -a <version> -m "<product name> <version>"`.

---

## 9. Self-check

```bash
# Subject format (empty output, or only legacy commits, is expected)
git log --format="%s" -20 | grep -vE "^(feat|fix|refactor|perf|docs|test|chore|ci|style)\([a-z]+\): .+"

# Confirm nothing unrelated is staged
git status --short
```

The repo currently has **no commitlint, no husky, and no CI check**. The convention relies on discipline plus code review. If enforcement is needed later, add a `commit-msg` hook — until then, do not fake a `type` to satisfy a checker that does not exist.
