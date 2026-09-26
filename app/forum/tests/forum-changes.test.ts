import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useForumStore } from '~/stores/forum'

/**
 * How a write's answer goes into the state (#145): `applyChanges` updates what
 * the page already holds in place, so a like changes one array rather than
 * handing every page a new state to draw from scratch.
 */

const NOW = 1_780_000_000_000
const LATER = NOW + 60_000

function setup(): ReturnType<typeof useForumStore> {
  setActivePinia(createPinia())
  const forum = useForumStore()
  forum.reset(NOW)
  return forum
}

describe('merging a write\'s answer (#145)', () => {
  let forum: ReturnType<typeof useForumStore>

  beforeEach(() => {
    forum = setup()
  })

  it('updates a record field by field and keeps it, and every list around it, the same object', () => {
    const post = forum.state.posts[0]!
    const likes = post.likeUserIds
    const lists = () => [forum.state, forum.state.posts, forum.state.users, forum.state.topics]
    const before = lists()
    forum.applyChanges({ posts: [{ ...post, content: '改过的', likeUserIds: [...likes] }] })
    lists().forEach((list, index) => expect(list).toBe(before[index]))
    expect(forum.postById(post.id)).toBe(post)
    expect(post.content).toBe('改过的')
    // Same likes, new array: nothing is written, so what shows the likes does not redraw.
    expect(post.likeUserIds).toBe(likes)
  })

  it('drops a field the server no longer sends, and appends a record it did not have', () => {
    const post = forum.state.posts[0]!
    const count = forum.state.posts.length
    forum.applyChanges({ posts: [{ ...post, editedAt: LATER }] })
    expect(post.editedAt).toBe(LATER)
    const { editedAt: _, ...unedited } = post
    forum.applyChanges({ posts: [unedited, { id: 'p-new', topicId: post.topicId, authorId: post.authorId, content: '新的', createdAt: LATER, likeUserIds: [] }] })
    expect(post).not.toHaveProperty('editedAt')
    expect(forum.state.posts).toHaveLength(count + 1)
    expect(forum.postById('p-new')?.content).toBe('新的')
    expect(forum.postsOfTopic(post.topicId).at(-1)?.id).toBe('p-new')
  })

  it('adds and takes away bookmarks and follows by their two ends', () => {
    const [a, b] = forum.state.users
    const post = forum.state.posts[0]!
    forum.state.bookmarks.splice(0)
    forum.state.follows.splice(0)
    forum.applyChanges({ bookmarks: [{ userId: a!.id, postId: post.id, createdAt: NOW }], follows: [{ followerId: a!.id, followeeId: b!.id, createdAt: NOW }] })
    const bookmark = forum.state.bookmarks[0]
    forum.applyChanges({ bookmarks: [{ userId: a!.id, postId: post.id, createdAt: LATER }] })
    expect(forum.state.bookmarks).toEqual([{ userId: a!.id, postId: post.id, createdAt: LATER }])
    expect(forum.state.bookmarks[0]).toBe(bookmark)
    expect(forum.isFollowing(a!.id, b!.id)).toBe(true)
    forum.applyChanges({ removed: { bookmarks: [{ userId: a!.id, postId: post.id }], follows: [{ followerId: a!.id, followeeId: b!.id }] } })
    expect(forum.state.bookmarks).toEqual([])
    expect(forum.state.follows).toEqual([])
  })

  it('takes out only the records named by id', () => {
    const [first, second] = forum.state.posts
    const users = forum.state.users.length
    forum.removeRecords({ posts: [first!.id], users: [] })
    expect(forum.postById(first!.id)).toBeUndefined()
    expect(forum.postById(second!.id)).toBe(second)
    expect(forum.state.users).toHaveLength(users)
  })
})
