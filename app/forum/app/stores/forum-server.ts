import type { ServerStatus } from '~/data/access'
import type { Bookmark, Follow, NotifyPrefs, Post, User } from '~/data/types'
import type { CreatePostBody, CreateTopicBody, ForumViewer, GuestPolicy, ProfileBody, ServerSnapshot, WriteResult } from '../../shared/forum-api'
import { toast } from '@talex-touch/tuffex/utils'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createForumApi, DEFAULT_GUEST_POLICY, ForumApiError } from '../../shared/forum-api'
import { replyPowBody, solvePow } from '../../shared/pow'
import { useForumStore } from './forum'
import { useSessionStore } from './session'

/**
 * 极客班论坛 against the forum server (`contentSource: site`): the server owns
 * the data and the permissions, the pages only show what it returned.
 *
 * - `load()` runs once after mount (plugins/site-state.client.ts). Success
 *   replaces the forum store and signs the session in as `viewer.userId`
 *   (null for a guest). Failure leaves the published posts the build shipped,
 *   and `status: 'error'` switches every write off. A 429 is not an outage:
 *   what the page shows stays, a toast says 请求太频繁 once (not again for
 *   every refused retry), and the store asks again later with a growing wait
 *   (`busy` until then if nothing had loaded yet).
 * - A write answers with only the records it changed (`WriteResult`, #145),
 *   merged into the store in place (`applyChanges`), so a like redraws one
 *   button rather than every page.
 * - Likes, bookmarks, follows, edits, deletions, pin/close, read marks and the
 *   profile show on the page at once and the request goes out behind them
 *   (`steer`). Each thing has one lane: while its request is out, more clicks
 *   only move the page, and when the answer is in the store sends once more
 *   only if the last click asked for something the server does not have yet.
 *   A reply shows at once too, under a `pending:` id until the server's
 *   answer replaces it with the real post.
 * - New topics and avatars wait for the server: a topic needs the server's id
 *   for its address, an avatar the server's stored picture.
 * - A failure puts back what the server last confirmed and says why in a
 *   toast. A 401 means the sign-in is gone (expired, signed out elsewhere):
 *   the state is read once more so the page shows what a guest can do.
 *
 * The demo (`loginMode=demo`) never touches this store; `useForumActions`
 * picks between the two.
 */
/** The toast for a 429 on a read; its id keeps two of them from stacking. */
const RATE_LIMITED_TOAST = { id: 'forum-rate-limited', title: '请求太频繁，稍后再试', variant: 'warning' } as const

/** Waits before asking for the state again after a 429: 10 s, 20 s, 40 s, then every minute. */
export function stateRetryDelay(attempt: number): number {
  return Math.min(60_000, 10_000 * 2 ** attempt)
}

/** The server's `rate_limited` on /state and /view, or a bare 429 from a proxy in front of it: judged by status, not code. */
const isRateLimited = (error: unknown): boolean => error instanceof ForumApiError && error.status === 429

/** The id a reply (and a guest's name on it) has while it is being sent; the server's ids never contain a colon. */
export const PENDING_PREFIX = 'pending:'

export function isPending(id: string): boolean {
  return id.startsWith(PENDING_PREFIX)
}

export interface ReplyAsGuestInput extends CreatePostBody {
  name: string
  /** The Turnstile answer, when `guestPolicy.turnstileSiteKey` asks for one. */
  turnstileToken?: string
}

/** Called with the id a reply is shown under the moment it is on the page (a `pending:` one against the server). */
export type ReplyShown = (postId: string) => void

/** How one lane reads, shows and sends its value (a post's like, a topic's pin, the viewer's profile …). */
interface LaneSpec<V> {
  /** What the page shows now. */
  read: () => V
  /** Shows `value` on the page. */
  write: (value: V) => void
  /** Asks the server for `wish`; `confirmed` is what the server last said. */
  send: (wish: V, confirmed: V) => Promise<WriteResult>
  same: (a: V, b: V) => boolean
  /** The toast title when the server refuses `wish`. */
  failure: (wish: V) => string
}

/** What a lane settled on; a wrapper, because a settled value can itself be `null` (no bookmark). */
interface Settled<V> {
  value: V
}

