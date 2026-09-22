<script setup lang="ts">
import type { Post, Topic } from '~/data/types'
import { toast } from '@talex-touch/tuffex/utils'

/**
 * One post in Discourse's stream: avatar on the left, and on the right the
 * header row (author · role · time · reply backlink · #floor), the Markdown
 * body, and the control row.
 *
 * Every write control asks `can()` first. A control a guest can still see —
 * the like button — routes to the login modal instead of failing silently.
 */
const props = defineProps<{
  post: Post
  topic: Topic
  /** 1-based position in the thread; Discourse's "#n". */
  floor: number
  /** Highlights the card after a jump or a fresh reply. */
  flash?: boolean
}>()

const emit = defineEmits<{
  /** Open the composer with this post as the reply target. */
  reply: [post: Post]
  /** Scroll to the post this one answers. */
  jump: [postId: string]
}>()

const forum = useForumStore()
const { user, can } = useCurrentUser()
const { loginOpen } = useShell()
const { fromNow, formatAbsolute } = useRelativeTime()

const author = computed(() => forum.userById(props.post.authorId))
const replyTarget = computed(() => (props.post.replyToPostId ? forum.postById(props.post.replyToPostId) : undefined))
const replyTargetUser = computed(() => (replyTarget.value ? forum.userById(replyTarget.value.authorId) : undefined))

const liked = computed(() => !!user.value && props.post.likeUserIds.includes(user.value.id))
const bookmarked = computed(() => !!user.value && forum.isBookmarked(user.value.id, props.post.id))

const canEdit = computed(() => !props.post.deleted && can('editPost', { post: props.post, topic: props.topic }))
// The store refuses to delete the post that carries the topic, so that one is
// never offered rather than failing when picked.
const canDelete = computed(() => canEdit.value && !forum.isFirstPost(props.post.id))
const canReply = computed(() => !props.post.deleted && can('reply', { topic: props.topic }))

/** Absolute, so the copied link survives being pasted anywhere. */
const permalink = computed(() => `${window.location.origin}/t/${props.topic.id}#post-${props.post.id}`)

const editing = ref(false)
const draft = ref('')

function like() {
  const current = user.value
  if (!current || !can('like')) {
    loginOpen.value = true
    return
  }
  forum.toggleLike(props.post.id, current.id)
}

function bookmark() {
  const current = user.value
  if (!current || !can('bookmark')) {
    loginOpen.value = true
    return
  }
  const added = forum.toggleBookmark(current.id, props.post.id)
  toast({ title: added ? '已加入书签' : '已移出书签', variant: 'success' })
}

function startEdit() {
  draft.value = props.post.content
  editing.value = true
}

function saveEdit() {
  if (!draft.value.trim() || !forum.editPost(props.post.id, draft.value))
    return
  editing.value = false
  toast({ title: '帖子已更新', variant: 'success' })
}

function remove() {
  if (!canDelete.value || !forum.deletePost(props.post.id))
    return
  toast({ title: '帖子已删除' })
}
</script>

