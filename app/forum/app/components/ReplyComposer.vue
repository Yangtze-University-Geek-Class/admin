<script setup lang="ts">
import type { Post, Topic } from '~/data/types'
import { toast } from '@talex-touch/tuffex/utils'

/**
 * Discourse's composer: a panel that slides up from the bottom of the topic
 * instead of a separate page, so the thread stays readable behind it.
 *
 * Opening it with a `replyTo` post prefills a Markdown quote, which is what
 * turns the new post into a reply with a backlink.
 */
const props = defineProps<{
  visible: boolean
  topic: Topic
  /** Reply target; absent means a reply to the topic itself. */
  replyTo?: Post
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'submitted': [post: Post]
}>()

const QUOTE_LENGTH = 80

const forum = useForumStore()
const { user, can } = useCurrentUser()

const content = ref('')
const submitting = ref(false)

const replyToUser = computed(() => (props.replyTo ? forum.userById(props.replyTo.authorId) : undefined))
const replyToFloor = computed(() => {
  if (!props.replyTo)
    return 0
  return forum.postsOfTopic(props.topic.id).findIndex(post => post.id === props.replyTo?.id) + 1
})

const title = computed(() => (replyToUser.value
  ? `回复 @${replyToUser.value.username} 的 #${replyToFloor.value}`
  : `回复：${props.topic.title}`))

// Prefill on open only: reopening the same target must not stack a second
// quote on top of a draft the author is still writing.
watch(() => props.visible, (visible) => {
  if (!visible)
    return
  submitting.value = false
  if (!content.value.trim())
    content.value = props.replyTo ? `> ${postExcerpt(props.replyTo.content, QUOTE_LENGTH)}\n\n` : ''
})

function close() {
  emit('update:visible', false)
}

function submit() {
  const current = user.value
  if (!current || !can('reply', { topic: props.topic }) || !content.value.trim())
    return

  submitting.value = true
  try {
    const post = forum.createPost({
      topicId: props.topic.id,
      authorId: current.id,
      content: content.value.trim(),
      ...(props.replyTo ? { replyToPostId: props.replyTo.id } : {}),
    })
    content.value = ''
    emit('update:visible', false)
    toast({ title: '回复已发布', variant: 'success' })
    emit('submitted', post)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <TxDrawer
    :visible="visible"
    direction="bottom"
    :size="420"
    :close-on-click-mask="false"
    :title="title"
    @update:visible="emit('update:visible', $event)"
  >
    <template #header>
      <TxFlex align="center" :gap="8">
        <i class="i-carbon-reply" aria-hidden="true" />
        <span class="font-medium">{{ title }}</span>
      </TxFlex>
    </template>

    <TxMarkdownEditor
      v-model="content"
      default-mode="source"
      :min-height="240"
      placeholder="写下你的回复，支持 Markdown…"
      aria-label="回复内容"
    />

    <template #footer>
      <TxFlex justify="flex-end" :gap="8">
        <TxButton variant="secondary" @click="close">
          取消
        </TxButton>
        <TxButton
          variant="primary"
          :loading="submitting"
          :disabled="!content.trim()"
          @click="submit"
        >
          回复
        </TxButton>
      </TxFlex>
    </template>
  </TxDrawer>
</template>
