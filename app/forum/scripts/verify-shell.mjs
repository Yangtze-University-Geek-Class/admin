import { mkdirSync, writeFileSync } from 'node:fs'
import { launchChrome, waitForHttp } from './lib/cdp.mjs'

/**
 * Phase D acceptance for the app shell, driven through CDP against a running
 * dev server (`pnpm dev`, port 3456). Every step records what it observed;
 * the run fails on the first assertion that does not hold.
 */

const BASE = process.env.TUFF_FORUM_URL ?? 'http://localhost:3456'
// The desktop column. The mobile drawer keeps its own copy mounted (inert)
// while closed, so a bare `.tx-bui-sidebar-nav` would match both.
const SIDEBAR = '.tx-row .tx-bui-sidebar-nav'

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
const clickByLabel = label => `(() => { const el = document.querySelector('[aria-label=${JSON.stringify(label)}]'); if (!el) return false; el.click(); return true })()`
const clickByText = (selector, text) => `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true })()`

await waitForHttp(`${BASE}/`)
const chrome = await launchChrome({ watchdogMs: 120_000 })
const { evaluate, waitFor, open, reload, emulate, screenshot, key, type, problems, sleep } = chrome

function assertClean(page) {
  const found = problems()
  assert(found.length === 0, `${page}: console problems ${JSON.stringify(found, null, 2)}`)
}

