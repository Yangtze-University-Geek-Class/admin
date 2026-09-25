/**
 * 极客班称号 (titles) as the forum shows them next to a username.
 *
 * The authoritative catalogue is the server's `app/server/src/lib/roles.ts`
 * (served as `/api/console/catalogue`). This is the forum's own copy, kept
 * dependency-free so the static Nuxt build never reaches into the core
 * packages. Ids, Chinese labels, English tags, icons, tones, ranks, the crew
 * look, the default departments and the forum part of their permission packs
 * must stay identical to the server's; `tests/titles.test.ts` pins every value.
 *
 * Icons: the server stores bare Carbon names (`star-filled`); here they are the
 * full UnoCSS class (`i-carbon-star-filled`) spelled out as literals, because
 * the scanner reads `app/**` TypeScript and only a literal makes the icon rule
 * exist. The test checks each name against `@iconify-json/carbon/icons.json`.
 *
 * A title is identity, not a forum role: `User.role` (admin / moderator /
 * member) is untouched. What a title may do in the forum is its forum
 * capabilities (`titleForumCapabilities`), read by `permissions.ts`.
 */

export type TitleId = 'captain' | 'head' | 'member' | 'alumni' | 'guest'

/** The server's `TONES`: every tone is at least 5:1 on white and on its own 12% tint. */
export const TONES = {
  amber: '#855700',
  cobalt: '#3346C8',
  violet: '#6E44C9',
  jade: '#18694A',
  sky: '#08609A',
  coral: '#A63F16',
  rose: '#B4235A',
  slate: '#5B6475',
} as const

export type Tone = keyof typeof TONES

/**
 * Dark theme: the console has none, so the forum lifts each tone toward
 * Tuffex's own ink token instead of inventing a second palette. The share is
 * the tone's weight in `color-mix`; the test resolves it against the dark
 * tokens in `@talex-touch/tuffex/base.css` and holds it to 5:1.
 */
export const DARK_TONE_SHARE = 40

/** The server's forum capabilities, in catalogue order. */
export const FORUM_CAPABILITIES = [
  'forum.topic.pin',
  'forum.topic.close',
  'forum.post.moderate',
  'forum.category.manage',
  'forum.badge.assign',
] as const

export type ForumCapability = (typeof FORUM_CAPABILITIES)[number]

export interface TitleDefinition {
  id: TitleId
  /** Chinese label. For `head` it is only the fallback; a known department names itself. */
  label: string
  /** English tag, upper case. */
  tag: string
  icon: string
  tone: Tone
  /** Lower first: someone's primary title is their lowest rank. */
  rank: number
}

/** The server's `TITLES`, keyed the same way. */
export const TITLES: Readonly<Record<TitleId, TitleDefinition>> = {
  captain: { id: 'captain', label: '舰长', tag: 'CAPTAIN', icon: 'i-carbon-star-filled', tone: 'amber', rank: 0 },
  head: { id: 'head', label: '队长', tag: 'LEADER', icon: 'i-carbon-badge', tone: 'cobalt', rank: 1 },
  member: { id: 'member', label: '舰员', tag: 'CREW', icon: 'i-carbon-code', tone: 'sky', rank: 4 },
  alumni: { id: 'alumni', label: '领航员', tag: 'NAVIGATOR', icon: 'i-carbon-compass', tone: 'violet', rank: 3 },
  guest: { id: 'guest', label: '乘客', tag: 'PASSENGER', icon: 'i-carbon-user', tone: 'slate', rank: 9 },
}

/** The server's `CREW_TITLE`: `{部门} · 舰员` wears the department icon in the neutral tone. */
export const CREW = { tag: 'CREW', tone: 'slate', rank: 2 } as const satisfies { tag: string, tone: Tone, rank: number }

/** The server's `DEPARTMENT_ID_PATTERN`. */
export const DEPARTMENT_ID_PATTERN = '^[a-z][a-z0-9-]{1,31}$'

export interface DepartmentDefinition {
  id: string
  name: string
  tag: string
  icon: string
  tone: Tone
  /** The `forum.*` part of the department head's permission pack. */
  headForum: readonly ForumCapability[]
  /** The `forum.*` part of the crew (舰员) permission pack. */
  crewForum: readonly ForumCapability[]
}

/**
 * The server's `DEFAULT_DEPARTMENTS`, reduced to what the forum shows and
 * enforces. The console can add departments and edit packs at runtime; the
 * forum does not know those and shows the generic head / crew look with no
 * forum capability instead.
 */
