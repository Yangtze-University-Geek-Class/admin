<script setup lang="ts">
import type { FilterChipItem } from '@talex-touch/tuffex/filter-chips'
import type { ActivityEvent, ActivityKind } from '~/stores/forum'

// Discourse's /u/<name>: the profile banner, the stat strip and the
// 摘要 / 活动 / 通知 / 偏好设置 tabs. The last two only exist for yourself.
definePageMeta({
  // Re-run setup when the username changes; the query string must not remount.
  key: route => route.path,
})

const SUMMARY_COUNT = 5
/**
 * `activityOfUser` caps a *mixed* list, so a small cap would let one busy kind
 * crowd the others out of the chip counts. Scan wide, count per kind, and cap
 * only what is rendered.
 */
const ACTIVITY_SCAN = 500
const ACTIVITY_PAGE = 30

const ACTIVITY_ICONS: Record<ActivityKind, string> = {
  topic: 'i-carbon-forum',
  reply: 'i-carbon-reply',
  like: 'i-carbon-favorite',
  bookmark: 'i-carbon-bookmark',
}

const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  topic: '发布了话题',
  reply: '回复了',
  like: '赞了',
  bookmark: '收藏了',
}

const route = useRoute()
const router = useRouter()
const forum = useForumStore()
const { user: viewer, can } = useCurrentUser()
const { loginOpen } = useShell()
const { fromNow, formatDate } = useRelativeTime()

const username = String(route.params.username)
// Read through the store, not captured: a profile edit (or 重置示例数据, which
// replaces the whole state) must reach the banner without a remount.
const profile = computed(() => forum.userByUsername(username))

// Raised rather than thrown: a `throw` aborts setup but Vue still renders the
// template once with every binding undefined, which logs a pile of warnings on
// the way to the error page. h3 also wants the prose in `message`.
if (!profile.value) {
  showError(createError({
    statusCode: 404,
    statusMessage: 'Not Found',
    message: '这个用户不存在，用户名可能拼错了。',
    fatal: true,
  }))
}

useHead({ title: () => profile.value?.displayName ?? '用户' })

const isSelf = computed(() => !!profile.value && viewer.value?.id === profile.value.id)
const stats = computed(() => (profile.value ? forum.statsOfUser(profile.value.id) : undefined))
const following = computed(() => !!profile.value && !!viewer.value && forum.isFollowing(viewer.value.id, profile.value.id))
const canFollow = computed(() => !!profile.value && can('follow', { targetUser: profile.value }))

const statCards = computed(() => {
  const value = stats.value
  if (!value)
    return []
  return [
    { key: 'topics', label: '话题', value: value.topics, icon: 'i-carbon-forum' },
    { key: 'replies', label: '帖子', value: value.replies, icon: 'i-carbon-chat' },
    { key: 'likesReceived', label: '已收到的赞', value: value.likesReceived, icon: 'i-carbon-favorite' },
    { key: 'likesGiven', label: '已送出的赞', value: value.likesGiven, icon: 'i-carbon-favorite-filled' },
    { key: 'followers', label: '关注者', value: value.followers, icon: 'i-carbon-user-multiple' },
    { key: 'following', label: '正在关注', value: value.following, icon: 'i-carbon-user-follow' },
  ]
})

// ------------------------------------------------------------------ the tabs

/** ASCII tab names so `?tab=activity` (which the header links to) round-trips. */
const TABS = ['summary', 'activity', 'notifications', 'preferences'] as const
type TabName = typeof TABS[number]

const visibleTabs = computed<TabName[]>(() => (isSelf.value ? [...TABS] : ['summary', 'activity']))

function normalizeTab(value: unknown): TabName {
  const name = String(value ?? '')
  return visibleTabs.value.includes(name as TabName) ? (name as TabName) : 'summary'
}

const tab = ref<TabName>(normalizeTab(route.query.tab))

// Switching identity can take the notifications tab away underneath us.
watch(visibleTabs, () => {
  tab.value = normalizeTab(tab.value)
})

watch(() => route.query.tab, value => {
  tab.value = normalizeTab(value)
})

function onTab(value: string) {
  const next = normalizeTab(value)
  tab.value = next
  void router.replace({ path: route.path, query: next === 'summary' ? {} : { tab: next } })
}

// --------------------------------------------------------------- tab content

const topReplies = computed(() => (profile.value ? forum.topLikedPostsOfUser(profile.value.id, SUMMARY_COUNT) : []))
const topTopics = computed(() => (profile.value ? forum.topTopicsOfUser(profile.value.id, SUMMARY_COUNT) : []))
const likers = computed(() => (profile.value ? forum.mostLikedByUsers(profile.value.id) : []))

