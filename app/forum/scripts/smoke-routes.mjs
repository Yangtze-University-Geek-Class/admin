import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { launchChrome, sleep, waitForHttp } from './lib/cdp.mjs'

/**
 * AC3 smoke: walks every route the forum exposes — 14 real ones plus one URL
 * that must not match — in four passes (1280×800 and 390×844, signed in and
 * as a guest), and for each one asserts:
 *
 *   http ........ the dev server answered 200
 *   path ........ the SPA settled on the expected URL
 *   title ....... the page's own `useHead` title, which proves the route
 *                 component ran rather than the shell merely painting
 *   marker ...... a route-specific element with a minimum count
 *   console ..... zero [Vue warn] / Uncaught / Failed to resolve / rejection
 *   overflow .... documentElement.scrollWidth <= clientWidth + 1
 *   icons ....... every i-carbon-* / i-ri-* element in the page has a
 *                 non-empty computed mask-image or background-image
 *
 * The icon sweep needs a positive control, or a page with no icons would pass
 * it vacuously: every visit must find at least one icon element, and the run
 * as a whole must have seen the tuffex-internal classes that this project
 * never writes itself (`i-carbon-chevron-*` from TxPagination), which can only
 * be painted if the node_modules scan behind `uno.config.ts`'s safelist did
 * its job, and the `i-ri-*` namespace (PostEditor's mode switch on /new),
 * which proves the second icon collection reaches UnoCSS.
 *
 * Every failure is collected rather than thrown, so one broken route does not
 * hide the state of the other thirteen. `reports/smoke.json` carries the whole
 * per-route table.
 */

const BASE = process.env.TUFF_FORUM_URL ?? 'http://localhost:3456'
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))

const STATE_KEY = 'tuff-forum:state:v1'
const SESSION_KEY = 'tuff-forum:session:v1'
/** The persist plugin debounces its writes by 150 ms. */
const PERSIST_MS = 450

/** Classes no page in `app/` writes — seeing them painted proves the safelist covers tuffex's own markup. */
const REQUIRED_TUFFEX_ICONS = ['i-carbon-chevron-right', 'i-carbon-chevron-left']
const MIN_RI_CLASSES = 3
const MIN_DISTINCT_ICONS = 20

const VIEWPORTS = [
  { label: 'desktop', width: 1280, height: 800 },
  { label: 'mobile', width: 390, height: 844 },
]

/**
 * Drops the containers the shell keeps mounted beside the page: the sidebar
 * (a second copy lives inside the mobile drawer, where it is `inert`),
 * TxSelect's teleported option panels, the login modal and any drawer.
 */
const PAGE_ONLY = `const pageOnly = list => list.filter(el => !el.closest('.tx-bui-sidebar-nav') && !el.closest('.tuff-select__panel') && !el.closest('.tx-modal__overlay') && !el.closest('.tx-drawer'))`

/**
 * The like button in a post names itself by its text, 「赞」 or 「赞 N」 (#143),
 * not by an aria-label over a bare count. Browser-side source for `scope`.
 */
const LIKE_BUTTON_IN = scope => `[...(${scope}?.querySelectorAll('button') ?? [])].find(b => /^赞(?: \\d+)?$/.test(b.textContent.replace(/\\s+/g, ' ').trim()))`
const HAS_LIKE = `!!${LIKE_BUTTON_IN('document')}`

const results = []
const failures = []
/** Results of the post-walk theme and reset checks; `null` when a filtered run skipped them. */
let lifecycle = null
let theme = null
/** Union of every icon class the run painted, for the run-level positive control. */
const seenIconClasses = new Set()

function fail(route, rule, evidence) {
  failures.push({ route: `${route.mode} ${route.viewport} ${route.url}`, rule, evidence })
  console.error(`  ✗ ${route.url} — ${rule} — ${evidence}`)
}

// ---------------------------------------------------------------- dev server

