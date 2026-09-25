import type { ForumCapability, Tone, UserTitle } from '../app/data/titles'
import type { Post, Topic, User } from '../app/data/types'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import { can, hasForumCapability, isStaff } from '../app/data/permissions'
import { createSeed } from '../app/data/seed'
import {
  applyPublicOrg,
  CREW,
  DARK_TONE_SHARE,
  DEFAULT_ORG,
  DEPARTMENT_ID_PATTERN,
  DEPARTMENTS,
  FORUM_CAPABILITIES,
  ICON_CLASSES,
  isUserTitle,
  TITLE_FORUM,
  TITLES,
  titleColor,
  titleForumCapabilities,
  titleIcon,
  titleLabel,
  titleRank,
  titleTag,
  titleTone,
  TONES,
} from '../app/data/titles'

// Relative imports on purpose (like the other integration tests): the `~`
// alias only exists inside vitest and the tests tsconfig, and an editor that
// opens this file on its own would otherwise see every import as `any`.

const require = createRequire(import.meta.url)
const carbon = require('@iconify-json/carbon/icons.json') as { icons: Record<string, unknown>, aliases?: Record<string, unknown> }
const tuffexBaseCss = readFileSync(require.resolve('@talex-touch/tuffex/base.css'), 'utf8')

function carbonExists(iconClass: string): boolean {
  const name = iconClass.replace(/^i-carbon-/, '')
  return iconClass.startsWith('i-carbon-') && (name in carbon.icons || name in (carbon.aliases ?? {}))
}

/*
 * The server catalogue's defaults, `app/server/src/lib/roles.ts`, copied by
 * hand and written out independently of `app/data/titles.ts`. The server
 * stores bare Carbon names; the forum prefixes `i-carbon-`. Title packs
 * (`ROLE_BASE`) and departments list only the `forum.*` part. When the server
 * file changes, this block changes with it and the forum copy has to follow.
 */
const SERVER_TONES: Record<Tone, string> = {
  amber: '#855700',
  cobalt: '#3346C8',
  violet: '#6E44C9',
  jade: '#18694A',
  sky: '#08609A',
  coral: '#A63F16',
  rose: '#B4235A',
  slate: '#5B6475',
}

const SERVER_TITLES = {
  admin: { label: '提督', tag: 'ADMIRAL', icon: 'user-admin', tone: 'violet', rank: 0, description: 'GitHub 组织的所有者，拥有全部权限，任命舰长' },
  captain: { label: '舰长', tag: 'CAPTAIN', icon: 'star-filled', tone: 'amber', rank: 1, description: '带领全班，权限仅次于提督' },
  head: { label: '队长', tag: 'LEADER', icon: 'badge', tone: 'cobalt', rank: 2, description: '负责一个部门的日常事务' },
  member: { label: '舰员', tag: 'CREW', icon: 'code', tone: 'sky', rank: 5, description: '在读成员；加入 GitHub 组织后自动获得' },
  alumni: { label: '领航员', tag: 'NAVIGATOR', icon: 'compass', tone: 'jade', rank: 4, description: '已毕业的学长学姐' },
  guest: { label: '乘客', tag: 'PASSENGER', icon: 'user', tone: 'slate', rank: 9, description: '没登录的人，只能看帖子' },
} as const

/** `CREW_TITLE`; its `CREW` tag is the member title's tag, which crew wears. */
const SERVER_CREW = { tone: 'slate', rank: 3 } as const

const SERVER_FORUM_CAPABILITIES = ['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate', 'forum.category.manage', 'forum.badge.assign']

/** The `forum.*` part of `ROLE_BASE`: the 提督 and the 舰长 hold everything, the rest nothing. */
const SERVER_TITLE_FORUM = {
  admin: SERVER_FORUM_CAPABILITIES,
  captain: SERVER_FORUM_CAPABILITIES,
  head: [],
  member: [],
  alumni: [],
  guest: [],
}

const SERVER_DEPARTMENT_ICONS = [
  'star-filled',
  'badge',
  'code',
  'compass',
  'user',
  'user-follow',
  'terminal',
  'forum',
  'application',
  'bullhorn',
  'education',
  'idea',
  'trophy',
  'user-favorite',
  'chart-network',
  'logo-github',
  'book',
  'user-admin',
]

