<script setup lang="ts">
// Discourse closes every topic with a short list of neighbours: same category
// first, newest activity first, the current topic excluded.
const props = withDefaults(defineProps<{
  topicId: string
  count?: number
}>(), {
  count: 5,
})

const forum = useForumStore()
const router = useRouter()
const { fromNow } = useRelativeTime()

const topics = computed(() => forum.suggestedTopics(props.topicId, props.count))

function open(topicId: string) {
  void router.push(`/t/${topicId}`)
}
</script>

<template>
  <TxStack v-if="topics.length" :gap="8">
    <TxDivider text-placement="left">
      建议话题
    </TxDivider>

    <TxCard variant="plain" :padding="0">
      <TxStack :gap="0">
        <template v-for="(topic, index) in topics" :key="topic.id">
          <TxCardItem clickable @click="open(topic.id)">
            <template #title>
              <span class="whitespace-normal font-medium">{{ topic.title }}</span>
            </template>
            <template #subtitle>
              <CategoryTag :category="forum.categoryById(topic.categoryId)" />
            </template>
            <template #right>
              <TxFlex align="center" :gap="10" class="text-sm text-$tx-text-color-secondary">
                <span class="inline-flex items-center gap-1">
                  <i class="i-carbon-chat" aria-hidden="true" />
                  <span class="sr-only">回复</span>
                  <span>{{ forum.replyCount(topic.id) }}</span>
                </span>
                <span>{{ fromNow(topic.lastActivityAt) }}</span>
              </TxFlex>
            </template>
          </TxCardItem>
          <TxDivider v-if="index < topics.length - 1" />
        </template>
      </TxStack>
    </TxCard>
  </TxStack>
</template>