export const DEPARTMENTS: readonly DepartmentDefinition[] = [
  { id: 'recruitment', name: '招新部', tag: 'RECRUIT', icon: 'i-carbon-user-follow', tone: 'coral', headForum: [], crewForum: [] },
  { id: 'tech', name: '技术部', tag: 'TECH', icon: 'i-carbon-terminal', tone: 'jade', headForum: [], crewForum: [] },
  {
    id: 'community',
    name: '社区部',
    tag: 'COMMUNITY',
    icon: 'i-carbon-forum',
    tone: 'rose',
    headForum: ['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate', 'forum.category.manage', 'forum.badge.assign'],
    crewForum: ['forum.topic.pin', 'forum.topic.close', 'forum.post.moderate'],
  },
  { id: 'projects', name: '项目部', tag: 'PROJECTS', icon: 'i-carbon-application', tone: 'cobalt', headForum: ['forum.topic.pin'], crewForum: [] },
]

/** What a user record carries. `guest` is the absence of a title and is never stored. */
export interface UserTitle {
  id: Exclude<TitleId, 'guest'>
  /** Department id: expected for `head`; optional for `member` (makes them crew). */
  department?: string
}

const DEPARTMENT_ID = new RegExp(DEPARTMENT_ID_PATTERN)

const STORABLE: ReadonlySet<string> = new Set(['captain', 'head', 'member', 'alumni'] satisfies UserTitle['id'][])

const NO_FORUM_CAPABILITIES: ReadonlySet<ForumCapability> = new Set()

function departmentOf(title: UserTitle): DepartmentDefinition | undefined {
  return title.department === undefined ? undefined : DEPARTMENTS.find(department => department.id === title.department)
}

export function isCrew(title: UserTitle): boolean {
  return title.id === 'member' && title.department !== undefined
}

/**
 * Structural check for titles that did not come from the seed (the read-only
 * snapshot): an object whose `id` is a storable title and whose optional
 * `department` is shaped like a department id.
 */
export function isUserTitle(value: unknown): value is UserTitle {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const { id, department } = value as Record<string, unknown>
  if (typeof id !== 'string' || !STORABLE.has(id))
    return false
  return department === undefined || (typeof department === 'string' && DEPARTMENT_ID.test(department))
}

/** `舰长`, `社区部 · 队长`, `技术部 · 舰员`, `领航员`, `舰员`. */
export function titleLabel(title: UserTitle): string {
  const department = departmentOf(title)
  if (title.id === 'head')
    return department ? `${department.name} · 队长` : TITLES.head.label
  if (isCrew(title))
    return department ? `${department.name} · 舰员` : '部门舰员'
  return TITLES[title.id].label
}

/** English tag, e.g. `LEADER`, `CREW`. */
export function titleTag(title: UserTitle): string {
  return isCrew(title) ? CREW.tag : TITLES[title.id].tag
}

/** Head and crew wear their department's icon; an unknown department falls back to the head badge. */
export function titleIcon(title: UserTitle): string {
  if (title.id === 'head' || isCrew(title))
    return departmentOf(title)?.icon ?? TITLES.head.icon
  return TITLES[title.id].icon
}

/** A head takes the department's tone; crew is always the neutral crew tone. */
export function titleTone(title: UserTitle): Tone {
  if (isCrew(title))
    return CREW.tone
  if (title.id === 'head')
    return departmentOf(title)?.tone ?? TITLES.head.tone
  return TITLES[title.id].tone
}

/**
 * CSS colour for TxTag's `color`: the catalogue hex on the light theme, the
 * same hex lifted toward `--tx-text-color-primary` under `html.dark`.
 */
export function titleColor(title: UserTitle, dark = false): string {
  const hex = TONES[titleTone(title)]
  return dark ? `color-mix(in srgb, ${hex} ${DARK_TONE_SHARE}%, var(--tx-text-color-primary))` : hex
}

/** Sort key: captain 0, head 1, crew 2, alumni 3, member 4, no title 9. */
export function titleRank(title: UserTitle | null | undefined): number {
  if (!title)
    return TITLES.guest.rank
  return isCrew(title) ? CREW.rank : TITLES[title.id].rank
}

/**
 * The forum capabilities a title carries, as the server computes them: the
 * captain holds every capability; a head or crew member of a known department
 * holds that department's forum pack; everyone else, and anyone in a
 * department the forum does not know, holds none.
 */
export function titleForumCapabilities(title: UserTitle | null | undefined): ReadonlySet<ForumCapability> {
  if (!title)
    return NO_FORUM_CAPABILITIES
  if (title.id === 'captain')
    return new Set(FORUM_CAPABILITIES)
  const department = departmentOf(title)
  if (!department)
    return NO_FORUM_CAPABILITIES
  if (title.id === 'head')
    return new Set(department.headForum)
  return isCrew(title) ? new Set(department.crewForum) : NO_FORUM_CAPABILITIES
}
