import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { launchChrome, sleep, waitForHttp } from './lib/cdp.mjs'

/**
 * Phase E acceptance for the topic list, categories and tags, driven through
 * CDP against the dev server (port 3456). Reuses a server that is already
 * running; otherwise it starts one and stops it again at the end.
 *
 * Every step records what it observed; the run fails on the first assertion
 * that does not hold.
 */

const BASE = process.env.TUFF_FORUM_URL ?? 'http://localhost:3456'
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))

const steps = []
function record(step, detail) {
  steps.push({ step, ...detail })
  console.log(`✓ ${step}${detail.note ? ` — ${detail.note}` : ''}`)
}
function assert(condition, message) {
  if (!condition)
    throw new Error(`assertion failed: ${message}`)
}

const q = selector => `document.querySelector(${JSON.stringify(selector)})`
const has = selector => `!!${q(selector)}`
const count = selector => `document.querySelectorAll(${JSON.stringify(selector)}).length`
/**
 * Drops nodes that belong to the shell rather than the page: the sidebar (a
 * second copy of which stays mounted inside the mobile drawer) and TxSelect's
 * option panels, which render their whole list into the DOM while closed.
 */
const PAGE_ONLY = `const pageOnly = list => list.filter(el => !el.closest('.tx-bui-sidebar-nav') && !el.closest('.tuff-select__panel'))`

