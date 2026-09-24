<script setup lang="ts">
import type { TxSelectOption } from '@talex-touch/tuffex/select'
import type { Topic } from '~/data/types'
import { toast } from '@talex-touch/tuffex/utils'

/**
 * Discourse's bar under the last post: bookmark the topic, share it, pick a
 * notification level, reply. A closed topic replaces the reply button with the
 * reason it is gone; a guest gets the login prompt instead of the whole bar.
 */
const props = defineProps<{ topic: Topic }>()

const emit = defineEmits<{ reply: [] }>()

const forum = useForumStore()
const { user, isLoggedIn, can } = useCurrentUser()
const { loginOpen } = useShell()
const { isSnapshot } = useContentSource()
const { absoluteUrl } = useAppLink()

// Notification level is page-local mock state: there is no subscription model
// in the store, and inventing one would be state nothing else can read.
const NOTIFICATION_LEVELS: TxSelectOption[] = [
  { value: 'watching', label: '关注', icon: 'i-carbon-view', description: '每条新回复都通知我' },
  { value: 'tracking', label: '跟踪', icon: 'i-carbon-bookmark', description: '有人回复我时通知' },
  { value: 'normal', label: '常规', icon: 'i-carbon-notification', description: '被提及或回复时通知' },
  { value: 'muted', label: '静音', icon: 'i-carbon-notification-off', description: '不再通知' },
]
const notificationLevel = ref('tracking')

const firstPost = computed(() => forum.firstPostOf(props.topic.id))
const bookmarked = computed(() =>
  !!user.value && !!firstPost.value && forum.isBookmarked(user.value.id, firstPost.value.id))
const canReply = computed(() => can('reply', { topic: props.topic }))
const shareLink = computed(() => absoluteUrl(`/t/${props.topic.id}`))

function bookmark() {
  const current = user.value
  const post = firstPost.value
  if (!current || !post || !can('bookmark')) {
    loginOpen.value = true
    return
  }
  const added = forum.toggleBookmark(current.id, post.id)
  toast({ title: added ? '已加入书签' : '已移出书签', variant: 'success' })
}
</script>

<template>
  <TxCard variant="plain">
    <TxEmptyState
      v-if="!isLoggedIn"
      variant="permission"
      size="small"
      layout="horizontal"
      :title="isSnapshot ? '回复还没开放' : '登录后参与讨论'"
      :description="isSnapshot ? '回复、点赞和收藏正在接入。' : '选择一个身份即可回复、点赞和收藏。'"
      :primary-action="isSnapshot ? undefined : { label: '登录', variant: 'primary' }"
      @primary="loginOpen = true"
    />

    <TxStack v-else :gap="12">
      <TxFlex align="center" :gap="8" wrap="wrap">
        <TxIconButton
          :icon="bookmarked ? 'i-carbon-bookmark-filled' : 'i-carbon-bookmark'"
          :pressed="bookmarked"
          label="书签"
          @click="bookmark"
        />
        <TxCopyButton :text="shareLink" copy-label="分享" copied-label="链接已复制" />
        <TxSelect
          v-model="notificationLevel"
          :options="NOTIFICATION_LEVELS"
          placeholder="通知级别"
        />

        <TxButton
          v-if="canReply"
          variant="primary"
          icon="i-carbon-reply"
          class="ml-auto"
          @click="emit('reply')"
        >
          回复
        </TxButton>
      </TxFlex>

      <TxAlert
        v-if="!canReply"
        type="warning"
        title="此话题已关闭，不再接受新回复"
        message="如果还有要补充的内容，可以联系管理团队重新开放。"
      />
    </TxStack>
  </TxCard>
</template>
