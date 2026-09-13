<script setup lang="ts">
import type { Topic } from '~/data/types'

// The narrow-screen shape of a topic list row: what the desktop table spreads
// over five columns, stacked into one card item.
const props = defineProps<{ topic: Topic }>()

const forum = useForumStore()
const router = useRouter()

const author = computed(() => forum.userById(props.topic.authorId))
const category = computed(() => forum.categoryById(props.topic.categoryId))
const tags = computed(() => props.topic.tagIds.map(id => forum.tagById(id)).filter(tag => tag !== undefined))
// Discourse shows a summary under pinned topics only.
const excerpt = computed(() => (props.topic.pinned ? postExcerpt(forum.firstPostOf(props.topic.id)?.content ?? '') : ''))

function open() {
  void router.push(`/t/${props.topic.id}`)
}
</script>

<template>
  <TxCardItem clickable @click="open">
    <template #avatar>
      <UserAvatar v-if="author" :user="author" size="medium" />
    </template>

    <template #title>
      <!--
        `.tx-card-item__title` is `white-space: nowrap; overflow: hidden`, which
        clips a topic title mid-word on a phone; `whitespace-normal` lets it
        wrap and the row grow instead.
      -->
      <TxFlex align="center" :gap="6" wrap="wrap" class="whitespace-normal">
        <TxStatusBadge v-if="topic.pinned" text="已置顶" icon="i-carbon-pin" status="muted" size="sm" />
        <TxStatusBadge v-if="topic.closed" text="已关闭" icon="i-carbon-locked" status="muted" size="sm" />
        <span class="font-medium">{{ topic.title }}</span>
      </TxFlex>
    </template>

    <template #subtitle>
      <TxFlex align="center" :gap="6" wrap="wrap">
        <CategoryTag :category="category" />
        <TxTag v-for="tag in tags" :key="tag.id" :label="tag.name" variant="plain" size="sm" />
      </TxFlex>
    </template>

    <!--
      The stats go under the row rather than in `#right`: that slot is
      `flex: 0 0 auto` next to the title, and on a 390px screen it leaves the
      title about half the row. Discourse's mobile list puts them here too.
    -->
    <template #description>
      <TxStack :gap="6">
        <span v-if="excerpt" class="line-clamp-2">{{ excerpt }}</span>
        <TopicStats :topic="topic" />
      </TxStack>
    </template>
  </TxCardItem>
</template>