const clickByText = (selector, text) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true })()`

/** Everything the desktop table shows, in one round trip. */
const TABLE = `(() => {
  const rows = [...document.querySelectorAll('.tx-data-table__row')]
  const groups = [...document.querySelectorAll('.tx-avatar-group')]
  return {
    table: !!document.querySelector('.tx-data-table'),
    headers: [...document.querySelectorAll('.tx-data-table__th')].map(e => e.textContent.trim()),
    rowCount: rows.length,
    titles: rows.map(r => r.querySelector('td .font-medium')?.textContent.trim() ?? ''),
    badges: rows.map(r => [...r.querySelectorAll('.tx-status-badge')].map(b => b.textContent.trim())),
    categories: rows.map((r) => {
      const tag = [...r.querySelectorAll('.tx-tag')].find(t => t.querySelector('.tx-tag__dot'))
      return tag ? tag.textContent.trim() : null
    }),
    groupCount: groups.length,
    maxAvatars: groups.length ? Math.max(...groups.map(g => g.querySelectorAll('.tx-avatar-group__item:not(.tx-avatar-group__more)').length)) : 0,
    overflow: groups.some(g => !!g.querySelector('.tx-avatar-group__more')),
    info: document.querySelector('.tx-pagination__info')?.textContent.replace(/\\s+/g, ' ').trim() ?? null,
    search: location.search,
  }
})()`

/** One row of the table, reduced to what the sort assertions compare. */
const ROWS_EXPR = `[...document.querySelectorAll('.tx-data-table__row')].map(r => ({
  title: r.querySelector('td .font-medium')?.textContent.trim() ?? '',
  pinned: [...r.querySelectorAll('.tx-status-badge')].some(b => b.textContent.trim() === '已置顶'),
  replies: Number(r.querySelectorAll('td')[2].textContent.trim()),
  views: Number(r.querySelectorAll('td')[3].textContent.trim()),
}))`
const ROWS = `(() => ${ROWS_EXPR})()`

/** Clicks a sortable column header (a real button inside the `th`). */
const clickSort = label => `(() => {
  const el = [...document.querySelectorAll('.tx-data-table__sort-button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(label)}))
  if (!el) return false
  el.click()
  return true
})()`

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
  console.log('[verify-topics] no dev server on 3456; starting one')
  devServer = spawn('pnpm', ['dev'], { cwd: PROJECT_ROOT, stdio: 'ignore', detached: true })
  await waitForHttp(`${BASE}/`)
}
else {
  console.log('[verify-topics] reusing the dev server already on 3456')
}

const chrome = await launchChrome({ watchdogMs: 240_000 })
const { evaluate, waitFor, open, emulate, screenshot, problems } = chrome

function assertClean(page) {
  const found = problems()
  assert(found.length === 0, `${page}: console problems ${JSON.stringify(found, null, 2)}`)
}

/** `waitFor`, but tolerant of the execution context being swapped mid-navigation. */
async function pollFor(expression, { timeoutMs = 8000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const value = await evaluate(expression)
      if (value)
        return value
    }
    catch {
      // Context destroyed by the navigation we are racing; try again.
    }
    if (Date.now() > deadline)
      return null
    await sleep(intervalMs)
  }
}

try {
  // ------------------------------------------------------- cold-load skeleton
  // Done first, before any warm cache, and polled hard: the skeleton is up for
  // roughly `minDuration` (400 ms) and nothing else is waited on.
  await emulate({ width: 1280, height: 800 })
  await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await open(`${BASE}/`)
  await evaluate(`localStorage.clear()`)
  await chrome.send('Page.navigate', { url: `${BASE}/` })
  const skeleton = await pollFor(`(() => {
    const el = document.querySelector('.tx-row-skeleton')
    if (!el) return null
    return { rows: el.querySelectorAll('.tx-row-skeleton__row').length, hidden: el.getAttribute('aria-hidden'), table: !!document.querySelector('.tx-data-table') }
  })()`)
  assert(skeleton !== null, 'no .tx-row-skeleton was observable during a cold / load')
  assert(skeleton.rows === 20, `skeleton row count ${skeleton.rows}`)
  assert(skeleton.hidden === 'true', 'skeleton must be aria-hidden')
  assert(!skeleton.table, 'skeleton and table must not be on screen together')
  await waitFor(has('.tx-data-table'))
  record('cold / load shows the list skeleton first', { note: `${skeleton.rows} skeleton rows (= one page), aria-hidden, no table yet; table follows` })

  // Same affordance on the routes that reuse the list. The skeleton lives in
  // TopicList, so a page that forgot to ask for one cannot exist — but a page
  // that stops rendering the list at all would show up right here.
  const SKELETON_PROBE = `(() => {
    const el = document.querySelector('.tx-row-skeleton')
    if (!el) return null
    return { rows: el.querySelectorAll('.tx-row-skeleton__row').length, table: !!document.querySelector('.tx-data-table') }
  })()`
  const reused = {}
  for (const path of ['/c/announcements', '/tag/vue']) {
    await chrome.send('Page.navigate', { url: `${BASE}${path}` })
    const observed = await pollFor(SKELETON_PROBE)
    assert(observed !== null, `no .tx-row-skeleton was observable during a cold ${path} load`)
    assert(observed.rows === 20, `${path} skeleton row count ${observed.rows}`)
    assert(!observed.table, `${path} showed the skeleton and the table together`)
    await waitFor(has('.tx-data-table'))
    reused[path] = observed.rows
  }
  record('the routes that reuse the list show the same skeleton', { note: Object.entries(reused).map(([path, rows]) => `${path} ${rows} rows`).join(', ') })

  // ------------------------------------------------------------ desktop table
  await open(`${BASE}/`)
  await waitFor(has('.tx-data-table__row'))
  const latest = await evaluate(TABLE)
  assert(latest.headers.join(',') === '话题,发帖者,回复,浏览,活动', `headers ${latest.headers}`)
  assert(latest.rowCount === 20, `row count ${latest.rowCount}`)
  assert(latest.badges[0].includes('已置顶') && latest.badges[1].includes('已置顶'), `pinned badges ${JSON.stringify(latest.badges.slice(0, 3))}`)
  assert(latest.badges.slice(2).every(badges => !badges.includes('已置顶')), 'only the first two rows are pinned')
  assert(latest.groupCount === 20, `avatar groups ${latest.groupCount}`)
  assert(latest.maxAvatars <= 5, `avatar group holds ${latest.maxAvatars} > max 5`)
  assert(latest.overflow, 'no avatar group rendered a +N overflow avatar')
  assert(latest.info === '第 1–20 个，共 48 个话题', `pagination info "${latest.info}"`)
  assertClean('/')
  record('desktop / renders the Discourse table', {
    note: `headers ${latest.headers.join('/')}, 20 rows, rows 1-2 已置顶, ${latest.groupCount} avatar groups (max ${latest.maxAvatars} + overflow), info "${latest.info}"`,
  })
  await screenshot('reports/topics-desktop-light.png')

  // ------------------------------------------------------------------- modes
  const byMode = { latest: latest.titles }
  for (const [label, mode] of [['新', 'new'], ['热门', 'top']]) {
    assert(await evaluate(clickByText('.tx-bui-filter-chips__chip', label)), `mode chip ${label}`)
    await waitFor(`location.search.includes('mode=${mode}')`)
    await sleep(200)
    const view = await evaluate(TABLE)
    assert(view.search === `?mode=${mode}`, `query after ${label}: ${view.search}`)
    assert(view.badges[0].includes('已置顶') && view.badges[1].includes('已置顶'), `${mode}: pinned topics left the top`)
    assert(view.rowCount === 20, `${mode} row count ${view.rowCount}`)
    byMode[mode] = view.titles
    assertClean(`/?mode=${mode}`)
  }
  // Pinned topics head every mode, so the mode change shows up below them.
  const firstUnpinned = new Set([byMode.latest[2], byMode.new[2], byMode.top[2]])
  assert(firstUnpinned.size >= 2, `the three modes produced the same first unpinned row: ${[...firstUnpinned]}`)
  record('mode chips re-sort the list', {
    note: `?mode=new / ?mode=top in the URL; pinned stay rows 1-2 in all three; first unpinned row: 最新 "${byMode.latest[2]}" · 新 "${byMode.new[2]}" · 热门 "${byMode.top[2]}"`,
  })

  // --------------------------------------------------------- category filter
  await open(`${BASE}/`)
  await waitFor(has('.tx-data-table__row'))
  assert(await evaluate(`(() => { const t = document.querySelectorAll('.tuff-select__trigger')[0]; if (!t) return false; t.click(); return true })()`), 'category select trigger')
  await waitFor(has('.tuff-select__panel'))
  assert(await evaluate(clickByText('.tuff-select__panel .tx-card-item__title', '公告')), 'category option 公告')
  await waitFor(`location.search.includes('category=')`)
  await sleep(250)
  const filtered = await evaluate(TABLE)
  assert(filtered.search === '?category=announcements', `query ${filtered.search}`)
  assert(filtered.rowCount > 0 && filtered.categories.every(name => name === '公告'), `categories on screen ${JSON.stringify([...new Set(filtered.categories)])}`)
  assertClean('/?category=announcements')

  assert(await evaluate(`(() => { const t = document.querySelectorAll('.tuff-select__trigger')[0]; t.click(); return true })()`), 'reopen category select')
  await waitFor(has('.tuff-select__panel'))
  assert(await evaluate(clickByText('.tuff-select__panel .tx-card-item__title', '全部类别')), 'category option 全部类别')
  await waitFor(`location.search === ''`)
  await sleep(250)
  const cleared = await evaluate(TABLE)
  assert(cleared.info === '第 1–20 个，共 48 个话题', `info after clearing "${cleared.info}"`)
  record('category dropdown filters and clears', {
    note: `?category=announcements → ${filtered.rowCount} rows, all 公告; 全部类别 → "${cleared.info}"`,
  })

  // ------------------------------------------------------------- pagination
  assert(await evaluate(clickByText('.tx-pagination__button', '2')), 'pagination button 2')
  await waitFor(`location.search.includes('page=2')`)
  await sleep(250)
  const page2 = await evaluate(TABLE)
  assert(page2.search === '?page=2', `query ${page2.search}`)
  assert(page2.info === '第 21–40 个，共 48 个话题', `page 2 info "${page2.info}"`)
  assert(page2.titles[0] !== cleared.titles[0], 'page 2 repeats page 1')
  assert(page2.titles.every(title => !cleared.titles.includes(title)), 'page 2 overlaps page 1')
  assertClean('/?page=2')
  record('pagination pages through the list', { note: `?page=2, info "${page2.info}", 20 fresh titles` })

  // --------------------------------------------------- global column sorting
  // The table only ever holds one page, so `sortOnClient` would order twenty
  // rows and call it sorted. These assertions are about the whole list: the
  // global maximum has to come to the top, and page 2 has to stay below page 1.
  const everyRow = []
  for (const pageNumber of [1, 2, 3]) {
    await open(`${BASE}/${pageNumber > 1 ? `?page=${pageNumber}` : ''}`)
    await waitFor(has('.tx-data-table__row'))
    everyRow.push(...await evaluate(ROWS))
  }
  assert(everyRow.length === 48, `read ${everyRow.length} rows across the three pages, expected 48`)
  const globalMax = Math.max(...everyRow.filter(row => !row.pinned).map(row => row.replies))
  const onFirstPageBefore = everyRow.slice(0, 20).filter(row => !row.pinned).map(row => row.replies)
  assert(Math.max(...onFirstPageBefore) < globalMax || everyRow.slice(20).every(row => row.replies <= Math.max(...onFirstPageBefore)), 'sanity: reply counts could not be compared')

  await open(`${BASE}/`)
  await waitFor(has('.tx-data-table__row'))
  assert(await evaluate(clickSort('回复')), 'no 回复 sort button')
  await waitFor(`location.search.includes('sort=replies')`)
  assert(await evaluate(clickSort('回复')), 'the 回复 header stopped responding on the second click')
  await waitFor(`location.search.includes('dir=desc')`)
  await sleep(250)
  const sorted = await evaluate(`(() => ({ rows: ${ROWS_EXPR}, search: location.search, ariaSort: [...document.querySelectorAll('.tx-data-table__th')].map(th => th.getAttribute('aria-sort')) }))()`)
  assert(sorted.search === '?sort=replies&dir=desc', `query after two clicks: ${sorted.search}`)
  assert(sorted.rows[0].pinned && sorted.rows[1].pinned, 'sorting pushed the pinned topics out of the top')
  const topUnpinned = sorted.rows.find(row => !row.pinned)
  assert(topUnpinned.replies === globalMax, `first unpinned row has ${topUnpinned.replies} replies, but ${globalMax} is the maximum across all 48 topics`)

  await open(`${BASE}/?sort=replies&dir=desc&page=2`)
  await waitFor(has('.tx-data-table__row'))
  const sortedPage2 = await evaluate(ROWS)
  const minOnPage1 = Math.min(...sorted.rows.filter(row => !row.pinned).map(row => row.replies))
  const maxOnPage2 = Math.max(...sortedPage2.map(row => row.replies))
  assert(maxOnPage2 <= minOnPage1, `page 2 holds a topic with ${maxOnPage2} replies while page 1 ends at ${minOnPage1} — the sort is page-local`)

  // Round-trip: the same URL, loaded cold, shows the same order and says so.
  await open(`${BASE}/?sort=replies&dir=desc`)
  await waitFor(has('.tx-data-table__row'))
  const reloaded = await evaluate(`(() => ({ rows: ${ROWS_EXPR}, ariaSort: [...document.querySelectorAll('.tx-data-table__th')].map(th => th.getAttribute('aria-sort')) }))()`)
  assert(reloaded.ariaSort[2] === 'descending', `回复 column reports aria-sort="${reloaded.ariaSort[2]}" after a reload`)
  assert(reloaded.rows.find(row => !row.pinned).replies === globalMax, 'the reloaded order differs from the clicked one')

  assert(await evaluate(clickSort('回复')), 'the 回复 header stopped responding on the third click')
  await waitFor(`location.search === ''`)
  await sleep(200)
  const clearedSort = await evaluate(`(() => [...document.querySelectorAll('.tx-data-table__th')].map(th => th.getAttribute('aria-sort')))()`)
  assert(clearedSort.every(order => order === null || order === 'none'), `the third click left aria-sort ${JSON.stringify(clearedSort)}`)
  assertClean('sorted /')
  record('column sorting orders every topic, not just the page', {
    note: `?sort=replies&dir=desc: pinned stay on top, first unpinned row has ${globalMax} replies (the maximum over all 48), page 2 peaks at ${maxOnPage2} ≤ page 1's ${minOnPage1}, the URL round-trips with aria-sort="descending", a third click clears it`,
  })

  // ----------------------------------------------------------- row → topic
  await open(`${BASE}/`)
  await waitFor(has('.tx-data-table__row'))
  await evaluate(`document.querySelector('.tx-data-table__row').click()`)
  await waitFor(`/^\\/t\\/t\\d+$/.test(location.pathname)`)
  const topicPath = await evaluate('location.pathname')
  // `/t/[id]` arrives in Phase F; today the catch-all answers, which is still a
  // clean in-app 404 (Phase D covers that path).
  assertClean('row click')
  record('a row click opens its topic', { note: `first row → ${topicPath} (page itself lands in Phase F)` })

  // ------------------------------------------------------------ narrow list
  await emulate({ width: 390, height: 844, mobile: true })
  await open(`${BASE}/`)
  await waitFor(`!${has('.tx-data-table')} && ${count('.tx-card-item')} > 0`)
  await sleep(300)
  const narrow = await evaluate(`(() => {
    ${PAGE_ONLY}
    const rows = pageOnly([...document.querySelectorAll('.tx-card-item')])
    const icons = pageOnly([...document.querySelectorAll('.i-carbon-chat, .i-carbon-view')])
    return {
      table: !!document.querySelector('.tx-data-table'),
      rows: rows.length,
      first: rows[0]?.querySelector('.tx-card-item__title')?.textContent.replace(/\\s+/g, ' ').trim() ?? null,
      clippedTitles: rows.filter((r) => {
        const title = r.querySelector('.tx-card-item__title')
        return title && title.scrollWidth > title.clientWidth + 1
      }).length,
      icons: icons.length,
      paintedIcons: icons.filter((el) => {
        const s = getComputedStyle(el)
        return (s.maskImage && s.maskImage !== 'none') || (s.backgroundImage && s.backgroundImage !== 'none')
      }).length,
      dividers: document.querySelectorAll('.tx-divider').length,
    }
  })()`)
  assert(!narrow.table, 'the table must not render at 390px')
  assert(narrow.rows === 20, `narrow row count ${narrow.rows}`)
  assert(narrow.first?.includes('已置顶'), `first narrow row ${narrow.first}`)
  // TxCardItem's title is nowrap + overflow:hidden; without the wrap override
  // every title is cut off mid-word at this width.
  assert(narrow.clippedTitles === 0, `${narrow.clippedTitles} narrow titles are clipped by the card-item title box`)
  assert(narrow.icons >= 40 && narrow.icons === narrow.paintedIcons, `TopicStats icons ${narrow.paintedIcons}/${narrow.icons} painted`)
  assertClean('/ @390')
  record('390px falls back to card rows', {
    note: `no table, ${narrow.rows} card rows, no clipped titles, ${narrow.paintedIcons}/${narrow.icons} TopicStats icons have a real mask/background`,
  })
  await screenshot('reports/topics-mobile.png')

  // ------------------------------------------------------------- /categories
  await emulate({ width: 1280, height: 800 })
  await open(`${BASE}/categories`)
  await waitFor(has('.tx-card-item'))
  const categories = await evaluate(`(() => {
    ${PAGE_ONLY}
    const rows = pageOnly([...document.querySelectorAll('.tx-card-item')])
    const left = rows.filter(el => !!el.querySelector('.tx-badge--dot'))
    return {
      total: rows.length,
      withDot: left.length,
      withCount: left.filter(el => !!el.querySelector('.tx-card-item__right .tx-badge')).length,
      names: left.map(el => el.querySelector('.tx-card-item__title')?.textContent.trim()),
      recentLinks: document.querySelectorAll('.tx-bui-cell-link').length,
      latestHeading: [...document.querySelectorAll('h2')].some(e => e.textContent.trim() === '最新'),
    }
  })()`)
  assert(categories.withDot === 8, `category rows ${categories.withDot}`)
  assert(categories.withCount === 8, `category rows with a count badge ${categories.withCount}`)
  assert(categories.recentLinks === 16, `recent-topic links ${categories.recentLinks} (expected 8 × 2)`)
  assert(categories.latestHeading, 'desktop /categories is missing the 最新 column')
  assert(categories.total === 8 + 10, `card items ${categories.total} (expected 8 categories + 10 latest)`)
  assertClean('/categories')
  record('/categories lists both columns', {
    note: `${categories.withDot} categories with a colour dot and a count badge, ${categories.recentLinks} recent-topic links, 最新 column with 10 items`,
  })
  await screenshot('reports/topics-categories.png')

  assert(await evaluate(clickByText('.tx-card-item__title', '公告')), 'category row 公告')
  await waitFor(`location.pathname === '/c/announcements'`)
  record('a category row opens its category', { note: '/categories → /c/announcements' })

  await emulate({ width: 390, height: 844, mobile: true })
  await open(`${BASE}/categories`)
  await waitFor(has('.tx-card-item'))
  const narrowCategories = await evaluate(`({ latestHeading: [...document.querySelectorAll('h2')].some(e => e.textContent.trim() === '最新') })`)
  assert(!narrowCategories.latestHeading, '/categories still renders the 最新 column at 390px')
  assertClean('/categories @390')
  record('/categories drops its second column at 390px', { note: 'no 最新 heading below 1024px' })

  // --------------------------------------------------------------- /c/[slug]
  await emulate({ width: 1280, height: 800 })
  await open(`${BASE}/c/announcements`)
  await waitFor(has('.tx-data-table__row'))
  const category = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.tx-data-table__row')]
    return {
      banner: document.querySelector('.tx-card .tx-card-item__title')?.textContent.trim() ?? null,
      stats: [...document.querySelectorAll('.tx-stat-card')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()),
      crumbs: [...document.querySelectorAll('.tx-breadcrumb__item')].map(e => e.textContent.trim()),
      anchors: document.querySelectorAll('.tx-breadcrumb a[href]').length,
      selects: document.querySelectorAll('.tuff-select__trigger').length,
      categories: [...new Set(rows.map((r) => {
        const tag = [...r.querySelectorAll('.tx-tag')].find(t => t.querySelector('.tx-tag__dot'))
        return tag ? tag.textContent.trim() : null
      }))],
      search: location.search,
    }
  })()`)
  assert(category.banner === '公告', `banner "${category.banner}"`)
  assert(category.stats.length === 2, `stat cards ${JSON.stringify(category.stats)}`)
  assert(category.categories.length === 1 && category.categories[0] === '公告', `rows carry ${JSON.stringify(category.categories)}`)
  assert(category.selects === 1, `the pinned category dropdown is still rendered (${category.selects} selects, expected only 标签)`)
  assert(category.anchors === 0, 'breadcrumb rendered an <a href>, which would reload the SPA')
  assert(category.search === '', `pinned category leaked into the query: ${category.search}`)
  assertClean('/c/announcements')
  record('/c/[slug] pins its category', {
    note: `banner 公告, stats ${category.stats.join(' | ')}, every row 公告, category dropdown hidden, query stays empty, breadcrumb has no <a href>`,
  })

  // The click handler sits on the inner control, not the <li>.
  assert(await evaluate(clickByText('.tx-breadcrumb__link', '话题')), 'breadcrumb 话题')
  await waitFor(`location.pathname === '/' && ${has('.tx-data-table')}`)
  record('the breadcrumb returns to the list', { note: '/c/announcements → /' })

  await open(`${BASE}/c/does-not-exist`)
  await waitFor(has('.tx-empty-state'))
  await sleep(300)
  const missing = await evaluate(`({
    heading: document.querySelector('.tx-empty-state')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
    table: ${has('.tx-data-table')},
  })`)
  assert(missing.heading.includes('哎呀，这个页面不存在') && missing.heading.includes('类别不存在'), `404 body "${missing.heading}"`)
  assert(!missing.table, 'the unknown category still rendered a list')
  assertClean('/c/does-not-exist')
  record('an unknown category is a 404', { note: `"${missing.heading}", console clean` })

  // ------------------------------------------------------------------ /tags
  await open(`${BASE}/tags`)
  await waitFor(has('.tx-tag'))
  const tags = await evaluate(`(() => {
    ${PAGE_ONLY}
    const chips = pageOnly([...document.querySelectorAll('.tx-tag')])
    return {
      chips: chips.length,
      withCount: chips.filter(el => !!el.querySelector('.tx-tag__count')).length,
      buttons: chips.filter(el => el.getAttribute('role') === 'button' && el.getAttribute('tabindex') === '0').length,
      first: chips[0]?.textContent.replace(/\\s+/g, ' ').trim() ?? null,
      counts: chips.map(el => Number(el.querySelector('.tx-tag__count')?.textContent ?? '0')),
    }
  })()`)
  assert(tags.chips >= 16, `tag chips ${tags.chips}`)
  assert(tags.withCount === tags.chips, `${tags.chips - tags.withCount} chips are missing their count`)
  assert(tags.buttons === tags.chips, `${tags.chips - tags.buttons} chips are not keyboard-reachable buttons`)
  assert(tags.counts.every((value, index) => index === 0 || tags.counts[index - 1] >= value), `counts are not descending: ${tags.counts}`)
  assertClean('/tags')
  record('/tags is a sorted tag cloud', { note: `${tags.chips} chips, all with counts and role=button, busiest first ("${tags.first}")` })
  await screenshot('reports/topics-tags.png')

  const firstTag = await evaluate(`(() => {
    ${PAGE_ONLY}
    const chip = pageOnly([...document.querySelectorAll('.tx-tag')])[0]
    const label = chip.querySelector('.tx-tag__content')?.textContent.trim()
    chip.click()
    return label
  })()`)
  await waitFor(`location.pathname.startsWith('/tag/') && ${has('.tx-data-table__row')}`)
  const tagPage = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.tx-data-table__row')]
    return {
      path: location.pathname,
      heading: document.querySelector('.tx-card .tx-card-item__title')?.textContent.trim() ?? null,
      rows: rows.length,
      tagsPerRow: rows.map(r => [...r.querySelectorAll('.tx-tag')].map(t => t.textContent.trim())),
      selects: document.querySelectorAll('.tuff-select__trigger').length,
      search: location.search,
    }
  })()`)
  assert(tagPage.heading === `#${firstTag}`, `tag banner "${tagPage.heading}" for "${firstTag}"`)
  assert(tagPage.rows > 0 && tagPage.tagsPerRow.every(list => list.includes(firstTag)), `some rows are missing the #${firstTag} tag`)
  assert(tagPage.selects === 1, `the pinned tag dropdown is still rendered (${tagPage.selects} selects, expected only 类别)`)
  assert(tagPage.search === '', `pinned tag leaked into the query: ${tagPage.search}`)
  assertClean(tagPage.path)
  record('a tag chip opens its tag list', {
    note: `${tagPage.path}, banner "${tagPage.heading}", ${tagPage.rows} rows all carrying #${firstTag}, tag dropdown hidden`,
  })

  // ------------------------------------------------------------------- dark
  await open(`${BASE}/`)
  await waitFor(has('.tx-data-table__row'))
  await evaluate(`(() => { const b = [...document.querySelectorAll('header button')].find(e => e.querySelector('.i-carbon-moon, .i-carbon-sun')); b.click(); return true })()`)
  await waitFor(`document.documentElement.classList.contains('dark')`)
  await sleep(400)
  assertClean('/ dark')
  record('the table follows the dark theme', { note: 'html.dark with the table still rendered' })
  await screenshot('reports/topics-desktop-dark.png')

  mkdirSync('reports', { recursive: true })
  writeFileSync('reports/topics-verify.json', JSON.stringify({ base: BASE, at: new Date().toISOString(), steps }, null, 2))
  console.log(`\nall ${steps.length} steps passed`)
}
catch (error) {
  console.error('\nFAILED:', error.message)
  console.error('console so far:', JSON.stringify(chrome.console().slice(-20), null, 2))
  await screenshot('reports/topics-failure.png').catch(() => {})
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