const SERVER_DEPARTMENTS = [
  { id: 'recruitment', name: '招新部', tag: 'RECRUIT', icon: 'user-follow', tone: 'coral', headForum: [], crewForum: [] },
  { id: 'tech', name: '技术部', tag: 'TECH', icon: 'terminal', tone: 'jade', headForum: [], crewForum: [] },
  {
    id: 'community',
    name: '社区部',
    tag: 'COMMUNITY',
    icon: 'forum',
    tone: 'rose',
    headForum: ['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate', 'forum.category.manage', 'forum.badge.assign'],
    crewForum: ['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate'],
  },
  { id: 'projects', name: '项目部', tag: 'PROJECTS', icon: 'application', tone: 'cobalt', headForum: ['forum.topic.pin'], crewForum: [] },
]

const SERVER_DEPARTMENT_ID_PATTERN = '^[a-z][a-z0-9-]{1,31}$'

// ------------------------------------------------------------------ colour

type Rgb = [number, number, number]

function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match)
    throw new Error(`not a #rrggbb colour: ${hex}`)
  const digits = match[1] as string
  return [0, 2, 4].map(i => Number.parseInt(digits.slice(i, i + 2), 16)) as Rgb
}

/** `color-mix(in srgb, a share%, b)` for opaque colours. */
function mix(a: Rgb, b: Rgb, share: number): Rgb {
  return a.map((channel, i) => channel * share + (b[i] as number) * (1 - share)) as Rgb
}

/** WCAG 2.x contrast ratio. */
function contrast(a: Rgb, b: Rgb): number {
  const luminance = (rgb: Rgb): number => {
    const [r, g, bl] = rgb.map((value) => {
      const c = value / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }) as Rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** The custom properties declared by the first `base.css` rule whose selector list starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = tuffexBaseCss.indexOf(`${selector}{`)
  if (start === -1)
    throw new Error(`no ${selector} rule in @talex-touch/tuffex/base.css`)
  const body = tuffexBaseCss.slice(start + selector.length + 1, tuffexBaseCss.indexOf('}', start))
  const found: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/(--tx-[\w-]+):\s*([^;]+)/g))
    found[name as string] = (value as string).trim()
  return found
}

/** A TxTag in the title's colour: text on the surface and on its own 12% outline fill. */
function worstTagContrast(text: Rgb, surfaces: Rgb[]): number {
  return Math.min(...surfaces.flatMap(surface => [contrast(text, surface), contrast(text, mix(text, surface, 0.12))]))
}

describe('title catalogue', () => {
  it('matches the server catalogue: tones, titles, crew, departments, icons and forum capabilities', () => {
    expect(TONES).toEqual(SERVER_TONES)
    for (const [id, spec] of Object.entries(SERVER_TITLES)) {
      const title = TITLES[id as keyof typeof SERVER_TITLES]
      expect(title, id).toEqual({ id, ...spec, icon: `i-carbon-${spec.icon}` })
    }
    expect(Object.keys(TITLES).sort()).toEqual(Object.keys(SERVER_TITLES).sort())
    expect(CREW).toEqual(SERVER_CREW)
    expect(DEPARTMENTS).toEqual(SERVER_DEPARTMENTS.map(department => ({ ...department, icon: `i-carbon-${department.icon}` })))
    expect([...FORUM_CAPABILITIES]).toEqual(SERVER_FORUM_CAPABILITIES)
    expect(Object.fromEntries(Object.entries(TITLE_FORUM).map(([id, pack]) => [id, [...pack]]))).toEqual(SERVER_TITLE_FORUM)
    expect(Object.keys(ICON_CLASSES)).toEqual(SERVER_DEPARTMENT_ICONS)
    for (const [name, iconClass] of Object.entries(ICON_CLASSES))
      expect(iconClass, name).toBe(`i-carbon-${name}`)
    expect(DEPARTMENT_ID_PATTERN).toBe(SERVER_DEPARTMENT_ID_PATTERN)
  })

  it('uses only real Carbon icons, each of them one the server may send', () => {
    const icons = [...Object.values(TITLES).map(title => title.icon), ...DEPARTMENTS.map(department => department.icon)]
    const sendable = new Set<string>(Object.values(ICON_CLASSES))
    for (const icon of icons)
      expect(sendable.has(icon), icon).toBe(true)
    for (const icon of sendable)
      expect(carbonExists(icon), icon).toBe(true)
    expect(carbonExists('i-carbon-crown')).toBe(false)
  })

  it('keeps every tone at 5:1 on white and on its own 12% tint (light theme)', () => {
    for (const [tone, hex] of Object.entries(TONES))
      expect(worstTagContrast(parseHex(hex), [parseHex('#ffffff')]), tone).toBeGreaterThanOrEqual(5)
  })

  it('keeps every dark-theme colour at 5:1 on Tuffex\'s dark surfaces, normal and high contrast', () => {
    const themes = [
      tokens('[data-theme=dark],.dark'),
      tokens('html[data-theme=dark]:not([data-tx-contrast=normal]),html.dark:not([data-tx-contrast=normal])'),
    ]
    for (const theme of themes) {
      const ink = parseHex(theme['--tx-text-color-primary'] as string)
      const surfaces = ['--tx-bg-color', '--tx-bg-color-page', '--tx-bg-color-overlay', '--tx-fill-color-light']
        .map(name => parseHex(theme[name] as string))
      for (const [tone, hex] of Object.entries(TONES)) {
        const text = mix(parseHex(hex), ink, DARK_TONE_SHARE / 100)
        expect(worstTagContrast(text, surfaces), `${tone} over ${theme['--tx-bg-color']}`).toBeGreaterThanOrEqual(5)
      }
    }
  })
})

