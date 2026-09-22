import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { launchChrome, sleep, waitForHttp } from './lib/cdp.mjs'

/**
 * Phase F acceptance for the topic page (`/t/[id]`) and the new-topic form
 * (`/new`), driven through CDP against the dev server (port 3456). Reuses a
 * server that is already running; otherwise it starts one and stops it again.
 *
 * The run fails on the first assertion that does not hold.
 */

const BASE = process.env.TUFF_FORUM_URL ?? 'http://localhost:3456'
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url))

const STATE_KEY = 'tuff-forum:state:v1'
const SESSION_KEY = 'tuff-forum:session:v1'
/** The persist plugin debounces its writes by 150 ms. */
const PERSIST_MS = 450

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
 * Drops nodes the shell keeps mounted next to the page: the sidebar (a second
 * copy lives inside the mobile drawer), TxSelect's option panels, the login
 * modal and the composer drawer — all of which render card items of their own.
 */
const PAGE_ONLY = `const pageOnly = list => list.filter(el => !el.closest('.tx-bui-sidebar-nav') && !el.closest('.tuff-select__panel') && !el.closest('.tx-modal__overlay') && !el.closest('.tx-drawer'))`

/**
 * Clicks a dropdown entry by its text. TxDropdownItem renders a TxCardItem
 * (`div[role="menuitem"]`), not a button, so the button helper cannot see it.
 */
const clickMenuItem = text => `(() => {
  const el = [...document.querySelectorAll('.tx-dropdown__panel .tx-dropdown-item')]
    .find(item => item.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)})
  if (!el) return false
  el.click()
  return true
})()`

/** Clicks the first enabled button whose trimmed text matches, inside `scope`. */
const clickButton = (text, scope = 'body') => `(() => {
  const root = ${q('body')} && document.querySelector(${JSON.stringify(scope)})
  if (!root) return false
  const el = [...root.querySelectorAll('button')].find(b => b.textContent.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)} && !b.disabled)
  if (!el) return false
  el.click()
  return true
})()`

/** The topic control bar's reply button: primary, outside every post and the drawer. */
const CLICK_TOPIC_REPLY = `(() => {
  const el = [...document.querySelectorAll('button.variant-primary')]
    .find(b => b.textContent.trim() === '回复' && !b.closest('[id^="post-p"]') && !b.closest('.tx-drawer'))
  if (!el) return false
  el.click()
  return true
})()`

/** The composer's submit button, wherever inside the drawer it is rendered. */
const CLICK_COMPOSER_SUBMIT = `(() => {
  const el = [...document.querySelectorAll('.tx-drawer button.variant-primary')].find(b => b.textContent.trim() === '回复' && !b.disabled)
  if (!el) return false
  el.click()
  return true
})()`

/** Everything the post stream shows, in one round trip. */
const STREAM = `(() => {
  const posts = [...document.querySelectorAll('[id^="post-p"]')]
  const text = el => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null
  return {
    path: location.pathname,
    h1: text(document.querySelector('h1')),
    crumbAnchors: document.querySelectorAll('.tx-breadcrumb a[href]').length,
    crumbs: [...document.querySelectorAll('.tx-breadcrumb__link')].map(text),
    ids: posts.map(p => p.id.replace('post-', '')),
    floors: posts.map(p => [...p.querySelectorAll('span')].map(s => s.textContent.trim()).find(t => /^#\\d+$/.test(t)) ?? null),
    likes: posts.map(p => text(p.querySelector('button[aria-label="赞"]'))),
    likeIcons: posts.map(p => p.querySelector('button[aria-label="赞"] i')?.className ?? null),
    bodies: posts.map(p => p.querySelector('.tx-markdown-view')?.innerHTML ?? null),
    alerts: posts.map(p => text(p.querySelector('.tx-alert'))),
    editable: posts.map(p => !!p.querySelector('button i.i-carbon-edit')),
    more: posts.map(p => !!p.querySelector('button[aria-label="更多操作"]')),
    backlinks: posts.map(p => text(p.querySelector('button i.i-carbon-reply')?.closest('button'))),
    badges: [...document.querySelectorAll('.tx-status-badge')].map(text),
    timeline: [...document.querySelectorAll('.tx-timeline-item__title')].map(text),
    stats: [...document.querySelectorAll('.tx-stat-card')].map(text),
    participants: document.querySelectorAll('.tx-avatar-group__item:not(.tx-avatar-group__more)').length,
    hasTimeline: !!document.querySelector('.tx-timeline'),
    drawerVisible: !!document.querySelector('.tx-drawer--visible'),
    emptyState: text(document.querySelector('.tx-empty-state__title')),
    controlAlert: text([...document.querySelectorAll('.tx-alert')].find(a => !a.closest('[id^="post-p"]'))),
    topicReply: [...document.querySelectorAll('button.variant-primary')].some(b => b.textContent.trim() === '回复' && !b.closest('[id^="post-p"]') && !b.closest('.tx-drawer')),
    toast: !!document.querySelector('.tx-toast'),
  }
})()`