const activityKind = ref<ActivityKind | 'all'>('all')
const activityEvents = computed(() => (profile.value ? forum.activityOfUser(profile.value.id, ACTIVITY_SCAN) : []))
const activityMatching = computed(() =>
  activityKind.value === 'all'
    ? activityEvents.value
    : activityEvents.value.filter(event => event.kind === activityKind.value),
)
const activityRows = computed(() => activityMatching.value.slice(0, ACTIVITY_PAGE))

const activityChips = computed<FilterChipItem[]>(() => [
  { value: 'all', label: '全部', count: activityEvents.value.length },
  ...(['topic', 'reply', 'like', 'bookmark'] as const).map(kind => ({
    value: kind,
    label: { topic: '话题', reply: '回复', like: '赞', bookmark: '书签' }[kind],
    iconClass: ACTIVITY_ICONS[kind],
    count: activityEvents.value.filter(event => event.kind === kind).length,
  })),
])

function titleOf(topicId: string): string {
  return forum.topicById(topicId)?.title ?? '(话题已不存在)'
}

function excerptOf(postId: string | undefined): string {
  return postId ? postExcerpt(forum.postById(postId)?.content ?? '', 80) : ''
}

function openTopic(topicId: string) {
  void router.push(`/t/${topicId}`)
}

function openActivity(event: ActivityEvent) {
  openTopic(event.topicId)
}

function openPreferences() {
  if (profile.value)
    void router.push(`/u/${profile.value.username}/preferences`)
}

function toggleFollow() {
  const target = profile.value
  if (!target)
    return
  if (!viewer.value) {
    loginOpen.value = true
    return
  }
  if (!canFollow.value)
    return
  forum.toggleFollow(viewer.value.id, target.id)
}

function openWebsite(href: string) {
  window.open(href, '_blank', 'noopener')
}
</script>