async function isUp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return response.status === 200
  }
  catch {
    return false
  }
}

let devServer = null
if (!await isUp(`${BASE}/`)) {
  console.log('[smoke] no dev server on 3456; starting one')
  devServer = spawn('pnpm', ['dev'], { cwd: PROJECT_ROOT, stdio: 'ignore', detached: true })
  await waitForHttp(`${BASE}/`)
}
else {
  console.log('[smoke] reusing the dev server already on 3456')
}

const chrome = await launchChrome({ watchdogMs: 900_000 })
const { evaluate, waitFor, open, emulate, screenshot, problems } = chrome

// ------------------------------------------------------------------ preflight

/**
 * The persist plugin only writes once a store mutates, so the seed is not in
 * localStorage until something changes it. Opening a topic bumps its view
 * counter, which is the cheapest mutation there is.
 */
async function readSeed() {
  await emulate({ width: 1280, height: 800 })
  await open(`${BASE}/t/t1`)
  await waitFor(`!!document.querySelector('.tx-markdown-view')`, { timeoutMs: 30_000 })
  await sleep(PERSIST_MS)
  const state = await evaluate(`(() => JSON.parse(localStorage.getItem(${JSON.stringify(STATE_KEY)}) ?? 'null'))()`)
  if (!state)
    throw new Error('no forum state in localStorage after opening /t/t1')
  return state
}

function buildRoutes(state) {
  const topic = state.topics.find(candidate => candidate.id === 't1') ?? state.topics[0]
  const category = state.categories.find(candidate => candidate.id === topic.categoryId) ?? state.categories[0]
  const counts = new Map()
  for (const entry of state.topics) {
    for (const tagId of entry.tagIds)
      counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
  }
  const tag = state.tags.find(candidate => (counts.get(candidate.id) ?? 0) > 0) ?? state.tags[0]
  const me = state.users.find(candidate => candidate.id === 'u1') ?? state.users[0]
  const both = markers => ({ auth: markers, guest: markers })

  // A category/tag pair no topic carries: the AND-ed filter must empty the list.
  let emptyFilter = null
  for (const candidate of state.categories) {
    const tagless = state.tags.find(candidateTag =>
      !state.topics.some(entry => entry.categoryId === candidate.id && entry.tagIds.includes(candidateTag.id)))
    if (tagless) {
      emptyFilter = { category: candidate, tag: tagless }
      break
    }
  }

  return [
    { id: 'topics', url: '/', title: '话题', markers: both([['.tx-bui-filter-chips', 1], ['.tx-pagination', 1]]) },
    ...(emptyFilter
      ? [{
          id: 'topics-empty',
          url: `/?category=${emptyFilter.category.slug}&tag=${emptyFilter.tag.slug}`,
          title: '话题',
          markers: both([['.tx-empty-state', 1]]),
        }]
      : []),
    { id: 'categories', url: '/categories', title: '类别', markers: both([['.tx-card-item', state.categories.length]]) },
    { id: 'category', url: `/c/${category.slug}`, title: category.name, markers: both([['.tx-breadcrumb', 1], ['.tx-card-item', 1]]) },
    { id: 'tags', url: '/tags', title: '标签', markers: both([['.tx-tag', 10]]) },
    { id: 'tag', url: `/tag/${tag.slug}`, title: `#${tag.name}`, markers: both([['.tx-breadcrumb', 1]]) },
    { id: 'topic', url: `/t/${topic.id}`, title: topic.title, markers: both([['.tx-markdown-view', 1]]) },
    {
      id: 'new',
      url: '/new',
      title: '新话题',
      // A guest may not post: the form is replaced by a permission empty state.
      markers: { auth: [['.tx-form', 1], ['[data-post-editor] .tx-textarea__field', 1], ['[data-post-editor] [role="radio"]', 3]], guest: [['.tx-empty-state', 1]] },
    },
    { id: 'user', url: `/u/${me.username}`, title: me.displayName, markers: both([['.tx-stat-card', 6]]) },
    {
      id: 'preferences',
      url: `/u/${me.username}/preferences`,
      title: `${me.displayName} 的偏好设置`,
      // A guest is shown a permission card here rather than being redirected;
      // only a signed-in stranger is sent back (verify-user-pages step 5).
      markers: { auth: [['.tx-group-block', 1]], guest: [['.tx-empty-state', 1]] },
    },
    { id: 'users', url: '/users', title: '用户', markers: both([['.tx-data-table', 1]]) },
    {
      id: 'notifications',
      url: '/notifications',
      title: '通知',
      markers: { auth: [['.tx-bui-filter-chips', 1]], guest: [['.tx-empty-state', 1]] },
    },
    {
      id: 'bookmarks',
      url: '/bookmarks',
      title: '书签',
      markers: { auth: [['h1', 1]], guest: [['.tx-empty-state', 1]] },
    },
    { id: 'search', url: '/search?q=tuffex', title: '搜索', markers: both([['[role="tab"]', 3]]) },
    { id: 'about', url: '/about', title: '关于', markers: both([['.tx-stat-card', 3]]) },
    // Not a route: the catch-all must turn it into the 404 error page.
    { id: 'unmatched', url: '/this-route-does-not-exist-9f3a', title: '哎呀，这个页面不存在', markers: both([['.tx-empty-state', 1]]) },
  ]
}