describe('title helpers', () => {
  it('labels heads and crew by department and falls back for unknown ones', () => {
    expect(titleLabel({ id: 'admin' })).toBe('提督')
    expect(titleLabel({ id: 'captain' })).toBe('舰长')
    expect(titleLabel({ id: 'head', department: 'recruitment' })).toBe('招新部 · 队长')
    expect(titleLabel({ id: 'member', department: 'tech' })).toBe('技术部 · 舰员')
    expect(titleLabel({ id: 'alumni' })).toBe('领航员')
    expect(titleLabel({ id: 'member' })).toBe('舰员')
    expect(titleLabel({ id: 'head', department: 'publicity' })).toBe('队长')
    expect(titleLabel({ id: 'head' })).toBe('队长')
    expect(titleLabel({ id: 'member', department: 'publicity' })).toBe('部门舰员')
  })

  it('gives heads their department look, crew the department icon in the crew tone', () => {
    expect(titleIcon({ id: 'head', department: 'community' })).toBe('i-carbon-forum')
    expect(titleTone({ id: 'head', department: 'community' })).toBe('rose')
    expect(titleIcon({ id: 'head', department: 'publicity' })).toBe('i-carbon-badge')
    expect(titleTone({ id: 'head', department: 'publicity' })).toBe('cobalt')
    expect(titleIcon({ id: 'member', department: 'projects' })).toBe('i-carbon-application')
    expect(titleTone({ id: 'member', department: 'projects' })).toBe('slate')
    expect(titleTag({ id: 'member', department: 'projects' })).toBe('CREW')
    expect(titleTag({ id: 'member' })).toBe('CREW')
    expect(titleTone({ id: 'member' })).toBe('sky')
    expect(titleIcon({ id: 'admin' })).toBe('i-carbon-user-admin')
    expect(titleTone({ id: 'admin' })).toBe('violet')
    expect(titleTag({ id: 'admin' })).toBe('ADMIRAL')
    expect(titleTone({ id: 'alumni' })).toBe('jade')
  })

  it('colours with the catalogue hex, lifted toward Tuffex ink under the dark theme', () => {
    expect(titleColor({ id: 'captain' })).toBe(TONES.amber)
    expect(titleColor({ id: 'head', department: 'tech' })).toBe(TONES.jade)
    expect(titleColor({ id: 'captain' }, true)).toBe(`color-mix(in srgb, ${TONES.amber} ${DARK_TONE_SHARE}%, var(--tx-text-color-primary))`)
  })

  it('ranks admin, captain, head, crew, alumni, member, then no title', () => {
    const order: (UserTitle | undefined)[] = [
      { id: 'member' },
      undefined,
      { id: 'alumni' },
      { id: 'member', department: 'tech' },
      { id: 'head', department: 'tech' },
      { id: 'captain' },
      { id: 'admin' },
    ]
    expect(order.map(titleRank)).toEqual([5, 9, 4, 3, 2, 1, 0])
  })

  it('accepts only storable titles', () => {
    expect(isUserTitle({ id: 'admin' })).toBe(true)
    expect(isUserTitle({ id: 'captain' })).toBe(true)
    expect(isUserTitle({ id: 'member', department: 'tech' })).toBe(true)
    expect(isUserTitle({ id: 'head', department: 'publicity' })).toBe(true)
    for (const bad of [null, 'captain', [], {}, { id: 'guest' }, { id: 'king' }, { id: 'head', department: 'Tech' }, { id: 'head', department: 'x' }, { id: 'head', department: 3 }])
      expect(isUserTitle(bad), JSON.stringify(bad)).toBe(false)
  })
})

