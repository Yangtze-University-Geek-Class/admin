import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { launchChrome, sleep, waitForHttp } from './lib/cdp.mjs'

/**
 * Phase G acceptance for the user pages, preferences, the member directory,
 * notifications, bookmarks and search — plus the G0 tag-creation fix-up on
 * `/new`. Driven through CDP against the dev server (port 3456); reuses one
 * that is already running, otherwise starts and stops its own.
 *
 * Every step that claims a mutation re-reads `localStorage` rather than
 * trusting the pixels, and the expected numbers are recomputed here from the
 * stored state instead of being asked of the store that rendered them.
 *
 * The run fails on the first assertion that does not hold.
 */

const BASE = process.env.TUFF_FORUM_URL ?? 'http://localhost:3456'
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))

const STATE_KEY = 'tuff-forum:state:v1'
const SESSION_KEY = 'tuff-forum:session:v1'
/** The persist plugin debounces its writes by 150 ms. */
const PERSIST_MS = 450
/** Must match `ACTIVITY_SCAN` / `ACTIVITY_PAGE` in `app/pages/u/[username]/index.vue`. */
const ACTIVITY_SCAN = 500
const ACTIVITY_PAGE = 30

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

/**
 * Drops nodes the shell keeps mounted next to the page: the sidebar (a second
 * copy lives inside the mobile drawer), TxSelect's option panels, the login
 * modal and any drawer — all of which render card items of their own.
 */
const PAGE_ONLY = `const pageOnly = list => list.filter(el => !el.closest('.tx-bui-sidebar-nav') && !el.closest('.tuff-select__panel') && !el.closest('.tx-modal__overlay') && !el.closest('.tx-drawer'))`

/**
 * TxBadge renders a number through `TxTextMorph`, which splits the value into
 * animated glyph columns (`tx-morph-item`, `aria-hidden` while they roll) and
 * keeps a plain `tx-morph-sr` mirror beside them for screen readers. So
 * `textContent` reads the value twice over, and the glyph columns still hold
 * the outgoing digit mid-animation — the mirror is the value the component
 * means, rewritten on the same tick as the prop. Under reduced motion the
 * engine writes plain text instead, hence the fallback.
 */
const BADGE_DIGITS = `const badgeDigits = (badge) => {
  if (!badge) return null
  const mirror = [...badge.querySelectorAll('[tx-morph-sr]')].map(el => el.textContent).join('')
  return mirror || badge.textContent.trim()
}`

/** Clicks the first enabled button whose trimmed text matches, inside `scope`. */
const clickButton = (text, scope = 'body') => `(() => {
  const root = document.querySelector(${JSON.stringify(scope)})
  if (!root) return false
  const el = [...root.querySelectorAll('button')].find(b => b.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)} && !b.disabled)
  if (!el) return false
  el.click()
  return true
})()`

/** Clicks a `[role="tab"]`, a filter chip or any control by its visible text. */
const clickByRole = (role, text) => `(() => {
  const el = [...document.querySelectorAll('[role=${JSON.stringify(role)}]')].find(b => b.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)})
  if (!el) return false
  el.click()
  return true
})()`

const READ_STATE = `(() => JSON.parse(localStorage.getItem(${JSON.stringify(STATE_KEY)}) ?? 'null'))()`

// ------------------------------------------------------ store maths, redone

/** Ids of every topic's first post — the posts that are topics, not replies. */
function firstPostIds(state) {
  const byTopic = new Map()
  for (const post of state.posts) {
    const group = byTopic.get(post.topicId)
    if (group)
      group.push(post)
    else byTopic.set(post.topicId, [post])
  }
  const ids = new Set()
  for (const group of byTopic.values()) {
    group.sort((a, b) => a.createdAt - b.createdAt)
    ids.add(group[0].id)
  }
  return ids
}

function statsOf(state, userId) {
  const first = firstPostIds(state)
  const live = state.posts.filter(post => post.authorId === userId && !post.deleted)
  return {
    topics: state.topics.filter(topic => topic.authorId === userId).length,
    replies: live.filter(post => !first.has(post.id)).length,
    likesReceived: live.reduce((sum, post) => sum + post.likeUserIds.length, 0),
    likesGiven: state.posts.filter(post => !post.deleted && post.likeUserIds.includes(userId)).length,
    followers: state.follows.filter(follow => follow.followeeId === userId).length,
    following: state.follows.filter(follow => follow.followerId === userId).length,
  }
}

function activityOf(state, userId, limit = ACTIVITY_SCAN) {
  const first = firstPostIds(state)
  const events = []
  for (const topic of state.topics) {
    if (topic.authorId === userId)
      events.push({ kind: 'topic', at: topic.createdAt, topicId: topic.id })
  }
  for (const post of state.posts) {
    if (post.deleted)
      continue
    if (post.authorId === userId && !first.has(post.id))
      events.push({ kind: 'reply', at: post.createdAt, topicId: post.topicId })
    if (post.likeUserIds.includes(userId))
      events.push({ kind: 'like', at: post.createdAt, topicId: post.topicId })
  }
  for (const bookmark of state.bookmarks) {
    if (bookmark.userId !== userId)
      continue
    const post = state.posts.find(candidate => candidate.id === bookmark.postId)
    if (post)
      events.push({ kind: 'bookmark', at: bookmark.createdAt, topicId: post.topicId })
  }
  return events.sort((a, b) => b.at - a.at).slice(0, limit)
}

function notificationsOf(state, userId) {
  return state.notifications
    .filter(notification => notification.recipientId === userId)
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
}

function userBy(state, username) {
  return state.users.find(user => user.username === username)
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
  console.log('[verify-user-pages] no dev server on 3456; starting one')
  devServer = spawn('pnpm', ['dev'], { cwd: PROJECT_ROOT, stdio: 'ignore', detached: true })
  await waitForHttp(`${BASE}/`)
}
else {
  console.log('[verify-user-pages] reusing the dev server already on 3456')
}

const chrome = await launchChrome({ watchdogMs: 600_000 })
const { evaluate, waitFor, open, reload, emulate, screenshot, problems } = chrome

function assertClean(page) {
  const found = problems()
  assert(found.length === 0, `${page}: console problems ${JSON.stringify(found, null, 2)}`)
}

/**
 * Signs in as a seeded user by seeding the session, then loads `path`.
 *
 * The session is written from a neutral route first: writing it on `path`
 * itself and reloading would reload whatever `path` redirected the *previous*
 * identity to (`/u/x/preferences` sends a stranger to `/u/x`).
 */