// ---------------------------------------------------------------- per-route

const probeExpression = markers => `(() => {
  ${PAGE_ONLY}
  const markers = ${JSON.stringify(markers)}.map(([selector, min]) => {
    const found = pageOnly([...document.querySelectorAll(selector)]).length
    return { selector, min, found, ok: found >= min }
  })
  const icons = pageOnly([...document.querySelectorAll('[class*="i-carbon-"], [class*="i-ri-"]')])
  const unpainted = []
  const classes = new Set()
  for (const el of icons) {
    for (const token of el.classList) {
      if (/^i-(?:carbon|ri)-/.test(token))
        classes.add(token)
    }
    const style = getComputedStyle(el)
    const mask = style.maskImage || style.webkitMaskImage || ''
    const background = style.backgroundImage || ''
    if ((!mask || mask === 'none') && (!background || background === 'none'))
      unpainted.push(String(el.className || el.tagName).slice(0, 80))
  }
  const doc = document.documentElement
  return {
    title: document.title,
    path: location.pathname + location.search,
    markers,
    icons: { total: icons.length, unpainted, classes: [...classes] },
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
  }
})()`

const pick = (value, mode) => (value && typeof value === 'object' && !Array.isArray(value) ? value[mode] : value)

async function visit(route, mode, viewport) {
  const context = { mode, viewport: viewport.label, url: route.url }
  const markers = pick(route.markers, mode)
  const expectedPath = pick(route.path, mode) ?? route.url
  const expectedTitle = `${pick(route.title, mode)} · Tuff Forum`

  let http
  try {
    http = (await fetch(`${BASE}${route.url}`)).status
  }
  catch (error) {
    http = `fetch failed: ${error.message}`
  }

  await open(`${BASE}${route.url}`)
  // Wait for every marker, not just the first: `/`'s pagination only appears
  // once the deferred first-paint skeleton has finished its minimum duration.
  for (const [selector, min] of markers) {
    try {
      await waitFor(`(() => { ${PAGE_ONLY}; return pageOnly([...document.querySelectorAll(${JSON.stringify(selector)})]).length >= ${min} })()`, { timeoutMs: 20_000 })
    }
    catch {
      // Recorded below by the marker assertion, with the real counts.
    }
  }
  await sleep(200)

  const probe = await evaluate(probeExpression(markers))
  const consoleProblems = problems()
  const entry = {
    id: route.id,
    mode,
    viewport: viewport.label,
    url: route.url,
    http,
    title: probe.title,
    path: probe.path,
    markers: probe.markers,
    icons: { total: probe.icons.total, unpainted: probe.icons.unpainted.length, classes: probe.icons.classes.length },
    scrollWidth: probe.scrollWidth,
    clientWidth: probe.clientWidth,
    consoleProblems: consoleProblems.length,
    ok: true,
  }

  const before = failures.length
  if (http !== 200)
    fail(context, 'http', `expected 200, got ${http}`)
  if (probe.path !== expectedPath)
    fail(context, 'path', `settled on ${probe.path}, expected ${expectedPath}`)
  if (probe.title !== expectedTitle)
    fail(context, 'title', `document.title is ${JSON.stringify(probe.title)}, expected ${JSON.stringify(expectedTitle)}`)
  for (const marker of probe.markers) {
    if (!marker.ok)
      fail(context, 'marker', `${marker.selector} matched ${marker.found} element(s), expected >= ${marker.min}`)
  }
  if (consoleProblems.length)
    fail(context, 'console', JSON.stringify(consoleProblems.slice(0, 4)))
  if (probe.scrollWidth > probe.clientWidth + 1)
    fail(context, 'overflow', `scrollWidth ${probe.scrollWidth} > clientWidth ${probe.clientWidth}`)
  if (probe.icons.unpainted.length)
    fail(context, 'icons', `${probe.icons.unpainted.length} unpainted: ${JSON.stringify(probe.icons.unpainted.slice(0, 4))}`)
  else if (probe.icons.total < 1)
    fail(context, 'icons', 'no icon element on the page at all; the sweep would have passed vacuously')
  for (const token of probe.icons.classes)
    seenIconClasses.add(token)

  entry.ok = failures.length === before
  if (!entry.ok)
    await screenshot(`reports/smoke-fail-${route.id}-${mode}-${viewport.label}.png`).catch(() => {})
  else
    console.log(`  ✓ ${route.url.padEnd(34)} ${String(probe.icons.total).padStart(3)} icons · ${probe.markers.map(m => `${m.selector}×${m.found}`).join(' ')}`)

  results.push(entry)
}