try {
  // ------------------------------------------------------------ desktop shell
  await emulate({ width: 1280, height: 800 })
  // colorMode preference is `system`; pin the OS hint so the run is deterministic.
  await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await open(`${BASE}/`)
  await waitFor(has(SIDEBAR))
  await evaluate(`localStorage.removeItem('tuff-forum:color-mode'); localStorage.removeItem('tuff-forum:sidebar'); localStorage.removeItem('tuff-forum:session:v1'); localStorage.removeItem('tuff-forum:state:v1')`)
  await reload()
  await waitFor(has(SIDEBAR))
  await sleep(300)

  const header = await evaluate(`({
    siteName: document.body.innerText.includes('Tuff Forum'),
    notification: ${has('header .i-carbon-notification')},
    themeIcon: ${has('header .i-carbon-moon')} || ${has('header .i-carbon-sun')},
    menu: ${has('header .i-carbon-menu')},
    search: ${has('header .tx-search-input__icon')},
    logo: ${has('header .tx-tuff-logo-stroke')},
    groups: [...document.querySelectorAll('.tx-bui-sidebar-nav__group-label')].map(e => e.textContent.trim()),
    items: ${count('.tx-bui-sidebar-nav__row')},
    dots: ${count('.tx-bui-sidebar-nav__icon .tx-badge--dot')},
    badge: document.querySelector('.tx-bui-sidebar-nav__badge')?.textContent.trim() ?? null,
    dark: document.documentElement.classList.contains('dark'),
  })`)
  assert(header.siteName && header.notification && header.themeIcon && header.menu && header.search && header.logo, `header markers ${JSON.stringify(header)}`)
  assert(header.groups.join(',') === '社区,类别,标签,我的', `sidebar groups ${header.groups}`)
  assert(header.items === 4 + 9 + 9 + 2, `sidebar item count ${header.items}`)
  assert(header.dots === 8, `category dots ${header.dots}`)
  assert(!header.dark, 'starts light under an emulated light OS scheme')
  assertClean('/')
  record('desktop / renders shell', { note: `${header.items} nav rows, groups ${header.groups.join('/')}, 8 category dots, unread badge ${header.badge}` })
  await screenshot('reports/shell-light-desktop.png')

  // ------------------------------------------------------------ icons resolve
  const icons = await evaluate(`[...document.querySelectorAll('[class*="i-carbon-"], [class*="i-ri-"]')].map(el => {
    const cls = [...el.classList].find(c => c.startsWith('i-carbon-') || c.startsWith('i-ri-'))
    const s = getComputedStyle(el)
    return { cls, ok: (s.maskImage !== 'none' && s.maskImage !== '') || (s.backgroundImage !== 'none' && s.backgroundImage !== '') }
  })`)
  const badIcons = icons.filter(icon => !icon.ok)
  assert(icons.length > 0 && badIcons.length === 0, `icon visibility ${JSON.stringify(badIcons)}`)
  record('icons have mask/background', { note: `${icons.length} icon elements, all resolved: ${[...new Set(icons.map(i => i.cls))].join(' ')}` })

  // ------------------------------------------------------------ dark mode
  assert(await evaluate(clickByLabel('切换主题')), 'theme button')
  await waitFor(`document.documentElement.classList.contains('dark')`)
  const stored = await evaluate(`localStorage.getItem('tuff-forum:color-mode')`)
  assert(stored === 'dark', `color-mode storage = ${stored}`)
  await reload()
  await waitFor(has(SIDEBAR))
  assert(await evaluate(`document.documentElement.classList.contains('dark')`), 'dark survives reload')
  const darkBg = await evaluate(`getComputedStyle(document.body).backgroundColor`)
  await sleep(300)
  await screenshot('reports/shell-dark-desktop.png')
  record('dark mode toggles and persists', { note: `html.dark after reload, body bg ${darkBg}` })
  assert(await evaluate(clickByLabel('切换主题')), 'theme button back')
  await waitFor(`!document.documentElement.classList.contains('dark')`)

  // ------------------------------------------------------------ sidebar collapse
  assert(await evaluate(clickByLabel('切换侧栏')), 'sidebar toggle')
  await waitFor(`!${has(SIDEBAR)}`)
  assert((await evaluate(`localStorage.getItem('tuff-forum:sidebar')`)) === 'false', 'sidebar pref stored')
  await reload()
  await waitFor(has('header'))
  await sleep(300)
  assert(!(await evaluate(has(SIDEBAR))), 'sidebar stays collapsed after reload')
  assert(await evaluate(clickByLabel('切换侧栏')), 'sidebar toggle back')
  await waitFor(has(SIDEBAR))
  assertClean('/ after sidebar toggle')
  record('desktop sidebar collapse persists', { note: 'gone after click, gone after reload, back after second click' })

  // ------------------------------------------------------------ mobile drawer
  await emulate({ width: 390, height: 844, mobile: true })
  await sleep(300)
  assert(!(await evaluate(has(SIDEBAR))), 'mobile: no inline sidebar')
  assert(await evaluate(has('header .i-carbon-search')), 'mobile: search icon button')
  const closedDrawer = await evaluate(`(() => { const d = document.querySelector('.tx-drawer'); return d && { visible: d.classList.contains('tx-drawer--visible'), inert: d.hasAttribute('inert'), hidden: d.getAttribute('aria-hidden') } })()`)
  assert(closedDrawer && !closedDrawer.visible && closedDrawer.inert && closedDrawer.hidden === 'true', `closed drawer ${JSON.stringify(closedDrawer)}`)
  assert(await evaluate(clickByLabel('切换侧栏')), 'mobile toggle')
  await waitFor(has('.tx-drawer--visible .tx-bui-sidebar-nav'))
  const drawer = await evaluate(`({ left: ${has('.tx-drawer--left.tx-drawer--visible')}, title: document.querySelector('.tx-drawer__title')?.textContent.trim() })`)
  assert(drawer.left && drawer.title === '导航', `drawer ${JSON.stringify(drawer)}`)
  await sleep(500)
  await screenshot('reports/shell-mobile-drawer.png')
  // Picking an item closes the drawer.
  assert(await evaluate(clickByText('.tx-drawer--visible .tx-bui-sidebar-nav__row', '关于')), 'drawer item 关于')
  await waitFor(`!${has('.tx-drawer--visible')} && location.pathname === '/about'`)
  assertClean('mobile drawer')
  record('mobile drawer hosts the sidebar', { note: 'no inline column; closed drawer is inert + aria-hidden; left drawer titled 导航 opens with the nav, closes on navigate to /about' })

  // ------------------------------------------------------------ session
  await emulate({ width: 1280, height: 800 })
  await open(`${BASE}/`)
  await waitFor(has(SIDEBAR))
  assert(await evaluate(clickByLabel('用户菜单')), 'user menu trigger')
  await waitFor(has('.tx-dropdown__panel'))
  const menuItems = await evaluate(`[...document.querySelectorAll('.tx-dropdown__panel .tx-dropdown-item')].map(e => e.textContent.trim())`)
  assert(menuItems.join(',') === '我的主页,我的帖子,书签,偏好设置,切换用户,退出登录', `menu items ${menuItems}`)
  assert(await evaluate(clickByText('.tx-dropdown__panel .tx-dropdown-item', '退出登录')), 'logout item')
  await waitFor(`[...document.querySelectorAll('header button')].some(b => b.textContent.trim() === '登录')`)
  // Persistence is debounced (150 ms); wait for the write rather than racing it.
  await waitFor(`localStorage.getItem('tuff-forum:session:v1') === '{"currentUserId":null}'`)
  const guest = await evaluate(`({
    avatar: ${has('header .tx-avatar')},
    groups: [...document.querySelectorAll('.tx-bui-sidebar-nav__group-label')].map(e => e.textContent.trim()),
    session: localStorage.getItem('tuff-forum:session:v1'),
    footerLogin: [...document.querySelectorAll('.tx-bui-sidebar-nav button')].some(b => b.textContent.trim() === '登录'),
  })`)
  await sleep(200)
  assert(!guest.avatar && guest.groups.join(',') === '社区,类别,标签' && guest.footerLogin, `guest state ${JSON.stringify(guest)}`)
  assert(guest.session === '{"currentUserId":null}', `session storage ${guest.session}`)
  record('logout → guest shell', { note: `header shows 登录, sidebar groups ${guest.groups.join('/')}, session ${guest.session}` })

  assert(await evaluate(clickByText('header button', '登录')), 'header login button')
  await waitFor(has('.tx-modal__overlay .tx-card-item'))
  const modal = await evaluate(`({
    title: document.querySelector('.tx-modal__title')?.textContent.trim(),
    users: ${count('.tx-modal__overlay .tx-card-item')},
    badges: [...document.querySelectorAll('.tx-modal__overlay .tx-status-badge')].map(e => e.textContent.trim()),
  })`)
  assert(modal.title === '选择一个身份登录' && modal.users === 12, `login modal ${JSON.stringify(modal)}`)
  assert(await evaluate(clickByText('.tx-modal__overlay .tx-card-item .tx-card-item__title', 'Mika')), 'pick Mika')
  await waitFor(`!${has('.tx-modal__overlay')} && ${has('header .tx-avatar')}`)
  await waitFor(`localStorage.getItem('tuff-forum:session:v1') === '{"currentUserId":"u2"}'`)
  const loggedIn = await evaluate(`({
    session: localStorage.getItem('tuff-forum:session:v1'),
    footer: document.querySelector('.tx-bui-sidebar-nav .tx-card-item__subtitle')?.textContent.trim(),
    groups: [...document.querySelectorAll('.tx-bui-sidebar-nav__group-label')].map(e => e.textContent.trim()),
    toast: document.body.innerText.includes('已切换为 Mika'),
  })`)
  assert(loggedIn.session === '{"currentUserId":"u2"}', `session ${loggedIn.session}`)
  assert(loggedIn.footer === '@mika · 版主' && loggedIn.groups.length === 4 && loggedIn.toast, `logged in ${JSON.stringify(loggedIn)}`)
  assertClean('session switch')
  record('login modal → Mika', { note: `12 users listed (badges ${modal.badges.join('/')}), session ${loggedIn.session}, footer ${loggedIn.footer}, toast shown` })

  // ------------------------------------------------------------ command palette
  await key('k', { modifiers: 4 })
  await waitFor(has('.tx-command-palette__panel'))
  await type('mika')
  await waitFor(`[...document.querySelectorAll('.tx-command-palette__item')].some(e => e.textContent.includes('@mika'))`)
  const palette = await evaluate(`[...document.querySelectorAll('.tx-command-palette__item')].map(e => e.textContent.trim().replace(/\\s+/g, ' '))`)
  await key('Escape', { code: 'Escape', keyCode: 27 })
  await waitFor(`!${has('.tx-command-palette__panel')}`)
  assertClean('command palette')
  record('⌘K palette finds a user', { note: `results for "mika": ${palette.join(' | ')}` })

  // ------------------------------------------------------------ about + error
  await open(`${BASE}/about`)
  await waitFor(has('.tx-stat-card'))
  const about = await evaluate(`({ title: document.title, stats: ${count('.tx-stat-card')}, staff: ${count('.tx-card-item')}, sidebar: ${has(SIDEBAR)} })`)
  assert(about.title === '关于 · Tuff Forum' && about.stats === 3 && about.staff >= 3 && about.sidebar, `about ${JSON.stringify(about)}`)
  assertClean('/about')
  record('/about', { note: `title "${about.title}", 3 stat cards, ${about.staff} card items (2 staff + sidebar footer)` })

  await open(`${BASE}/this-does-not-exist`)
  await waitFor(has('.tx-empty-state'))
  const errorPage = await evaluate(`({
    title: document.title,
    heading: document.querySelector('.tx-empty-state')?.textContent.replace(/\\s+/g, ' ').trim(),
    button: [...document.querySelectorAll('.tx-empty-state button')].map(b => b.textContent.trim()),
    sidebar: ${has(SIDEBAR)},
    header: ${has('header .tx-tuff-logo-stroke')},
  })`)
  assert(errorPage.heading.includes('哎呀，这个页面不存在') && errorPage.button.includes('返回首页') && errorPage.sidebar && errorPage.header, `error page ${JSON.stringify(errorPage)}`)
  // `pages/[...slug].vue` turns an unmatched URL into a normal page-level 404,
  // so even a cold load must not produce vue-router's "no match" warning or
  // Nuxt's init-time `NUXT_E1005` diagnostic (both appear without the catch-all).
  assertClean('cold-load 404')
  assert(await evaluate(clickByText('.tx-empty-state button', '返回首页')), 'error home button')
  await waitFor(`location.pathname === '/' && ${has(SIDEBAR)}`)
  record('cold-load 404 renders inside the layout', { note: `title "${errorPage.title}", 返回首页 leads back to /, console clean` })

  // In-app navigation to a missing route goes through `router.afterEach`
  // (no init-time hook), so this path must stay completely clean.
  await open(`${BASE}/`)
  await waitFor(has(SIDEBAR))
  await evaluate(`window.useNuxtApp().$router.push('/also-missing')`)
  await waitFor(`${has('.tx-empty-state')} && location.pathname === '/also-missing'`)
  await sleep(300)
  const inAppError = await evaluate(`({ heading: document.querySelector('.tx-empty-state')?.textContent.replace(/\\s+/g, ' ').trim(), sidebar: ${has(SIDEBAR)} })`)
  assert(inAppError.heading.includes('哎呀，这个页面不存在') && inAppError.sidebar, `in-app 404 ${JSON.stringify(inAppError)}`)
  assertClean('in-app 404')
  record('in-app 404 is console-clean', { note: 'router.push to a missing route shows the same error page with zero warnings' })

  mkdirSync('reports', { recursive: true })
  writeFileSync('reports/shell-verify.json', JSON.stringify({ base: BASE, at: new Date().toISOString(), steps }, null, 2))
  console.log(`\nall ${steps.length} steps passed`)
}
catch (error) {
  console.error('\nFAILED:', error.message)
  console.error('console so far:', JSON.stringify(chrome.console().slice(-20), null, 2))
  await screenshot('reports/shell-failure.png').catch(() => {})
  process.exitCode = 1
}
finally {
  await chrome.close()
}