/*
 * `GET /api/public/org` as `app/server/src/routes/portal/org.ts` answers it on
 * a fresh database: the seed defaults, bare icon names, the palette as hexes.
 */
interface PublicTitle { id: string, label: string, tag: string, icon: string, tone: string, description: string, rank: number }
interface PublicDepartment { id: string, name: string, tag: string, icon: string, tone: string, description: string }
interface PublicOrg { tones: Record<string, string>, titles: PublicTitle[], departments: PublicDepartment[] }

function publicOrg(): PublicOrg {
  return {
    tones: { ...SERVER_TONES },
    titles: Object.entries(SERVER_TITLES).map(([id, { label, tag, icon, tone, description, rank }]) => ({ id, label, tag, icon, tone, description, rank })),
    departments: SERVER_DEPARTMENTS.map(({ id, name, tag, icon, tone }) => ({ id, name, tag, icon, tone, description: `${name}的说明` })),
  }
}

function withTitle(id: string, patch: Partial<Record<keyof PublicTitle, unknown>>): PublicOrg {
  const org = publicOrg()
  return { ...org, titles: org.titles.map(title => (title.id === id ? { ...title, ...patch } as PublicTitle : title)) }
}

function withDepartments(...departments: Partial<Record<keyof PublicDepartment, unknown>>[]): PublicOrg {
  const org = publicOrg()
  return { ...org, departments: [...org.departments, ...departments as PublicDepartment[]] }
}

