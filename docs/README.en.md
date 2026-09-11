# Documentation Index

This directory is the project's **accumulated knowledge base**. Before changing code, find the matching document here.

The hard rule for writing code lives in [`AGENTS.md`](../AGENTS.md) §0 — it requires stopping to consult this directory first.

> A machine-generated index of every document is in [`INDEX.md`](./INDEX.md), maintained by `node scripts/docs-index.mjs`.

中文：[README.md](./README.md)

---

## Find the doc by change type

### Conventions (mandatory)

| If you are… | Read |
|---|---|
| Filing an issue / bug / feature request | [`conventions/ISSUES.md`](./conventions/ISSUES.md) |
| Committing code, writing a commit message | [`conventions/COMMITS.md`](./conventions/COMMITS.md) |
| Opening, describing, or merging a PR | [`conventions/PULL-REQUESTS.md`](./conventions/PULL-REQUESTS.md) |
| Changing UI, adding a page, adjusting interaction | [`design/DESIGN.md`](./design/DESIGN.md) |
| Upgrading dependencies, adopting a framework, changing the build | [`design/STACK.md`](./design/STACK.md) |
| Starting on this project for the first time | [`conventions/CONTRIBUTING.md`](./conventions/CONTRIBUTING.md) |

### Architecture and current state

| If you are changing… | Read |
|---|---|
| Frontend directory layout, site boundaries, build | [`plan/WEB-SPLIT.md`](./plan/WEB-SPLIT.md) |
| Frontend current state (pages, API mapping, shared surface) | [`plan/REFACTOR.md`](./plan/REFACTOR.md) |
| Backend routes, DB schema, OAuth, encryption | [`architecture/ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) |
| Security model, threat model, protection layers | [`architecture/SECURITY.md`](./architecture/SECURITY.md) |
| Deploy, nginx, certbot, systemd, env vars | [`ops/DEPLOY.md`](./ops/DEPLOY.md) |
| User-visible features and how they work | [`ops/USAGE.md`](./ops/USAGE.md) |

---

## Folder structure

| Folder | Holds |
|---|---|
| `conventions/` | Mandatory rules: commits, issues, PRs, contribution flow |
| `design/` | Design and technology selection: page spec, version baseline |
| `architecture/` | Long-lived system design: architecture, security model |
| `plan/` | Plans and inventories: split plan, current-state survey (has a shelf life) |
| `ops/` | Operations and usage: deploy runbook, user guide |

**Where does a new document go?** Judge by its nature:

- Binding on everyone → `conventions/`
- How the UI should look, which versions to use → `design/`
- How the system is designed, where boundaries lie → `architecture/`
- TODOs, migration plans, current-state surveys → `plan/` (delete or compress once landed)
- A runbook you can follow to get something running → `ops/`

Test: **will this still be useful in six months?** Yes → `architecture/` or `design/`. No → `plan/`.

---

## Document list

### conventions/ — rules

| File | Content | EN |
|---|---|---|
| [`CONTRIBUTING.md`](./conventions/CONTRIBUTING.md) | Entry point: onboarding, flow, hard constraints, deploy, communication | [中文](./conventions/CONTRIBUTING.md) |
| [`COMMITS.md`](./conventions/COMMITS.md) | Commit convention (Conventional Commits + Chinese descriptions) | [中文](./conventions/COMMITS.md) |
| [`ISSUES.md`](./conventions/ISSUES.md) | Issue convention: dedup flow, templates, labels, closing criteria | [中文](./conventions/ISSUES.md) |
| [`PULL-REQUESTS.md`](./conventions/PULL-REQUESTS.md) | PR convention: branch model, description template, review checklist, merge | [中文](./conventions/PULL-REQUESTS.md) |

### design/ — design and technology selection

| File | Content | EN |
|---|---|---|
| [`DESIGN.md`](./design/DESIGN.md) | Page design spec: accessibility baseline, component patterns, visual and Chinese typography, state feedback | [中文](./design/DESIGN.md) |
| [`STACK.md`](./design/STACK.md) | Stack and version baseline: target combination, upgrade order, per-framework usage notes | [中文](./design/STACK.md) |

### architecture/ — system design

| File | Content | EN |
|---|---|---|
| [`ARCHITECTURE.md`](./architecture/ARCHITECTURE.md) | System architecture: topology, auth flows, DB schema, encryption, abuse controls | [中文](./architecture/ARCHITECTURE.md) |
| [`SECURITY.md`](./architecture/SECURITY.md) | Threat model + current protection layers | [中文](./architecture/SECURITY.md) |

### plan/ — plans and inventories

| File | Content | EN |
|---|---|---|
| [`WEB-SPLIT.md`](./plan/WEB-SPLIT.md) | Frontend three-site split: target structure, boundary rules, execution plan, open decisions | [中文](./plan/WEB-SPLIT.md) |
| [`REFACTOR.md`](./plan/REFACTOR.md) | Frontend inventory: site boundaries, page list, full API table, known defects | [中文](./plan/REFACTOR.md) |

### ops/ — operations and usage

| File | Content | EN |
|---|---|---|
| [`DEPLOY.md`](./ops/DEPLOY.md) | Deployment runbook + troubleshooting table | [中文](./ops/DEPLOY.md) |
| [`USAGE.md`](./ops/USAGE.md) | Usage written per role (admin / member / external visitor) | [中文](./ops/USAGE.md) |

Files named `*.en.md` are the English versions. **When you change one, change the other** (see `AGENTS.md` §4.7).

---

## Maintenance

1. **The index is generated.** After changing a document's H1 title or its first blockquote (`> ...`), run:

   ```bash
   node scripts/docs-index.mjs          # regenerate INDEX.md
   node scripts/docs-index.mjs --check  # verify only; exits 1 when stale
   ```

2. **Each folder's description comes from the first blockquote in its `README.md`.** Add one when you create a folder.

3. **Fix relative links when moving or renaming a document.** Cross-folder references use `../<folder>/<file>.md`.

4. **Binding rules must be listed in `AGENTS.md`'s mapping table**, otherwise agents do not know to read them first. The table in `AGENTS.md` §0 and the "Find the doc by change type" table here must stay in sync.

---

## Public visibility

`server/src/routes/docs.ts` holds an allowlist. **Only files listed there appear on the public docs site** (`/docs/<id>`):

```
README · USAGE · DEPLOY · ARCHITECTURE · SECURITY  (each in Chinese and English)
```

That endpoint is **unauthenticated**.

**These are deliberately not listed and are internal**:

`conventions/*` · `design/*` · `plan/*` · `INDEX.md` · `AGENTS.md`

To publish a document, add an entry to the `DOC_FILES` array in `server/src/routes/docs.ts` (`id` sets the URL, `file` sets the source; update the path to match the folder). **Confirm the content is safe to publish first** — the conventions and design docs contain server details, internal agreements, and the security posture.
