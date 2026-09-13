# Tuff Forum

A Discourse-shaped forum built entirely out of [**TuffEx**](https://www.npmjs.com/package/@talex-touch/tuffex) components on Nuxt 4 — front-end only, mock data, and **not one line of custom styling**.

It exists to answer a practical question: *can you build a real, complete application surface out of TuffEx alone?* Every layout, list, form, overlay and state in here is a TuffEx component driven through its props and slots. There is no `<style>` block, no inline `style` binding and no stylesheet of our own anywhere in `app/` — a [guard script](scripts/check-styles.mjs) enforces that on every run.

> Chinese UI. The seed content is a fictional Tuff developer community — release notes, plugin questions, component debates.

## What's in it

Fourteen routes, modelled on Discourse's own structure:

| | |
|---|---|
| `/` | Topic list — 最新 / 新 / 热门, category + tag filters, global sort, pagination. A five-column table on desktop (话题 / 发帖者 / 回复 / 浏览 / 活动 with stacked poster avatars), card rows on mobile |
| `/categories` `/c/[slug]` | Category directory with colour dots and recent topics; per-category topic lists |
| `/tags` `/tag/[slug]` | Tag cloud with counts; per-tag lists |
| `/t/[id]` | Topic page — post stream with Markdown bodies, likes, quote replies with `回复 @user` backlinks, bookmarks, inline editing, soft delete, staff pin/close, a right-hand activity timeline, participants, suggested topics, and a **bottom-drawer composer** the way Discourse does it |
| `/new` | New topic — title, category, tags (creatable), Markdown body, validated |
| `/u/[username]` | Profile — banner, six stat cards, 摘要 / 活动 / 通知 / 偏好设置 tabs |
| `/u/[username]/preferences` | Preferences — profile, avatar palette, notification switches, theme |
| `/users` | Member directory, sortable and searchable |
| `/notifications` `/bookmarks` `/search` `/about` | Notifications with per-type icons and read state; bookmarks; search across topics/posts/users; about |

Plus a ⌘K command palette, light/dark themes, a mock login that switches between twelve seeded users, and a responsive shell that folds the sidebar into a drawer under 1024px.

State lives in Pinia and persists to `localStorage`; “重置示例数据” in the sidebar footer restores the seed. The seed itself is deterministic — a seeded PRNG, no `Math.random` anywhere — so 48 topics, 221 posts, 12 users and their notifications regenerate identically every time.

## Running it

Requires Node ≥ 26 and pnpm.

```bash
pnpm install
pnpm dev          # http://localhost:3456
```

## Deploying it

The generated SPA is served as a Cloudflare Workers Asset at [`tuff-forum.tagzxia.com`](https://tuff-forum.tagzxia.com/). The checked-in `wrangler.jsonc` keeps deep links in SPA fallback mode; redeploy the current static output with:

```bash
pnpm generate
pnpm dlx wrangler@latest deploy
```

## Verifying it

The interesting part of this repo is arguably the verification, not the forum. `scripts/lib/cdp.mjs` is a dependency-free Chrome DevTools Protocol driver, and four acceptance scripts drive the real UI through it — clicking real buttons, then re-reading `localStorage` to prove the state actually moved rather than trusting the DOM.

```bash
pnpm check        # typecheck + typecheck:tests + lint + check:styles + 97 unit tests
pnpm verify       # the style guard, its self-test, and 4 CDP suites + a 64-visit route smoke
```

```
✓ check:styles                 style guard over 71 files
✓ check:styles --self-test     8 rules fail on a break, 6 negative controls stay clean
✓ verify-shell        11/11    header, sidebar, drawer, theme, session, palette, 404
✓ verify-topics       17/17    table, filters, global sort, pagination, skeleton
✓ verify-topic-page   13/13    like, reply, quote, edit, delete, pin, guest, closed
✓ verify-user-pages   12/12    follow, tabs, preferences, directory, notifications, search
✓ smoke-routes        64/64    16 routes × 2 viewports × 2 sessions, 972 icons painted
```

The smoke checks something easy to get wrong when a component library renders its own icons: it asserts that every `i-carbon-*` / `i-ri-*` element in the page has a non-empty computed `maskImage`, because TuffEx emits those classes from inside `node_modules`, where UnoCSS does not look by default.

## How it plugs into TuffEx

Three pieces do all the integration work, and they are the parts worth stealing for another Nuxt app:

- **[`modules/tuffex-components.ts`](modules/tuffex-components.ts)** — reads the published package's barrel type declarations and calls `addComponent` for every export, so every component the installed version ships (214 at `tuffex@0.6.0`, logged on each run) is globally available (and lazily chunked) without a hand-maintained list.
- **[`scripts/tuffex-icon-classes.mjs`](scripts/tuffex-icon-classes.mjs)** — scans TuffEx's `dist` for the icon classes its own templates render and feeds them into the UnoCSS `safelist`. Without this, TuffEx's built-in icons (pagination arrows, empty states, editor toolbar) render as blanks with no error.
- **[`uno.config.ts`](uno.config.ts)** / **[`nuxt.config.ts`](nuxt.config.ts)** — `presetWind3` + `presetIcons`, the reset and TuffEx's stylesheet, and `@nuxtjs/color-mode` with `classSuffix: ''` so `html.dark` lines up with TuffEx's own dark selectors.

One more thing worth knowing when consuming TuffEx from npm under pnpm 11: its runtime dependency `@talex-touch/utils` declares an `electron` peer, and pnpm 11 reads settings only from `pnpm-workspace.yaml` — not `.npmrc`, not `package.json#pnpm`. Without `autoInstallPeers: false` there, a Nuxt app quietly resolves Electron.

## Layout

```
app/
  components/     18 components — header, sidebar, topic list/row, post card, composer…
  composables/    shell state, nav model, topic filters, relative time
  data/           types, seeded PRNG, seed content, permissions, persistence
  stores/         forum (all state + actions + getters), session
  pages/          14 routes + a catch-all
modules/          the TuffEx auto-registration Nuxt module
scripts/          the style guard, the CDP driver, 5 verification scripts
tests/            97 unit tests — seed determinism, store behaviour, permissions, persistence
```

## Not in scope

No backend, no real auth, no cross-device persistence. No private messages, badges, trust levels, admin console or email — this is the shape of a forum, not a forum.

Turning it into one is planned separately: **[PRD-0001 · Cloudflare 边缘化](docs/plan-prd/PRD-0001-cloudflare-edge-forum.md)** — Workers + D1 + Durable Objects + R2 + Queues, and nothing else to operate.

## License

[MIT](LICENSE) © TalexDreamSoul