/** Card items that belong to the page (the suggested-topics list). */
const SUGGESTED = `(() => {
  ${PAGE_ONLY}
  return pageOnly([...document.querySelectorAll('.tx-card-item')]).map(el => el.querySelector('.tx-card-item__title')?.textContent.trim() ?? '')
})()`

const READ_STATE = `(() => JSON.parse(localStorage.getItem(${JSON.stringify(STATE_KEY)}) ?? 'null'))()`

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
  console.log('[verify-topic-page] no dev server on 3456; starting one')
  devServer = spawn('pnpm', ['dev'], { cwd: PROJECT_ROOT, stdio: 'ignore', detached: true })
  await waitForHttp(`${BASE}/`)
}
else {
  console.log('[verify-topic-page] reusing the dev server already on 3456')
}

const chrome = await launchChrome({ watchdogMs: 420_000 })
const { evaluate, waitFor, open, reload, emulate, screenshot, problems } = chrome

function assertClean(page) {
  const found = problems()
  assert(found.length === 0, `${page}: console problems ${JSON.stringify(found, null, 2)}`)
}

/** Signs in as a seeded user by seeding the session, then reloads the route. */
async function loginAs(userId, path) {
  await open(`${BASE}${path}`)
  await evaluate(`localStorage.setItem(${JSON.stringify(SESSION_KEY)}, JSON.stringify({ currentUserId: ${JSON.stringify(userId)} }))`)
  await reload()
  await waitFor(has('[id^="post-p"], .tx-form, .tx-empty-state'), { timeoutMs: 10_000 })
  await sleep(300)
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
  await sleep(150)
}

