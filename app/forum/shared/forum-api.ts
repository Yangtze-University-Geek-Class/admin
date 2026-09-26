import type { ForumState, NotifyPrefs, User } from '../app/data/types'
import type { PowProof } from './pow'
import { FORUM_STATE_VERSION } from '../app/data/types'

/**
 * 论坛后端的浏览器客户端（接口约定见 docs/services/forum/README.md「服务端模式」）。
 *
 * 核心服务在同域的 `/api/forum/*` 上存帖子、做授权，身份只认全站登录的 `sid` cookie；本机论坛单独跑在
 * 3456 时由 nuxt.config.ts 的 devProxy 转给 127.0.0.1:3000。每个写接口都返回整份 `state`，
 * 调用方整体替换 store，不在本地拼改动。纯函数、不依赖 Nuxt，fetch 由调用方传入，单测直接用假的 fetch。
 */

export const FORUM_API_BASE = '/api/forum'

/** 读整份状态最多等这么久；超时和连不上一样处理（页面写「论坛服务暂时连不上」，只能看帖）。 */
export const STATE_TIMEOUT_MS = 10_000

export interface ForumViewer {
  /** 登录成员的论坛用户 id；游客为 null。 */
  userId: string | null
  kind: 'guest' | 'member'
  /** 服务端算好的 `forum.*` 能力，版务按钮只看它。 */
  capabilities: string[]
}

export interface GuestPolicy {
  powDifficulty: number
  turnstileSiteKey: string | null
  nameMax: number
  contentMax: number
}

export interface ServerSnapshot {
  state: ForumState
  viewer: ForumViewer
  guestPolicy: GuestPolicy
}

export const DEFAULT_GUEST_POLICY: GuestPolicy = { powDifficulty: 3, turnstileSiteKey: null, nameMax: 20, contentMax: 2000 }

/** 成员帖子正文上限（游客的上限在 guestPolicy.contentMax）。 */
export const MEMBER_CONTENT_MAX = 20000
export const TOPIC_TITLE_MAX = 120
export const TOPIC_TAG_MAX = 5
export const PROFILE_LIMITS = { displayName: 30, bio: 200, location: 60, website: 200 } as const
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export class ForumApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ForumApiError'
    this.status = status
    this.code = code
  }
}

/** 服务端没给中文说明时（网络断了、代理返回 HTML）按状态码给一句能看懂的话。 */
export function fallbackMessage(status: number): string {
  if (status === 0)
    return '论坛服务暂时连不上，请稍后再试。'
  if (status === 401)
    return '登录已失效，请刷新页面后重新登录。'
  if (status === 403)
    return '你没有做这件事的权限。'
  if (status === 404)
    return '要找的内容不存在，可能已被删除。'
  if (status === 413)
    return '内容太大了。'
  if (status === 429)
    return '操作太频繁，请过一会儿再试。'
  if (status >= 500)
    return '论坛服务出错了，请稍后再试。'
  return '请求没有成功，请检查填写的内容。'
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface CreateTopicBody {
  title: string
  categoryId: string
  /** 标签 id 或新标签的名字，最多 5 个。 */
  tags: string[]
  content: string
}

export interface CreatePostBody {
  topicId: string
  content: string
  replyToPostId?: string
}

export interface GuestPostBody extends CreatePostBody {
  guest: { name: string }
  pow: PowProof
  /** 蜜罐字段，真人提交永远是空串。 */
  website: ''
  /** 服务端配了 Turnstile（`guestPolicy.turnstileSiteKey` 非空）时必填，一次性。 */
  turnstileToken?: string
}

export interface ProfileBody {
  displayName?: string
  bio?: string
  location?: string
  website?: string
  notifyPrefs?: NotifyPrefs
}

interface RequestOptions {
  contentType?: string
  /** 到点就放弃；放弃算作 `timeout`，状态码 0，和连不上一样。 */
  signal?: AbortSignal
}

/** 老浏览器没有 `AbortSignal.timeout` 时不限时，行为和以前一样。 */
function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined
}

