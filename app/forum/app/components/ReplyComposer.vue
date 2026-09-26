<script setup lang="ts">
import type { Post, Topic } from '~/data/types'
import { nextZIndex, toast, toastStore } from '@talex-touch/tuffex/utils'
import { MEMBER_CONTENT_MAX, NAME_CHARS_HINT } from '../../shared/forum-api'
import { quoteDraft } from '../../shared/post-markdown'

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
 * The prefilled quote (`quoteDraft`) goes into PostEditor as written: its
 * preview renders through ForumMarkdown, so raw HTML in someone else's post
 * shows as text there, as it does on the page.
 *
 * Against the forum server the drawer closes as soon as a reply is sent
 * (#145). A reply the server refuses comes back into the drawer with the post
 * it answered, in front of whatever the drawer holds by then, so nothing
 * typed is lost: not when another reply was started meanwhile, not when two
 * were refused, not when the page was left before the refusal arrived.
 */
const props = defineProps<{
  visible: boolean
  topic: Topic
  /** Reply target; absent means a reply to the topic itself. */
  replyTo?: Post
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  /** A refused reply goes back to the post it answered (`undefined`: the topic). */
  'update:replyTo': [post: Post | undefined]
  'submitted': [postId: string]
}>()

const forum = useForumStore()
const server = useForumServerStore()
const actions = useForumActions()
const { serverMode } = useContentSource()
const { user, can, guestCanReply } = useCurrentUser()

const content = ref('')
/** The draft as it will be sent. */
const text = computed(() => content.value.trim())
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

// TxDrawer keeps its content mounted while closed, PostEditor included, so a
// new key per open is what starts every reply in 编辑 (#144). The draft lives
// in `content`, not in the editor, so it survives the new editor.
const editorKey = ref(0)

// At the bottom right a toast would lie over this drawer's 取消 and 回复, so
// while it is open app.vue shows toasts at the top (#162).
const { composerOpen } = useShell()
watch(() => props.visible, (visible) => {
  composerOpen.value = visible
}, { immediate: true })
onBeforeUnmount(() => {
  composerOpen.value = false
})

// Prefill on open only: reopening the same target must not stack a second
// quote on top of a draft the author is still writing.
watch(() => props.visible, (visible) => {
  if (!visible)
    return
  submitting.value = false
  editorKey.value += 1
  if (!content.value.trim())
    content.value = props.replyTo ? quoteDraft(props.replyTo) : ''
})

function close() {
  emit('update:visible', false)
}

/**
 * Puts this topic's refused replies back (stores/forum-server.ts keeps them):
 * each one in front of what the drawer holds, a blank line between, and the
 * drawer answers the post the last of them answered.
 *
 * The toast saying why came first and took a z-index; the drawer takes the
 * next one as it opens and its mask would cover the toast (#162). Once the
 * drawer has opened, the toasts take another one and are on top again.
 */
function takeBackRefused() {
  const refused = server.takeRefusedReplies(props.topic.id)
  const last = refused.at(-1)
  if (!last)
    return
  let draft = content.value.trim() ? content.value : ''
  for (const reply of refused)
    draft = draft ? `${reply.content}\n\n${draft}` : reply.content
  content.value = draft
  emit('update:replyTo', last.replyToPostId ? forum.postById(last.replyToPostId) : undefined)
  emit('update:visible', true)
  void nextTick(() => {
    toastStore.zIndex = nextZIndex()
  })
}

onMounted(takeBackRefused)
watch(() => server.refusedReplies.length, takeBackRefused)

/**
 * The reply is on the page as soon as this is called (against the server under
 * a `pending:` id, see stores/forum-server.ts), so the panel closes at once and
 * the page is told where it is. 回复已发布 waits for the server; if it refuses,
 * its toast says why and the text goes to the server store with its target,
 * from where `takeBackRefused` puts it back.
 */
async function submit() {
  const current = user.value
  const body = text.value
  if (!canSend.value || submitting.value)
    return
  const topicId = props.topic.id
  const replyToPostId = props.replyTo?.id
  let shownId: string | null = null
  const shown = (postId: string) => {
    shownId = postId
    emit('submitted', postId)
  }
  let sending: Promise<string | null>
  if (current && can('reply', { topic: props.topic }))
    sending = actions.createPost({ topicId: props.topic.id, authorId: current.id, content: body, ...(replyToPostId ? { replyToPostId } : {}) }, shown)
  else if (asGuest.value) {
    const token = turnstileToken.value
    // Spent either way: the server accepts a token once.
    if (turnstileSiteKey.value)
      turnstileRound.value += 1
    sending = actions.replyAsGuest({
      topicId: props.topic.id,
      content: body,
      name: guestName.value.trim(),
      ...(replyToPostId ? { replyToPostId } : {}),
      ...(token ? { turnstileToken: token } : {}),
    }, shown)
  }
  else {
    return
  }
  submitting.value = true
  content.value = ''
  emit('update:visible', false)
  try {
    const postId = await sending
    if (!postId) {
      server.keepRefusedReply({ topicId, content: body, ...(replyToPostId ? { replyToPostId } : {}) })
      return
    }
    toast({ title: '回复已发布', variant: 'success' })
    if (postId !== shownId)
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
    :size="asGuest ? (turnstileSiteKey ? 660 : 580) : 460"
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

      <PostEditor
        :key="editorKey"
        v-model="content"
        :min-height="240"
        placeholder="写下你的回复，支持 Markdown…"
        label="回复内容"
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