interface Lane {
  wish: unknown
  /** Shows the wish again after another answer brought the server's older value of the same record. */
  reassert: () => void
  done: Promise<unknown>
}

type ProfileFields = Pick<User, 'displayName' | 'bio' | 'location' | 'website' | 'notifyPrefs'>

const PROFILE_TEXT = ['displayName', 'bio', 'location', 'website'] as const

function samePrefs(a: NotifyPrefs, b: NotifyPrefs): boolean {
  return a.reply === b.reply && a.like === b.like && a.follow === b.follow
}

function sameProfile(a: ProfileFields, b: ProfileFields): boolean {
  return PROFILE_TEXT.every(key => a[key] === b[key]) && samePrefs(a.notifyPrefs, b.notifyPrefs)
}

function sameViewer(a: ForumViewer | null, b: ForumViewer): boolean {
  return !!a && a.userId === b.userId && a.kind === b.kind
    && a.capabilities.length === b.capabilities.length && a.capabilities.every((item, index) => item === b.capabilities[index])
}

function sameGuestPolicy(a: GuestPolicy, b: GuestPolicy): boolean {
  return a.powDifficulty === b.powDifficulty && a.turnstileSiteKey === b.turnstileSiteKey && a.nameMax === b.nameMax && a.contentMax === b.contentMax
}