export function createForumApi(fetchImpl: FetchLike) {
  async function request(method: string, path: string, body?: unknown, { contentType, signal }: RequestOptions = {}): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json' }
    let payload: BodyInit | undefined
    if (body instanceof Blob) {
      headers['content-type'] = contentType ?? (body.type || 'application/octet-stream')
      payload = body
    }
    else if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    let response: Response
    try {
      response = await fetchImpl(`${FORUM_API_BASE}${path}`, { method, credentials: 'same-origin', headers, body: payload, ...(signal ? { signal } : {}) })
    }
    catch {
      if (signal?.aborted)
        throw new ForumApiError(0, 'timeout', '论坛服务太久没有回答，请稍后再试。')
      throw new ForumApiError(0, 'network_error', fallbackMessage(0))
    }
    const json = response.headers.get('content-type')?.includes('application/json')
      ? await response.json().catch(() => null) as unknown
      : null
    if (!response.ok) {
      const error = isRecord(json) ? json : {}
      const code = typeof error.error === 'string' ? error.error : `http_${response.status}`
      const message = typeof error.message === 'string' && error.message ? error.message : fallbackMessage(response.status)
      throw new ForumApiError(response.status, code, message)
    }
    if (response.status === 204)
      return null
    if (json === null)
      throw new ForumApiError(response.status, 'invalid_response', fallbackMessage(0))
    return json
  }

  const snapshot = async (method: string, path: string, body?: unknown, options?: RequestOptions): Promise<ServerSnapshot> =>
    parseServerSnapshot(await request(method, path, body, options))

  const id = (value: string): string => encodeURIComponent(value)

  return {
    state: () => snapshot('GET', '/state', undefined, { signal: timeoutSignal(STATE_TIMEOUT_MS) }),
    async createTopic(body: CreateTopicBody): Promise<ServerSnapshot & { topicId: string }> {
      const json = await request('POST', '/topics', body)
      return { ...parseServerSnapshot(json), topicId: stringField(json, 'topicId') }
    },
    async createPost(body: CreatePostBody | GuestPostBody): Promise<ServerSnapshot & { postId: string }> {
      const json = await request('POST', '/posts', body)
      return { ...parseServerSnapshot(json), postId: stringField(json, 'postId') }
    },
    editPost: (postId: string, content: string) => snapshot('PATCH', `/posts/${id(postId)}`, { content }),
    deletePost: (postId: string) => snapshot('DELETE', `/posts/${id(postId)}`),
    toggleLike: (postId: string) => snapshot('POST', `/posts/${id(postId)}/like`),
    toggleBookmark: (postId: string) => snapshot('POST', `/posts/${id(postId)}/bookmark`),
    toggleFollow: (userId: string) => snapshot('POST', `/users/${id(userId)}/follow`),
    setPinned: (topicId: string, pinned: boolean) => snapshot('POST', `/topics/${id(topicId)}/pin`, { pinned }),
    setClosed: (topicId: string, closed: boolean) => snapshot('POST', `/topics/${id(topicId)}/close`, { closed }),
    async recordView(topicId: string): Promise<void> {
      await request('POST', `/topics/${id(topicId)}/view`)
    },
    markRead: (notificationId: string) => snapshot('POST', `/notifications/${id(notificationId)}/read`),
    markAllRead: () => snapshot('POST', '/notifications/read-all'),
    updateProfile: (body: ProfileBody) => snapshot('PATCH', '/me/profile', body),
    async uploadAvatar(file: Blob): Promise<ServerSnapshot> {
      return parseServerSnapshot(await request('PUT', '/me/avatar', file, { contentType: file.type }))
    },
    resetAvatar: () => snapshot('DELETE', '/me/avatar'),
  }
}

export type ForumApi = ReturnType<typeof createForumApi>

/**
 * 接口返回的 `{ state }`：state 与前端 `ForumState` 同形，外加 `viewer` 和 `guestPolicy` 两个字段
 * （它们在 state 里或与 state 并列都接受）。形状不对就当作服务不可用，不把半份数据放进 store。
 */
export function parseServerSnapshot(body: unknown): ServerSnapshot {
  const invalid = (): ForumApiError => new ForumApiError(200, 'invalid_state', '论坛服务返回的数据不完整，请稍后再试。')
  if (!isRecord(body) || !isRecord(body.state))
    throw invalid()
  const raw = body.state
  if (raw.version !== FORUM_STATE_VERSION)
    throw invalid()
  for (const key of ['users', 'categories', 'tags', 'topics', 'posts', 'notifications', 'bookmarks', 'follows'] as const) {
    if (!Array.isArray(raw[key]))
      throw invalid()
  }
  const viewer = parseViewer(raw.viewer ?? body.viewer)
  if (!viewer)
    throw invalid()
  const users = (raw.users as unknown[]).map(normalizeUser)
  if (users.includes(null))
    throw invalid()
  const counters = isRecord(raw.counters) ? raw.counters : {}
  const state = {
    version: FORUM_STATE_VERSION,
    seededAt: typeof raw.seededAt === 'number' ? raw.seededAt : 0,
    counters: {
      topic: count(counters.topic),
      post: count(counters.post),
      notification: count(counters.notification),
      tag: count(counters.tag),
    },
    users: users as User[],
    categories: raw.categories,
    tags: raw.tags,
    topics: raw.topics,
    posts: raw.posts,
    notifications: raw.notifications,
    bookmarks: raw.bookmarks,
    follows: raw.follows,
  } as ForumState
  return { state, viewer, guestPolicy: parseGuestPolicy(raw.guestPolicy ?? body.guestPolicy) }
}