try {
  // ------------------------------------------------------------- 1 structure
  await emulate({ width: 1280, height: 800 })
  await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await open(`${BASE}/`)
  await evaluate('localStorage.clear(); sessionStorage.clear()')
  await open(`${BASE}/t/t1`)
  await waitFor(has('[id^="post-p"]'))
  await sleep(PERSIST_MS)

  const stream = await evaluate(STREAM)
  const state = await evaluate(READ_STATE)
  const storedPosts = state.posts.filter(post => post.topicId === 't1')
  const seedTopic = state.topics.find(topic => topic.id === 't1')
  const suggested = await evaluate(SUGGESTED)

  assert(stream.h1 === seedTopic.title, `h1 "${stream.h1}" vs seed "${seedTopic.title}"`)
  assert(stream.crumbAnchors === 0, `breadcrumb rendered ${stream.crumbAnchors} <a href> (a real link reloads the SPA)`)
  assert(stream.crumbs.length === 3, `breadcrumb items ${JSON.stringify(stream.crumbs)}`)
  assert(stream.ids.length === storedPosts.length, `${stream.ids.length} posts on screen vs ${storedPosts.length} in the store`)
  assert(stream.floors.every((floor, index) => floor === `#${index + 1}`), `floor numbers ${JSON.stringify(stream.floors.slice(0, 5))}…`)
  assert(stream.hasTimeline && stream.timeline.length >= 2, `aside timeline ${JSON.stringify(stream.timeline)}`)
  assert(stream.stats.length === 2, `aside stat cards ${JSON.stringify(stream.stats)}`)
  assert(stream.participants > 0, 'aside participant group is empty')
  assert(stream.badges.includes('已置顶'), `pinned badge missing: ${JSON.stringify(stream.badges)}`)
  // The first post carries the topic and the store refuses to delete it, so the
  // ··· menu must be absent from it. Checked here, as its author (who is also
  // the admin): a later check as somebody who cannot edit it at all would pass
  // whatever the delete rule says. `editable[0]` and `more[1]` are the controls.
  assert(stream.editable[0], 'the author cannot edit post #1, so the first-post delete rule cannot be observed here')
  assert(stream.more[1], 'post #2 has no ··· menu, so its absence on #1 would prove nothing')
  assert(!stream.more[0], 'post #1 offers a ··· delete menu, which the store would refuse')
  assert(suggested.length === 5, `suggested topics ${suggested.length}: ${JSON.stringify(suggested)}`)
  assertClean('/t/t1')
  record('/t/t1 renders the Discourse stream', {
    note: `h1 "${stream.h1}", ${stream.ids.length} posts (= store) numbered #1–#${stream.ids.length}, no ··· menu on #1 while #2 has one, breadcrumb with 0 <a href>, timeline ${stream.timeline.join('/')}, stats ${stream.stats.join(' · ')}, ${stream.participants} participants, ${suggested.length} suggested topics`,
  })
  await screenshot('reports/topic-desktop-light.png')

  // ------------------------------------------------------------------ 2 like
  const likeBefore = stream.likes[1]
  const storedLikesBefore = storedPosts[1].likeUserIds.length
  await evaluate(`document.querySelectorAll('[id^="post-p"]')[1].querySelector('button[aria-label="赞"]').click()`)
  await sleep(PERSIST_MS)
  const liked = await evaluate(STREAM)
  const likedState = await evaluate(READ_STATE)
  const likedStored = likedState.posts.find(post => post.id === stream.ids[1]).likeUserIds.length
  assert(Number(liked.likes[1] || 0) === Number(likeBefore || 0) + 1, `like count ${likeBefore} → ${liked.likes[1]}`)
  assert(liked.likeIcons[1].includes('i-carbon-favorite-filled'), `like icon stayed ${liked.likeIcons[1]}`)
  assert(likedStored === storedLikesBefore + 1, `localStorage likeUserIds ${storedLikesBefore} → ${likedStored}`)

  await evaluate(`document.querySelectorAll('[id^="post-p"]')[1].querySelector('button[aria-label="赞"]').click()`)
  await sleep(PERSIST_MS)
  const unliked = await evaluate(STREAM)
  const unlikedStored = (await evaluate(READ_STATE)).posts.find(post => post.id === stream.ids[1]).likeUserIds.length
  assert(unliked.likes[1] === likeBefore, `like count did not return: ${unliked.likes[1]}`)
  assert(unliked.likeIcons[1].includes('i-carbon-favorite') && !unliked.likeIcons[1].includes('filled'), `like icon stayed ${unliked.likeIcons[1]}`)
  assert(unlikedStored === storedLikesBefore, `localStorage likeUserIds did not return: ${unlikedStored}`)
  assertClean('like toggle')
  record('liking a post persists and toggles back', {
    note: `#2 ${likeBefore || 0} → ${liked.likes[1]} (icon -filled, localStorage ${storedLikesBefore} → ${likedStored}), second click back to ${unliked.likes[1]} / ${unlikedStored}`,
  })

  // ----------------------------------------------------------------- 3 reply
  const beforeReply = await evaluate(STREAM)
  assert(await evaluate(CLICK_TOPIC_REPLY), 'no topic-level reply button')
  await waitFor(has('.tx-drawer--visible'))
  const composerHeader = await evaluate(`${q('.tx-drawer__header')}.textContent.replace(/\\s+/g, ' ').trim()`)
  assert(composerHeader.includes(seedTopic.title), `composer header "${composerHeader}" is missing the topic title`)

  await typeInEditor('.tx-drawer', '**粗体** 和 `代码`')
  assert(await evaluate(CLICK_COMPOSER_SUBMIT), 'composer submit button is unusable')
  await waitFor(`!${has('.tx-drawer--visible')}`)
  await sleep(PERSIST_MS)

  const replied = await evaluate(STREAM)
  const newPostId = replied.ids[replied.ids.length - 1]
  const newBody = replied.bodies[replied.bodies.length - 1]
  assert(replied.ids.length === beforeReply.ids.length + 1, `post count ${beforeReply.ids.length} → ${replied.ids.length}`)
  assert(newBody.includes('<strong>') && newBody.includes('<code>'), `markdown was not rendered: ${newBody}`)
  assert(replied.toast, 'no toast after posting a reply')
  const repliesBefore = Number(beforeReply.stats[0].replace(/\D/g, ''))
  const repliesAfter = Number(replied.stats[0].replace(/\D/g, ''))
  assert(repliesAfter === repliesBefore + 1, `aside reply count ${repliesBefore} → ${repliesAfter}`)
  assertClean('reply')

  await reload()
  await waitFor(has('[id^="post-p"]'))
  const afterReload = await evaluate(STREAM)
  assert(afterReload.ids.includes(newPostId), `${newPostId} is gone after a reload`)
  assertClean('reply reload')
  record('the bottom composer posts a reply that survives a reload', {
    note: `header "${composerHeader}", ${beforeReply.ids.length} → ${replied.ids.length} posts, body carries <strong>/<code>, aside 回复 ${repliesBefore} → ${repliesAfter}, toast shown, ${newPostId} still present after reload`,
  })

  // ----------------------------------------------------------- 4 quote reply
  const targetIndex = 2
  const targetId = afterReload.ids[targetIndex]
  assert(await evaluate(`(() => {
    const post = document.querySelectorAll('[id^="post-p"]')[${targetIndex}]
    const el = [...post.querySelectorAll('button')].find(b => b.textContent.trim() === '回复')
    if (!el) return false
    el.click()
    return true
  })()`), `post #${targetIndex + 1} has no reply button`)
  await waitFor(has('.tx-drawer--visible'))
  const prefill = await evaluate(`${q('.tx-drawer .tx-markdown-editor__source')}.value`)
  assert(prefill.startsWith('> '), `composer did not prefill a quote: ${JSON.stringify(prefill.slice(0, 40))}`)
  const quoteHeader = await evaluate(`${q('.tx-drawer__header')}.textContent.replace(/\\s+/g, ' ').trim()`)
  assert(/回复 @\S+ 的 #\d+/.test(quoteHeader), `composer header "${quoteHeader}" does not name the target post`)
  await screenshot('reports/topic-composer.png')

  await typeInEditor('.tx-drawer', '同意，我补充一点。')
  assert(await evaluate(CLICK_COMPOSER_SUBMIT), 'quote submit button is unusable')
  await waitFor(`!${has('.tx-drawer--visible')}`)
  await sleep(600)

  const quoted = await evaluate(STREAM)
  const backlink = quoted.backlinks[quoted.backlinks.length - 1]
  assert(backlink && backlink.startsWith('回复 @'), `new post has no backlink: ${JSON.stringify(backlink)}`)
  const scrollBefore = await evaluate('window.scrollY')
  assert(await evaluate(`(() => {
    const posts = [...document.querySelectorAll('[id^="post-p"]')]
    const el = [...posts[posts.length - 1].querySelectorAll('button')].find(b => b.textContent.trim().startsWith('回复 @'))
    if (!el) return false
    el.click()
    return true
  })()`), 'backlink button is not clickable')
  await sleep(1200)
  const jump = await evaluate(`(() => {
    const rect = document.getElementById('post-${targetId}').getBoundingClientRect()
    const el = document.getElementById('post-${targetId}')
    return { y: window.scrollY, top: rect.top, bottom: rect.bottom, height: window.innerHeight, shadow: getComputedStyle(el).boxShadow }
  })()`)
  assert(jump.y !== scrollBefore, `the backlink did not scroll (scrollY stayed ${scrollBefore})`)
  assert(jump.bottom > 0 && jump.top < jump.height, `post ${targetId} is not in view (top ${Math.round(jump.top)}, bottom ${Math.round(jump.bottom)})`)
  assert(jump.shadow !== 'none', `the jumped-to post carries no highlight ring (box-shadow ${jump.shadow})`)
  assertClean('quote reply')
  record('a quoted reply backlinks to its target and jumps there', {
    note: `prefill ${JSON.stringify(prefill.slice(0, 24))}…, header "${quoteHeader}", backlink "${backlink}", scrollY ${Math.round(scrollBefore)} → ${Math.round(jump.y)} with ${targetId} in view and ring-highlighted`,
  })

  // ------------------------------------------------- 5 edit as the author
  await loginAs('u3', '/t/t1')
  const asMember = await evaluate(STREAM)
  assert(!asMember.editable[0], 'a member can edit the admin\'s first post')

  assert(await evaluate(CLICK_TOPIC_REPLY), 'member cannot reach the reply button')
  await waitFor(has('.tx-drawer--visible'))
  await typeInEditor('.tx-drawer', '我来试试这个编辑功能。')
  assert(await evaluate(CLICK_COMPOSER_SUBMIT), 'member submit button is unusable')
  await waitFor(`!${has('.tx-drawer--visible')}`)
  await sleep(PERSIST_MS)

  const own = await evaluate(STREAM)
  const ownIndex = own.ids.length - 1
  assert(own.editable[ownIndex], 'the author cannot edit their own new post')
  assert(await evaluate(`(() => {
    const post = document.querySelectorAll('[id^="post-p"]')[${ownIndex}]
    const el = [...post.querySelectorAll('button')].find(b => b.textContent.trim() === '编辑')
    if (!el) return false
    el.click()
    return true
  })()`), 'edit button did not open the editor')
  await waitFor(`!!document.querySelectorAll('[id^="post-p"]')[${ownIndex}].querySelector('.tx-markdown-editor__source')`)
  const editorValue = await evaluate(`document.querySelectorAll('[id^="post-p"]')[${ownIndex}].querySelector('.tx-markdown-editor__source').value`)
  assert(editorValue.includes('我来试试这个编辑功能'), `the editor opened with "${editorValue}"`)

  await typeInEditor(`[id="${`post-${own.ids[ownIndex]}`}"]`, '（已补充）')
  assert(await evaluate(clickButton('保存', `[id="post-${own.ids[ownIndex]}"]`)), 'save button is unusable')
  await sleep(PERSIST_MS)
  const edited = await evaluate(STREAM)
  assert(edited.bodies[ownIndex].includes('（已补充）'), `the body did not update: ${edited.bodies[ownIndex]}`)
  const editedMark = await evaluate(`(() => {
    const post = document.querySelectorAll('[id^="post-p"]')[${ownIndex}]
    return [...post.querySelectorAll('span')].some(s => s.textContent.trim() === '已编辑')
  })()`)
  assert(editedMark, 'the edited post is not marked 已编辑')
  assertClean('edit')
  record('an author edits their own post', {
    note: `ryan sees no 编辑 on the admin's #1, edits their own post and the body gains "（已补充）" with the 已编辑 marker`,
  })

  // --------------------------------------------------------------- 6 delete
  assert(!edited.more[0], 'post #1 offers a delete menu to a member as well')
  assert(await evaluate(`(() => {
    const post = document.querySelectorAll('[id^="post-p"]')[${ownIndex}]
    const el = post.querySelector('button[aria-label="更多操作"]')
    if (!el) return false
    el.click()
    return true
  })()`), 'own post has no ··· menu')
  await waitFor(has('.tx-dropdown__panel'))
  assert(await evaluate(clickMenuItem('删除')), 'the ··· menu has no 删除 item')
  await sleep(PERSIST_MS)
  const deleted = await evaluate(STREAM)
  assert(deleted.alerts[ownIndex] === '此帖已被删除', `deleted post shows ${JSON.stringify(deleted.alerts[ownIndex])}`)
  assertClean('delete')
  record('deleting a post soft-deletes it and post #1 has no delete item', {
    note: `#1 has no ··· menu at all; own post → "${deleted.alerts[ownIndex]}"`,
  })

  // -------------------------------------------------------- 7 closed topic
  await loginAs('u3', '/t/t42')
  const closedForMember = await evaluate(STREAM)
  assert(closedForMember.badges.includes('已关闭'), `t42 is missing the 已关闭 badge: ${JSON.stringify(closedForMember.badges)}`)
  assert(!closedForMember.topicReply, 'a member still sees the reply button on a closed topic')
  assert(closedForMember.controlAlert?.includes('此话题已关闭'), `control bar shows ${JSON.stringify(closedForMember.controlAlert)}`)

  await loginAs('u2', '/t/t42')
  const closedForStaff = await evaluate(STREAM)
  assert(closedForStaff.topicReply, 'a moderator cannot reply to a closed topic')
  assertClean('/t/t42 as moderator')
  record('a closed topic blocks members and lets staff through', {
    note: `member: no reply button, alert "${closedForMember.controlAlert}"; moderator mika: reply button back`,
  })

  // --------------------------------------------------------- 8 staff pin
  await loginAs('u2', '/t/t3')
  assert(await evaluate(`(() => { const el = ${q('button[aria-label="话题管理"]')}; if (!el) return false; el.click(); return true })()`), 'no staff topic menu')
  await waitFor(has('.tx-dropdown__panel'))
  assert(await evaluate(clickMenuItem('置顶话题')), 'no 置顶话题 item')
  await sleep(PERSIST_MS)
  const pinned = await evaluate(STREAM)
  assert(pinned.badges.includes('已置顶'), `t3 did not gain the 已置顶 badge: ${JSON.stringify(pinned.badges)}`)

  await open(`${BASE}/`)
  await waitFor(has('.tx-data-table__row'))
  const listAfterPin = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.tx-data-table__row')]
    return rows.map(r => ({
      title: r.querySelector('td .font-medium')?.textContent.trim() ?? '',
      pinned: [...r.querySelectorAll('.tx-status-badge')].some(b => b.textContent.trim() === '已置顶'),
    }))
  })()`)
  const pinnedTitle = pinned.h1
  const rowIndex = listAfterPin.findIndex(row => row.title === pinnedTitle)
  assert(rowIndex >= 0 && rowIndex < 3, `the pinned topic is at row ${rowIndex + 1} of /`)
  assert(listAfterPin.slice(0, rowIndex).every(row => row.pinned), 'an unpinned row sits above the freshly pinned topic')
  assert(listAfterPin[rowIndex].pinned, 'the row is not marked 已置顶 on /')

  await open(`${BASE}/t/t3`)
  await waitFor(has('[id^="post-p"]'))
  assert(await evaluate(`(() => { ${q('button[aria-label="话题管理"]')}.click(); return true })()`), 'no staff topic menu on the second pass')
  await waitFor(has('.tx-dropdown__panel'))
  assert(await evaluate(clickMenuItem('取消置顶')), 'no 取消置顶 item')
  await sleep(PERSIST_MS)
  const unpinned = await evaluate(STREAM)
  assert(!unpinned.badges.includes('已置顶'), 'the 已置顶 badge survived 取消置顶')
  assertClean('staff pin toggle')
  record('staff pin and unpin a topic', {
    note: `mika pins "${pinnedTitle}" → row ${rowIndex + 1} of / inside the pinned block; 取消置顶 removes the badge again`,
  })

  // ------------------------------------------------------------- 9 guest
  await open(`${BASE}/t/t1`)
  await waitFor(has('[id^="post-p"]'))
  assert(await evaluate(`(() => { ${q('button[aria-label="用户菜单"]')}.click(); return true })()`), 'no user menu')
  await waitFor(has('.tx-dropdown__panel'))
  assert(await evaluate(clickMenuItem('退出登录')), 'no 退出登录 item')
  await waitFor(`${count('header button')} > 0 && [...document.querySelectorAll('header button')].some(b => b.textContent.trim() === '登录')`)
  // The session write is debounced; navigating before it lands would restore
  // the old user from localStorage and quietly undo the logout.
  await sleep(PERSIST_MS)
  await open(`${BASE}/t/t1`)
  await waitFor(has('[id^="post-p"]'))
  const guest = await evaluate(STREAM)
  assert(guest.emptyState === '登录后参与讨论', `control bar empty state is ${JSON.stringify(guest.emptyState)}`)
  assert(!guest.topicReply, 'a guest still sees the topic reply button')
  await evaluate(`document.querySelectorAll('[id^="post-p"]')[1].querySelector('button[aria-label="赞"]').click()`)
  // TxModal's root is `.tx-modal__overlay`; `.tx-modal` is only its transition name.
  await waitFor(has('.tx-modal__overlay'))
  const afterGuestLike = await evaluate(STREAM)
  assert(afterGuestLike.likes[1] === guest.likes[1], `the guest's click changed the like count ${guest.likes[1]} → ${afterGuestLike.likes[1]}`)
  assertClean('guest')
  record('a guest is routed to the login modal instead of writing', {
    note: `控制条 "${guest.emptyState}", no topic reply button, like click opens the login modal and leaves the count at ${afterGuestLike.likes[1]}`,
  })

  // ---------------------------------------------------------------- 10 /new
  await loginAs('u1', '/new')
  assert(await evaluate(clickButton('创建话题')), 'no 创建话题 button')
  await sleep(300)
  const invalid = await evaluate(`(() => ({
    path: location.pathname,
    errors: [...document.querySelectorAll('.tx-form-item__error')].map(e => e.textContent.trim()).filter(Boolean),
  }))()`)
  assert(invalid.path === '/new', `an empty form navigated to ${invalid.path}`)
  assert(invalid.errors.length > 0, 'an empty form showed no validation message')

  await evaluate(`(() => {
    const input = ${q('.tx-form input')}
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'Phase F 冒烟：一个新话题')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  assert(await evaluate(`(() => { ${q('.tuff-select__trigger')}.click(); return true })()`), 'category select did not open')
  await waitFor(has('.tuff-select__panel'))
  assert(await evaluate(`(() => {
    const el = [...document.querySelectorAll('.tuff-select__panel .tx-card-item__title')].find(e => e.textContent.trim() === '想法')
    if (!el) return false
    el.click()
    return true
  })()`), 'category option 想法 missing')
  await sleep(200)
  await typeInEditor('.tx-form', '这是 Phase F 验证脚本创建的话题正文，用来确认表单校验与跳转。')
  await screenshot('reports/topic-new.png')
  assert(await evaluate(clickButton('创建话题')), 'submit button is unusable after filling the form')
  await waitFor(`/^\\/t\\/t\\d+$/.test(location.pathname)`, { timeoutMs: 10_000 })
  await sleep(PERSIST_MS)
  const created = await evaluate(STREAM)
  assert(created.h1 === 'Phase F 冒烟：一个新话题', `created topic title "${created.h1}"`)
  assertClean('/new')

  await open(`${BASE}/?mode=new`)
  await waitFor(has('.tx-data-table__row'))
  const newest = await evaluate(`(() => [...document.querySelectorAll('.tx-data-table__row')].map(r => ({
    title: r.querySelector('td .font-medium')?.textContent.trim() ?? '',
    pinned: [...r.querySelectorAll('.tx-status-badge')].some(b => b.textContent.trim() === '已置顶'),
  })))()`)
  const newestIndex = newest.findIndex(row => row.title === 'Phase F 冒烟：一个新话题')
  assert(newestIndex >= 0, '/?mode=new does not list the new topic')
  assert(newest.slice(0, newestIndex).every(row => row.pinned), `the new topic is at row ${newestIndex + 1} behind an unpinned row`)
  assertClean('/?mode=new')
  record('/new validates, creates and lands on the topic', {
    note: `empty submit stays on /new with ${invalid.errors.length} message(s) (${JSON.stringify(invalid.errors[0])}); filled submit → ${created.path} "${created.h1}", first unpinned row of /?mode=new`,
  })

  // ------------------------------------------------------------------ 11 404
  await open(`${BASE}/t/does-not-exist`)
  await waitFor(has('.tx-empty-state'))
  const notFound = await evaluate(`(() => ({
    title: ${q('.tx-empty-state__title')}?.textContent.trim() ?? null,
    description: ${q('.tx-empty-state__description')}?.textContent.trim() ?? null,
    header: !!document.querySelector('header'),
    posts: ${count('[id^="post-p"]')},
  }))()`)
  assert(notFound.title === '哎呀，这个页面不存在', `404 title "${notFound.title}"`)
  assert(notFound.header, 'the 404 page lost the app shell')
  assert(notFound.posts === 0, 'the 404 page still rendered posts')
  assertClean('/t/does-not-exist')
  record('an unknown topic id shows the error page inside the shell', {
    note: `"${notFound.title}" / "${notFound.description}", header kept, console clean`,
  })

  // ----------------------------------------------------------------- 12 dark
  await open(`${BASE}/t/t1`)
  await waitFor(has('[id^="post-p"]'))
  await evaluate(`(() => { const b = [...document.querySelectorAll('header button')].find(e => e.querySelector('.i-carbon-moon, .i-carbon-sun')); b.click(); return true })()`)
  await waitFor(`document.documentElement.classList.contains('dark')`)
  await sleep(400)
  assertClean('/t/t1 dark')
  record('the topic page follows the dark theme', { note: 'html.dark with the stream still rendered' })
  await screenshot('reports/topic-desktop-dark.png')
  await evaluate(`(() => { const b = [...document.querySelectorAll('header button')].find(e => e.querySelector('.i-carbon-moon, .i-carbon-sun')); b.click(); return true })()`)
  await waitFor(`!document.documentElement.classList.contains('dark')`)

  // ---------------------------------------------------------------- 13 390px
  await emulate({ width: 390, height: 844, mobile: true })
  await open(`${BASE}/t/t1`)
  await waitFor(has('[id^="post-p"]'))
  await sleep(400)
  const narrow = await evaluate(`(() => {
    const posts = [...document.querySelectorAll('[id^="post-p"]')]
    // The control row is the flex that holds the copy button's group; a
    // soft-deleted post renders its alert instead and has no row at all.
    const rows = posts.map(p => p.querySelector('.tx-copy-button')?.closest('.tx-flex')?.parentElement ?? null).filter(Boolean)
    return {
      timeline: !!document.querySelector('.tx-timeline'),
      posts: posts.length,
      deleted: posts.filter(p => !!p.querySelector('.tx-alert')).length,
      rows: rows.length,
      wrongShape: rows.filter(r => !r.classList.contains('tx-flex')).length,
      clipped: rows.filter(r => r.scrollWidth > r.clientWidth + 1).length,
      overflowing: posts.filter(p => p.scrollWidth > p.clientWidth + 1).length,
    }
  })()`)
  assert(!narrow.timeline, 'the aside timeline still renders at 390px')
  assert(narrow.wrongShape === 0, `${narrow.wrongShape} resolved control rows are not a flex container`)
  assert(narrow.rows === narrow.posts - narrow.deleted, `found ${narrow.rows} control rows for ${narrow.posts} posts (${narrow.deleted} deleted)`)
  assert(narrow.clipped === 0, `${narrow.clipped} control rows are clipped at 390px`)
  assert(narrow.overflowing === 0, `${narrow.overflowing} post cards overflow at 390px`)

  assert(await evaluate(CLICK_TOPIC_REPLY), 'no reply button at 390px')
  await waitFor(has('.tx-drawer--visible'))
  // The panel slides up over ~300 ms; measuring mid-animation reports the
  // footer below the fold no matter where it ends up.
  await sleep(600)
  await typeInEditor('.tx-drawer', '手机上也能回复。')
  // "Reachable" means the button is the topmost thing at its own centre, not
  // merely that its rect has coordinates: actions rendered inside the drawer's
  // scrolling body are clipped out of sight while their rect still looks fine.
  const composerUsable = await evaluate(`(() => {
    const submit = [...document.querySelectorAll('.tx-drawer button')].find(b => b.textContent.trim() === '回复')
    if (!submit) return { missing: true }
    const rect = submit.getBoundingClientRect()
    const hit = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2))
    const editor = ${q('.tx-drawer .tx-markdown-editor__source')}
    return {
      disabled: submit.disabled,
      inViewport: rect.width > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight,
      hittable: !!hit && submit.contains(hit),
      value: editor.value,
    }
  })()`)
  assert(!composerUsable.missing && !composerUsable.disabled && composerUsable.inViewport && composerUsable.hittable, `the composer submit is unreachable at 390px: ${JSON.stringify(composerUsable)}`)
  assert(composerUsable.value.includes('手机上也能回复'), 'typing into the mobile composer did not register')
  await screenshot('reports/topic-mobile.png')
  await evaluate(`(() => { const el = [...document.querySelectorAll('.tx-drawer__footer button')].find(b => b.textContent.trim() === '取消'); el.click(); return true })()`)
  assertClean('/t/t1 @390')
  record('the topic page stacks and stays usable at 390px', {
    note: `no aside timeline, ${narrow.posts} posts (${narrow.deleted} deleted) with ${narrow.rows} control rows and 0 clipped, composer drawer opens and accepts text`,
  })

  mkdirSync('reports', { recursive: true })
  writeFileSync('reports/topic-page-verify.json', JSON.stringify({ base: BASE, at: new Date().toISOString(), steps }, null, 2))
  console.log(`\nall ${steps.length} steps passed`)
}
catch (error) {
  console.error('\nFAILED:', error.message)
  console.error('console so far:', JSON.stringify(chrome.console().slice(-20), null, 2))
  await screenshot('reports/topic-failure.png').catch(() => {})
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