describe('the public org look', () => {
  const samples: UserTitle[] = [
    { id: 'admin' },
    { id: 'captain' },
    { id: 'head', department: 'community' },
    { id: 'head', department: 'publicity' },
    { id: 'member', department: 'tech' },
    { id: 'member' },
    { id: 'alumni' },
  ]
  const look = (org: typeof DEFAULT_ORG) => samples.map(title => [titleLabel(title, org), titleTag(title, org), titleIcon(title, org), titleTone(title, org)])

  it('draws the defaults when the server repeats them', () => {
    const org = applyPublicOrg(publicOrg())
    expect(org).not.toBe(DEFAULT_ORG)
    expect(look(org)).toEqual(look(DEFAULT_ORG))
    expect(org.titles.admin.description).toBe(SERVER_TITLES.admin.description)
  })

  it('shows a renamed 舰长 and leaves the other titles and the defaults alone', () => {
    const org = applyPublicOrg(withTitle('captain', { label: '船长', tag: 'SKIPPER', icon: 'trophy', tone: 'rose', description: '新的说明' }))
    expect(titleLabel({ id: 'captain' }, org)).toBe('船长')
    expect(titleTag({ id: 'captain' }, org)).toBe('SKIPPER')
    expect(titleIcon({ id: 'captain' }, org)).toBe('i-carbon-trophy')
    expect(titleColor({ id: 'captain' }, false, org)).toBe(TONES.rose)
    expect(org.titles.captain.description).toBe('新的说明')
    expect(titleLabel({ id: 'admin' }, org)).toBe('提督')
    expect(titleLabel({ id: 'captain' })).toBe('舰长')
    expect(TITLES.captain.label).toBe('舰长')
  })

  it('builds head and crew labels from the renamed titles; crew wears the member tag', () => {
    const renamed = publicOrg()
    renamed.titles = renamed.titles.map((title) => {
      if (title.id === 'head')
        return { ...title, label: '组长' }
      if (title.id === 'member')
        return { ...title, label: '船员', tag: 'SAILOR' }
      return title
    })
    const org = applyPublicOrg(renamed)
    expect(titleLabel({ id: 'head', department: 'community' }, org)).toBe('社区部 · 组长')
    expect(titleLabel({ id: 'head', department: 'publicity' }, org)).toBe('组长')
    expect(titleLabel({ id: 'member', department: 'tech' }, org)).toBe('技术部 · 船员')
    expect(titleLabel({ id: 'member', department: 'publicity' }, org)).toBe('部门船员')
    expect(titleTag({ id: 'member', department: 'tech' }, org)).toBe('SAILOR')
    expect(titleTone({ id: 'member', department: 'tech' }, org)).toBe(CREW.tone)
  })

  it('shows a department the forum did not know with its own name, icon and tone', () => {
    const org = applyPublicOrg(withDepartments({ id: 'publicity', name: '宣传部', tag: 'PR', icon: 'bullhorn', tone: 'sky', description: '' }))
    expect(titleLabel({ id: 'head', department: 'publicity' }, org)).toBe('宣传部 · 队长')
    expect(titleIcon({ id: 'head', department: 'publicity' }, org)).toBe('i-carbon-bullhorn')
    expect(titleTone({ id: 'head', department: 'publicity' }, org)).toBe('sky')
    expect(titleLabel({ id: 'member', department: 'publicity' }, org)).toBe('宣传部 · 舰员')
    expect(titleIcon({ id: 'member', department: 'publicity' }, org)).toBe('i-carbon-bullhorn')
    expect(titleTone({ id: 'member', department: 'publicity' }, org)).toBe(CREW.tone)
    // Display only: a department the forum did not ship with still carries no forum capability.
    expect([...titleForumCapabilities({ id: 'head', department: 'publicity' })]).toEqual([])
  })

  it('shows renamed departments and drops archived ones', () => {
    const payload = publicOrg()
    payload.departments = payload.departments
      .filter(department => department.id !== 'recruitment')
      .map(department => (department.id === 'tech' ? { ...department, name: '研发部', icon: 'code', tone: 'violet' } : department))
    const org = applyPublicOrg(payload)
    expect(titleLabel({ id: 'head', department: 'tech' }, org)).toBe('研发部 · 队长')
    expect(titleIcon({ id: 'head', department: 'tech' }, org)).toBe('i-carbon-code')
    expect(titleTone({ id: 'head', department: 'tech' }, org)).toBe('violet')
    expect(titleLabel({ id: 'head', department: 'recruitment' }, org)).toBe('队长')
    expect(titleIcon({ id: 'head', department: 'recruitment' }, org)).toBe('i-carbon-badge')
  })

  it('falls back to the default icon and tone for names it cannot draw', () => {
    const org = applyPublicOrg({
      ...withTitle('captain', { icon: 'crown', tone: 'gold' }),
      departments: [
        { id: 'community', name: '社区部', tag: 'COMMUNITY', icon: 'i-carbon-trophy', tone: TONES.jade },
        { id: 'publicity', name: '宣传部', tag: 'PR', icon: 'constructor', tone: 'toString' },
      ],
    })
    expect(titleIcon({ id: 'captain' }, org)).toBe('i-carbon-star-filled')
    expect(titleTone({ id: 'captain' }, org)).toBe('amber')
    expect(titleIcon({ id: 'head', department: 'community' }, org)).toBe('i-carbon-forum')
    expect(titleTone({ id: 'head', department: 'community' }, org)).toBe('rose')
    expect(titleIcon({ id: 'head', department: 'publicity' }, org)).toBe('i-carbon-badge')
    expect(titleTone({ id: 'head', department: 'publicity' }, org)).toBe('cobalt')
    expect(titleLabel({ id: 'head', department: 'publicity' }, org)).toBe('宣传部 · 队长')
  })

  it('takes colours from the local palette and ignores titles it does not know', () => {
    const payload = withTitle('captain', { rank: 99 })
    const org = applyPublicOrg({
      ...payload,
      tones: { ...payload.tones, amber: '#000000' },
      titles: [...payload.titles, { id: 'pilot', label: '驾驶员', tag: 'PILOT', icon: 'user', tone: 'sky', description: '' }],
    })
    expect(titleColor({ id: 'captain' }, false, org)).toBe(TONES.amber)
    expect(Object.keys(org.titles).sort()).toEqual(Object.keys(TITLES).sort())
    expect(titleRank({ id: 'captain' })).toBe(1)
  })

  it('changes nothing when the answer is malformed', () => {
    const malformed: unknown[] = [
      undefined,
      null,
      'org',
      [],
      {},
      { titles: [] },
      { departments: [] },
      { titles: {}, departments: [] },
      { titles: [], departments: null },
      { titles: ['captain'], departments: [] },
      withTitle('captain', { label: '' }),
      withTitle('captain', { label: 42 }),
      withTitle('captain', { tag: undefined }),
      withTitle('captain', { icon: null }),
      withTitle('captain', { tone: 3 }),
      withTitle('captain', { description: 7 }),
      withTitle('captain', { id: 1 }),
      withDepartments({ id: 'Bad Id', name: '坏部门', tag: 'BAD', icon: 'code', tone: 'sky' }),
      withDepartments({ id: 'publicity', tag: 'PR', icon: 'bullhorn', tone: 'sky' }),
      withDepartments({ id: 'publicity', name: '宣传部', tag: 'PR', icon: 'bullhorn' }),
      withDepartments({ id: 'tech', name: '技术部', tag: 'TECH', icon: 'terminal', tone: 'jade' }),
      { ...publicOrg(), departments: ['tech'] },
    ]
    for (const payload of malformed)
      expect(applyPublicOrg(payload), JSON.stringify(payload)).toBe(DEFAULT_ORG)
    const renamed = applyPublicOrg(withTitle('captain', { label: '船长' }))
    expect(applyPublicOrg(null, renamed)).toBe(renamed)
  })

  it('redraws what is already on screen when the look is replaced', () => {
    const org = ref(DEFAULT_ORG)
    const label = computed(() => titleLabel({ id: 'captain' }, org.value))
    const icon = computed(() => titleIcon({ id: 'head', department: 'publicity' }, org.value))
    expect([label.value, icon.value]).toEqual(['舰长', 'i-carbon-badge'])
    org.value = applyPublicOrg({
      ...withTitle('captain', { label: '船长' }),
      departments: [{ id: 'publicity', name: '宣传部', tag: 'PR', icon: 'bullhorn', tone: 'sky' }],
    })
    expect([label.value, icon.value]).toEqual(['船长', 'i-carbon-bullhorn'])
  })
})

