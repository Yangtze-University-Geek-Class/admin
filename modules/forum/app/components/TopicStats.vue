<script setup lang="ts">
import type { Topic } from '~/data/types'

// The counts Discourse puts in its list columns, folded into one line for the
// narrow-screen row. Each icon is decorative; the label next to it is what a
// screen reader reads.
const props = defineProps<{ topic: Topic }>()

const forum = useForumStore()
const { fromNow } = useRelativeTime()

const replies = computed(() => forum.replyCount(props.topic.id))
</script>

<template>
  <TxFlex align="center" :gap="10" class="text-sm text-$tx-text-color-secondary">
    <span class="inline-flex items-center gap-1">
      <i class="i-carbon-chat" aria-hidden="true" />
      <span class="sr-only">回复</span>
      <span>{{ replies }}</span>
    </span>
    <span class="inline-flex items-center gap-1">
      <i class="i-carbon-view" aria-hidden="true" />
      <span class="sr-only">浏览</span>
      <span>{{ topic.views }}</span>
    </span>
    <span>{{ fromNow(topic.lastActivityAt) }}</span>
  </TxFlex>
</template>
