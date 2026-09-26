<script setup lang="ts">
import type { BookmarkEntry } from '~/stores/forum'
import { toast } from '@talex-touch/tuffex/utils'

// Discourse's /bookmarks: the bookmarked post, the topic it lives in, and a
// way to drop it again.
useHead({ title: '书签' })

const EXCERPT_LENGTH = 60

const forum = useForumStore()
const actions = useForumActions()
const router = useRouter()
const { user, isLoggedIn } = useCurrentUser()
const { fromNow } = useRelativeTime()

const entries = computed(() => (user.value ? forum.bookmarksOf(user.value.id) : []))

function open(entry: BookmarkEntry) {
  void router.push(`/t/${entry.topic.id}`)
}

// The entry leaves the list before the call returns (#145); a refusal brings it back with the server store's toast.
function remove(entry: BookmarkEntry) {
  if (!user.value)
    return
  void actions.toggleBookmark(user.value.id, entry.post.id)
  toast({ title: '已移出书签', variant: 'success' })
}

function authorOf(entry: BookmarkEntry): string {
  return forum.userById(entry.post.authorId)?.displayName ?? '未知用户'
}
</script>

<template>
  <TxCard>
    <template #header>
      <h1 class="text-xl font-semibold">
        书签
      </h1>
    </template>

    <SignInState v-if="!isLoggedIn" page="bookmarks" />

    <TxStack v-else-if="entries.length" :gap="0">
      <template v-for="(entry, index) in entries" :key="entry.post.id">
        <TxCardItem
          clickable
          :subtitle="`${authorOf(entry)} · ${fromNow(entry.bookmark.createdAt)}`"
          :description="postExcerpt(entry.post.content, EXCERPT_LENGTH)"
          @click="open(entry)"
        >
          <template #title>
            <span class="whitespace-normal font-medium">{{ entry.topic.title }}</span>
          </template>
          <template #right>
            <TxIconButton
              icon="i-carbon-trash-can"
              label="移除书签"
              status="danger"
              size="sm"
              @click.stop="remove(entry)"
            />
          </template>
        </TxCardItem>
        <TxDivider v-if="index < entries.length - 1" />
      </template>
    </TxStack>

    <TxEmptyState
      v-else
      variant="blank-slate"
      title="还没有书签"
      description="在帖子下方点击书签图标即可收藏"
    />
  </TxCard>
</template>
