import type { ForumCapability, Tone, UserTitle } from '../app/data/titles'
import type { Post, Topic, User } from '../app/data/types'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { can, hasForumCapability, isStaff } from '../app/data/permissions'
import { createSeed } from '../app/data/seed'
import {
  CREW,
  DARK_TONE_SHARE,
  DEPARTMENT_ID_PATTERN,
  DEPARTMENTS,
  FORUM_CAPABILITIES,
  isUserTitle,
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
 * The server catalogue, `app/server/src/lib/roles.ts`, copied by hand and
 * written out independently of `app/data/titles.ts`. The server stores bare
 * Carbon names; the forum prefixes `i-carbon-`. Departments list only the
 * `forum.*` part of the head and crew packs. When the server file changes,
 * this block changes with it and the forum copy has to follow.
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
  captain: { label: '班长', tag: 'CAPTAIN', icon: 'star-filled', tone: 'amber', rank: 0 },
  head: { label: '部门负责人', tag: 'HEAD', icon: 'badge', tone: 'cobalt', rank: 1 },
  member: { label: '极客班成员', tag: 'MEMBER', icon: 'code', tone: 'sky', rank: 4 },
  alumni: { label: '领航员', tag: 'NAVIGATOR', icon: 'compass', tone: 'violet', rank: 3 },
  guest: { label: '访客', tag: 'GUEST', icon: 'user', tone: 'slate', rank: 9 },
} as const

const SERVER_CREW = { tag: 'CREW', tone: 'slate', rank: 2 } as const

const SERVER_FORUM_CAPABILITIES = ['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate', 'forum.category.manage', 'forum.badge.assign']

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
  it('matches the server catalogue: tones, titles, crew, departments and forum capabilities', () => {
    expect(TONES).toEqual(SERVER_TONES)
    for (const [id, spec] of Object.entries(SERVER_TITLES)) {
      const title = TITLES[id as keyof typeof SERVER_TITLES]
      expect(title, id).toEqual({ id, ...spec, icon: `i-carbon-${spec.icon}` })
    }
    expect(Object.keys(TITLES).sort()).toEqual(Object.keys(SERVER_TITLES).sort())
    expect(CREW).toEqual(SERVER_CREW)
    expect(DEPARTMENTS).toEqual(SERVER_DEPARTMENTS.map(department => ({ ...department, icon: `i-carbon-${department.icon}` })))
    expect([...FORUM_CAPABILITIES]).toEqual(SERVER_FORUM_CAPABILITIES)
    expect(DEPARTMENT_ID_PATTERN).toBe(SERVER_DEPARTMENT_ID_PATTERN)
  })

  it('uses only real Carbon icons', () => {
    const icons = [...Object.values(TITLES).map(title => title.icon), ...DEPARTMENTS.map(department => department.icon)]
    for (const icon of icons)
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
    expect(titleLabel({ id: 'captain' })).toBe('班长')
    expect(titleLabel({ id: 'head', department: 'recruitment' })).toBe('招新部 · 负责人')
    expect(titleLabel({ id: 'member', department: 'tech' })).toBe('技术部 · 干事')
    expect(titleLabel({ id: 'alumni' })).toBe('领航员')
    expect(titleLabel({ id: 'member' })).toBe('极客班成员')
    expect(titleLabel({ id: 'head', department: 'publicity' })).toBe('部门负责人')
    expect(titleLabel({ id: 'head' })).toBe('部门负责人')
    expect(titleLabel({ id: 'member', department: 'publicity' })).toBe('部门干事')
  })

  it('gives heads their department look, crew the department icon in the crew tone', () => {
    expect(titleIcon({ id: 'head', department: 'community' })).toBe('i-carbon-forum')
    expect(titleTone({ id: 'head', department: 'community' })).toBe('rose')
    expect(titleIcon({ id: 'head', department: 'publicity' })).toBe('i-carbon-badge')
    expect(titleTone({ id: 'head', department: 'publicity' })).toBe('cobalt')
    expect(titleIcon({ id: 'member', department: 'projects' })).toBe('i-carbon-application')
    expect(titleTone({ id: 'member', department: 'projects' })).toBe('slate')
    expect(titleTag({ id: 'member', department: 'projects' })).toBe('CREW')
    expect(titleTag({ id: 'member' })).toBe('MEMBER')
    expect(titleTone({ id: 'member' })).toBe('sky')
  })

  it('colours with the catalogue hex, lifted toward Tuffex ink under the dark theme', () => {
    expect(titleColor({ id: 'captain' })).toBe(TONES.amber)
    expect(titleColor({ id: 'head', department: 'tech' })).toBe(TONES.jade)
    expect(titleColor({ id: 'captain' }, true)).toBe(`color-mix(in srgb, ${TONES.amber} ${DARK_TONE_SHARE}%, var(--tx-text-color-primary))`)
  })

  it('ranks captain, head, crew, alumni, member, then no title', () => {
    const order: (UserTitle | undefined)[] = [
      { id: 'member' },
      undefined,
      { id: 'alumni' },
      { id: 'member', department: 'tech' },
      { id: 'head', department: 'tech' },
      { id: 'captain' },
    ]
    expect(order.map(titleRank)).toEqual([4, 9, 3, 2, 1, 0])
  })

  it('accepts only storable titles', () => {
    expect(isUserTitle({ id: 'captain' })).toBe(true)
    expect(isUserTitle({ id: 'member', department: 'tech' })).toBe(true)
    expect(isUserTitle({ id: 'head', department: 'publicity' })).toBe(true)
    for (const bad of [null, 'captain', [], {}, { id: 'guest' }, { id: 'king' }, { id: 'head', department: 'Tech' }, { id: 'head', department: 'x' }, { id: 'head', department: 3 }])
      expect(isUserTitle(bad), JSON.stringify(bad)).toBe(false)
  })
})

describe('title to forum capabilities', () => {
  const caps = (title: UserTitle | undefined): ForumCapability[] => [...titleForumCapabilities(title)].sort()

  it('follows the server: captain everything, heads and crew their department\'s forum pack', () => {
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
    for (const title of [{ id: 'captain' }, { id: 'head', department: 'community' }, { id: 'member', department: 'community' }] as UserTitle[]) {
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