describe('title to forum capabilities', () => {
  const caps = (title: UserTitle | undefined): ForumCapability[] => [...titleForumCapabilities(title)].sort()

  it('follows the server: admin and captain everything, heads and crew their department\'s forum pack', () => {
    expect(caps({ id: 'admin' })).toEqual([...FORUM_CAPABILITIES].sort())
    expect(caps({ id: 'captain' })).toEqual([...FORUM_CAPABILITIES].sort())
    expect(caps({ id: 'head', department: 'community' })).toEqual([...FORUM_CAPABILITIES].sort())
    expect(caps({ id: 'member', department: 'community' })).toEqual(['forum.post.moderate', 'forum.topic.close', 'forum.topic.pin'])
    expect(caps({ id: 'head', department: 'projects' })).toEqual(['forum.topic.pin'])
  })

  it('gives nothing to other departments, unknown departments, alumni, members or no title', () => {
    for (const title of [
      { id: 'head', department: 'recruitment' },
      { id: 'head', department: 'tech' },
      { id: 'member', department: 'tech' },
      { id: 'member', department: 'projects' },
      { id: 'head', department: 'publicity' },
      { id: 'member', department: 'publicity' },
      { id: 'head' },
      { id: 'alumni' },
      { id: 'member' },
      undefined,
    ] as (UserTitle | undefined)[])
      expect(caps(title), JSON.stringify(title)).toEqual([])
  })
})