async function loginAs(userId, path) {
  await open(`${BASE}/about`)
  await evaluate(`localStorage.setItem(${JSON.stringify(SESSION_KEY)}, JSON.stringify({ currentUserId: ${JSON.stringify(userId)} }))`)
  await open(`${BASE}${path}`)
  await sleep(500)
}

/**
 * Replaces the value of the n-th match and lets Vue see it.
 *
 * Written through the native `value` setter plus a bubbling `input` event —
 * the same route testing-library takes — because select-all + `insertText`
 * races the re-render a `v-model` schedules and can leave a partial value.
 */
async function setInput(selector, index, value) {
  const done = await evaluate(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}]
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    el.focus()
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value
  })()`)
  assert(done === value, `setting ${selector}[${index}] left ${JSON.stringify(done)}`)
  await sleep(250)
}

/** Types into a markdown editor's source textarea, at the end of what is there. */
async function typeInEditor(scope, text) {
  const focused = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(`${scope} .tx-markdown-editor__source`)})
    if (!el) return false
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    return true
  })()`)
  assert(focused, `no markdown source textarea inside ${scope}`)
  await chrome.type(text)
  await sleep(200)
}

/** Clicks a filter chip whose label starts with `text` (a count may follow it). */
const clickChipStartingWith = text => `(() => {
  const el = [...document.querySelectorAll('.tx-bui-filter-chips__chip')].find(c => c.textContent.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(text)}))
  if (!el) return false
  el.click()
  return true
})()`

/** Clicks a tab whose label starts with `text` (the badge count follows it). */
const clickTabStartingWith = text => `(() => {
  const el = [...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(text)}))
  if (!el) return false
  el.click()
  return true
})()`

/** The four tab labels / six stat cards / banner of a profile page. */
const PROFILE = `(() => {
  ${PAGE_ONLY}
  const text = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null
  return {
    path: location.pathname + location.search,
    title: document.title,
    tabs: [...document.querySelectorAll('[role="tab"]')].map(text),
    activeTab: text(document.querySelector('[role="tab"][aria-selected="true"]')),
    // NOT document-wide: the sidebar footer renders a card item for the signed-in
    // user that also reads "<display name>@<handle> · <role>".
    banner: text(pageOnly([...document.querySelectorAll('.tx-card-item')])[0]),
    badges: pageOnly([...document.querySelectorAll('.tx-status-badge')]).map(text),
    statLabels: [...document.querySelectorAll('.tx-stat-card__label')].map(text),
    statValues: [...document.querySelectorAll('.tx-stat-card__value')].map(text),
    gridColumns: (getComputedStyle(document.querySelector('.tx-grid') ?? document.body).gridTemplateColumns ?? '').split(' ').filter(Boolean).length,
    followLabel: text([...document.querySelectorAll('button')].find(b => ['关注', '已关注'].includes(b.textContent.trim()))),
    editProfile: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '编辑资料'),
    panelRows: pageOnly([...document.querySelectorAll('[role="tabpanel"] .tx-card-item')]).length,
    panelTitles: pageOnly([...document.querySelectorAll('[role="tabpanel"] .tx-card-item')]).map(el => text(el.querySelector('.tx-card-item__title'))),
    chips: [...document.querySelectorAll('.tx-bui-filter-chips__chip')].map(text),
  }
})()`

const DIRECTORY = `(() => {
  const text = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null
  const rows = [...document.querySelectorAll('.tx-data-table tbody tr')]
  const cells = row => [...row.querySelectorAll('td')].map(text)
  return {
    rows: rows.length,
    headers: [...document.querySelectorAll('.tx-data-table thead th')].map(text),
    handles: rows.map(row => (text(row).match(/@[a-z0-9_-]+/) ?? [null])[0]),
    likes: rows.map(row => cells(row)[2] ?? null),
    ariaSort: [...document.querySelectorAll('.tx-data-table thead th')].map(th => th.getAttribute('aria-sort')).find(value => value && value !== 'none') ?? null,
  }
})()`

const NOTIFICATIONS = `(() => {
  ${PAGE_ONLY}
  ${BADGE_DIGITS}
  const text = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null
  const rows = pageOnly([...document.querySelectorAll('.tx-card-item')])
  const markAll = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '全部标为已读')
  const headerBadge = document.querySelector('header .tx-badge')
  return {
    rows: rows.length,
    titles: rows.map(row => text(row.querySelector('.tx-card-item__title'))),
    boldRows: rows.filter(row => !!row.querySelector('.tx-card-item__title .font-semibold')).length,
    icons: rows.map(row => row.querySelector('.tx-card-item__left i, .tx-card-item__icon i')?.className ?? null),
    chips: [...document.querySelectorAll('.tx-bui-filter-chips__chip')].map(text),
    markAllDisabled: markAll ? markAll.disabled : null,
    headerBadge: headerBadge && headerBadge.getBoundingClientRect().width > 0 ? badgeDigits(headerBadge) : null,
    empty: text(document.querySelector('.tx-empty-state__title')),
  }
})()`

const BOOKMARKS = `(() => {
  ${PAGE_ONLY}
  const text = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null
  const rows = pageOnly([...document.querySelectorAll('.tx-card-item')])
  return {
    rows: rows.length,
    titles: rows.map(row => text(row.querySelector('.tx-card-item__title'))),
    removeButtons: document.querySelectorAll('button[aria-label="移除书签"]').length,
    empty: text(document.querySelector('.tx-empty-state__title')),
  }
})()`

const SEARCH = `(() => {
  ${PAGE_ONLY}
  ${BADGE_DIGITS}
  const text = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null
  const tabs = [...document.querySelectorAll('[role="tab"]')]
  const marks = [...document.querySelectorAll('[role="tabpanel"] mark')]
  const markStyle = marks[0] ? getComputedStyle(marks[0]) : null
  return {
    url: location.pathname + location.search,
    query: document.querySelector('input[placeholder="搜索话题、帖子或用户"]')?.value ?? null,
    tabs: tabs.map(tab => text(tab).replace(/\\d+$/, '')),
    tabCounts: tabs.map(tab => badgeDigits(tab.querySelector('.tx-badge'))),
    activeTab: text(document.querySelector('[role="tab"][aria-selected="true"]'))?.replace(/\\d+$/, '') ?? null,
    rows: pageOnly([...document.querySelectorAll('[role="tabpanel"] .tx-card-item')]).length,
    marks: marks.map(mark => mark.textContent),
    // The UA default for <mark> is a yellow system colour; a token-backed
    // background proves our utility classes actually applied.
    markStyled: !!markStyle && !['rgb(255, 255, 0)', 'rgba(0, 0, 0, 0)'].includes(markStyle.backgroundColor) && markStyle.backgroundColor !== markStyle.color,
    empty: text(document.querySelector('.tx-empty-state__title')),
  }
})()`