<template>
  <TxStack v-if="profile" :gap="16">
    <TxCard>
      <TxCardItem>
        <template #avatar>
          <UserAvatar :user="profile" size="xlarge" />
        </template>

        <template #title>
          <TxFlex align="center" :gap="8" wrap="wrap" class="whitespace-normal">
            <span class="text-xl font-semibold">{{ profile.displayName }}</span>
            <!--
              The profile is the full identity card: the 极客班 title and, for
              admins and moderators, the forum role as well.
            -->
            <TitleBadge v-if="profile.title" :title="profile.title" size="md" />
            <TxStatusBadge
              v-if="profile.role !== 'member'"
              :text="roleLabel(profile.role)"
              :status="roleTone(profile.role)"
              size="sm"
            />
          </TxFlex>
        </template>

        <template #subtitle>
          <!-- `.tx-card-item__subtitle` is nowrap too: "@talex · 加入于…" is cut on a phone. -->
          <span class="whitespace-normal">@{{ profile.username }} · 加入于 {{ formatDate(profile.joinedAt) }}</span>
        </template>

        <template #description>
          <TxStack :gap="6">
            <span v-if="profile.bio" class="whitespace-normal">{{ profile.bio }}</span>
            <TxFlex align="center" :gap="12" wrap="wrap">
              <span v-if="profile.location" class="inline-flex items-center gap-1">
                <i class="i-carbon-location" aria-hidden="true" />
                <span>{{ profile.location }}</span>
              </span>
              <!-- TxCellLink never navigates by itself; `external` marks it and we open it. -->
              <TxCellLink
                v-if="profile.website"
                :href="profile.website"
                :label="profile.website"
                external
                @open="openWebsite($event.href)"
              />
            </TxFlex>
          </TxStack>
        </template>

        <template #right>
          <TxFlex :gap="8" wrap="wrap">
            <TxButton
              v-if="!isSelf"
              :variant="following ? 'secondary' : 'primary'"
              :icon="following ? 'i-carbon-checkmark' : 'i-carbon-user-follow'"
              @click="toggleFollow"
            >
              {{ following ? '已关注' : '关注' }}
            </TxButton>
            <TxButton
              v-if="isSelf"
              variant="secondary"
              icon="i-carbon-edit"
              @click="openPreferences"
            >
              编辑资料
            </TxButton>
          </TxFlex>
        </template>
      </TxCardItem>
    </TxCard>

    <TxGrid :cols="{ xs: 2, md: 3, lg: 6 }" :gap="12">
      <TxStatCard
        v-for="card in statCards"
        :key="card.key"
        :value="card.value"
        :label="card.label"
        :icon-class="card.icon"
      />
    </TxGrid>

    <TxCard :padding="0">
      <!-- `placement` defaults to `left`; Discourse runs the profile tabs across the top. -->
      <TxTabs :model-value="tab" placement="top" indicator-variant="pill" @update:model-value="onTab">
        <TxTabItem name="summary">
          <template #name>
            摘要
          </template>

          <TxRow :gutter="16">
            <TxCol :span="24" :lg="8">
              <TxStack :gap="8">
                <h2 class="text-base font-semibold">
                  热门回复
                </h2>
                <TxStack v-if="topReplies.length" :gap="0">
                  <TxCardItem
                    v-for="post in topReplies"
                    :key="post.id"
                    clickable
                    :description="excerptOf(post.id)"
                    @click="openTopic(post.topicId)"
                  >
                    <template #title>
                      <span class="whitespace-normal">{{ titleOf(post.topicId) }}</span>
                    </template>
                    <template #right>
                      <TxTag :label="String(post.likeUserIds.length)" icon="i-carbon-favorite" variant="plain" size="sm" />
                    </template>
                  </TxCardItem>
                </TxStack>
                <TxEmptyState v-else variant="no-data" title="还没有回复" size="small" />
              </TxStack>
            </TxCol>

            <TxCol :span="24" :lg="8">
              <TxStack :gap="8">
                <h2 class="text-base font-semibold">
                  热门话题
                </h2>
                <TxStack v-if="topTopics.length" :gap="0">
                  <TxCardItem
                    v-for="topic in topTopics"
                    :key="topic.id"
                    clickable
                    @click="openTopic(topic.id)"
                  >
                    <template #title>
                      <span class="whitespace-normal">{{ topic.title }}</span>
                    </template>
                    <template #subtitle>
                      <TxFlex align="center" :gap="6" wrap="wrap">
                        <CategoryTag :category="forum.categoryById(topic.categoryId)" />
                        <span class="text-$tx-text-color-secondary">{{ fromNow(topic.lastActivityAt) }}</span>
                      </TxFlex>
                    </template>
                  </TxCardItem>
                </TxStack>
                <TxEmptyState v-else variant="no-data" title="还没有话题" size="small" />
              </TxStack>
            </TxCol>

            <TxCol :span="24" :lg="8">
              <TxStack :gap="8">
                <h2 class="text-base font-semibold">
                  最多点赞的用户
                </h2>
                <template v-if="likers.length">
                  <TxAvatarGroup :max="6" size="medium">
                    <UserAvatar v-for="liker in likers" :key="liker.user.id" :user="liker.user" />
                  </TxAvatarGroup>
                  <TxFlex :gap="6" wrap="wrap">
                    <TxTag
                      v-for="liker in likers"
                      :key="liker.user.id"
                      :label="`${liker.user.displayName} · ${liker.count}`"
                      variant="plain"
                      size="sm"
                    />
                  </TxFlex>
                </template>
                <TxEmptyState v-else variant="no-data" title="还没有人点赞" size="small" />
              </TxStack>
            </TxCol>
          </TxRow>
        </TxTabItem>

        <TxTabItem name="activity">
          <template #name>
            活动
          </template>

          <TxStack :gap="12">
            <TxFilterChips
              v-model="activityKind"
              :items="activityChips"
              role="toolbar"
              aria-label="活动筛选"
            />

            <TxStack v-if="activityRows.length" :gap="0">
              <template v-for="(event, index) in activityRows" :key="`${event.kind}-${event.postId ?? event.topicId}-${event.at}`">
                <TxCardItem
                  clickable
                  :icon-class="ACTIVITY_ICONS[event.kind]"
                  :subtitle="fromNow(event.at)"
                  @click="openActivity(event)"
                >
                  <template #title>
                    <span class="whitespace-normal">
                      {{ ACTIVITY_LABELS[event.kind] }}《{{ titleOf(event.topicId) }}》
                    </span>
                  </template>
                </TxCardItem>
                <TxDivider v-if="index < activityRows.length - 1" />
              </template>
            </TxStack>

            <TxEmptyState v-else variant="no-data" title="没有这类活动" description="换一个筛选条件试试" />

            <p v-if="activityMatching.length > activityRows.length" class="text-center text-sm text-$tx-text-color-secondary">
              只显示最近 {{ activityRows.length }} 条，共 {{ activityMatching.length }} 条
            </p>
          </TxStack>
        </TxTabItem>

        <TxTabItem v-if="isSelf" name="notifications">
          <template #name>
            通知
          </template>
          <NotificationList :user-id="profile.id" />
        </TxTabItem>

        <TxTabItem v-if="isSelf" name="preferences">
          <template #name>
            偏好设置
          </template>
          <TxEmptyState
            variant="guide"
            title="在偏好设置里修改资料"
            description="显示名、简介、头像、通知和界面主题都在那一页。"
            :primary-action="{ label: '打开偏好设置', variant: 'primary', icon: 'i-carbon-settings' }"
            @primary="openPreferences"
          />
        </TxTabItem>
      </TxTabs>
    </TxCard>
  </TxStack>
</template>
