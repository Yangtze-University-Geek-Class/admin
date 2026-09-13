<script setup lang="ts">
import type { Post, User } from '~/data/types'

// Discourse's /search: one tab per result kind, the query living in `?q=` so a
// search can be linked and survives a reload.
useHead({ title: '搜索' })

const EXCERPT_LENGTH = 120
const QUERY_DEBOUNCE_MS = 250

const route = useRoute()
const router = useRouter()
const forum = useForumStore()

const query = ref(String(route.query.q ?? ''))
const trimmed = computed(() => query.value.trim())
const results = computed(() => forum.searchAll(trimmed.value))
const total = computed(() => results.value.topics.length + results.value.posts.length + results.value.users.length)

const tab = ref('话题')

// `replace`, not `push`: typing must not fill the history with one entry per
// keystroke, and the debounce keeps the URL from thrashing mid-word.
const syncQuery = useDebounceFn((value: string) => {
  void router.replace({ path: '/search', query: value ? { q: value } : {} })
}, QUERY_DEBOUNCE_MS)

watch(trimmed, value => syncQuery(value))

// Back/forward and the header's search box both arrive as a route change.
watch(() => route.query.q, (value) => {
  const next = String(value ?? '')
  if (next !== trimmed.value)
    query.value = next
})

function topicOf(post: Post) {
  return forum.topicById(post.topicId)
}

function authorOf(post: Post): string {
  return forum.userById(post.authorId)?.displayName ?? '未知用户'
}

function openTopic(topicId: string) {
  void router.push(`/t/${topicId}`)
}

function openUser(user: User) {
  void router.push(`/u/${user.username}`)
}
</script>

<template>
  <TxStack :gap="16">
    <TxCard>
      <TxSearchInput
        v-model="query"
        placeholder="搜索话题、帖子或用户"
        clearable
      />
    </TxCard>

    <TxEmptyState
      v-if="!trimmed"
      variant="guide"
      title="输入关键词开始搜索"
      description="可以搜话题标题、帖子正文，或者某个用户的名字。"
    />

    <TxEmptyState
      v-else-if="total === 0"
      variant="search-empty"
      :title="`没有找到和「${trimmed}」有关的内容`"
      description="换个关键词，或者少写几个字试试。"
    />

    <TxCard v-else :padding="0">
      <!-- `placement` defaults to `left`; Discourse's result groups run across the top. -->
      <TxTabs v-model="tab" placement="top" indicator-variant="pill">
        <TxTabItem name="话题">
          <template #name>
            <TxFlex align="center" :gap="6">
              <span>话题</span>
              <TxBadge :value="results.topics.length" />
            </TxFlex>
          </template>

          <TxStack v-if="results.topics.length" :gap="0">
            <template v-for="(topic, index) in results.topics" :key="topic.id">
              <TopicRow :topic="topic" />
              <TxDivider v-if="index < results.topics.length - 1" />
            </template>
          </TxStack>
          <TxEmptyState v-else variant="search-empty" title="没有匹配的话题" size="small" />
        </TxTabItem>

        <TxTabItem name="帖子">
          <template #name>
            <TxFlex align="center" :gap="6">
              <span>帖子</span>
              <TxBadge :value="results.posts.length" />
            </TxFlex>
          </template>

          <TxStack v-if="results.posts.length" :gap="0">
            <template v-for="(post, index) in results.posts" :key="post.id">
              <TxCardItem
                clickable
                :subtitle="`${authorOf(post)} · ${topicOf(post)?.title ?? ''}`"
                @click="openTopic(post.topicId)"
              >
                <template #title>
                  <span class="whitespace-normal font-medium">{{ topicOf(post)?.title }}</span>
                </template>
                <template #description>
                  <!--
                    The match is wrapped in a real `<mark>`; the pair of tokens
                    is the library's soft-fill / same-hue-ink shape, which
                    inverts with `html.dark` on its own.
                  -->
                  <span class="whitespace-normal">
                    <template v-for="(part, at) in highlightParts(matchExcerpt(post.content, trimmed, EXCERPT_LENGTH), trimmed)" :key="at">
                      <mark v-if="part.hit" class="rounded-sm bg-$tx-color-primary-light-9 px-0.5 text-$tx-color-primary-dark-2">{{ part.text }}</mark>
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                </template>
              </TxCardItem>
              <TxDivider v-if="index < results.posts.length - 1" />
            </template>
          </TxStack>
          <TxEmptyState v-else variant="search-empty" title="没有匹配的帖子" size="small" />
        </TxTabItem>

        <TxTabItem name="用户">
          <template #name>
            <TxFlex align="center" :gap="6">
              <span>用户</span>
              <TxBadge :value="results.users.length" />
            </TxFlex>
          </template>

          <TxStack v-if="results.users.length" :gap="0">
            <template v-for="(user, index) in results.users" :key="user.id">
              <TxCardItem
                clickable
                :title="user.displayName"
                :subtitle="`@${user.username}`"
                :description="user.bio"
                @click="openUser(user)"
              >
                <template #avatar>
                  <UserAvatar :user="user" size="small" />
                </template>
                <template v-if="user.role !== 'member'" #right>
                  <TxStatusBadge :text="roleLabel(user.role)" :status="roleTone(user.role)" size="sm" />
                </template>
              </TxCardItem>
              <TxDivider v-if="index < results.users.length - 1" />
            </template>
          </TxStack>
          <TxEmptyState v-else variant="search-empty" title="没有匹配的用户" size="small" />
        </TxTabItem>
      </TxTabs>
    </TxCard>
  </TxStack>
</template>