try {
  // ------------------------------------------------ 1 profile page structure
  await emulate({ width: 1280, height: 800 })
  await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await open(`${BASE}/`)
  await evaluate('localStorage.clear(); sessionStorage.clear()')
  // The persist plugin writes on the first store mutation, not on boot; a topic
  // page bumps its view counter, which is the cheapest way to get the fresh
  // seed into localStorage so the expectations below can be computed from it.
  await open(`${BASE}/t/t1`)
  await waitFor(has('[id^="post-p"]'))
  await sleep(PERSIST_MS)
  await open(`${BASE}/u/talex`)
  await waitFor(has('.tx-stat-card'))
  await sleep(PERSIST_MS)

  const state = await evaluate(READ_STATE)
  const talex = userBy(state, 'talex')
  const expectedStats = statsOf(state, talex.id)
  const profile = await evaluate(PROFILE)

  assert(profile.title.startsWith(talex.displayName), `title "${profile.title}" is not the display name`)
  assert(profile.banner.includes(`@${talex.username}`), `banner "${profile.banner}" lacks the handle`)
  assert(profile.badges.includes('管理员'), `banner badges ${JSON.stringify(profile.badges)} lack 管理员`)
  assert(profile.editProfile, 'your own profile offers no 编辑资料 button')
  assert(profile.followLabel === null, 'your own profile offers a 关注 button')
  assert(profile.tabs.length === 4 && profile.tabs.join('/') === '摘要/活动/通知/偏好设置', `self tabs ${JSON.stringify(profile.tabs)}`)
  assert(profile.statLabels.join('/') === '话题/帖子/已收到的赞/已送出的赞/关注者/正在关注', `stat labels ${JSON.stringify(profile.statLabels)}`)
  const shownStats = profile.statValues.map(Number)
  const wantStats = [expectedStats.topics, expectedStats.replies, expectedStats.likesReceived, expectedStats.likesGiven, expectedStats.followers, expectedStats.following]
  assert(JSON.stringify(shownStats) === JSON.stringify(wantStats), `stat values ${JSON.stringify(shownStats)} vs the stored state's ${JSON.stringify(wantStats)}`)
  assertClean('/u/talex')
  await screenshot('reports/user-desktop-light.png')

  // Viewed by a guest, the self-only tabs are gone.
  await loginAs(null, '/u/mika')
  await waitFor(has('.tx-stat-card'))
  const asGuest = await evaluate(PROFILE)
  assert(asGuest.tabs.join('/') === '摘要/活动', `guest tabs on somebody else's profile ${JSON.stringify(asGuest.tabs)}`)
  assert(!asGuest.editProfile, 'a guest is offered 编辑资料 on somebody else\'s profile')
  assert(asGuest.followLabel === '关注', `guest follow button "${asGuest.followLabel}"`)
  assertClean('/u/mika as guest')
  record('the profile page renders the banner, six live stats and the right tabs', {
    note: `talex: 管理员 badge, ${profile.statLabels.join('/')} = ${shownStats.join('/')} (recomputed from localStorage), 4 self tabs; mika seen by a guest has 2 tabs and no 编辑资料`,
  })

  // ------------------------------------------------------------- 2 following
  // Pick somebody who does not already follow talex; mika does, in the seed.
  const follower = state.users.find(user =>
    user.id !== talex.id && !state.follows.some(follow => follow.followerId === user.id && follow.followeeId === talex.id))
  assert(follower, 'every seeded user already follows talex')
  await loginAs(follower.id, '/u/talex')
  await waitFor(has('.tx-stat-card'))
  const beforeFollow = await evaluate(PROFILE)
  const followersBefore = Number(beforeFollow.statValues[4])
  assert(beforeFollow.followLabel === '关注', `@${follower.username} sees "${beforeFollow.followLabel}" on talex`)

  assert(await evaluate(clickButton('关注')), 'the 关注 button is not clickable')
  await sleep(PERSIST_MS)
  const followed = await evaluate(PROFILE)
  const followedState = await evaluate(READ_STATE)
  assert(followed.followLabel === '已关注', `button stayed "${followed.followLabel}"`)
  assert(Number(followed.statValues[4]) === followersBefore + 1, `关注者 ${followersBefore} → ${followed.statValues[4]}`)
  assert(followedState.follows.some(f => f.followerId === follower.id && f.followeeId === talex.id), `localStorage has no @${follower.username} → talex follow`)
  const followNotification = followedState.notifications.find(n => n.type === 'follow' && n.recipientId === talex.id && n.actorId === follower.id)
  assert(followNotification, 'no follow notification for talex in localStorage')
  assert(followNotification.read === false, 'the new follow notification arrived already read')

  assert(await evaluate(clickButton('已关注')), 'the 已关注 button is not clickable')
  await sleep(PERSIST_MS)
  const unfollowed = await evaluate(PROFILE)
  const unfollowedState = await evaluate(READ_STATE)
  assert(unfollowed.followLabel === '关注', `button stayed "${unfollowed.followLabel}" after unfollowing`)
  assert(Number(unfollowed.statValues[4]) === followersBefore, `关注者 did not return: ${unfollowed.statValues[4]}`)
  assert(!unfollowedState.follows.some(f => f.followerId === follower.id && f.followeeId === talex.id), `localStorage still records @${follower.username} following talex`)
  assertClean('follow toggle')
  record('following updates the stat, the store and the followee\'s notifications', {
    note: `as @${follower.username}: 关注 → 已关注, 关注者 ${followersBefore} → ${followersBefore + 1}, unread follow notification ${followNotification.id} in localStorage; a second click reverts all three`,
  })

  // --------------------------------------------------- 3 ?tab=activity chips
  await open(`${BASE}/u/talex?tab=activity`)
  await waitFor(has('[role="tabpanel"] .tx-bui-filter-chips__chip'))
  await sleep(300)
  const activityState = await evaluate(READ_STATE)
  const events = activityOf(activityState, talex.id)
  const activity = await evaluate(PROFILE)

  assert(activity.activeTab === '活动', `?tab=activity landed on "${activity.activeTab}"`)
  const wantChips = ['全部', '话题', '回复', '赞', '书签']
  assert(activity.chips.map(chip => chip.replace(/\d+$/, '')).join('/') === wantChips.join('/'), `activity chips ${JSON.stringify(activity.chips)}`)
  assert(activity.panelRows === Math.min(events.length, ACTIVITY_PAGE), `活动 shows ${activity.panelRows} rows for ${events.length} stored events (page size ${ACTIVITY_PAGE})`)

  const perKind = {}
  for (const kind of ['topic', 'reply', 'like', 'bookmark'])
    perKind[kind] = events.filter(event => event.kind === kind).length
  const chipCounts = activity.chips.map(chip => Number(chip.match(/\d+$/)?.[0] ?? -1))
  assert(JSON.stringify(chipCounts) === JSON.stringify([events.length, perKind.topic, perKind.reply, perKind.like, perKind.bookmark]), `chip counts ${JSON.stringify(chipCounts)} vs ${JSON.stringify([events.length, perKind.topic, perKind.reply, perKind.like, perKind.bookmark])}`)

  const seenPerKind = {}
  for (const [kind, label] of [['topic', '话题'], ['reply', '回复'], ['like', '赞'], ['bookmark', '书签']]) {
    assert(await evaluate(`(() => {
      const el = [...document.querySelectorAll('.tx-bui-filter-chips__chip')].find(c => c.textContent.replace(/\\s+/g, ' ').trim().replace(/\\d+$/, '') === ${JSON.stringify(label)})
      if (!el) return false
      el.click()
      return true
    })()`), `activity chip ${label} is not clickable`)
    await sleep(250)
    const filtered = await evaluate(PROFILE)
    seenPerKind[kind] = filtered.panelRows
    assert(filtered.panelRows === Math.min(perKind[kind], ACTIVITY_PAGE), `chip ${label} shows ${filtered.panelRows} rows, the stored state has ${perKind[kind]} (page size ${ACTIVITY_PAGE})`)
  }
  const kindTotal = Object.keys(perKind).reduce((sum, kind) => sum + perKind[kind], 0)
  assert(kindTotal === events.length, `the four kinds sum to ${kindTotal}, not ${events.length}`)
  assert(Object.values(seenPerKind).some(rows => rows > 0), 'every kind filtered down to an empty list')
  assertClean('/u/talex?tab=activity')
  record('?tab=activity deep-links and its chips slice the real event list', {
    note: `活动 active on load; chips count every stored event (话题/回复/赞/书签 = ${perKind.topic}/${perKind.reply}/${perKind.like}/${perKind.bookmark}, summing to ${events.length}) while the panel renders ${JSON.stringify(seenPerKind)} rows, each capped at ${ACTIVITY_PAGE}`,
  })

  // ----------------------------------------------------------- 4 preferences
  await loginAs('u1', '/u/talex/preferences')
  await waitFor(has('.tx-block-input input'))
  const NEW_NAME = '塔莱克斯'
  const NEW_BIO = '这条简介是在偏好设置里改的。'

  const prefsBefore = await evaluate(`(() => ({
    activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim(),
    tabs: [...document.querySelectorAll('[role="tab"]')].map(t => t.textContent.trim()),
    values: [...document.querySelectorAll('.tx-block-input input')].map(i => i.value),
  }))()`)
  assert(prefsBefore.tabs.join('/') === '个人资料/头像/通知/界面', `preference tabs ${JSON.stringify(prefsBefore.tabs)}`)
  assert(prefsBefore.activeTab === '个人资料', `preferences opened on "${prefsBefore.activeTab}"`)
  assert(prefsBefore.values[0] === talex.displayName, `显示名 field holds "${prefsBefore.values[0]}"`)

  await setInput('.tx-block-input input', 0, NEW_NAME)
  await setInput('.tx-block-input input', 1, NEW_BIO)

  // Staged: nothing has reached the store yet.
  const staged = await evaluate(READ_STATE)
  assert(userBy(staged, 'talex').displayName === talex.displayName, 'editing the field already wrote to the store before 保存更改')

  assert(await evaluate(clickButton('保存更改')), '保存更改 is not clickable')
  await sleep(PERSIST_MS)
  const savedToast = await evaluate(`${q('.tx-toast')}?.textContent.replace(/\\s+/g, ' ').trim() ?? null`)
  assert(savedToast && savedToast.includes('保存'), `no save toast (saw ${JSON.stringify(savedToast)})`)
  const savedState = await evaluate(READ_STATE)
  assert(userBy(savedState, 'talex').displayName === NEW_NAME, `localStorage displayName is "${userBy(savedState, 'talex').displayName}"`)
  assert(userBy(savedState, 'talex').bio === NEW_BIO, 'localStorage bio did not change')
  await screenshot('reports/user-preferences.png')

  await open(`${BASE}/u/talex`)
  await waitFor(has('.tx-stat-card'))
  const renamed = await evaluate(`(() => {
    ${PAGE_ONLY}
    return {
      banner: pageOnly([...document.querySelectorAll('.tx-card-item')])[0].textContent.replace(/\\s+/g, ' ').trim(),
      headerInitial: document.querySelector('header .tx-avatar__text')?.textContent.trim() ?? null,
    }
  })()`)
  assert(renamed.banner.includes(NEW_NAME) && renamed.banner.includes(NEW_BIO), `banner "${renamed.banner}" is missing the new name or bio`)
  assert(renamed.headerInitial === NEW_NAME[0], `header avatar initial is "${renamed.headerInitial}", not "${NEW_NAME[0]}"`)

  // Avatar colour: a radio that changes the preview and survives a save.
  await open(`${BASE}/u/talex/preferences`)
  await waitFor(has('[role="tab"]'))
  assert(await evaluate(clickByRole('tab', '头像')), '头像 tab is not clickable')
  await waitFor(has('.tx-radio'))
  await sleep(250)
  const colourBefore = await evaluate(`${q('[role="tabpanel"] .tx-avatar')}.style.getPropertyValue('--tx-avatar-bg').trim()`)
  const picked = await evaluate(`(() => {
    const radios = [...document.querySelectorAll('[role="tabpanel"] .tx-radio')]
    const target = radios.find(r => !r.querySelector('.tx-avatar')?.style.getPropertyValue('--tx-avatar-bg').trim().includes(${JSON.stringify(colourBefore)}))
    if (!target) return null
    const want = target.querySelector('.tx-avatar').style.getPropertyValue('--tx-avatar-bg').trim()
    target.click()
    return want
  })()`)
  assert(picked, 'no avatar colour other than the current one is offered')
  await sleep(300)
  const colourAfter = await evaluate(`${q('[role="tabpanel"] .tx-avatar')}.style.getPropertyValue('--tx-avatar-bg').trim()`)
  assert(colourAfter === picked, `the preview stayed ${colourAfter} after picking ${picked}`)

  // A notification switch, on the same save.
  assert(await evaluate(clickByRole('tab', '通知')), '通知 tab is not clickable')
  await waitFor(has('.tx-block-switch'))
  await sleep(250)
  const switchBefore = await evaluate(`${q('[role="tabpanel"] .tx-block-switch [role="switch"], [role="tabpanel"] .tx-block-switch button')}?.getAttribute('aria-checked')`)
  assert(await evaluate(`(() => {
    const el = ${q('[role="tabpanel"] .tx-block-switch [role="switch"], [role="tabpanel"] .tx-block-switch button')}
    if (!el) return false
    el.click()
    return true
  })()`), 'the 有人回复我 switch is not clickable')
  await sleep(250)
  assert(await evaluate(clickButton('保存更改')), '保存更改 is not clickable after the avatar/switch edits')
  await sleep(PERSIST_MS)
  await reload()
  await sleep(600)
  const persisted = await evaluate(READ_STATE)
  const savedUser = userBy(persisted, 'talex')
  assert(savedUser.avatarColor === picked, `avatarColor is ${savedUser.avatarColor}, not ${picked}`)
  assert(String(savedUser.notifyPrefs.reply) !== switchBefore, `notifyPrefs.reply stayed ${savedUser.notifyPrefs.reply} (was ${switchBefore})`)
  assert(savedUser.displayName === NEW_NAME, 'the earlier rename did not survive the reload')
  assertClean('preferences')
  record('preferences stage their edits and commit them all on 保存更改', {
    note: `显示名 → ${NEW_NAME} and 简介 stayed out of the store until 保存更改, then the banner, the header initial "${renamed.headerInitial}" and localStorage all followed; avatar colour ${colourBefore} → ${picked} and notifyPrefs.reply ${switchBefore} → ${savedUser.notifyPrefs.reply} survive a reload`,
  })

  // Somebody else's preferences page redirects without rendering the form.
  const watcher = await chrome.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__sawForm = false;
      const check = () => { if (document.querySelector('.tx-group-block, .tx-block-input, .tx-radio-group')) window.__sawForm = true };
      document.addEventListener('DOMContentLoaded', () => {
        check()
        new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true })
      })`,
  })
  await open(`${BASE}/u/mika/preferences`)
  await waitFor(has('.tx-stat-card'), { timeoutMs: 10_000 })
  await sleep(600)
  const redirect = await evaluate(`(() => ({ path: location.pathname, sawForm: window.__sawForm, form: ${has('.tx-block-input')} }))()`)
  await chrome.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: watcher.identifier })
  assert(redirect.path === '/u/mika', `/u/mika/preferences landed on ${redirect.path}`)
  assert(redirect.sawForm === false, 'the preferences form was rendered before the redirect')
  assert(!redirect.form, 'the preferences form is on screen after the redirect')
  assertClean('/u/mika/preferences as talex')
  record('somebody else\'s preferences page redirects and never renders the form', {
    note: `/u/mika/preferences → ${redirect.path}; a MutationObserver installed before the document ran saw no .tx-group-block / .tx-block-input / .tx-radio-group at any point`,
  })

  // ----------------------------------------------------------- 5 /users
  await open(`${BASE}/users`)
  await waitFor(has('.tx-data-table tbody tr'))
  await sleep(300)
  const directoryState = await evaluate(READ_STATE)
  const directory = await evaluate(DIRECTORY)
  assert(directory.rows === directoryState.users.length, `${directory.rows} rows for ${directoryState.users.length} seeded users`)
  assert(directory.headers.join('/') === '用户/角色/已收到的赞/话题/回复/加入时间', `directory headers ${JSON.stringify(directory.headers)}`)

  assert(await evaluate(`(() => {
    const el = [...document.querySelectorAll('button.tx-data-table__sort-button')].find(b => b.textContent.trim() === '已收到的赞')
    if (!el) return false
    el.click(); el.click()
    return true
  })()`), 'the 已收到的赞 header is not sortable')
  await sleep(300)
  const sorted = await evaluate(DIRECTORY)
  const ranked = directoryState.users
    .map(user => ({ username: user.username, likes: statsOf(directoryState, user.id).likesReceived }))
    .sort((a, b) => b.likes - a.likes)
  assert(sorted.ariaSort === 'descending', `aria-sort is ${sorted.ariaSort}`)
  assert(sorted.handles[0] === `@${ranked[0].username}`, `sorted first row is ${sorted.handles[0]}, the stored state's top liker is @${ranked[0].username}`)
  assert(Number(sorted.likes[0]) === ranked[0].likes, `first row shows ${sorted.likes[0]} likes, the stored state says ${ranked[0].likes}`)
  assert(sorted.likes.every((value, index) => index === 0 || Number(value) <= Number(sorted.likes[index - 1])), `likes column is not descending: ${JSON.stringify(sorted.likes)}`)

  await setInput('input[placeholder="搜索用户"]', 0, 'mika')
  await sleep(400)
  const searched = await evaluate(DIRECTORY)
  assert(searched.rows === 1 && searched.handles[0] === '@mika', `searching "mika" left ${searched.rows} rows: ${JSON.stringify(searched.handles)}`)

  await evaluate(`document.querySelector('.tx-data-table tbody tr').click()`)
  await sleep(500)
  assert(await evaluate('location.pathname') === '/u/mika', `a directory row click landed on ${await evaluate('location.pathname')}`)
  assertClean('/users')
  record('the member directory sorts and filters against the stored state', {
    note: `${directory.rows} rows, headers ${directory.headers.join('/')}; 已收到的赞 desc puts @${ranked[0].username} (${ranked[0].likes}) first with aria-sort=descending; "mika" narrows to 1 row and the row click opens /u/mika`,
  })

  // --------------------------------------------------------- 6 notifications
  await loginAs('u1', '/notifications')
  await waitFor(has('.tx-card-item'))
  await sleep(300)
  const notifyState = await evaluate(READ_STATE)
  const mine = notificationsOf(notifyState, 'u1')
  const unreadSeed = mine.filter(notification => !notification.read)
  const notify = await evaluate(NOTIFICATIONS)

  assert(notify.headerBadge === String(unreadSeed.length), `header badge reads ${notify.headerBadge}, localStorage has ${unreadSeed.length} unread`)
  assert(Number(notify.chips[0].match(/\d+$/)[0]) === unreadSeed.length, `未读 chip ${notify.chips[0]} vs ${unreadSeed.length}`)
  assert(Number(notify.chips[1].match(/\d+$/)[0]) === mine.length, `全部 chip ${notify.chips[1]} vs ${mine.length}`)
  assert(notify.rows === unreadSeed.length, `${notify.rows} rows under the 未读 filter for ${unreadSeed.length} unread`)
  assert(notify.boldRows === unreadSeed.length, `${notify.boldRows} of ${notify.rows} unread rows are bold`)
  await screenshot('reports/user-notifications.png')

  const firstUnread = unreadSeed[0]
  const expectedTarget = firstUnread.type === 'follow'
    ? `/u/${notifyState.users.find(user => user.id === firstUnread.actorId).username}`
    : firstUnread.topicId ? `/t/${firstUnread.topicId}` : '/about'
  await evaluate(`(() => { ${PAGE_ONLY}; pageOnly([...document.querySelectorAll('.tx-card-item')])[0].click() })()`)
  await sleep(700)
  const landed = await evaluate('location.pathname')
  assert(landed === expectedTarget, `clicking the newest unread (${firstUnread.type}) landed on ${landed}, not ${expectedTarget}`)
  await sleep(PERSIST_MS)
  const afterClick = await evaluate(READ_STATE)
  assert(afterClick.notifications.find(n => n.id === firstUnread.id).read === true, `${firstUnread.id} is still unread in localStorage`)
  const badgeAfter = await evaluate(`(() => { ${BADGE_DIGITS}; return badgeDigits(document.querySelector('header .tx-badge')) })()`)
  assert(badgeAfter === String(unreadSeed.length - 1), `header badge is ${badgeAfter}, expected ${unreadSeed.length - 1}`)

  await open(`${BASE}/notifications`)
  await waitFor(has('.tx-bui-filter-chips__chip'))
  assert(await evaluate(clickButton('全部标为已读')), '全部标为已读 is not clickable')
  await sleep(PERSIST_MS)
  const cleared = await evaluate(NOTIFICATIONS)
  const clearedState = await evaluate(READ_STATE)
  assert(notificationsOf(clearedState, 'u1').every(notification => notification.read), 'localStorage still holds an unread notification for talex')
  assert(cleared.markAllDisabled, '全部标为已读 is still enabled at zero unread')
  assert(cleared.headerBadge === null, `the header badge is still showing ${cleared.headerBadge}`)
  assertClean('/notifications')
  record('notifications match the badge, mark themselves read and navigate to their subject', {
    note: `header badge ${unreadSeed.length} = 未读 chip = ${notify.rows} bold rows; clicking the newest (${firstUnread.type}) went to ${landed}, wrote read:true and dropped the badge to ${badgeAfter}; 全部标为已读 emptied the store and disabled itself`,
  })

  // ------------------------------------------------------------- 7 bookmarks
  await loginAs('u1', '/bookmarks')
  await sleep(400)
  const bookmarkState = await evaluate(READ_STATE)
  const seeded = bookmarkState.bookmarks.filter(bookmark => bookmark.userId === 'u1')
  const bookmarks = await evaluate(BOOKMARKS)
  assert(bookmarks.rows === seeded.length, `${bookmarks.rows} bookmark rows for ${seeded.length} stored bookmarks`)

  assert(await evaluate(`(() => {
    const el = document.querySelector('button[aria-label="移除书签"]')
    if (!el) return false
    el.click()
    return true
  })()`), 'no 移除书签 button')
  await sleep(PERSIST_MS)
  const afterRemove = await evaluate(BOOKMARKS)
  const afterRemoveState = await evaluate(READ_STATE)
  assert(afterRemove.rows === seeded.length - 1, `rows ${seeded.length} → ${afterRemove.rows}`)
  assert(afterRemoveState.bookmarks.filter(b => b.userId === 'u1').length === seeded.length - 1, 'localStorage kept the removed bookmark')

  await open(`${BASE}/t/t1`)
  await waitFor(has('[id^="post-p"]'))
  await sleep(300)
  const bookmarkedPost = await evaluate(`(() => {
    const post = document.querySelectorAll('[id^="post-p"]')[1]
    post.querySelector('button[aria-label="书签"]').click()
    return post.id.replace('post-', '')
  })()`)
  await sleep(PERSIST_MS)
  await open(`${BASE}/bookmarks`)
  await sleep(500)
  const afterAdd = await evaluate(BOOKMARKS)
  const afterAddState = await evaluate(READ_STATE)
  assert(afterAdd.rows === seeded.length, `bookmarking a post left ${afterAdd.rows} rows, expected ${seeded.length}`)
  assert(afterAddState.bookmarks.some(b => b.userId === 'u1' && b.postId === bookmarkedPost), `${bookmarkedPost} is not in localStorage bookmarks`)
  const t1Title = afterAddState.topics.find(topic => topic.id === 't1').title
  assert(afterAdd.titles.includes(t1Title), `the new bookmark's topic "${t1Title}" is not listed: ${JSON.stringify(afterAdd.titles)}`)
  assertClean('/bookmarks')
  record('bookmarks list the stored set and follow both directions', {
    note: `${seeded.length} seeded rows; 移除书签 dropped one in the DOM and in localStorage; bookmarking ${bookmarkedPost} on /t/t1 brought "${t1Title}" back to ${afterAdd.rows} rows`,
  })

  // ---------------------------------------------------------------- 8 search
  await open(`${BASE}/search?q=tuffex`)
  await waitFor(has('[role="tab"]'))
  await sleep(500)
  const searchState = await evaluate(READ_STATE)
  const needle = 'tuffex'
  const wantTopics = searchState.topics.filter(topic => topic.title.toLowerCase().includes(needle)).length
  const wantPosts = searchState.posts.filter(post => !post.deleted && post.content.toLowerCase().includes(needle)).length
  const wantUsers = searchState.users.filter(user => user.username.toLowerCase().includes(needle) || user.displayName.toLowerCase().includes(needle)).length
  const search = await evaluate(SEARCH)

  assert(search.tabs.join('/') === '话题/帖子/用户', `search tabs ${JSON.stringify(search.tabs)}`)
  assert(JSON.stringify(search.tabCounts) === JSON.stringify([String(wantTopics), String(wantPosts), String(wantUsers)]), `tab badges ${JSON.stringify(search.tabCounts)} vs the stored state's ${JSON.stringify([wantTopics, wantPosts, wantUsers])}`)
  assert(search.rows === wantTopics, `话题 tab shows ${search.rows} rows for a badge of ${wantTopics}`)
  await screenshot('reports/user-search.png')

  assert(await evaluate(clickTabStartingWith('帖子')), '帖子 tab is not clickable')
  await sleep(400)
  const posts = await evaluate(SEARCH)
  assert(posts.rows === wantPosts, `帖子 tab shows ${posts.rows} rows for a badge of ${wantPosts}`)
  assert(posts.marks.length > 0, 'no <mark> highlight in the post results')
  assert(posts.marks.every(mark => mark.toLowerCase() === needle), `highlighted text ${JSON.stringify(posts.marks)} is not the query`)
  assert(posts.markStyled, 'the <mark> carries the browser default background, not a tuffex token')

  await reload()
  await sleep(700)
  const reloaded = await evaluate(SEARCH)
  assert(reloaded.query === needle, `?q= did not survive the reload (input holds ${JSON.stringify(reloaded.query)})`)
  assert(reloaded.url.includes('q=tuffex'), `the URL lost its query: ${reloaded.url}`)

  await setInput('input[placeholder="搜索话题、帖子或用户"]', 0, 'zzzznothinghere')
  await sleep(600)
  const nothing = await evaluate(SEARCH)
  assert(nothing.empty && nothing.empty.includes('没有找到'), `a nonsense query shows ${JSON.stringify(nothing.empty)}`)
  assertClean('/search')
  record('search tabs, badges, highlight and ?q= all agree with the stored state', {
    note: `"tuffex": 话题/帖子/用户 badges ${search.tabCounts.join('/')} = ${wantTopics}/${wantPosts}/${wantUsers} recomputed, rows match per tab, ${posts.marks.length} <mark> hits on a token pair, ?q= survives a reload, a nonsense query shows the empty state`,
  })

  // -------------------------------------------------- 9 G0: creating a tag
  await loginAs('u1', '/new')
  await waitFor(has('.tx-form'))
  const NEW_TAG = 'rolldown'
  const NEW_TITLE = '给标签系统加上新建标签的能力'
  const tagsBefore = (await evaluate(READ_STATE)).tags.length

  await setInput('.tx-form input', 0, NEW_TITLE)
  assert(await evaluate(`(() => {
    const trigger = [...document.querySelectorAll('.tuff-select__trigger')][0]
    if (!trigger) return false
    trigger.click()
    return true
  })()`), 'the category select is not clickable')
  await sleep(350)
  assert(await evaluate(`(() => {
    const option = [...document.querySelectorAll('.tuff-select__panel .tx-card-item')].find(o => o.textContent.includes('开发'))
    if (!option) return false
    option.click()
    return true
  })()`), 'no 开发 category option')
  await sleep(300)

  assert(await evaluate(`(() => {
    const input = document.querySelector('.tuff-select__multi-input')
    if (!input) return false
    input.focus()
    return true
  })()`), 'the tag select has no multi-input (allow-create is off?)')
  await chrome.type(NEW_TAG)
  await sleep(400)
  assert(await evaluate(has('.tuff-select__create')), 'the select offers no 创建这个标签 action for an unknown name')
  await evaluate(`${q('.tuff-select__create')}.click()`)
  await sleep(300)

  await typeInEditor('.tx-form', '标签系统现在可以在发帖时直接创建新标签了，这条话题就是用来验证的。')
  assert(await evaluate(clickButton('创建话题')), '创建话题 is not clickable')
  await waitFor(`location.pathname.startsWith('/t/')`, { timeoutMs: 10_000 })
  await sleep(PERSIST_MS)

  const createdState = await evaluate(READ_STATE)
  const createdTopicId = (await evaluate('location.pathname')).replace('/t/', '')
  const createdTopic = createdState.topics.find(topic => topic.id === createdTopicId)
  const mintedTag = createdState.tags.find(tag => tag.slug === NEW_TAG)
  assert(createdState.tags.length === tagsBefore + 1, `tags ${tagsBefore} → ${createdState.tags.length}; exactly one should have been minted`)
  assert(mintedTag, `no tag with slug "${NEW_TAG}" in localStorage`)
  assert(createdTopic.tagIds.includes(mintedTag.id), `the topic carries ${JSON.stringify(createdTopic.tagIds)}, not ${mintedTag.id}`)
  assert(createdTopic.tagIds.every(id => createdState.tags.some(tag => tag.id === id)), 'the topic carries a tag id that resolves to nothing')
  assert(createdState.counters.tag === createdState.tags.length, `counters.tag ${createdState.counters.tag} vs ${createdState.tags.length} tags`)

  const topicTags = await evaluate(`[...document.querySelectorAll('.tx-tag__content')].map(el => el.textContent.trim())`)
  assert(topicTags.includes(NEW_TAG), `the topic page shows ${JSON.stringify(topicTags)}, without "${NEW_TAG}"`)

  await open(`${BASE}/tags`)
  await waitFor(has('.tx-tag'))
  await sleep(300)
  const cloud = await evaluate(`(() => {
    ${PAGE_ONLY}
    return pageOnly([...document.querySelectorAll('.tx-tag')]).map(el => el.textContent.replace(/\\s+/g, ' ').trim())
  })()`)
  const cloudEntry = cloud.find(entry => entry.startsWith(NEW_TAG))
  assert(cloudEntry, `/tags does not list "${NEW_TAG}": ${JSON.stringify(cloud.slice(0, 6))}…`)
  assert(cloudEntry.replace(NEW_TAG, '').trim() === '1', `/tags shows "${cloudEntry}", expected a count of 1`)

  assert(await evaluate(`(() => {
    ${PAGE_ONLY}
    const el = pageOnly([...document.querySelectorAll('.tx-tag')]).find(t => t.textContent.trim().startsWith(${JSON.stringify(NEW_TAG)}))
    if (!el) return false
    el.click()
    return true
  })()`), `the "${NEW_TAG}" chip is not clickable`)
  await sleep(700)
  const filtered = await evaluate(`(() => ({
    path: location.pathname,
    rows: document.querySelectorAll('.tx-data-table tbody tr').length,
    first: document.querySelector('.tx-data-table tbody tr')?.textContent.replace(/\\s+/g, ' ').trim() ?? null,
  }))()`)
  assert(filtered.path === `/tag/${NEW_TAG}`, `the chip led to ${filtered.path}`)
  assert(filtered.rows === 1, `/tag/${NEW_TAG} lists ${filtered.rows} topics, expected 1`)
  assert(filtered.first.includes(NEW_TITLE), `the single row is "${filtered.first}"`)
  assertClean('G0 tag creation')
  record('G0: the composer mints a tag that resolves everywhere', {
    note: `创建这个标签 on an unknown name added exactly one tag (${tagsBefore} → ${createdState.tags.length}, id ${mintedTag.id}, slug ${mintedTag.slug}, colour ${mintedTag.color}); the topic page shows the chip, /tags lists it with count 1 and /tag/${NEW_TAG} filters to the one topic`,
  })

  // ------------------------------------------------------------- 10 at 390px
  await emulate({ width: 390, height: 844, mobile: true })
  await open(`${BASE}/u/talex`)
  await waitFor(has('.tx-stat-card'))
  await sleep(400)
  const narrowProfile = await evaluate(PROFILE)
  assert(narrowProfile.gridColumns === 2, `the stat grid renders ${narrowProfile.gridColumns} columns at 390px`)
  assert(narrowProfile.statValues.length === 6, `${narrowProfile.statValues.length} stat cards at 390px`)

  await open(`${BASE}/u/talex/preferences`)
  await waitFor(has('.tx-block-input input'))
  await sleep(400)
  const narrowPrefs = await evaluate(`(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')]
    const hittable = tabs.filter((tab) => {
      const rect = tab.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return false
      const hit = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2))
      return !!hit && tab.contains(hit)
    }).length
    return { tabs: tabs.length, hittable, inputs: document.querySelectorAll('.tx-block-input input').length }
  })()`)
  assert(narrowPrefs.tabs === 4 && narrowPrefs.hittable === 4, `${narrowPrefs.hittable} of ${narrowPrefs.tabs} preference tabs are reachable at 390px`)
  assert(narrowPrefs.inputs === 4, `${narrowPrefs.inputs} profile inputs at 390px`)

  // The busiest inbox, so "nothing is clipped" is a claim about long sentences
  // rather than about one short row.
  const inboxState = await evaluate(READ_STATE)
  const busiest = inboxState.users
    .map(user => ({ user, count: notificationsOf(inboxState, user.id).length }))
    .sort((a, b) => b.count - a.count)[0]
  await loginAs(busiest.user.id, '/notifications')
  await waitFor(has('.tx-bui-filter-chips__chip'))
  // 未读 is the default and a given user may have none; 全部 always has rows.
  assert(await evaluate(clickChipStartingWith('全部')), 'no 全部 chip on /notifications')
  await waitFor(has('.tx-card-item'))
  await sleep(400)
  const narrowNotify = await evaluate(`(() => {
    ${PAGE_ONLY}
    const titles = pageOnly([...document.querySelectorAll('.tx-card-item__title')])
    const lineHeight = titles[0] ? Number.parseFloat(getComputedStyle(titles[0]).lineHeight) : 0
    return {
      rows: titles.length,
      longest: Math.max(0, ...titles.map(t => t.textContent.trim().length)),
      heights: titles.map(t => Math.round(t.getBoundingClientRect().height)),
      // A wrapped title is taller than one line; if none wrapped, nowrap would
      // not have been visible either and the clip assertion proves nothing.
      wrapped: lineHeight ? titles.filter(t => t.getBoundingClientRect().height > lineHeight * 1.5).length : 0,
      clipped: titles.filter(t => t.scrollWidth > t.clientWidth + 1).length,
      overflowing: pageOnly([...document.querySelectorAll('.tx-card-item')]).filter(r => r.scrollWidth > r.clientWidth + 1).length,
    }
  })()`)
  assert(narrowNotify.rows === busiest.count, `${narrowNotify.rows} notification rows for @${busiest.user.username}'s ${busiest.count} stored notifications`)
  assert(narrowNotify.longest >= 20, `the longest notification sentence is ${narrowNotify.longest} characters, too short for the clip check to mean anything`)
  assert(narrowNotify.wrapped > 0, `no notification title wrapped onto a second line at 390px (heights ${JSON.stringify(narrowNotify.heights)}), so nothing was under pressure`)
  assert(narrowNotify.clipped === 0, `${narrowNotify.clipped} of ${narrowNotify.rows} notification titles are clipped at 390px`)
  assert(narrowNotify.overflowing === 0, `${narrowNotify.overflowing} notification rows overflow at 390px`)
  await open(`${BASE}/u/talex`)
  await waitFor(has('.tx-stat-card'))
  await sleep(400)
  await screenshot('reports/user-mobile.png')
  assertClean('390px')
  record('the profile, preferences and notifications hold up at 390px', {
    note: `stat grid reflows to ${narrowProfile.gridColumns} columns with all 6 cards, 4/4 preference tabs are the hit target at their own centre, @${busiest.user.username}'s ${narrowNotify.rows} notification titles (longest ${narrowNotify.longest} chars, ${narrowNotify.wrapped} wrapped) with 0 clipped`,
  })

  // ------------------------------------------------------------------ 11 dark
  await emulate({ width: 1280, height: 800 })
  await open(`${BASE}/u/talex`)
  await waitFor(has('.tx-stat-card'))
  assert(await evaluate(`(() => {
    const el = document.querySelector('header button[aria-label="切换主题"]')
    if (!el) return false
    el.click()
    return true
  })()`), 'no theme toggle in the header')
  await sleep(600)
  const dark = await evaluate(`(() => ({
    dark: document.documentElement.classList.contains('dark'),
    stats: document.querySelectorAll('.tx-stat-card').length,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }))()`)
  assert(dark.dark, 'the theme toggle did not add html.dark')
  assert(dark.stats === 6, `${dark.stats} stat cards in dark mode`)
  await screenshot('reports/user-desktop-dark.png')
  assertClean('/u/talex dark')
  record('the profile page follows the dark theme', { note: `html.dark, body ${dark.bodyBg}, 6 stat cards still rendered` })

  mkdirSync('reports', { recursive: true })
  writeFileSync('reports/user-pages-verify.json', JSON.stringify({ base: BASE, at: new Date().toISOString(), steps }, null, 2))
  console.log(`\nall ${steps.length} steps passed`)
}
catch (error) {
  console.error('\nFAILED:', error.message)
  console.error('console so far:', JSON.stringify(chrome.console().slice(-20), null, 2))
  await screenshot('reports/user-failure.png').catch(() => {})
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
