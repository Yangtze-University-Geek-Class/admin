<script setup lang="ts">
import type { Post, Topic } from '~/data/types'
import { toast } from '@talex-touch/tuffex/utils'
import { likeControl } from '~/data/likes'
import { isPending } from '~/stores/forum-server'

/**
 * One post in Discourse's stream: avatar on the left, and on the right the
 * header row (author · role · time · reply backlink · #floor), the Markdown
 * body, and the control row.
 *
 * Every write control asks `can()` first. A control a guest can still see —
 * the like button — routes to the login modal instead of failing silently.
 * The like button spells itself out (「赞 3」, data/likes.ts, #143).
 *
 * A reply still being sent (a `pending:` id, #145) has nothing on the server
 * to like, link, edit or answer yet: the card says 发送中 instead of its
 * controls, and the server's post replaces it when the answer is in.
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
const actions = useForumActions()
const { user, can, guestCanReply } = useCurrentUser()
const { loginOpen } = useShell()
const { fromNow, formatAbsolute } = useRelativeTime()
const { href, absoluteUrl } = useAppLink()

const author = computed(() => forum.userById(props.post.authorId))
const replyTarget = computed(() => (props.post.replyToPostId ? forum.postById(props.post.replyToPostId) : undefined))
const replyTargetUser = computed(() => (replyTarget.value ? forum.userById(replyTarget.value.authorId) : undefined))

const sending = computed(() => isPending(props.post.id))
const likeState = computed(() => likeControl(props.post, user.value, can('like')))
const bookmarked = computed(() => !!user.value && forum.isBookmarked(user.value.id, props.post.id))

const canEdit = computed(() => !props.post.deleted && !sending.value && can('editPost', { post: props.post, topic: props.topic }))
// The store refuses to delete the post that carries the topic, so that one is
// never offered rather than failing when picked.
const canDelete = computed(() => canEdit.value && !forum.isFirstPost(props.post.id))
// A guest (极客班论坛, not signed in) may answer a post too, under a nickname.
const canReply = computed(() => !props.post.deleted && !sending.value && (can('reply', { topic: props.topic }) || guestCanReply(props.topic)))

/** Absolute and under the app base, so the copied link survives being pasted anywhere. */
const permalink = computed(() => absoluteUrl({ path: `/t/${props.topic.id}`, hash: `#post-${props.post.id}` }))

const editing = ref(false)
const draft = ref('')

// The write path (how fast the button answers, what a quick second click does) is useForumActions' business (#145).
function like() {
  const current = user.value
  if (!current || likeState.value.click === 'prompt') {
    loginOpen.value = true
    return
  }
  void actions.toggleLike(props.post.id, current.id)
}

// Bookmarks, edits and deletions show before the call returns (#145); a
// refusal puts the post back as it was, with the server store's toast. The
// success toast waits for the server (#162), and quick clicks share one: it
// names what the server settled on.
async function bookmark() {
  const current = user.value
  if (!current || !can('bookmark')) {
    loginOpen.value = true
    return
  }
  const settled = await actions.toggleBookmark(current.id, props.post.id)
  if (settled !== null)
    toast({ id: `forum-bookmark:${props.post.id}`, title: settled ? '已加入书签' : '已移出书签', variant: 'success' })
}

// Someone else's post can be in the editor (a moderator's edit); PostEditor's preview renders it through ForumMarkdown, raw HTML shown as text.
function startEdit() {
  draft.value = props.post.content
  editing.value = true
}

/**
 * Numbers the saves: a save while an earlier one is still out joins its
 * request (stores/forum-server.ts), and both get the same answer. Only the
 * latest one acts on it, so 帖子已更新 says so once and a refusal reopens the
 * editor on the text saved last, not on an older one.
 */
let saves = 0

/** The editor closes on the new text; 帖子已更新 waits for the server, and a refusal reopens the editor on this draft. */
async function saveEdit() {
  if (!draft.value.trim())
    return
  const text = draft.value
  saves += 1
  const round = saves
  const saved = actions.editPost(props.post.id, draft.value)
  editing.value = false
  const done = await saved
  if (round !== saves)
    return
  if (!done) {
    if (!editing.value) {
      draft.value = text
      editing.value = true
    }
    return
  }
  toast({ title: '帖子已更新', variant: 'success' })
}

async function remove() {
  if (!canDelete.value)
    return
  if (await actions.deletePost(props.post.id))
    toast({ id: `forum-delete:${props.post.id}`, title: '帖子已删除' })
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
    :aria-busy="sending ? 'true' : undefined"
  >
    <TxCard variant="plain" :padding="16">
      <TxFlex :gap="14" align="start">
        <UserAvatar v-if="author" :user="author" size="large" clickable />

        <TxFlex direction="column" :gap="8" class="min-w-0 flex-1">
          <TxFlex align="center" :gap="8" wrap="wrap">
            <TxCellLink
              v-if="author"
              :href="href(`/u/${author.username}`)"
              :label="author.displayName"
              @open="navigateTo(`/u/${author.username}`)"
            />
            <!-- The 极客班 title when there is one; the forum role badge otherwise. -->
            <TitleBadge v-if="author?.title" :title="author.title" />
            <!-- 极客班论坛：没登录、用昵称回复的人；只写一个词说明身份，不做成徽章 -->
            <span v-else-if="author?.kind === 'guest'" class="text-xs text-$tx-text-color-secondary">游客</span>
            <TxStatusBadge
              v-else-if="author && author.role !== 'member'"
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
            <PostEditor
              v-model="draft"
              :min-height="200"
              label="编辑帖子内容"
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
            <ForumMarkdown :content="post.content" />

            <!--
              Two groups rather than one row split by `ml-auto`: this row wraps
              on a phone, and a margin-based split pushes the right-hand group
              off the card instead of dropping it onto its own line.
            -->
            <TxFlex v-if="!sending" align="center" :gap="8" justify="space-between" wrap="wrap">
              <TxFlex align="center" :gap="4" wrap="wrap">
                <!-- No aria-label: the visible 「赞 3」 is the name, so a screen reader hears the count too. -->
                <TxButton
                  variant="flat"
                  :type="likeState.tone"
                  size="sm"
                  :icon="likeState.icon"
                  :aria-pressed="likeState.liked"
                  @click="like"
                >
                  {{ likeState.label }}
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
            <span v-else class="text-sm text-$tx-text-color-secondary">发送中</span>
          </template>
        </TxFlex>
      </TxFlex>
    </TxCard>
  </div>
</template>