<template>
  <!--
    The wrapper carries the anchor and the post-jump highlight: `scroll-mt`
    keeps the sticky header off the target, and the flash is a class rather
    than an inline style so it can transition.
  -->
  <div
    :id="`post-${post.id}`"
    class="scroll-mt-24 rounded-xl transition-shadow"
    :class="flash ? 'ring-2 ring-$tx-color-primary' : ''"
  >
    <TxCard variant="plain" :padding="16">
      <TxFlex :gap="14" align="start">
        <UserAvatar v-if="author" :user="author" size="large" clickable />

        <TxFlex direction="column" :gap="8" class="min-w-0 flex-1">
          <TxFlex align="center" :gap="8" wrap="wrap">
            <TxCellLink
              v-if="author"
              :href="`/u/${author.username}`"
              :label="author.displayName"
              @open="navigateTo(`/u/${author.username}`)"
            />
            <TxStatusBadge
              v-if="author && author.role !== 'member'"
              :text="roleLabel(author.role)"
              :status="roleTone(author.role)"
              size="sm"
            />
            <TxTooltip :content="formatAbsolute(post.createdAt)">
              <span class="text-sm text-$tx-text-color-secondary">{{ fromNow(post.createdAt) }}</span>
            </TxTooltip>
            <TxTooltip v-if="post.editedAt" :content="`编辑于 ${formatAbsolute(post.editedAt)}`">
              <span class="text-sm text-$tx-text-color-secondary">已编辑</span>
            </TxTooltip>
            <TxButton
              v-if="replyTarget && replyTargetUser"
              variant="bare"
              size="sm"
              icon="i-carbon-reply"
              @click="emit('jump', replyTarget.id)"
            >
              回复 @{{ replyTargetUser.username }}
            </TxButton>
            <span class="ml-auto text-sm text-$tx-text-color-secondary">#{{ floor }}</span>
          </TxFlex>

          <TxAlert v-if="post.deleted" type="info" message="此帖已被删除" />

          <template v-else-if="editing">
            <TxMarkdownEditor
              v-model="draft"
              default-mode="source"
              :min-height="200"
              aria-label="编辑帖子内容"
              placeholder="修改这条帖子…"
            />
            <TxFlex justify="flex-end" :gap="8">
              <TxButton variant="secondary" size="sm" @click="editing = false">
                取消
              </TxButton>
              <TxButton variant="primary" size="sm" :disabled="!draft.trim()" @click="saveEdit">
                保存
              </TxButton>
            </TxFlex>
          </template>

          <template v-else>
            <div class="overflow-x-auto max-w-full">
              <TxMarkdownView :content="post.content" />
            </div>

            <!--
              Two groups rather than one row split by `ml-auto`: this row wraps
              on a phone, and a margin-based split pushes the right-hand group
              off the card instead of dropping it onto its own line.
            -->
            <TxFlex align="center" :gap="8" justify="space-between" wrap="wrap">
              <TxFlex align="center" :gap="4" wrap="wrap">
                <TxButton
                  variant="bare"
                  size="sm"
                  :icon="liked ? 'i-carbon-favorite-filled' : 'i-carbon-favorite'"
                  :aria-pressed="liked"
                  aria-label="赞"
                  @click="like"
                >
                  {{ post.likeUserIds.length || '' }}
                </TxButton>
                <TxCopyButton
                  :text="permalink"
                  copy-label="链接"
                  copied-label="已复制"
                  size="sm"
                />
                <TxIconButton
                  :icon="bookmarked ? 'i-carbon-bookmark-filled' : 'i-carbon-bookmark'"
                  :pressed="bookmarked"
                  label="书签"
                  size="sm"
                  @click="bookmark"
                />
              </TxFlex>

              <TxFlex align="center" :gap="4" wrap="wrap">
                <TxButton
                  v-if="canEdit"
                  variant="bare"
                  size="sm"
                  icon="i-carbon-edit"
                  @click="startEdit"
                >
                  编辑
                </TxButton>
                <!-- No class on the menu itself: TxBaseAnchor forwards attrs to the teleported panel. -->
                <TxDropdownMenu v-if="canDelete" placement="bottom-end">
                  <template #trigger>
                    <TxIconButton icon="i-carbon-overflow-menu-horizontal" label="更多操作" size="sm" />
                  </template>
                  <TxDropdownItem danger @select="remove">
                    删除
                  </TxDropdownItem>
                </TxDropdownMenu>
                <TxButton
                  v-if="canReply"
                  variant="secondary"
                  size="sm"
                  icon="i-carbon-reply"
                  @click="emit('reply', post)"
                >
                  回复
                </TxButton>
              </TxFlex>
            </TxFlex>
          </template>
        </TxFlex>
      </TxFlex>
    </TxCard>
  </div>
</template>
