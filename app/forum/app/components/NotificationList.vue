<script setup lang="ts">
import type { FilterChipItem } from '@talex-touch/tuffex/filter-chips'
import type { Notification, NotificationType } from '~/data/types'
import { siteNameInText } from '../../shared/content-source'

/**
 * Discourse's notification list: an icon per kind, the sentence that explains
 * it, unread rows in bold with a dot on the right.
 *
 * The filter and 全部标为已读 travel with the list, because both places that
 * show it — `/notifications` and the 通知 tab on your own profile — carry them.
 */
const props = defineProps<{ userId: string }>()

const ICONS: Record<NotificationType, string> = {
  reply: 'i-carbon-reply',
  like: 'i-carbon-favorite',
  mention: 'i-carbon-at',
  follow: 'i-carbon-user-follow',
  system: 'i-carbon-information',
}

const forum = useForumStore()
const router = useRouter()
const { fromNow } = useRelativeTime()
const { siteName } = useContentSource()
const systemSender = siteNameInText(siteName)

const filter = ref<'unread' | 'all'>('unread')

const all = computed(() => forum.notificationsOf(props.userId))
const unread = computed(() => all.value.filter(notification => !notification.read))
const rows = computed(() => (filter.value === 'unread' ? unread.value : all.value))

const chips = computed<FilterChipItem[]>(() => [
  { value: 'unread', label: '未读', count: unread.value.length },
  { value: 'all', label: '全部', count: all.value.length },
])

function actorName(notification: Notification): string {
  return forum.userById(notification.actorId)?.displayName ?? '有人'
}

function topicTitle(notification: Notification): string {
  return notification.topicId ? forum.topicById(notification.topicId)?.title ?? '' : ''
}

/** One sentence per kind, in Discourse's wording. */
function sentence(notification: Notification): string {
  const actor = actorName(notification)
  const title = topicTitle(notification)
  switch (notification.type) {
    case 'reply': {
      // The store notifies both the topic author and the author of the post
      // that was answered; only the first of those owns "你的话题".
      const topic = notification.topicId ? forum.topicById(notification.topicId) : undefined
      return topic?.authorId === props.userId
        ? `${actor} 回复了你的话题《${title}》`
        : `${actor} 回复了你在《${title}》中的帖子`
    }
    case 'like':
      return `${actor} 赞了你在《${title}》中的帖子`
    case 'mention':
      return `${actor} 在《${title}》中提到了你`
    case 'follow':
      return `${actor} 关注了你`
    case 'system':
      return `来自${systemSender}的系统消息`
  }
}

/** Where the row goes. System messages have no subject, so they land on 关于. */
function target(notification: Notification): string {
  if (notification.type === 'follow')
    return `/u/${forum.userById(notification.actorId)?.username ?? ''}`
  if (notification.topicId)
    return `/t/${notification.topicId}`
  return '/about'
}

function open(notification: Notification) {
  forum.markRead(notification.id)
  void router.push(target(notification))
}

function markAll() {
  forum.markAllRead(props.userId)
}
</script>

<template>
  <TxStack :gap="16">
    <TxFlex align="center" :gap="8" justify="space-between" wrap="wrap">
      <TxFilterChips
        v-model="filter"
        :items="chips"
        role="tablist"
        aria-label="通知筛选"
      />
      <TxButton
        variant="secondary"
        size="sm"
        icon="i-carbon-checkmark"
        :disabled="unread.length === 0"
        @click="markAll"
      >
        全部标为已读
      </TxButton>
    </TxFlex>

    <TxCard v-if="rows.length" variant="plain" :padding="0">
      <TxStack :gap="0">
        <template v-for="(notification, index) in rows" :key="notification.id">
          <TxCardItem
            clickable
            :icon-class="ICONS[notification.type]"
            :subtitle="fromNow(notification.createdAt)"
            @click="open(notification)"
          >
            <!--
              `.tx-card-item__title` is nowrap + overflow hidden, which cuts a
              sentence this long in half on a phone; the slot lets it wrap.
            -->
            <template #title>
              <span class="whitespace-normal" :class="notification.read ? '' : 'font-semibold'">
                {{ sentence(notification) }}
              </span>
            </template>
            <template #right>
              <TxBadge dot variant="primary" :open="!notification.read" />
            </template>
          </TxCardItem>
          <TxDivider v-if="index < rows.length - 1" />
        </template>
      </TxStack>
    </TxCard>

    <TxEmptyState
      v-else
      variant="no-data"
      :title="filter === 'unread' ? '没有未读通知' : '没有通知'"
      :description="filter === 'unread' ? '有人回复、点赞或提到你时会出现在这里。' : '还没有收到任何通知。'"
    />
  </TxStack>
</template>
