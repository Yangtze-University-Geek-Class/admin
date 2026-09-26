<script setup lang="ts">
import type { Post, Topic } from '~/data/types'
import { toast } from '@talex-touch/tuffex/utils'
import { MEMBER_CONTENT_MAX, NAME_CHARS_HINT } from '../../shared/forum-api'
import { fromEditor, quoteDraft } from '../../shared/post-markdown'

/**
 * Discourse's composer: a panel that slides up from the bottom of the topic
 * instead of a separate page, so the thread stays readable behind it.
 *
 * Opening it with a `replyTo` post prefills a Markdown quote, which is what
 * turns the new post into a reply with a backlink.
 *
 * In 极客班论坛 someone who is not signed in replies as a guest: a nickname
 * field joins the panel, the text is capped at `guestPolicy.contentMax`, and
 * the server store computes the proof of work right before sending. When the
 * server has Turnstile configured, the guest also passes that check; its token
 * is single-use, so every send renders a fresh widget.
 *
 * The prefilled quote is someone else's text, so it goes into the editor
 * through `quoteDraft` (raw HTML shown as text); what is sent is `fromEditor`
 * of the draft.
 */
const props = defineProps<{
  visible: boolean
  topic: Topic
  /** Reply target; absent means a reply to the topic itself. */
  replyTo?: Post
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'submitted': [postId: string]
}>()

const forum = useForumStore()
const server = useForumServerStore()
const actions = useForumActions()
const { serverMode } = useContentSource()
const { user, can, guestCanReply } = useCurrentUser()

const content = ref('')
/** The draft as it will be sent. */
const text = computed(() => fromEditor(content.value).trim())
const guestName = ref('')
const submitting = ref(false)

const asGuest = computed(() => !user.value && guestCanReply(props.topic))
const contentMax = computed(() => (asGuest.value ? server.guestPolicy.contentMax : serverMode ? MEMBER_CONTENT_MAX : Number.POSITIVE_INFINITY))
const nameMax = computed(() => server.guestPolicy.nameMax)
const tooLong = computed(() => text.value.length > contentMax.value)
const nameMissing = computed(() => asGuest.value && !guestName.value.trim())
const nameTooLong = computed(() => asGuest.value && guestName.value.trim().length > nameMax.value)
const turnstileSiteKey = computed(() => (asGuest.value ? server.guestPolicy.turnstileSiteKey : null))
const turnstileToken = ref('')
const turnstileRound = ref(0)
const turnstileMissing = computed(() => !!turnstileSiteKey.value && !turnstileToken.value)
const canSend = computed(() => !!text.value && !tooLong.value && !nameMissing.value && !nameTooLong.value && !turnstileMissing.value)

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
    content.value = props.replyTo ? quoteDraft(props.replyTo) : ''
})

function close() {
  emit('update:visible', false)
}

async function submit() {
  const current = user.value
  const body = text.value
  if (!canSend.value || submitting.value)
    return
  const replyToPostId = props.replyTo?.id
  submitting.value = true
  try {
    let postId: string | null = null
    if (current && can('reply', { topic: props.topic }))
      postId = await actions.createPost({ topicId: props.topic.id, authorId: current.id, content: body, ...(replyToPostId ? { replyToPostId } : {}) })
    else if (asGuest.value) {
      const token = turnstileToken.value
      // Spent either way: the server accepts a token once.
      if (turnstileSiteKey.value)
        turnstileRound.value += 1
      postId = await actions.replyAsGuest({
        topicId: props.topic.id,
        content: body,
        name: guestName.value.trim(),
        ...(replyToPostId ? { replyToPostId } : {}),
        ...(token ? { turnstileToken: token } : {}),
      })
    }
    if (!postId)
      return
    content.value = ''
    emit('update:visible', false)
    toast({ title: '回复已发布', variant: 'success' })
    emit('submitted', postId)
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
    :size="asGuest ? (turnstileSiteKey ? 660 : 580) : 420"
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

    <TxStack :gap="12">
      <TxFlex v-if="asGuest" align="center" :gap="12" wrap="wrap">
        <TxInput
          v-model="guestName"
          placeholder="你的昵称"
          aria-label="昵称"
          :maxlength="nameMax"
          prefix-icon="i-carbon-user"
          class="w-64"
        />
        <span class="text-sm text-$tx-text-color-secondary">
          没登录，以游客身份回复。昵称最多 {{ nameMax }} 个字，{{ NAME_CHARS_HINT }}；正文最多 {{ server.guestPolicy.contentMax }} 字。
        </span>
      </TxFlex>

      <TxMarkdownEditor
        v-model="content"
        default-mode="source"
        :min-height="240"
        placeholder="写下你的回复，支持 Markdown…"
        aria-label="回复内容"
      />

      <TurnstileBox v-if="turnstileSiteKey" v-model:token="turnstileToken" :site-key="turnstileSiteKey" :round="turnstileRound" />

      <p v-if="tooLong" class="text-sm text-$tx-color-danger">
        正文超过了 {{ contentMax }} 字，删减一些再发。
      </p>
      <p v-else-if="nameTooLong" class="text-sm text-$tx-color-danger">
        昵称超过了 {{ nameMax }} 个字。
      </p>
    </TxStack>

    <template #footer>
      <TxFlex justify="flex-end" :gap="8">
        <TxButton variant="secondary" @click="close">
          取消
        </TxButton>
        <TxButton
          variant="primary"
          :loading="submitting"
          :disabled="!canSend"
          @click="submit"
        >
          {{ asGuest ? '以游客身份回复' : '回复' }}
        </TxButton>
      </TxFlex>
    </template>
  </TxDrawer>
</template>
