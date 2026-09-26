import type { ServerStatus } from '~/data/access'
import type { CreatePostBody, CreateTopicBody, ForumViewer, GuestPolicy, ProfileBody, ServerSnapshot } from '../../shared/forum-api'
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
 *   and `status: 'error'` switches every write off.
 * - Each write calls one endpoint and replaces the whole state from its
 *   answer. A failure changes nothing locally and says why in a toast.
 *
 * The demo (`loginMode=demo`) never touches this store; `useForumActions`
 * picks between the two.
 */
export interface ReplyAsGuestInput extends CreatePostBody {
  name: string
  /** The Turnstile answer, when `guestPolicy.turnstileSiteKey` asks for one. */
  turnstileToken?: string
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

  function apply(snapshot: ServerSnapshot): void {
    forum.replaceState(snapshot.state)
    viewer.value = snapshot.viewer
    guestPolicy.value = snapshot.guestPolicy
    session.currentUserId = snapshot.viewer.userId
    status.value = 'ready'
  }

  function load(): Promise<boolean> {
    loading ??= (async () => {
      status.value = 'loading'
      try {
        apply(await api.state())
        return true
      }
      catch {
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

  /** Runs one write; `null` means it failed and the toast already said why. */
  async function attempt<T>(failure: string, task: () => Promise<T>): Promise<T | null> {
    try {
      return await task()
    }
    catch (error) {
      toast({
        title: failure,
        description: error instanceof ForumApiError ? error.message : '请稍后再试。',
        variant: 'warning',
      })
      return null
    }
  }

  async function write(failure: string, task: () => Promise<ServerSnapshot>): Promise<boolean> {
    return await attempt(failure, async () => apply(await task())) !== null
  }

  function createTopic(body: CreateTopicBody): Promise<string | null> {
    return attempt('话题没有发出去', async () => {
      const result = await api.createTopic(body)
      apply(result)
      return result.topicId
    })
  }

  function createPost(body: CreatePostBody): Promise<string | null> {
    return attempt('回复没有发出去', async () => {
      const result = await api.createPost(body)
      apply(result)
      return result.postId
    })
  }

  /** A guest reply: the proof of work is computed here, right before sending, over the exact text sent. */
  function replyAsGuest({ name, turnstileToken, ...body }: ReplyAsGuestInput): Promise<string | null> {
    return attempt('回复没有发出去', async () => {
      const pow = await solvePow(replyPowBody(body.topicId, body.content), guestPolicy.value.powDifficulty)
      const result = await api.createPost({ ...body, guest: { name }, pow, website: '', ...(turnstileToken ? { turnstileToken } : {}) })
      apply(result)
      return result.postId
    })
  }

  /** The viewer's side of a toggle after the server answered; `null` when the call failed. */
  async function toggle(failure: string, task: () => Promise<ServerSnapshot>, read: (userId: string) => boolean): Promise<boolean | null> {
    if (!await write(failure, task))
      return null
    const userId = viewer.value?.userId
    return userId ? read(userId) : false
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
    editPost: (postId: string, content: string) => write('修改没有保存', () => api.editPost(postId, content)),
    deletePost: (postId: string) => write('帖子没有删掉', () => api.deletePost(postId)),
    toggleLike: (postId: string) => toggle('没有赞上', () => api.toggleLike(postId), userId => forum.postById(postId)?.likeUserIds.includes(userId) ?? false),
    toggleBookmark: (postId: string) => toggle('书签没有改成', () => api.toggleBookmark(postId), userId => forum.isBookmarked(userId, postId)),
    toggleFollow: (userId: string) => toggle('关注没有改成', () => api.toggleFollow(userId), followerId => forum.isFollowing(followerId, userId)),
    setPinned: (topicId: string, pinned: boolean) => write(pinned ? '没有置顶' : '没有取消置顶', () => api.setPinned(topicId, pinned)),
    setClosed: (topicId: string, closed: boolean) => write(closed ? '话题没有关闭' : '话题没有重新开放', () => api.setClosed(topicId, closed)),
    /** Views are a statistic: a failed count is not worth a toast. */
    recordView: (topicId: string): Promise<void> => api.recordView(topicId).catch(() => {}),
    markRead: (notificationId: string) => write('没有标为已读', () => api.markRead(notificationId)),
    markAllRead: () => write('没有标为已读', () => api.markAllRead()),
    updateProfile: (body: ProfileBody) => write('资料没有保存', () => api.updateProfile(body)),
    uploadAvatar: (file: Blob) => write('头像没有换成', () => api.uploadAvatar(file)),
    resetAvatar: () => write('没有恢复 GitHub 头像', () => api.resetAvatar()),
  }
})
