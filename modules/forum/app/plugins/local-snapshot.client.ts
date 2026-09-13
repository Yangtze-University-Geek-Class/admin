import { emptyForumState } from '../../shared/local-snapshot'

/**
 * In snapshot mode the store must never show the upstream demo seed, not even
 * for one frame: empty it before the app mounts, force the guest session and
 * start the fetch. `LocalSnapshotGate` keeps the pages unmounted until the
 * archive has landed, and shows the error instead of any fallback content.
 */
export default defineNuxtPlugin({
  name: 'geek-local-snapshot',
  dependsOn: ['pinia'],
  setup() {
    const { isSnapshot, load } = useContentSource()
    if (!isSnapshot)
      return
    const forum = useForumStore()
    const session = useSessionStore()
    forum.replaceState(emptyForumState())
    session.currentUserId = null
    void load()
  },
})
