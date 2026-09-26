import type { ReplyAsGuestInput } from '~/stores/forum-server'
import type { CreatePostInput, CreateTopicInput, ProfilePatch } from '~/stores/forum'

/**
 * Every write a page makes goes through here, so no component carries two
 * code paths. Against the forum server (`serverMode`) each call is one
 * request and the answer replaces the whole store; a failure changes nothing
 * and the server store's toast says why. In the demo the upstream store
 * mutates this browser's copy exactly as before, synchronously, before the
 * returned promise settles.
 *
 * Results: an id, the new on/off state of a toggle, or `true` — and `null` or
 * `false` when the write did not happen.
 */
export function useForumActions() {
  const { serverMode } = useContentSource()
  const forum = useForumStore()
  const server = useForumServerStore()

  async function createTopic(input: CreateTopicInput): Promise<string | null> {
    if (!serverMode)
      return forum.createTopic(input).id
    return server.createTopic({ title: input.title, categoryId: input.categoryId, tags: input.tagIds, content: input.content })
  }

  async function createPost(input: CreatePostInput): Promise<string | null> {
    if (!serverMode)
      return forum.createPost(input).id
    return server.createPost({ topicId: input.topicId, content: input.content, ...(input.replyToPostId ? { replyToPostId: input.replyToPostId } : {}) })
  }

  /** Server mode only: nobody replies without an identity in the demo. */
  async function replyAsGuest(input: ReplyAsGuestInput): Promise<string | null> {
    return serverMode ? server.replyAsGuest(input) : null
  }

  async function editPost(postId: string, content: string): Promise<boolean> {
    return serverMode ? server.editPost(postId, content) : forum.editPost(postId, content)
  }

  async function deletePost(postId: string): Promise<boolean> {
    return serverMode ? server.deletePost(postId) : forum.deletePost(postId)
  }

  async function toggleLike(postId: string, userId: string): Promise<boolean | null> {
    return serverMode ? server.toggleLike(postId) : forum.toggleLike(postId, userId)
  }

  async function toggleBookmark(userId: string, postId: string): Promise<boolean | null> {
    return serverMode ? server.toggleBookmark(postId) : forum.toggleBookmark(userId, postId)
  }

  async function toggleFollow(followerId: string, followeeId: string): Promise<boolean | null> {
    return serverMode ? server.toggleFollow(followeeId) : forum.toggleFollow(followerId, followeeId)
  }

  async function setPinned(topicId: string, pinned: boolean): Promise<boolean> {
    if (serverMode)
      return server.setPinned(topicId, pinned)
    forum.setPinned(topicId, pinned)
    return true
  }

  async function setClosed(topicId: string, closed: boolean): Promise<boolean> {
    if (serverMode)
      return server.setClosed(topicId, closed)
    forum.setClosed(topicId, closed)
    return true
  }

  /** The server counts one view per address and hour; the demo counts in the store. */
  function recordView(topicId: string): void {
    if (serverMode)
      void server.recordView(topicId)
    else
      forum.incrementViews(topicId)
  }

  async function markRead(notificationId: string): Promise<boolean> {
    if (serverMode)
      return server.markRead(notificationId)
    forum.markRead(notificationId)
    return true
  }

  async function markAllRead(userId: string): Promise<boolean> {
    if (serverMode)
      return server.markAllRead()
    forum.markAllRead(userId)
    return true
  }

  /** The server has no avatar colour: an avatar there is a picture (see the preferences page). */
  async function updateProfile(userId: string, patch: ProfilePatch): Promise<boolean> {
    if (!serverMode)
      return forum.updateProfile(userId, patch)
    const { avatarColor: _unused, ...body } = patch
    return server.updateProfile(body)
  }

  return {
    createTopic,
    createPost,
    replyAsGuest,
    editPost,
    deletePost,
    toggleLike,
    toggleBookmark,
    toggleFollow,
    setPinned,
    setClosed,
    recordView,
    markRead,
    markAllRead,
    updateProfile,
    uploadAvatar: (file: Blob) => server.uploadAvatar(file),
    resetAvatar: () => server.resetAvatar(),
  }
}