/** The session is read once, when the persist plugin runs; write it from a neutral route. */
async function setMode(mode) {
  await open(`${BASE}/about`)
  const value = mode === 'guest' ? null : 'u1'
  await evaluate(`localStorage.setItem(${JSON.stringify(SESSION_KEY)}, JSON.stringify({ currentUserId: ${JSON.stringify(value)} }))`)
}

const readState = `(() => JSON.parse(localStorage.getItem(${JSON.stringify(STATE_KEY)}) ?? 'null'))()`

/**
 * AC5: the theme toggle must repaint tuffex's own surfaces *and* the markdown
 * body (TxMarkdownView watches `html.class` through a MutationObserver of its
 * own), and the choice must survive a reload.
 */
async function checkTheme(state) {
  const context = { mode: 'auth', viewport: 'desktop', url: '(theme)' }
  // The markdown repaint is measured on a code block, so pick a topic that has
  // one rather than assuming /t/t1 does.
  // `.tx-markdown-view.dark` restyles the markdown body's own surfaces. The
  // seed has no fenced blocks, so take whichever of these the rendered post
  // actually produces; if none paints, say so instead of passing vacuously.
  const MARKDOWN_SURFACES = ['.markdown-body pre', '.markdown-body blockquote', '.markdown-body code', '.markdown-body table th']
  const fenced = state.posts.find(post => !post.deleted && /(?:^|\n)(?:```|>\s|\|)/.test(post.content))
  const topicId = fenced?.topicId ?? 't1'
  // TxMarkdownView loads dompurify dynamically and renders an empty body until
  // it resolves, so waiting for the component is not waiting for its content.
  const rendered = `document.querySelectorAll('.tx-markdown-view .markdown-body > *').length > 0`
  await emulate({ width: 1280, height: 800 })
  await setMode('auth')
  await open(`${BASE}/t/${topicId}`)
  await waitFor(rendered, { timeoutMs: 20_000 })

  const SURFACES = ['.tx-bui-sidebar-nav', '.tx-card', '.tx-status-badge', '.tx-tag']
  const sample = `(() => {
    const transparent = value => !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)'
    const firstPainted = (selectors) => {
      for (const selector of selectors) {
        const el = document.querySelector(selector)
        if (!el) continue
        const background = getComputedStyle(el).backgroundColor
        if (!transparent(background))
          return { selector, background }
      }
      return null
    }
    // TxMarkdownView does its own theming: it puts \`dark\` on its root and
    // restyles the markdown body from there. The page's inherited text colour
    // would flip either way, so it is not the thing to measure.
    const view = document.querySelector('.tx-markdown-view')
    return {
      dark: document.documentElement.classList.contains('dark'),
      viewDark: view ? view.classList.contains('dark') : null,
      viewTheme: view ? view.dataset.theme ?? null : null,
      markdown: firstPainted(${JSON.stringify(MARKDOWN_SURFACES)}),
      surface: firstPainted(${JSON.stringify(SURFACES)}),
      body: getComputedStyle(document.body).backgroundColor,
    }
  })()`
  const toggle = `(() => {
    const el = document.querySelector('header button[aria-label="切换主题"]')
    if (!el) return false
    el.click()
    return true
  })()`

  let light = await evaluate(sample)
  if (light.dark) {
    await evaluate(toggle)
    await sleep(600)
    light = await evaluate(sample)
  }
  if (light.dark) {
    fail(context, 'theme', 'could not reach a light baseline')
    return
  }

  if (!await evaluate(toggle)) {
    fail(context, 'theme', 'no 切换主题 control in the header')
    return
  }
  await sleep(600)
  const dark = await evaluate(sample)

  if (!dark.dark)
    fail(context, 'theme', 'the toggle did not add html.dark')
  if (light.viewDark !== false || dark.viewDark !== true)
    fail(context, 'theme', `TxMarkdownView's own theme did not follow: light ${light.viewDark}/${light.viewTheme} → dark ${dark.viewDark}/${dark.viewTheme}`)
  if (!light.markdown)
    fail(context, 'theme', `none of ${MARKDOWN_SURFACES.join(' / ')} paints a background in the rendered post; the markdown repaint comparison would prove nothing`)
  else if (dark.markdown?.selector !== light.markdown.selector || dark.markdown.background === light.markdown.background)
    fail(context, 'theme', `${light.markdown.selector} kept ${light.markdown.background} in dark mode`)
  if (!light.surface)
    fail(context, 'theme', `none of ${SURFACES.join(' / ')} paints a background in light mode; the surface comparison would prove nothing`)
  else if (dark.surface?.selector !== light.surface.selector || dark.surface.background === light.surface.background)
    fail(context, 'theme', `${light.surface.selector} kept ${light.surface.background} in dark mode`)
  if (dark.body === light.body)
    fail(context, 'theme', `the page background kept ${light.body} in dark mode`)

  await open(`${BASE}/t/${topicId}`)
  await waitFor(rendered, { timeoutMs: 20_000 })
  const reloaded = await evaluate(sample)
  if (!reloaded.dark || reloaded.viewDark !== true || reloaded.body !== dark.body)
    fail(context, 'theme', `the dark choice did not survive a reload: ${JSON.stringify(reloaded)}`)

  // Leave the profile light so the reset check starts from the default.
  await evaluate(toggle)
  await sleep(400)

  const problemsFound = problems()
  if (problemsFound.length)
    fail(context, 'console', JSON.stringify(problemsFound.slice(0, 4)))

  return {
    light: { markdown: light.markdown, surface: light.surface, body: light.body },
    dark: { markdown: dark.markdown, surface: dark.surface, body: dark.body },
    line: `TxMarkdownView ${light.viewTheme}→${dark.viewTheme} (${light.markdown?.selector} ${light.markdown?.background} → ${dark.markdown?.background}), ${light.surface?.selector} ${light.surface?.background} → ${dark.surface?.background}, body ${light.body} → ${dark.body}, html.dark survives a reload`,
  }
}

/**
 * AC4's last link: a local mutation survives a reload, and 「重置示例数据」
 * throws it away for a fresh seed. Runs after the route walk so it cannot
 * disturb any route's result, and drives the real sidebar control rather than
 * calling the store.
 */
async function checkResetLifecycle() {
  const context = { mode: 'auth', viewport: 'desktop', url: '(reset lifecycle)' }
  await emulate({ width: 1280, height: 800 })
  await setMode('auth')
  await open(`${BASE}/t/t1`)
  await waitFor(HAS_LIKE, { timeoutMs: 20_000 })

  const before = await evaluate(readState)
  const likedPost = 'p2'
  const likesBefore = before.posts.find(post => post.id === likedPost)?.likeUserIds.length ?? 0

  const clicked = await evaluate(`(() => {
    const post = document.querySelector('#post-${likedPost}') ?? document.querySelectorAll('[id^="post-p"]')[1]
    const button = ${LIKE_BUTTON_IN('post')}
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!clicked) {
    fail(context, 'reset', 'could not find the like control on /t/t1')
    return
  }
  await sleep(PERSIST_MS)

  const mutated = await evaluate(readState)
  const likesAfter = mutated.posts.find(post => post.id === likedPost)?.likeUserIds.length ?? 0
  if (likesAfter !== likesBefore + 1) {
    fail(context, 'reset', `the like did not persist: ${likesBefore} → ${likesAfter}`)
    return
  }

  // Survives a reload, which is what makes the reset meaningful.
  await open(`${BASE}/t/t1`)
  await waitFor(HAS_LIKE, { timeoutMs: 20_000 })
  const reloaded = await evaluate(readState)
  if ((reloaded.posts.find(post => post.id === likedPost)?.likeUserIds.length ?? 0) !== likesAfter)
    fail(context, 'reset', 'the like did not survive a reload')

  // Flip this topic's pin (admin is staff) so the reset has something of its
  // own to undo *on screen*. A page that captured its topic at setup instead of
  // reading it through the store keeps rendering the flipped value afterwards.
  const pinBadge = `[...document.querySelectorAll('.tx-status-badge')].some(el => el.textContent.trim() === '已置顶')`
  const pinnedBeforeFlip = await evaluate(pinBadge)
  const flipItem = pinnedBeforeFlip ? '取消置顶' : '置顶话题'
  const flipped = await evaluate(`(() => {
    const menu = document.querySelector('button[aria-label="话题管理"]')
    if (!menu) return false
    menu.click()
    return true
  })()`)
  if (!flipped) {
    fail(context, 'reset', 'no 话题管理 menu on /t/t1 for the admin session')
    return
  }
  await waitFor('!!document.querySelector(\'.tx-dropdown__panel\')')
  const picked = await evaluate(`(() => {
    const el = [...document.querySelectorAll('.tx-dropdown__panel .tx-dropdown-item')].find(e => e.textContent.trim() === ${JSON.stringify(flipItem)})
    if (!el) return false
    el.click()
    return true
  })()`)
  if (!picked) {
    fail(context, 'reset', `no ${flipItem} item in the 话题管理 menu`)
    return
  }
  await sleep(PERSIST_MS)
  if (await evaluate(pinBadge) === pinnedBeforeFlip)
    fail(context, 'reset', `the 已置顶 badge did not follow ${flipItem}`)

  const opened = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.tx-bui-sidebar-nav button')].find(el => el.textContent.trim() === '重置示例数据')
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!opened) {
    fail(context, 'reset', 'no 重置示例数据 control in the sidebar footer')
    return
  }
  await waitFor(`!!document.querySelector('.tx-modal__overlay')`)
  const confirmed = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.tx-modal__overlay button')].find(el => el.textContent.trim() === '确认重置')
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!confirmed) {
    fail(context, 'reset', 'no 确认重置 button in the confirmation modal')
    return
  }
  await sleep(PERSIST_MS + 300)

  const after = await evaluate(readState)
  const likesReset = after.posts.find(post => post.id === likedPost)?.likeUserIds.length ?? 0
  if (likesReset !== likesBefore)
    fail(context, 'reset', `the reset did not drop the like: ${likesBefore} → ${likesReset}`)

  // Still on the same mounted page: the header has to show the fresh seed's pin
  // state, not the one this session flipped.
  const seedPinned = after.topics.find(topic => topic.id === 't1')?.pinned ?? false
  const shownPinned = await evaluate(pinBadge)
  if (shownPinned !== seedPinned)
    fail(context, 'reset', `the topic header kept its pre-reset pin state: shows ${shownPinned}, seed says ${seedPinned}`)
  if (after.seededAt === before.seededAt)
    fail(context, 'reset', 'seededAt is unchanged; the state was not reseeded')
  if (after.topics.length !== before.topics.length || after.posts.length !== before.posts.length)
    fail(context, 'reset', `the reseed changed the corpus size: ${before.topics.length}/${before.posts.length} → ${after.topics.length}/${after.posts.length}`)

  // And it stays reset.
  await open(`${BASE}/t/t1`)
  await waitFor(HAS_LIKE, { timeoutMs: 20_000 })
  const persisted = await evaluate(readState)
  if ((persisted.posts.find(post => post.id === likedPost)?.likeUserIds.length ?? 0) !== likesBefore)
    fail(context, 'reset', 'the like came back after a reload')

  const problemsFound = problems()
  if (problemsFound.length)
    fail(context, 'console', JSON.stringify(problemsFound.slice(0, 4)))

  return {
    likes: { before: likesBefore, afterLike: likesAfter, afterReset: likesReset },
    pinned: { flippedTo: !pinnedBeforeFlip, afterReset: shownPinned, seed: seedPinned },
    seededAt: { before: before.seededAt, after: after.seededAt },
    corpus: { topics: after.topics.length, posts: after.posts.length },
    line: `like ${likesBefore} → ${likesAfter} survived a reload, ${flipItem} flipped the 已置顶 badge, 重置示例数据 → like ${likesReset} and pin ${shownPinned} with a new seed (${after.topics.length} topics / ${after.posts.length} posts restored)`,
  }
}

// --------------------------------------------------------------------- main

try {
  const state = await readSeed()
  let routes = buildRoutes(state)
  // `--only topics,about` keeps a mutation test to a few seconds. The full run
  // (no flag) is what the gate uses; the run-level icon control is skipped for
  // a filtered run because it needs the whole sweep to be meaningful.
  const onlyIndex = process.argv.indexOf('--only')
  const only = onlyIndex === -1 ? null : new Set(process.argv[onlyIndex + 1].split(','))
  if (only)
    routes = routes.filter(route => only.has(route.id))
  console.log(`[smoke] ${routes.length} routes × ${VIEWPORTS.length} viewports × 2 sessions = ${routes.length * VIEWPORTS.length * 2} visits\n`)

  for (const viewport of VIEWPORTS) {
    for (const mode of ['auth', 'guest']) {
      await emulate({ width: viewport.width, height: viewport.height, mobile: viewport.label === 'mobile' })
      await setMode(mode)
      console.log(`[${viewport.label} ${viewport.width}×${viewport.height} · ${mode === 'auth' ? 'signed in as u1' : 'guest'}]`)
      for (const route of routes)
        await visit(route, mode, viewport)
      console.log('')
    }
  }

  if (!only || only.has('reset-lifecycle')) {
    console.log('[theme]')
    const beforeTheme = failures.length
    const themeDetail = await checkTheme(state)
    const themeOk = failures.length === beforeTheme && themeDetail !== undefined
    theme = { ok: themeOk, ...themeDetail }
    if (themeOk)
      console.log(`  ✓ ${'(theme)'.padEnd(34)} ${themeDetail.line}`)
    console.log('')

    console.log('[state lifecycle]')
    const before = failures.length
    const detail = await checkResetLifecycle()
    const ok = failures.length === before && detail !== undefined
    lifecycle = { ok, ...detail }
    if (ok)
      console.log(`  ✓ ${'(reset lifecycle)'.padEnd(34)} ${detail.line}`)
    console.log('')
  }

  // Run-level positive control for the icon sweep. The chevrons exist only in
  // tuffex's own compiled templates — `app/` never writes one — so painting
  // them proves the safelist built from node_modules reached UnoCSS. The
  // i-ri-* classes come from PostEditor's mode switch on /new.
  const iconClasses = [...seenIconClasses].sort()
  const riClasses = iconClasses.filter(token => token.startsWith('i-ri-'))
  const runContext = { mode: 'run', viewport: 'all', url: '(icon namespace)' }
  if (only) {
    console.log(`[smoke] --only run: skipping the run-level icon namespace control (${iconClasses.length} classes seen)`)
  }
  else {
    for (const required of REQUIRED_TUFFEX_ICONS) {
      if (!seenIconClasses.has(required))
        fail(runContext, 'icons', `${required} never appeared; tuffex's own icons are not reaching the page`)
    }
    if (riClasses.length < MIN_RI_CLASSES)
      fail(runContext, 'icons', `only ${riClasses.length} distinct i-ri-* class(es); PostEditor's mode switch on /new is the only source of that namespace`)
    if (iconClasses.length < MIN_DISTINCT_ICONS)
      fail(runContext, 'icons', `only ${iconClasses.length} distinct icon classes over the whole run, expected >= ${MIN_DISTINCT_ICONS}`)
  }

  const passed = results.filter(entry => entry.ok).length
  const icons = results.reduce((sum, entry) => sum + entry.icons.total, 0)
  const summary = {
    base: BASE,
    at: new Date().toISOString(),
    visits: results.length,
    passed,
    failed: results.length - passed,
    iconElementsChecked: icons,
    iconClasses,
    routes: [...new Set(results.map(entry => entry.url))],
  }
  mkdirSync('reports', { recursive: true })
  writeFileSync('reports/smoke.json', JSON.stringify({ summary, theme, lifecycle, failures, results }, null, 2))

  if (failures.length) {
    console.error(`\nsmoke FAILED: ${failures.length} problem(s) over ${results.length} route visit(s)${lifecycle ? ' plus the reset lifecycle' : ''}`)
    for (const failure of failures)
      console.error(`  - ${failure.route} — ${failure.rule} — ${failure.evidence}`)
    process.exitCode = 1
  }
  else {
    console.log(`smoke passed: ${passed}/${results.length} visits over ${summary.routes.length} routes (${VIEWPORTS.length} viewports × 2 sessions), ${icons} icon elements painted across ${iconClasses.length} distinct classes (${riClasses.length} of them i-ri-*), 0 console problems`)
  }
}
catch (error) {
  console.error('\nsmoke CRASHED:', error.message)
  console.error('console so far:', JSON.stringify(chrome.console().slice(-20), null, 2))
  await screenshot('reports/smoke-crash.png').catch(() => {})
  process.exitCode = 1
}
finally {
  await chrome.close()
  if (devServer) {
    try {
      process.kill(-devServer.pid)
    }
    catch {
      // Already gone.
    }
  }
}