export const useForumServerStore = defineStore('forum-server', () => {
  const forum = useForumStore()
  const session = useSessionStore()
  const api = createForumApi((input, init) => globalThis.fetch(input, init))

  const status = ref<ServerStatus>('idle')
  const viewer = ref<ForumViewer | null>(null)
  const guestPolicy = ref<GuestPolicy>({ ...DEFAULT_GUEST_POLICY })
  /** What the server lets the viewer moderate; `can()` reads only this in server mode. */
  const granted = computed<ReadonlySet<string>>(() => new Set(viewer.value?.capabilities ?? []))

  let loading: Promise<boolean> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryAttempt = 0
  /** 请求太频繁 has been said since the state last loaded; the retries and view counts after it stay quiet. */
  let saidRateLimited = false
  /** One per thing being changed (`like:p12`, `pin:t3` …), while its request is out. */
  const lanes = new Map<string, Lane>()
  let pendingCount = 0

  function sayRateLimited(): void {
    if (saidRateLimited)
      return
    saidRateLimited = true
    toast(RATE_LIMITED_TOAST)
  }

  function retryLater(): void {
    clearTimeout(retryTimer)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void load()
    }, stateRetryDelay(retryAttempt))
    retryAttempt += 1
  }

  function apply(snapshot: ServerSnapshot): void {
    forum.replaceState(snapshot.state)
    viewer.value = snapshot.viewer
    guestPolicy.value = snapshot.guestPolicy
    session.currentUserId = snapshot.viewer.userId
    status.value = 'ready'
  }

  function load(): Promise<boolean> {
    loading ??= (async () => {
      // Only the first read holds the pages back; a page that already shows something keeps showing it
      // while the state is re-read (after signing out, after a 429).
      if (status.value === 'idle')
        status.value = 'loading'
      try {
        apply(await api.state())
        clearTimeout(retryTimer)
        retryAttempt = 0
        saidRateLimited = false
        return true
      }
      catch (error) {
        if (isRateLimited(error)) {
          if (status.value !== 'ready')
            status.value = 'busy'
          sayRateLimited()
          retryLater()
          return false
        }
        viewer.value = null
        session.currentUserId = null
        status.value = 'error'
        return false
      }
      finally {
        loading = null
      }
    })()
    return loading
  }

  /**
   * Merges a write's answer. Viewer and guest policy are only replaced when
   * they differ, so the permission checks on every post do not rerun for
   * each like. A different viewer means the sign-in changed underneath: the
   * whole state is read again. Lanes still waiting for their own answer show
   * their wish again, in case this answer carried an older value of the same
   * record.
   */
  function merge(result: WriteResult, from?: Lane): void {
    forum.applyChanges(result.changes)
    if (!sameGuestPolicy(guestPolicy.value, result.guestPolicy))
      guestPolicy.value = result.guestPolicy
    if (result.viewer.userId !== (viewer.value?.userId ?? null)) {
      void load()
      return
    }
    if (!sameViewer(viewer.value, result.viewer))
      viewer.value = result.viewer
    for (const lane of lanes.values()) {
      if (lane !== from)
        lane.reassert()
    }
  }

  function fail(title: string, error: unknown): void {
    toast({
      title,
      description: error instanceof ForumApiError ? error.message : '请稍后再试。',
      variant: 'warning',
    })
    if (error instanceof ForumApiError && error.status === 401)
      void load()
  }

  /** Runs one write that waits for the server; `null` means it failed and the toast already said why. */
  async function attempt<T>(failure: string, task: () => Promise<T>): Promise<T | null> {
    try {
      return await task()
    }
    catch (error) {
      fail(failure, error)
      return null
    }
  }

  /**
   * Shows `wish` at once and gets the server there. At most one request per
   * `key` is out: a call while it is out only moves the page (and the wish),
   * and when the answer is in, the store sends again only if the wish changed
   * since it was sent and still differs from what the server now has. So two
   * quick clicks on 赞 send one request and a second one to take it back,
   * never two at the same time. Resolves with the value the server confirmed,
   * or `null` after a failure, which puts that value back on the page.
   */
  function steer<V>(key: string, wish: V, spec: LaneSpec<V>): Promise<Settled<V> | null> {
    const running = lanes.get(key)
    if (running) {
      running.wish = wish
      spec.write(wish)
      return running.done as Promise<Settled<V> | null>
    }
    let confirmed = spec.read()
    if (spec.same(wish, confirmed))
      return Promise.resolve({ value: confirmed })
    const lane: Lane = {
      wish,
      reassert: () => {
        if (!spec.same(spec.read(), lane.wish as V))
          spec.write(lane.wish as V)
      },
      done: Promise.resolve(),
    }
    lanes.set(key, lane)
    spec.write(wish)
    const done = (async (): Promise<Settled<V> | null> => {
      try {
        for (;;) {
          const sent = lane.wish as V
          merge(await spec.send(sent, confirmed), lane)
          confirmed = spec.read()
          const latest = lane.wish as V
          if (spec.same(latest, sent) || spec.same(latest, confirmed))
            return { value: confirmed }
          spec.write(latest)
        }
      }
      catch (error) {
        spec.write(confirmed)
        fail(spec.failure(lane.wish as V), error)
        return null
      }
      finally {
        lanes.delete(key)
      }
    })()
    lane.done = done
    return done
  }

  /** Without a viewer or the record on the page there is nothing to show early: the request goes out as it is. */
  function plainly<T>(failure: string, send: () => Promise<WriteResult>, after: () => T): Promise<T | null> {
    return attempt(failure, async () => {
      merge(await send())
      return after()
    })
  }

  /** A reply still under its `pending:` id has nothing on the server to like, edit or answer yet. */
  function stillSending(id: string | undefined): boolean {
    if (!id || !isPending(id))
      return false
    toast({ id: 'forum-still-sending', title: '这条回复还没发出去', description: '发出去之后才能对它操作。', variant: 'warning' })
    return true
  }

  function createTopic(body: CreateTopicBody): Promise<string | null> {
    return attempt('话题没有发出去', async () => {
      const result = await api.createTopic(body)
      merge(result)
      return result.topicId
    })
  }

  /**
   * Puts the reply on the page under a `pending:` id (and, for a guest, the
   * nickname under one too), then swaps it for the server's post in the same
   * tick the answer lands. A refusal takes it off again.
   */
  async function sendReply(body: CreatePostBody, author: string | User, shown: ReplyShown | undefined, send: () => Promise<WriteResult & { postId: string }>): Promise<string | null> {
    const topic = forum.topicById(body.topicId)
    const guest = typeof author === 'string' ? null : author
    if (!topic) {
      return attempt('回复没有发出去', async () => {
        const result = await send()
        merge(result)
        return result.postId
      })
    }
    pendingCount += 1
    const id = `${PENDING_PREFIX}${pendingCount}`
    const at = Date.now()
    const post: Post = { id, topicId: topic.id, authorId: guest?.id ?? author as string, content: body.content, createdAt: at, likeUserIds: [], ...(body.replyToPostId ? { replyToPostId: body.replyToPostId } : {}) }
    forum.applyChanges({ ...(guest ? { users: [guest] } : {}), posts: [post] })
    const lastActivityAt = topic.lastActivityAt
    if (at > lastActivityAt)
      topic.lastActivityAt = at
    const pending = { posts: [id], users: guest ? [guest.id] : [] }
    shown?.(id)
    try {
      const result = await send()
      forum.removeRecords(pending)
      merge(result)
      return result.postId
    }
    catch (error) {
      forum.removeRecords(pending)
      const current = forum.topicById(body.topicId)
      if (current && current.lastActivityAt === at)
        current.lastActivityAt = lastActivityAt
      fail('回复没有发出去', error)
      return null
    }
  }

  function createPost(body: CreatePostBody, shown?: ReplyShown): Promise<string | null> {
    if (stillSending(body.replyToPostId))
      return Promise.resolve(null)
    const authorId = viewer.value?.userId
    if (!authorId) {
      return attempt('回复没有发出去', async () => {
        const result = await api.createPost(body)
        merge(result)
        return result.postId
      })
    }
    return sendReply(body, authorId, shown, () => api.createPost(body))
  }

  /** A guest reply: the proof of work is computed here, right before sending, over the exact text sent. */
  function replyAsGuest({ name, turnstileToken, ...body }: ReplyAsGuestInput, shown?: ReplyShown): Promise<string | null> {
    if (stillSending(body.replyToPostId))
      return Promise.resolve(null)
    const guest: User = {
      id: `${PENDING_PREFIX}guest-${pendingCount + 1}`,
      username: `pending-guest-${pendingCount + 1}`,
      displayName: name,
      bio: '',
      location: '',
      website: '',
      avatarColor: '#64748b',
      kind: 'guest',
      joinedAt: Date.now(),
      role: 'member',
      notifyPrefs: { reply: false, like: false, follow: false },
    }
    return sendReply(body, guest, shown, async () => {
      const pow = await solvePow(replyPowBody(body.topicId, body.content), guestPolicy.value.powDifficulty)
      return api.createPost({ ...body, guest: { name }, pow, website: '', ...(turnstileToken ? { turnstileToken } : {}) })
    })
  }

  function toggleLike(postId: string): Promise<boolean | null> {
    const userId = viewer.value?.userId
    if (stillSending(postId))
      return Promise.resolve(null)
    const liked = (): boolean => !!userId && (forum.postById(postId)?.likeUserIds.includes(userId) ?? false)
    if (!userId || !forum.postById(postId))
      return plainly('没有赞上', () => api.toggleLike(postId), liked)
    return steer(`like:${postId}`, !liked(), {
      read: liked,
      write: (on) => {
        const list = forum.postById(postId)?.likeUserIds
        const index = list?.indexOf(userId) ?? -1
        if (on && list && index < 0)
          list.push(userId)
        else if (!on && list && index >= 0)
          list.splice(index, 1)
      },
      send: () => api.toggleLike(postId),
      same: Object.is,
      failure: on => (on ? '没有赞上' : '没有取消赞'),
    }).then(result => result && result.value)
  }

  /** The value is the bookmark itself, so taking one back after a failed removal keeps its date. */
  function toggleBookmark(postId: string): Promise<boolean | null> {
    const userId = viewer.value?.userId
    if (stillSending(postId))
      return Promise.resolve(null)
    if (!userId)
      return plainly('书签没有改成', () => api.toggleBookmark(postId), () => false)
    const read = (): Bookmark | null => {
      const found = forum.state.bookmarks.find(item => item.userId === userId && item.postId === postId)
      return found ? { ...found } : null
    }
    return steer<Bookmark | null>(`bookmark:${postId}`, read() ? null : { userId, postId, createdAt: Date.now() }, {
      read,
      write: value => forum.applyChanges(value ? { bookmarks: [value] } : { removed: { bookmarks: [{ userId, postId }] } }),
      send: () => api.toggleBookmark(postId),
      same: (a, b) => !a === !b,
      failure: value => (value ? '没有加上书签' : '没有移出书签'),
    }).then(result => result && !!result.value)
  }

  function toggleFollow(followeeId: string): Promise<boolean | null> {
    const followerId = viewer.value?.userId
    if (!followerId)
      return plainly('关注没有改成', () => api.toggleFollow(followeeId), () => false)
    const read = (): Follow | null => {
      const found = forum.state.follows.find(item => item.followerId === followerId && item.followeeId === followeeId)
      return found ? { ...found } : null
    }
    return steer<Follow | null>(`follow:${followeeId}`, read() ? null : { followerId, followeeId, createdAt: Date.now() }, {
      read,
      write: value => forum.applyChanges(value ? { follows: [value] } : { removed: { follows: [{ followerId, followeeId }] } }),
      send: () => api.toggleFollow(followeeId),
      same: (a, b) => !a === !b,
      failure: value => (value ? '没有关注上' : '没有取消关注'),
    }).then(result => result && !!result.value)
  }

  function editPost(postId: string, content: string): Promise<boolean> {
    if (stillSending(postId))
      return Promise.resolve(false)
    const post = forum.postById(postId)
    if (!post || post.deleted)
      return plainly('修改没有保存', () => api.editPost(postId, content), () => true).then(done => done !== null)
    interface Text { content: string, editedAt?: number }
    return steer<Text>(`edit:${postId}`, { content, editedAt: Date.now() }, {
      read: () => {
        const current = forum.postById(postId)
        return { content: current?.content ?? '', ...(current?.editedAt === undefined ? {} : { editedAt: current.editedAt }) }
      },
      write: (text) => {
        const current = forum.postById(postId)
        // A deletion that landed meanwhile wins: a removed post shows no text.
        if (!current || current.deleted)
          return
        current.content = text.content
        if (text.editedAt === undefined)
          delete current.editedAt
        else
          current.editedAt = text.editedAt
      },
      send: text => api.editPost(postId, text.content),
      same: (a, b) => a.content === b.content,
      failure: () => '修改没有保存',
    }).then(result => result !== null)
  }

  function deletePost(postId: string): Promise<boolean> {
    if (stillSending(postId))
      return Promise.resolve(false)
    if (!forum.postById(postId))
      return plainly('帖子没有删掉', () => api.deletePost(postId), () => true).then(done => done !== null)
    interface Removal { deleted: boolean, content: string }
    return steer<Removal>(`delete:${postId}`, { deleted: true, content: '' }, {
      read: () => {
        const current = forum.postById(postId)
        return { deleted: !!current?.deleted, content: current?.content ?? '' }
      },
      write: (value) => {
        const current = forum.postById(postId)
        if (!current)
          return
        current.content = value.content
        if (value.deleted)
          current.deleted = true
        else
          delete current.deleted
      },
      send: () => api.deletePost(postId),
      same: (a, b) => a.deleted === b.deleted,
      failure: () => '帖子没有删掉',
    }).then(result => result !== null)
  }

  function topicFlag(field: 'pinned' | 'closed', topicId: string, on: boolean, send: (on: boolean) => Promise<WriteResult>, failure: (on: boolean) => string): Promise<boolean> {
    if (!forum.topicById(topicId))
      return plainly(failure(on), () => send(on), () => true).then(done => done !== null)
    return steer(`${field}:${topicId}`, on, {
      read: () => forum.topicById(topicId)?.[field] ?? false,
      write: (value) => {
        const topic = forum.topicById(topicId)
        if (topic)
          topic[field] = value
      },
      send,
      same: Object.is,
      failure,
    }).then(result => result !== null)
  }

  function markRead(notificationId: string): Promise<boolean> {
    const find = () => forum.state.notifications.find(item => item.id === notificationId)
    if (!find())
      return plainly('没有标为已读', () => api.markRead(notificationId), () => true).then(done => done !== null)
    return steer(`read:${notificationId}`, true, {
      read: () => find()?.read ?? false,
      write: (read) => {
        const notification = find()
        if (notification)
          notification.read = read
      },
      send: () => api.markRead(notificationId),
      same: Object.is,
      failure: () => '没有标为已读',
    }).then(result => result !== null)
  }

  /** The value is the viewer's unread ids, so a failure makes exactly those unread again. */
  function markAllRead(): Promise<boolean> {
    const userId = viewer.value?.userId
    if (!userId)
      return plainly('没有标为已读', () => api.markAllRead(), () => true).then(done => done !== null)
    const unread = (): string[] => forum.notificationsOf(userId).filter(item => !item.read).map(item => item.id)
    return steer<string[]>('read-all', [], {
      read: unread,
      write: (ids) => {
        for (const notification of forum.state.notifications) {
          const read = notification.recipientId === userId && !ids.includes(notification.id)
          if (notification.recipientId === userId && notification.read !== read)
            notification.read = read
        }
      },
      send: () => api.markAllRead(),
      same: (a, b) => a.length === b.length && a.every((id, index) => id === b[index]),
      failure: () => '没有标为已读',
    }).then(result => result !== null)
  }

  /**
   * The viewer's own profile. What goes to the server is what differs from
   * what it last confirmed, so an unchanged nickname (a GitHub login longer
   * than the 30 a new nickname may have) is never sent back to be refused.
   */
  function updateProfile(body: ProfileBody): Promise<boolean> {
    const userId = viewer.value?.userId
    const user = userId ? forum.userById(userId) : undefined
    if (!userId || !user)
      return plainly('资料没有保存', () => api.updateProfile(body), () => true).then(done => done !== null)
    const read = (): ProfileFields => {
      const current = forum.userById(userId) ?? user
      return { displayName: current.displayName, bio: current.bio, location: current.location, website: current.website, notifyPrefs: { ...current.notifyPrefs } }
    }
    const now = read()
    const wish: ProfileFields = {
      displayName: body.displayName ?? now.displayName,
      bio: body.bio ?? now.bio,
      location: body.location ?? now.location,
      website: body.website ?? now.website,
      notifyPrefs: { ...now.notifyPrefs, ...body.notifyPrefs },
    }
    return steer<ProfileFields>('profile', wish, {
      read,
      write: (value) => {
        const current = forum.userById(userId)
        if (!current)
          return
        for (const key of PROFILE_TEXT) {
          if (current[key] !== value[key])
            current[key] = value[key]
        }
        if (!samePrefs(current.notifyPrefs, value.notifyPrefs))
          current.notifyPrefs = { ...value.notifyPrefs }
      },
      send: (value, confirmed) => {
        const changed: ProfileBody = {}
        for (const key of PROFILE_TEXT) {
          if (value[key] !== confirmed[key])
            changed[key] = value[key]
        }
        if (!samePrefs(value.notifyPrefs, confirmed.notifyPrefs))
          changed.notifyPrefs = { ...value.notifyPrefs }
        return api.updateProfile(changed)
      },
      same: sameProfile,
      failure: () => '资料没有保存',
    }).then(result => result !== null)
  }

  async function waitFor(failure: string, send: () => Promise<WriteResult>): Promise<boolean> {
    return await attempt(failure, async () => merge(await send())) !== null
  }

  return {
    status,
    viewer,
    guestPolicy,
    granted,
    load,
    createTopic,
    createPost,
    replyAsGuest,
    editPost,
    deletePost,
    toggleLike,
    toggleBookmark,
    toggleFollow,
    setPinned: (topicId: string, pinned: boolean) => topicFlag('pinned', topicId, pinned, on => api.setPinned(topicId, on), on => (on ? '没有置顶' : '没有取消置顶')),
    setClosed: (topicId: string, closed: boolean) => topicFlag('closed', topicId, closed, on => api.setClosed(topicId, on), on => (on ? '话题没有关闭' : '话题没有重新开放')),
    /** Views are a statistic: a failed count is not worth a toast, except the shared 请求太频繁 one. */
    recordView: (topicId: string): Promise<void> => api.recordView(topicId).catch((error: unknown) => {
      if (isRateLimited(error))
        sayRateLimited()
    }),
    markRead,
    markAllRead,
    updateProfile,
    uploadAvatar: (file: Blob) => waitFor('头像没有换成', () => api.uploadAvatar(file)),
    resetAvatar: () => waitFor('没有恢复 GitHub 头像', () => api.resetAvatar()),
  }
})