describe('titles to forum permissions', () => {
  const state = createSeed(1_780_000_000_000)
  const plain = state.users.find((user: User) => user.username === 'bruce') as User
  // Topic and post belong to somebody else, so only a capability can allow acting on them.
  const author = state.users.find((user: User) => user.username === 'ryan') as User
  const as = (title: UserTitle): User => ({ ...plain, role: 'member', title })
  const topic: Topic = { ...(state.topics.find((candidate: Topic) => !candidate.closed) as Topic), authorId: author.id }
  const closed: Topic = { ...topic, closed: true }
  const post: Post = { id: 'px', topicId: topic.id, authorId: author.id, content: 'hi', createdAt: 1, likeUserIds: [] }

  it('makes every holder of forum.post.moderate staff, whatever their role', () => {
    for (const title of [{ id: 'admin' }, { id: 'captain' }, { id: 'head', department: 'community' }, { id: 'member', department: 'community' }] as UserTitle[]) {
      const user = as(title)
      expect(isStaff(user), JSON.stringify(title)).toBe(true)
      for (const action of ['editPost', 'deletePost'] as const)
        expect(can(user, action, { post }), `${action} ${JSON.stringify(title)}`).toBe(true)
      expect(can(user, 'reply', { topic: closed }), JSON.stringify(title)).toBe(true)
      expect(can(user, 'pinTopic', { topic })).toBe(true)
      expect(can(user, 'closeTopic', { topic })).toBe(true)
    }
  })

  it('lets the 项目部 head pin and nothing else', () => {
    const head = as({ id: 'head', department: 'projects' })
    expect(isStaff(head)).toBe(false)
    expect(can(head, 'pinTopic', { topic })).toBe(true)
    expect(can(head, 'closeTopic', { topic })).toBe(false)
    expect(can(head, 'editPost', { post })).toBe(false)
    expect(can(head, 'reply', { topic: closed })).toBe(false)
  })

  it('gives no forum power to other titles or to no title', () => {
    for (const title of [
      { id: 'head', department: 'recruitment' },
      { id: 'head', department: 'tech' },
      { id: 'head', department: 'publicity' },
      { id: 'member', department: 'tech' },
      { id: 'alumni' },
      { id: 'member' },
    ] as UserTitle[]) {
      const user = as(title)
      expect(isStaff(user), JSON.stringify(title)).toBe(false)
      for (const capability of FORUM_CAPABILITIES)
        expect(hasForumCapability(user, capability), `${capability} ${JSON.stringify(title)}`).toBe(false)
    }
    expect(isStaff(plain)).toBe(false)
  })

  it('keeps admins and moderators at every capability, with or without a title', () => {
    const admin = { ...plain, role: 'admin' as const }
    const moderator = { ...plain, role: 'moderator' as const, title: { id: 'alumni' as const } }
    for (const capability of FORUM_CAPABILITIES) {
      expect(hasForumCapability(admin, capability)).toBe(true)
      expect(hasForumCapability(moderator, capability)).toBe(true)
    }
    expect(hasForumCapability(null, 'forum.topic.pin')).toBe(false)
  })
})

describe('seeded titles', () => {
  const state = createSeed(1_780_000_000_000)
  const byName = (username: string): User | undefined => state.users.find((user: User) => user.username === username)

  it('assigns the demo titles and leaves every role alone', () => {
    expect(byName('talex')?.title).toEqual({ id: 'captain' })
    expect(byName('mika')?.title).toEqual({ id: 'head', department: 'community' })
    expect(byName('yuki')?.title).toEqual({ id: 'head', department: 'tech' })
    expect(byName('kai')?.title).toEqual({ id: 'member', department: 'tech' })
    expect(byName('lin')?.title).toEqual({ id: 'alumni' })
    for (const username of ['ryan', 'xiaoyu', 'leon', 'ayako', 'chen', 'nova'])
      expect(byName(username)?.title, username).toEqual({ id: 'member' })
    expect(byName('bruce')?.title).toBeUndefined()
    expect(state.users.map((user: User) => [user.username, user.role])).toEqual([
      ['talex', 'admin'],
      ['mika', 'moderator'],
      ['ryan', 'member'],
      ['xiaoyu', 'member'],
      ['leon', 'member'],
      ['ayako', 'member'],
      ['chen', 'member'],
      ['nova', 'member'],
      ['kai', 'member'],
      ['lin', 'member'],
      ['yuki', 'member'],
      ['bruce', 'member'],
    ])
  })

  it('keeps the upstream suites\' plain members and every seeded non-staff title off staff', () => {
    const [author, other] = state.users.filter((user: User) => user.role === 'member')
    expect([author?.username, other?.username]).toEqual(['ryan', 'xiaoyu'])
    for (const username of ['ryan', 'xiaoyu', 'yuki', 'kai', 'lin', 'bruce'])
      expect(isStaff(byName(username)), username).toBe(false)
  })

  it('gives every seeded title a valid, storable shape and copies it per user', () => {
    for (const user of state.users) {
      if (user.title)
        expect(isUserTitle(user.title), user.username).toBe(true)
    }
    const again = createSeed(1_780_000_000_000)
    const first = again.users[0]
    if (first?.title)
      first.title.id = 'alumni'
    expect(createSeed(1_780_000_000_000).users[0]?.title).toEqual({ id: 'captain' })
  })
})