function parseViewer(value: unknown): ForumViewer | null {
  if (!isRecord(value))
    return null
  const { userId, kind, capabilities } = value
  if (userId !== null && typeof userId !== 'string')
    return null
  if (kind !== 'guest' && kind !== 'member')
    return null
  if (!Array.isArray(capabilities) || !capabilities.every(item => typeof item === 'string'))
    return null
  // 游客没有论坛用户；成员一定有，两者对不上说明数据坏了。
  if ((kind === 'guest') !== (userId === null))
    return null
  return { userId, kind, capabilities: [...capabilities] as string[] }
}

function parseGuestPolicy(value: unknown): GuestPolicy {
  if (!isRecord(value))
    return { ...DEFAULT_GUEST_POLICY }
  const positive = (field: unknown, fallback: number): number =>
    typeof field === 'number' && Number.isInteger(field) && field > 0 ? field : fallback
  return {
    powDifficulty: typeof value.powDifficulty === 'number' && Number.isInteger(value.powDifficulty) && value.powDifficulty >= 0
      ? value.powDifficulty
      : DEFAULT_GUEST_POLICY.powDifficulty,
    turnstileSiteKey: typeof value.turnstileSiteKey === 'string' && value.turnstileSiteKey ? value.turnstileSiteKey : null,
    nameMax: positive(value.nameMax, DEFAULT_GUEST_POLICY.nameMax),
    contentMax: positive(value.contentMax, DEFAULT_GUEST_POLICY.contentMax),
  }
}

/** 必填的 id、用户名、名字缺了就拒收；可选资料缺了补空值，头像底色缺了用中性灰。 */
function normalizeUser(value: unknown): User | null {
  if (!isRecord(value))
    return null
  const { id, username, displayName } = value
  if (typeof id !== 'string' || typeof username !== 'string' || typeof displayName !== 'string')
    return null
  const text = (field: unknown): string => (typeof field === 'string' ? field : '')
  const prefs = isRecord(value.notifyPrefs) ? value.notifyPrefs : {}
  const user: User = {
    ...(value as unknown as User),
    id,
    username,
    displayName,
    bio: text(value.bio),
    location: text(value.location),
    website: text(value.website),
    avatarColor: text(value.avatarColor) || '#64748b',
    joinedAt: typeof value.joinedAt === 'number' ? value.joinedAt : 0,
    role: value.role === 'admin' || value.role === 'moderator' ? value.role : 'member',
    notifyPrefs: { reply: prefs.reply !== false, like: prefs.like !== false, follow: prefs.follow !== false },
  }
  if (typeof value.avatarUrl !== 'string' || !value.avatarUrl)
    delete user.avatarUrl
  return user
}

function stringField(body: unknown, key: string): string {
  const value = isRecord(body) ? body[key] : undefined
  if (typeof value !== 'string' || !value)
    throw new ForumApiError(200, 'invalid_response', '论坛服务返回的数据不完整，请稍后再试。')
  return value
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 头像只收 png/jpeg/webp、最大 2MB（服务端同样的限制），不合格时返回一句说明。 */
export function avatarFileProblem(file: { size: number, type: string }): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type))
    return '头像只能是 PNG、JPEG 或 WebP 图片。'
  if (file.size > AVATAR_MAX_BYTES)
    return '头像图片不能超过 2MB。'
  if (file.size === 0)
    return '这个文件是空的。'
  return null
}

/**
 * 保存资料时昵称那一项：没改（或清空了，等于不改）就不发。服务端对发来的昵称要重新校验和查重，
 * 规则收紧以后，原样发回一个旧昵称可能被拒，连带签名、网站这些改动一起存不上。
 */
export function changedDisplayName(draft: string, current: string): Pick<ProfileBody, 'displayName'> {
  const next = draft.trim() || current
  return next === current ? {} : { displayName: next }
}

/** 个人网站只收 https:// 开头的地址（服务端同样的限制）；空串表示不填。 */
export function websiteProblem(value: string): string | null {
  if (!value)
    return null
  if (value.length > PROFILE_LIMITS.website)
    return `个人网站不能超过 ${PROFILE_LIMITS.website} 个字符。`
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !value.startsWith('https://'))
      return '个人网站要以 https:// 开头。'
  }
  catch {
    return '个人网站不是有效的地址。'
  }
  return null
}

/**
 * 个人主页上能做成链接的网站：过得了 `websiteProblem` 的才算，否则 `null`（页面上不显示）。
 * 快照、示例或旧的服务端可能给出 `javascript:`、`http:` 之类的地址，不能直接放进 href 或 window.open。
 */
export function linkableWebsite(value: string | undefined): string | null {
  return value && !websiteProblem(value) ? value : null
}
